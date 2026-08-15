import { NextRequest, NextResponse } from "next/server";
import { simulateStep, tallyBatch } from "@/lib/simulation";

// One step per call: runs the next missing run in the batch (a real Gemini call
// unless the identical prompt is cached) and returns the running tally. The
// client loops until tally.runs === n, showing honest progress.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    matterId?: number;
    batch?: string;
    n?: number;
    tallyOnly?: boolean;
  };
  if (!body.matterId || !body.batch) {
    return NextResponse.json({ error: "matterId and batch are required" }, { status: 400 });
  }
  const n = Math.min(Math.max(body.n ?? 10, 1), 50);
  try {
    if (body.tallyOnly) {
      return NextResponse.json({ tally: tallyBatch(body.matterId, body.batch), n });
    }
    const tally = await simulateStep(body.matterId, body.batch, n);
    return NextResponse.json({ tally, n });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
