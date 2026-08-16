import { NextRequest, NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { getMatter, matterRef } from "@/lib/matter";
import { enforce, GuardrailError } from "@/lib/guardrails";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    matterId?: number;
    confirmed?: boolean;
  };
  const matter = body.matterId ? getMatter(body.matterId) : undefined;
  try {
    // Gated at every autonomy level. This is the point where a human takes
    // responsibility for a filing; it is never an unattended action.
    enforce("export", body.confirmed === true, matter ? matterRef(matter) : "Export brief");
  } catch (e) {
    if (e instanceof GuardrailError) {
      return NextResponse.json(
        { error: e.message, rail: e.rail, needsConfirmation: true },
        { status: 428 }
      );
    }
    throw e;
  }
  const row = writeAudit(
    "lawyer",
    "Brief exported — sign-off recorded: flagged authorities reviewed, responsibility acknowledged",
    matter ? matterRef(matter) : "Export brief"
  );
  return NextResponse.json({ row });
}
