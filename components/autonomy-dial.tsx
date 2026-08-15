"use client";

import { useLexStore, type Autonomy } from "@/lib/store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SlidersHorizontal } from "lucide-react";

const LEVELS: Autonomy[] = ["Ask every step", "Supervised", "Autonomous (gated)"];

export function AutonomyDial() {
  const autonomy = useLexStore((s) => s.autonomy);
  const setAutonomy = useLexStore((s) => s.setAutonomy);

  return (
    <div className="space-y-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <SlidersHorizontal className="size-3.5" />
              Autonomy
            </div>
          }
        />
        <TooltipContent side="top">
          Every change of level is written to the audit log via the API.
        </TooltipContent>
      </Tooltip>
      <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-1">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => void setAutonomy(level)}
            className={cn(
              "rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-all duration-300",
              autonomy === level
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {level}
          </button>
        ))}
      </div>
    </div>
  );
}
