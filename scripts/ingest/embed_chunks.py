"""Embed gated chunks with NVIDIA NIM and store binary codes.

Only binary codes are stored. At 2048 dims that is 256 B/chunk versus 8 KB for
fp32 — the difference between ~740 MB and ~20 GB over the gated set. The fine
scoring stage does not need a stored vector at all, because the NIM cross-encoder
reranker scores from passage TEXT, which we can reconstruct from doc_text.

Bit packing MUST stay identical to toBinary() in lib/embed.ts: bit set when the
component is > 0, MSB-first within each byte. If these two ever disagree, every
Hamming distance silently becomes noise.

Chunk text is reconstructed from doc_text (inflate, slice paragraphs) rather than
stored, mirroring lib/corpus.ts chunkTexts().

Run:  uv run --with pypdf python3 scripts/ingest/embed_chunks.py --limit 5000
"""

import argparse
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor

DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")
BASE = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
MODEL = os.environ.get("NVIDIA_EMBED_MODEL", "nvidia/nemotron-3-embed-1b")
KEY = os.environ.get("NVIDIA_EMBED_API_KEY", "")

BATCH = 64          # verified working in one call
PARA_SPLIT = re.compile(r"\n{2,}")

VEC_DDL = """
CREATE TABLE IF NOT EXISTS chunk_vectors (
  chunk_id TEXT PRIMARY KEY,
  model    TEXT NOT NULL,
  bin      BLOB NOT NULL,
  dims     INTEGER NOT NULL
);
"""


def to_binary(vec: list[float]) -> bytes:
    """Mirror of toBinary() in lib/embed.ts. MSB-first, threshold at zero."""
    out = bytearray((len(vec) + 7) // 8)
    for i, v in enumerate(vec):
        if v > 0:
            out[i >> 3] |= 0x80 >> (i & 7)
    return bytes(out)


def embed_batch(texts: list[str], attempt: int = 0) -> list[list[float]]:
    body = json.dumps({
        "input": texts,
        "model": MODEL,
        "input_type": "passage",
        "encoding_format": "float",
        "truncate": "END",
    }).encode()
    req = urllib.request.Request(
        f"{BASE}/embeddings", data=body,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.load(r)["data"]
        data.sort(key=lambda d: d["index"])
        return [d["embedding"] for d in data]
    except urllib.error.HTTPError as e:
        # 429/5xx are transient on hosted NIM; 4xx otherwise is a real error.
        if e.code in (429,) or e.code >= 500:
            if attempt < 5:
                time.sleep(min(30, 2 ** attempt))
                return embed_batch(texts, attempt + 1)
        raise RuntimeError(f"NIM HTTP {e.code}: {e.read()[:200]!r}") from e
    except (urllib.error.URLError, TimeoutError, OSError):
        # TimeoutError must be caught explicitly: when the connection is already
        # established and the READ times out, Python raises a bare TimeoutError,
        # which is NOT a subclass of URLError. A single one of these killed a
        # ~100k-vector run that had otherwise succeeded.
        if attempt < 5:
            time.sleep(min(30, 2 ** attempt))
            return embed_batch(texts, attempt + 1)
        raise


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    if not KEY:
        raise SystemExit("NVIDIA_EMBED_API_KEY not set — source .env.local first")

    db = sqlite3.connect(args.db, timeout=120)
    db.executescript(VEC_DDL)

    q = """SELECT c.id, c.cnr, c.para_start, c.para_end
           FROM chunks c
           LEFT JOIN chunk_vectors v ON v.chunk_id = c.id
           WHERE v.chunk_id IS NULL
           ORDER BY c.cnr, c.ord"""
    if args.limit:
        q += f" LIMIT {args.limit}"
    todo = db.execute(q).fetchall()
    print(f"chunks needing vectors: {len(todo):,}", flush=True)
    if not todo:
        return

    # Reconstruct chunk text; inflate each document once, not once per chunk.
    doc_cache: dict[str, list[str]] = {}

    def text_for(cnr: str, ps: int, pe: int) -> str:
        paras = doc_cache.get(cnr)
        if paras is None:
            row = db.execute("SELECT text FROM doc_text WHERE cnr = ?", (cnr,)).fetchone()
            if not row:
                return ""
            paras = [p.strip() for p in PARA_SPLIT.split(zlib.decompress(row[0]).decode("utf-8")) if p.strip()]
            doc_cache.clear()          # keep at most one document resident
            doc_cache[cnr] = paras
        return "\n\n".join(paras[ps - 1 : pe])

    batches: list[list[tuple]] = []
    cur: list[tuple] = []
    for cid, cnr, ps, pe in todo:
        t = text_for(cnr, ps, pe)
        if not t:
            continue
        cur.append((cid, t))
        if len(cur) == BATCH:
            batches.append(cur)
            cur = []
    if cur:
        batches.append(cur)
    print(f"batches of {BATCH}: {len(batches):,}", flush=True)

    done = 0
    started = time.time()

    failed_batches = 0

    def run(batch):
        # A batch that exhausts its retries must not abort the run: pool.map
        # propagates the exception and every remaining batch is lost. The work
        # is resumable (chunks are re-queried by absence of a vector), so the
        # right behaviour is to drop this batch and keep going.
        nonlocal failed_batches
        try:
            vecs = embed_batch([t for _, t in batch])
        except Exception as e:  # noqa: BLE001 — deliberate: keep the run alive
            failed_batches += 1
            print(f"  batch failed after retries, skipping: {type(e).__name__}", flush=True)
            return []
        return [(cid, v) for (cid, _), v in zip(batch, vecs)]

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, results in enumerate(pool.map(run, batches), start=1):
            db.executemany(
                "INSERT OR REPLACE INTO chunk_vectors (chunk_id, model, bin, dims) VALUES (?,?,?,?)",
                [(cid, MODEL, to_binary(v), len(v)) for cid, v in results],
            )
            done += len(results)
            if i % 20 == 0:
                db.commit()
                rate = done / max(time.time() - started, 1)
                print(f"  {done:,} vectors  ({rate:.0f}/s)", flush=True)
    db.commit()

    n, dims = db.execute(
        "SELECT count(*), max(dims) FROM chunk_vectors"
    ).fetchone()
    print(f"\nstored {done:,} this run · {n:,} total · dims={dims}")
    if failed_batches:
        print(f"batches skipped after retries: {failed_batches} "
              f"(~{failed_batches * BATCH:,} chunks — re-run to fill them in)")
    print(f"binary size: {n * (dims // 8) / 1e6:.0f} MB at {dims // 8} B/chunk")
    db.close()


if __name__ == "__main__":
    main()
