import crypto from "crypto";
import { getDb, nowIso } from "@/lib/db";

// Indian Kanoon API client. Cache-first, permanently: every search response and
// every fetched doc is stored in SQLite and served from there before the network
// is ever touched. That cache is the demo's only safety net.
//
// Costs (spend counter): ₹0.50 per search page, ₹0.20 per doc.

const IK_BASE = "https://api.indiankanoon.org";

export interface IkSearchResult {
  docid: string;
  title: string;
  court: string;
  date: string; // ISO yyyy-mm-dd (best-effort parse)
  snippet: string;
  url: string;
}

export interface IkSearchFilters {
  doctypes?: string; // e.g. "delhi" | "supremecourt"
  fromdate?: string; // "D-M-YYYY" (IK format)
  todate?: string;
}

export class IkNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IkNetworkError";
  }
}

function token(): string {
  const t = process.env.INDIANKANOON_API_TOKEN;
  if (!t) throw new Error("INDIANKANOON_API_TOKEN is not set");
  return t;
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function buildFormInput(query: string, filters: IkSearchFilters = {}): string {
  let fi = query.trim();
  if (filters.doctypes) fi += ` doctypes:${filters.doctypes}`;
  if (filters.fromdate) fi += ` fromdate:${filters.fromdate}`;
  if (filters.todate) fi += ` todate:${filters.todate}`;
  return fi;
}

async function ikPost(pathname: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${IK_BASE}${pathname}`, {
      method: "POST",
      headers: { Authorization: `Token ${token()}` },
    });
  } catch (e) {
    throw new IkNetworkError(`Indian Kanoon unreachable: ${String(e)}`);
  }
  if (!res.ok) {
    throw new IkNetworkError(`Indian Kanoon HTTP ${res.status}`);
  }
  return res.json();
}

function bumpSpend(kind: "search" | "doc") {
  const db = getDb();
  db.prepare(
    kind === "search"
      ? "UPDATE spend SET search_count = search_count + 1 WHERE id = 1"
      : "UPDATE spend SET doc_count = doc_count + 1 WHERE id = 1"
  ).run();
}

export function getSpend(): { searches: number; docs: number; rupees: number } {
  const row = getDb()
    .prepare("SELECT search_count, doc_count FROM spend WHERE id = 1")
    .get() as { search_count: number; doc_count: number };
  return {
    searches: row.search_count,
    docs: row.doc_count,
    rupees: row.search_count * 0.5 + row.doc_count * 0.2,
  };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|blockquote|h[1-6]|li|pre)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** IK dates arrive in assorted formats ("1-10-2016", "2016-10-01"). Normalise to ISO. */
export function parseIkDate(raw: string | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

interface RawSearchDoc {
  tid?: number | string;
  title?: string;
  headline?: string;
  docsource?: string;
  publishdate?: string;
  posted_date?: string;
}

/**
 * Search Indian Kanoon. Cache key = SHA256 of the full formInput + page.
 * `allowNetwork:false` (network-kill mode) returns null on cache miss instead of fetching.
 */
export async function search(
  query: string,
  filters: IkSearchFilters = {},
  pagenum = 0,
  opts: { allowNetwork?: boolean } = {}
): Promise<{ results: IkSearchResult[]; fromCache: boolean } | null> {
  const db = getDb();
  const formInput = buildFormInput(query, filters);
  const hash = sha256(`${formInput}::page${pagenum}`);
  const cached = db
    .prepare("SELECT response FROM ik_search_cache WHERE hash = ?")
    .get(hash) as { response: string } | undefined;

  let raw: unknown;
  let fromCache = false;
  if (cached) {
    raw = JSON.parse(cached.response);
    fromCache = true;
  } else {
    if (opts.allowNetwork === false) return null;
    raw = await ikPost(`/search/?formInput=${encodeURIComponent(formInput)}&pagenum=${pagenum}`);
    db.prepare(
      "INSERT OR REPLACE INTO ik_search_cache (hash, form_input, response, created_at) VALUES (?, ?, ?, ?)"
    ).run(hash, formInput, JSON.stringify(raw), nowIso());
    bumpSpend("search");
  }

  const docs: RawSearchDoc[] = ((raw as { docs?: RawSearchDoc[] })?.docs ?? []).slice(0, 10);
  const results: IkSearchResult[] = docs.map((d) => ({
    docid: String(d.tid ?? ""),
    title: stripHtml(d.title ?? ""),
    court: d.docsource ?? "",
    date: parseIkDate(d.publishdate ?? d.posted_date),
    snippet: stripHtml(d.headline ?? ""),
    url: `https://indiankanoon.org/doc/${d.tid}/`,
  }));
  return { results, fromCache };
}

export interface IkDoc {
  docid: string;
  title: string;
  court: string;
  date: string;
  text: string;
  paragraphs: string[];
  url: string;
}

/** Fetch a judgment's full text. Cache-first by docid, forever. */
export async function fetchDoc(
  docid: string,
  opts: { allowNetwork?: boolean } = {}
): Promise<IkDoc | null> {
  const db = getDb();
  const cached = db
    .prepare("SELECT response FROM ik_doc_cache WHERE docid = ?")
    .get(docid) as { response: string } | undefined;

  let raw: unknown;
  if (cached) {
    raw = JSON.parse(cached.response);
  } else {
    if (opts.allowNetwork === false) return null;
    raw = await ikPost(`/doc/${docid}/`);
    db.prepare(
      "INSERT OR REPLACE INTO ik_doc_cache (docid, response, created_at) VALUES (?, ?, ?)"
    ).run(docid, JSON.stringify(raw), nowIso());
    bumpSpend("doc");
  }

  const r = raw as { doc?: string; title?: string; docsource?: string; publishdate?: string };
  const text = stripHtml(r.doc ?? "");
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return {
    docid,
    title: stripHtml(r.title ?? ""),
    court: r.docsource ?? "",
    date: parseIkDate(r.publishdate),
    text,
    paragraphs,
    url: `https://indiankanoon.org/doc/${docid}/`,
  };
}
