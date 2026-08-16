// Courtroom simulation, after AgentCourt (Chen et al., arXiv:2408.08089).
//
// AgentCourt runs a fixed sequence — convene, opening statements, judge's
// question, debate rounds, judgment, reflection — with judge / plaintiff counsel
// / defence counsel / stenographer as LLM agents. We keep that skeleton because
// the *sequence* is a deterministic state machine: the order of phases, who
// speaks, and when the judge rules are all fixed. Only the words inside a turn
// are generated. That is the constrained-tree property we want, and it is what
// separates this from an open-ended chat between two bots.
//
// Two things we add that AgentCourt does not have, because we have a corpus:
//
//   1. Counsel argue from REAL retrieved authorities, not recalled ones. Each
//      turn is handed specific judgments with their citations.
//   2. Every authority carries a deterministic validity flag, so opposing
//      counsel can attack a citation for being temporally superseded — a move
//      that is checkable rather than rhetorical. That is the product's whole
//      thesis, played out adversarially.

import type { MatterDates } from "@/lib/matter";
import type { FlagColor } from "@/lib/validity";

export type Role = "clerk" | "judge" | "plaintiff" | "defence";

export type Phase =
  | "convene"
  | "opening"
  | "judge_question"
  | "debate"
  | "judgment"
  | "reflection";

/** The fixed running order. A simulation may stop early; it may never reorder. */
export const PHASE_ORDER: Phase[] = [
  "convene",
  "opening",
  "judge_question",
  "debate",
  "judgment",
  "reflection",
];

export const PHASE_LABEL: Record<Phase, string> = {
  convene: "Court convenes",
  opening: "Opening statements",
  judge_question: "Judge's question",
  debate: "Debate",
  judgment: "Judgment",
  reflection: "What to fix",
};

export const ROLE_LABEL: Record<Role, string> = {
  clerk: "Court Clerk",
  judge: "Judge",
  plaintiff: "Counsel for the Plaintiff",
  defence: "Counsel for the Defendant",
};

/** Judge temperament — the one knob that changes how the tree resolves. */
export type Strictness = "lenient" | "balanced" | "strict";

export const STRICTNESS_NOTE: Record<Strictness, string> = {
  lenient: "leans on substantive merits over procedural gaps",
  balanced: "weighs compliance gaps against the merits",
  strict: "demands strict statutory compliance — certificates, mediation record, limitation arithmetic",
};

/** An authority as it enters the courtroom: real judgment, real flag. */
export interface CourtAuthority {
  cnr: string;
  title: string;
  citation: string;
  date: string;
  flag: FlagColor;
  /** Why the flag fired — quoted verbatim when counsel attacks the citation. */
  reason: string;
}

export interface Turn {
  id: string;
  phase: Phase;
  role: Role;
  text: string;
  /** Authorities this turn relied on, so the transcript can show their flags. */
  cites?: string[]; // CNRs
  /** Set when this turn attacks an opponent's citation on temporal-validity grounds. */
  challenge?: { cnr: string; ground: string };
}

export type Outcome = "for_plaintiff" | "for_defendant" | "part_allowed";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  for_plaintiff: "Decree for the plaintiff",
  for_defendant: "Suit dismissed",
  part_allowed: "Partly allowed",
};

export interface Verdict {
  outcome: Outcome;
  decisiveIssue: string;
  reasoning: string;
  /** Authorities the judge declined to rely on, and why. */
  rejected: { cnr: string; ground: string }[];
}

export interface Hearing {
  id: string;
  strictness: Strictness;
  dates: MatterDates;
  authorities: CourtAuthority[];
  turns: Turn[];
  phase: Phase;
  verdict?: Verdict;
  /** What the losing side should shore up — links back to Research. */
  weakPoint?: string;
  startedAt: string;
}

/** Advance the state machine. Phases never skip and never reorder. */
export function nextPhase(current: Phase, debateRoundsDone: number, debateRounds: number): Phase | null {
  if (current === "debate" && debateRoundsDone < debateRounds) return "debate";
  const i = PHASE_ORDER.indexOf(current);
  return i >= 0 && i < PHASE_ORDER.length - 1 ? PHASE_ORDER[i + 1] : null;
}

/** Who speaks in a phase, in order. Fixed — this is the courtroom's protocol. */
export function speakersFor(phase: Phase): Role[] {
  switch (phase) {
    case "convene":
      return ["clerk"];
    case "opening":
      return ["plaintiff", "defence"];
    case "judge_question":
      return ["judge"];
    case "debate":
      return ["defence", "plaintiff"]; // defence presses first, plaintiff answers
    case "judgment":
      return ["judge"];
    case "reflection":
      return ["clerk"];
  }
}

/**
 * The authority the defence should attack first: the one whose reliance is most
 * clearly superseded. Deterministic — red before amber, older judgment first,
 * so the same hearing always opens on the same weakness.
 */
export function weakestAuthority(authorities: CourtAuthority[]): CourtAuthority | null {
  const rank: Record<FlagColor, number> = { red: 0, amber: 1, grey: 2, green: 3 };
  const attackable = authorities.filter((a) => a.flag === "red" || a.flag === "amber");
  if (attackable.length === 0) return null;
  return [...attackable].sort(
    (a, b) => rank[a.flag] - rank[b.flag] || a.date.localeCompare(b.date)
  )[0];
}

/** Opening line of the record — states the timeline every flag was measured against. */
export function convenedText(dates: MatterDates, n: number, strictness: Strictness): string {
  return [
    `This matter is called on. The court records the governing timeline: cause of action ${dates.cause}, suit filed ${dates.suit}, trial proceeding as of ${dates.trial}.`,
    `${n} ${n === 1 ? "authority has" : "authorities have"} been placed before the court, each checked against that timeline.`,
    `The presiding judge ${STRICTNESS_NOTE[strictness]}.`,
  ].join(" ");
}

/**
 * Reflection is computed, not written by a model: it names the flagged authority
 * that actually decided the hearing, so the follow-up research query is anchored
 * to something checkable.
 */
export function reflectionFor(hearing: Hearing): { text: string; query: string | null } {
  const challenged = hearing.turns.filter((t) => t.challenge).map((t) => t.challenge!);
  if (challenged.length === 0) {
    return {
      text: "No authority was attacked on temporal-validity grounds. The citations placed before the court survive the amendments that govern this matter.",
      query: null,
    };
  }
  const first = challenged[0];
  const auth = hearing.authorities.find((a) => a.cnr === first.cnr);
  return {
    text: `The defence attacked ${auth?.title ?? first.cnr} as superseded: ${first.ground} Shore this up with authority decided after the amendment, or plead the point on the current provision.`,
    query: auth ? `${auth.title.split(" versus ")[0]} ${auth.citation}`.trim() : null,
  };
}
