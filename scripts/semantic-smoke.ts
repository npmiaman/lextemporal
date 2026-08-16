/**
 * End-to-end semantic retrieval smoke test.
 *
 * Proves the real pipeline against the real index: NIM query embedding →
 * binary Hamming seed → asymmetric rescore → collapse to judgments → NIM
 * cross-encoder rerank → temporal-validity flag.
 *
 * Run: npx tsx --env-file=.env.local scripts/semantic-smoke.ts
 */

import { NimEmbedProvider, NimRerankProvider } from "@/lib/embed";
import { collapseToDocs, indexStats, searchChunks } from "@/lib/vectors";
import { chunkTexts, fetchDoc, isoDate } from "@/lib/corpus";
import { computeValidity } from "@/lib/validity";
import { mappings } from "@/lib/mappings";
import type { MatterDates } from "@/lib/matter";

const QUERIES = [
  "readiness and willingness to perform the contract in a suit for specific performance",
  "certificate for admissibility of electronic records and WhatsApp messages",
  "pre-institution mediation is mandatory before filing a commercial suit",
];

// Seeded matter timeline: breach 2019, suit 2021, trial ongoing.
const DATES: MatterDates = { cause: "2019-06-04", suit: "2021-01-18", trial: "2026-08-16" };

async function main() {
  const stats = indexStats();
  if (!stats) {
    console.log("No vectors yet — run scripts/ingest/embed_chunks.py first.");
    return;
  }
  console.log(`index: ${stats.n.toLocaleString()} chunks · ${stats.dims} dims · ${stats.mb.toFixed(0)} MB\n`);

  const embed = new NimEmbedProvider();
  const rerank = new NimRerankProvider();

  for (const q of QUERIES) {
    console.log("=".repeat(90));
    console.log(`QUERY: ${q}`);

    let t = Date.now();
    const [qvec] = await embed.embed([q], "query");
    const tEmbed = Date.now() - t;

    t = Date.now();
    const hits = searchChunks(qvec, 400);
    const tScan = Date.now() - t;

    const docs = collapseToDocs(hits, 12);

    // Rerank the winning passage of each candidate judgment.
    const passages: string[] = [];
    for (const d of docs) {
      const found = chunkTexts(d.cnr).find((c) => c.chunk.id === d.bestChunk);
      passages.push((found?.text ?? "").slice(0, 1800));
    }
    t = Date.now();
    const logits = await rerank.rerank(q, passages);
    const tRerank = Date.now() - t;

    const ranked = docs
      .map((d, i) => ({ ...d, logit: logits[i], passage: passages[i] }))
      .sort((a, b) => b.logit - a.logit)
      .slice(0, 5);

    console.log(
      `timing: embed ${tEmbed}ms · scan ${tScan}ms · rerank ${tRerank}ms · total ${tEmbed + tScan + tRerank}ms\n`
    );

    let rank = 0;
    for (const r of ranked) {
      rank += 1;
      const doc = fetchDoc(r.cnr);
      if (!doc) continue;
      const flag = computeValidity({ date: doc.date, text: doc.text }, mappings, DATES);
      console.log(
        `#${rank} [${flag.color.toUpperCase().padEnd(5)}] ${doc.date || "date n/a"}  ${doc.title.slice(0, 62)}`
      );
      console.log(
        `     logit ${r.logit.toFixed(2)} · hamming ${r.hamming} · ${r.nHits} chunk hit(s)` +
          (doc.citation ? ` · ${doc.citation}` : "")
      );
      console.log(`     "${r.passage.replace(/\s+/g, " ").slice(0, 150)}…"`);
      if (flag.color !== "grey" && flag.color !== "green") {
        console.log(`     FLAG: ${flag.reason.slice(0, 150)}`);
      }
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
