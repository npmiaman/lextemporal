import { NextRequest, NextResponse } from "next/server";
import { override } from "@/lib/override";
import { enforce, GuardrailError } from "@/lib/guardrails";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { mappingId?: string; note?: string; confirmed?: boolean };
  if (!body.mappingId || !body.note?.trim()) {
    return NextResponse.json({ error: "mappingId and note are required" }, { status: 400 });
  }
  try {
    // Gated at every autonomy level: an override changes the legal opinion the
    // system gives about every dependent argument.
    enforce("override", body.confirmed === true, body.mappingId);
    const res = override(body.mappingId, body.note.trim());
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof GuardrailError) {
      return NextResponse.json(
        { error: e.message, rail: e.rail, needsConfirmation: true },
        { status: 428 } // Precondition Required
      );
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
