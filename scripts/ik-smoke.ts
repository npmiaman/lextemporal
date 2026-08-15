import { search, fetchDoc, getSpend } from "../lib/kanoon";

async function main() {
  const q = "specific performance agreement to sell commercial property";
  const r1 = await search(q, { todate: "30-9-2018" });
  if (!r1) throw new Error("null result");
  console.log(`search fromCache=${r1.fromCache} results=${r1.results.length}`);
  for (const r of r1.results.slice(0, 4)) {
    console.log(` - [${r.docid}] ${r.date} | ${r.court} | ${r.title.slice(0, 70)}`);
  }
  const first = r1.results[0];
  const doc = await fetchDoc(first.docid);
  console.log(
    `doc title=${doc!.title.slice(0, 60)} date=${doc!.date} paras=${doc!.paragraphs.length} chars=${doc!.text.length}`
  );
  console.log("para3:", doc!.paragraphs[2]?.slice(0, 150));
  const r2 = await search(q, { todate: "30-9-2018" });
  console.log(`second search fromCache=${r2!.fromCache}`);
  console.log("spend:", getSpend());
}

main().catch((e) => {
  console.error("SMOKE FAIL:", e);
  process.exit(1);
});
