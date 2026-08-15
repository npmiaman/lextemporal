"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProvenanceSheet, type ProvenanceTarget } from "@/components/provenance-sheet";
import { OverrideDialog } from "@/components/override-dialog";
import { jsonFetch, useLexStore } from "@/lib/store";
import type { DraftedArgument } from "@/lib/drafting";
import type { StatuteMapping } from "@/lib/mappings";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  CircleSlash,
  Loader2,
  MoveRight,
  Pencil,
  PenLine,
  Pin,
  RefreshCw,
  Scale,
} from "lucide-react";

/** Split drafted text into sentence chunks keyed by their trailing [dN¶M] tags. */
function splitSentences(text: string): { sentence: string; tag: string | null; para: number | null }[] {
  const out: { sentence: string; tag: string | null; para: number | null }[] = [];
  const re = /\[(d\d+)¶(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const sentence = text.slice(last, m.index).trim();
    if (sentence) out.push({ sentence, tag: m[1], para: Number(m[2]) });
    last = re.lastIndex;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push({ sentence: rest, tag: null, para: null });
  return out;
}

function ArgumentCardView({
  arg,
  side,
  status,
  version,
  onSentence,
  onReverified,
}: {
  arg: DraftedArgument;
  side: "ours" | "opposing";
  status: string;
  version: number;
  onSentence: (t: ProvenanceTarget) => void;
  onReverified: () => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const matterId = useLexStore((s) => s.activeMatterId);
  const stale = status === "stale";
  const chunks = splitSentences(arg.text);

  const reverify = async () => {
    setVerifying(true);
    try {
      await jsonFetch("/api/reverify", { matterId, argId: arg.id });
      toast.success(`Argument ${arg.id} re-drafted against corrected mappings · logged`);
      onReverified();
    } catch (e) {
      toast.error(`Re-verify failed: ${String(e)}`);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card className={cn("gap-3 py-4 transition-all duration-[400ms]", stale && "opacity-50 grayscale")}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Badge className="shrink-0">{arg.id}</Badge>
          <span className="truncate">
            confidence {arg.confidence.toFixed(2)} · v{version}
          </span>
          <Badge variant="outline" className="ml-auto shrink-0">
            depends on {arg.mapping_deps.join(", ") || "—"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {stale && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="size-4 text-amber-700" />
            <AlertDescription className="flex w-full items-center justify-between gap-3 text-[13px] font-bold text-amber-900">
              Pending re-verification — depends on overridden mapping {arg.mapping_deps.join(", ")}
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
                disabled={verifying}
                onClick={() => void reverify()}
              >
                {verifying ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Re-drafting…
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" /> Re-verify
                  </>
                )}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm leading-7">
          {chunks.map((c, i) =>
            c.tag ? (
              <span key={i}>
                <span
                  onClick={() =>
                    onSentence({
                      side,
                      argId: arg.id,
                      sentence: c.sentence,
                      tag: c.tag!,
                      para: c.para!,
                      mappingDeps: arg.mapping_deps,
                      confidence: arg.confidence,
                    })
                  }
                  className="cursor-pointer border-b border-dotted border-slate-400 transition-all duration-300 hover:border-primary hover:bg-primary/5"
                >
                  {c.sentence}
                </span>
                <sup className="mx-0.5 font-mono text-[10px] text-primary">
                  [{c.tag}¶{c.para}]
                </sup>{" "}
              </span>
            ) : (
              <span key={i}>{c.sentence} </span>
            )
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export function ArgumentsView() {
  const [target, setTarget] = useState<ProvenanceTarget | null>(null);
  const [editingMapping, setEditingMapping] = useState<StatuteMapping | null>(null);
  const {
    activeMatterId,
    pins,
    drafts,
    loadingDrafts,
    peekDrafts,
    draftNow,
    mappings,
    overrides,
    argumentStatus,
    loadMappings,
    loadAudit,
    setView,
  } = useLexStore();

  useEffect(() => {
    if (activeMatterId) {
      void peekDrafts();
      if (mappings.length === 0) void loadMappings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatterId]);

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

  const statusOf = (id: string) => argumentStatus.find((a) => a.id === id);
  const hasDrafts = (drafts.ours?.args.length ?? 0) > 0;

  const draft = async (force: boolean) => {
    try {
      await draftNow(force);
      toast.success("Arguments drafted from your pinned authorities · logged");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const renderSide = (side: "ours" | "opposing") => {
    const d = drafts[side];
    if (!d || d.args.length === 0) {
      return (
        <div className="rounded-md border border-dashed bg-card p-6 text-sm text-muted-foreground">
          No arguments drafted yet for this side.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {d.args.map((arg) => {
          const st = statusOf(arg.id);
          return (
            <ArgumentCardView
              key={`${arg.id}-v${st?.version ?? arg.version}-${st?.status ?? arg.status}`}
              arg={arg}
              side={side}
              status={st?.status ?? arg.status}
              version={st?.version ?? arg.version}
              onSentence={setTarget}
              onReverified={() => {
                void peekDrafts();
                void loadMappings();
                void loadAudit();
              }}
            />
          );
        })}
        {d.abstentions.length > 0 && (
          <Card className="gap-2 border-dashed py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleSlash className="size-4" />
                Abstentions — points your pinned sources do not support
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {d.abstentions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                The model declines rather than invents — pin more authorities in Research to close
                these gaps.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto flex max-w-6xl gap-5">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center gap-3 rounded-md border bg-card px-4 py-3">
          <Pin className="size-4 shrink-0 text-primary" />
          <span className="text-sm">
            <span className="font-semibold">{pins.length}</span> pinned{" "}
            {pins.length === 1 ? "authority" : "authorities"} ground the draft
          </span>
          {pins.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => setView("research")}>
              Pin sources in Research
            </Button>
          )}
          <div className="ml-auto">
            <Button
              onClick={() => void draft(hasDrafts)}
              disabled={loadingDrafts || pins.length === 0}
            >
              {loadingDrafts ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Drafting via Gemini…
                </>
              ) : (
                <>
                  <PenLine className="size-4" />
                  {hasDrafts ? "Re-draft both sides" : "Draft arguments (both sides)"}
                </>
              )}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="ours">
          <TabsList>
            <TabsTrigger value="ours">Our case theory</TabsTrigger>
            <TabsTrigger value="opposing">Opposing side</TabsTrigger>
          </TabsList>
          <TabsContent value="ours">{renderSide("ours")}</TabsContent>
          <TabsContent value="opposing">{renderSide("opposing")}</TabsContent>
        </Tabs>
      </div>

      <div className="w-[500px] shrink-0">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Scale className="size-4 text-primary" />
              Statute mappings — verified graph ({mappings.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <ScrollArea className="h-[560px] pr-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provision mapping</TableHead>
                    <TableHead className="w-[96px]">Commencement</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-9" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m) => {
                    const o = overrides.find((x) => x.mapping_id === m.id);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="py-3 align-top whitespace-normal">
                          <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                            <span className="text-muted-foreground">{m.id}</span>
                            {m.act_old} {m.provision_old}
                            <MoveRight className="size-3.5 shrink-0 text-muted-foreground" />
                            {m.provision_new}
                          </div>
                          <p className="mt-1 text-xs leading-snug text-muted-foreground">
                            {m.change_type} · {m.note}
                          </p>
                          {o && (
                            <p className="mt-1 rounded bg-primary/5 p-1.5 text-xs leading-snug text-primary">
                              {o.note}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="py-3 align-top font-mono text-xs">
                          {m.commencement}
                        </TableCell>
                        <TableCell className="py-3 align-top whitespace-normal">
                          {o ? (
                            <Badge className="h-auto whitespace-normal text-center leading-tight">
                              lawyer-overridden · v{o.version}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">system-mapped</Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-3 pr-0 pl-0 align-top">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit mapping ${m.id}`}
                            onClick={() => setEditingMapping(m)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
            <p className="mt-3 text-xs text-muted-foreground">
              Overrides cascade: dependent arguments are marked stale until re-verified. Every
              change is logged.
            </p>
          </CardContent>
        </Card>
      </div>

      <ProvenanceSheet target={target} onClose={() => setTarget(null)} />
      <OverrideDialog mapping={editingMapping} onClose={() => setEditingMapping(null)} />
    </div>
  );
}
