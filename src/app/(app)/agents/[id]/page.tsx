"use client";

import { rpcQuery, useRpcMutation } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AgentForm, draftFromAgent } from "@/components/agent-form";
import { ErrorNote, errorText, formatDuration, Loading, PageHeader, StatusBadge, timeAgo } from "@/components/app-ui";
import { CallPanel } from "@/components/call-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/components/workspace";

export default function AgentPage() {
  const { id: agentId } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { workspaceId, canManage } = useWorkspace();
  const [saved, setSaved] = useState(false);

  const { data: agent, error } = useQuery(rpcQuery("agents.get", { agentId }));
  const { data: calls } = useQuery(rpcQuery("conversations.list", { workspaceId, agentId, limit: 10 }));

  const update = useRpcMutation("agents.update", {
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });
  const setStatus = useRpcMutation("agents.setStatus");
  const remove = useRpcMutation("agents.remove", {
    onSuccess: () => router.push("/agents"),
  });

  if (error) return <ErrorNote message={errorText(error)} />;
  if (!agent) return <Loading />;

  return (
    <>
      <PageHeader
        title={agent.name}
        description={`Updated ${timeAgo(agent.updatedAt)}`}
        actions={
          <>
            <StatusBadge status={agent.status} />
            {canManage && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setStatus.mutate({ agentId, status: agent.status === "paused" ? "live" : "paused" })}
                >
                  {agent.status === "paused" ? "Resume Agent" : "Pause Agent"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="icon" aria-label="Delete agent"><Trash2 /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The agent stops taking calls. Its call history, transcripts and captures are kept.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep Agent</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90"
                        onClick={() => remove.mutate({ agentId })}
                      >
                        Delete Agent
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </>
        }
      />

      <Tabs defaultValue={search.get("call") || !canManage ? "test" : "configure"}>
        <TabsList className="mb-4">
          <TabsTrigger value="test">Test Call</TabsTrigger>
          {canManage && <TabsTrigger value="configure">Configure</TabsTrigger>}
        </TabsList>

        <TabsContent value="test">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <CallPanel agent={agent} />
            <Card>
              <CardHeader><CardTitle className="text-sm">Recent Calls</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {calls?.map((c) => (
                    <li key={c.id}>
                      <Link href={`/conversations/${c.id}`} className="flex items-center justify-between py-2 hover:text-primary">
                        <span>{timeAgo(c.startedAt)}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{formatDuration(c.durationSec)}</span> <StatusBadge status={c.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                  {calls?.length === 0 && <li className="py-2 text-muted-foreground">No calls yet. Start a test call.</li>}
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {canManage && (
          <TabsContent value="configure">
            {saved && (
              <Alert className="mb-4 border-success/30 bg-success/10 text-success">
                <AlertDescription className="text-success">Agent saved. New calls use this configuration</AlertDescription>
              </Alert>
            )}
            <AgentForm
              key={agent.updatedAt}
              initial={draftFromAgent(agent)}
              submitLabel="Save Agent"
              busy={update.isPending}
              error={update.error ? errorText(update.error) : null}
              onSubmit={(draft) => update.mutate({ agentId, ...draft })}
            />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
