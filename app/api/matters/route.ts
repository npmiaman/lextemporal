import { NextRequest, NextResponse } from "next/server";
import {
  createMatter,
  listMatters,
  sampleMatterInput,
  updateMatter,
  validateMatterInput,
  type MatterInput,
} from "@/lib/matter";
import { lawDataCurrentAsOf } from "@/lib/mappings";
import { getSpend } from "@/lib/kanoon";
import { isEphemeralDeployment } from "@/lib/db";

export async function GET() {
  return NextResponse.json({
    matters: listMatters(),
    lawDataCurrentAsOf,
    spend: getSpend(),
    ephemeral: isEphemeralDeployment(),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { sample?: boolean; matter?: MatterInput };
  try {
    if (body.sample) {
      return NextResponse.json({ matter: createMatter(sampleMatterInput()) });
    }
    const err = validateMatterInput(body.matter ?? {});
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    return NextResponse.json({ matter: createMatter(body.matter!) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { id?: number; matter?: MatterInput };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const err = validateMatterInput(body.matter ?? {});
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  try {
    return NextResponse.json({ matter: updateMatter(body.id, body.matter!) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
