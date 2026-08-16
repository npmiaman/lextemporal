"""Strip PDF page furniture from already-stored doc_text and rebuild affected chunks.

Supreme Court Reports pages carry margin line-guides A-H down the left edge, which
pdf extraction emits as standalone single-letter lines. Measured on a random 40-doc
sample: 13 docs affected (32.5%), ~225 junk lines each.

This runs over stored text, so no PDF is re-downloaded.

Why it must run BEFORE embed_chunks.py: the embedding pass reconstructs chunk text
from doc_text. Embedding first would spend the entire ~520k-chunk pass encoding
noise, and every retrieval result would be scored against polluted vectors.

Why paragraph indices survive: the margin letters are single-newline separated, so
they sit INSIDE a paragraph rather than forming their own. The stripper deletes each
line including its newline — blanking it in place would leave an empty line, and an
empty line IS a paragraph boundary, which would split a paragraph and shift every
paragraph index after it, silently breaking the [dN¶M] provenance contract.
That invariant is asserted per-document below, and a document that would change its
paragraph count is skipped rather than corrupted.

Run:  uv run --with duckdb python3 scripts/ingest/normalise_text.py --db data/lex.db
"""

import argparse
import os
import re
import sqlite3
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from text import chunk_paragraphs, paragraphs  # noqa: E402

DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")
PAGE_FURNITURE = re.compile(r"^[A-H][ \t]*\n", re.MULTILINE)


def strip_page_furniture(text: str) -> str:
    return PAGE_FURNITURE.sub("", text)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db, timeout=120)

    q = "SELECT cnr, text, n_paras, n_chars FROM doc_text"
    if args.limit:
        q += f" LIMIT {args.limit}"
    rows = db.execute(q).fetchall()
    print(f"documents to inspect: {len(rows):,}", flush=True)

    scanned = changed = skipped = 0
    lines_removed = chars_removed = 0
    rechunked = 0

    for cnr, blob, old_paras, old_chars in rows:
        scanned += 1
        text = zlib.decompress(blob).decode("utf-8", errors="ignore")
        cleaned = strip_page_furniture(text)
        if cleaned == text:
            continue

        before = paragraphs(text)
        after = paragraphs(cleaned)
        if len(after) != len(before):
            # Would shift ¶ indices — refuse. Provenance correctness beats tidiness.
            skipped += 1
            print(f"  SKIP {cnr}: paragraph count would change {len(before)} -> {len(after)}")
            continue

        lines_removed += text.count("\n") - cleaned.count("\n")
        chars_removed += len(text) - len(cleaned)
        changed += 1
        if args.dry_run:
            continue

        db.execute(
            "UPDATE doc_text SET text = ?, n_paras = ?, n_chars = ? WHERE cnr = ?",
            (zlib.compress(cleaned.encode("utf-8"), 6), len(after), len(cleaned), cnr),
        )
        db.execute("DELETE FROM chunks WHERE cnr = ?", (cnr,))
        for ord_, (ps, pe, ctext) in enumerate(chunk_paragraphs(after)):
            db.execute(
                "INSERT OR REPLACE INTO chunks "
                "(id, cnr, ord, para_start, para_end, n_chars) VALUES (?,?,?,?,?,?)",
                (f"{cnr}:{ord_}", cnr, ord_, ps, pe, len(ctext)),
            )
            rechunked += 1
        if changed % 500 == 0:
            db.commit()
            print(f"  {scanned:,} scanned · {changed:,} cleaned · "
                  f"{chars_removed / 1e6:.1f} MB of noise removed", flush=True)

    if not args.dry_run:
        db.commit()

    print(f"\nscanned   : {scanned:,}")
    print(f"cleaned   : {changed:,} ({100 * changed / max(scanned, 1):.1f}%)")
    print(f"skipped   : {skipped:,} (paragraph count would have shifted)")
    print(f"junk lines removed: {lines_removed:,}")
    print(f"noise removed     : {chars_removed / 1e6:.2f} MB")
    print(f"chunks rebuilt    : {rechunked:,}")
    if args.dry_run:
        print("\n(dry run — nothing written)")
    db.close()


if __name__ == "__main__":
    main()
