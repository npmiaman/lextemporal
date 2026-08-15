"use client";

import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useLexStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ScrollText } from "lucide-react";

function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AuditLogView() {
  const { auditRows, auditSeenMax, loadAudit, activeView } = useLexStore();

  useEffect(() => {
    if (activeView === "audit-log") void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  return (
    <div className="mx-auto max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4 text-primary" />
            Audit log
          </CardTitle>
          <CardDescription>
            Append-only record in SQLite — every retrieval, flag computation, draft, override,
            re-verification, simulation, autonomy change and sign-off. No delete path exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[185px]">Timestamp</TableHead>
                <TableHead className="w-[90px]">Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="w-[210px]">Object</TableHead>
                <TableHead className="w-[64px]">Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No audit entries yet.
                  </TableCell>
                </TableRow>
              )}
              {auditRows.map((r) => (
                <TableRow key={r.id} className={cn(auditSeenMax > 0 && r.id > auditSeenMax && "audit-fresh")}>
                  <TableCell className="py-2.5 font-mono text-xs">{fmtTs(r.ts)}</TableCell>
                  <TableCell className="py-2.5">
                    {r.actor === "lawyer" ? <Badge>lawyer</Badge> : <Badge variant="secondary">system</Badge>}
                  </TableCell>
                  <TableCell className="py-2.5 text-[13px] whitespace-normal">{r.action}</TableCell>
                  <TableCell className="py-2.5 text-xs whitespace-normal text-muted-foreground">
                    {r.object}
                  </TableCell>
                  <TableCell className="py-2.5 font-mono text-xs">{r.version}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
