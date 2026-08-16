import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Single-file SQLite store: cache + audit + state. No ingested corpus.
// Tests pass ":memory:"; the app uses data/lex.db.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ik_search_cache (
  hash TEXT PRIMARY KEY,
  form_input TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ik_doc_cache (
  docid TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_cache (
  hash TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('system','lawyer')),
  action TEXT NOT NULL,
  object TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'v1'
);
CREATE TABLE IF NOT EXISTS mapping_overrides (
  mapping_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  filing TEXT NOT NULL DEFAULT '',
  agreement_date TEXT NOT NULL DEFAULT '',
  cause_date TEXT NOT NULL DEFAULT '',
  suit_date TEXT NOT NULL,
  relief TEXT NOT NULL DEFAULT '',
  key_evidence TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pinned_docs (
  matter_id INTEGER NOT NULL,
  docid TEXT NOT NULL,
  title TEXT NOT NULL,
  court TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  flag_color TEXT NOT NULL DEFAULT 'grey',
  added_at TEXT NOT NULL,
  PRIMARY KEY (matter_id, docid)
);
CREATE TABLE IF NOT EXISTS arguments (
  id TEXT NOT NULL,
  matter_id INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('ours','opposing')),
  idx INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','stale')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (matter_id, id)
);
CREATE TABLE IF NOT EXISTS draft_sources (
  matter_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (matter_id, side)
);
CREATE TABLE IF NOT EXISTS sim_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id INTEGER NOT NULL DEFAULT 0,
  batch TEXT NOT NULL,
  angle TEXT NOT NULL,
  strictness TEXT NOT NULL,
  outcome TEXT NOT NULL,
  decisive_issue TEXT NOT NULL,
  transcript TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  search_count INTEGER NOT NULL DEFAULT 0,
  doc_count INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO spend (id, search_count, doc_count) VALUES (1, 0, 0);

-- Agent governance. The autonomy level must live server-side: a policy enforced
-- only by the client is not a policy, since every route is reachable directly.
CREATE TABLE IF NOT EXISTS agent_policy (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  autonomy   TEXT NOT NULL DEFAULT 'supervised'
             CHECK (autonomy IN ('ask','supervised','autonomous')),
  updated_at TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO agent_policy (id, autonomy, updated_at) VALUES (1, 'supervised', '');

-- Output-rail results per drafted argument: which citations resolved, which are
-- weakly supported. Kept so the UI and the audit trail can show that every
-- drafted sentence was checked against the paragraph it points at.
CREATE TABLE IF NOT EXISTS citation_checks (
  matter_id  INTEGER NOT NULL,
  side       TEXT NOT NULL,
  arg_id     TEXT NOT NULL,
  payload    TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (matter_id, side, arg_id)
);

-- Corpus. Written by scripts/ingest/*.py, read by lib/corpus.ts. Declared here
-- too so a fresh database (and every test) has the shape without an ingest run.
-- Keep these definitions byte-compatible with the Python DDL.
CREATE TABLE IF NOT EXISTS judgments (
  cnr           TEXT PRIMARY KEY,
  bucket        TEXT NOT NULL,
  court_code    TEXT NOT NULL DEFAULT '',
  bench         TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  judge         TEXT NOT NULL DEFAULT '',
  citation      TEXT NOT NULL DEFAULT '',
  decision_date INTEGER NOT NULL DEFAULT 0,
  year          INTEGER,
  disposal      TEXT NOT NULL DEFAULT '',
  src_path      TEXT NOT NULL DEFAULT '',
  has_text      INTEGER NOT NULL DEFAULT 0,
  gated         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_judgments_date  ON judgments(decision_date);
CREATE INDEX IF NOT EXISTS idx_judgments_court ON judgments(court_code, year);

CREATE TABLE IF NOT EXISTS doc_text (
  cnr         TEXT PRIMARY KEY,
  text        BLOB NOT NULL,
  n_paras     INTEGER NOT NULL,
  n_chars     INTEGER NOT NULL,
  ingested_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id         TEXT PRIMARY KEY,
  cnr        TEXT NOT NULL,
  ord        INTEGER NOT NULL,
  para_start INTEGER NOT NULL,
  para_end   INTEGER NOT NULL,
  n_chars    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_cnr ON chunks(cnr);

CREATE TABLE IF NOT EXISTS embed_cache (
  hash       TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  input_type TEXT NOT NULL,
  dims       INTEGER NOT NULL,
  vec        BLOB NOT NULL,
  created_at TEXT NOT NULL
);
-- Binary codes only. int8 vectors are deliberately not stored: the NIM
-- cross-encoder reranks from passage TEXT, so the fine-scoring stage never needs
-- a dequantised vector. At 2048 dims that is 256 B/chunk instead of 2 KB —
-- ~740 MB rather than 5.1 GB over the gated set.
CREATE TABLE IF NOT EXISTS chunk_vectors (
  chunk_id TEXT PRIMARY KEY,
  model    TEXT NOT NULL,
  bin      BLOB NOT NULL,   -- 1 bit/dim, coarse Hamming scan
  dims     INTEGER NOT NULL
);

-- Graph edges for retrieval expansion.
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
`;

let db: Database.Database | null = null;

/** On Vercel the bundled filesystem is read-only — copy the seeded DB to /tmp
 *  once per instance. Demo-mode caveat: /tmp is ephemeral, so state created by
 *  visitors survives the instance, not the deployment. Locally: data/lex.db. */
function resolveDbPath(): string {
  if (process.env.LEX_DB_PATH) return process.env.LEX_DB_PATH;
  const bundled = path.join(process.cwd(), "data", "lex.db");
  if (process.env.VERCEL) {
    const tmp = "/tmp/lex.db";
    if (!fs.existsSync(tmp) && fs.existsSync(bundled)) {
      fs.copyFileSync(bundled, tmp);
    }
    return tmp;
  }
  return bundled;
}

export function isEphemeralDeployment(): boolean {
  return Boolean(process.env.VERCEL) && !process.env.LEX_DB_PATH;
}

export function getDb(): Database.Database {
  if (db) return db;
  const file = resolveDbPath();
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  // Wait for a writer instead of failing instantly. getDb() runs the schema
  // DDL below, which needs a write lock, so without this the app throws
  // SQLITE_BUSY and cannot open the database at all while an ingest is running
  // — the connection fails before a single read is served.
  db.pragma("busy_timeout = 10000");
  migrateLegacyTables(db);
  db.exec(SCHEMA);
  return db;
}

/** v1 (single-seeded-matter demo) derived tables lacked matter_id — drop them.
 *  Caches, audit and overrides are shape-compatible and are kept. */
function migrateLegacyTables(d: Database.Database) {
  for (const table of ["arguments", "draft_sources", "sim_runs"]) {
    const exists = d
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
    if (!exists) continue;
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "matter_id")) {
      d.exec(`DROP TABLE ${table}`);
    }
  }
}

/** Test helper: fresh in-memory database, also swaps the singleton. */
export function freshDb(): Database.Database {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
