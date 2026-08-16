/**
 * Pipeline integrity checks. Catches the failures that produce no error and no
 * visible symptom — the ones that just quietly make retrieval wrong.
 *
 * Run: npx tsx --env-file=.env.local scripts/pipeline-verify.ts
 */

import Database from "better-sqlite3";
import zlib from "zlib";
import { NimEmbedProvider } from "@/lib/embed";
import { toBinary } from "@/lib/vectors";

const db = new Database("data/lex.db", { readonly: true });
const PARA_SPLIT = /\n{2,}/;
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

/** Reconstruct chunk text exactly as lib/corpus.ts chunkTexts() does. */
function chunkTextTS(cnr: string, ps: number, pe: number): string | null {
  const row = db.prepare("SELECT text FROM doc_text WHERE cnr = ?").get(cnr) as
    | { text: Buffer }
    | undefined;
  if (!row) return null;
  const paras = zlib
    .inflateSync(row.text)
    .toString("utf-8")
    .split(PARA_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras.slice(ps - 1, pe).join("\n\n");
}

async function main() {
  console.log("\n1. CHUNK COVERAGE");
  const gaps = db
    .prepare(
      `SELECT c.cnr, d.n_paras, max(c.para_end) last_para, count(*) n
       FROM chunks c JOIN doc_text d ON d.cnr = c.cnr
       GROUP BY c.cnr HAVING last_para <> d.n_paras LIMIT 5`
    )
    .all() as any[];
  const totalDocs = (db.prepare("SELECT count(*) n FROM doc_text").get() as any).n;
  check(
    "every document's chunks reach its last paragraph",
    gaps.length === 0,
    gaps.length ? `${gaps.length} docs with gaps, e.g. ${gaps[0].cnr}` : `${totalDocs} docs`
  );

  const orphanChunks = (
    db
      .prepare("SELECT count(*) n FROM chunks c LEFT JOIN doc_text d ON d.cnr=c.cnr WHERE d.cnr IS NULL")
      .get() as any
  ).n;
  check("no chunks orphaned from their document", orphanChunks === 0, `${orphanChunks} orphans`);

  const orphanVecs = (
    db
      .prepare(
        "SELECT count(*) n FROM chunk_vectors v LEFT JOIN chunks c ON c.id=v.chunk_id WHERE c.id IS NULL"
      )
      .get() as any
  ).n;
  check("no vectors orphaned from their chunk", orphanVecs === 0, `${orphanVecs} orphans`);

  console.log("\n2. VECTOR INTEGRITY");
  const dims = db.prepare("SELECT DISTINCT dims FROM chunk_vectors").all() as any[];
  check("all vectors share one dimensionality", dims.length <= 1, JSON.stringify(dims.map((d) => d.dims)));

  const models = db.prepare("SELECT DISTINCT model FROM chunk_vectors").all() as any[];
  check("all vectors from one model", models.length <= 1, models.map((m) => m.model).join(", "));

  const badLen = (
    db.prepare("SELECT count(*) n FROM chunk_vectors WHERE length(bin) <> dims/8").get() as any
  ).n;
  check("every code is dims/8 bytes", badLen === 0, `${badLen} wrong-length`);

  const degenerate = (
    db.prepare("SELECT count(*) n FROM chunk_vectors WHERE hex(bin) = hex(zeroblob(length(bin)))").get() as any
  ).n;
  check("no all-zero codes", degenerate === 0, `${degenerate} degenerate`);

  console.log("\n3. TEXT ↔ VECTOR PARITY (the silent killer)");
  const sample = db
    .prepare(
      `SELECT c.id, c.cnr, c.para_start, c.para_end, c.n_chars, v.bin, v.dims
       FROM chunks c JOIN chunk_vectors v ON v.chunk_id = c.id
       ORDER BY random() LIMIT 4`
    )
    .all() as any[];

  if (sample.length === 0) {
    check("vectors exist to sample", false, "chunk_vectors empty");
  } else {
    const embed = new NimEmbedProvider();
    let lenBad = 0;
    let bitBad = 0;
    for (const r of sample) {
      const text = chunkTextTS(r.cnr, r.para_start, r.para_end);
      if (text === null) continue;
      if (text.length !== r.n_chars) lenBad++;
      const [vec] = await embed.embed([text], "passage");
      const mine = toBinary(vec);
      const stored: Buffer = r.bin;
      let diff = 0;
      for (let i = 0; i < stored.length; i++) {
        let x = mine[i] ^ stored[i];
        while (x) {
          diff += x & 1;
          x >>= 1;
        }
      }
      if (diff !== 0) bitBad++;
      console.log(
        `        ${r.id.padEnd(24)} TSlen=${text.length} stored=${r.n_chars}  bits differing ${diff}/${r.dims}`
      );
    }
    check("TS chunk text length matches Python's stored n_chars", lenBad === 0, `${lenBad}/${sample.length} differ`);
    check("re-embedding TS text reproduces the stored code", bitBad === 0, `${bitBad}/${sample.length} drift`);
  }

  console.log("\n4. PROVENANCE ROUND-TRIP");
  const prov = db
    .prepare(
      `SELECT c.cnr, c.para_start, c.para_end, d.n_paras
       FROM chunks c JOIN doc_text d ON d.cnr=c.cnr ORDER BY random() LIMIT 200`
    )
    .all() as any[];
  const outOfRange = prov.filter((p) => p.para_end > p.n_paras || p.para_start < 1).length;
  check("no chunk references a paragraph outside its document", outOfRange === 0, `${outOfRange}/200`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
