// Dense retrieval providers. NVIDIA NIM by default, behind an interface so the
// pipeline runs (and is testable) without a key.
//
// Two stages, two models, two endpoints:
//   embed   POST /v1/embeddings  — asymmetric: passages and queries must be
//           embedded with different input_type or recall degrades badly.
//   rerank  POST /v1/ranking     — cross-encoder over the graph-expanded
//           candidate set; returns logits, not probabilities.
//
// Vectors are cached in SQLite keyed by (model, input_type, sha256(text)) so a
// re-ingest of unchanged text costs nothing.

import crypto from "crypto";
import { getDb, nowIso } from "@/lib/db";

export type InputKind = "query" | "passage";

export interface EmbedProvider {
  readonly id: string;
  readonly dims: number;
  embed(texts: string[], kind: InputKind): Promise<Float32Array[]>;
}

export interface RerankProvider {
  readonly id: string;
  rerank(query: string, passages: string[]): Promise<number[]>;
}

export class EmbedAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedAuthError";
  }
}

const BASE = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";

// The reranker is NOT on integrate.api.nvidia.com — every path there 404s, and
// it is absent from that host's model catalog. It is served from ai.api.nvidia.com
// under a model-scoped path: /v1/retrieval/{model}/reranking.
const RERANK_BASE =
  process.env.NVIDIA_RERANK_BASE_URL || "https://ai.api.nvidia.com/v1/retrieval";

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Hosted NIM is rate-limited; retry 429/5xx with jittered backoff, fail fast on 4xx. */
async function postJson(
  url: string,
  key: string,
  body: unknown,
  attempt = 0
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) return res.json();

  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) {
    throw new EmbedAuthError(
      `NIM rejected the key (HTTP ${res.status}). Check NVIDIA_*_API_KEY. ${text.slice(0, 160)}`
    );
  }
  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 5) {
    const wait = Math.min(30_000, 2 ** attempt * 1000) + Math.floor(Math.random() * 500);
    await new Promise((r) => setTimeout(r, wait));
    return postJson(url, key, body, attempt + 1);
  }
  throw new Error(`NIM HTTP ${res.status}: ${text.slice(0, 240)}`);
}

export class NimEmbedProvider implements EmbedProvider {
  readonly id: string;
  readonly dims: number;
  private key: string;
  private batchSize: number;

  constructor(opts: { model?: string; key?: string; dims?: number; batchSize?: number } = {}) {
    this.id = opts.model ?? process.env.NVIDIA_EMBED_MODEL ?? "nvidia/nemotron-3-embed-1b";
    this.key = opts.key ?? process.env.NVIDIA_EMBED_API_KEY ?? "";
    // VERIFIED against a live response: nemotron-3-embed-1b returns 2048 floats.
    this.dims = opts.dims ?? 2048;
    this.batchSize = opts.batchSize ?? 32;
  }

  async embed(texts: string[], kind: InputKind): Promise<Float32Array[]> {
    if (!this.key) throw new EmbedAuthError("NVIDIA_EMBED_API_KEY is not set");
    const out: Float32Array[] = new Array(texts.length);
    const pending: { idx: number; text: string }[] = [];

    // Cache lookup first — re-ingest of unchanged text must cost nothing.
    for (let i = 0; i < texts.length; i++) {
      const cached = readCachedVector(this.id, kind, texts[i]);
      if (cached) out[i] = cached;
      else pending.push({ idx: i, text: texts[i] });
    }

    for (let i = 0; i < pending.length; i += this.batchSize) {
      const batch = pending.slice(i, i + this.batchSize);
      const raw = (await postJson(`${BASE}/embeddings`, this.key, {
        input: batch.map((b) => b.text),
        model: this.id,
        input_type: kind,
        encoding_format: "float",
        truncate: "END",
      })) as { data?: { index: number; embedding: number[] }[] };

      for (const d of raw.data ?? []) {
        const item = batch[d.index];
        const vec = Float32Array.from(d.embedding);
        out[item.idx] = vec;
        writeCachedVector(this.id, kind, item.text, vec);
      }
    }

    const missing = out.findIndex((v) => !v);
    if (missing !== -1) throw new Error(`NIM returned no vector for input ${missing}`);
    return out;
  }
}

export class NimRerankProvider implements RerankProvider {
  readonly id: string;
  private key: string;

  constructor(opts: { model?: string; key?: string } = {}) {
    this.id = opts.model ?? process.env.NVIDIA_RERANK_MODEL ?? "nvidia/llama-nemotron-rerank-1b-v2";
    this.key = opts.key ?? process.env.NVIDIA_RERANK_API_KEY ?? "";
  }

  /** Returns one relevance logit per passage, aligned to the input order. */
  async rerank(query: string, passages: string[]): Promise<number[]> {
    if (!this.key) throw new EmbedAuthError("NVIDIA_RERANK_API_KEY is not set");
    if (passages.length === 0) return [];

    const raw = (await postJson(`${RERANK_BASE}/${this.id}/reranking`, this.key, {
      model: this.id,
      query: { text: query },
      passages: passages.map((text) => ({ text })),
      truncate: "END",
    })) as { rankings?: { index: number; logit: number }[] };

    const scores = new Array<number>(passages.length).fill(Number.NEGATIVE_INFINITY);
    for (const r of raw.rankings ?? []) scores[r.index] = r.logit;
    return scores;
  }
}

// ---------------------------------------------------------------------------
// Vector cache
// ---------------------------------------------------------------------------

export const EMBED_CACHE_DDL = `
CREATE TABLE IF NOT EXISTS embed_cache (
  hash       TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  input_type TEXT NOT NULL,
  dims       INTEGER NOT NULL,
  vec        BLOB NOT NULL,
  created_at TEXT NOT NULL
);
`;

function cacheKey(model: string, kind: InputKind, text: string): string {
  return sha256(`${model}::${kind}::${text}`);
}

function readCachedVector(model: string, kind: InputKind, text: string): Float32Array | null {
  const row = getDb()
    .prepare("SELECT vec, dims FROM embed_cache WHERE hash = ?")
    .get(cacheKey(model, kind, text)) as { vec: Buffer; dims: number } | undefined;
  if (!row) return null;
  return new Float32Array(row.vec.buffer, row.vec.byteOffset, row.dims);
}

function writeCachedVector(model: string, kind: InputKind, text: string, vec: Float32Array): void {
  // A cache write must NEVER fail the caller. SQLite is single-writer, so a
  // concurrent ingest holding the lock would otherwise take down live search —
  // which is exactly what happened the first time this ran alongside an
  // embedding pass. Losing a cache entry costs one re-embed; throwing costs
  // the user their query.
  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO embed_cache (hash, model, input_type, dims, vec, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        cacheKey(model, kind, text),
        model,
        kind,
        vec.length,
        Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
        nowIso()
      );
  } catch {
    // best-effort only
  }
}

// ---------------------------------------------------------------------------
// Quantisation — 11.3 GB of free disk does not hold fp32 vectors at this scale.
// Binary for the coarse Hamming scan, int8 for the rerank shortlist.
// ---------------------------------------------------------------------------

/** 1 bit per dimension, sign-thresholded. 32x smaller than fp32. */
export function toBinary(vec: Float32Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(vec.length / 8));
  for (let i = 0; i < vec.length; i++) {
    if (vec[i] > 0) out[i >> 3] |= 0x80 >> (i & 7);
  }
  return out;
}

/** Symmetric int8 with a per-vector scale, so dequantisation stays exact enough to rerank on. */
export function toInt8(vec: Float32Array): { q: Int8Array; scale: number } {
  let max = 0;
  for (const v of vec) max = Math.max(max, Math.abs(v));
  const scale = max === 0 ? 1 : max / 127;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) q[i] = Math.round(vec[i] / scale);
  return { q, scale };
}

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

/** Hamming distance over packed binary codes. Lower is closer. */
export function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT[a[i] ^ b[i]];
  return d;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
