"use client";

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Empty, formatDuration, PageHeader, StatusBadge, timeAgo } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkspace } from "@/components/workspace";

export default function ConversationsPage() {
  const { workspaceId } = useWorkspace();
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState("");
  const { data: agents } = useQuery(convexQuery(api.agents.list, { workspaceId }));
  const { data: calls } = useQuery(
    convexQuery(api.conversations.list, {
      workspaceId,
      agentId: (agentId || undefined) as Id<"agents"> | undefined,
      limit: 200,
    }),
  );
  const rows = calls?.filter((c) => !status || c.status === status);

  return (
    <>
      <PageHeader title="Conversations" description="Every call, with transcript, summary and metrics." />
      <div className="mb-4 flex flex-wrap gap-2">
        <NativeSelect value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Filter by agent">
          <NativeSelectOption value="">All agents</NativeSelectOption>
          {agents?.map((a) => <NativeSelectOption key={a._id} value={a._id}>{a.name}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <NativeSelectOption value="">Any status</NativeSelectOption>
          <NativeSelectOption value="active">Live</NativeSelectOption>
          <NativeSelectOption value="completed">Completed</NativeSelectOption>
          <NativeSelectOption value="failed">Failed</NativeSelectOption>
        </NativeSelect>
      </div>
      {!rows ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <Empty icon={MessagesSquare} title="No conversations yet" body="Calls show up here as soon as they start. Open an agent and start a test call." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Started</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c._id}>
                  <TableCell className="pl-4">
                    <Link href={`/conversations/${c._id}`} className="hover:underline">{timeAgo(c.startedAt)}</Link>
                  </TableCell>
                  <TableCell>{c.agentName}</TableCell>
                  <TableCell className="max-w-md">
                    <Link href={`/conversations/${c._id}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
                      {c.outcome && <Badge variant="outline" className="shrink-0">{c.outcome.replace(/_/g, " ")}</Badge>}
                      <span className="truncate">
                        {c.summary ?? (c.status === "active" ? "In progress…" : c.failureReason ?? "—")}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">{formatDuration(c.durationSec)}</TableCell>
                  <TableCell className="pr-4"><StatusBadge status={c.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
