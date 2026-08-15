import { NextRequest, NextResponse } from "next/server";
import { listPins, setPin } from "@/lib/matter";

export async function GET(req: NextRequest) {
  const matterId = Number(req.nextUrl.searchParams.get("matterId"));
  if (!matterId) return NextResponse.json({ error: "matterId is required" }, { status: 400 });
  return NextResponse.json({ pins: listPins(matterId) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    matterId?: number;
    pinned?: boolean;
    doc?: { docid: string; title: string; court: string; date: string; url: string; flag_color: string };
  };
  if (!body.matterId || !body.doc?.docid || body.pinned === undefined) {
    return NextResponse.json({ error: "matterId, doc and pinned are required" }, { status: 400 });
  }
  try {
    setPin(body.matterId, body.doc, body.pinned);
    return NextResponse.json({ pins: listPins(body.matterId) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
