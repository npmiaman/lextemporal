import { NextRequest, NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { ocrImage, OcrError, LOW_CONFIDENCE } from "@/lib/ocr";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Case-document intake.
 *
 * Uploaded papers are parsed to text in memory and returned to the client; they
 * are NOT written to the corpus. The corpus is a published body of judgments —
 * mixing a party's confidential filings into it would be both a privacy problem
 * and a retrieval one, because a draft plaint is not authority.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file is ${(file.size / 1e6).toFixed(1)} MB; limit is 20 MB` },
      { status: 413 }
    );
  }

  const name = file.name || "document";
  const lower = name.toLowerCase();

  try {
    let text = "";
    let ocr = false;
    let ocrConfidence = 0;
    if (lower.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const buf = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(buf);
      const out = await extractText(pdf, { mergePages: true });
      text = Array.isArray(out.text) ? out.text.join("\n\n") : out.text;
    } else if (/\.(txt|md|markdown|csv|json)$/.test(lower)) {
      text = await file.text();
    } else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|tiff?)$/.test(lower)) {
      // Scanned orders and phone photos of the record arrive as images. OCR
      // returns typed, bounding-boxed elements which are then read top-to-bottom
      // so the extracted dates stay attached to the clause they belong to.
      const buf = Buffer.from(await file.arrayBuffer());
      const out = await ocrImage(buf);
      text = out.text;
      ocr = true;
      ocrConfidence = out.confidence;
    } else {
      // .doc/.docx would need another parser; say so rather than returning
      // an empty excerpt that looks like a successful parse.
      return NextResponse.json(
        { error: `cannot read ${name.split(".").pop()} yet — upload PDF or text` },
        { status: 415 }
      );
    }

    text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 40) {
      return NextResponse.json(
        { error: "no readable text found — this may be a scanned image needing OCR" },
        { status: 422 }
      );
    }

    writeAudit(
      "lawyer",
      `Case document uploaded — ${name}${ocr ? ` (OCR, confidence ${ocrConfidence.toFixed(0)})` : ""}`,
      `${text.length} chars extracted`
    );
    return NextResponse.json({
      name,
      chars: text.length,
      ocr,
      confidence: ocr ? ocrConfidence : undefined,
      // A weak read is reported, never smoothed over: these dates become the
      // matter timeline, and a misread digit changes every validity flag.
      warning:
        ocr && ocrConfidence < LOW_CONFIDENCE
          ? `OCR confidence ${ocrConfidence.toFixed(0)}/100 — check the extracted dates before relying on them.`
          : undefined,
      // Capped: the client keeps this in memory and posts it back with prompts.
      excerpt: text.slice(0, 200_000),
    });
  } catch (e) {
    if (e instanceof OcrError) {
      return NextResponse.json({ error: e.message, retryable: e.retryable }, { status: 422 });
    }
    return NextResponse.json(
      { error: `could not parse ${name}: ${String(e).slice(0, 160)}` },
      { status: 422 }
    );
  }
}
