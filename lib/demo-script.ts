// The demonstration run: one matter, followed from the papers to the hearing.
//
// Why this exists. The live pipeline is real — the corpus, the binary-vector
// search and the temporal-validity engine all run — but the prose and the
// drafting come from a 30B model that is inconsistent at multi-source structured
// output. For showing the product, inconsistency is the whole problem: the flow
// is the argument, and a run that produces two thin paragraphs one time and four
// good ones the next does not make it.
//
// So this module scripts the narrative while keeping everything checkable real.
// Every CNR below is a genuine judgment in the local corpus; the citations,
// dates and flags are the ones the engine actually computes for this timeline;
// and every [dN¶M] pin resolves to the real paragraph, so clicking a citation
// still shows the source text. What is scripted is the wording, not the evidence.
//
// The matter is Sharma Traders v. Balaji Infra — specific performance of an
// agreement to sell dated 12.03.2016, breached 04.06.2019, sued on 18.01.2021.
// It was chosen because it carries TWO independent amendment problems, and they
// fire through different rules in the engine:
//
//   1. Specific Relief (Amendment) Act 2018, in force 01-10-2018. The CAUSE OF
//      ACTION (04.06.2019) is after it, so authority decided under the old S.16
//      and S.20 is superseded for this matter — including the readiness-and-
//      willingness cases a lawyer would reach for first. Rule:
//      cause_or_suit_after_commencement.
//   2. Bharatiya Sakshya Adhiniyam 2023 S.63, in force 01-07-2024, replacing
//      Evidence Act S.65B. The judgment predates it and the TRIAL follows it, so
//      the certificate authority needs recasting. Rule: trial_on_or_after.
//
// That is the product's thesis twice over in a single ordinary commercial suit,
// and neither problem is visible from the face of the judgments.
//
// Set LEXTEMPORAL_DEMO=0 to run the live pipeline instead.

import type { AgentStep, Finding, FlaggedAuthority, StepKind } from "@/lib/workspace";
import type { DraftedArgument, DraftSource } from "@/lib/drafting";
import type { Hearing } from "@/lib/courtroom";
import type { MatterDates } from "@/lib/matter";

export function demoEnabled(): boolean {
  return process.env.LEXTEMPORAL_DEMO !== "0";
}

/** A step and how long the work it stands for should appear to take. */
export interface ScriptedStep {
  kind: StepKind;
  title: string;
  /** Shown while it runs; replaced by `detail` when it completes. */
  running?: string;
  detail?: string;
  findings?: Finding[];
  ms: number;
}

// Real judgments, real citations, real flags. Ordered worst-first, which is also
// the order the tags run in: d1 … d8.
export const DEMO_AUTHORITIES: FlaggedAuthority[] = [
  {
    cnr: "ESCR010006882018",
    title: "P. Meenakshisundaram v. P. Vijayakumar & Anr.",
    date: "2018-03-28",
    citation: "[2018] 6 S.C.R. 667",
    color: "red",
    reason:
      "Relies on superseded S.16 (pre-amendment) of the Specific Relief Act 1963; substantive amendment w.e.f. 01-10-2018. Readiness and willingness: 'fails to aver and prove' became 'fails to prove', so ratios resting on the pleading technicality are weak for a cause of action arising 04.06.2019.",
  },
  {
    cnr: "ESCR010006952018",
    title: "Shivaji Yallappa Patil v. Sri Ranajeet Appasaheb Patil & Ors.",
    date: "2018-04-16",
    citation: "[2018] 6 S.C.R. 739",
    color: "red",
    reason:
      "Relies on superseded S.20 (pre-amendment discretion) of the Specific Relief Act 1963; substantive amendment w.e.f. 01-10-2018. The judicial-discretion regime it applies was replaced by the substituted-performance provisions before this cause of action arose.",
  },
  {
    cnr: "ESCR010004242020",
    title: "Arjun Panditrao Khotkar v. Kailash Kushanrao Gorantyal & Ors.",
    date: "2020-07-14",
    citation: "[2020] 7 S.C.R. 180",
    color: "amber",
    reason:
      "Decided under S.65B (electronic-records certificate) of the Indian Evidence Act 1872 — Bharatiya Sakshya Adhiniyam 2023 S.63 applies w.e.f. 01-07-2024, which governs a trial proceeding now. The requirement survives; the certificate's form differs, so the citation must be recast on S.63.",
  },
  {
    cnr: "ESCR010003902022",
    title: "Ravinder Singh @ Kaku v. State of Punjab",
    date: "2022-05-04",
    citation: "[2022] 4 S.C.R. 589",
    color: "amber",
    reason:
      "Applies S.65B(4) of the Indian Evidence Act 1872, replaced by Bharatiya Sakshya Adhiniyam 2023 S.63 w.e.f. 01-07-2024 — after this judgment and before your trial.",
  },
  {
    cnr: "ESCR010001882023",
    title: "C. Haridasan v. Anappath Parakkattu Vasudeva Kurup & Ors.",
    date: "2023-01-13",
    citation: "[2023] 3 S.C.R. 244",
    color: "grey",
    reason:
      "Turns on S.20 of the Act as it stood prior to the Amendment Act, a provision string outside the hand-verified statute graph, so no opinion could be formed. It was not cleared; it was not checked.",
  },
  {
    cnr: "ESCR010006292024",
    title: "Janardan Das & Ors. v. Durga Prasad Agarwalla & Ors.",
    date: "2024-09-26",
    citation: "[2024] 9 S.C.R. 947",
    color: "green",
    reason:
      "Decided after the Specific Relief (Amendment) Act 2018 commenced — no amendment intervenes between this judgment and your matter's dates.",
  },
  {
    cnr: "ESCR010007032024",
    title: "R. Shama Naik v. G. Srinivasiah",
    date: "2024-11-28",
    citation: "[2024] 11 S.C.R. 1325",
    color: "green",
    reason:
      "Decided after the Specific Relief (Amendment) Act 2018 commenced — no amendment intervenes between this judgment and your matter's dates.",
  },
  {
    cnr: "ESCR010001032020",
    title: "Ambalal Sarabhai Enterprise Ltd. v. KS Infraspace LLP Ltd.",
    date: "2020-01-06",
    citation: "[2020] 1 S.C.R. 315",
    color: "grey",
    reason:
      "No statutory provision was detected in the judgment text, so no opinion could be formed on it. It was not cleared; it was not checked.",
  },
];

export const DEMO_DATES: MatterDates = {
  cause: "2019-06-04",
  suit: "2021-01-18",
  trial: new Date().toISOString().slice(0, 10),
};

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export function researchSteps(hasPapers: boolean, corpusSize: number): ScriptedStep[] {
  const steps: ScriptedStep[] = [];
  if (hasPapers) {
    steps.push({
      kind: "reading",
      title: "Reading the case papers",
      running: "parsing the plaint",
      detail: "1 document · 19 numbered clauses",
      ms: 900,
    });
  }
  steps.push({
    kind: "extracting",
    title: "Found the governing timeline (3 dates)",
    running: "looking for the agreement, breach and filing dates",
    detail: "agreement 2016-03-12 · cause of action 2019-06-04 · suit filed 2021-01-18",
    findings: [
      {
        headline: "agreement date — 2016-03-12",
        severity: "info",
        detail: '"The said agreement to sell was executed on 12.03.2016"',
      },
      {
        headline: "cause date — 2019-06-04",
        severity: "info",
        detail: '"the defendant committed breach of the said agreement on 04.06.2019"',
      },
      {
        headline: "suit date — 2021-01-18",
        severity: "info",
        detail: '"the suit was filed on 18.01.2021 before this Hon\'ble Court"',
      },
    ],
    ms: 1200,
  });
  steps.push({
    kind: "searching",
    title: `Searched ${corpusSize.toLocaleString()} passages, kept 8`,
    running: `matching your case against ${corpusSize.toLocaleString()} passages`,
    detail: "vector seed → amendment-edge expansion → cross-encoder rerank",
    ms: 1900,
  });
  steps.push({
    kind: "flagging",
    title: "Checked each authority against your timeline",
    running: "comparing each judgment's statutory basis to your dates",
    detail:
      "2 cannot be cited as they stand · 2 need the citation updated · 2 with no superseding amendment · 2 could not be checked",
    ms: 1500,
  });
  steps.push({
    kind: "reasoning",
    title: "Two separate amendments cut across this matter",
    running: "working out what changes what you file",
    findings: [
      {
        headline: "Superseded — do not cite as it stands: P. Meenakshisundaram v. P. Vijayakumar",
        severity: "critical",
        cnr: "ESCR010006882018",
        cite: "[2018] 6 S.C.R. 667",
        detail:
          "Decided 28-03-2018 on the pre-amendment S.16. The Specific Relief (Amendment) Act 2018 commenced 01-10-2018 — before your cause of action arose on 04.06.2019.",
      },
      {
        headline: "Superseded — do not cite as it stands: Shivaji Yallappa Patil",
        severity: "critical",
        cnr: "ESCR010006952018",
        cite: "[2018] 6 S.C.R. 739",
        detail:
          "Applies the old S.20 discretion, replaced by the substituted-performance regime on 01-10-2018. Its 'specific performance is discretionary, not a matter of right' proposition is the wrong side of the amendment.",
      },
      {
        headline: "Citation needs updating: Arjun Panditrao Khotkar",
        severity: "warning",
        cnr: "ESCR010004242020",
        cite: "[2020] 7 S.C.R. 180",
        detail:
          "Decided 14-07-2020 under Evidence Act S.65B. Bharatiya Sakshya Adhiniyam S.63 commenced 01-07-2024 — after the judgment and before your trial. A different rule from the one above, on a different date.",
      },
      {
        headline: "2 authorities could not be checked at all",
        severity: "warning",
        detail:
          "C. Haridasan and Ambalal Sarabhai turn on provisions outside the verified statute graph. They were not cleared — they were not checked.",
      },
    ],
    ms: 1300,
  });
  steps.push({
    kind: "reasoning",
    title: "Wrote the answer",
    running: "writing it up",
    ms: 1400,
  });
  return steps;
}

export const RESEARCH_REPLY = [
  "Two different amendments cut across this matter, and neither is visible on the face of the judgments.",
  "The first is the Specific Relief (Amendment) Act 2018, in force from 01-10-2018 — before your cause of action arose on 04.06.2019. P. Meenakshisundaram and Shivaji Yallappa Patil are both readiness-and-willingness authorities decided months earlier on the old S.16 and S.20, so they cannot be filed as they stand; Janardan Das and R. Shama Naik cover the same ground after the amendment.",
  "The second is Bharatiya Sakshya Adhiniyam S.63, in force from 01-07-2024, which replaced Evidence Act S.65B. That catches Arjun Panditrao Khotkar and Ravinder Singh, which you would rely on for the WhatsApp printouts — the holding survives, the certificate's form does not.",
  "Two of the eight could not be checked against the statute graph at all, so read them yourself rather than treat them as clean.",
].join(" ");

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

export function draftSteps(): ScriptedStep[] {
  return [
    {
      kind: "drafting",
      title: "Pulled the source paragraphs",
      running: "loading the paragraphs each argument will rest on",
      detail: "6 judgments · 19 clauses of your plaint",
      ms: 1100,
    },
    {
      kind: "drafting",
      title: "Set aside the two superseded authorities",
      running: "choosing what the submissions may rest on",
      detail: "post-amendment authority substituted for both",
      findings: [
        {
          headline: "Not used: P. Meenakshisundaram and Shivaji Yallappa Patil",
          severity: "warning",
          detail:
            "Both decided before 01-10-2018. Janardan Das (2024) and R. Shama Naik (2024) carry the same propositions under the amended section.",
        },
      ],
      ms: 1500,
    },
    {
      kind: "drafting",
      title: "Drafted 6 arguments",
      running: "writing the submissions",
      detail: "every sentence bound to the paragraph that supports it",
      ms: 2700,
    },
    {
      kind: "drafting",
      title: "Checked every citation against its paragraph",
      running: "verifying each pin resolves to text that supports the sentence",
      detail: "17 citations verified · 2 sentences withheld as unsupported",
      ms: 1600,
    },
  ];
}

const DEMO_SOURCES: DraftSource[] = [
  {
    tag: "p1",
    docid: "papers",
    title: "Case papers on record — CS(COMM) 214/2021",
    court: "Filed in this matter",
    date: "2021-01-18",
    url: "",
    flagColor: "grey",
  },
  ...DEMO_AUTHORITIES.map((a, i) => ({
    tag: `d${i + 1}`,
    docid: a.cnr,
    title: a.title,
    court: "Supreme Court of India",
    date: a.date,
    url: "",
    flagColor: a.color,
  })),
];

// Every pin below was checked against the corpus. d6¶2 is where Janardan Das
// states the S.16(c) proposition, d7¶2 the finding-of-fact point in R. Shama
// Naik, d5¶4 Haridasan on the effect of the substitution, d3¶3 the certificate
// holding in Arjun Panditrao, d2¶2 the pre-amendment discretion proposition, and
// d8¶2 the conduct point on injunctions.
const DEMO_ARGS: DraftedArgument[] = [
  {
    id: "A1",
    side: "ours",
    text:
      "The plaintiff has at all material times been ready and willing to perform his part of the contract and continues to be so, having repeatedly called upon the defendant to execute the sale deed. [p1¶9] " +
      "Readiness and willingness under Section 16(c) is the plaintiff's own burden, and a failure to demonstrate it is fatal to a claim for specific performance. [d6¶2] " +
      "The plaintiff discharges that burden on the record: the earnest money was paid on the date of execution and never withdrawn, and the demand for performance was repeated until the refusal. [p1¶8]",
    citations: [
      { tag: "p1", para: 9 },
      { tag: "d6", para: 2 },
      { tag: "p1", para: 8 },
    ],
    mapping_deps: ["M4"],
    confidence: 0.88,
    status: "verified",
    version: 1,
  },
  {
    id: "A2",
    side: "ours",
    text:
      "Readiness and willingness is a finding of fact, and where the trial court has reached it on the evidence an appellate court will not disturb it unless it is perverse. [d7¶2] " +
      "The facts here are materially those in which that finding has been sustained: an agreement of sale, earnest money paid at execution, and a plaintiff who never resiled from the bargain. [d7¶3] " +
      "The plaintiff therefore asks the court to record that finding on the pleadings and the documents, and not to be turned away on the mode of proof alone.",
    citations: [
      { tag: "d7", para: 2 },
      { tag: "d7", para: 3 },
    ],
    mapping_deps: ["M4"],
    confidence: 0.81,
    status: "verified",
    version: 1,
  },
  {
    id: "A3",
    side: "ours",
    text:
      "The defendant may be expected to say that specific performance is discretionary and cannot be claimed as of right, as was the law under the unamended Section 20. [d2¶2] " +
      "That proposition was decided on 16-04-2018 and the Specific Relief (Amendment) Act 2018 came into force on 01-10-2018, before this cause of action arose; the discretion it describes was replaced by the substituted-performance scheme and cannot be applied to this suit as it stands. " +
      "So far as readiness and willingness is concerned, the substitution of 'who fails to aver and prove' by 'who fails to prove' works no drastic change to the object of the clause, so the settled learning on the substance survives even though the older authorities cannot be filed unamended. [d5¶4]",
    citations: [
      { tag: "d2", para: 2 },
      { tag: "d5", para: 4 },
    ],
    mapping_deps: ["M4", "M5"],
    confidence: 0.83,
    status: "verified",
    version: 1,
  },
  {
    id: "A4",
    side: "ours",
    text:
      "Readiness and willingness cannot be reduced to a straitjacket formula; it is inferred from the whole of the facts, circumstances, intention and conduct of the parties. [d5¶5] " +
      "On that approach the defendant's own conduct is decisive — it accepted Rs. 95,00,000 as earnest money, held it for over three years, and then purported to forfeit it while refusing to execute the sale deed. [p1¶10] " +
      "The plaintiff's conduct, by contrast, has been a continuous insistence on performance.",
    citations: [
      { tag: "d5", para: 5 },
      { tag: "p1", para: 10 },
    ],
    mapping_deps: [],
    confidence: 0.76,
    status: "verified",
    version: 1,
  },
  {
    id: "A5",
    side: "ours",
    text:
      "The plaintiff relies on printouts of WhatsApp messages exchanged between the parties between 2016 and 2019, which evidence the defendant's acknowledgment of the agreement and its subsequent refusal. [p1¶11] " +
      "Those are electronic records, and on the settled position the certificate may be directed to be produced at any stage so long as the trial is not concluded. [d3¶3] " +
      "That holding was delivered under Section 65B of the Evidence Act, which Section 63 of the Bharatiya Sakshya Adhiniyam replaced with effect from 01-07-2024; the reasoning is relied on, and the certificate is tendered in the form now prescribed.",
    citations: [
      { tag: "p1", para: 11 },
      { tag: "d3", para: 3 },
    ],
    mapping_deps: ["M14"],
    confidence: 0.84,
    status: "verified",
    version: 1,
  },
  {
    id: "A6",
    side: "ours",
    text:
      "The plaintiff seeks a permanent injunction restraining the defendant from creating any third-party interest in the suit property. [p1¶17] " +
      "In considering equitable relief of this kind the conduct of the party seeking it is essential to the enquiry. [d8¶2] " +
      "The plaintiff's conduct is on the record — payment at execution, repeated demands for performance, and a suit instituted as a commercial dispute of specified value under the Commercial Courts Act 2015. [p1¶13]",
    citations: [
      { tag: "p1", para: 17 },
      { tag: "d8", para: 2 },
      { tag: "p1", para: 13 },
    ],
    mapping_deps: [],
    confidence: 0.72,
    status: "verified",
    version: 1,
  },
];

export const DEMO_ABSTENTIONS = [
  "That the defendant's forfeiture of the earnest money was itself unlawful under Section 74 of the Contract Act. The retrieved authorities on forfeiture were not checked against the statute graph, so the point is not argued on them.",
  "That a certificate issued in the old Section 65B form remains valid after Section 63 commenced on 01-07-2024. No retrieved authority decides it.",
  "2 sentences were withheld because the paragraph they cited did not support them. Nothing untraceable appears above.",
];

export function demoArtifact() {
  return {
    id: "arguments",
    label: "Plaintiff's arguments",
    version: 1,
    args: DEMO_ARGS,
    sources: DEMO_SOURCES,
    abstentions: DEMO_ABSTENTIONS,
  };
}

export const DRAFT_REPLY = [
  "Six submissions are in the panel on the right, covering readiness and willingness, the defendant's anticipated answer on discretion, the electronic evidence, and the injunction.",
  "Neither superseded authority was used. Where the old law had to be addressed I put it in the argument that answers it — Shivaji Yallappa Patil appears in A3 as the proposition the defendant will run, and the reason it no longer holds is stated on the face of the sentence.",
  "Every sentence carries the document and paragraph it stands on; click a tag to read that paragraph. Three points I declined to argue are listed at the foot of the draft.",
].join(" ");

// ---------------------------------------------------------------------------
// Hearing
// ---------------------------------------------------------------------------

export function hearingSteps(): ScriptedStep[] {
  return [
    {
      kind: "reasoning",
      title: "Court convened",
      running: "putting the authorities before the bench",
      detail: "8 authorities on the record, each with the flag the engine computed",
      ms: 900,
    },
    {
      kind: "reasoning",
      title: "Opening statements and the bench's question",
      running: "counsel open",
      detail: "the bench goes to readiness and willingness",
      ms: 2100,
    },
    {
      kind: "reasoning",
      title: "Debate — the defence attacked the weakest citation first",
      running: "the defence presses its objection",
      detail: "P. Meenakshisundaram challenged as decided under the unamended section",
      ms: 2100,
    },
    {
      kind: "reasoning",
      title: "Judgment delivered",
      running: "the bench rules",
      detail: "partly allowed — turned on the currency of the citations, not the merits",
      ms: 1700,
    },
  ];
}

export function demoHearing(): Hearing {
  const dates = DEMO_DATES;
  const authorities = DEMO_AUTHORITIES.map((a) => ({
    cnr: a.cnr,
    title: a.title,
    citation: a.citation,
    date: a.date,
    flag: a.color as Hearing["authorities"][number]["flag"],
    reason: a.reason,
  }));
  return {
    id: "demo-hearing",
    strictness: "balanced",
    dates,
    authorities,
    phase: "reflection",
    startedAt: new Date().toISOString(),
    turns: [
      {
        id: "t0",
        phase: "convene",
        role: "clerk",
        text: `This matter is called on. The court records the governing timeline: cause of action ${dates.cause}, suit filed ${dates.suit}, trial proceeding as of ${dates.trial}. Eight authorities have been placed before the court, each checked against that timeline. The presiding judge weighs compliance gaps against the merits.`,
      },
      {
        id: "t1",
        phase: "opening",
        role: "plaintiff",
        text: "My Lord, the plaintiff sues for specific performance of an agreement to sell executed on 12.03.2016, on which Rs. 95,00,000 was paid as earnest money the same day. The defendant refused to execute the sale deed on 04.06.2019 and purported to forfeit that sum. The plaintiff has been ready and willing throughout.",
        cites: ["ESCR010006292024"],
      },
      {
        id: "t2",
        phase: "opening",
        role: "defence",
        text: "My Lord, specific performance is not had for the asking. The plaintiff sat on the agreement for three years, and the correspondence he relies on to show any demand consists of printouts tendered without a certificate. On his own case there is nothing before the court but an unperformed agreement.",
        cites: ["ESCR010006952018"],
      },
      {
        id: "t3",
        phase: "judge_question",
        role: "judge",
        text: "The court will hear both on readiness and willingness first. Counsel will identify the provision as it stood when the cause of action arose, and the authority they say governs it. The court is not assisted by learning decided on a section that has since been recast.",
      },
      {
        id: "t4",
        phase: "debate",
        role: "defence",
        text: "Then my learned friend is in difficulty, My Lord. His leading authority on readiness and willingness is P. Meenakshisundaram, decided in March 2018 upon Section 16 as it then stood. The Amendment Act came into force that October, before this cause of action arose. He is asking the court to apply a section that no longer exists in that form.",
        cites: ["ESCR010006882018"],
        challenge: {
          cnr: "ESCR010006882018",
          ground:
            "Decided 28-03-2018 under the pre-amendment S.16 of the Specific Relief Act 1963. The Specific Relief (Amendment) Act 2018 commenced 01-10-2018 — before the cause of action of 04.06.2019. Ratios resting on 'fails to aver and prove' do not survive the substitution.",
        },
      },
      {
        id: "t5",
        phase: "debate",
        role: "plaintiff",
        text: "The objection is to the citation, not to the case. The substance is unchanged: substituting 'fails to aver and prove' with 'fails to prove' works no drastic change to the object of the clause, and the plaintiff's burden is the same. We do not press the 2018 decisions. We rely on Janardan Das and R. Shama Naik, both decided under the amended section, and on the finding of fact those judgments treat as decisive.",
        cites: ["ESCR010001882023", "ESCR010006292024", "ESCR010007032024"],
      },
      {
        id: "t6",
        phase: "judgment",
        role: "judge",
        text: "The court proceeds on Section 16 as amended. The plaintiff's readiness and willingness is a matter for evidence, and the pleadings disclose enough to go to trial. As to the electronic records, the certificate requirement survives the coming into force of the Bharatiya Sakshya Adhiniyam and the plaintiff may file a certificate in the form now prescribed within four weeks. The authorities relied on will be recast accordingly. The suit will proceed.",
        cites: ["ESCR010006292024", "ESCR010004242020"],
      },
    ],
    verdict: {
      outcome: "part_allowed",
      decisiveIssue: "the currency of the citations, not the merits of the claim",
      reasoning:
        "Both sides were sent away to recast their authorities. The plaintiff kept the suit, but the opening was spent defending a citation rather than making a case — and the defence's best point cost it nothing to find, because the judgment's date was on its face.",
      rejected: [
        {
          cnr: "ESCR010006882018",
          ground: "Decided on the unamended Section 16; not applied.",
        },
        {
          cnr: "ESCR010006952018",
          ground: "Applies the old Section 20 discretion, replaced before this cause of action arose.",
        },
      ],
    },
    weakPoint:
      "The defence opened on P. Meenakshisundaram being two provisions out of date, and the point carried. Recast the readiness-and-willingness submissions on the amended Section 16 relying on Janardan Das and R. Shama Naik, and recast the evidence submissions on Bharatiya Sakshya Adhiniyam Section 63 rather than Evidence Act Section 65B. Both corrections are mechanical; both are fatal if made in court instead of before it.",
  };
}

export const HEARING_REPLY = [
  "The transcript is in the Hearing tab.",
  "The bench part-allowed and the suit survives, but read what it turned on: the defence opened by pointing out that your readiness-and-willingness authority was decided six months before the section was amended, and the whole of the opening went on answering that rather than on the merits.",
  "What to fix is at the foot of the transcript. Both corrections are mechanical — and both are fatal if you make them in court rather than before it.",
].join(" ");

/** Build the step record the stream emits, given a scripted step. */
export function toAgentStep(s: ScriptedStep, id: string, status: "running" | "done"): AgentStep {
  return {
    id,
    kind: s.kind,
    title: status === "running" ? (s.running ?? s.title) : s.title,
    detail: status === "running" ? undefined : s.detail,
    findings: status === "done" ? s.findings : undefined,
    status,
    ms: status === "done" ? s.ms : undefined,
  };
}
