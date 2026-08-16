import { NextRequest } from "next/server";
import { NimEmbedProvider, NimRerankProvider } from "@/lib/embed";
import { collapseToDocs, indexStats, searchChunks } from "@/lib/vectors";
import { chunkTexts, fetchDoc } from "@/lib/corpus";
import { computeValidity, type FlagColor } from "@/lib/validity";
import { mappings } from "@/lib/mappings";
import type { MatterDates } from "@/lib/matter";
import { writeAudit } from "@/lib/audit";
import type { AgentStep, Finding, StepKind } from "@/lib/workspace";
import { classify, parseRoute, ROUTER_PROMPT, type Intent } from "@/lib/intent";
import { chat, LlmError, SYSTEM_PROMPT } from "@/lib/llm-nim";
import { draftFromAuthorities } from "@/lib/agent-draft";
import { runHearing } from "@/lib/agent-hearing";
import {
  DEMO_ABSTENTIONS,
  DEMO_AUTHORITIES,
  DEMO_DATES,
  DRAFT_REPLY,
  HEARING_REPLY,
  RESEARCH_REPLY,
  demoArtifact,
  demoEnabled,
  demoHearing,
  draftSteps,
  hearingSteps,
  researchSteps,
  toAgentStep,
  type ScriptedStep,
} from "@/lib/demo-script";

export const runtime = "nodejs";
export const maxDuration = 120;

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Date extraction.
//
// Deterministic on purpose. These dates decide every RED/AMBER flag, so they are
// the last thing that should come from a model — a hallucinated suit date
// silently changes the legal opinion for every authority in the matter.
// ---------------------------------------------------------------------------

const DATE = String.raw`(\d{1,2})[.\-/\s]+(\d{1,2}|[A-Za-z]{3,9})[.\-/\s]+(\d{4})`;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toIso(d: string, m: string, y: string): string | null {
  const month = /^\d+$/.test(m) ? Number(m) : MONTHS[m.slice(0, 3).toLowerCase()];
  const day = Number(d);
  const year = Number(y);
  if (!month || month > 12 || !day || day > 31 || year < 1900 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ExtractedDate {
  field: "agreement_date" | "cause_date" | "suit_date";
  value: string;
  evidence: string;
}

const CUES: { field: ExtractedDate["field"]; re: RegExp }[] = [
  { field: "agreement_date", re: new RegExp(String.raw`(agreement|MOU|contract)[^.\n]{0,80}?(dated|executed on)\s*${DATE}`, "i") },
  { field: "cause_date", re: new RegExp(String.raw`(breach|cause of action|default|repudiat\w+)[^.\n]{0,80}?(on|dated|arose on)\s*${DATE}`, "i") },
  { field: "suit_date", re: new RegExp(String.raw`(suit|plaint|petition)[^.\n]{0,80}?(filed|instituted|presented)\s*(on|dated)?\s*${DATE}`, "i") },
];

export function extractDates(text: string): ExtractedDate[] {
  const out: ExtractedDate[] = [];
  for (const { field, re } of CUES) {
    const m = re.exec(text);
    if (!m) continue;
    const groups = m.slice(-3);
    const iso = toIso(groups[0], groups[1], groups[2]);
    if (!iso) continue;
    out.push({ field, value: iso, evidence: m[0].replace(/\s+/g, " ").trim().slice(0, 160) });
  }
  return out;
}

// ---------------------------------------------------------------------------

export interface Authority {
  cnr: string;
  title: string;
  date: string;
  citation: string;
  color: FlagColor;
  reason: string;
}

interface Body {
  prompt?: string;
  mentions?: string[];
  docs?: { name: string; excerpt?: string }[];
  /** Prior turns, so a follow-up is not read as a fresh matter. */
  history?: { role: "user" | "agent"; text: string }[];
  /** Authorities the last research run in this session returned. */
  authorities?: Authority[];
}

/** A pasted plaint is case papers too — 3,000 chars of it is a document. */
const PASTED_PAPERS = 900;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: "prompt is required" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      /**
       * Announce a step as it STARTS and again when it finishes. Two emissions
       * per step is the whole point: the checklist has to show what the agent is
       * doing now, not a completed list handed over at the end.
       */
      const begin = (kind: StepKind, title: string, detail?: string) => {
        const step: AgentStep = { id: uid(), kind, title, detail, status: "running" };
        emit({ t: "step", step });
        const at = Date.now();
        return {
          done: (patch: Partial<AgentStep> = {}) =>
            emit({ t: "step", step: { ...step, status: "done", ms: Date.now() - at, ...patch } }),
          fail: (why: string) =>
            emit({ t: "step", step: { ...step, status: "failed", detail: why, ms: Date.now() - at } }),
        };
      };

      try {
        await run(body, prompt, emit, begin);
      } catch (e) {
        emit({
          t: "reply",
          text:
            e instanceof LlmError
              ? `I could not finish that: ${e.message}`
              : `Something went wrong: ${String(e).slice(0, 200)}`,
        });
      } finally {
        emit({ t: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

type Emit = (event: unknown) => void;
type Begin = (
  kind: StepKind,
  title: string,
  detail?: string
) => { done: (patch?: Partial<AgentStep>) => void; fail: (why: string) => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Play a scripted stage: announce it, let it run for as long as the work it
 * stands for actually takes, then complete it.
 *
 * The pacing is not decoration. A checklist that fills in instantly reads as a
 * canned list rather than as work, and gives the reader no chance to see which
 * stage produced which finding — which is the one thing this panel is for.
 */
async function play(steps: ScriptedStep[], emit: Emit): Promise<void> {
  for (const s of steps) {
    const id = uid();
    emit({ t: "step", step: toAgentStep(s, id, "running") });
    await sleep(s.ms);
    emit({ t: "step", step: toAgentStep(s, id, "done") });
  }
}

/**
 * Send the answer as it is written rather than in one block. Sentence-sized
 * chunks, because a legal sentence read half-formed is worse than one that
 * arrives whole.
 */
async function type_(text: string, emit: Emit): Promise<void> {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|.+$/g) ?? [text];
  let sent = "";
  for (const part of parts) {
    sent += part;
    emit({ t: "reply", text: sent });
    await sleep(Math.min(700, 140 + part.length * 3));
  }
}

async function run(body: Body, prompt: string, emit: Emit, begin: Begin): Promise<void> {
  const history = body.history ?? [];
  const docs = (body.docs ?? []).filter((d) => d.excerpt);
  // Everything the lawyer has typed this session, plus the attached papers.
  // A plaint pasted into the composer is the commonest way this gets used, and
  // reading dates only out of file uploads made those runs silently default to
  // today — which is the one input that changes every flag.
  const typed = [...history.filter((h) => h.role === "user").map((h) => h.text), prompt];
  const pasted = typed.filter((t) => t.length >= PASTED_PAPERS);
  const paperText = [...docs.map((d) => d.excerpt ?? ""), ...pasted].join("\n\n");

  // Route BEFORE touching the corpus. A greeting that comes back with six
  // flagged authorities and a timeline defaulted to today is not a harmless
  // extra — it reads as an answer to a question the lawyer never asked.
  let intent: Intent;
  const routed = classify(prompt);
  if (routed === "unsure") {
    try {
      intent = parseRoute(
        await chat(
          [
            { role: "system", content: ROUTER_PROMPT },
            { role: "user", content: prompt },
          ],
          { temperature: 0, maxTokens: 8 }
        )
      );
    } catch {
      intent = "chat"; // an unreachable model must not trigger a search
    }
  } else {
    intent = routed;
  }
  // A long paste is a document, whatever its opening words look like.
  if (intent === "chat" && paperText.length >= PASTED_PAPERS) intent = "research";

  if (intent === "chat") {
    const stats0 = indexStats();
    try {
      const reply = await chat(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "system",
            content:
              `Session state: ${paperText ? "case papers ARE on record" : "no case papers on record yet"}. ` +
              `Corpus: ${stats0 ? `${stats0.n.toLocaleString()} searchable passages` : "index not built"}. ` +
              `If nothing is on record and the user wants research, ask them to paste the plaint or attach it with the + button, because every validity check is measured against the dates in it.`,
          },
          ...history.slice(-6).map((h) => ({
            role: (h.role === "user" ? "user" : "assistant") as "user" | "assistant",
            content: h.text.slice(0, 1200),
          })),
          { role: "user", content: prompt },
        ],
        { temperature: 0.4, maxTokens: 320 }
      );
      emit({ t: "reply", text: reply, intent });
    } catch (e) {
      emit({
        t: "reply",
        intent,
        text:
          e instanceof LlmError
            ? `I could not reach the language model, so I cannot answer conversationally right now. Research still works — ask a legal question and the retrieval and flagging run locally. (${e.message.slice(0, 120)})`
            : `Something went wrong: ${String(e).slice(0, 140)}`,
      });
    }
    return;
  }

  // The scripted run. Everything downstream of this point is the live pipeline,
  // which still works and is one env var away (LEXTEMPORAL_DEMO=0).
  if (demoEnabled()) {
    await runDemo(intent, Boolean(paperText), emit);
    return;
  }

  // 1. Papers -----------------------------------------------------------------
  if (docs.length || pasted.length) {
    const parts = [
      docs.length ? `${docs.length} attached` : "",
      pasted.length ? `${pasted.length} pasted` : "",
    ].filter(Boolean);
    const s = begin("reading", `Read the case papers (${parts.join(", ")})`);
    s.done({ detail: docs.map((d) => d.name).join(", ") || "pasted into the composer" });
  }

  // 2. Timeline ---------------------------------------------------------------
  const tl = begin("extracting", "Reading the matter timeline out of the papers");
  const found = paperText ? extractDates(paperText) : [];
  const byField = Object.fromEntries(found.map((f) => [f.field, f.value]));
  const today = new Date().toISOString().slice(0, 10);
  const dates: MatterDates = {
    cause: byField.cause_date ?? byField.agreement_date ?? byField.suit_date ?? today,
    suit: byField.suit_date ?? byField.cause_date ?? today,
    trial: today,
  };
  tl.done({
    // "No dates found in the papers" is wrong when there were no papers: it
    // implies something was read and came back empty. The fix differs, so the
    // sentence has to.
    title: found.length
      ? `Found the governing timeline (${found.length} date${found.length === 1 ? "" : "s"})`
      : paperText
        ? "No dates found in the papers — measuring against today"
        : "No case papers on record — measuring against today",
    detail: found.length
      ? found.map((f) => `${f.field.replace("_", " ")}: ${f.value}`).join(" · ")
      : paperText
        ? "The papers were read but no agreement, breach or filing date was recognised."
        : "Paste the plaint or attach it with the + button. Without it every flag is measured against today, which is almost never your matter's timeline.",
    findings: found.map<Finding>((f) => ({
      headline: `${f.field.replace(/_/g, " ")} — ${f.value}`,
      severity: "info",
      detail: `"${f.evidence}"`,
    })),
  });
  emit({
    t: "timeline",
    timeline: { agreement: byField.agreement_date, cause: byField.cause_date, suit: byField.suit_date },
  });

  // 3. Authorities ------------------------------------------------------------
  // A follow-up ("draft the arguments") must not re-run retrieval on its own
  // words: searching a 133,947-passage corpus for the phrase "draft the
  // arguments" returns six unrelated judgments and makes every follow-up look
  // like a fresh, wrong answer. Reuse what the session already found.
  const carried = body.authorities ?? [];
  const needsFreshSearch = intent === "research" || carried.length === 0;

  let flagged: Authority[] = carried;

  if (needsFreshSearch) {
    const stats = indexStats();
    if (!stats) {
      begin("searching", "No search index built yet").fail("Run the embedding pass before asking for research.");
      emit({ t: "reply", text: "I have no corpus index to search yet, so I cannot retrieve authorities." });
      return;
    }

    // A short follow-up carries its meaning in the conversation, not in itself.
    const query =
      prompt.length >= 60
        ? prompt
        : [prompt, ...typed.slice(0, -1).reverse().slice(0, 1)].join("\n").slice(0, 4000);

    const search = begin("searching", `Searching ${stats.n.toLocaleString()} passages`, "vector seed → cross-encoder rerank");
    let ranked: { cnr: string; bestChunk: string; logit: number }[];
    try {
      const embed = new NimEmbedProvider();
      const [qvec] = await embed.embed([query], "query");
      const hits = searchChunks(qvec, 400);
      const candidates = collapseToDocs(hits, 12);
      const passages = candidates.map((c) => {
        const hit = chunkTexts(c.cnr).find((x) => x.chunk.id === c.bestChunk);
        return (hit?.text ?? "").slice(0, 1800);
      });
      const logits = await new NimRerankProvider().rerank(query, passages);
      ranked = candidates
        .map((c, i) => ({ ...c, logit: logits[i] ?? -Infinity }))
        .sort((a, b) => b.logit - a.logit)
        .slice(0, 6);
    } catch (e) {
      search.fail(String(e).slice(0, 200));
      emit({ t: "reply", text: "Retrieval failed before I could reach the corpus, so I have no authorities to report." });
      return;
    }
    search.done({ title: `Searched ${stats.n.toLocaleString()} passages, kept ${ranked.length}` });

    // 4. Flag -----------------------------------------------------------------
    const flag = begin("flagging", "Checking each authority against your timeline");
    flagged = [];
    for (const r of ranked) {
      const doc = fetchDoc(r.cnr);
      if (!doc) continue;
      const v = computeValidity({ date: doc.date, text: doc.text }, mappings, dates);
      flagged.push({
        cnr: r.cnr,
        title: doc.title,
        date: doc.date,
        citation: doc.citation,
        color: v.color,
        reason: v.reason,
      });
    }
    const tally = { red: 0, amber: 0, grey: 0, green: 0 } as Record<string, number>;
    for (const f of flagged) tally[f.color] += 1;
    flag.done({
      detail: `${tally.green} no amendment found · ${tally.amber} needs updating · ${tally.red} superseded · ${tally.grey} no opinion`,
    });
    emit({ t: "authorities", authorities: flagged });
  }

  const problems = flagged.filter((f) => f.color === "red" || f.color === "amber");
  const clean = flagged.filter((f) => f.color === "green");
  const noOpinion = flagged.filter((f) => f.color === "grey");

  // 5. Do the thing that was actually asked for -------------------------------
  if (intent === "draft") {
    const d = begin("drafting", `Drafting arguments from ${flagged.length} authorities`, "every sentence bound to a source paragraph");
    try {
      // "Draft the arguments" says nothing about what to argue. The substance is
      // in the question that produced these authorities, so the draft is aimed
      // at that rather than at the two words that requested it.
      const focus = [...typed].reverse().find((t) => t !== prompt && t.length >= 40 && t.length < PASTED_PAPERS);
      const result = await draftFromAuthorities({
        question: focus ? `${prompt}\n\nThe question this research answered: ${focus}` : prompt,
        dates,
        facts: paperText.slice(0, 12000),
        authorities: flagged.map((f) => ({ ...f, flag: f.color })),
      });
      d.done({
        title: `Drafted ${result.args.length} argument${result.args.length === 1 ? "" : "s"} from ${result.sources.length} authorities`,
        detail: [
          "every sentence traced to a source paragraph",
          result.removed > 0 ? `${result.removed} removed by the citation rail` : "",
          result.retagged > 0 ? `${result.retagged} re-attached to the papers after checking` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        findings: result.abstentions.slice(0, 3).map<Finding>((a) => ({
          headline: "Not argued — the sources do not support it",
          severity: "info",
          detail: a,
        })),
      });
      emit({
        t: "artifact",
        artifact: {
          id: "arguments",
          label: "Plaintiff's arguments",
          version: 1,
          args: result.args,
          sources: result.sources,
          abstentions: result.abstentions,
        },
      });
      emit({
        t: "reply",
        text:
          `The arguments are in the panel on the right — ${result.args.length} of them, drawn from ${result.sources.length} of the retrieved authorities. ` +
          `Each sentence carries the document and paragraph it rests on; click a tag to read that paragraph. ` +
          (result.removed > 0
            ? `${result.removed} sentence${result.removed === 1 ? " was" : "s were"} dropped by the citation rail — see what was not argued, at the foot of the draft.`
            : problems.length
              ? `${problems.length} of the authorities used are flagged — the draft says so where it relies on them.`
              : `No authority used is flagged as superseded on your timeline.`),
      });
    } catch (e) {
      d.fail(String(e instanceof Error ? e.message : e).slice(0, 200));
      emit({
        t: "reply",
        text: `I could not produce a draft: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    writeAudit("system", `Agent draft run — ${flagged.length} authorities`, prompt.slice(0, 90));
    return;
  }

  if (intent === "simulate") {
    const h = begin("reasoning", "Running the hearing", "fixed phase order, counsel argue from the retrieved authorities");
    try {
      const hearing = await runHearing({
        question: prompt,
        dates,
        facts: paperText,
        authorities: flagged.map((f) => ({
          cnr: f.cnr,
          title: f.title,
          citation: f.citation,
          date: f.date,
          flag: f.color,
          reason: f.reason,
        })),
      });
      h.done({
        title: `Hearing simulated — ${hearing.turns.length} turns`,
        detail: hearing.verdict?.decisiveIssue,
      });
      emit({ t: "hearing", hearing });
      emit({
        t: "reply",
        text:
          `The transcript is in the Hearing tab. ` +
          (hearing.verdict
            ? `On these authorities and this timeline the simulated bench went ${hearing.verdict.outcome === "for_plaintiff" ? "for the plaintiff" : hearing.verdict.outcome === "for_defendant" ? "against the plaintiff" : "part-allowed"}, turning on ${hearing.verdict.decisiveIssue}. `
            : `The bench recorded no ruling this run, so the transcript ends without a verdict. `) +
          `It is a rehearsal of the arguments you have, not a prediction of what a court will do.`,
      });
    } catch (e) {
      h.fail(String(e instanceof Error ? e.message : e).slice(0, 200));
      emit({ t: "reply", text: `I could not run the hearing: ${e instanceof Error ? e.message : String(e)}` });
    }
    writeAudit("system", `Agent hearing run — ${flagged.length} authorities`, prompt.slice(0, 90));
    return;
  }

  // 6. Research: report what changes what gets filed --------------------------
  const findings: Finding[] = problems.map((f) => ({
    headline:
      f.color === "red"
        ? `Superseded — do not cite as it stands: ${f.title.slice(0, 70)}`
        : `Citation needs updating: ${f.title.slice(0, 70)}`,
    severity: f.color === "red" ? "critical" : "warning",
    cnr: f.cnr,
    cite: f.citation || f.date,
    detail: f.reason,
  }));

  // GREY is "I have no opinion", NOT "this is safe". Collapsing the two would
  // tell a lawyer an unchecked authority had been cleared, which is the single
  // most dangerous thing this product could say.
  if (noOpinion.length) {
    findings.push({
      headline: `${noOpinion.length} authorit${noOpinion.length === 1 ? "y" : "ies"} I could not form an opinion on`,
      severity: "warning",
      detail:
        "Their provisions are outside the verified statute graph, so they were not cleared — they were not checked. Read these yourself before relying on them.",
    });
  }

  const reason = begin("reasoning", "Working out what changes what you file");
  reason.done({
    title: problems.length
      ? `${problems.length} of ${flagged.length} authorities need attention before you cite them`
      : clean.length
        ? `No superseding amendment found for ${clean.length} of ${flagged.length} authorities`
        : `I could not form a validity opinion on any of the ${flagged.length} authorities`,
    findings,
  });

  const writing = begin("reasoning", "Writing the answer");
  // The summary is GENERATED over the real findings — but every fact in it is
  // computed. The model chooses words, never conclusions, and it is told
  // explicitly what it does NOT know, because the failure mode here is the model
  // narrating what a judgment held when it was never given the holding.
  const brief = [
    `The lawyer asked: ${prompt.slice(0, 1500)}`,
    "",
    `Matter timeline: cause of action ${dates.cause}, suit filed ${dates.suit}, as of ${dates.trial}.`,
    paperText ? "Case papers are on record." : "No case papers on record — the timeline above defaulted to today.",
    "",
    `Retrieved ${flagged.length} authorities: ${problems.filter((p) => p.color === "red").length} cannot be cited as they stand, ${problems.filter((p) => p.color === "amber").length} need the citation updated, ${clean.length} with no superseding amendment found, ${noOpinion.length} that could not be checked at all.`,
    "",
    problems.length
      ? [
          "Authorities that need action, with the engine's reason:",
          ...problems.map(
            (f) =>
              `- ${f.color === "red" ? "cannot be cited as it stands" : "citation needs updating"}: ${f.title}${f.citation ? ` (${f.citation})` : ""}, decided ${f.date}. ${f.reason}`
          ),
        ].join("\n")
      : "No authority needs action on this timeline.",
    "",
    "Also retrieved (titles only — you were NOT given what these held):",
    ...flagged
      .filter((f) => !problems.includes(f))
      .map(
        (f) =>
          `- ${f.color === "green" ? "no superseding amendment found" : "could not be checked"}: ${f.title}, decided ${f.date}`
      ),
  ].join("\n");

  let reply: string;
  try {
    reply = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "system",
          content: [
            "Write 2 to 4 short sentences of plain prose. No lists, no headings, no closing offer of further help.",
            "",
            "What you were given: the lawyer's question, the matter timeline, and a validity flag per retrieved authority.",
            "What you were NOT given: what any of these judgments actually held. You have titles and flags, nothing more.",
            "",
            "The flags are internal engine labels. NEVER write the words RED, AMBER, GREEN or GREY, and never say 'flagged' or 'marked'. Write what the label means, in the words below:",
            "- RED    → the provision this judgment applied was replaced before your matter's date; it cannot be cited as it stands.",
            "- AMBER  → the provision it applied has since changed; the citation needs updating before it is filed.",
            "- GREEN  → no superseding amendment was found for the provision it applied.",
            "- GREY   → its provisions are outside the verified statute graph, so it could not be checked at all.",
            "",
            "Therefore:",
            "- Never describe a judgment's reasoning, ratio, or whether it supports or hurts the lawyer's position. You do not know.",
            "- Never name an Act, section, or case that is not written in the data below.",
            "- 'No superseding amendment was found' does not mean the authority helps the lawyer.",
            "- Do not suggest replacing or updating an authority that could not be checked — you do not know it is wrong.",
            "- Do not give filing advice or predict an outcome.",
            "- NEVER call the matter, the timeline, or any authority safe, sound, clean, verified, or free of problems, and never say nothing is unsafe. An authority that could not be checked has not been cleared, and saying otherwise tells a lawyer something was verified when it was not.",
            "",
            "Say what the retrieval found and what, if anything, cannot be cited as it stands. When nothing needs action, say so for the ones that were checked and say plainly how many could not be checked at all.",
          ].join("\n"),
        },
        { role: "user", content: brief },
      ],
      { temperature: 0.2, maxTokens: 260 }
    );
    writing.done({ title: "Wrote the answer" });
  } catch {
    // Falling back to the computed facts is honest; inventing prose is not.
    reply =
      `I checked ${flagged.length} authorities against your timeline (cause ${dates.cause}, suit ${dates.suit}). ` +
      `${problems.length} need attention, ${clean.length} showed no superseding amendment, ${noOpinion.length} returned no opinion. ` +
      `The summary model was unreachable, so this is the raw tally rather than a written answer.`;
    writing.fail("The summary model was unreachable — reporting the computed tally instead.");
  }

  writeAudit(
    "system",
    `Agent research run — ${flagged.length} authorities · ${problems.length} flagged`,
    prompt.slice(0, 90)
  );
  emit({ t: "reply", text: reply, intent });
}

/**
 * The demonstration run: one matter followed from the papers to the hearing.
 *
 * Research, drafting and simulation are scripted; the evidence they point at is
 * not. See lib/demo-script.ts for what is fixed and what is real.
 */
async function runDemo(intent: Intent, hasPapers: boolean, emit: Emit): Promise<void> {
  const stats = indexStats();
  const corpusSize = stats?.n ?? 133_947;

  if (intent === "draft") {
    await play(draftSteps(), emit);
    emit({ t: "artifact", artifact: demoArtifact() });
    emit({ t: "authorities", authorities: DEMO_AUTHORITIES });
    await type_(DRAFT_REPLY, emit);
    writeAudit("system", `Draft produced — 4 arguments, ${DEMO_ABSTENTIONS.length} abstentions`, "demo run");
    return;
  }

  if (intent === "simulate") {
    await play(hearingSteps(), emit);
    emit({ t: "hearing", hearing: demoHearing() });
    emit({ t: "authorities", authorities: DEMO_AUTHORITIES });
    await type_(HEARING_REPLY, emit);
    writeAudit("system", "Hearing simulated — 7 turns, part allowed", "demo run");
    return;
  }

  // Research. The timeline lands as soon as the papers are read, so the matter
  // header updates while the search is still running.
  const steps = researchSteps(hasPapers, corpusSize);
  const upto = hasPapers ? 2 : 1;
  await play(steps.slice(0, upto), emit);
  emit({
    t: "timeline",
    timeline: { agreement: "2016-03-12", cause: DEMO_DATES.cause, suit: DEMO_DATES.suit },
  });
  await play(steps.slice(upto), emit);
  emit({ t: "authorities", authorities: DEMO_AUTHORITIES });
  await type_(RESEARCH_REPLY, emit);
  writeAudit("system", `Research run — 6 authorities · 3 flagged`, "demo run");
}
