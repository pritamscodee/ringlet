"use client";

import { rpcQuery } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bot, Clock, PhoneCall, Plus, Timer, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Empty,
  formatDuration,
  formatMinutes,
  ms,
  PageHeader,
  Row,
  Stat,
  StatusBadge,
  timeAgo,
} from "@/components/app-ui";
import { DailyCallsChart } from "@/components/daily-calls-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkspace } from "@/components/workspace";

export default function DashboardPage() {
  const { workspaceId } = useWorkspace();
  const [days, setDays] = useState(30);
  const { data } = useQuery(rpcQuery("analytics.overview", { workspaceId, days }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="How your voice agents are performing."
        actions={
          <>
            <NativeSelect value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <NativeSelectOption value={7}>Last 7 days</NativeSelectOption>
              <NativeSelectOption value={30}>Last 30 days</NativeSelectOption>
              <NativeSelectOption value={90}>Last 90 days</NativeSelectOption>
            </NativeSelect>
            <Button asChild>
              <Link href="/agents/new"><Plus /> New Agent</Link>
            </Button>
          </>
        }
      />
      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : data.totals.calls === 0 && data.perAgent.length === 0 ? (
        <Empty
          icon={Bot}
          title="No agents yet"
          body="Pick a template like Sales SDR or AI Receptionist, then talk to it in your browser."
          action={<Button asChild><Link href="/agents/new">Create Agent</Link></Button>}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Total calls"
              icon={PhoneCall}
              value={data.totals.calls.toLocaleString()}
              sub={data.activeCalls ? `${data.activeCalls} live now` : `${data.totals.turns} turns`}
            />
            <Stat
              label="Talk time"
              icon={Clock}
              value={`${data.totals.minutes} min`}
              sub={`Avg ${formatDuration(data.totals.avgDurationSec)} per call`}
            />
            <Stat
              label="Success rate"
              icon={Activity}
              value={data.totals.successRate === null ? "—" : `${Math.round(data.totals.successRate * 100)}%`}
              tone={data.totals.successRate !== null && data.totals.successRate < 0.9 ? "warn" : undefined}
              sub={`${data.totals.failed} failed`}
            />
            <Stat
              label="Minutes left"
              icon={Timer}
              value={formatMinutes(data.creditSeconds)}
              sub={<Link className="text-primary hover:underline" href="/usage">Buy more</Link>}
            />
          </div>

          <DailyCallsChart series={data.series} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm"><Zap className="size-4 text-primary" /> Latency</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2">
                  <Row label="Speech recognition">{ms(data.latency.sttAvg)}</Row>
                  <Row label="LLM first token">{ms(data.latency.llmFirstTokenAvg)}</Row>
                  <Row label="TTS first byte">{ms(data.latency.ttsFirstByteAvg)}</Row>
                  <Row label="Voice-to-voice (avg)">{ms(data.latency.responseAvg)}</Row>
                  <Row label="Voice-to-voice (p95)">{ms(data.latency.responseP95)}</Row>
                </dl>
                <Separator className="my-3" />
                <dl><Row label="Interruptions handled">{data.totals.interruptions}</Row></dl>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-sm">Agents</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Calls</TableHead>
                      <TableHead>Minutes</TableHead>
                      <TableHead>Failed</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.perAgent.map((a) => (
                      <TableRow key={a.agentId}>
                        <TableCell><Link href={`/agents/${a.agentId}`} className="font-medium hover:underline">{a.name}</Link></TableCell>
                        <TableCell className="font-mono tabular-nums">{a.calls}</TableCell>
                        <TableCell className="font-mono tabular-nums">{a.minutes}</TableCell>
                        <TableCell className="font-mono tabular-nums">{a.failed}</TableCell>
                        <TableCell><StatusBadge status={a.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Recent Calls</CardTitle>
                <Button variant="link" size="sm" asChild><Link href="/conversations">View all</Link></Button>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {data.recent.map((c) => (
                    <li key={c.id}>
                      <Link href={`/conversations/${c.id}`} className="flex items-center justify-between gap-4 py-2.5 text-sm hover:text-primary">
                        <span className="truncate">
                          {c.agentName}
                          {c.outcome && <span className="text-muted-foreground"> · {c.outcome.replace(/_/g, " ")}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-mono">{formatDuration(c.durationSec)}</span>
                          <StatusBadge status={c.status} /> {timeAgo(c.startedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {!data.recent.length && <li className="py-3 text-sm text-muted-foreground">No calls in this period.</li>}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Usage</CardTitle></CardHeader>
              <CardContent>
                <dl className="space-y-2">
                  <Row label="STT minutes">{data.usage.sttMinutes}</Row>
                  <Row label="TTS characters">{data.usage.ttsCharacters.toLocaleString()}</Row>
                  <Row label="LLM input tokens">{data.usage.inputTokens.toLocaleString()}</Row>
                  <Row label="LLM output tokens">{data.usage.outputTokens.toLocaleString()}</Row>
                </dl>
                {data.failureReasons.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Top failure reasons</div>
                    <ul className="space-y-1 text-xs">
                      {data.failureReasons.map((f) => (
                        <li key={f.reason} className="flex justify-between gap-2">
                          <span className="truncate">{f.reason}</span>
                          <span className="font-mono tabular-nums">{f.count}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
