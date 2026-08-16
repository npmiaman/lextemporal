"""Mine the statute-change graph: which provision changed, when it commenced, how.

Indian statutes carry their own amendment history as footnotes in a highly
regular register:

    Subs. by Act 18 of 2018, s. 3, for section 10 (w.e.f. 1-10-2018).
    Ins. by Act 3 of 2016, s. 4 (w.e.f. 23-10-2015).
    Omitted by Act 4 of 2015, s. 2 (w.e.f. 1-4-2015).

That is exactly the shape data/mappings.json encodes by hand — act, provision,
change type, commencement date, and the amending instrument. This extracts it
for all 883 central Acts.

IMPORTANT — mined rows are NOT hand-verified. They land in `amendments` with
verified=0 and must never be presented with the confidence of data/mappings.json.
lib/validity.ts flags grey when a provision is outside the verified graph, and
that behaviour is deliberate: a legal tool that silently upgrades scraped text
to "verified" is worse than one that says it does not know.

Run:  uv run --with duckdb python3 scripts/ingest/statutes.py
"""

import argparse
import os
import re

import duckdb

ACTS = "hf://datasets/geekyrakshit/indian-legal-acts/data/central-00000-of-00001.parquet"
DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")

STATUTE_DDL = """
CREATE TABLE IF NOT EXISTS acts (
  act_id         TEXT PRIMARY KEY,
  short_title    TEXT NOT NULL,
  act_number     TEXT NOT NULL DEFAULT '',
  enactment_date TEXT NOT NULL DEFAULT '',
  entity         TEXT NOT NULL DEFAULT '',
  source_url     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS amendments (
  id            TEXT PRIMARY KEY,
  act_id        TEXT NOT NULL,
  act_title     TEXT NOT NULL,
  provision     TEXT NOT NULL DEFAULT '',
  provision_source TEXT NOT NULL DEFAULT 'none',  -- explicit | anchor | none
  change_type   TEXT NOT NULL,
  commencement  TEXT NOT NULL,
  amending_act  TEXT NOT NULL DEFAULT '',
  footnote      TEXT NOT NULL,
  verified      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_amend_act  ON amendments(act_id);
CREATE INDEX IF NOT EXISTS idx_amend_when ON amendments(commencement);
CREATE INDEX IF NOT EXISTS idx_amend_prov ON amendments(act_title, provision);
"""

# "Subs. by Act 18 of 2018, s. 3, for section 10 (w.e.f. 1-10-2018)"
#  ^verb        ^amending instrument + target       ^commencement
FOOTNOTE = re.compile(
    r"(?P<verb>Subs|Substituted|Ins|Inserted|Omitted|Added|Rep|Repealed)\.?\s+by\s+"
    r"(?P<body>.{0,160}?)"
    r"\(\s*w\.e\.f\.\s*(?P<date>\d{1,2}[-./]\d{1,2}[-./]\d{4})\s*\)",
    re.IGNORECASE | re.DOTALL,
)

# Explicit target: "... for section 10 ...", "... for sub-section (2) of section 16 ..."
TARGET = re.compile(
    r"for\s+(?:sub-section\s*\([^)]{1,6}\)\s*of\s*)?(?:sections?|ss?\.)\s*([0-9]+\s*-?\s*[A-Z]{0,2})",
    re.IGNORECASE,
)
# Fallback: the nearest section heading preceding the footnote. Most footnotes
# name the AMENDING act's section ("Act 18 of 2018, s. 3"), not the target — the
# target is implied by where the footnote is anchored in the Act's text.
HEADING = re.compile(r"(?:^|\n)\s*#{0,4}\s*(?:Section\s+)?([0-9]+\s*-?\s*[A-Z]{0,2})\s*\.\s+\S", re.IGNORECASE)
AMENDING = re.compile(r"(Act\s+\d+\s+of\s+\d{4})", re.IGNORECASE)

# India's oldest surviving central Acts date from the 1830s; commencements more
# than a couple of years ahead are drafting errors or OCR noise. Anything outside
# this window is dropped and counted, never silently kept.
YEAR_MIN, YEAR_MAX = 1836, 2030

VERB_TO_CHANGE = {
    "subs": "substitution",
    "substituted": "substitution",
    "ins": "insertion",
    "inserted": "insertion",
    "omitted": "omission",
    "added": "insertion",
    "rep": "repeal",
    "repealed": "repeal",
}


def iso(d: str) -> str:
    """Parse d-m-yyyy, rejecting impossible dates. The Act markdown is PDF-derived
    and OCR turns '1-9-1976' into '1-9-1076' often enough to matter."""
    m = re.match(r"(\d{1,2})[-./](\d{1,2})[-./](\d{4})", d)
    if not m:
        return ""
    day, mon, yr = (int(x) for x in m.groups())
    if not (1 <= mon <= 12 and 1 <= day <= 31):
        return ""
    if not (YEAR_MIN <= yr <= YEAR_MAX):
        return ""
    return f"{yr:04d}-{mon:02d}-{day:02d}"


def extract(markdown: str) -> tuple[list[dict], int]:
    """Returns (records, n_dropped_for_bad_date)."""
    out: list[dict] = []
    dropped = 0
    md = markdown or ""
    for m in FOOTNOTE.finditer(md):
        date = iso(m.group("date"))
        if not date:
            dropped += 1
            continue
        body = re.sub(r"\s+", " ", m.group("body")).strip()
        amending = AMENDING.search(body)

        tgt = TARGET.search(body)
        provision = tgt.group(1).replace(" ", "").upper() if tgt else ""
        if not provision:
            # Anchor fallback: nearest section heading in the 3k chars before it.
            window = md[max(0, m.start() - 3000) : m.start()]
            heads = HEADING.findall(window)
            if heads:
                provision = heads[-1].replace(" ", "").upper()

        out.append({
            "change_type": VERB_TO_CHANGE.get(m.group("verb").lower().rstrip("."), "amendment"),
            "commencement": date,
            "provision": provision,
            "provision_source": "explicit" if tgt else ("anchor" if provision else "none"),
            "amending_act": amending.group(1) if amending else "",
            "footnote": re.sub(r"\s+", " ", m.group(0)).strip()[:400],
        })
    return out, dropped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_PATH)
    args = ap.parse_args()

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute("SET enable_progress_bar=false")
    con.execute(f"ATTACH '{args.db}' AS lex (TYPE SQLITE)")
    con.execute("USE lex")
    for stmt in filter(str.strip, STATUTE_DDL.split(";")):
        con.execute(stmt)

    rows = con.execute(f"""
        SELECT "Short Title", "Act Number", "Enactment Date", "Entity", "View", "Markdown"
        FROM '{ACTS}'
    """).fetchall()
    print(f"central acts: {len(rows):,}")

    con.execute("DELETE FROM amendments WHERE verified = 0")
    con.execute("DELETE FROM acts")

    n_amend = 0
    n_dropped = 0
    with_history = 0
    by_type: dict[str, int] = {}
    earliest, latest = "9999", "0000"

    seen: set[str] = set()
    for title, number, enacted, entity, url, md in rows:
        base = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")[:80] or "act"
        act_id = base
        n = 1
        while act_id in seen:  # slugs truncate at 80 chars and can collide
            n += 1
            act_id = f"{base}-{n}"
        seen.add(act_id)
        con.execute(
            "INSERT INTO acts VALUES (?, ?, ?, ?, ?, ?)",
            [act_id, title or "", str(number or ""), str(enacted or ""), entity or "", url or ""],
        )
        found, dropped = extract(md)
        n_dropped += dropped
        if found:
            with_history += 1
        for i, a in enumerate(found):
            con.execute(
                "INSERT INTO amendments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                [f"{act_id}:{i}", act_id, title or "", a["provision"], a["provision_source"],
                 a["change_type"], a["commencement"], a["amending_act"], a["footnote"]],
            )
            n_amend += 1
            by_type[a["change_type"]] = by_type.get(a["change_type"], 0) + 1
            earliest = min(earliest, a["commencement"])
            latest = max(latest, a["commencement"])

    con.execute("USE memory")
    print(f"acts with extractable history: {with_history:,} / {len(rows):,}")
    print(f"amendment records: {n_amend:,}")
    print(f"dropped for impossible dates: {n_dropped:,}")
    print(f"commencement range: {earliest} .. {latest}")
    print("by change type:")
    for k, v in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {k:>14}  {v:>6,}")
    print("target provision resolved by:")
    for src, c in con.execute(
        "SELECT provision_source, count(*) FROM lex.amendments GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall():
        print(f"  {src:>14}  {c:>6,}  ({100 * c / max(n_amend, 1):.1f}%)")


if __name__ == "__main__":
    main()
