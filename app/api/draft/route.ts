import { NextRequest, NextResponse } from "next/server";
import { draftArguments, DraftingError } from "@/lib/drafting";
import { getDb } from "@/lib/db";
import type { DraftSource } from "@/lib/drafting";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    matterId?: number;
    side?: "ours" | "opposing";
    force?: boolean;
    peek?: boolean;
  };
  const side = body.side === "opposing" ? "opposing" : "ours";
  if (!body.matterId) {
    return NextResponse.json({ error: "matterId is required" }, { status: 400 });
  }
  try {
    if (body.peek) {
      // Read-only: return stored drafts without ever triggering the LLM.
      const db = getDb();
      const rows = db
        .prepare("SELECT * FROM arguments WHERE matter_id = ? AND side = ? ORDER BY idx")
        .all(body.matterId, side) as {
        id: string;
        payload: string;
        status: string;
        version: number;
      }[];
      const srcRow = db
        .prepare("SELECT payload FROM draft_sources WHERE matter_id = ? AND side = ?")
        .get(body.matterId, side) as { payload: string } | undefined;
      const meta = srcRow
        ? (JSON.parse(srcRow.payload) as { sources: DraftSource[]; abstentions: string[] })
        : { sources: [], abstentions: [] };
      return NextResponse.json({
        args: rows.map((r) => ({
          ...JSON.parse(r.payload),
          id: r.id,
          side,
          status: r.status,
          version: r.version,
        })),
        abstentions: meta.abstentions,
        sources: meta.sources,
        fromCache: true,
      });
    }
    const out = await draftArguments(body.matterId, side, { force: body.force });
    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof DraftingError ? 400 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
