// Drafting from the authorities a research run actually retrieved.
//
// The original lib/drafting.ts drafts from *pinned* authorities against a saved
// matter row, through Gemini's schema-enforced JSON. That path still exists for
// the matter-centric UI. This one exists because the conversational surface has
// neither a matter row nor pins: it has the six judgments the last search
// returned, the timeline extracted from the papers, and the question the lawyer
// just asked.
//
// What is deliberately kept identical is the part that matters legally: every
// sentence must name the document and paragraph that supports it, and the
// citation is checked against that paragraph's real text before it is shown.
// A sentence whose citation does not resolve is REMOVED rather than shown
// untagged — an untraceable line inside a court-ready draft is precisely the
// failure this product exists to prevent — and the removal is reported.

import { fetchDoc } from "@/lib/corpus";
import { chat, LlmError, parseJsonObject, SYSTEM_PROMPT } from "@/lib/llm-nim";
import { checkCitation, fenceSources, summariseChecks, type CitationCheck } from "@/lib/guardrails";
import type { MatterDates } from "@/lib/matter";
import type { FlagColor } from "@/lib/validity";
import type { DraftedArgument, DraftSource } from "@/lib/drafting";

export interface DraftAuthority {
  cnr: string;
  title: string;
  citation: string;
  date: string;
  flag: FlagColor;
  reason: string;
}

export interface DraftResult {
  args: DraftedArgument[];
  sources: DraftSource[];
  abstentions: string[];
  /** Citations the output rail deleted. */
  removed: number;
  /** Citations re-attached to the papers after verifying they belong there. */
  retagged: number;
}

const PARA_CAP = 40;
const CHAR_CAP = 7000;
const MAX_SOURCES = 6;

interface DraftJson {
  arguments?: {
    heading?: string;
    sentences?: { text?: string; doc?: string; para?: number }[];
    confidence?: number;
  }[];
  abstentions?: string[];
}

/**
 * Split the papers on record into citable paragraphs.
 *
 * Blank lines first, as in the corpus. A plaint pasted into the composer often
 * arrives with no blank lines at all, which would make the whole document one
 * paragraph — a citation to "¶1" that means "somewhere in the plaint" is not
 * provenance. So a document that does not split falls back to its numbered
 * clauses, which is how a plaint is actually structured and referred to.
 */
export function splitPapers(text: string): string[] {
  const byBlank = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (byBlank.length >= 3) return byBlank;
  const byClause = text
    .split(/(?=(?:^|\s)\d{1,2}\.\s+(?:That\b|[A-Z]))/)
    .map((p) => p.trim())
    .filter(Boolean);
  return byClause.length >= 3 ? byClause : byBlank.length ? byBlank : [text.trim()];
}

function sourceBlocks(
  authorities: DraftAuthority[],
  papers: string
): {
  sources: DraftSource[];
  paragraphsByTag: Map<string, string[]>;
  blocks: string;
} {
  const sources: DraftSource[] = [];
  const paragraphsByTag = new Map<string, string[]>();
  let blocks = "";
  let n = 0;

  // The papers on record are a citable source in their own right, tagged p1.
  // Without one, every factual sentence about the matter had nowhere legitimate
  // to point, and the model tagged them to whichever judgment paragraph shared
  // enough words to pass the rail — grounding that looks real and is not.
  if (papers.trim()) {
    const paras = splitPapers(papers).slice(0, PARA_CAP);
    paragraphsByTag.set("p1", paras);
    sources.push({
      tag: "p1",
      docid: "papers",
      title: "Case papers on record",
      court: "Filed in this matter",
      date: "",
      url: "",
      flagColor: "grey",
    });
    blocks += `\n=== p1 · THE PAPERS ON RECORD IN THIS MATTER (facts, not authority)\n`;
    let used = 0;
    for (let i = 0; i < paras.length; i++) {
      const p = `[¶${i + 1}] ${paras[i]}\n`;
      if (used + p.length > CHAR_CAP) break;
      blocks += p;
      used += p.length;
    }
  }

  for (const a of authorities.slice(0, MAX_SOURCES)) {
    const doc = fetchDoc(a.cnr);
    if (!doc || doc.paragraphs.length === 0) continue;
    n += 1;
    const tag = `d${n}`;
    paragraphsByTag.set(tag, doc.paragraphs);
    sources.push({
      tag,
      docid: a.cnr,
      title: a.title || doc.title,
      court: doc.court,
      date: a.date || doc.date,
      url: doc.url,
      flagColor: a.flag,
    });
    blocks += `\n=== ${tag} · ${a.title || doc.title} · ${doc.court} · ${a.date || doc.date} · validity flag ${a.flag.toUpperCase()} (${a.reason})\n`;
    let used = 0;
    for (let i = 0; i < Math.min(doc.paragraphs.length, PARA_CAP); i++) {
      const p = `[¶${i + 1}] ${doc.paragraphs[i]}\n`;
      if (used + p.length > CHAR_CAP) break;
      blocks += p;
      used += p.length;
    }
  }
  return { sources, paragraphsByTag, blocks };
}

/**
 * Dates and money in a sentence, normalised so 12.03.2016, 12-03-2016 and
 * 12/03/2016 compare equal. These are the literals that make a sentence a claim
 * about a specific matter rather than a statement of law.
 */
function literals(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/g)) {
    out.push(`${Number(m[1])}/${Number(m[2])}/${m[3]}`);
  }
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    out.push(`${Number(m[3])}/${Number(m[2])}/${m[1]}`);
  }
  for (const m of s.matchAll(/(?:Rs\.?|₹|INR)\s*([\d,]{4,})/gi)) out.push(`₹${m[1].replace(/,/g, "")}`);
  return out;
}

/** The same literals as they appear anywhere in a paragraph. */
function literalsIn(paragraph: string): Set<string> {
  return new Set(literals(paragraph));
}

/**
 * Language that attributes a HOLDING to a source. Only a judgment can hold.
 *
 * Deliberately narrow. An earlier version also caught "confirmed" and
 * "affirmed", which a plaint paragraph can perfectly well do to a fact — that
 * rejected every factual sentence in the draft and left nothing to show. These
 * are the verbs that can only mean "a court decided this".
 */
const HOLDING_LANGUAGE = /\b(held|holds|laid down|ratio|precedent|settled law|this Court (?:held|observed)|it was decided)\b/i;

/**
 * The paragraph of the papers this sentence belongs to, or null.
 *
 * Two conditions, and the split between them is deliberate. Every date and
 * amount in the sentence must appear SOMEWHERE in the papers — that is the
 * check that the facts are on the record at all, and it is what stops a
 * fabricated figure surviving. The paragraph then cited is the best lexical
 * match among those carrying at least one of those literals.
 *
 * Requiring all of them in one paragraph was too strict to be useful: a plaint
 * states the consideration in clause 1 and the earnest money in clause 2, so a
 * perfectly ordinary sentence naming both matched no single paragraph and was
 * deleted. The weaker claim this makes is honest — the pin marks where to start
 * reading, not that one paragraph contains the whole sentence.
 */
function supportingPaper(sentence: string, papers: string[], validTags: Set<string>): number | null {
  const want = literals(sentence);
  const everywhere = new Set(papers.flatMap((p) => literals(p)));
  if (!want.every((l) => everywhere.has(l))) return null;

  let best: { at: number; overlap: number } | null = null;
  for (let i = 0; i < papers.length; i++) {
    const have = literalsIn(papers[i]);
    if (want.length > 0 && !want.some((l) => have.has(l))) continue;
    const check = checkCitation(sentence, papers[i], "p1", i + 1, validTags);
    if (check.verdict !== "ok") continue;
    if (!best || check.overlap > best.overlap) best = { at: i + 1, overlap: check.overlap };
  }
  return best?.at ?? null;
}

/**
 * Assemble one argument's prose, dropping any sentence whose citation the rails
 * cannot confirm.
 *
 * Beyond the lexical check there are two structural rails, and they exist
 * because the model demonstrably breaks both:
 *
 *   1. A sentence citing a JUDGMENT may not carry a date or an amount that the
 *      cited paragraph does not contain. That is how "the parties executed the
 *      agreement on 12.03.2016 [d1¶7]" gets caught — d1 is a decision between
 *      different parties and cannot record this client's facts, however well its
 *      vocabulary happens to overlap.
 *   2. A sentence citing THE PAPERS may not use holding language. A pleading
 *      states no proposition of law, and citing your own plaint as authority is
 *      the most embarrassing form this failure takes.
 */
function assemble(
  sentences: { text?: string; doc?: string; para?: number }[],
  validTags: Set<string>,
  paragraphsByTag: Map<string, string[]>,
  /** Dates the validity engine supplied — commencements, the matter timeline. */
  engine: Set<string>
): {
  text: string;
  citations: { tag: string; para: number }[];
  removed: number;
  factOnJudgment: number;
  lawOnPapers: number;
  retagged: number;
  weak: number;
} {
  const citations: { tag: string; para: number }[] = [];
  const checks: CitationCheck[] = [];
  const kept: string[] = [];
  let removed = 0;
  let factOnJudgment = 0;
  let lawOnPapers = 0;
  let retagged = 0;

  for (const s of sentences) {
    const clean = (s.text ?? "").replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const tag = s.doc ?? "";
    let para = Number(s.para);
    const paras = paragraphsByTag.get(tag) ?? [];
    const paragraph = validTags.has(tag) && para >= 1 && para <= paras.length ? paras[para - 1] : null;
    const check = checkCitation(clean, paragraph, tag, para, validTags);
    checks.push(check);

    // "weak-support" is kept: lexical overlap is a coarse signal and a correct
    // paraphrase can score low. "unresolved-doc" and "out-of-range" are not —
    // those mean the cited paragraph does not exist at all.
    if (check.verdict === "unresolved-doc" || check.verdict === "out-of-range" || !paragraph) {
      removed += 1;
      continue;
    }

    let finalTag = tag;
    if (tag !== "p1") {
      const inPara = literalsIn(paragraph);
      // Only literals the cited paragraph does not contain are suspect — and of
      // those, a commencement date the validity engine itself supplied ("BSA
      // S.63 applies w.e.f. 2024-07-01") is not a misattribution at all. It was
      // handed to the model in the flag reason and legitimately belongs in a
      // sentence about a judgment that predates it. Treating those as stray
      // deleted the one kind of sentence this product exists to produce.
      const stray = literals(clean).filter((l) => !inPara.has(l) && !engine.has(l));
      if (stray.length > 0) {
        // The model reliably writes the plaint's own facts against a JUDGMENT's
        // tag. Rather than discard the sentence, look for the paragraph of the
        // papers that actually states it: every literal present and the lexical
        // check passing. That is a verification, not a guess — if no paragraph
        // of the papers supports it either, the sentence is dropped exactly as
        // before, and the count is reported.
        const at = supportingPaper(clean, paragraphsByTag.get("p1") ?? [], validTags);
        if (at === null) {
          factOnJudgment += 1;
          continue;
        }
        finalTag = "p1";
        para = at;
        retagged += 1;
      }
    } else if (HOLDING_LANGUAGE.test(clean)) {
      lawOnPapers += 1;
      continue;
    }

    citations.push({ tag: finalTag, para });
    kept.push(`${clean} [${finalTag}¶${para}]`);
  }

  const audit = summariseChecks(checks, 0);
  return { text: kept.join(" "), citations, removed, factOnJudgment, lawOnPapers, retagged, weak: audit.weak };
}

function prompt(
  question: string,
  dates: MatterDates,
  side: "ours" | "opposing",
  blocks: string,
  sources: DraftSource[]
): string {
  // RETRIEVAL RAIL — judgment text is untrusted input, not instruction.
  const fenced = fenceSources(blocks);
  const stance = side === "ours" ? "the PLAINTIFF" : "the DEFENDANT";
  const hasPapers = sources.some((s) => s.tag === "p1");
  // An explicit legend, built from the sources actually assembled. Without it
  // the model wrote the plaint's facts and tagged them d1 — using the PLAINT's
  // paragraph numbers against a JUDGMENT's tag, because the only example it had
  // said "d1" and both documents number from ¶1.
  const legend = sources
    .map((s) =>
      s.tag === "p1"
        ? `  "p1" = the papers on record in THIS matter (the plaint). FACTS of this case only. It is not authority and states no law.`
        : `  "${s.tag}" = judgment: ${s.title.slice(0, 70)} (${s.date}), flag ${s.flagColor.toUpperCase()}. LAW only. It records other parties' facts, never yours.`
    )
    .join("\n");

  return `Draft written arguments for ${stance} in an Indian commercial suit.

Return ONLY a JSON object of this exact shape, no prose around it:
{"arguments":[{"heading":"short label","sentences":[{"text":"...","doc":"${hasPapers ? "p1" : "d1"}","para":7}],"confidence":0.0}],"abstentions":["..."]}

"doc" MUST be exactly one of these tags — copy it character for character:
${legend}

Every document numbers its own paragraphs from ¶1. "para" is the number inside the block belonging to THAT tag. ${hasPapers ? 'Paragraph 7 of the plaint is {"doc":"p1","para":7}; paragraph 7 of the first judgment is {"doc":"d1","para":7}. They are different paragraphs of different documents.' : ""}

Rules — breaking any of these makes the draft unusable:
1. Every sentence MUST carry doc and para naming the source paragraph that actually states it. A sentence you cannot ground is not written — it goes in "abstentions" as a short description of the missing point.
${hasPapers ? "2. A sentence about what happened in this matter cites p1. A sentence about what the law is cites a dN judgment paragraph. NEVER cite a judgment for a fact of this case: that judgment is between other parties and cannot record your client's dates, amounts or conduct. A sentence carrying a date or a rupee figure from this matter and a dN tag will be deleted.\n" : "2. Do not assert facts about this matter; no papers are on record. Argue the law only.\n"}3. Use ONLY the paragraphs below. Do not cite any case, Act or section that does not appear in them.
4. NEVER write the words RED, AMBER, GREEN or GREY in a drafted sentence. Those are internal engine labels and mean nothing to a court. Say what they mean: "no superseding amendment was found", "the provision it applied has since been replaced", "this was not checked".
5. Where you rely on a source whose provision has been replaced, say so plainly in that sentence and lower the argument's confidence. Do not describe an unchecked source as sound.
6. Write 3 to 4 arguments, 2 to 4 sentences each, court-ready prose. Each argument must contain at least one sentence citing a dN judgment — a submission built only on your own pleading argues nothing. confidence is 0 to 1.

WHAT THE LAWYER ASKED:
${question}

MATTER TIMELINE (every validity flag below was measured against these):
- cause of action: ${dates.cause}
- suit filed: ${dates.suit}
- as of: ${dates.trial}

SOURCES (paragraph-numbered, with the flag the validity engine computed):
${fenced.block}`;
}

export async function draftFromAuthorities(input: {
  question: string;
  dates: MatterDates;
  facts: string;
  authorities: DraftAuthority[];
  side?: "ours" | "opposing";
}): Promise<DraftResult> {
  const side = input.side ?? "ours";
  const papers = input.facts.trim();
  const { sources, paragraphsByTag, blocks } = sourceBlocks(input.authorities, papers);
  if (sources.filter((s) => s.tag !== "p1").length === 0) {
    throw new LlmError(
      "None of the retrieved authorities have full text in the local corpus, so there is nothing to draft from."
    );
  }

  const reply = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt(input.question, input.dates, side, blocks, sources) },
    ],
    { temperature: 0.25, maxTokens: 1600 }
  );

  const data = parseJsonObject<DraftJson>(reply);
  const validTags = new Set(sources.map((s) => s.tag));
  // Everything the engine told the model about dates: amendment commencements in
  // the flag reasons, and the matter's own timeline.
  const engineLiterals = new Set(
    literals(
      [
        ...input.authorities.map((a) => a.reason),
        input.dates.cause,
        input.dates.suit,
        input.dates.trial,
      ].join(" ")
    )
  );
  const prefix = side === "ours" ? "A" : "O";
  const abstentions = (data.abstentions ?? []).filter((a) => typeof a === "string" && a.trim());
  let removedTotal = 0;

  const args: DraftedArgument[] = [];
  let factsOnJudgments = 0;
  let lawOnPapersTotal = 0;
  let retaggedTotal = 0;
  for (const a of (data.arguments ?? []).slice(0, 4)) {
    const { text, citations, removed, factOnJudgment, lawOnPapers, retagged, weak } = assemble(
      a.sentences ?? [],
      validTags,
      paragraphsByTag,
      engineLiterals
    );
    removedTotal += removed;
    factsOnJudgments += factOnJudgment;
    lawOnPapersTotal += lawOnPapers;
    retaggedTotal += retagged;
    if (!text) continue;
    args.push({
      id: `${prefix}${args.length + 1}`,
      side,
      text,
      citations,
      mapping_deps: [],
      // The rail's own findings move the number the panel shows, so a draft
      // whose citations barely match its paragraphs cannot read as confident.
      confidence: Math.max(0.1, Math.min(1, Number(a.confidence) || 0.5) - weak * 0.1),
      status: "verified",
      version: 1,
    });
  }

  if (args.length === 0) {
    // Naming which rail rejected what is the difference between a bug report and
    // a shrug — for the lawyer reading it, and for anyone tuning the prompt.
    const why = [
      removedTotal ? `${removedTotal} cited a paragraph that does not exist` : "",
      factsOnJudgments ? `${factsOnJudgments} attributed a fact of this matter to a judgment` : "",
      lawOnPapersTotal ? `${lawOnPapersTotal} attributed a proposition of law to your own pleading` : "",
    ]
      .filter(Boolean)
      .join(", ");
    throw new LlmError(
      `Every drafted sentence failed the citation check${why ? ` (${why})` : ""} — nothing survived to show you.`
    );
  }
  if (removedTotal > 0) {
    abstentions.push(
      `${removedTotal} sentence${removedTotal === 1 ? " was" : "s were"} removed because the paragraph cited does not exist in the source. Nothing untraceable is shown above.`
    );
  }
  if (factsOnJudgments > 0) {
    abstentions.push(
      `${factsOnJudgments} sentence${factsOnJudgments === 1 ? " was" : "s were"} removed for attributing a fact of this matter to a judgment between other parties, which cannot record it.`
    );
  }
  if (lawOnPapersTotal > 0) {
    abstentions.push(
      `${lawOnPapersTotal} sentence${lawOnPapersTotal === 1 ? " was" : "s were"} removed for citing your own pleading as if it stated a proposition of law.`
    );
  }

  return {
    args,
    sources,
    abstentions,
    removed: removedTotal + factsOnJudgments + lawOnPapersTotal,
    retagged: retaggedTotal,
  };
}
