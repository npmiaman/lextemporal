"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLexStore } from "@/lib/store";
import {
  ArrowLeftRight,
  BookOpenText,
  CalendarCheck2,
  ExternalLink,
  Gavel,
  Loader2,
  Quote,
  SearchCode,
} from "lucide-react";

export interface ProvenanceTarget {
  side: "ours" | "opposing";
  argId: string;
  sentence: string;
  tag: string;
  para: number;
  mappingDeps: string[];
  confidence: number;
}

interface ProvenancePayload {
  source: { tag: string; docid: string; title: string; court: string; date: string; url: string; flagColor: string };
  para: number;
  paragraph: string | null;
  totalParas: number;
}

function Step({
  icon: Icon,
  label,
  children,
  last = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="relative pl-9">
      {!last && <span className="absolute top-7 bottom-[-8px] left-[13px] w-px bg-border" />}
      <span className="absolute top-0.5 left-0 grid size-7 place-content-center rounded-full border bg-card">
        <Icon className="size-3.5 text-primary" />
      </span>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 pb-5 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function MatterDatesLine() {
  const { matters, activeMatterId } = useLexStore();
  const m = matters.find((x) => x.id === activeMatterId);
  if (!m) return <span>—</span>;
  return (
    <span>
      {m.cause_date && <>Cause {m.cause_date} · </>}suit {m.suit_date} · trial ongoing — checked
      against each commencement above by the validity engine.
    </span>
  );
}

export function ProvenanceSheet({
  target,
  onClose,
}: {
  target: ProvenanceTarget | null;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<ProvenancePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mappings = useLexStore((s) => s.mappings);

  useEffect(() => {
    setPayload(null);
    setError(null);
    if (!target) return;
    fetch(
      `/api/provenance?matterId=${useLexStore.getState().activeMatterId}&side=${target.side}&tag=${target.tag}&para=${target.para}`
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        setPayload(d);
      })
      .catch((e) => setError(String(e)));
  }, [target]);

  const deps = target ? mappings.filter((m) => target.mappingDeps.includes(m.id)) : [];

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-[560px]!">
        {target && (
          <>
            <SheetHeader>
              <SheetTitle className="text-base">Provenance — sentence to source</SheetTitle>
              <SheetDescription>
                Argument {target.argId} · citation [{target.tag}¶{target.para}]
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4">
              <div className="pb-6">
                <blockquote className="mb-6 rounded-md border-l-4 border-primary bg-primary/5 p-3 text-sm leading-relaxed">
                  “{target.sentence}”
                </blockquote>

                {error && (
                  <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                    Could not resolve provenance: {error}
                  </p>
                )}
                {!payload && !error && (
                  <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Resolving cited paragraph from cached
                    judgment…
                  </p>
                )}

                {payload && (
                  <>
                    <Step icon={Gavel} label="Source judgment">
                      {payload.source.title}
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {payload.source.court} · {payload.source.date || "date n/a"} · validity flag:{" "}
                        {payload.source.flagColor}
                      </span>
                      <a
                        href={payload.source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3" /> Indian Kanoon
                      </a>
                    </Step>

                    <Step icon={Quote} label={`Quoted paragraph ¶${payload.para} of ${payload.totalParas}`}>
                      {payload.paragraph ? (
                        <span className="italic">
                          “{payload.paragraph.length > 900 ? payload.paragraph.slice(0, 900) + "…" : payload.paragraph}”
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Paragraph {payload.para} is out of range for this document — the citation could
                          not be verified. Treat this sentence with caution.
                        </span>
                      )}
                    </Step>
                  </>
                )}

                <Step icon={BookOpenText} label="Statute mappings this argument depends on">
                  {deps.length === 0 && <span className="text-muted-foreground">none declared</span>}
                  {deps.map((m) => (
                    <p key={m.id} className="mb-1 font-mono text-[12px] leading-relaxed">
                      <span className="font-bold">{m.id}</span> · {m.act_old} {m.provision_old} →{" "}
                      {m.act_new} {m.provision_new}
                    </p>
                  ))}
                </Step>

                <Step icon={ArrowLeftRight} label="Change & commencement">
                  {deps.map((m) => (
                    <p key={m.id} className="mb-1 text-[13px]">
                      {m.change_type} · w.e.f. {m.commencement} · {m.note}
                    </p>
                  ))}
                  {deps.length === 0 && <span className="text-muted-foreground">—</span>}
                </Step>

                <Step icon={CalendarCheck2} label="Dates checked">
                  <MatterDatesLine />
                </Step>

                <Step icon={SearchCode} label="Confidence & retrieval" last>
                  <div className="mb-2 flex items-center gap-2">
                    <Progress value={target.confidence * 100} className="w-40" />
                    <Badge variant="outline">confidence {target.confidence.toFixed(2)}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Indian Kanoon relevance ranking (top-10). Powered by IKanoon.
                  </span>
                </Step>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
