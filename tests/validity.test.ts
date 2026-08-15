import { describe, expect, it } from "vitest";
import { computeValidity, extractProvisions, provisionSection } from "@/lib/validity";
import { mappings } from "@/lib/mappings";
import type { MatterDates } from "@/lib/matter";

// Seeded matter timeline: breach 2019, suit 2021, trial ongoing (2026).
const DATES: MatterDates = { cause: "2019-06-04", suit: "2021-01-18", trial: "2026-08-15" };

const sp10 = (extra = "") =>
  `The plaintiff seeks a decree of specific performance. Under Section 10 of the Specific Relief Act, 1963 the grant of specific performance is in the discretion of the court. ${extra}`;

describe("provisionSection", () => {
  it("parses S.10 / S.65B / S.41(ha) / S.2(1)(i)", () => {
    expect(provisionSection("S.10 (pre-amendment)")).toBe("10");
    expect(provisionSection("S.65B (electronic-records certificate)")).toBe("65B");
    expect(provisionSection("S.41(ha) (no injunction: infrastructure)")).toBe("41");
    expect(provisionSection("S.2(1)(i) (specified value ₹1 crore)")).toBe("2");
    expect(provisionSection("— (no equivalent)")).toBeNull();
  });
});

describe("extractProvisions", () => {
  it("extracts 'Section 10 of the Specific Relief Act'", () => {
    const out = extractProvisions(sp10());
    expect(out).toContainEqual({ act: "Specific Relief Act 1963", section: "10" });
  });

  it("extracts multi-section lists: 'Sections 16 and 20 of the Specific Relief Act'", () => {
    const out = extractProvisions(
      "Reliance was placed on Sections 16 and 20 of the Specific Relief Act, 1963."
    );
    const sections = out.filter((p) => p.act === "Specific Relief Act 1963").map((p) => p.section);
    expect(sections).toContain("16");
    expect(sections).toContain("20");
  });

  it("attributes distinctive standalone sections (Section 65B) without act name", () => {
    const out = extractProvisions(
      "The certificate under Section 65B(4) was not produced with the printouts."
    );
    expect(out).toContainEqual({ act: "Indian Evidence Act 1872", section: "65B" });
  });
});

describe("computeValidity — colors", () => {
  it("RED: pre-2018 judgment relying on old S.10, suit post-amendment", () => {
    const flag = computeValidity({ date: "2016-05-05", text: sp10() }, mappings, DATES);
    expect(flag.color).toBe("red");
    expect(flag.reason).toContain("superseded");
    expect(flag.reason).toContain("2018-10-01");
    expect(flag.mapping_ids).toContain("M1");
    expect(flag.dates_checked.some((d) => d.mapping_id === "M1")).toBe(true);
  });

  it("GREEN: post-amendment judgment citing S.10", () => {
    const flag = computeValidity({ date: "2020-02-10", text: sp10() }, mappings, DATES);
    expect(flag.color).toBe("green");
    expect(flag.reason).toContain("no superseding amendment");
  });

  it("boundary: judgment decided ON the commencement date is not superseded", () => {
    const flag = computeValidity({ date: "2018-10-01", text: sp10() }, mappings, DATES);
    expect(flag.color).toBe("green");
  });

  it("boundary: governing date exactly on commencement → superseded", () => {
    const dates: MatterDates = { cause: "2018-10-01", suit: "2018-10-01", trial: "2026-08-15" };
    const flag = computeValidity({ date: "2017-01-01", text: sp10() }, mappings, dates);
    expect(flag.color).toBe("red");
  });

  it("old-law matter: suit before commencement → old S.10 reliance is fine", () => {
    const dates: MatterDates = { cause: "2016-01-01", suit: "2017-06-01", trial: "2026-08-15" };
    const flag = computeValidity({ date: "2016-05-05", text: sp10() }, mappings, dates);
    expect(flag.color).toBe("green");
  });

  it("AMBER + certificate note: S.65B judgment, trial after 2024-07-01 (succession)", () => {
    const flag = computeValidity(
      {
        date: "2019-04-30",
        text: "The WhatsApp messages are admissible only with the certificate under Section 65B of the Indian Evidence Act.",
      },
      mappings,
      DATES
    );
    expect(flag.color).toBe("amber");
    expect(flag.reason).toContain("S.63");
    expect(flag.reason.toLowerCase()).toContain("certificate");
    expect(flag.mapping_ids).toContain("M14");
  });

  it("AMBER: renumbering_only (S.101 Evidence Act → BSA S.104)", () => {
    const flag = computeValidity(
      {
        date: "2015-03-03",
        text: "Under Section 101 of the Indian Evidence Act the burden of proof lies on the plaintiff.",
      },
      mappings,
      DATES
    );
    expect(flag.color).toBe("amber");
    expect(flag.reason).toContain("renumbered");
    expect(flag.reason).toContain("update citation");
  });

  it("GREY: provision not in the statute graph", () => {
    const flag = computeValidity(
      {
        date: "2014-01-01",
        text: "The rights of the purchaser under Section 55 of the Transfer of Property Act were considered.",
      },
      mappings,
      DATES
    );
    expect(flag.color).toBe("grey");
    expect(flag.reason).toContain("not in verified statute graph");
  });

  it("GREY: no statutory provisions detected at all", () => {
    const flag = computeValidity(
      { date: "2012-01-01", text: "The parties settled the matter amicably before trial." },
      mappings,
      DATES
    );
    expect(flag.color).toBe("grey");
    expect(flag.provisions).toHaveLength(0);
  });

  it("precedence: red beats amber and grey in a mixed judgment", () => {
    const flag = computeValidity(
      {
        date: "2016-05-05",
        text:
          sp10() +
          " The printouts required a certificate under Section 65B of the Indian Evidence Act." +
          " Section 55 of the Transfer of Property Act was also cited.",
      },
      mappings,
      DATES
    );
    expect(flag.color).toBe("red");
    expect(flag.provisions.some((p) => !p.mapped)).toBe(true);
  });

  it("NEW-side citation (BSA S.63) is current law → green", () => {
    const flag = computeValidity(
      {
        date: "2025-01-20",
        text: "The certificate under Section 63 of the Bharatiya Sakshya Adhiniyam, 2023 accompanied the record.",
      },
      mappings,
      DATES
    );
    expect(flag.color).toBe("green");
    expect(flag.mapping_ids).toContain("M14");
  });

  it("explainability payload carries provisions + dates_checked", () => {
    const flag = computeValidity({ date: "2016-05-05", text: sp10() }, mappings, DATES);
    expect(flag.provisions[0]).toMatchObject({ act: "Specific Relief Act 1963", section: "10", mapped: true });
    const check = flag.dates_checked.find((d) => d.mapping_id === "M1")!;
    expect(check).toMatchObject({
      judgment: "2016-05-05",
      commencement: "2018-10-01",
      governing: "2021-01-18",
      rule: "cause_or_suit_after_commencement",
    });
  });
});
