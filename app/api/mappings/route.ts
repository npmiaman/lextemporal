import { NextRequest, NextResponse } from "next/server";
import { mappings } from "@/lib/mappings";
import { listOverrides } from "@/lib/override";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const matterId = Number(req.nextUrl.searchParams.get("matterId")) || 0;
  const argRows = matterId
    ? (getDb()
        .prepare(
          "SELECT id, side, payload, status, version FROM arguments WHERE matter_id = ? ORDER BY side, idx"
        )
        .all(matterId) as {
        id: string;
        side: string;
        payload: string;
        status: string;
        version: number;
      }[])
    : [];
  return NextResponse.json({
    mappings,
    overrides: listOverrides(),
    argumentStatus: argRows.map((r) => ({
      id: r.id,
      side: r.side,
      status: r.status,
      version: r.version,
      mapping_deps: (JSON.parse(r.payload) as { mapping_deps?: string[] }).mapping_deps ?? [],
    })),
  });
}
