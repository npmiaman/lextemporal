"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RankedJudgment } from "@/lib/retrieval";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  OctagonAlert,
} from "lucide-react";

const FLAG_STYLES = {
  red: { border: "border-red-300", bg: "bg-red-50", text: "text-red-900", icon: OctagonAlert, iconColor: "text-red-700", label: "Superseded reliance" },
  amber: { border: "border-amber-300", bg: "bg-amber-50", text: "text-amber-900", icon: AlertTriangle, iconColor: "text-amber-700", label: "Caution" },
  grey: { border: "border-slate-300", bg: "bg-slate-100", text: "text-slate-700", icon: CircleHelp, iconColor: "text-slate-500", label: "No validity opinion" },
  green: { border: "border-green-300", bg: "bg-green-50", text: "text-green-900", icon: CheckCircle2, iconColor: "text-green-700", label: "Checked — clear" },
} as const;

export function FlagSheet({
  judgment,
  onClose,
}: {
  judgment: RankedJudgment | null;
  onClose: () => void;
}) {
  const [datesOpen, setDatesOpen] = useState(false);
  const s = judgment ? FLAG_STYLES[judgment.flag.color] : FLAG_STYLES.green;
  const Icon = s.icon;

  return (
    <Sheet
      open={judgment !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setDatesOpen(false);
        }
      }}
    >
      <SheetContent side="right" className="sm:max-w-[560px]!">
        {judgment && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8 text-base leading-snug">{judgment.title}</SheetTitle>
              <SheetDescription>
                {judgment.court} · {judgment.date || "date n/a"} · IK relevance rank #{judgment.rank}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4">
              <div className="space-y-5 pb-6">
                <Alert className={cn(s.border, s.bg, s.text)}>
                  <Icon className={cn("size-4", s.iconColor)} />
                  <AlertTitle className={s.text}>Temporal validity flag — {s.label}</AlertTitle>
                  <AlertDescription className={cn("text-[13px] font-bold leading-relaxed", s.text)}>
                    {judgment.flag.reason}
                  </AlertDescription>
                </Alert>

                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Provisions detected in the judgment text
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {judgment.flag.provisions.length === 0 && (
                      <span className="text-sm text-muted-foreground">none detected</span>
                    )}
                    {judgment.flag.provisions.map((p, i) => (
                      <Badge
                        key={i}
                        variant={p.mapped ? "secondary" : "outline"}
                        className={cn("font-mono text-[11px]", !p.mapped && "border-dashed text-muted-foreground")}
                      >
                        S.{p.section} · {p.act}
                        {!p.mapped && " · unmapped"}
                      </Badge>
                    ))}
                  </div>
                </div>

                {judgment.flag.mapping_ids.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Statute-graph mappings consulted
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {judgment.flag.mapping_ids.map((id) => (
                        <Badge key={id} className="font-mono text-[11px]">{id}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {judgment.flag.dates_checked.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <button
                        type="button"
                        onClick={() => setDatesOpen((o) => !o)}
                        className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-sm font-medium transition-all duration-300 hover:bg-muted"
                      >
                        Dates checked ({judgment.flag.dates_checked.length})
                        <ChevronDown className={cn("size-4 transition-transform duration-300", datesOpen && "rotate-180")} />
                      </button>
                      {datesOpen && (
                        <div className="mt-2 space-y-1.5">
                          {judgment.flag.dates_checked.map((d, i) => (
                            <div key={i} className="rounded-md border border-dashed bg-muted/40 p-2.5 font-mono text-xs leading-relaxed">
                              <span className="font-bold">{d.mapping_id}</span> · judgment {d.judgment || "?"} · commencement{" "}
                              {d.commencement} · governing {d.governing} · rule: {d.rule}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                <Separator />
                <a
                  href={judgment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  Read the full judgment on Indian Kanoon
                </a>
                <p className="text-xs text-muted-foreground">
                  Judgment text and metadata: Powered by IKanoon.
                </p>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
