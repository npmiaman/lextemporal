// Local corpus access. Replaces the Indian Kanoon client as the document
// source: everything is served from SQLite, so there is no network call, no
// per-search cost, and no cache-miss failure mode.
//
// Two tables back this:
//   judgments  — full-corpus spine (~17M rows, metadata only, no text)
//   doc_text   — zlib-compressed full text for the gated working set
//
// The returned shape matches the old IkDoc so lib/drafting.ts,
// app/api/provenance/route.ts and the flag UI keep working unchanged.

import zlib from "zlib";
import { getDb } from "@/lib/db";

export interface JudgmentSpine {
  cnr: string;
  bucket: "sc" | "hc";
  court_code: string;
  bench: string;
  title: string;
  judge: string;
  citation: string;
  decision_date: number; // yyyymmdd, 0 when unknown
  year: number | null;
  disposal: string;
  has_text: number;
  gated: number;
}

export interface CorpusDoc {
  docid: string; // CNR
  title: string;
  court: string;
  date: string; // ISO yyyy-mm-dd, '' when unknown
  text: string;
  paragraphs: string[];
  url: string;
  citation: string;
  disposal: string;
}

/** Spine dates are INTEGER yyyymmdd; validity.ts compares ISO strings. */
export function isoDate(yyyymmdd: number): string {
  if (!yyyymmdd || yyyymmdd < 10000101) return "";
  const s = String(yyyymmdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function toYyyymmdd(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : 0;
}

/** eCourts court codes are "state_court"; the bucket tells SC from HC. */
export function courtLabel(s: Pick<JudgmentSpine, "bucket" | "court_code" | "bench">): string {
  if (s.bucket === "sc") return "Supreme Court of India";
  return s.bench || s.court_code || "High Court";
}

export function getSpine(cnr: string): JudgmentSpine | null {
  return (
    (getDb()
      .prepare("SELECT * FROM judgments WHERE cnr = ?")
      .get(cnr) as JudgmentSpine | undefined) ?? null
  );
}

const PARA_SPLIT = /\n{2,}/;

/**
 * Full document for a CNR. Returns null when the judgment is in the spine but
 * outside the gated working set — the caller must treat that as "no text",
 * exactly as the old cache-miss path did, rather than as an error.
 */
export function fetchDoc(cnr: string): CorpusDoc | null {
  const spine = getSpine(cnr);
  if (!spine) return null;

  const row = getDb()
    .prepare("SELECT text FROM doc_text WHERE cnr = ?")
    .get(cnr) as { text: Buffer } | undefined;
  if (!row) return null;

  const text = zlib.inflateSync(row.text).toString("utf-8");
  const paragraphs = text
    .split(PARA_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);

  return {
    docid: spine.cnr,
    title: spine.title,
    court: courtLabel(spine),
    date: isoDate(spine.decision_date),
    text,
    paragraphs,
    url: sourceUrl(spine),
    citation: spine.citation,
    disposal: spine.disposal,
  };
}

/**
 * Best-effort link back to the source. The eCourts PDF layer is unreliable
 * (pdf_exists was false for every row sampled), so this returns the judgment
 * search rather than a deep link that would often 404.
 */
export function sourceUrl(spine: Pick<JudgmentSpine, "bucket" | "cnr">): string {
  return spine.bucket === "sc"
    ? "https://digiscr.sci.gov.in/"
    : `https://judgments.ecourts.gov.in/pdfsearch/?p=pdf_search/openpdfcaptcha&cnr=${encodeURIComponent(spine.cnr)}`;
}

export interface Chunk {
  id: string;
  cnr: string;
  ord: number;
  para_start: number;
  para_end: number;
  n_chars: number;
}

/**
 * Chunks store paragraph ranges, not text — doc_text already holds the document
 * compressed, and duplicating chunk text would add ~4.5 GB of copies. Rebuild the
 * passage by inflating once and slicing [para_start..para_end] (1-indexed,
 * inclusive, matching ¶ citation numbering).
 */
export function chunkTexts(cnr: string): { chunk: Chunk; text: string }[] {
  const doc = fetchDoc(cnr);
  if (!doc) return [];
  const rows = getDb()
    .prepare("SELECT * FROM chunks WHERE cnr = ? ORDER BY ord")
    .all(cnr) as Chunk[];
  return rows.map((chunk) => ({
    chunk,
    text: doc.paragraphs.slice(chunk.para_start - 1, chunk.para_end).join("\n\n"),
  }));
}

/** Single chunk by id ("<cnr>:<ord>"). */
export function chunkText(chunkId: string): string | null {
  const cnr = chunkId.slice(0, chunkId.lastIndexOf(":"));
  const found = chunkTexts(cnr).find((c) => c.chunk.id === chunkId);
  return found ? found.text : null;
}

export interface CorpusStats {
  total: number;
  gated: number;
  withText: number;
  chunks: number;
  earliest: string;
  latest: string;
}

export function corpusStats(): CorpusStats {
  const db = getDb();
  const a = db
    .prepare(
      `SELECT count(*) total,
              sum(gated) gated,
              sum(has_text) withText,
              min(CASE WHEN decision_date > 0 THEN decision_date END) lo,
              max(decision_date) hi
       FROM judgments`
    )
    .get() as { total: number; gated: number; withText: number; lo: number; hi: number };
  const c = db.prepare("SELECT count(*) n FROM chunks").get() as { n: number };
  return {
    total: a.total ?? 0,
    gated: a.gated ?? 0,
    withText: a.withText ?? 0,
    chunks: c.n ?? 0,
    earliest: isoDate(a.lo),
    latest: isoDate(a.hi),
  };
}
