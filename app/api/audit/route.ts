import { NextResponse } from "next/server";
import { readAudit } from "@/lib/audit";

export async function GET() {
  return NextResponse.json({ rows: readAudit() });
}
