"use client";

import { useQuery } from "@tanstack/react-query";
import { formatMinutes, Loading, PageHeader, Stat } from "@/components/app-ui";
import { useWorkspace } from "@/components/workspace";
import { rpcQuery } from "@/lib/rpc";

export default function UsagePage() {
  const { workspaceId } = useWorkspace();
  const { data: stats } = useQuery(rpcQuery("analytics.overview", { workspaceId, days: 30 }));

  if (!stats) return <Loading />;

  return (
    <>
      <PageHeader title="Usage" description="Talk time and model usage for this workspace over the last 30 days." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Minutes left" value={formatMinutes(stats.creditSeconds)} tone={stats.creditSeconds < 300 ? "warn" : undefined} />
        <Stat label="Used (30 days)" value={`${stats.totals.minutes} min`} sub={`${stats.totals.calls} calls`} />
        <Stat label="LLM tokens (30 days)" value={(stats.usage.inputTokens + stats.usage.outputTokens).toLocaleString()} />
        <Stat label="TTS characters (30 days)" value={stats.usage.ttsCharacters.toLocaleString()} />
      </div>
    </>
  );
}
