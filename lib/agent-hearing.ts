// Running an AgentCourt hearing on real retrieved authorities.
//
// lib/courtroom.ts holds the state machine — the phase order, who speaks in each
// phase, which authority is weakest — and is fully tested without a model. This
// module is the thin generative layer on top: it enumerates the turn slots the
// machine produces, hands the model those slots, and asks it to fill in only the
// WORDS. The model never decides who speaks, in what order, which citation is
// attacked, or on what ground; all four come from code.
//
// One call fills the whole transcript. Turn-by-turn calls would let each speaker
// see the last, which sounds better and is worse: latency multiplies, and the
// sequence stops being reproducible for a fixed input.

import {
  convenedText,
  reflectionFor,
  speakersFor,
  weakestAuthority,
  type CourtAuthority,
  type Hearing,
  type Outcome,
  type Phase,
  type Role,
  type Strictness,
  STRICTNESS_NOTE,
  ROLE_LABEL,
  PHASE_LABEL,
} from "@/lib/courtroom";
import { chat, LlmError, parseJsonObject, salvageObjects, SYSTEM_PROMPT } from "@/lib/llm-nim";
import { fenceSources } from "@/lib/guardrails";
import type { MatterDates } from "@/lib/matter";

/** A slot the state machine produced: fixed phase and speaker, empty words. */
interface Slot {
  n: number;
  phase: Phase;
  role: Role;
}

const DEBATE_ROUNDS = 1;

/** Enumerate every generated slot, in the order the machine emits them. */
function slots(): Slot[] {
  const out: Slot[] = [];
  let n = 0;
  for (const phase of ["opening", "judge_question", "debate", "judgment"] as Phase[]) {
    const rounds = phase === "debate" ? DEBATE_ROUNDS : 1;
    for (let r = 0; r < rounds; r++) {
      for (const role of speakersFor(phase)) out.push({ n: ++n, phase, role });
    }
  }
  return out;
}

interface HearingJson {
  turns?: { n?: number; text?: string; cites?: string[] }[];
  verdict?: { outcome?: string; decisiveIssue?: string; reasoning?: string };
}

const OUTCOMES: Outcome[] = ["for_plaintiff", "for_defendant", "part_allowed"];

function authorityBlock(authorities: CourtAuthority[]): { block: string; tagToCnr: Map<string, string> } {
  const tagToCnr = new Map<string, string>();
  const lines = authorities.map((a, i) => {
    const tag = `d${i + 1}`;
    tagToCnr.set(tag, a.cnr);
    return `${tag} · ${a.title} ${a.citation ? `(${a.citation})` : ""} decided ${a.date} · validity flag ${a.flag.toUpperCase()} — ${a.reason}`;
  });
  return { block: lines.join("\n"), tagToCnr };
}

export async function runHearing(input: {
  question: string;
  dates: MatterDates;
  authorities: CourtAuthority[];
  /** The papers on record. Without them counsel argues a case it cannot see. */
  facts?: string;
  strictness?: Strictness;
}): Promise<Hearing> {
  const strictness = input.strictness ?? "balanced";
  const authorities = input.authorities;
  if (authorities.length === 0) {
    throw new LlmError("No authorities have been retrieved yet, so there is nothing to argue about.");
  }

  const machine = slots();
  const weakest = weakestAuthority(authorities);
  const { block, tagToCnr } = authorityBlock(authorities);
  // RETRIEVAL RAIL: the flag reasons quote judgment text, which is untrusted.
  const fenced = fenceSources(block);

  const brief = [
    `Simulate a hearing in an Indian commercial suit before a judge who ${STRICTNESS_NOTE[strictness]}.`,
    "",
    "Return ONLY this JSON object, no prose around it:",
    `{"turns":[{"n":1,"text":"...","cites":["d1"]}],"verdict":{"outcome":"for_plaintiff|for_defendant|part_allowed","decisiveIssue":"one clause","reasoning":"2 sentences"}}`,
    "",
    "Fill exactly these turns. Do not add, remove or reorder them:",
    ...machine.map((s) => `  n=${s.n} — ${ROLE_LABEL[s.role]}, ${PHASE_LABEL[s.phase]}`),
    "",
    "Rules:",
    "- 2 to 3 sentences per turn, at most 55 words. Speak as that role would in open court.",
    "- Cite only by tag (d1, d2 …) from the list below, in the `cites` array. Never name a case or section that is not in that list.",
    "- The validity flags were computed by a deterministic engine, not by you. Report them; never overturn one.",
    weakest
      ? `- Counsel for the Defendant must press this specific point in the debate turn: ${weakest.title} is flagged ${weakest.flag.toUpperCase()} — ${weakest.reason}`
      : "- No authority is flagged AMBER or RED. The defence must not pretend one is; attack on the merits instead.",
    "- GREY means no validity opinion was formed, NOT that the authority is sound. No speaker may call a grey authority verified.",
    "",
    "- The verdict object is required. Do not omit it.",
    "",
    `The lawyer's question: ${input.question}`,
    `Timeline every flag was measured against: cause of action ${input.dates.cause}, suit filed ${input.dates.suit}, as of ${input.dates.trial}.`,
    "",
    input.facts?.trim()
      ? `THE PAPERS ON RECORD — the only facts of this case. Do not invent others:\n${input.facts.trim().slice(0, 3500)}\n`
      : "No papers are on record, so counsel must argue the law and must not assert facts about this case.",
    "",
    "AUTHORITIES BEFORE THE COURT:",
    fenced.block,
  ].join("\n");

  const reply = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: brief },
    ],
    { temperature: 0.45, maxTokens: 2400 }
  );

  // A transcript that ran past the token ceiling should lose its last turn, not
  // the whole hearing — so a failed strict parse falls back to recovering the
  // turn objects individually. Slots the salvage cannot recover stay empty.
  let data: HearingJson;
  try {
    data = parseJsonObject<HearingJson>(reply);
  } catch {
    const parts = salvageObjects(reply);
    data = {
      turns: parts.filter((p) => "n" in p && "text" in p) as HearingJson["turns"],
      verdict: parts.find((p) => "outcome" in p) as HearingJson["verdict"],
    };
    if (!data.turns?.length) throw new LlmError("The hearing transcript came back unreadable.");
  }
  const byN = new Map((data.turns ?? []).map((t) => [Number(t.n), t]));

  const hearing: Hearing = {
    id: `h${Date.now().toString(36)}`,
    strictness,
    dates: input.dates,
    authorities,
    turns: [],
    phase: "reflection",
    startedAt: new Date().toISOString(),
  };

  hearing.turns.push({
    id: "t0",
    phase: "convene",
    role: "clerk",
    text: convenedText(input.dates, authorities.length, strictness),
  });

  for (const s of machine) {
    const filled = byN.get(s.n);
    const text = (filled?.text ?? "").trim();
    if (!text) continue; // a slot the model dropped is left empty, never invented
    const cites = (filled?.cites ?? [])
      .map((c) => tagToCnr.get(String(c).trim().toLowerCase()))
      .filter((c): c is string => Boolean(c));
    hearing.turns.push({
      id: `t${s.n}`,
      phase: s.phase,
      role: s.role,
      text,
      cites,
      // The challenge is attached by code, not by the model, and only to the
      // turn the machine says makes it — so a transcript can never show an
      // attack on an authority the engine did not actually flag.
      challenge:
        s.phase === "debate" && s.role === "defence" && weakest
          ? { cnr: weakest.cnr, ground: weakest.reason }
          : undefined,
    });
  }

  // No verdict is recorded unless the model actually returned one. Defaulting to
  // "part allowed" produced a transcript whose judge ruled for the plaintiff
  // above a verdict card saying something else — an invented ruling is worse
  // than a missing one.
  const outcome = data.verdict?.outcome as Outcome | undefined;
  const reasoning = (data.verdict?.reasoning ?? "").trim();
  if (outcome && OUTCOMES.includes(outcome) && reasoning) {
    hearing.verdict = {
      outcome,
      decisiveIssue: (data.verdict?.decisiveIssue ?? "").trim() || "not stated",
      reasoning,
      rejected: weakest ? [{ cnr: weakest.cnr, ground: weakest.reason }] : [],
    };
  }

  // The reflection is computed from the transcript, not written by the model,
  // and it lands in the "What to fix" card rather than as another clerk turn —
  // the panel already renders that phase as its own block.
  hearing.weakPoint = reflectionFor(hearing).text;

  return hearing;
}
