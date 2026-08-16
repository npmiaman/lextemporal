import { describe, expect, it } from "vitest";
import { splitPapers } from "@/lib/agent-draft";
import { titleFor } from "@/lib/chats";
import { salvageObjects, scrubThinking } from "@/lib/llm-nim";
import { extractDates } from "@/app/api/agent/route";

describe("splitPapers", () => {
  it("splits on blank lines when the document has them", () => {
    const paras = splitPapers("First para.\n\nSecond para.\n\nThird para.");
    expect(paras).toEqual(["First para.", "Second para.", "Third para."]);
  });

  it("falls back to numbered clauses when a paste has no blank lines", () => {
    // This is the shape a plaint arrives in when pasted into the composer, and
    // the case the fallback exists for: one paragraph would make every citation
    // mean "somewhere in the plaint".
    const pasted =
      "IN THE HIGH COURT 1. That the parties entered into an agreement. " +
      "2. That the defendant paid earnest money. 3. That the defendant refused.";
    const paras = splitPapers(pasted);
    expect(paras.length).toBeGreaterThanOrEqual(3);
    expect(paras.at(-1)).toContain("refused");
  });

  it("never returns an empty list", () => {
    expect(splitPapers("one line only")).toEqual(["one line only"]);
  });
});

describe("titleFor", () => {
  it("prefers the filing number, which is what a lawyer recognises", () => {
    expect(titleFor("IN THE HIGH COURT OF DELHI\nCS(COMM) 214/2021\nM/s Sharma Traders")).toBe(
      "CS(COMM) 214/2021"
    );
  });

  it("matches 'of' as well as a slash", () => {
    expect(titleFor("Suit no. OMP 45 of 2019 before the court")).toContain("OMP");
  });

  it("falls back to the first meaningful line, truncated", () => {
    expect(titleFor("\n\nis my WhatsApp evidence admissible")).toBe("is my WhatsApp evidence admissible");
    expect(titleFor("x".repeat(90))).toHaveLength(45); // 44 chars + ellipsis
  });
});

describe("salvageObjects", () => {
  it("recovers nested turns when the outer object never closes", () => {
    // Exactly what a response truncated at the token ceiling looks like.
    const truncated = '{"turns":[{"n":1,"text":"first"},{"n":2,"text":"second"},{"n":3,"text":"thi';
    const parts = salvageObjects(truncated);
    expect(parts.map((p) => p.n)).toEqual([1, 2]);
  });

  it("is not fooled by braces inside strings", () => {
    const parts = salvageObjects('{"n":1,"text":"a } brace"}');
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toBe("a } brace");
  });

  it("drops fragments that do not parse rather than repairing them", () => {
    expect(salvageObjects("{not json}")).toEqual([]);
  });
});

describe("scrubThinking", () => {
  it("removes a think block", () => {
    expect(scrubThinking("<think>plan</think>\n\nThe answer.")).toBe("The answer.");
  });
});

describe("extractDates", () => {
  it("reads the timeline out of a pasted plaint", () => {
    const plaint = [
      "1. That the agreement to sell was executed on 12.03.2016 for a total consideration.",
      "4. That the defendant committed breach of the said agreement on 04.06.2019 by refusing.",
      "7. That the suit was filed on 18.01.2021 before this Hon'ble Court.",
    ].join("\n\n");
    const found = Object.fromEntries(extractDates(plaint).map((d) => [d.field, d.value]));
    expect(found).toEqual({
      agreement_date: "2016-03-12",
      cause_date: "2019-06-04",
      suit_date: "2021-01-18",
    });
  });

  it("reads 'cause of action arose on', which a plaint states as often as 'breach'", () => {
    const found = extractDates("6. That the cause of action arose on 04.06.2019 when the defendant refused.");
    expect(found[0]).toMatchObject({ field: "cause_date", value: "2019-06-04" });
  });

  it("rejects an impossible date rather than coercing it", () => {
    expect(extractDates("agreement dated 45.99.2016")).toEqual([]);
  });
});
