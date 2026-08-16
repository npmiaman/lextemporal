"""Shared text-layer schema and chunking. Not runnable on its own.

Chunking is paragraph-aligned on purpose. lib/drafting.ts emits [dN¶M] citations
and app/api/provenance/route.ts resolves them by paragraph index, so a chunk must
be a contiguous run of whole paragraphs and must record which ones, or every
existing citation in a draft breaks.

Imported by gate_and_text.py (High Courts) and sc_text.py (Supreme Court). Kept
free of heavy imports so sc_text.py does not need duckdb.
"""

import os
import re

DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")

# Target chunk size in characters. nemotron-3-embed-1b's context is unconfirmed
# (no successful call yet); 1800 chars ~ 450 tokens is safe for any 512-token
# encoder and is revisited once the real limit is known.
TARGET_CHARS = 1800
MAX_CHARS = 2400

TEXT_DDL = """
CREATE TABLE IF NOT EXISTS doc_text (
  cnr        TEXT PRIMARY KEY,
  text       BLOB NOT NULL,          -- zlib-deflated UTF-8; see gate_and_text.py
  n_paras    INTEGER NOT NULL,
  n_chars    INTEGER NOT NULL,
  ingested_at TEXT NOT NULL
);
-- Chunks store PARAGRAPH RANGES, not text. doc_text already holds the compressed
-- document; duplicating chunk text here would write ~4.5 GB of uncompressed
-- copies of data we already have. lib/corpus.ts reconstructs chunk text by
-- inflating the doc and slicing paragraphs [para_start..para_end].
CREATE TABLE IF NOT EXISTS chunks (
  id         TEXT PRIMARY KEY,
  cnr        TEXT NOT NULL,
  ord        INTEGER NOT NULL,
  para_start INTEGER NOT NULL,
  para_end   INTEGER NOT NULL,
  n_chars    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_cnr ON chunks(cnr);
"""

PARA_SPLIT = re.compile(r"\n{2,}")


def paragraphs(text: str) -> list[str]:
    """Mirror of the paragraph split in lib/kanoon.ts so indices agree across layers."""
    parts = [p.strip() for p in PARA_SPLIT.split(text)]
    out = [p for p in parts if p]
    if len(out) <= 1:
        # Scanned/OCR'd judgments often arrive as one blob. Fall back to sentence-
        # ish packing so a 900k-char document does not become a single chunk.
        blob = out[0] if out else ""
        out = [s.strip() for s in re.split(r"(?<=[.;])\s+(?=[A-Z0-9])", blob) if s.strip()]
    return out


def chunk_paragraphs(paras: list[str]) -> list[tuple[int, int, str]]:
    """Pack whole paragraphs up to TARGET_CHARS. Returns (para_start, para_end, text),
    1-indexed and inclusive, matching the ¶ numbering used in citations."""
    chunks: list[tuple[int, int, str]] = []
    buf: list[str] = []
    start = 1
    for i, p in enumerate(paras, start=1):
        # A single oversized paragraph becomes its own chunk, hard-split if needed.
        if not buf and len(p) > MAX_CHARS:
            for off in range(0, len(p), TARGET_CHARS):
                chunks.append((i, i, p[off : off + TARGET_CHARS]))
            start = i + 1
            continue
        candidate = sum(len(x) for x in buf) + len(p)
        if buf and candidate > TARGET_CHARS:
            chunks.append((start, i - 1, "\n\n".join(buf)))
            buf, start = [p], i
        else:
            buf.append(p)
    if buf:
        chunks.append((start, len(paras), "\n\n".join(buf)))
    return chunks
