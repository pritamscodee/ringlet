"use client";

import { rpcQuery } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { Bot, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { Empty, PageHeader, StatusBadge, timeAgo } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace";
import { TEMPLATES, VOICES } from "@/lib/shared/templates";

export default function AgentsPage() {
  const { workspaceId, canManage } = useWorkspace();
  const { data: agents } = useQuery(rpcQuery("agents.list", { workspaceId }));

  return (
    <>
      <PageHeader
        title="Agents"
        description="Your voice agents for sales, front desk, scheduling and support."
        actions={canManage && <Button asChild><Link href="/agents/new"><Plus /> New Agent</Link></Button>}
      />
      {!agents ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : agents.length === 0 ? (
        <Empty
          icon={Bot}
          title="No agents yet"
          body="Start from a template: Sales SDR, AI Receptionist, Support, Scheduler and more."
          action={canManage && <Button asChild><Link href="/agents/new">Create Agent</Link></Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => {
            const template = TEMPLATES.find((t) => t.id === a.useCase);
            const voice = VOICES.find((v) => v.id === a.voice)?.label.split(" (")[0] ?? a.voice;
            return (
              <Card key={a.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div>
                    <CardTitle><Link href={`/agents/${a.id}`} className="hover:underline">{a.name}</Link></CardTitle>
                    <CardDescription>{template?.category ?? "Custom"} · {voice}</CardDescription>
                  </div>
                  <StatusBadge status={a.status} />
                </CardHeader>
                <CardContent className="flex-1">
                  <p className="line-clamp-2 text-sm text-muted-foreground">{a.instructions}</p>
                </CardContent>
                <CardFooter className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{a.callCount} calls · last {timeAgo(a.lastCallAt)}</span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/agents/${a.id}?call=1`}><Phone /> Test Call</Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
