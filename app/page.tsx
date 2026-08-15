"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AutonomyDial } from "@/components/autonomy-dial";
import { ExportDialog } from "@/components/export-dialog";
import { MatterView } from "@/components/views/matter";
import { ResearchView } from "@/components/views/research";
import { ArgumentsView } from "@/components/views/arguments";
import { SimulationView } from "@/components/views/simulation";
import { AuditLogView } from "@/components/views/audit-log";
import { useLexStore, type View } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  CalendarCheck,
  FileDown,
  FlaskConical,
  FolderOpen,
  Landmark,
  MessagesSquare,
  ScrollText,
  Search,
} from "lucide-react";

const NAV: { view: View; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { view: "matter", label: "Matter", icon: FolderOpen },
  { view: "research", label: "Research", icon: Search },
  { view: "arguments", label: "Arguments", icon: MessagesSquare },
  { view: "simulation", label: "Simulation", icon: FlaskConical },
  { view: "audit-log", label: "Audit Log", icon: ScrollText },
];

export default function Home() {
  const {
    activeView,
    setView,
    matters,
    activeMatterId,
    setActiveMatter,
    lawDataCurrentAsOf,
    ephemeral,
    loadMatters,
    loadAudit,
  } = useLexStore();
  const [exportOpen, setExportOpen] = useState(false);
  const active = matters.find((m) => m.id === activeMatterId);

  useEffect(() => {
    void loadMatters();
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[220px] shrink-0 flex-col border-r bg-card">
          <div className="px-4 pt-5 pb-4">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-content-center rounded-md bg-primary text-primary-foreground">
                <Landmark className="size-4" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">LexTemporal</span>
            </div>
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              Temporal-validity legal research
            </p>
          </div>
          <Separator />
          <nav className="flex-1 space-y-1 p-3">
            {NAV.map(({ view, label, icon: Icon }) => (
              <button
                key={view}
                type="button"
                onClick={() => setView(view)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-300",
                  activeView === view
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
          <Separator />
          <div className="p-3">
            <AutonomyDial />
          </div>
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-5">
            {matters.length > 0 ? (
              <select
                value={activeMatterId ?? ""}
                onChange={(e) => setActiveMatter(Number(e.target.value))}
                className="h-8 max-w-[440px] min-w-0 truncate rounded-lg border border-border bg-card px-2 text-sm font-semibold"
                aria-label="Active matter"
              >
                {matters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                    {m.filing ? ` — ${m.filing}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <h1 className="text-sm font-semibold text-muted-foreground">No matter yet</h1>
            )}
            {ephemeral && (
              <Badge
                variant="outline"
                className="ml-auto shrink-0 border-amber-300 bg-amber-50 text-amber-800"
              >
                demo deployment — created state resets periodically
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn("shrink-0 gap-1.5 text-muted-foreground", !ephemeral && "ml-auto")}
            >
              <CalendarCheck className="size-3.5" />
              Law data current as of {lawDataCurrentAsOf || "…"}
            </Badge>
            <Button className="shrink-0" onClick={() => setExportOpen(true)} disabled={!active}>
              <FileDown className="size-4" />
              Export Brief
            </Button>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className={activeView === "matter" ? "block" : "hidden"}>
              <MatterView />
            </div>
            <div className={activeView === "research" ? "block" : "hidden"}>
              <ResearchView />
            </div>
            <div className={activeView === "arguments" ? "block" : "hidden"}>
              <ArgumentsView />
            </div>
            <div className={activeView === "simulation" ? "block" : "hidden"}>
              <SimulationView />
            </div>
            <div className={activeView === "audit-log" ? "block" : "hidden"}>
              <AuditLogView />
            </div>
          </main>
        </div>

        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      </div>
    </TooltipProvider>
  );
}
