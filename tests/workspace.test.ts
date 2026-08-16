import { describe, expect, it } from "vitest";
import {
  matchArtifacts,
  mentionQueryAt,
  parseMentions,
  type Artifact,
} from "@/lib/workspace";
import { classify } from "@/lib/intent";

const ARTIFACTS: Artifact[] = [
  {
    id: "plaintiff-arguments",
    label: "Plaintiff arguments",
    kind: "arguments",
    side: "ours",
    version: 2,
    history: [],
    updatedAt: "",
  },
  {
    id: "defence-arguments",
    label: "Defence arguments",
    kind: "arguments",
    side: "opposing",
    version: 1,
    history: [],
    updatedAt: "",
  },
];

describe("@mention parsing", () => {
  it("resolves a mention by artifact id", () => {
    expect(parseMentions("check @plaintiff-arguments for limitation", ARTIFACTS)).toEqual([
      "plaintiff-arguments",
    ]);
  });

  it("resolves a mention by hyphenated label", () => {
    expect(parseMentions("@Defence-arguments is weak on 12A", ARTIFACTS)).toEqual([
      "defence-arguments",
    ]);
  });

  it("ignores unknown handles rather than inventing an artifact", () => {
    expect(parseMentions("@nonexistent tell me about it", ARTIFACTS)).toEqual([]);
  });

  it("deduplicates repeated mentions", () => {
    expect(
      parseMentions("@plaintiff-arguments vs @plaintiff-arguments", ARTIFACTS)
    ).toEqual(["plaintiff-arguments"]);
  });

  it("does not treat an email address as a mention", () => {
    expect(parseMentions("mail me at aman@example.com", ARTIFACTS)).toEqual([]);
  });
});

describe("@ trigger detection in the composer", () => {
  it("is active while typing an unbroken token", () => {
    const text = "look at @plain";
    expect(mentionQueryAt(text, text.length)).toEqual({ query: "plain", start: 8 });
  });

  it("opens with an empty query the moment @ is typed", () => {
    const text = "look at @";
    expect(mentionQueryAt(text, text.length)?.query).toBe("");
  });

  it("closes once a space follows the token", () => {
    const text = "look at @plaintiff-arguments and";
    expect(mentionQueryAt(text, text.length)).toBeNull();
  });

  it("is inactive when there is no @ before the caret", () => {
    expect(mentionQueryAt("no mention here", 15)).toBeNull();
  });

  it("tracks the caret, not the end of the string", () => {
    const text = "@plai ... trailing text";
    // caret just after "@plai"
    expect(mentionQueryAt(text, 5)).toEqual({ query: "plai", start: 0 });
  });
});

describe("artifact matching for the @ menu", () => {
  it("returns everything for an empty query", () => {
    expect(matchArtifacts("", ARTIFACTS)).toHaveLength(2);
  });

  it("narrows on a substring of the label", () => {
    expect(matchArtifacts("defence", ARTIFACTS).map((a) => a.id)).toEqual(["defence-arguments"]);
  });

  it("returns nothing when no artifact matches", () => {
    expect(matchArtifacts("zzz", ARTIFACTS)).toEqual([]);
  });
});

describe("intent routing — a greeting must not trigger a corpus search", () => {
  it("routes greetings and pleasantries to chat", () => {
    for (const t of ["Hi", "hello", "hey there", "thanks", "ok", "Good morning", "cool"]) {
      expect(classify(t)).toBe("chat");
    }
  });

  it("routes questions about the tool to chat", () => {
    for (const t of ["what can you do", "what is this", "how does it work", "help"]) {
      expect(classify(t)).toBe("chat");
    }
  });

  it("defers instead of defaulting to research when the rules cannot decide", () => {
    // Regression: this used to return "research" and run a full corpus search
    // over 133,947 passages, returning six irrelevant judgments.
    expect(classify("Do you know who is known as godfather")).toBe("unsure");
    expect(classify("what is the capital of France")).toBe("unsure");
  });

  it("routes substantive legal questions to research", () => {
    for (const t of [
      "is pre-institution mediation mandatory before filing a commercial suit",
      "section 65B certificate for electronic records",
      "limitation for a suit for specific performance",
      "what authority is there on readiness and willingness",
    ]) {
      expect(classify(t)).toBe("research");
    }
  });

  it("routes drafting requests to draft", () => {
    expect(classify("draft the arguments for the plaintiff")).toBe("draft");
    expect(classify("write our written submissions")).toBe("draft");
  });
});

describe("simulate intent", () => {
  it("routes hearing requests to simulate, not research", () => {
    for (const t of [
      "Simulate the hearing on the authorities retrieved.",
      "run the hearing",
      "mock trial this",
      "moot it",
    ]) {
      expect(classify(t)).toBe("simulate");
    }
  });

  it("does not hijack ordinary research questions", () => {
    expect(classify("section 65B certificate for electronic records")).toBe("research");
  });
});
