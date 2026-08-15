"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { jsonFetch, useLexStore } from "@/lib/store";
import { toast } from "sonner";
import { FileCheck2, Loader2 } from "lucide-react";

export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [signing, setSigning] = useState(false);
  const { results, drafts, pins, activeMatterId, loadAudit } = useLexStore();

  const flagged = results.filter((r) => r.flag.color === "red" || r.flag.color === "amber").length;
  const argCount = (drafts.ours?.args.length ?? 0) + (drafts.opposing?.args.length ?? 0);
  const summary = `${pins.length} pinned authorities · ${argCount} drafted arguments · ${flagged} flagged results on screen`;

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setAcknowledged(false);
  };

  const handleSign = async () => {
    setSigning(true);
    try {
      await jsonFetch("/api/export-signoff", { matterId: activeMatterId });
      toast.success("Brief exported · sign-off logged");
      void loadAudit();
      close(false);
    } catch (e) {
      toast.error(`Sign-off failed: ${String(e)}`);
    } finally {
      setSigning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="size-4 text-primary" />
            Export brief
          </DialogTitle>
          <DialogDescription>
            Human sign-off is required before anything leaves the system. The sign-off is written to
            the append-only audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 p-3 text-sm font-medium">{summary}</div>

        <Separator />

        <div className="flex items-start gap-2.5">
          <Checkbox
            id="export-ack"
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
            className="mt-0.5"
          />
          <Label htmlFor="export-ack" className="text-[13px] leading-snug font-normal">
            I have reviewed all flagged authorities and take responsibility for this filing
          </Label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={signing}>
            Cancel
          </Button>
          <Button disabled={!acknowledged || signing} onClick={() => void handleSign()}>
            {signing && <Loader2 className="size-4 animate-spin" />}
            Sign &amp; export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
