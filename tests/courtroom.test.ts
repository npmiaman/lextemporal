import { describe, expect, it } from "vitest";
import {
  convenedText,
  nextPhase,
  PHASE_ORDER,
  reflectionFor,
  speakersFor,
  weakestAuthority,
  type CourtAuthority,
  type Hearing,
} from "@/lib/courtroom";

const AUTHORITIES: CourtAuthority[] = [
  { cnr: "A", title: "Green Co v. State", citation: "[2023] 1 SCR 1", date: "2023-01-01", flag: "green", reason: "" },
  { cnr: "B", title: "Amber Ltd v. Union", citation: "[2016] 2 SCR 9", date: "2016-05-05", flag: "amber", reason: "renumbered" },
  { cnr: "C", title: "Red Traders v. Infra", citation: "[2014] 3 SCR 4", date: "2014-03-03", flag: "red", reason: "superseded" },
  { cnr: "D", title: "Older Red v. Anr", citation: "[2011] 4 SCR 7", date: "2011-02-02", flag: "red", reason: "superseded" },
];

describe("the phase machine is deterministic", () => {
  it("never reorders the running order", () => {
    expect(PHASE_ORDER).toEqual([
      "convene", "opening", "judge_question", "debate", "judgment", "reflection",
    ]);
  });

  it("advances one phase at a time and then stops", () => {
    expect(nextPhase("convene", 0, 2)).toBe("opening");
    expect(nextPhase("opening", 0, 2)).toBe("judge_question");
    expect(nextPhase("judgment", 0, 2)).toBe("reflection");
    expect(nextPhase("reflection", 0, 2)).toBeNull();
  });

  it("holds in debate until the rounds are used up", () => {
    expect(nextPhase("debate", 0, 3)).toBe("debate");
    expect(nextPhase("debate", 2, 3)).toBe("debate");
    expect(nextPhase("debate", 3, 3)).toBe("judgment");
  });

  it("fixes who speaks in each phase", () => {
    expect(speakersFor("opening")).toEqual(["plaintiff", "defence"]);
    // Defence presses first in debate; the plaintiff answers.
    expect(speakersFor("debate")).toEqual(["defence", "plaintiff"]);
    expect(speakersFor("judgment")).toEqual(["judge"]);
  });
});

describe("the defence attacks the weakest authority, deterministically", () => {
  it("prefers red over amber", () => {
    expect(weakestAuthority(AUTHORITIES)?.flag).toBe("red");
  });

  it("breaks ties on the older judgment, so a hearing is reproducible", () => {
    expect(weakestAuthority(AUTHORITIES)?.cnr).toBe("D");
  });

  it("has nothing to attack when every authority is clean", () => {
    expect(weakestAuthority([AUTHORITIES[0]])).toBeNull();
  });

  it("ignores grey — no opinion is not a ground of attack", () => {
    const grey: CourtAuthority[] = [
      { cnr: "G", title: "Grey v. Grey", citation: "", date: "2015-01-01", flag: "grey", reason: "" },
    ];
    expect(weakestAuthority(grey)).toBeNull();
  });
});

describe("the record states the timeline it was measured against", () => {
  it("puts all three dates on the record", () => {
    const t = convenedText({ cause: "2019-06-04", suit: "2021-01-18", trial: "2026-08-16" }, 6, "strict");
    expect(t).toContain("2019-06-04");
    expect(t).toContain("2021-01-18");
    expect(t).toContain("2026-08-16");
    expect(t).toMatch(/strict statutory compliance/);
  });
});

describe("reflection is computed from what actually happened", () => {
  const base: Hearing = {
    id: "h1",
    strictness: "balanced",
    dates: { cause: "2019-06-04", suit: "2021-01-18", trial: "2026-08-16" },
    authorities: AUTHORITIES,
    turns: [],
    phase: "reflection",
    startedAt: "",
  };

  it("says so plainly when no citation was attacked", () => {
    expect(reflectionFor(base).text).toMatch(/No authority was attacked/);
    expect(reflectionFor(base).query).toBeNull();
  });

  it("names the attacked authority and offers a follow-up query", () => {
    const h: Hearing = {
      ...base,
      turns: [
        {
          id: "t1", phase: "debate", role: "defence", text: "…",
          challenge: { cnr: "C", ground: "superseded by the 2018 amendment." },
        },
      ],
    };
    const r = reflectionFor(h);
    expect(r.text).toContain("Red Traders v. Infra");
    expect(r.query).toContain("Red Traders");
  });
});
