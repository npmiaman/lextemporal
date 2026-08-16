"""Export the derived corpus to parquet, and optionally push it to a HF dataset repo.

The storage strategy has three tiers, and only the middle one needs a decision:

  COLD   AWS Open Data + HF source parquet. Already remote, already free, already
         queryable in place with DuckDB range requests. We never store it.
  WARM   Our derived artefacts — spine, amendments, chunks, vectors. This script
         writes them as parquet (far smaller than SQLite: no page overhead, no
         indexes, columnar compression) and can push them to the Hub.
  HOT    data/lex.db, holding only the gated working set the app reads per request.

Exporting the spine to parquet and keeping only the gated subset locally is what
takes the laptop footprint from ~3.6 GB to a few hundred MB.

Push requires HF_TOKEN (a write token from huggingface.co/settings/tokens).
Without it, this still writes the parquet locally and tells you what it would push.

Run:  uv run --with duckdb python3 scripts/ingest/publish.py --out data/export
      HF_TOKEN=hf_xxx uv run --with duckdb --with huggingface_hub python3 \
        scripts/ingest/publish.py --out data/export --repo <user>/lextemporal-corpus
"""

import argparse
import os

import duckdb

DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")

# Tables worth publishing, and why. chunks/doc_text are excluded by default —
# they are large and rebuildable from the gate, so they are opt-in via --with-text.
TABLES = ["judgments", "acts", "amendments"]
TEXT_TABLES = ["doc_text", "chunks"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--out", default="data/export")
    ap.add_argument("--repo", default="", help="HF dataset repo, e.g. user/lextemporal-corpus")
    ap.add_argument("--with-text", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute("SET enable_progress_bar=false")
    con.execute(f"ATTACH '{args.db}' AS lex (TYPE SQLITE)")

    tables = TABLES + (TEXT_TABLES if args.with_text else [])
    total_sqlite = os.path.getsize(args.db)
    written = []
    for t in tables:
        try:
            n = con.execute(f"SELECT count(*) FROM lex.{t}").fetchone()[0]
        except duckdb.Error:
            print(f"  {t}: absent, skipped")
            continue
        if n == 0:
            print(f"  {t}: empty, skipped")
            continue
        path = os.path.join(args.out, f"{t}.parquet")
        con.execute(
            f"COPY (SELECT * FROM lex.{t}) TO '{path}' "
            f"(FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)"
        )
        size = os.path.getsize(path)
        written.append((t, n, size))
        print(f"  {t}: {n:>10,} rows → {size / 1e6:>8.1f} MB")

    out_total = sum(s for _, _, s in written)
    print(f"\nsqlite {total_sqlite / 1e9:.2f} GB → parquet {out_total / 1e9:.2f} GB "
          f"({total_sqlite / max(out_total, 1):.1f}x smaller)")

    if not args.repo:
        print("\nno --repo given; parquet written locally only.")
        return

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token:
        print(f"\nHF_TOKEN not set — cannot push to {args.repo}.")
        print("Create a write token at https://huggingface.co/settings/tokens, then re-run.")
        return

    from huggingface_hub import HfApi

    api = HfApi(token=token)
    api.create_repo(args.repo, repo_type="dataset", exist_ok=True, private=True)
    for t, _, _ in written:
        api.upload_file(
            path_or_fileobj=os.path.join(args.out, f"{t}.parquet"),
            path_in_repo=f"{t}.parquet",
            repo_id=args.repo,
            repo_type="dataset",
        )
        print(f"  pushed {t}.parquet")
    print(f"\ndone → https://huggingface.co/datasets/{args.repo}")
    print("read it back with:  SELECT * FROM 'hf://datasets/%s/judgments.parquet'" % args.repo)


if __name__ == "__main__":
    main()
