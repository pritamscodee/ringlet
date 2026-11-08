"use client";

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../convex/_generated/api";
import { formatMinutes, Loading, PageHeader, Stat } from "@/components/app-ui";
import { RazorpayPlans } from "@/components/razorpay-plans";
import { useWorkspace } from "@/components/workspace";

export default function UsagePage() {
  const { workspaceId } = useWorkspace();
  const { data } = useQuery(convexQuery(api.billing.overview, { workspaceId }));
  const { data: stats } = useQuery(convexQuery(api.analytics.overview, { workspaceId, days: 30 }));

  if (!data) return <Loading />;

  return (
    <>
      <PageHeader title="Usage & Billing" description="Monthly plans in rupees, billed through Razorpay." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Minutes left" value={formatMinutes(data.creditSeconds)} tone={data.creditSeconds < 300 ? "warn" : undefined} />
        <Stat label="Used (30 days)" value={`${stats?.totals.minutes ?? 0} min`} sub={`${stats?.totals.calls ?? 0} calls`} />
        <Stat label="LLM tokens (30 days)" value={((stats?.usage.inputTokens ?? 0) + (stats?.usage.outputTokens ?? 0)).toLocaleString()} />
        <Stat label="TTS characters (30 days)" value={(stats?.usage.ttsCharacters ?? 0).toLocaleString()} />
      </div>

      <RazorpayPlans workspaceId={workspaceId} />
    </>
  );
}
