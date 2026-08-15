import { NextRequest, NextResponse } from "next/server";
import { DraftingError, redraftArgument } from "@/lib/drafting";
import { markReverified } from "@/lib/override";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { matterId?: number; argId?: string };
  if (!body.matterId || !body.argId) {
    return NextResponse.json({ error: "matterId and argId are required" }, { status: 400 });
  }
  try {
    const arg = await redraftArgument(body.matterId, body.argId);
    markReverified(arg.id, arg.version);
    return NextResponse.json({ argument: arg });
  } catch (e) {
    const status = e instanceof DraftingError ? 400 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
