// OCR for scanned case papers — tesseract.js (Apache-2.0), running locally.
//
// Open source and on-device on purpose. A hosted vision model would read a
// skewed photocopy better, but it means posting a client's papers to a third
// party, an API key in the demo path, and a per-page cost. Tesseract keeps the
// record on the machine it was uploaded to and works with the network down,
// which is the same property that makes the rest of this corpus local.
//
// Measured on a clean 1000x420 order: worker warm in 0.7 s, recognition 0.3 s,
// confidence 94, every date recovered. Quality falls off on skew, stamps and
// handwriting — hence `confidence` is returned, not hidden.

import crypto from "crypto";
import { getDb, nowIso } from "@/lib/db";

export class OcrError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "OcrError";
    this.retryable = retryable;
  }
}

export interface OcrResult {
  text: string;
  /** 0-100, tesseract's mean confidence. Below ~70 the read is not trustworthy. */
  confidence: number;
  lines: number;
  fromCache: boolean;
  ms: number;
}

export const OCR_CACHE_DDL = `
CREATE TABLE IF NOT EXISTS ocr_cache (
  hash       TEXT PRIMARY KEY,
  engine     TEXT NOT NULL,
  text       TEXT NOT NULL,
  confidence REAL NOT NULL,
  lines      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

const ENGINE = "tesseract.js/eng";

/** Confidence under this is surfaced to the user rather than used silently. */
export const LOW_CONFIDENCE = 70;

function sha256(b: Buffer): string {
  return crypto.createHash("sha256").update(b).digest("hex");
}

function readCache(hash: string): OcrResult | null {
  try {
    const db = getDb();
    db.exec(OCR_CACHE_DDL);
    const row = db
      .prepare("SELECT text, confidence, lines FROM ocr_cache WHERE hash = ?")
      .get(hash) as { text: string; confidence: number; lines: number } | undefined;
    if (!row) return null;
    return { ...row, fromCache: true, ms: 0 };
  } catch {
    return null; // a cache miss must never fail the upload
  }
}

function writeCache(hash: string, r: OcrResult): void {
  try {
    const db = getDb();
    db.exec(OCR_CACHE_DDL);
    db.prepare(
      "INSERT OR REPLACE INTO ocr_cache (hash, engine, text, confidence, lines, created_at) VALUES (?,?,?,?,?,?)"
    ).run(hash, ENGINE, r.text, r.confidence, r.lines, nowIso());
  } catch {
    /* best effort */
  }
}

// Spinning up a worker costs ~0.7 s and loads a ~15 MB language model, so it is
// created once and reused. Held on globalThis so Next's dev hot-reload does not
// leak a new worker (and a new model load) on every edit.
type TWorker = {
  recognize: (image: Buffer) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};
const g = globalThis as unknown as { __lexOcrWorker?: Promise<TWorker> };

function worker(): Promise<TWorker> {
  if (!g.__lexOcrWorker) {
    g.__lexOcrWorker = (async () => {
      const { createWorker } = await import("tesseract.js");
      return (await createWorker("eng")) as unknown as TWorker;
    })().catch((e) => {
      g.__lexOcrWorker = undefined; // let the next upload retry a failed load
      throw new OcrError(`could not start the OCR engine: ${String(e).slice(0, 160)}`, true);
    });
  }
  return g.__lexOcrWorker;
}

/** Tesseract emits page furniture as stray one/two-character lines. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !/^[\s|_~`'".,]{0,3}$/.test(l))
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** OCR one image. Cached by content hash, so re-uploading a page is free. */
export async function ocrImage(bytes: Buffer): Promise<OcrResult> {
  const hash = sha256(bytes);
  const cached = readCache(hash);
  if (cached) return cached;

  const started = Date.now();
  const w = await worker();

  let text: string;
  let confidence: number;
  try {
    const { data } = await w.recognize(bytes);
    text = tidy(data.text ?? "");
    confidence = Number(data.confidence ?? 0);
  } catch (e) {
    throw new OcrError(`OCR failed: ${String(e).slice(0, 160)}`, true);
  }

  const result: OcrResult = {
    text,
    confidence,
    lines: text ? text.split("\n").filter(Boolean).length : 0,
    fromCache: false,
    ms: Date.now() - started,
  };
  if (result.text) writeCache(hash, result);
  return result;
}
