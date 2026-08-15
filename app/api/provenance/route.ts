import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchDoc } from "@/lib/kanoon";
import type { DraftSource } from "@/lib/drafting";

// Resolve a [dN¶M] citation to the actual cached judgment paragraph.
export async function GET(req: NextRequest) {
  const matterId = Number(req.nextUrl.searchParams.get("matterId"));
  const side = req.nextUrl.searchParams.get("side") ?? "ours";
  const tag = req.nextUrl.searchParams.get("tag");
  const para = Number(req.nextUrl.searchParams.get("para"));
  if (!matterId || !tag || !Number.isFinite(para) || para < 1) {
    return NextResponse.json({ error: "matterId, tag and para are required" }, { status: 400 });
  }

  const srcRow = getDb()
    .prepare("SELECT payload FROM draft_sources WHERE matter_id = ? AND side = ?")
    .get(matterId, side) as { payload: string } | undefined;
  if (!srcRow) return NextResponse.json({ error: "no draft sources yet" }, { status: 404 });

  const { sources } = JSON.parse(srcRow.payload) as { sources: DraftSource[] };
  const source = sources.find((s) => s.tag === tag);
  if (!source) return NextResponse.json({ error: `unknown source tag ${tag}` }, { status: 404 });

  // Cache-only: drafting already fetched this doc; never hit the network here.
  const doc = await fetchDoc(source.docid, { allowNetwork: false });
  if (!doc) return NextResponse.json({ error: "doc not in cache" }, { status: 404 });

  return NextResponse.json({
    source,
    para,
    paragraph: doc.paragraphs[para - 1] ?? null,
    totalParas: doc.paragraphs.length,
  });
}
