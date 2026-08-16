// AI-native workspace model.
//
// The dashboard version made the lawyer drive five tabs in the right order:
// define a matter, search, pin, draft, simulate, export. This inverts it —
// they drop in the case papers, say what they need, and the agent runs the
// research. The artifact on the right is the work product as it is built.
//
// Everything the agent does still goes through the same audited engines, so
// the conversational surface adds no new authority: retrieval is retrieval,
// flags are still deterministic, drafting is still source-bound.

export type StepKind =
  | "reading"      // parsing uploaded case documents
  | "extracting"   // pulling the matter timeline out of them
  | "searching"    // corpus retrieval
  | "flagging"     // deterministic temporal-validity pass
  | "reasoning"    // what the agent concluded and why it matters
  | "drafting"     // producing the artifact
  | "blocked";     // a guardrail refused; needs confirmation

export interface AgentStep {
  id: string;
  kind: StepKind;
  title: string;
  detail?: string;
  /** Findings worth reading, not raw dumps — the "actually useful" part. */
  findings?: Finding[];
  status: "running" | "done" | "failed";
  ms?: number;
}

export interface Finding {
  /** Why the lawyer should care, in one line. */
  headline: string;
  /** RED/AMBER findings are the ones that change what you file. */
  severity: "critical" | "warning" | "info";
  /** Judgment CNR when the finding is anchored to an authority. */
  cnr?: string;
  cite?: string;
  detail?: string;
}

export type MessageRole = "user" | "agent";

/** An authority as the deterministic pass flagged it. */
export interface FlaggedAuthority {
  cnr: string;
  title: string;
  date: string;
  citation: string;
  color: string;
  reason: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  /** Artifacts this message referenced via @mention. */
  mentions?: string[];
  steps?: AgentStep[];
  /** What this run retrieved, shown beneath the answer with its flags. */
  authorities?: FlaggedAuthority[];
  createdAt: string;
}

export interface UploadedDoc {
  id: string;
  name: string;
  sizeBytes: number;
  kind: "pdf" | "text" | "unknown";
  /** Extracted plain text, truncated for display. */
  excerpt?: string;
  status: "uploading" | "parsed" | "failed";
  error?: string;
}

/** Dates the agent extracted from the uploaded papers, each with its evidence. */
export interface ExtractedFact {
  field: "agreement_date" | "cause_date" | "suit_date" | "relief" | "key_evidence" | "title";
  value: string;
  /** The sentence it came from, so the lawyer can check rather than trust. */
  evidence?: string;
  sourceDoc?: string;
  confidence: number;
}

export type ArtifactKind = "arguments" | "brief" | "note";

export interface ArtifactVersion {
  version: number;
  createdAt: string;
  /** Why this version exists — "drafted", "re-verified after M14 override", … */
  reason: string;
}

export interface Artifact {
  id: string;          // stable handle used by @mentions, e.g. "plaintiff-arguments"
  label: string;       // what the @menu shows
  kind: ArtifactKind;
  side?: "ours" | "opposing";
  version: number;
  history: ArtifactVersion[];
  updatedAt: string;
}

/** Parse @mentions out of composer text against the known artifacts. */
export function parseMentions(text: string, artifacts: Artifact[]): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/@([\w-]+)/g)) {
    const token = m[1].toLowerCase();
    const hit = artifacts.find(
      (a) => a.id.toLowerCase() === token || a.label.toLowerCase().replace(/\s+/g, "-") === token
    );
    if (hit) ids.add(hit.id);
  }
  return [...ids];
}

/** The @ trigger is active when the caret sits in an unbroken @token. */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  const token = upto.slice(at + 1);
  // A space closes the mention; so does a second @.
  if (/[\s@]/.test(token)) return null;
  return { query: token.toLowerCase(), start: at };
}

export function matchArtifacts(query: string, artifacts: Artifact[]): Artifact[] {
  if (!query) return artifacts;
  return artifacts.filter(
    (a) =>
      a.id.toLowerCase().includes(query) ||
      a.label.toLowerCase().includes(query)
  );
}

export const STEP_LABELS: Record<StepKind, string> = {
  reading: "Reading case documents",
  extracting: "Extracting the matter timeline",
  searching: "Searching the corpus",
  flagging: "Checking temporal validity",
  reasoning: "Working out what matters",
  drafting: "Drafting",
  blocked: "Waiting for your confirmation",
};
