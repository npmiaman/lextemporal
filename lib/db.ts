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
