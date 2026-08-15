// Adversarial simulation. REAL LLM, cached per matter. Each run perturbs
// (opposing angle × judge strictness); one Gemini call per run returns a
// structured outcome. Re-running an unchanged matter serves from the LLM cache.

import { Type, type Schema } from "@google/genai";
import { getDb, nowIso } from "@/lib/db";
import { llmJson } from "@/lib/llm";
import { getMatter, matterDatesFor, matterRef, type Matter } from "@/lib/matter";
import { mappings } from "@/lib/mappings";
import { writeAudit } from "@/lib/audit";

export const ANGLES = [
  "limitation",
  "S.12A pre-institution mediation non-compliance",
  "readiness and willingness under S.16",
  "electronic-evidence certificate under BSA S.63",
  "discretion under old S.10",
] as const;

export const STRICTNESS = ["low", "medium", "high"] as const;

/** A weak point maps to a suggested Research query the user can run. */
export const ANGLE_QUERIES: Record<string, string> = {
  limitation: '"limitation" "specific performance" suit barred',
  "S.12A pre-institution mediation non-compliance":
    '"section 12A" "commercial courts act" pre-institution mediation',
  "readiness and willingness under S.16":
    '"readiness and willingness" "section 16" specific performance',
  "electronic-evidence certificate under BSA S.63":
    '"65B" certificate electronic record admissibility',
  "discretion under old S.10": '"specific performance" "section 10" "specific relief act"',
};

export interface SimRun {
  id?: number;
  matter_id: number;
  batch: string;
  angle: string;
  strictness: string;
  outcome: "favourable" | "adverse";
  decisive_issue: string;
  transcript: string;
}

export interface SimTally {
  runs: number;
  favourable: number;
  adverse: number;
  weakPoint: string | null;
  weakPointCount: number;
  weakPointQuery: string | null;
  runsDetail: SimRun[];
}

const SIM_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    outcome: { type: Type.STRING, enum: ["favourable", "adverse"] },
    decisive_issue: { type: Type.STRING, enum: [...ANGLES] },
    one_para_transcript: { type: Type.STRING },
  },
  required: ["outcome", "decisive_issue", "one_para_transcript"],
};

function argsSummary(matterId: number): string {
  const rows = getDb()
    .prepare("SELECT id, side, payload FROM arguments WHERE matter_id = ? ORDER BY side, idx")
    .all(matterId) as { id: string; side: string; payload: string }[];
  if (rows.length === 0) return "(no drafted arguments yet)";
  return rows
    .map((r) => {
      const p = JSON.parse(r.payload) as { text: string };
      return `- [${r.side}] ${r.id}: ${p.text.replace(/\[d\d+¶\d+\]/g, "").slice(0, 220)}`;
    })
    .join("\n");
}

function simPrompt(matter: Matter, angle: string, strictness: string, runIdx: number): string {
  const dates = matterDatesFor(matter);
  const facts = [
    `- ${matter.title}${matter.filing ? `, ${matter.filing}` : ""}`,
    matter.agreement_date ? `- Agreement date: ${matter.agreement_date}` : "",
    matter.cause_date ? `- Alleged breach / cause of action: ${matter.cause_date}` : "",
    `- Suit filed: ${matter.suit_date}`,
    matter.relief ? `- Relief claimed: ${matter.relief}` : "",
    matter.key_evidence ? `- Key evidence: ${matter.key_evidence}` : "",
    matter.notes ? `- Notes on record: ${matter.notes}` : "",
    `- Today: ${dates.trial}; trial ongoing.`,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are simulating one hearing of an Indian commercial suit before a judge of ${strictness} strictness. Opposing counsel is aggressive and leads with: ${angle}.

MATTER (the plaintiff's claim):
${facts}

PLAINTIFF'S AND DEFENDANT'S DRAFTED ARGUMENTS (summaries):
${argsSummary(matter.id)}

STATUTORY CONTEXT (verified graph, most relevant rows):
${mappings.slice(0, 10).map((m) => `- ${m.id}: ${m.act_old} ${m.provision_old} → ${m.provision_new}, w.e.f. ${m.commencement}. ${m.note}`).join("\n")}

Simulation run #${runIdx + 1}. Decide realistically how this single hearing goes for the PLAINTIFF given the judge's strictness and the opposing angle. A ${strictness}-strictness judge ${strictness === "high" ? "demands strict statutory compliance (certificates, mediation record, limitation arithmetic)" : strictness === "medium" ? "weighs compliance gaps against merits" : "leans on substantive merits over procedural gaps"}.
Return JSON: outcome ("favourable"|"adverse" for the plaintiff), decisive_issue (the single issue that decided it, from the allowed list), one_para_transcript (4-6 sentences of what happened in the hearing).`;
}

export async function runOne(matterId: number, batch: string, runIdx: number): Promise<SimRun> {
  const matter = getMatter(matterId);
  if (!matter) throw new Error(`Unknown matter ${matterId}`);
  const angle = ANGLES[runIdx % ANGLES.length];
  const strictness = STRICTNESS[Math.floor(runIdx / ANGLES.length) % STRICTNESS.length];
  const { data } = await llmJson<{
    outcome: "favourable" | "adverse";
    decisive_issue: string;
    one_para_transcript: string;
  }>(simPrompt(matter, angle, strictness, runIdx), SIM_SCHEMA, {
    cacheSalt: `sim:m${matterId}:${runIdx}`,
  });

  const run: SimRun = {
    matter_id: matterId,
    batch,
    angle,
    strictness,
    outcome: data.outcome,
    decisive_issue: data.decisive_issue,
    transcript: data.one_para_transcript,
  };
  getDb()
    .prepare(
      `INSERT INTO sim_runs (matter_id, batch, angle, strictness, outcome, decisive_issue, transcript, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(matterId, batch, angle, strictness, run.outcome, run.decisive_issue, run.transcript, nowIso());
  return run;
}

export function tallyBatch(matterId: number, batch: string): SimTally {
  const rows = getDb()
    .prepare("SELECT * FROM sim_runs WHERE matter_id = ? AND batch = ? ORDER BY id")
    .all(matterId, batch) as (SimRun & { id: number })[];
  const adverse = rows.filter((r) => r.outcome === "adverse");
  const counts = new Map<string, number>();
  for (const r of adverse) counts.set(r.decisive_issue, (counts.get(r.decisive_issue) ?? 0) + 1);
  const weak = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    runs: rows.length,
    favourable: rows.length - adverse.length,
    adverse: adverse.length,
    weakPoint: weak?.[0] ?? null,
    weakPointCount: weak?.[1] ?? 0,
    weakPointQuery: weak ? (ANGLE_QUERIES[weak[0]] ?? null) : null,
    runsDetail: rows,
  };
}

/** Start (or continue) a batch: runs only the missing runs, so re-entry is cheap. */
export async function simulateStep(matterId: number, batch: string, n: number): Promise<SimTally> {
  const existing = tallyBatch(matterId, batch).runs;
  if (existing < n) {
    await runOne(matterId, batch, existing);
  }
  const tally = tallyBatch(matterId, batch);
  if (tally.runs === n) {
    const matter = getMatter(matterId)!;
    writeAudit(
      "system",
      `Simulation completed — ${tally.runs} runs · ${tally.favourable} favourable · ${tally.adverse} adverse`,
      `${matterRef(matter)} · batch ${batch}`
    );
  }
  return tally;
}
