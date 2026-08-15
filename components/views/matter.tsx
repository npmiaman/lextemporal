"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useLexStore } from "@/lib/store";
import type { Matter, MatterInput } from "@/lib/matter";
import { toast } from "sonner";
import { FilePlus2, FileText, Loader2, Save, Sparkles } from "lucide-react";

const EMPTY: MatterInput = {
  title: "",
  filing: "",
  agreement_date: "",
  cause_date: "",
  suit_date: "",
  relief: "",
  key_evidence: "",
  notes: "",
};

function MatterForm({
  initial,
  onSubmit,
  submitLabel,
  busy,
}: {
  initial: MatterInput;
  onSubmit: (m: MatterInput) => Promise<void>;
  submitLabel: string;
  busy: boolean;
}) {
  const [form, setForm] = useState<MatterInput>(initial);
  useEffect(() => setForm(initial), [initial]);
  const set = (k: keyof MatterInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(form);
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="m-title">Matter title *</Label>
          <Input id="m-title" value={form.title} onChange={set("title")} placeholder="M/s … v. …" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-filing">Filing number</Label>
          <Input id="m-filing" value={form.filing} onChange={set("filing")} placeholder="CS(COMM) …/20…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-relief">Relief claimed</Label>
          <Input id="m-relief" value={form.relief} onChange={set("relief")} placeholder="Specific performance …" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-agreement">Agreement date</Label>
          <Input id="m-agreement" type="date" value={form.agreement_date} onChange={set("agreement_date")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-cause">Breach / cause of action date</Label>
          <Input id="m-cause" type="date" value={form.cause_date} onChange={set("cause_date")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-suit">Suit filed date *</Label>
          <Input id="m-suit" type="date" value={form.suit_date} onChange={set("suit_date")} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-evidence">Key evidence</Label>
          <Input id="m-evidence" value={form.key_evidence} onChange={set("key_evidence")} placeholder="e.g. WhatsApp exchange (electronic record)" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="m-notes">Notes on record (mediation status, evidence gaps, …)</Label>
          <Textarea id="m-notes" value={form.notes} onChange={set("notes")} rows={3} className="text-sm" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {submitLabel}
        </Button>
        <p className="text-xs text-muted-foreground">
          The breach/suit dates govern every temporal-validity check for this matter.
        </p>
      </div>
    </form>
  );
}

export function MatterView() {
  const {
    matters,
    activeMatterId,
    createMatter,
    createSampleMatter,
    updateMatter,
  } = useLexStore();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const active: Matter | undefined = matters.find((m) => m.id === activeMatterId);

  const submitCreate = async (input: MatterInput) => {
    setBusy(true);
    try {
      const m = await createMatter(input);
      toast.success(`Matter created — ${m.title}`);
      setCreating(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitUpdate = async (input: MatterInput) => {
    if (!active) return;
    setBusy(true);
    try {
      await updateMatter(active.id, input);
      toast.success("Matter updated — validity checks now use the new dates");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const sample = async () => {
    setBusy(true);
    try {
      await createSampleMatter();
      toast.success("Sample matter loaded — try Research next");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (matters.length === 0 || creating) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FilePlus2 className="size-4 text-primary" />
              {matters.length === 0 ? "Create your first matter" : "New matter"}
            </CardTitle>
            <CardDescription>
              LexTemporal validates every authority against this matter&apos;s timeline — the
              dates below drive the green/amber/red/grey flags.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MatterForm initial={EMPTY} onSubmit={submitCreate} submitLabel="Create matter" busy={busy} />
            <Separator className="my-4" />
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => void sample()} disabled={busy}>
                <Sparkles className="size-4" />
                Load a sample matter instead
              </Button>
              {creating && (
                <Button variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!active) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="size-4 text-primary" />
            {active.title}
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            {active.filing || `Matter #${active.id}`}
            <Badge variant="secondary">suit {active.suit_date}</Badge>
            {active.cause_date && <Badge variant="secondary">cause {active.cause_date}</Badge>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MatterForm
            initial={{
              title: active.title,
              filing: active.filing,
              agreement_date: active.agreement_date,
              cause_date: active.cause_date,
              suit_date: active.suit_date,
              relief: active.relief,
              key_evidence: active.key_evidence,
              notes: active.notes,
            }}
            onSubmit={submitUpdate}
            submitLabel="Save changes"
            busy={busy}
          />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setCreating(true)}>
          <FilePlus2 className="size-4" />
          New matter
        </Button>
      </div>
    </div>
  );
}
