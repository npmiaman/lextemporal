// Matter management. Users create and edit their own matters; every engine
// (validity, drafting, simulation) computes against the active matter's timeline.

import { getDb, nowIso } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export interface Matter {
  id: number;
  title: string;
  filing: string;
  agreement_date: string; // ISO yyyy-mm-dd or ""
  cause_date: string; // breach / cause of action, or ""
  suit_date: string; // required
  relief: string;
  key_evidence: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type MatterInput = Omit<Matter, "id" | "created_at" | "updated_at">;

export interface MatterDates {
  cause: string;
  suit: string;
  trial: string; // ongoing — today
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateMatterInput(m: Partial<MatterInput>): string | null {
  if (!m.title?.trim()) return "title is required";
  if (!m.suit_date || !DATE_RE.test(m.suit_date)) return "suit_date (yyyy-mm-dd) is required";
  for (const f of ["agreement_date", "cause_date"] as const) {
    if (m[f] && !DATE_RE.test(m[f]!)) return `${f} must be yyyy-mm-dd`;
  }
  return null;
}

export function listMatters(): Matter[] {
  return getDb().prepare("SELECT * FROM matters ORDER BY updated_at DESC").all() as Matter[];
}

export function getMatter(id: number): Matter | undefined {
  return getDb().prepare("SELECT * FROM matters WHERE id = ?").get(id) as Matter | undefined;
}

export function createMatter(input: MatterInput): Matter {
  const now = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO matters (title, filing, agreement_date, cause_date, suit_date, relief, key_evidence, notes, created_at, updated_at)
       VALUES (@title, @filing, @agreement_date, @cause_date, @suit_date, @relief, @key_evidence, @notes, @created_at, @updated_at)`
    )
    .run({ ...input, created_at: now, updated_at: now });
  const m = getMatter(Number(info.lastInsertRowid))!;
  writeAudit("lawyer", `Matter created — ${m.title}`, matterRef(m));
  return m;
}

export function updateMatter(id: number, input: MatterInput): Matter {
  getDb()
    .prepare(
      `UPDATE matters SET title=@title, filing=@filing, agreement_date=@agreement_date, cause_date=@cause_date,
       suit_date=@suit_date, relief=@relief, key_evidence=@key_evidence, notes=@notes, updated_at=@updated_at WHERE id=@id`
    )
    .run({ ...input, id, updated_at: nowIso() });
  const m = getMatter(id)!;
  writeAudit("lawyer", `Matter details updated — dates re-govern all validity checks`, matterRef(m));
  return m;
}

export function matterRef(m: Matter): string {
  return m.filing ? `${m.filing}` : `Matter #${m.id}`;
}

export function matterDatesFor(m: Matter, today = new Date()): MatterDates {
  return {
    cause: m.cause_date || m.suit_date,
    suit: m.suit_date,
    trial: today.toISOString().slice(0, 10),
  };
}

/** One-click sample matter so a new user can try every feature immediately. */
export function sampleMatterInput(): MatterInput {
  return {
    title: "M/s Sharma Traders v. Balaji Infra Pvt. Ltd.",
    filing: "CS(COMM) 214/2021",
    agreement_date: "2016-03-12",
    cause_date: "2019-06-04",
    suit_date: "2021-01-18",
    relief: "Specific performance of sale agreement (commercial premises)",
    key_evidence: "WhatsApp exchange dated May 2019 (electronic record)",
    notes:
      "Pre-institution mediation under Commercial Courts Act S.12A initiated November 2020; non-starter report January 2021, on record. BSA 2023 S.63 electronic-record certificate for the WhatsApp exchange not yet on record.",
  };
}

export interface PinnedDoc {
  matter_id: number;
  docid: string;
  title: string;
  court: string;
  date: string;
  url: string;
  flag_color: string;
  added_at: string;
}

export function listPins(matterId: number): PinnedDoc[] {
  return getDb()
    .prepare("SELECT * FROM pinned_docs WHERE matter_id = ? ORDER BY added_at")
    .all(matterId) as PinnedDoc[];
}

export function setPin(
  matterId: number,
  doc: Omit<PinnedDoc, "matter_id" | "added_at">,
  pinned: boolean
): void {
  const db = getDb();
  if (pinned) {
    db.prepare(
      `INSERT OR REPLACE INTO pinned_docs (matter_id, docid, title, court, date, url, flag_color, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(matterId, doc.docid, doc.title, doc.court, doc.date, doc.url, doc.flag_color, nowIso());
    writeAudit("lawyer", `Authority pinned for drafting — ${doc.title.slice(0, 80)}`, `Matter #${matterId}`);
  } else {
    db.prepare("DELETE FROM pinned_docs WHERE matter_id = ? AND docid = ?").run(matterId, doc.docid);
    writeAudit("lawyer", `Authority unpinned — ${doc.title.slice(0, 80)}`, `Matter #${matterId}`);
  }
}
