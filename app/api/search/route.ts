import { NextRequest, NextResponse } from "next/server";
import { searchWithFlags } from "@/lib/retrieval";
import { getSpend } from "@/lib/kanoon";
import { getMatter, matterDatesFor } from "@/lib/matter";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    matterId?: number;
    query?: string;
    filters?: { doctypes?: string; fromdate?: string; todate?: string };
  };
  if (!body.query?.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  const matter = body.matterId ? getMatter(body.matterId) : undefined;
  if (!matter) {
    return NextResponse.json(
      { error: "matterId is required — validity flags are computed against the matter's timeline" },
      { status: 400 }
    );
  }
  try {
    const outcome = await searchWithFlags(body.query, body.filters ?? {}, matterDatesFor(matter));
    return NextResponse.json({ ...outcome, spend: getSpend() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
