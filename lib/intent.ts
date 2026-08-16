// Deterministic intent routing, adapted from pigeon-dashboard's
// intent-classifier. Regex, not a model: deciding whether "Hi" should trigger a
// 133,947-passage corpus search is not a judgement call, and paying a model to
// make it would add latency and a failure mode to a question with a right
// answer.
//
// This exists because the first build ran full retrieval on every message. A
// greeting came back with six flagged authorities and a timeline defaulted to
// today's date, which is worse than useless — it looks like an answer.

export type Intent = "chat" | "research" | "draft" | "simulate";

/** `unsure` means the rules did not decide — ask the model rather than guess. */
export type Route = Intent | "unsure";

const GREETING =
  /^(hi|hey|hello|yo|hiya|howdy|good\s+(morning|afternoon|evening)|namaste|thanks?|thank\s+you|ok(ay)?|cool|great|nice|got\s+it|sure)\b[\s!.,]*$/i;

/** Questions about the tool itself, not about the law. */
const ABOUT_THE_TOOL =
  /\b(what|who|how)\s+(can|do|does|are)\s+(you|this|it)\b|\bwhat\s+(is|are)\s+(this|you|lextemporal)\b|\bhelp\b\s*$/i;

/** Verbs that mean "produce the work product". */
// Plurals matter: `\bsubmission\b` does not match "submissions", because the
// trailing "s" is a word character and kills the boundary.
const DRAFT =
  /\b(draft|write|prepare|compose|produce)\b.*\b(arguments?|submissions?|briefs?|repl(y|ies)|rejoinders?|written|notes?)\b|\bdraft\s+(it|them|for\s+me)\b/i;

/** Signals that the message is actually about law worth searching for. */
const LEGAL_SUBSTANCE =
  /\b(section|s\.|article|act|judgment|judgement|authority|authorities|precedent|case\s?law|citation|limitation|mediation|arbitration|specific\s+performance|evidence|admissib|decree|injunction|suit|plaint|appeal|held|ratio|bar(red)?|amend(ed|ment)?|supersed)/i;

/**
 * Route a message.
 *
 * Bias: when a message is short and carries no legal substance, treat it as
 * chat. Running retrieval on a greeting produces a confident-looking answer to
 * a question nobody asked; declining to search costs one clarifying sentence.
 */
const SIMULATE = /\b(simulate|run\s+the\s+hearing|mock\s+(hearing|trial)|moot)\b/i;

export function classify(message: string): Route {
  const text = message.trim();
  if (!text) return "chat";
  if (SIMULATE.test(text)) return "simulate";
  if (DRAFT.test(text)) return "draft";
  if (GREETING.test(text)) return "chat";
  if (ABOUT_THE_TOOL.test(text)) return "chat";
  // Naming a legal concept is a positive signal, so this stays deterministic
  // and costs no model call.
  if (LEGAL_SUBSTANCE.test(text)) return "research";
  if (text.split(/\s+/).length <= 3) return "chat";

  // Everything else is genuinely ambiguous. The previous default was
  // "research", which meant a question like "who is known as the godfather"
  // ran a 133,947-passage corpus search and returned six irrelevant judgments
  // under a checklist that made it look deliberate. Guessing wrong in that
  // direction is expensive and looks like a canned pipeline; guessing wrong
  // toward chat costs one sentence. So: defer, do not default.
  return "unsure";
}

/** Prompt for resolving `unsure`. Constrained to one word so it cannot ramble. */
export const ROUTER_PROMPT = `You route messages for an Indian legal-research tool.

Answer with exactly one word:
- research  — the user is asking about law, a case, a statute, evidence, procedure, or wants authorities found
- chat      — anything else: greetings, small talk, general knowledge, questions about you, or off-topic questions

The corpus contains ONLY Indian court judgments. A general-knowledge question
(films, history, people, science) is chat, not research, even if it sounds like
a real question.`;

/** Read the router's answer defensively; anything unrecognised means chat. */
export function parseRoute(reply: string): Intent {
  const w = reply.trim().toLowerCase();
  if (w.startsWith("research")) return "research";
  if (w.startsWith("draft")) return "draft";
  if (w.startsWith("simulate")) return "simulate";
  return "chat";
}
