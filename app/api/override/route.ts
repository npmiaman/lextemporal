import { NextRequest, NextResponse } from "next/server";
import { override } from "@/lib/override";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { mappingId?: string; note?: string };
  if (!body.mappingId || !body.note?.trim()) {
    return NextResponse.json({ error: "mappingId and note are required" }, { status: 400 });
  }
  try {
    const res = override(body.mappingId, body.note.trim());
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
