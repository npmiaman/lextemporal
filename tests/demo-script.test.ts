import { describe, expect, it } from "vitest";
import { fetchDoc } from "@/lib/corpus";
import { DEMO_AUTHORITIES, demoArtifact, demoHearing } from "@/lib/demo-script";

/**
 * The demonstration run scripts its wording but not its evidence, and that
 * distinction is only worth anything if it is enforced. These tests fail the
 * moment a citation in the scripted draft stops resolving to a real paragraph of
 * a real judgment in the corpus — which is exactly the claim the draft makes
 * about itself on screen.
 */
describe("scripted draft", () => {
  const { args, sources } = demoArtifact();
  const byTag = new Map(sources.map((s) => [s.tag, s]));

  it("cites only tags that exist in its own source list", () => {
    for (const a of args) {
      for (const [, tag] of a.text.matchAll(/\[(p1|d\d+)¶\d+\]/g)) {
        expect(byTag.get(tag), `${a.id} cites unknown tag ${tag}`).toBeDefined();
      }
    }
  });

  it("resolves every judgment pin to a real paragraph in the corpus", () => {
    let checked = 0;
    for (const a of args) {
      // The tags inside the prose are the contract the reader clicks, so those
      // are what get checked — not the parallel citations array.
      for (const m of a.text.matchAll(/\[(p1|d\d+)¶(\d+)\]/g)) {
        const src = byTag.get(m[1])!;
        checked += 1;
        if (src.docid === "papers") continue; // the lawyer's own filing, not ours to hold
        const doc = fetchDoc(src.docid);
        expect(doc, `${a.id}: ${src.docid} is not in the corpus`).not.toBeNull();
        const para = doc!.paragraphs[Number(m[2]) - 1];
        expect(
          para,
          `${a.id}: ${m[1]}¶${m[2]} does not exist — that judgment has ${doc!.paragraphs.length} paragraphs`
        ).toBeTruthy();
      }
    }
    expect(checked).toBeGreaterThanOrEqual(14);
  });

  it("never names a flag colour in drafted prose", () => {
    // The colour is carried by the UI. A drafted sentence saying "the flag
    // remains AMBER" is both jargon and, as written, usually wrong.
    for (const a of args) {
      expect(a.text, `${a.id} names a flag colour`).not.toMatch(/\b(RED|AMBER|GREEN|GREY)\b/);
    }
  });

  it("does not rest an argument on a superseded authority", () => {
    const superseded = new Set(DEMO_AUTHORITIES.filter((a) => a.color === "red").map((a) => a.cnr));
    const supersededTags = sources.filter((s) => superseded.has(s.docid)).map((s) => s.tag);
    expect(supersededTags.length).toBeGreaterThan(0);
    for (const a of args) {
      for (const tag of supersededTags) {
        if (!a.text.includes(`[${tag}¶`)) continue;
        // Citing one is allowed only to answer it, and the sentence must say so.
        expect(
          a.text,
          `${a.id} relies on superseded ${tag} without saying it has been replaced`
        ).toMatch(/replaced|superseded|amend/i);
      }
    }
  });
});

describe("scripted hearing", () => {
  const hearing = demoHearing();

  it("only cites authorities that are before the court", () => {
    const known = new Set(hearing.authorities.map((a) => a.cnr));
    for (const t of hearing.turns) {
      for (const c of t.cites ?? []) expect(known.has(c), `turn ${t.id} cites unknown ${c}`).toBe(true);
    }
  });

  it("challenges a citation only on a flag the engine actually raised", () => {
    const flagged = new Map(hearing.authorities.map((a) => [a.cnr, a.flag]));
    const challenges = hearing.turns.filter((t) => t.challenge);
    expect(challenges.length).toBeGreaterThan(0);
    for (const t of challenges) {
      expect(["red", "amber"]).toContain(flagged.get(t.challenge!.cnr));
    }
  });

  it("attacks the weakest authority first — red before amber", () => {
    const first = hearing.turns.find((t) => t.challenge)!.challenge!.cnr;
    expect(hearing.authorities.find((a) => a.cnr === first)?.flag).toBe("red");
  });
});
