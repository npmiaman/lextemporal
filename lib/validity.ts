// Temporal-validity engine. REAL, DETERMINISTIC, NO LLM, NO NETWORK.
//
// Extract statutory provisions a judgment relies on (regex over its text),
// look each up in the hand-verified statute graph (data/mappings.json), and
// decide whether the reliance survives the amendments that govern THIS matter's
// timeline. The returned JSON is the complete explainability payload.

import type { StatuteMapping } from "@/lib/mappings";
import type { MatterDates } from "@/lib/matter";

export type FlagColor = "red" | "amber" | "grey" | "green";

export interface ExtractedProvision {
  act: string; // canonical act name, e.g. "Specific Relief Act 1963"
  section: string; // e.g. "10", "65B"
  mapped: boolean;
}

export interface DateCheck {
  mapping_id: string;
  judgment: string;
  commencement: string;
  governing: string;
  rule: string;
}

export interface ValidityFlag {
  color: FlagColor;
  reason: string;
  mapping_ids: string[];
  provisions: ExtractedProvision[];
  dates_checked: DateCheck[];
}

// Canonical act names → aliases that appear in judgment text.
const ACT_ALIASES: Record<string, string[]> = {
  "Specific Relief Act 1963": ["specific relief act"],
  "Commercial Courts Act 2015": ["commercial courts act"],
  "Arbitration and Conciliation Act 1996": [
    "arbitration and conciliation act",
    "arbitration & conciliation act",
  ],
  "Indian Evidence Act 1872": ["indian evidence act", "evidence act"],
  "Bharatiya Sakshya Adhiniyam 2023": ["bharatiya sakshya adhiniyam", "sakshya adhiniyam"],
};

// Sections distinctive enough to attribute without the act name adjacent.
const DISTINCTIVE_SECTIONS: Record<string, string> = {
  "65B": "Indian Evidence Act 1872",
  "65A": "Indian Evidence Act 1872",
  "12A": "Commercial Courts Act 2015",
  "29A": "Arbitration and Conciliation Act 1996",
};

// NOTE: this pattern must NOT carry the `i` flag. A section suffix is genuinely
// uppercase ("65B", "12A"), and under /i the `[A-Z]{0,2}` class also matches
// lowercase — so "Sections 10 and 14" parsed as "10 an" and silently dropped
// S.14, a mapped provision. Case tolerance belongs in the keyword classes only.
const SECTION_LIST = /\b(?:[Ss]ections?|[Ss]ec\.?|[Ss]\.)\s*((?:\d+\s*-?\s*[A-Z]{0,2})(?:\s*\([^)]{1,12}\))?(?:\s*(?:,|[Aa]nd|&|\/|[Rr]ead with|[Rr]\/[Ww])\s*(?:[Ss]ections?\s*|[Ss]ec\.?\s*|[Ss]\.\s*)?\d+\s*-?\s*[A-Z]{0,2}(?:\s*\([^)]{1,12}\))?)*)/g;

function normalise(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function sectionTokens(listText: string): string[] {
  // "65 - B" / "65-B" → "65B" before tokenising.
  const joined = listText.replace(/(\d)\s*-?\s*([A-Z])/g, "$1$2");
  const tokens = joined.match(/\d+[A-Z]{0,2}/g) ?? [];
  return [...new Set(tokens)];
}

/** Parse "S.10 (pre-amendment)" / "S.41(ha)" / "S.2(1)(i) …" → "10" / "41" / "2". */
export function provisionSection(provision: string): string | null {
  const m = provision.match(/S\.?\s*(\d+[A-Z]{0,2})/i);
  return m ? m[1].toUpperCase() : null;
}

/** Extract (act, section) pairs a judgment's text relies on. Deterministic regex only. */
export function extractProvisions(text: string): { act: string; section: string }[] {
  const found = new Map<string, { act: string; section: string }>();
  const add = (act: string, section: string) => {
    const key = `${act}::${section.toUpperCase()}`;
    if (!found.has(key)) found.set(key, { act, section: section.toUpperCase() });
  };

  // Pattern 1: "Section(s) N [and M] of the <Act>" — act name within 90 chars after the list.
  const re = new RegExp(
    SECTION_LIST.source + String.raw`\s*(?:of\s+the\s+|of\s+)?([A-Z][A-Za-z&,\. ]{2,70}?(?:Act|Adhiniyam|Sanhita|Code))`,
    "g"
  );
  for (const m of text.matchAll(re)) {
    const actNorm = normalise(m[2]);
    let canonicalAct: string | null = null;
    for (const [canonical, aliases] of Object.entries(ACT_ALIASES)) {
      if (aliases.some((a) => actNorm.includes(a) || a.includes(actNorm))) {
        canonicalAct = canonical;
        break;
      }
    }
    // Acts outside the alias table are still extracted — they surface as GREY
    // ("provision not in verified statute graph"), never silently as green.
    const act = canonicalAct ?? m[2].replace(/^the\s+/i, "").replace(/\s+/g, " ").trim();
    for (const s of sectionTokens(m[1])) add(act, s);
  }

  // Pattern 2: act alias appears, look back ≤120 chars for the nearest section list.
  for (const [canonical, aliases] of Object.entries(ACT_ALIASES)) {
    for (const alias of aliases) {
      const aliasRe = new RegExp(alias.replace(/ /g, String.raw`[\s,]+`), "gi");
      for (const m of text.matchAll(aliasRe)) {
        const start = Math.max(0, m.index - 120);
        const window = text.slice(start, m.index);
        const lists = [...window.matchAll(SECTION_LIST)];
        const last = lists.at(-1);
        if (last && window.length - (last.index + last[0].length) < 60) {
          for (const s of sectionTokens(last[1])) add(canonical, s);
        }
      }
    }
  }

  // Pattern 3: distinctive standalone sections ("Section 65B", "S. 12A") without act nearby.
  for (const m of text.matchAll(new RegExp(SECTION_LIST.source, "g"))) {
    for (const s of sectionTokens(m[1])) {
      const owner = DISTINCTIVE_SECTIONS[s.toUpperCase()];
      if (owner) add(owner, s);
    }
  }

  return [...found.values()];
}

/** Which matter date the amendment is tested against, per the mapping's rule.
 *  Exported so retrieval can compute the same window this engine flags on. */
export function governingDate(
  m: StatuteMapping,
  dates: MatterDates
): { date: string; rule: string } {
  if (m.applies_when === "trial_on_or_after") {
    return { date: dates.trial, rule: "trial_on_or_after" };
  }
  const d = dates.suit > dates.cause ? dates.suit : dates.cause;
  return { date: d, rule: "cause_or_suit_after_commencement" };
}

/**
 * Does a judgment's (act, section) reliance match one side of a mapping?
 *
 * Exported deliberately. Graph retrieval must decide "does this judgment rely on
 * the old side of a mapping that governs this matter" using the SAME act-name
 * normalisation this engine uses — a second copy of that logic elsewhere is how
 * retrieval and flagging silently disagree about what a judgment cites.
 */
export function matchesMapping(act: string, section: string, m: StatuteMapping, side: "old" | "new"): boolean {
  const mAct = side === "old" ? m.act_old : m.act_new;
  const mProv = side === "old" ? m.provision_old : m.provision_new;
  const mSection = provisionSection(mProv);
  if (!mSection || mSection !== section.toUpperCase()) return false;
  const a = normalise(act);
  const b = normalise(mAct);
  return a.includes(b) || b.includes(a);
}

export function computeValidity(
  judgment: { date: string; text: string },
  mappings: StatuteMapping[],
  dates: MatterDates
): ValidityFlag {
  const extracted = extractProvisions(judgment.text);
  const provisions: ExtractedProvision[] = [];
  const dates_checked: DateCheck[] = [];
  const firing = new Map<string, StatuteMapping>(); // mappings that make reliance suspect
  const mapping_ids = new Set<string>();
  let hasUnmapped = false;

  for (const p of extracted) {
    const oldSide = mappings.filter((m) => matchesMapping(p.act, p.section, m, "old"));
    const newSide = mappings.filter((m) => matchesMapping(p.act, p.section, m, "new"));
    const mapped = oldSide.length > 0 || newSide.length > 0;
    provisions.push({ act: p.act, section: p.section, mapped });
    if (!mapped) {
      hasUnmapped = true;
      continue;
    }
    for (const m of [...oldSide, ...newSide]) mapping_ids.add(m.id);

    // Reliance on the OLD side is suspect when the judgment predates the change
    // and the change governs this matter: judgment < commencement <= governing.
    for (const m of oldSide) {
      const gov = governingDate(m, dates);
      dates_checked.push({
        mapping_id: m.id,
        judgment: judgment.date,
        commencement: m.commencement,
        governing: gov.date,
        rule: gov.rule,
      });
      if (judgment.date && judgment.date < m.commencement && m.commencement <= gov.date) {
        firing.set(m.id, m);
      }
    }
    // Citations of the NEW side are current law — clean; still record the check.
    for (const m of newSide) {
      if (oldSide.includes(m)) continue;
      const gov = governingDate(m, dates);
      dates_checked.push({
        mapping_id: m.id,
        judgment: judgment.date,
        commencement: m.commencement,
        governing: gov.date,
        rule: gov.rule,
      });
    }
  }

  const fired = [...firing.values()];
  const reds = fired.filter((m) => m.change_type === "substantive_amendment");
  const ambers = fired.filter((m) => m.change_type !== "substantive_amendment");

  if (reds.length > 0) {
    const m = reds[0];
    return {
      color: "red",
      reason: `Relies on superseded ${m.provision_old} of the ${m.act_old}; ${m.change_type} w.e.f. ${m.commencement}. ${m.note} Verify before citing.`,
      mapping_ids: [...mapping_ids],
      provisions,
      dates_checked,
    };
  }
  if (ambers.length > 0) {
    const m = ambers[0];
    const reason =
      m.change_type === "renumbering_only"
        ? `Cites ${m.provision_old} of the ${m.act_old}, renumbered to ${m.provision_new} of the ${m.act_new} w.e.f. ${m.commencement}; ratio likely intact — update citation.`
        : m.change_type === "succession"
          ? `Decided under ${m.provision_old} of the ${m.act_old} — ${m.act_new} ${m.provision_new} applies w.e.f. ${m.commencement}. ${m.note}`
          : `${m.provision_new} of the ${m.act_new} was inserted w.e.f. ${m.commencement}; authority predating it does not address the provision. ${m.note}`;
    return { color: "amber", reason, mapping_ids: [...mapping_ids], provisions, dates_checked };
  }
  if (provisions.length === 0) {
    return {
      color: "grey",
      reason: "No statutory provisions detected in the judgment text — no validity opinion.",
      mapping_ids: [],
      provisions,
      dates_checked,
    };
  }
  if (hasUnmapped) {
    const un = provisions.filter((p) => !p.mapped);
    return {
      color: "grey",
      reason: `Provision${un.length > 1 ? "s" : ""} not in verified statute graph (${un
        .map((p) => `S.${p.section} ${p.act}`)
        .join("; ")}) — no validity opinion.`,
      mapping_ids: [...mapping_ids],
      provisions,
      dates_checked,
    };
  }
  return {
    color: "green",
    reason: "Checked against dispute timeline — no superseding amendment found.",
    mapping_ids: [...mapping_ids],
    provisions,
    dates_checked,
  };
}
