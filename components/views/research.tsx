"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FlagSheet } from "@/components/flag-sheet";
import { useLexStore } from "@/lib/store";
import type { RankedJudgment } from "@/lib/retrieval";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Loader2,
  OctagonAlert,
  Pin,
  PinOff,
  Search,
  WifiOff,
} from "lucide-react";

const COURTS = [
  { value: "judgments", label: "All courts" },
  { value: "supremecourt", label: "Supreme Court" },
  { value: "delhi", label: "Delhi HC" },
  { value: "bombay", label: "Bombay HC" },
  { value: "kolkata", label: "Calcutta HC" },
  { value: "chennai", label: "Madras HC" },
  { value: "punjab", label: "Punjab & Haryana HC" },
  { value: "karnataka", label: "Karnataka HC" },
];

function ValidityBadge({ j }: { j: RankedJudgment }) {
  const { color, reason } = j.flag;
  const short = reason.length > 110 ? reason.slice(0, 110) + "…" : reason;
  const styles = {
    green: ["bg-green-100 text-green-800", CheckCircle2],
    amber: ["bg-amber-100 text-amber-800", AlertTriangle],
    red: ["bg-red-100 text-red-800", OctagonAlert],
    grey: ["bg-slate-200 text-slate-700", CircleHelp],
  } as const;
  const [cls, Icon] = styles[color];
  return (
    <span className={cn("inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-[13px] font-bold", cls)}>
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      {short}
    </span>
  );
}

function SkeletonCard() {
  return (
    <Card className="h-[170px] animate-pulse gap-3 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-6 w-2/3 rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export function ResearchView() {
  const [selected, setSelected] = useState<RankedJudgment | null>(null);
  const {
    activeMatterId,
    matters,
    query,
    setQuery,
    filters,
    setFilters,
    searching,
    searchStatus,
    results,
    networkDown,
    spend,
    runSearch,
    pins,
    togglePin,
    pulseDocId,
    clearPulse,
  } = useLexStore();
  const pulseRef = useRef<HTMLDivElement | null>(null);
  const activeMatter = matters.find((m) => m.id === activeMatterId);

  useEffect(() => {
    if (!pulseDocId) return;
    pulseRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(clearPulse, 4000);
    return () => clearTimeout(timer);
  }, [pulseDocId, clearPulse]);

  const tally = { red: 0, amber: 0, grey: 0, green: 0 } as Record<string, number>;
  for (const r of results) tally[r.flag.color]++;

  if (!activeMatter) {
    return (
      <Alert className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
        <AlertTriangle className="size-4 text-amber-700" />
        <AlertDescription className="text-[13px] font-bold text-amber-900">
          Create or select a matter first — validity flags are computed against its timeline.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search Indian Kanoon — use "quoted phrases" for precision…'
            className="bg-card pl-8 text-sm"
            aria-label="Search query"
          />
        </div>
        <select
          value={filters.doctypes}
          onChange={(e) => setFilters({ doctypes: e.target.value })}
          className="h-8 rounded-lg border border-border bg-card px-2 text-sm"
          aria-label="Court filter"
        >
          {COURTS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <Tooltip>
          <TooltipTrigger
            render={
              <Input
                value={filters.todate}
                onChange={(e) => setFilters({ todate: e.target.value })}
                placeholder="to date d-m-yyyy"
                className="h-8 w-[130px] bg-card text-xs"
                aria-label="To date"
              />
            }
          />
          <TooltipContent>
            Optional: only judgments up to this date (e.g. 30-9-2018 to hunt pre-amendment
            authority).
          </TooltipContent>
        </Tooltip>
        <Button type="submit" disabled={searching || !query.trim()}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search
        </Button>
      </form>

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        {searchStatus && (
          <span className={cn(networkDown && "font-medium text-amber-700")}>{searchStatus}</span>
        )}
        {results.length > 0 && (
          <span className="ml-auto">
            {results.length} authorities · IK relevance ranked · {tally.green}G {tally.amber}A{" "}
            {tally.red}R {tally.grey}Gy · flags vs {activeMatter.filing || activeMatter.title}
          </span>
        )}
      </div>

      {networkDown && results.length === 0 && !searching && (
        <Alert className="border-amber-300 bg-amber-50">
          <WifiOff className="size-4 text-amber-700" />
          <AlertDescription className="text-[13px] font-bold text-amber-900">
            Network unavailable and this query was never cached — previously searched queries still
            work offline.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4">
        {searching && Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        {!searching &&
          results.map((j) => {
            const pulsing = pulseDocId === j.docid;
            const pinned = pins.some((p) => p.docid === j.docid);
            return (
              <div key={j.docid} ref={pulsing ? pulseRef : undefined}>
                <Card
                  onClick={() => setSelected(j)}
                  className={cn(
                    "h-full cursor-pointer gap-3 py-4 transition-all duration-300 hover:shadow-md",
                    j.flag.color === "red" && "border-red-300",
                    j.flag.color === "amber" && "border-amber-300",
                    pinned && "ring-1 ring-primary/40",
                    pulsing && "card-pulse border-amber-500"
                  )}
                >
                  <CardContent className="flex h-full flex-col gap-2 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm leading-snug font-semibold">
                          <span className="mr-1.5 text-muted-foreground">#{j.rank}</span>
                          {j.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {j.court} · {j.date || "date n/a"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant={pinned ? "default" : "ghost"}
                                aria-label={pinned ? "Unpin authority" : "Pin authority for drafting"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void togglePin(j);
                                }}
                              >
                                {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                              </Button>
                            }
                          />
                          <TooltipContent>
                            {pinned ? "Unpin" : "Pin for drafting — arguments are grounded only in pinned authorities"}
                          </TooltipContent>
                        </Tooltip>
                        <a
                          href={j.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-muted-foreground transition-colors hover:text-primary"
                          aria-label="Open on Indian Kanoon"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                    </div>
                    {j.snippet && (
                      <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">{j.snippet}</p>
                    )}
                    <div className="mt-auto pt-1">
                      <ValidityBadge j={j} />
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
      </div>

      <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
        <span>
          {pins.length} pinned for drafting ·{" "}
          <a
            href="https://indiankanoon.org"
            target="_blank"
            rel="noreferrer"
            className="font-medium hover:text-primary hover:underline"
          >
            Powered by IKanoon
          </a>
        </span>
        {spend && (
          <span className="font-mono">
            API spend: {spend.searches} searches + {spend.docs} docs ≈ ₹{spend.rupees.toFixed(2)}
          </span>
        )}
      </div>

      <FlagSheet judgment={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
