import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, nowIso } from "@/lib/db";
import { override, getOverride, markReverified } from "@/lib/override";
import { readAudit } from "@/lib/audit";

function seedArg(id: string, deps: string[]) {
  freshDbRef
    .prepare(
      "INSERT INTO arguments (id, matter_id, side, idx, payload, status, version, updated_at) VALUES (?, 1, 'ours', 0, ?, 'verified', 1, ?)"
    )
    .run(id, JSON.stringify({ text: "x", citations: [], mapping_deps: deps, confidence: 0.9 }), nowIso());
}

let freshDbRef: ReturnType<typeof freshDb>;

describe("override cascade", () => {
  beforeEach(() => {
    freshDbRef = freshDb();
  });

  it("bumps to v2, stales exactly the dependents, audits both rows", () => {
    seedArg("A1", ["M1"]);
    seedArg("A2", ["M14"]);
    seedArg("A4", ["M14", "M4"]);

    const res = override("M14", "S.63 BSA certificate requirement applies; format differs from S.65B");
    expect(res.version).toBe(2);
    expect(res.staleArgIds.sort()).toEqual(["A2", "A4"]);

    const statuses = freshDbRef
      .prepare("SELECT id, status FROM arguments ORDER BY id")
      .all() as { id: string; status: string }[];
    expect(statuses).toEqual([
      { id: "A1", status: "verified" },
      { id: "A2", status: "stale" },
      { id: "A4", status: "stale" },
    ]);

    const audit = readAudit();
    expect(audit.some((r) => r.actor === "lawyer" && r.action.includes("M14 overridden"))).toBe(true);
    expect(audit.some((r) => r.actor === "system" && r.action.includes("marked stale (A2, A4)"))).toBe(true);
  });

  it("second override bumps to v3", () => {
    override("M14", "first note");
    const res = override("M14", "second note");
    expect(res.version).toBe(3);
    expect(getOverride("M14")!.note).toBe("second note");
  });

  it("no dependents → no cascade audit row, empty stale list", () => {
    seedArg("A1", ["M1"]);
    const res = override("M16", "renumbering check note");
    expect(res.staleArgIds).toEqual([]);
    expect(readAudit().some((r) => r.action.includes("marked stale"))).toBe(false);
  });

  it("unknown mapping throws", () => {
    expect(() => override("M999", "nope")).toThrow(/Unknown mapping/);
  });

  it("reverify writes an audit row with the new version", () => {
    markReverified("A2", 2);
    const audit = readAudit();
    expect(audit[0].action).toContain("A2 re-verified");
    expect(audit[0].version).toBe("v2");
  });
});
