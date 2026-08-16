# LexTemporal corpus rebuild — task list

Asymmetric window: **SC all years** (22,576 docs — full history is cheap and is where
superseded authority actually gets cited), **HC 2016+** (13.2M spine).

Status legend: `[ ]` todo · `[~]` running · `[x]` done+verified · `[!]` blocked

## Corpus
- [x] Full spine ingest — 17,902,185 rows, 100% dated, 238 B/row
- [x] SC `src_path` populated — 22,576/22,576
- [x] Fix `chunks` text duplication — stores para ranges; `lib/corpus.ts chunkTexts()` rebuilds
- [x] Dropped pre-2016 HC — 4,655,572 rows; spine now 13,246,613; free disk 4.0 → 8.7 GB
- [~] SC full text from AWS PDFs — RUNNING
- [ ] **BLOCKING before embedding**: strip PDF page furniture (margin letters A–H) from `doc_text`
      and rebuild affected `chunks`. Measured: 13/40 sampled docs, ~225 junk lines each.
      Order is normalise → rebuild chunks → embed; embedding first wastes the whole pass.
- [ ] HC gate + text, 2016+ → ~227k docs, ~1.3 GB

## Statutes
- [x] Statutes re-run into data/lex.db — **883 acts / 22,914 amendments** (matches scratch validation)
- [x] Act-level succession table (IPC→BNS, CrPC→BNSS, IEA→BSA)
- [ ] IPC↔BNS section concordance via embedding similarity → ranked candidates for
      lawyer review. Never asserted as authority.

## Retrieval — design corrections from the stress-test pass
- Vector residency is **~5.74M codes = 1.47 GB** at full gated scale, not the 870 MB I measured
  at 3.4M. Size for 5.7M, not 3.4M.
- The Hamming scan MUST run in worker threads over a SharedArrayBuffer. 1.19 s of synchronous
  popcount blocks the event loop, serialising concurrent searches and stalling every other API
  route. This is correctness, not performance.
- Add `prov_by_date(act, section, decision_date, cnr)` — `judgment_provisions` alone cannot answer
  "judgments citing SRA S.16 decided before 2018-10-01" without joining every row to `judgments`.
- Need an FTS5 lexical seed for true offline. Graph expansion alone has no seed to expand *from*.
- Export `matchesMapping` from validity.ts rather than reimplementing it in graph.ts — a second
  copy of that normaliser is how retrieval and flags silently disagree.
- Mined amendments must NOT drive retrieval expansion (they still surface as an unverified flag
  tier). Evidence: the SRA S.16 "fails to aver and prove" amendment — the single most important
  row for this product — was filed by the anchor fallback under `provision='2'`.
- `pinned_docs` needs an IK-era purge: IK docids are numeric, CNRs are not.

## Retrieval
- [x] NIM embed verified live — nemotron-3-embed-1b, **2048 dims**
- [x] NIM rerank verified live — ai.api.nvidia.com/v1/retrieval/{model}/reranking
- [ ] Embed gated chunks → binary codes (script built; packing verified byte-identical to lib/embed.ts)
- [ ] Provision graph edges — script built + unit-verified, waits on text
- [ ] Citation edges — script built, waits on text (SCC 6.70% · neutral 3.99% · AIR 3.15%)
- [ ] Rewrite `lib/retrieval.ts`: vector seed → graph expansion → rerank
- [ ] Replace Indian Kanoon calls in drafting.ts / provenance route

## Guardrails & governance (NeMo Guardrails rail taxonomy, implemented natively)
- [x] **Execution rail** — autonomy dial made real. Policy persisted server-side in
      `agent_policy`, enforced in routes via `enforce()`, refusals written to the audit log.
      `override` and `export` stay gated even at "Autonomous (gated)". Verified against a live DB.
- [x] **Retrieval rail** — corpus text fenced with a per-request random nonce and labelled
      evidence-not-instruction (OWASP LLM01 indirect injection). Line-initial role markers
      defanged by indentation, so no character of the judgment is destroyed.
- [x] **Output rail** — every `[dN¶M]` verified against the paragraph it points at:
      tag resolves, paragraph exists, sentence shares content words. Results persisted to
      `citation_checks` and summarised into the audit log. Applies to redrafts too.
- [x] 14 guardrail tests, incl. the 3 real false-positive strings from the corpus. 38/38 pass.
- [ ] Surface citation-check verdicts in the Arguments UI (weak-support badge per sentence)
- [ ] Wire `enforce()` into `/api/draft` and `/api/simulate` (routes exist, rail not yet applied)

## Bugs found and fixed
- [x] **`SECTION_LIST` carried the `i` flag in lib/validity.ts** — `[A-Z]{0,2}` then matched
      lowercase, so "Sections 45 and 65B" parsed as "45 an" and dropped 65B, the
      electronic-evidence certificate section. Fixed in validity.ts + graph.py;
      3 regression tests added; proven to fail on the old pattern. 24/24 tests pass.

## Later
- [ ] MCTS simulation (constrained UCT over the enumerated ANGLES)
- [ ] Eval harness vs ILDC
- [ ] State Acts via India Code bitstream PDF crawl
- [!] Gazette commencement notifications — no bulk access found

## Known-unobtainable
- Gazette S.O. commencement notifications (no bulk API)
- HC citation field in metadata (mined from text instead)
