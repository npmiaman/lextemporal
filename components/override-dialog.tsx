"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { jsonFetch, useLexStore } from "@/lib/store";
import type { StatuteMapping } from "@/lib/mappings";
import { toast } from "sonner";
import { Loader2, MoveRight } from "lucide-react";

// Pre-filled correction for the scripted M14 beat; other rows start blank.
const PREFILL: Record<string, string> = {
  M14: "S.63 BSA certificate requirement applies; certificate format differs from S.65B",
};

export function OverrideDialog({
  mapping,
  onClose,
}: {
  mapping: StatuteMapping | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { overrides, loadMappings, peekDrafts, loadAudit } = useLexStore();
  const current = mapping ? overrides.find((o) => o.mapping_id === mapping.id) : undefined;

  useEffect(() => {
    if (mapping) setNote(current?.note ?? PREFILL[mapping.id] ?? "");
  }, [mapping, current]);

  const handleSave = async () => {
    if (!mapping || !note.trim()) return;
    setSaving(true);
    try {
      const res = await jsonFetch<{ version: number; staleArgIds: string[] }>("/api/override", {
        mappingId: mapping.id,
        note: note.trim(),
      });
      const staleNote =
        res.staleArgIds.length > 0
          ? ` · ${res.staleArgIds.length} downstream argument${res.staleArgIds.length === 1 ? "" : "s"} marked stale (${res.staleArgIds.join(", ")})`
          : "";
      toast.success(`Override saved${staleNote} · logged`);
      await Promise.all([loadMappings(), loadAudit()]);
      void peekDrafts();
      onClose();
    } catch (e) {
      toast.error(`Override failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={mapping !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        {mapping && (
          <>
            <DialogHeader>
              <DialogTitle>Override mapping {mapping.id}</DialogTitle>
              <DialogDescription>
                Lawyer corrections take precedence over the system graph and cascade to dependent
                arguments.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Current mapping
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {mapping.act_old} {mapping.provision_old}
                  <MoveRight className="size-4 shrink-0 text-muted-foreground" />
                  {mapping.act_new} {mapping.provision_new}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mapping.change_type} · commencement {mapping.commencement} · {mapping.note}
                </p>
                <div className="mt-2 flex gap-2">
                  <Badge variant="secondary">system-mapped · v1</Badge>
                  {current && <Badge>lawyer-overridden · v{current.version}</Badge>}
                  <a
                    href={mapping.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto self-center text-xs text-primary underline-offset-4 hover:underline"
                  >
                    source
                  </a>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="override-note">Correction note</Label>
                <Textarea
                  id="override-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving || !note.trim()}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save override
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
