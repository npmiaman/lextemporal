import { NextRequest, NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { getMatter, matterRef } from "@/lib/matter";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { matterId?: number };
  const matter = body.matterId ? getMatter(body.matterId) : undefined;
  const row = writeAudit(
    "lawyer",
    "Brief exported — sign-off recorded: flagged authorities reviewed, responsibility acknowledged",
    matter ? matterRef(matter) : "Export brief"
  );
  return NextResponse.json({ row });
}
