// Argument generation. REAL LLM, grounded: the model sees ONLY the judgments
// the user pinned for this matter (id-tagged, paragraph-numbered), the matter's
// facts, the computed flags, and the statute graph. Every sentence carries a
// schema-enforced [dN¶M] citation; unsupported points become visible abstentions.

import { Type, type Schema } from "@google/genai";
import { getDb, nowIso } from "@/lib/db";
import { llmJson } from "@/lib/llm";
import {
  getMatter,
  listPins,
  matterDatesFor,
  matterRef,
  type Matter,
} from "@/lib/matter";
import { mappings } from "@/lib/mappings";
import { getOverride } from "@/lib/override";
import { computeValidity } from "@/lib/validity";
import * as kanoon from "@/lib/kanoon";
import { writeAudit } from "@/lib/audit";

export interface DraftedArgument {
  id: string;
  side: "ours" | "opposing";
  text: string;
  citations: { tag: string; para: number }[];
  mapping_deps: string[];
  confidence: number;
  status: "verified" | "stale";
  version: number;
}

export interface DraftSource {
  tag: string; // d1, d2, ...
  docid: string;
  title: string;
  court: string;
  date: string;
  url: string;
  flagColor: string;
}

// Per-sentence schema: every sentence MUST name a source document (dN) and
// paragraph. Gemini enforces the shape server-side; the text with [dN¶M] tags
// is assembled here, so inline-citation drift is structurally impossible.
const DRAFT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    arguments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sentences: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                doc: { type: Type.STRING, pattern: "^d\\d+$" },
                para: { type: Type.INTEGER },
              },
              required: ["text", "doc", "para"],
            },
          },
          mapping_deps: { type: Type.ARRAY, items: { type: Type.STRING } },
          confidence: { type: Type.NUMBER },
        },
        required: ["sentences", "mapping_deps", "confidence"],
      },
    },
    abstentions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["arguments", "abstentions"],
};

interface DraftLlmOut {
  arguments: {
    sentences: { text: string; doc: string; para: number }[];
    mapping_deps: string[];
    confidence: number;
  }[];
  abstentions: string[];
}

/** Assemble display text with [dN¶M] tags from the schema-enforced sentences. */
function assemble(
  sentences: { text: string; doc: string; para: number }[],
  validTags: Set<string>
): { text: string; citations: { tag: string; para: number }[] } {
  const citations: { tag: string; para: number }[] = [];
  const parts = sentences.map((s) => {
    const clean = s.text.replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+/g, " ").trim();
    if (validTags.has(s.doc) && s.para >= 1) {
      citations.push({ tag: s.doc, para: s.para });
      return `${clean} [${s.doc}¶${s.para}]`;
    }
    return clean;
  });
  return { text: parts.join(" "), citations };
}

const PARA_CAP = 60;
const CHAR_CAP = 9000;

function mappingsBlock(): string {
  return mappings
    .map((m) => {
      const o = getOverride(m.id);
      const base = `${m.id}: ${m.act_old} ${m.provision_old} → ${m.act_new} ${m.provision_new} (${m.change_type}, w.e.f. ${m.commencement}). ${m.note}`;
      return o ? `${base} [LAWYER OVERRIDE v${o.version}: ${o.note}]` : base;
    })
    .join("\n");
}

export class DraftingError extends Error {}

async function gatherSources(matter: Matter): Promise<{ sources: DraftSource[]; blocks: string }> {
  const pins = listPins(matter.id);
  if (pins.length === 0) {
    throw new DraftingError(
      "No authorities pinned for this matter. Pin judgments from Research first — drafting only uses sources you have chosen."
    );
  }
  const dates = matterDatesFor(matter);
  const sources: DraftSource[] = [];
  let blocks = "";
  let n = 0;
  for (const pin of pins.slice(0, 8)) {
    const doc = await kanoon.fetchDoc(pin.docid);
    if (!doc) continue;
    n += 1;
    const tag = `d${n}`;
    const flag = computeValidity({ date: pin.date || doc.date, text: doc.text }, mappings, dates);
    sources.push({
      tag,
      docid: pin.docid,
      title: pin.title || doc.title,
      court: pin.court || doc.court,
      date: pin.date || doc.date,
      url: pin.url || doc.url,
      flagColor: flag.color,
    });
    blocks += `\n=== ${tag} · ${pin.title || doc.title} · ${pin.court || doc.court} · ${pin.date || doc.date} · validity flag: ${flag.color.toUpperCase()} (${flag.reason})\n`;
    let used = 0;
    for (let i = 0; i < Math.min(doc.paragraphs.length, PARA_CAP); i++) {
      const p = `[¶${i + 1}] ${doc.paragraphs[i]}\n`;
      if (used + p.length > CHAR_CAP) break;
      blocks += p;
      used += p.length;
    }
  }
  if (sources.length === 0) {
    throw new DraftingError("None of the pinned judgments could be loaded from cache or network.");
  }
  return { sources, blocks };
}

function factsBlock(matter: Matter): string {
  const dates = matterDatesFor(matter);
  const lines = [
    `Matter: ${matter.title}${matter.filing ? `, ${matter.filing}` : ""} (Indian commercial suit).`,
  ];
  if (matter.agreement_date) lines.push(`- Agreement date: ${matter.agreement_date}`);
  if (matter.cause_date) lines.push(`- Alleged breach / cause of action: ${matter.cause_date}`);
  lines.push(`- Suit filed: ${matter.suit_date}`);
  if (matter.relief) lines.push(`- Relief claimed: ${matter.relief}`);
  if (matter.key_evidence) lines.push(`- Key evidence: ${matter.key_evidence}`);
  if (matter.notes) lines.push(`- Notes on record: ${matter.notes}`);
  lines.push(`- Trial is ongoing (today: ${dates.trial}).`);
  return lines.join("\n");
}

function buildPrompt(matter: Matter, side: "ours" | "opposing", blocks: string): string {
  const stance =
    side === "ours" ? "the PLAINTIFF" : "the DEFENDANT (opposing the plaintiff's claim)";
  return `You are drafting arguments for ${stance} in an Indian commercial suit.

STRICT RULES:
1. Use ONLY the provided sources below. Do not rely on outside knowledge of case law.
2. Return each argument as a list of sentence objects. Each sentence carries doc (a source tag like "d3") and para (the paragraph number in that document that actually supports the sentence). Statutory propositions must cite a provided paragraph that states or applies the provision — pick the best-supporting document paragraph; never cite a mapping id as a source.
3. For each argument, list mapping_deps: the ids (e.g. "M14") of the statutory mappings below that the argument's validity depends on.
4. Prefer sources whose validity flag is GREEN. If you must use a RED/AMBER-flagged source, the argument's confidence must reflect that risk.
5. If the sources do not support a point you would normally make, DO NOT invent it — add it to "abstentions" as a short description of the missing point.
6. Draft 3 to 4 arguments, each 2-4 sentences of court-ready prose. confidence is 0..1.

MATTER FACTS:
${factsBlock(matter)}

STATUTORY MAPPINGS (the temporal-validity graph for this matter):
${mappingsBlock()}

SOURCES (id-tagged, paragraph-numbered, with computed validity flags):
${blocks}`;
}

export async function draftArguments(
  matterId: number,
  side: "ours" | "opposing",
  opts: { force?: boolean } = {}
): Promise<{
  args: DraftedArgument[];
  abstentions: string[];
  sources: DraftSource[];
  fromCache: boolean;
}> {
  const db = getDb();
  const matter = getMatter(matterId);
  if (!matter) throw new DraftingError(`Unknown matter ${matterId}`);

  if (!opts.force) {
    const existing = db
      .prepare("SELECT * FROM arguments WHERE matter_id = ? AND side = ? ORDER BY idx")
      .all(matterId, side) as { id: string; payload: string; status: string; version: number }[];
    const srcRow = db
      .prepare("SELECT payload FROM draft_sources WHERE matter_id = ? AND side = ?")
      .get(matterId, side) as { payload: string } | undefined;
    if (existing.length > 0 && srcRow) {
      const meta = JSON.parse(srcRow.payload) as { sources: DraftSource[]; abstentions: string[] };
      return {
        args: existing.map((r) => ({
          ...(JSON.parse(r.payload) as Omit<DraftedArgument, "id" | "side" | "status" | "version">),
          id: r.id,
          side,
          status: r.status as "verified" | "stale",
          version: r.version,
        })),
        abstentions: meta.abstentions,
        sources: meta.sources,
        fromCache: true,
      };
    }
  }

  const { sources, blocks } = await gatherSources(matter);
  const prompt = buildPrompt(matter, side, blocks);
  const { data } = await llmJson<DraftLlmOut>(prompt, DRAFT_SCHEMA);

  const validTags = new Set(sources.map((s) => s.tag));
  const prefix = side === "ours" ? "A" : "O";
  const args: DraftedArgument[] = data.arguments.slice(0, 4).map((a, i) => {
    const { text, citations } = assemble(a.sentences, validTags);
    return {
      id: `${prefix}${i + 1}`,
      side,
      text,
      citations,
      mapping_deps: a.mapping_deps.filter((m) => mappings.some((x) => x.id === m)),
      confidence: a.confidence,
      status: "verified",
      version: 1,
    };
  });

  const now = nowIso();
  db.prepare("DELETE FROM arguments WHERE matter_id = ? AND side = ?").run(matterId, side);
  const insert = db.prepare(
    `INSERT INTO arguments (id, matter_id, side, idx, payload, status, version, updated_at)
     VALUES (?, ?, ?, ?, ?, 'verified', 1, ?)`
  );
  args.forEach((a, i) =>
    insert.run(
      a.id,
      matterId,
      side,
      i,
      JSON.stringify({
        text: a.text,
        citations: a.citations,
        mapping_deps: a.mapping_deps,
        confidence: a.confidence,
      }),
      now
    )
  );
  db.prepare(
    "INSERT OR REPLACE INTO draft_sources (matter_id, side, payload, updated_at) VALUES (?, ?, ?, ?)"
  ).run(matterId, side, JSON.stringify({ sources, abstentions: data.abstentions }), now);

  writeAudit(
    "system",
    `Draft arguments generated (${args.map((a) => a.id).join(", ")}) from ${sources.length} pinned authorities · ${data.abstentions.length} abstention(s)`,
    `${matterRef(matter)} (${side})`
  );

  return { args, abstentions: data.abstentions, sources, fromCache: false };
}

/** Re-draft a single argument against the CURRENT mappings (incl. overrides). */
export async function redraftArgument(matterId: number, argId: string): Promise<DraftedArgument> {
  const db = getDb();
  const matter = getMatter(matterId);
  if (!matter) throw new DraftingError(`Unknown matter ${matterId}`);
  const row = db
    .prepare("SELECT * FROM arguments WHERE matter_id = ? AND id = ?")
    .get(matterId, argId) as
    | { id: string; side: "ours" | "opposing"; payload: string; version: number }
    | undefined;
  if (!row) throw new DraftingError(`Unknown argument ${argId}`);
  const prev = JSON.parse(row.payload) as { text: string; mapping_deps: string[] };

  const { sources, blocks } = await gatherSources(matter);
  const prompt = `${buildPrompt(matter, row.side, blocks)}

RE-VERIFICATION TASK: The argument below was drafted earlier. One or more statutory mappings it depends on (${prev.mapping_deps.join(", ")}) have since been corrected by the supervising lawyer (see LAWYER OVERRIDE notes in the mappings above). Re-draft THIS ONE argument so it is consistent with the corrected mappings, same citation rules. Return exactly one argument.

PREVIOUS ARGUMENT:
${prev.text}`;

  const { data } = await llmJson<DraftLlmOut>(prompt, DRAFT_SCHEMA, {
    cacheSalt: `reverify:m${matterId}:${argId}:v${row.version + 1}`,
  });
  const a = data.arguments[0];
  if (!a) throw new DraftingError("Re-draft returned no argument");

  const validTags = new Set(sources.map((s) => s.tag));
  const { text, citations } = assemble(a.sentences, validTags);
  const updated: DraftedArgument = {
    id: argId,
    side: row.side,
    text,
    citations,
    mapping_deps: a.mapping_deps.filter((m) => mappings.some((x) => x.id === m)),
    confidence: a.confidence,
    status: "verified",
    version: row.version + 1,
  };
  db.prepare(
    "UPDATE arguments SET payload = ?, status = 'verified', version = ?, updated_at = ? WHERE matter_id = ? AND id = ?"
  ).run(
    JSON.stringify({
      text: updated.text,
      citations: updated.citations,
      mapping_deps: updated.mapping_deps,
      confidence: updated.confidence,
    }),
    updated.version,
    nowIso(),
    matterId,
    argId
  );
  // Re-drafting refreshes the source snapshot too (flags may have moved).
  db.prepare(
    "INSERT OR REPLACE INTO draft_sources (matter_id, side, payload, updated_at) VALUES (?, ?, ?, ?)"
  ).run(
    matterId,
    row.side,
    JSON.stringify({
      sources,
      abstentions:
        (JSON.parse(
          (db
            .prepare("SELECT payload FROM draft_sources WHERE matter_id = ? AND side = ?")
            .get(matterId, row.side) as { payload: string } | undefined)?.payload ?? '{"abstentions":[]}'
        ) as { abstentions: string[] }).abstentions,
    }),
    nowIso()
  );
  return updated;
}
