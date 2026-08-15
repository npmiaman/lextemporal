// Append-only audit log. Written from: search, flag computation, drafting,
// override, reverify, simulate, autonomy-dial change, export sign-off.
// There is deliberately no delete/update path through this module or any API.

import { getDb, nowIso } from "@/lib/db";

export interface AuditRow {
  id: number;
  ts: string;
  actor: "system" | "lawyer";
  action: string;
  object: string;
  version: string;
}

export function writeAudit(
  actor: "system" | "lawyer",
  action: string,
  object: string,
  version = "v1"
): AuditRow {
  const db = getDb();
  const ts = nowIso();
  const info = db
    .prepare("INSERT INTO audit (ts, actor, action, object, version) VALUES (?, ?, ?, ?, ?)")
    .run(ts, actor, action, object, version);
  return { id: Number(info.lastInsertRowid), ts, actor, action, object, version };
}

export function readAudit(limit = 200): AuditRow[] {
  return getDb()
    .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?")
    .all(limit) as AuditRow[];
}
