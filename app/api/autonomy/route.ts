import { NextRequest, NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";

const LEVELS = ["Ask every step", "Supervised", "Autonomous (gated)"];

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { level?: string };
  if (!body.level || !LEVELS.includes(body.level)) {
    return NextResponse.json({ error: "invalid level" }, { status: 400 });
  }
  const row = writeAudit("lawyer", `Autonomy level changed → ${body.level}`, "Autonomy dial");
  return NextResponse.json({ row });
}
