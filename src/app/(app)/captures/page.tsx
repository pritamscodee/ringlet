"use client";

import { rpcQuery } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { Download, Inbox } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Empty, PageHeader, timeAgo } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/workspace";

const KINDS = [
  { id: "all", label: "All" },
  { id: "lead", label: "Leads" },
  { id: "appointment", label: "Bookings" },
  { id: "message", label: "Messages" },
  { id: "handoff", label: "Handoffs" },
];

function toCsv(rows: { kind: string; createdAt: number; data: Record<string, unknown> }[]) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.data)))];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    ["kind", "created", ...keys].map(esc).join(","),
    ...rows.map((r) => [r.kind, new Date(r.createdAt).toISOString(), ...keys.map((k) => r.data[k])].map(esc).join(",")),
  ].join("\n");
}

export default function CapturesPage() {
  const { workspaceId } = useWorkspace();
  const [kind, setKind] = useState("all");
  const { data } = useQuery(rpcQuery("conversations.captures", { workspaceId }));
  const rows = data?.filter((r) => kind === "all" || r.kind === kind);

  return (
    <>
      <PageHeader
        title="Leads & Bookings"
        description="Everything your agents captured: qualified leads, appointment requests, messages and handoffs."
        actions={
          rows?.length ? (
            <Button
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
                const a = Object.assign(document.createElement("a"), { href: url, download: `ringlet-${kind}.csv` });
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download /> Export CSV
            </Button>
          ) : null
        }
      />
      <Tabs value={kind} onValueChange={setKind} className="mb-4">
        <TabsList>
          {KINDS.map((k) => <TabsTrigger key={k.id} value={k.id}>{k.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {!rows ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <Empty
          icon={Inbox}
          title="Nothing captured yet"
          body="Turn on tools like Capture lead or Book appointment for an agent, then make a call."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <Badge variant="outline" className="capitalize">{r.kind}</Badge>
                <Link href={`/conversations/${r.conversationId}`} className="text-xs text-primary hover:underline">
                  {timeAgo(r.createdAt)} · View call
                </Link>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-sm">
                  {Object.entries(r.data).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="break-words">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
