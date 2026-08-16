import { NextRequest, NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { AUTONOMY_LABELS, getAutonomy, parseAutonomy, setAutonomy } from "@/lib/guardrails";

export async function GET() {
  const level = getAutonomy();
  return NextResponse.json({ level, label: AUTONOMY_LABELS[level] });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { level?: string };
  const level = body.level ? parseAutonomy(body.level) : null;
  if (!level) {
    return NextResponse.json({ error: "invalid level" }, { status: 400 });
  }
  // Persist server-side. Previously this only wrote an audit row, so the dial
  // recorded an intention it never enforced.
  setAutonomy(level);
  const row = writeAudit(
    "lawyer",
    `Autonomy level changed → ${AUTONOMY_LABELS[level]}`,
    "Autonomy dial"
  );
  return NextResponse.json({ row, level, label: AUTONOMY_LABELS[level] });
}
