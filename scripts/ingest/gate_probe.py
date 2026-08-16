"""Measure the relevance gate before we size the index.

Streams one high_courts split from HF with DuckDB and evaluates the gate as a
pure SQL aggregate — the full_text column is scanned remotely and never stored
locally. Answers one question: of 1.46M judgments, how many can the temporal-
validity engine actually say anything about?

The gate is not a shortcut. lib/validity.ts returns grey for any judgment whose
text yields no provision in data/mappings.json, so a judgment citing none of the
mapped acts is provably incapable of producing a red or amber flag.

Run:  uv run --with duckdb python3 scripts/ingest/gate_probe.py
"""

import duckdb

SPLIT = "hf://datasets/overthelex/indian-court-decisions/high_courts/test.parquet"

# Mirrors ACT_ALIASES in lib/validity.ts. Case-insensitive, whitespace-tolerant.
ACTS = {
    "specific_relief": r"specific\s+relief\s+act",
    "commercial_courts": r"commercial\s+courts\s+act",
    "arbitration": r"arbitration\s+(and|&)\s+conciliation\s+act",
    "evidence": r"(indian\s+)?evidence\s+act",
    "bsa": r"(bharatiya\s+)?sakshya\s+adhiniyam",
}

# Mirrors DISTINCTIVE_SECTIONS — attributable without an adjacent act name.
SECTIONS = {
    "s_65b": r"[Ss]ection\s+65\s*-?\s*B|[Ss]\.\s*65\s*-?\s*B",
    "s_12a": r"[Ss]ection\s+12\s*-?\s*A|[Ss]\.\s*12\s*-?\s*A",
    "s_29a": r"[Ss]ection\s+29\s*-?\s*A|[Ss]\.\s*29\s*-?\s*A",
}


def hit(pattern: str) -> str:
    return f"regexp_matches(full_text, '(?i){pattern}')"


def main() -> None:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET enable_progress_bar=false")

    any_act = " OR ".join(hit(p) for p in ACTS.values())
    any_sec = " OR ".join(hit(p) for p in SECTIONS.values())

    per_act = ",\n        ".join(
        f"sum(CASE WHEN {hit(p)} THEN 1 ELSE 0 END) AS {name}" for name, p in ACTS.items()
    )
    per_sec = ",\n        ".join(
        f"sum(CASE WHEN {hit(p)} THEN 1 ELSE 0 END) AS {name}" for name, p in SECTIONS.items()
    )

    print("scanning split (full_text streamed, not stored) …")
    row = con.execute(f"""
        SELECT
        count(*) AS total,
        {per_act},
        {per_sec},
        sum(CASE WHEN {any_act} THEN 1 ELSE 0 END) AS any_act,
        sum(CASE WHEN ({any_act}) OR ({any_sec}) THEN 1 ELSE 0 END) AS gate_loose,
        sum(CASE WHEN (({any_act}) OR ({any_sec})) AND decision_date >= '2015-01-01' THEN 1 ELSE 0 END) AS gate_2015,
        sum(CASE WHEN (({any_act}) OR ({any_sec})) AND decision_date >= '2015-01-01'
                 THEN text_length ELSE 0 END) AS gate_2015_chars
        FROM '{SPLIT}'
    """).fetchone()

    cols = (
        ["total"] + list(ACTS) + list(SECTIONS)
        + ["any_act", "gate_loose", "gate_2015", "gate_2015_chars"]
    )
    r = dict(zip(cols, row))
    total = r["total"]

    def pct(n: int) -> str:
        return f"{n:>9,}  ({100 * n / total:5.2f}%)"

    print(f"\ntotal rows{'':>14}{total:>9,}")
    print("\n-- per mapped act --")
    for k in ACTS:
        print(f"{k:>22}  {pct(r[k])}")
    print("\n-- distinctive sections --")
    for k in SECTIONS:
        print(f"{k:>22}  {pct(r[k])}")
    print("\n-- gate variants --")
    print(f"{'any mapped act':>22}  {pct(r['any_act'])}")
    print(f"{'act OR section':>22}  {pct(r['gate_loose'])}")
    print(f"{'+ date >= 2015':>22}  {pct(r['gate_2015'])}")
    chars = r["gate_2015_chars"] or 0
    print(f"\ntext kept by gate_2015: {chars / 1e9:.2f} GB raw")
    print(f"extrapolated to full 14.6M corpus: ~{r['gate_2015'] * 10.0:,.0f} docs, "
          f"~{chars * 10.0 / 1e9:.1f} GB raw text")

    print("\n-- what kinds of cases cite these acts? (top case-type prefixes) --")
    for ct, n in con.execute(f"""
        SELECT regexp_extract(title, '^([A-Za-z\\.\\s]+)', 1) AS case_type, count(*) c
        FROM '{SPLIT}'
        WHERE ({any_act}) OR ({any_sec})
        GROUP BY 1 ORDER BY c DESC LIMIT 12
    """).fetchall():
        label = (ct or "").strip() or "(blank)"
        print(f"{label[:38]:>40}  {n:>7,}")


if __name__ == "__main__":
    main()
