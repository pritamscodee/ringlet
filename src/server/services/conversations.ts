import "server-only";
import type { Capture, Conversation, Message } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { MIN_CREDIT_TO_START } from "@/lib/shared/limits";
import { requireAgentAccess, requireConversationAccess, requireMember } from "../access";
import { db } from "../db";
import { UserError } from "../errors";
import { downloadUrl, recordingKey, recordingsEnabled, uploadUrl } from "../recordings";
import type { AgentBehavior, CallMetrics, CaptureKind } from "../schemas";
import { toAgentDto } from "./agents";

// ---------------------------------------------------------------------------
// DTOs: what the app and the voice runtime see.
// ---------------------------------------------------------------------------

export function toConversationDto(c: Conversation) {
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    agentId: c.agentId,
    agentName: c.agentName,
    status: c.status,
    startedAt: c.startedAt.getTime(),
    endedAt: c.endedAt?.getTime() ?? null,
    durationSec: c.durationSec,
    endReason: c.endReason,
    failureReason: c.failureReason,
    summary: c.summary,
    outcome: c.outcome,
    recordingConsent: c.recordingConsent,
    metrics: (c.metrics as CallMetrics | null) ?? null,
    usage: { inputTokens: c.inputTokens, outputTokens: c.outputTokens, ttsCharacters: c.ttsCharacters },
  };
}
export type ConversationDto = ReturnType<typeof toConversationDto>;

function toMessageDto(m: Message) {
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    interrupted: m.interrupted,
    toolName: m.toolName,
    at: m.at.getTime(),
  };
}

function toCaptureDto(c: Capture) {
  return {
    id: c.id,
    conversationId: c.conversationId,
    agentId: c.agentId,
    kind: c.kind,
    data: c.data as Record<string, unknown>,
    createdAt: c.createdAt.getTime(),
  };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

// ---------------------------------------------------------------------------
// Call lifecycle
// ---------------------------------------------------------------------------

/** Starts a browser call. Fails if the workspace has no talk time left. */
export async function start(
  userId: string,
  { agentId, recordingConsent }: { agentId: string; recordingConsent: boolean },
) {
  const { agent, workspace } = await requireAgentAccess(userId, agentId);
  if (agent.status === "paused") throw new UserError("This agent is paused");
  if (workspace.creditSeconds < MIN_CREDIT_TO_START) {
    throw new UserError("Out of voice minutes. Ask a workspace admin to add more.", 402);
  }
  const behavior = agent.behavior as AgentBehavior;
  const recording = recordingConsent && behavior.recordCalls && recordingsEnabled();
  const conversation = await db.conversation.create({
    data: {
      workspaceId: agent.workspaceId,
      agentId,
      agentName: agent.name,
      recordingConsent: recording,
    },
  });
  return {
    conversationId: conversation.id,
    agent: toAgentDto(agent),
    // A call can't outlast the remaining balance.
    maxCallSec: Math.min(behavior.maxCallSec, workspace.creditSeconds),
    recording,
  };
}

/** Everything the voice runtime needs for one agent turn. */
export async function runtimeContext(userId: string, { conversationId }: { conversationId: string }) {
  const { conversation } = await requireConversationAccess(userId, conversationId);
  if (!conversation.agentId) throw new UserError("Agent was deleted");
  const [agent, messages] = await Promise.all([
    db.agent.findUnique({ where: { id: conversation.agentId } }),
    db.message.findMany({ where: { conversationId }, orderBy: { at: "desc" }, take: 40 }),
  ]);
  if (!agent) throw new UserError("Agent was deleted");
  return {
    conversation: toConversationDto(conversation),
    agent: toAgentDto(agent),
    history: messages.reverse().map(toMessageDto),
  };
}

async function activeConversation(userId: string, conversationId: string) {
  const { conversation } = await requireConversationAccess(userId, conversationId);
  if (conversation.status !== "active") throw new UserError("Call already ended", 409);
  return conversation;
}

export async function addMessage(
  userId: string,
  {
    conversationId,
    ...msg
  }: {
    conversationId: string;
    role: Message["role"];
    text: string;
    interrupted?: boolean;
    toolName?: string;
  },
) {
  await activeConversation(userId, conversationId);
  if (!msg.text.trim()) return null;
  const row = await db.message.create({
    data: { conversationId, ...msg, text: msg.text.slice(0, 8000) },
  });
  return row.id;
}

export async function recordUsage(
  userId: string,
  {
    conversationId,
    ...delta
  }: { conversationId: string; inputTokens?: number; outputTokens?: number; ttsCharacters?: number },
) {
  await activeConversation(userId, conversationId);
  // Atomic increments: turns can overlap when the caller barges in.
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      inputTokens: { increment: Math.max(0, Math.round(delta.inputTokens ?? 0)) },
      outputTokens: { increment: Math.max(0, Math.round(delta.outputTokens ?? 0)) },
      ttsCharacters: { increment: Math.max(0, Math.round(delta.ttsCharacters ?? 0)) },
    },
  });
}

export async function addCapture(
  userId: string,
  { conversationId, kind, data }: { conversationId: string; kind: CaptureKind; data: Record<string, unknown> },
) {
  const conversation = await activeConversation(userId, conversationId);
  // One booking per call: a repeat call to book_appointment corrects it.
  if (kind === "appointment") {
    const existing = await db.capture.findFirst({ where: { conversationId, kind: "appointment" } });
    if (existing) {
      await db.capture.update({
        where: { id: existing.id },
        data: { data: json({ ...(existing.data as object), ...data }) },
      });
      return existing.id;
    }
  }
  const row = await db.capture.create({
    data: {
      workspaceId: conversation.workspaceId,
      conversationId,
      agentId: conversation.agentId,
      kind,
      data: json(data),
    },
  });
  return row.id;
}

/**
 * Closes an active call and deducts its duration from the workspace balance,
 * in one transaction. The status check makes it idempotent: a call that
 * already ended is never billed twice.
 */
async function settle(
  conversation: Conversation,
  patch: { status: "completed" | "failed"; endReason: string; failureReason?: string; metrics?: CallMetrics },
  maxBillableSec = Infinity,
) {
  const endedAt = new Date();
  const elapsed = Math.ceil((endedAt.getTime() - conversation.startedAt.getTime()) / 1000);
  const durationSec = Math.max(1, Math.min(elapsed, maxBillableSec));
  return db.$transaction(async (tx) => {
    const closed = await tx.conversation.updateMany({
      where: { id: conversation.id, status: "active" },
      data: {
        status: patch.status,
        endReason: patch.endReason,
        failureReason: patch.failureReason,
        metrics: patch.metrics ? json(patch.metrics) : undefined,
        endedAt,
        durationSec,
      },
    });
    if (closed.count === 0) return null;
    await tx.$executeRaw`
      UPDATE "workspace"
      SET "creditSeconds" = GREATEST(0, "creditSeconds" - ${durationSec})
      WHERE "id" = ${conversation.workspaceId}`;
    return durationSec;
  });
}

/** Ends a call. Duration is measured on the server and deducted from the balance. */
export async function finish(
  userId: string,
  {
    conversationId,
    endReason,
    metrics,
    failed,
  }: { conversationId: string; endReason: string; metrics: CallMetrics; failed?: string },
) {
  const { conversation } = await requireConversationAccess(userId, conversationId);
  if (conversation.status !== "active") return conversation.durationSec ?? 0;
  const billed = await settle(conversation, {
    status: failed ? "failed" : "completed",
    endReason: endReason.slice(0, 200),
    failureReason: failed?.slice(0, 1000),
    metrics,
  });
  if (billed !== null) return billed;
  // Lost a race with another finish (or the reaper): report what was stored.
  const current = await db.conversation.findUnique({ where: { id: conversationId } });
  return current?.durationSec ?? 0;
}

/**
 * Closes calls whose browser tab vanished without calling `finish` (closed
 * tab, crash, lost network). Run lazily whenever a workspace's calls are read,
 * so no scheduler is needed. Abandoned calls are billed at most the agent's
 * max call length.
 */
export async function reapStale(workspaceId: string) {
  const cutoff = new Date(Date.now() - 65 * 60 * 1000);
  const stale = await db.conversation.findMany({
    where: { workspaceId, status: "active", startedAt: { lt: cutoff } },
    include: { agent: { select: { behavior: true } } },
    take: 100,
  });
  for (const { agent, ...c } of stale) {
    const maxCallSec = (agent?.behavior as AgentBehavior | undefined)?.maxCallSec ?? 900;
    await settle(
      c,
      { status: "failed", endReason: "abandoned", failureReason: "Client disconnected without ending the call" },
      maxCallSec,
    );
  }
}

export async function setSummary(
  userId: string,
  { conversationId, summary, outcome }: { conversationId: string; summary: string; outcome: string },
) {
  await requireConversationAccess(userId, conversationId);
  await db.conversation.update({
    where: { id: conversationId },
    data: { summary: summary.slice(0, 4000), outcome: outcome.slice(0, 60) },
  });
}

/**
 * After a call: saves booking details the agent collected but never saved
 * (e.g. the caller hung up during the read-back), marked as a draft.
 */
export async function addDraftAppointment(
  userId: string,
  { conversationId, data }: { conversationId: string; data: Record<string, unknown> },
) {
  const { conversation } = await requireConversationAccess(userId, conversationId);
  if (conversation.status === "active") throw new UserError("Call is still active");
  const existing = await db.capture.findFirst({ where: { conversationId, kind: "appointment" } });
  if (existing) return null;
  await db.capture.create({
    data: {
      workspaceId: conversation.workspaceId,
      conversationId,
      agentId: conversation.agentId,
      kind: "appointment",
      data: json({ ...data, status: "draft", draftReason: "Call ended before the booking was saved" }),
    },
  });
  return null;
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

export async function recordingUploadUrl(
  userId: string,
  { conversationId, contentType }: { conversationId: string; contentType: string },
) {
  const { conversation } = await requireConversationAccess(userId, conversationId);
  if (!conversation.recordingConsent || !recordingsEnabled()) {
    throw new UserError("No recording consent for this call");
  }
  return uploadUrl(recordingKey(conversation.workspaceId, conversationId), contentType);
}

export async function attachRecording(userId: string, { conversationId }: { conversationId: string }) {
  const { conversation } = await requireConversationAccess(userId, conversationId);
  if (!conversation.recordingConsent) throw new UserError("No recording consent for this call");
  await db.conversation.update({
    where: { id: conversationId },
    data: { recordingKey: recordingKey(conversation.workspaceId, conversationId) },
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(
  userId: string,
  { workspaceId, agentId, limit }: { workspaceId: string; agentId?: string; limit?: number },
) {
  await requireMember(userId, workspaceId);
  await reapStale(workspaceId);
  const rows = await db.conversation.findMany({
    where: { workspaceId, ...(agentId ? { agentId } : {}) },
    orderBy: { startedAt: "desc" },
    take: Math.min(limit ?? 100, 500),
  });
  return rows.map(toConversationDto);
}

export async function get(userId: string, { conversationId }: { conversationId: string }) {
  const { conversation } = await requireConversationAccess(userId, conversationId);
  const [messages, captures, recordingUrl] = await Promise.all([
    db.message.findMany({ where: { conversationId }, orderBy: { at: "asc" } }),
    db.capture.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } }),
    conversation.recordingKey ? downloadUrl(conversation.recordingKey) : null,
  ]);
  return {
    conversation: toConversationDto(conversation),
    messages: messages.map(toMessageDto),
    captures: captures.map(toCaptureDto),
    recordingUrl,
  };
}

export async function captures(userId: string, { workspaceId }: { workspaceId: string }) {
  await requireMember(userId, workspaceId);
  const rows = await db.capture.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(toCaptureDto);
}
