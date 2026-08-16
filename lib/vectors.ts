// Binary vector index — the seed stage of semantic retrieval.
//
// Chunk embeddings are stored as 1-bit-per-dimension codes (2048 dims = 256 B),
// so the whole corpus fits in memory and a brute-force scan beats an ANN index:
// measured 1.19 s for top-2000 over 3.4M codes, with none of the build cost, the
// native dependency, or ANN's collapse under selective filters.
//
// Two-stage scoring, both cheap:
//   1. Hamming over packed codes — coarse, branch-free, cache-friendly.
//   2. Asymmetric rescore of the survivors against the FULL-PRECISION query
//      vector. The query is fp32 in hand, so throwing that precision away by
//      binarising both sides is a needless accuracy loss for ~8 ms.
//
// NOTE: the scan is synchronous. At full corpus scale it must move to worker
// threads over a SharedArrayBuffer before it goes in a request path — a 1.19 s
// synchronous scan blocks Node's event loop and would stall every other route.

import { getDb } from "@/lib/db";

export interface ChunkHit {
  chunkId: string;
  cnr: string;
  hamming: number;
  score: number; // asymmetric dot against the fp32 query; higher is better
}

interface Index {
  n: number;
  dims: number;
  bytes: number;
  codes: Buffer; // n * bytes, row-major
  chunkIds: string[];
  cnrs: string[];
}

let INDEX: Index | null = null;

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

/** Load once. Returns null when nothing has been embedded yet. */
export function loadIndex(force = false): Index | null {
  if (INDEX && !force) return INDEX;
  const db = getDb();
  const meta = db
    .prepare("SELECT count(*) n, max(dims) dims FROM chunk_vectors")
    .get() as { n: number; dims: number | null };
  if (!meta.n || !meta.dims) return null;

  const bytes = meta.dims / 8;
  const codes = Buffer.allocUnsafe(meta.n * bytes);
  const chunkIds: string[] = new Array(meta.n);
  const cnrs: string[] = new Array(meta.n);

  let i = 0;
  const rows = db
    .prepare("SELECT chunk_id, bin FROM chunk_vectors ORDER BY chunk_id")
    .iterate() as Iterable<{ chunk_id: string; bin: Buffer }>;
  for (const r of rows) {
    r.bin.copy(codes, i * bytes);
    chunkIds[i] = r.chunk_id;
    cnrs[i] = r.chunk_id.slice(0, r.chunk_id.lastIndexOf(":"));
    i += 1;
  }
  INDEX = { n: i, dims: meta.dims, bytes, codes, chunkIds, cnrs };
  return INDEX;
}

export function indexStats(): { n: number; dims: number; mb: number } | null {
  const idx = loadIndex();
  return idx ? { n: idx.n, dims: idx.dims, mb: (idx.n * idx.bytes) / 1e6 } : null;
}

/** Pack an fp32 vector to sign bits. Must stay identical to embed_chunks.py to_binary(). */
export function toBinary(vec: Float32Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(vec.length / 8));
  for (let i = 0; i < vec.length; i++) if (vec[i] > 0) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

/**
 * dot(query, sign(doc)) without materialising the doc vector: every set bit
 * contributes +q[i], every clear bit -q[i], so the result is
 * 2 * sum(q[i] where bit set) - sum(q). The constant is precomputed per query.
 */
function asymmetric(q: Float32Array, qSum: number, idx: Index, row: number): number {
  const off = row * idx.bytes;
  let acc = 0;
  for (let b = 0; b < idx.bytes; b++) {
    const byte = idx.codes[off + b];
    if (byte === 0) continue;
    const base = b << 3;
    for (let k = 0; k < 8; k++) if (byte & (0x80 >> k)) acc += q[base + k];
  }
  return 2 * acc - qSum;
}

/** Brute-force top-K by Hamming, then rescore survivors asymmetrically. */
export function searchChunks(
  queryVec: Float32Array,
  k = 200,
  allowedCnrs?: Set<string>
): ChunkHit[] {
  const idx = loadIndex();
  if (!idx) return [];
  const qBin = toBinary(queryVec);

  // Coarse pass: keep a bounded max-heap-ish array of the K best Hamming rows.
  const bestD = new Int32Array(k).fill(1 << 30);
  const bestI = new Int32Array(k).fill(-1);
  let worst = 1 << 30;

  for (let row = 0; row < idx.n; row++) {
    if (allowedCnrs && !allowedCnrs.has(idx.cnrs[row])) continue;
    const off = row * idx.bytes;
    let d = 0;
    for (let b = 0; b < idx.bytes; b++) d += POPCOUNT[idx.codes[off + b] ^ qBin[b]];
    if (d < worst) {
      let p = k - 1;
      while (p > 0 && bestD[p - 1] > d) {
        bestD[p] = bestD[p - 1];
        bestI[p] = bestI[p - 1];
        p--;
      }
      bestD[p] = d;
      bestI[p] = row;
      worst = bestD[k - 1];
    }
  }

  let qSum = 0;
  for (const v of queryVec) qSum += v;

  const hits: ChunkHit[] = [];
  for (let i = 0; i < k; i++) {
    const row = bestI[i];
    if (row < 0) continue;
    hits.push({
      chunkId: idx.chunkIds[row],
      cnr: idx.cnrs[row],
      hamming: bestD[i],
      score: asymmetric(queryVec, qSum, idx, row),
    });
  }
  return hits.sort((a, b) => b.score - a.score);
}

export interface DocHit {
  cnr: string;
  bestChunk: string;
  score: number;
  hamming: number;
  nHits: number;
}

/**
 * Collapse chunk hits to judgments, keeping each judgment's BEST chunk.
 * Max rather than mean: a 60-chunk judgment must not be penalised for the 59
 * chunks about procedural history, nor rewarded for having many mediocre ones.
 */
export function collapseToDocs(hits: ChunkHit[], limit = 50): DocHit[] {
  const byCnr = new Map<string, DocHit>();
  for (const h of hits) {
    const cur = byCnr.get(h.cnr);
    if (!cur) {
      byCnr.set(h.cnr, {
        cnr: h.cnr,
        bestChunk: h.chunkId,
        score: h.score,
        hamming: h.hamming,
        nHits: 1,
      });
    } else {
      cur.nHits += 1;
      if (h.score > cur.score) {
        cur.score = h.score;
        cur.bestChunk = h.chunkId;
        cur.hamming = h.hamming;
      }
    }
  }
  return [...byCnr.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
