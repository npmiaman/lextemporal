import { NextRequest, NextResponse } from "next/server";
import { courtLabel, fetchDoc, getSpine } from "@/lib/corpus";

export const runtime = "nodejs";

/**
 * Resolve one [dN¶M] pin to the paragraph it points at.
 *
 * This is the contract the whole drafting path rests on: a sentence claims to be
 * supported by a numbered paragraph of a named judgment, and the lawyer must be
 * able to check that in one click rather than take it on trust. Served straight
 * from the local corpus — no network, no cache-miss failure mode.
 *
 * The older /api/provenance does the same job for the matter-and-pins UI through
 * the Indian Kanoon client; this one is for the conversational surface, where the
 * source is a CNR in the corpus.
 */
export async function GET(req: NextRequest) {
  const cnr = req.nextUrl.searchParams.get("cnr");
  const para = Number(req.nextUrl.searchParams.get("para"));
  if (!cnr || !Number.isFinite(para) || para < 1) {
    return NextResponse.json({ error: "cnr and para are required" }, { status: 400 });
  }

  const doc = fetchDoc(cnr);
  if (!doc) {
    const spine = getSpine(cnr);
    return NextResponse.json(
      {
        error: spine
          ? `${spine.title} is in the corpus index but its text is outside the gated working set.`
          : `Unknown judgment ${cnr}.`,
      },
      { status: 404 }
    );
  }

  const paragraph = doc.paragraphs[para - 1];
  if (paragraph == null) {
    return NextResponse.json(
      { error: `That judgment has ${doc.paragraphs.length} paragraphs; ¶${para} does not exist.` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    cnr,
    para,
    paragraph,
    title: doc.title,
    court: courtLabel({ bucket: cnr.startsWith("ESCR") ? "sc" : "hc", court_code: "", bench: doc.court }),
    date: doc.date,
    citation: doc.citation,
    totalParas: doc.paragraphs.length,
  });
}
