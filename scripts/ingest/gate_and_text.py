"""Single-pass gate + text extraction.

Streams the HF text dump once, applies the statute gate as a pushed-down SQL
predicate, and stores text only for the ~1.7% of judgments that survive. Gating
and extraction are fused deliberately: the scan moves ~24 GB over the network,
and doing it twice to first mark and then fetch would double that for nothing.

Text is stored zlib-compressed. Legal prose compresses ~4x, which turns a 4.5 GB
working set into ~1.2 GB — the difference between fitting on this disk and not.
lib/corpus.ts inflates with node:zlib on read.

Chunking is paragraph-aligned so [dN¶M] provenance citations keep resolving.

Run:  uv run --with duckdb python3 scripts/ingest/gate_and_text.py --split test
"""

import argparse
import os
import zlib

import duckdb

from text import TEXT_DDL, chunk_paragraphs, paragraphs  # noqa: F401

HF = "hf://datasets/overthelex/indian-court-decisions/high_courts"
DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")

# Mirrors ACT_ALIASES and DISTINCTIVE_SECTIONS in lib/validity.ts. A judgment
# matching none of these can only ever return grey from computeValidity, so it
# is provably outside what this product can form an opinion about.
GATE_PATTERNS = [
    r"specific\s+relief\s+act",
    r"commercial\s+courts\s+act",
    r"arbitration\s+(and|&)\s+conciliation\s+act",
    r"(indian\s+)?evidence\s+act",
    r"(bharatiya\s+)?sakshya\s+adhiniyam",
    r"[Ss]ection\s+65\s*-?\s*B|[Ss]\.\s*65\s*-?\s*B",
    r"[Ss]ection\s+12\s*-?\s*A|[Ss]\.\s*12\s*-?\s*A",
    r"[Ss]ection\s+29\s*-?\s*A|[Ss]\.\s*29\s*-?\s*A",
]

FETCH = 500  # rows per fetchmany — bounds peak memory on 900k-char judgments


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test", choices=["train", "validation", "test"])
    ap.add_argument("--since", default="", help="ISO date floor, e.g. 2015-01-01")
    ap.add_argument("--limit", type=int, default=0, help="0 = no limit")
    ap.add_argument("--db", default=DB_PATH)
    args = ap.parse_args()

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute("SET enable_progress_bar=false")
    con.execute(f"ATTACH '{args.db}' AS lex (TYPE SQLITE)")
    con.execute("USE lex")
    for stmt in filter(str.strip, TEXT_DDL.split(";")):
        con.execute(stmt)
    con.execute("USE memory")

    gate = " OR ".join(f"regexp_matches(full_text, '(?i){p}')" for p in GATE_PATTERNS)
    where = [f"({gate})", "full_text IS NOT NULL", "length(full_text) > 500"]
    if args.since:
        where.append(f"decision_date >= '{args.since}'")
    limit = f"LIMIT {args.limit}" if args.limit else ""

    url = f"{HF}/{args.split}.parquet"
    print(f"streaming {args.split} with gate pushed down …", flush=True)
    cur = con.execute(f"""
        SELECT cnr, decision_date, court_code, full_text
        FROM '{url}'
        WHERE {' AND '.join(where)}
        {limit}
    """)

    ins_doc = ("INSERT OR REPLACE INTO doc_text "
               "(cnr, text, n_paras, n_chars, ingested_at) VALUES (?, ?, ?, ?, datetime('now'))")
    ins_chunk = ("INSERT OR REPLACE INTO chunks "
                 "(id, cnr, ord, para_start, para_end, n_chars) VALUES (?, ?, ?, ?, ?, ?)")

    con.execute("USE lex")
    n_docs = n_chunks = raw_bytes = stored_bytes = 0
    while True:
        rows = cur.fetchmany(FETCH)
        if not rows:
            break
        for hf_cnr, _date, _court, text in rows:
            base = hf_cnr.split("_", 1)[0]
            paras = paragraphs(text)
            blob = zlib.compress(text.encode("utf-8"), 6)
            con.execute(ins_doc, [base, blob, len(paras), len(text)])
            con.execute("DELETE FROM chunks WHERE cnr = ?", [base])
            for ord_, (ps, pe, ctext) in enumerate(chunk_paragraphs(paras)):
                con.execute(ins_chunk, [f"{base}:{ord_}", base, ord_, ps, pe, len(ctext)])
                n_chunks += 1
            con.execute(
                "UPDATE judgments SET gated = 1, has_text = 1 WHERE cnr = ?", [base]
            )
            n_docs += 1
            raw_bytes += len(text)
            stored_bytes += len(blob)
        print(f"  {n_docs:,} docs · {n_chunks:,} chunks · "
              f"{raw_bytes / 1e9:.2f} GB raw → {stored_bytes / 1e9:.2f} GB stored", flush=True)
    con.execute("USE memory")

    ratio = raw_bytes / max(stored_bytes, 1)
    print(f"\ndone: {n_docs:,} docs, {n_chunks:,} chunks "
          f"({n_chunks / max(n_docs, 1):.1f} per doc)")
    print(f"compression: {raw_bytes / 1e9:.2f} GB → {stored_bytes / 1e9:.2f} GB ({ratio:.1f}x)")
    print(f"db size: {os.path.getsize(args.db) / 1e9:.2f} GB")


if __name__ == "__main__":
    main()
