"""Build the judgment spine: authoritative metadata for the whole corpus, no text.

Reads the AWS Open Data eCourts metadata parquet — partitioned year/court/bench,
updated daily — and writes a compact SQLite table. Deliberately excludes
full_text and raw_html: the spine is the join key and the filter surface, and it
has to stay small enough to hold the whole corpus on a laptop.

Two sources, one table:
  supreme_court  s3://indian-supreme-court-judgments/metadata/parquet/year=YYYY/
  high_courts    s3://indian-high-court-judgments/metadata/parquet/year=YYYY/court=*/bench=*/

The SC config carries a populated `citation` ([2023] 16 S.C.R. 872) which is what
makes the citation graph constructible; the HC config does not.

Run:  uv run --with duckdb python3 scripts/ingest/spine.py --years 2015-2024 [--sc-only]
"""

import argparse
import os
import re

import duckdb

SC_BASE = "https://indian-supreme-court-judgments.s3.amazonaws.com/metadata/parquet"
HC_BASE = "https://indian-high-court-judgments.s3.amazonaws.com/metadata/parquet"
DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")

SPINE_DDL = """
CREATE TABLE IF NOT EXISTS judgments (
  cnr           TEXT PRIMARY KEY,
  bucket        TEXT NOT NULL,           -- 'sc' | 'hc'
  court_code    TEXT NOT NULL DEFAULT '',
  bench         TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  judge         TEXT NOT NULL DEFAULT '',
  citation      TEXT NOT NULL DEFAULT '',
  decision_date INTEGER NOT NULL DEFAULT 0, -- yyyymmdd, 0 when unknown
  year          INTEGER,
  disposal      TEXT NOT NULL DEFAULT '',
  src_path      TEXT NOT NULL DEFAULT '',  -- SC only: PDF stem, e.g. 2023_10_101_116
  has_text      INTEGER NOT NULL DEFAULT 0,
  gated         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_judgments_date  ON judgments(decision_date);
CREATE INDEX IF NOT EXISTS idx_judgments_court ON judgments(court_code, year);
"""
# pdf_link is dropped on purpose: it is reconstructible as
# court/cnrorders/{bench}/orders/{cnr}_{order}_{date}.pdf, and pdf_exists was
# false for every row sampled, so the PDF layer is not dependable anyway.
# At ~17.8M rows every retained byte per row costs ~18 MB of disk.


def parse_years(spec: str) -> list[int]:
    if "-" in spec:
        lo, hi = spec.split("-", 1)
        return list(range(int(lo), int(hi) + 1))
    return [int(y) for y in spec.split(",")]


def connect(db_path: str) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute("SET enable_progress_bar=false")
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    con.execute(f"ATTACH '{db_path}' AS lex (TYPE SQLITE)")
    con.execute("USE lex")
    for stmt in filter(str.strip, SPINE_DDL.split(";")):
        con.execute(stmt)
    con.execute("USE memory")
    return con


def iso(expr: str) -> str:
    """eCourts dates arrive as '30-11-2023', ISO strings, or TIMESTAMP.
    Normalise to an INTEGER yyyymmdd — 4 bytes instead of a 10-char string, and
    still directly comparable, which is all lib/validity.ts needs."""
    return f"""
      CASE
        WHEN {expr} IS NULL THEN 0
        WHEN try_cast({expr} AS DATE) IS NOT NULL
          THEN CAST(strftime(try_cast({expr} AS DATE), '%Y%m%d') AS INTEGER)
        WHEN regexp_matches(CAST({expr} AS VARCHAR), '^\\d{{1,2}}-\\d{{1,2}}-\\d{{4}}$')
          THEN CAST(strftime(strptime(CAST({expr} AS VARCHAR), '%d-%m-%Y'), '%Y%m%d') AS INTEGER)
        ELSE 0
      END"""


def ingest_sc(con: duckdb.DuckDBPyConnection, years: list[int]) -> int:
    total = 0
    for y in years:
        url = f"{SC_BASE}/year={y}/metadata.parquet"
        try:
            # Partition-level replace: DuckDB's SQLite writer has no upsert, so
            # clear the partition first. Makes re-runs idempotent.
            con.execute(f"DELETE FROM lex.judgments WHERE bucket = 'sc' AND year = {y}")
            con.execute(f"""
                INSERT INTO lex.judgments
                  (cnr, bucket, court_code, bench, title, judge, citation,
                   decision_date, year, disposal, src_path, has_text, gated)
                SELECT
                  any_value(cnr), 'sc', 'SC', '',
                  any_value(coalesce(title, '')), any_value(coalesce(judge, '')),
                  any_value(coalesce(citation, '')),
                  any_value({iso('decision_date')}), {y},
                  any_value(coalesce(disposal_nature, '')),
                  any_value(coalesce(path, '')), 0, 0
                FROM '{url}'
                WHERE cnr IS NOT NULL AND cnr <> ''
                GROUP BY cnr
            """)
            n = con.execute(f"SELECT count(*) FROM '{url}'").fetchone()[0]
            total += n
            print(f"  sc {y}: {n:>7,}")
        except duckdb.Error as e:
            print(f"  sc {y}: skipped ({str(e).splitlines()[0][:70]})")
    return total


def list_hc_partitions(year: int) -> list[tuple[str, str]]:
    """S3 list the court/bench partitions for a year (paginated)."""
    import urllib.request

    out, token = [], None
    while True:
        url = (
            "https://indian-high-court-judgments.s3.amazonaws.com/?list-type=2"
            f"&prefix=metadata/parquet/year={year}/"
        )
        if token:
            url += f"&continuation-token={urllib.parse.quote(token, safe='')}"
        body = urllib.request.urlopen(url).read().decode()
        for key in re.findall(r"<Key>(.*?)</Key>", body):
            m = re.search(r"court=([^/]+)/bench=([^/]+)/metadata\.parquet$", key)
            if m:
                out.append((m.group(1), m.group(2)))
        if "<IsTruncated>true</IsTruncated>" not in body:
            break
        m = re.search(r"<NextContinuationToken>(.*?)</NextContinuationToken>", body)
        if not m:
            break
        token = m.group(1)
    return out


def free_gb(path: str) -> float:
    st = os.statvfs(os.path.dirname(os.path.abspath(path)) or ".")
    return st.f_bavail * st.f_frsize / 1e9


BATCH = 25  # partitions per query — lets DuckDB fetch them in parallel


def ingest_hc(con: duckdb.DuckDBPyConnection, years: list[int], courts: set[str] | None,
              db_path: str, floor_gb: float) -> int:
    total = 0
    for y in years:
        parts = list_hc_partitions(y)
        if courts:
            parts = [p for p in parts if p[0] in courts]
        if not parts:
            continue
        if free_gb(db_path) < floor_gb:
            print(f"  !! stopping at {y}: free disk below {floor_gb} GB")
            break

        con.execute(f"DELETE FROM lex.judgments WHERE bucket = 'hc' AND year = {y}")
        year_n = 0
        # Batch the partitions into one read_parquet(list) so the remote fetches
        # overlap instead of running 1,493 round-trips back to back.
        for i in range(0, len(parts), BATCH):
            batch = parts[i : i + BATCH]
            urls = ", ".join(
                f"'{HC_BASE}/year={y}/court={c}/bench={b}/metadata.parquet'" for c, b in batch
            )
            try:
                # Stage, then clear conflicts, then insert. A CNR recurs across
                # years when a case draws orders in more than one, and the
                # cnr PRIMARY KEY would reject the second insert.
                con.execute("DROP TABLE IF EXISTS stg")
                con.execute(f"""
                    CREATE TEMP TABLE stg AS
                    SELECT
                      any_value(cnr) AS cnr, 'hc' AS bucket,
                      any_value(regexp_extract(filename, 'court=([^/]+)', 1)) AS court_code,
                      any_value(regexp_extract(filename, 'bench=([^/]+)', 1)) AS bench,
                      any_value(coalesce(title, '')) AS title,
                      any_value(coalesce(judge, '')) AS judge,
                      '' AS citation,
                      any_value({iso('decision_date')}) AS decision_date,
                      {y} AS year,
                      any_value(coalesce(disposal_nature, '')) AS disposal,
                      '' AS src_path,
                      0 AS has_text, 0 AS gated
                    FROM read_parquet([{urls}], union_by_name=true, filename=true)
                    WHERE cnr IS NOT NULL AND cnr <> ''
                    GROUP BY cnr
                """)
                con.execute(
                    "DELETE FROM lex.judgments WHERE cnr IN (SELECT cnr FROM stg)"
                )
                con.execute("INSERT INTO lex.judgments SELECT * FROM stg")
                year_n = con.execute(
                    f"SELECT count(*) FROM lex.judgments WHERE bucket='hc' AND year={y}"
                ).fetchone()[0]
            except duckdb.Error as e:
                print(f"    batch {i // BATCH}: skipped ({str(e).splitlines()[0][:70]})")
        total += year_n
        print(f"  hc {y}: {year_n:>8,} rows / {len(parts):>3} benches "
              f"(free {free_gb(db_path):.1f} GB)", flush=True)
    return total


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2015-2024")
    ap.add_argument("--sc-only", action="store_true")
    ap.add_argument("--courts", default="", help="comma-separated court_code filter, e.g. 10_8,26_1")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--floor-gb", type=float, default=1.5,
                    help="stop ingesting when free disk drops below this")
    args = ap.parse_args()

    years = parse_years(args.years)
    courts = set(filter(None, args.courts.split(","))) or None
    con = connect(args.db)

    print(f"spine → {args.db}  years={years[0]}..{years[-1]}  free={free_gb(args.db):.1f} GB")
    n = ingest_sc(con, years)
    if not args.sc_only:
        n += ingest_hc(con, years, courts, args.db, args.floor_gb)

    have = con.execute("SELECT count(*) FROM lex.judgments").fetchone()[0]
    dated = con.execute(
        "SELECT count(*) FROM lex.judgments WHERE decision_date > 0"
    ).fetchone()[0]
    size = os.path.getsize(args.db) / 1e6 if os.path.exists(args.db) else 0
    print(f"\nspine rows={have:,} (this run touched {n:,})")
    print(f"with usable decision_date: {dated:,} ({100 * dated / max(have, 1):.2f}%)")
    print(f"db size: {size:.1f} MB  →  {size * 1e6 / max(have, 1):.0f} bytes/row")


if __name__ == "__main__":
    main()
