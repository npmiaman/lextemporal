// Retrieval = Indian Kanoon API, cache-first, top ~10 on IK's own relevance
// ranking. No embeddings, no vector DB, no ingest pipeline.
// (Dense re-ranking over the fetched texts is a future add, deliberately not built.)

import * as kanoon from "@/lib/kanoon";
import { computeValidity, type ValidityFlag } from "@/lib/validity";
import { mappings } from "@/lib/mappings";
import type { MatterDates } from "@/lib/matter";
import { writeAudit } from "@/lib/audit";

export interface RankedJudgment {
  rank: number;
  docid: string;
  title: string;
  court: string;
  date: string;
  snippet: string;
  url: string;
  flag: ValidityFlag;
}

export interface SearchOutcome {
  results: RankedJudgment[];
  fromCache: boolean;
  networkDown: boolean;
}

export async function searchWithFlags(
  query: string,
  filters: kanoon.IkSearchFilters = {},
  dates: MatterDates,
  opts: { audit?: boolean } = {}
): Promise<SearchOutcome> {
  const effective = { doctypes: "judgments", ...filters };
  let networkDown = false;

  let searchRes: Awaited<ReturnType<typeof kanoon.search>>;
  try {
    searchRes = await kanoon.search(query, effective);
  } catch (e) {
    if (e instanceof kanoon.IkNetworkError) {
      // Network unavailable — fall back to cache-only. Cached queries still
      // serve fully; a genuinely novel query returns networkDown with no rows.
      networkDown = true;
      searchRes = await kanoon.search(query, effective, 0, { allowNetwork: false });
    } else {
      throw e;
    }
  }
  if (!searchRes) return { results: [], fromCache: false, networkDown };

  const results: RankedJudgment[] = [];
  let rank = 0;
  for (const r of searchRes.results) {
    let doc: kanoon.IkDoc | null = null;
    try {
      doc = await kanoon.fetchDoc(r.docid, networkDown ? { allowNetwork: false } : {});
    } catch (e) {
      if (e instanceof kanoon.IkNetworkError) {
        networkDown = true;
        doc = await kanoon.fetchDoc(r.docid, { allowNetwork: false });
      } else {
        throw e;
      }
    }
    if (!doc) continue; // network down and this doc was never cached
    rank += 1;
    const date = r.date || doc.date;
    results.push({
      rank,
      docid: r.docid,
      title: r.title || doc.title,
      court: r.court || doc.court,
      date,
      snippet: r.snippet,
      url: r.url,
      flag: computeValidity({ date, text: doc.text }, mappings, dates),
    });
  }

  if (opts.audit !== false) {
    writeAudit("system", `Retrieval run — Indian Kanoon (${searchRes.fromCache ? "cache" : "live"})`, `Query: "${query}"`);
    const tally = { red: 0, amber: 0, grey: 0, green: 0 } as Record<string, number>;
    for (const r of results) tally[r.flag.color]++;
    writeAudit(
      "system",
      `Temporal validity flags computed — ${tally.green} green · ${tally.amber} amber · ${tally.red} red · ${tally.grey} grey`,
      `${results.length} authorities`
    );
  }

  return { results, fromCache: searchRes.fromCache, networkDown };
}
