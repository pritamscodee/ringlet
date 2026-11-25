import "server-only";
import { requireMember } from "../access";
import { db } from "../db";
import { reapStale, toConversationDto } from "./conversations";

const DAY = 24 * 60 * 60 * 1000;

function avg(values: (number | undefined)[]) {
  const nums = values.filter((n): n is number => typeof n === "number" && n > 0);
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function p95(values: (number | undefined)[]) {
  const nums = values.filter((n): n is number => typeof n === "number" && n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  return nums[Math.min(nums.length - 1, Math.floor(nums.length * 0.95))];
}

/** Dashboard and usage numbers for the last `days` days. */
export async function overview(userId: string, { workspaceId, days }: { workspaceId: string; days?: number }) {
  await requireMember(userId, workspaceId);
  await reapStale(workspaceId);
  const span = Math.min(Math.max(days ?? 30, 1), 90);
  const since = Date.now() - span * DAY;

  const [workspace, rows, agents] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { creditSeconds: true } }),
    db.conversation.findMany({
      where: { workspaceId, startedAt: { gte: new Date(since) } },
      orderBy: { startedAt: "desc" },
      take: 5000,
    }),
    db.agent.findMany({ where: { workspaceId } }),
  ]);
  const calls = rows.map(toConversationDto);

  const completed = calls.filter((c) => c.status === "completed");
  const failed = calls.filter((c) => c.status === "failed");
  const finished = completed.length + failed.length;
  const totalSec = calls.reduce((n, c) => n + (c.durationSec ?? 0), 0);

  // One bucket per day, oldest first.
  const series = Array.from({ length: span }, (_, i) => {
    const start = new Date(since + i * DAY);
    start.setHours(0, 0, 0, 0);
    return { day: start.toISOString().slice(0, 10), calls: 0, failed: 0, minutes: 0 };
  });
  const byDay = new Map(series.map((s) => [s.day, s]));
  for (const c of calls) {
    const d = new Date(c.startedAt);
    d.setHours(0, 0, 0, 0);
    const bucket = byDay.get(d.toISOString().slice(0, 10));
    if (!bucket) continue;
    bucket.calls += 1;
    if (c.status === "failed") bucket.failed += 1;
    bucket.minutes += (c.durationSec ?? 0) / 60;
  }

  const perAgent = agents.map((a) => {
    const mine = calls.filter((c) => c.agentId === a.id);
    return {
      agentId: a.id,
      name: a.name,
      useCase: a.useCase,
      status: a.status,
      calls: mine.length,
      minutes: Math.round(mine.reduce((n, c) => n + (c.durationSec ?? 0), 0) / 60),
      failed: mine.filter((c) => c.status === "failed").length,
    };
  });

  const failureReasons = new Map<string, number>();
  for (const c of failed) {
    const key = (c.failureReason ?? "Unknown").slice(0, 80);
    failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
  }

  const m = calls.map((c) => c.metrics);
  return {
    days: span,
    creditSeconds: workspace.creditSeconds,
    activeCalls: calls.filter((c) => c.status === "active").length,
    totals: {
      calls: calls.length,
      completed: completed.length,
      failed: failed.length,
      successRate: finished ? completed.length / finished : null,
      minutes: Math.round(totalSec / 6) / 10,
      avgDurationSec: finished ? Math.round(totalSec / finished) : null,
      interruptions: m.reduce((n, x) => n + (x?.interruptions ?? 0), 0),
      turns: m.reduce((n, x) => n + (x?.turns ?? 0), 0),
    },
    latency: {
      sttAvg: avg(m.map((x) => x?.sttLatencyMs)),
      llmFirstTokenAvg: avg(m.map((x) => x?.llmFirstTokenMs)),
      ttsFirstByteAvg: avg(m.map((x) => x?.ttsFirstByteMs)),
      responseAvg: avg(m.map((x) => x?.responseLatencyMs)),
      responseP95: p95(m.map((x) => x?.responseLatencyMs)),
    },
    usage: {
      inputTokens: calls.reduce((n, c) => n + c.usage.inputTokens, 0),
      outputTokens: calls.reduce((n, c) => n + c.usage.outputTokens, 0),
      ttsCharacters: calls.reduce((n, c) => n + c.usage.ttsCharacters, 0),
      sttMinutes: Math.round(totalSec / 6) / 10,
    },
    series: series.map((s) => ({ ...s, minutes: Math.round(s.minutes * 10) / 10 })),
    perAgent: perAgent.sort((a, b) => b.calls - a.calls),
    failureReasons: [...failureReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    recent: calls.slice(0, 8),
  };
}
