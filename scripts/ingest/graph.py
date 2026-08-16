"""Build the retrieval graph: provision edges and citation edges.

GraphRAG needs a graph that actually exists. Two edge types are recoverable from
what we hold:

  judgment_provisions   (cnr, act, section)
      Which statutory provisions a judgment relies on. Mirrors extractProvisions()
      in lib/validity.ts so graph expansion and flag computation agree about what
      a judgment cites. This is what lets a query about S.12A reach judgments that
      never use the phrase "pre-institution mediation".

  citation_edges        (src_cnr, dst_cnr, raw)
      Which judgments cite which. The HC metadata has no citation field at all,
      but citations are in the TEXT, and the SC `citation` column is populated for
      100% of SC rows — so HC->SC edges resolve exactly. Measured on a 120k
      sample: SCC 6.70%, neutral 3.99%, AIR 3.15%.

Run:  uv run python3 scripts/ingest/graph.py --db data/lex.db
"""

import argparse
import os
import re
import sqlite3
import zlib

DB_PATH = os.environ.get("LEX_DB_PATH", "data/lex.db")

GRAPH_DDL = """
CREATE TABLE IF NOT EXISTS judgment_provisions (
  cnr     TEXT NOT NULL,
  act     TEXT NOT NULL,
  section TEXT NOT NULL,
  PRIMARY KEY (cnr, act, section)
);
CREATE INDEX IF NOT EXISTS idx_jp_prov ON judgment_provisions(act, section);
CREATE TABLE IF NOT EXISTS citation_edges (
  src_cnr TEXT NOT NULL,
  dst_cnr TEXT NOT NULL,
  raw     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (src_cnr, dst_cnr)
);
CREATE INDEX IF NOT EXISTS idx_cite_dst ON citation_edges(dst_cnr);
"""

# ---------------------------------------------------------------------------
# Provisions — keep in lockstep with ACT_ALIASES / DISTINCTIVE_SECTIONS in
# lib/validity.ts. Divergence here shows up as a judgment that the graph reaches
# but the flag engine has no opinion about.
# ---------------------------------------------------------------------------
ACT_ALIASES = {
    "Specific Relief Act 1963": [r"specific\s+relief\s+act"],
    "Commercial Courts Act 2015": [r"commercial\s+courts\s+act"],
    "Arbitration and Conciliation Act 1996": [r"arbitration\s+(?:and|&)\s+conciliation\s+act"],
    "Indian Evidence Act 1872": [r"(?:indian\s+)?evidence\s+act"],
    "Bharatiya Sakshya Adhiniyam 2023": [r"(?:bharatiya\s+)?sakshya\s+adhiniyam"],
}
DISTINCTIVE = {"65B": "Indian Evidence Act 1872", "65A": "Indian Evidence Act 1872",
               "12A": "Commercial Courts Act 2015", "29A": "Arbitration and Conciliation Act 1996"}

# No IGNORECASE — same defect as lib/validity.ts carried: under /i the
# `[A-Z]{0,2}` suffix class also matches lowercase, so "Sections 45 and 65B"
# parsed as "45 an" and lost 65B. Case tolerance goes in the keyword classes.
SECTION_LIST = re.compile(
    r"\b(?:[Ss]ections?|[Ss]ec\.?|[Ss]\.)\s*((?:\d+\s*-?\s*[A-Z]{0,2})"
    r"(?:\s*(?:,|[Aa]nd|&|/|[Rr]ead with|[Rr]/[Ww])\s*"
    r"(?:[Ss]ections?\s*|[Ss]ec\.?\s*|[Ss]\.\s*)?\d+\s*-?\s*[A-Z]{0,2})*)"
)


def section_tokens(s: str) -> list[str]:
    joined = re.sub(r"(\d)\s*-?\s*([A-Z])", r"\1\2", s)
    return list(dict.fromkeys(re.findall(r"\d+[A-Z]{0,2}", joined)))


def extract_provisions(text: str) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    # Act alias present -> look back for the nearest section list.
    for canonical, pats in ACT_ALIASES.items():
        for pat in pats:
            for m in re.finditer(pat, text, re.IGNORECASE):
                window = text[max(0, m.start() - 120) : m.start()]
                lists = list(SECTION_LIST.finditer(window))
                if lists and len(window) - lists[-1].end() < 60:
                    for s in section_tokens(lists[-1].group(1)):
                        found.add((canonical, s.upper()))
    # Distinctive sections attributable without an adjacent act name.
    for m in SECTION_LIST.finditer(text):
        for s in section_tokens(m.group(1)):
            owner = DISTINCTIVE.get(s.upper())
            if owner:
                found.add((owner, s.upper()))
    return found


# ---------------------------------------------------------------------------
# Citations
# ---------------------------------------------------------------------------
CITE_PATTERNS = [
    ("scc", re.compile(r"\(\s*(\d{4})\s*\)\s*(\d+)\s*SCC\s*(\d+)")),
    ("scr", re.compile(r"\[\s*(\d{4})\s*\]\s*(\d+)\s*S\.?\s?C\.?\s?R\.?\s*(\d+)")),
    ("insc", re.compile(r"(\d{4})\s*INSC\s*(\d+)", re.IGNORECASE)),
    ("air", re.compile(r"AIR\s*(\d{4})\s*SC\s*(\d+)", re.IGNORECASE)),
]


def norm_scr(year: str, vol: str, page: str) -> str:
    return f"[{year}] {vol} S.C.R. {page}"


def build_sc_citation_index(db: sqlite3.Connection) -> dict[str, str]:
    """citation string -> cnr, for SC rows. `citation` is 100% populated there."""
    idx: dict[str, str] = {}
    for cnr, cit in db.execute(
        "SELECT cnr, citation FROM judgments WHERE bucket='sc' AND citation <> ''"
    ):
        key = re.sub(r"\s+", " ", cit).strip().upper()
        idx[key] = cnr
        m = re.match(r"\[(\d{4})\]\s*(\d+)\s*S\.?C\.?R\.?\s*(\d+)", key)
        if m:
            idx[norm_scr(*m.groups()).upper()] = cnr
    return idx


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    db = sqlite3.connect(args.db, timeout=120)
    db.executescript(GRAPH_DDL)

    sc_idx = build_sc_citation_index(db)
    print(f"SC citation index: {len(sc_idx):,} keys", flush=True)

    q = "SELECT cnr, text FROM doc_text"
    if args.limit:
        q += f" LIMIT {args.limit}"

    n_docs = n_prov = n_cite = 0
    unresolved = 0
    for cnr, blob in db.execute(q):
        text = zlib.decompress(blob).decode("utf-8", errors="ignore")
        for act, sec in extract_provisions(text):
            db.execute(
                "INSERT OR IGNORE INTO judgment_provisions (cnr, act, section) VALUES (?,?,?)",
                (cnr, act, sec),
            )
            n_prov += 1
        for kind, pat in CITE_PATTERNS:
            for m in pat.finditer(text):
                if kind == "scr":
                    key = norm_scr(*m.groups()).upper()
                elif kind == "scc":
                    key = f"({m.group(1)}) {m.group(2)} SCC {m.group(3)}".upper()
                else:
                    key = re.sub(r"\s+", " ", m.group(0)).strip().upper()
                dst = sc_idx.get(key)
                if dst and dst != cnr:
                    db.execute(
                        "INSERT OR IGNORE INTO citation_edges (src_cnr, dst_cnr, raw) VALUES (?,?,?)",
                        (cnr, dst, m.group(0)[:80]),
                    )
                    n_cite += 1
                elif not dst:
                    unresolved += 1
        n_docs += 1
        if n_docs % 2000 == 0:
            db.commit()
            print(f"  {n_docs:,} docs · {n_prov:,} provision edges · "
                  f"{n_cite:,} citation edges", flush=True)
    db.commit()

    p = db.execute("SELECT count(*) FROM judgment_provisions").fetchone()[0]
    c = db.execute("SELECT count(*) FROM citation_edges").fetchone()[0]
    print(f"\ndocs scanned: {n_docs:,}")
    print(f"provision edges: {p:,}")
    print(f"citation edges: {c:,}  (unresolved citation strings: {unresolved:,})")
    print("\ntop provisions:")
    for act, sec, n in db.execute(
        "SELECT act, section, count(*) n FROM judgment_provisions GROUP BY 1,2 ORDER BY n DESC LIMIT 10"
    ):
        print(f"   {act[:38]:<40} S.{sec:<5} {n:>7,}")
    db.close()


if __name__ == "__main__":
    main()
