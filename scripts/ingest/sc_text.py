"""Supreme Court full text, extracted from the AWS PDFs.

Closes the largest gap in the corpus. The HF SC text config is OCR'd Supreme
Court Reports volumes — garbled, and effectively empty after 2010 (one to five
documents a year, ~2,700 chars each, which are headnote fragments rather than
judgments). Modern SC authority is the most citable material in Indian
commercial litigation, so it cannot be missing.

The AWS PDFs are digitally born and extract cleanly:
    [2023] 10 S.C.R. 101 : 2023 INSC 590
    SANTHOSH MAIZE & INDUSTRIES LIMITED v. THE STATE OF TAMIL NADU & ANR.

Nothing is kept on disk but the compressed text: each PDF is fetched into
memory, extracted, deflated, stored, and dropped. ~22.5k judgments land in
roughly 170 MB instead of 6.8 GB of PDFs.

The join key is the spine's src_path (SC metadata `path`), which is also the
PDF filename stem — the same identifier the HF SC config uses as its cnr.

Run:  uv run --with duckdb --with pypdf python3 scripts/ingest/sc_text.py
"""

import argparse
import io
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from text import TEXT_DDL, chunk_paragraphs, paragraphs  # noqa: E402

PDF_BASE = "https://indian-supreme-court-judgments.s3.amazonaws.com/data/pdf"
DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")


def pdf_url(year: int, src_path: str) -> str:
    stem = src_path if src_path.endswith("_EN") else f"{src_path}_EN"
    return f"{PDF_BASE}/year={year}/english/{stem}.pdf"


def normalise(text: str) -> str:
    """Light touch only. PDF extraction leaves intra-word gaps ('t hrough',
    'mill ets') that cannot be repaired without a dictionary and would risk
    corrupting statute names, so they are left alone. lib/validity.ts already
    tolerates spaced section numbers ('65 - B')."""
    text = text.replace("\r\n", "\n").replace("\xa0", " ")
    text = strip_page_furniture(text)
    text = re.sub(r"-\n([a-z])", r"\1", text)      # de-hyphenate across line breaks
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# Supreme Court Reports pages carry margin line-guides A–H down the left edge,
# which pdf extraction emits as standalone single-letter lines. Measured on a
# random 40-doc sample: 13 docs affected, ~225 such lines each. They are pure
# noise in embedded chunk text and in provenance quotes.
#
# Only A–H alone on a line is removed. Standalone digits are left: they are
# ambiguous between page numbers and paragraph numbers, and dropping a real
# paragraph number would corrupt the ¶ contract that provenance depends on.
#
# The line is deleted INCLUDING its newline. Blanking the letter in place would
# leave an empty line, and an empty line IS a paragraph boundary — that would
# split a paragraph in two and shift every ¶ index after it, silently breaking
# the provenance contract that app/api/provenance/route.ts depends on.
PAGE_FURNITURE = re.compile(r"^[A-H][ \t]*\n", re.MULTILINE)


def strip_page_furniture(text: str) -> str:
    return PAGE_FURNITURE.sub("", text)


def fetch_and_extract(job: tuple[str, int, str]) -> tuple[str, str] | None:
    from pypdf import PdfReader

    cnr, year, src_path = job
    try:
        raw = urllib.request.urlopen(pdf_url(year, src_path), timeout=90).read()
        reader = PdfReader(io.BytesIO(raw))
        text = "\n\n".join((p.extract_text() or "") for p in reader.pages)
    except (urllib.error.HTTPError, urllib.error.URLError, OSError, Exception) as e:
        return (cnr, f"__ERR__{type(e).__name__}")
    return (cnr, normalise(text))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--since", type=int, default=0, help="only years >= this")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()

    db = sqlite3.connect(args.db, timeout=60)
    db.executescript(TEXT_DDL)

    q = ("SELECT cnr, year, src_path FROM judgments "
         "WHERE bucket='sc' AND src_path <> '' AND has_text = 0")
    if args.since:
        q += f" AND year >= {args.since}"
    q += " ORDER BY year DESC"
    if args.limit:
        q += f" LIMIT {args.limit}"
    jobs = db.execute(q).fetchall()
    print(f"SC judgments needing text: {len(jobs):,}", flush=True)
    if not jobs:
        print("nothing to do — has_text already set, or run spine.py --sc-only first")
        return

    ok = failed = n_chunks = 0
    raw_total = stored_total = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, res in enumerate(pool.map(fetch_and_extract, jobs), start=1):
            if res is None:
                failed += 1
                continue
            cnr, text = res
            if text.startswith("__ERR__") or len(text) < 500:
                failed += 1
                continue
            paras = paragraphs(text)
            blob = zlib.compress(text.encode("utf-8"), 6)
            db.execute(
                "INSERT OR REPLACE INTO doc_text (cnr, text, n_paras, n_chars, ingested_at) "
                "VALUES (?, ?, ?, ?, datetime('now'))",
                (cnr, blob, len(paras), len(text)),
            )
            db.execute("DELETE FROM chunks WHERE cnr = ?", (cnr,))
            for ord_, (ps, pe, ctext) in enumerate(chunk_paragraphs(paras)):
                db.execute(
                    "INSERT OR REPLACE INTO chunks "
                    "(id, cnr, ord, para_start, para_end, n_chars) VALUES (?,?,?,?,?,?)",
                    (f"{cnr}:{ord_}", cnr, ord_, ps, pe, len(ctext)),
                )
                n_chunks += 1
            db.execute("UPDATE judgments SET has_text = 1 WHERE cnr = ?", (cnr,))
            ok += 1
            raw_total += len(text)
            stored_total += len(blob)
            if i % 200 == 0:
                db.commit()
                print(f"  {i:,}/{len(jobs):,}  ok={ok:,} failed={failed:,}  "
                      f"{raw_total / 1e6:.0f} MB raw → {stored_total / 1e6:.0f} MB stored",
                      flush=True)
    db.commit()

    print(f"\nextracted {ok:,} judgments ({failed:,} failed), {n_chunks:,} chunks")
    if ok:
        print(f"avg {raw_total / ok / 1000:.1f}k chars/judgment")
        print(f"compression: {raw_total / 1e6:.0f} MB → {stored_total / 1e6:.0f} MB "
              f"({raw_total / max(stored_total, 1):.1f}x)")
    db.close()


if __name__ == "__main__":
    main()
