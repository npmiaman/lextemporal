"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLexStore } from "@/lib/store";
import { toast } from "sonner";
import { AlertTriangle, FlaskConical, Loader2, Play, Search } from "lucide-react";

export function SimulationView() {
  const [n, setN] = useState(10);
  const {
    activeMatterId,
    drafts,
    simTally,
    simRunning,
    simTarget,
    runSimulation,
    searchWeakPoint,
    setView,
  } = useLexStore();

  if (!activeMatterId) {
    return (
      <Alert className="mx-auto max-w-2xl border-amber-300 bg-amber-50">
        <AlertTriangle className="size-4 text-amber-700" />
        <AlertDescription className="text-[13px] font-bold text-amber-900">
          Create or select a matter first.
        </AlertDescription>
      </Alert>
    );
  }

  const hasDrafts = (drafts.ours?.args.length ?? 0) > 0;
  const run = async () => {
    try {
      await runSimulation(n);
    } catch (e) {
      toast.error(`Simulation failed: ${String(e)}`);
    }
  };

  const tally = simTally;
  const favourablePct = tally && tally.runs > 0 ? (tally.favourable / tally.runs) * 100 : 0;
  const progressPct = simRunning && tally ? (tally.runs / simTarget) * 100 : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4 text-primary" />
            Adversarial simulation
          </CardTitle>
          <CardDescription>
            Each run is a real Gemini call: one hearing, a perturbed opposing angle × judge
            strictness, structured outcome. Unchanged matters re-serve from cache.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasDrafts && (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertTriangle className="size-4 text-amber-700" />
              <AlertDescription className="flex w-full items-center justify-between text-[13px] font-bold text-amber-900">
                Draft arguments first — the simulation argues your drafted case theory.
                <Button size="sm" variant="outline" onClick={() => setView("arguments")}>
                  Go to Arguments
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground" htmlFor="sim-n">
              Runs
            </label>
            <select
              id="sim-n"
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              disabled={simRunning}
              className="h-8 rounded-lg border border-border bg-card px-2 text-sm"
            >
              {[5, 10, 15, 20].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <Badge variant="outline">Opposing counsel: aggressive</Badge>
            <Badge variant="outline">Judge strictness: rotated low/med/high</Badge>
            <div className="ml-auto">
              <Button onClick={() => void run()} disabled={simRunning || !hasDrafts}>
                {simRunning ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {simRunning ? `Running ${tally?.runs ?? 0}/${simTarget}…` : "Run simulation"}
              </Button>
            </div>
          </div>

          {simRunning && (
            <div className="space-y-2 pt-1">
              <Progress value={progressPct} />
              <p className="text-sm text-muted-foreground">
                Run {(tally?.runs ?? 0) + 1}/{simTarget} —{" "}
                {tally?.runsDetail.at(-1)
                  ? `last: ${tally.runsDetail.at(-1)!.angle} (${tally.runsDetail.at(-1)!.outcome})`
                  : "opening the batch…"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {tally && tally.runs > 0 && !simRunning && (
        <>
          <Card>
            <CardContent className="space-y-4">
              <p className="text-2xl font-semibold tracking-tight">
                {tally.runs} runs ·{" "}
                <span className="text-green-700">{tally.favourable} favourable</span> ·{" "}
                <span className="text-red-700">{tally.adverse} adverse</span>
              </p>
              <div className="flex h-4 w-full overflow-hidden rounded-full">
                <div className="bg-green-600 transition-all duration-500" style={{ width: `${favourablePct}%` }} />
                <div className="bg-red-600 transition-all duration-500" style={{ width: `${100 - favourablePct}%` }} />
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-green-600" /> favourable ({tally.favourable})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-red-600" /> adverse ({tally.adverse})
                </span>
              </div>
            </CardContent>
          </Card>

          {tally.weakPoint && (
            <Card className="border-amber-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-amber-900">
                  <AlertTriangle className="size-4 text-amber-700" />
                  Recurring failure point ({tally.weakPointCount}/{tally.adverse} adverse runs)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[13px] font-bold leading-relaxed text-amber-900">
                  “{tally.weakPoint}” — most frequent decisive issue among adverse runs.
                </p>
                <Separator />
                {tally.weakPointQuery && (
                  <Button
                    variant="outline"
                    className="border-amber-400 text-amber-900 hover:bg-amber-50"
                    onClick={() => void searchWeakPoint(tally.weakPointQuery!)}
                  >
                    <Search className="size-4" />
                    Research this weak point
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Run transcripts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tally.runsDetail.map((r, i) => (
                <details key={i} className="rounded-md border bg-muted/30 p-2.5 text-sm">
                  <summary className="cursor-pointer font-medium">
                    <Badge variant={r.outcome === "favourable" ? "secondary" : "destructive"} className="mr-2">
                      {r.outcome}
                    </Badge>
                    {r.angle} · judge {r.strictness}
                  </summary>
                  <p className="mt-2 leading-relaxed text-muted-foreground">{r.transcript}</p>
                </details>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
