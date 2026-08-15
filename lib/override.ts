// The override cascade. REAL: bump the mapping version, store the lawyer's
// correction, mark every dependent argument stale, audit everything.
// Re-verification re-drafts the argument against the corrected mappings.

import { getDb, nowIso } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getMapping } from "@/lib/mappings";

export interface MappingOverride {
  mapping_id: string;
  version: number; // v1 is the system mapping; first override → v2
  note: string;
  updated_at: string;
}

export function getOverride(mappingId: string): MappingOverride | undefined {
  return getDb()
    .prepare("SELECT * FROM mapping_overrides WHERE mapping_id = ?")
    .get(mappingId) as MappingOverride | undefined;
}

export function listOverrides(): MappingOverride[] {
  return getDb().prepare("SELECT * FROM mapping_overrides").all() as MappingOverride[];
}

export function override(
  mappingId: string,
  note: string
): { version: number; staleArgIds: string[] } {
  const db = getDb();
  if (!getMapping(mappingId)) throw new Error(`Unknown mapping ${mappingId}`);

  const prev = getOverride(mappingId);
  const version = prev ? prev.version + 1 : 2;
  db.prepare(
    "INSERT OR REPLACE INTO mapping_overrides (mapping_id, version, note, updated_at) VALUES (?, ?, ?, ?)"
  ).run(mappingId, version, note, nowIso());

  // Stale every argument whose mapping_deps includes this mapping.
  const rows = db.prepare("SELECT id, payload FROM arguments").all() as {
    id: string;
    payload: string;
  }[];
  const staleArgIds: string[] = [];
  const stale = db.prepare("UPDATE arguments SET status = 'stale', updated_at = ? WHERE id = ?");
  for (const r of rows) {
    const deps = (JSON.parse(r.payload) as { mapping_deps?: string[] }).mapping_deps ?? [];
    if (deps.includes(mappingId)) {
      stale.run(nowIso(), r.id);
      staleArgIds.push(r.id);
    }
  }

  writeAudit(
    "lawyer",
    `Mapping ${mappingId} overridden — correction note recorded`,
    `Mapping ${mappingId}`,
    `v${version}`
  );
  if (staleArgIds.length > 0) {
    writeAudit(
      "system",
      `${staleArgIds.length} downstream argument(s) marked stale (${staleArgIds.join(", ")}) — pending re-verification`,
      `Mapping ${mappingId} cascade`,
      `v${version}`
    );
  }
  return { version, staleArgIds };
}

export function markReverified(argId: string, version: number): void {
  writeAudit(
    "system",
    `Argument ${argId} re-verified against current mappings`,
    `Argument ${argId}`,
    `v${version}`
  );
}
