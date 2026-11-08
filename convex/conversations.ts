import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  requireAgentAccess,
  requireConversationAccess,
  requireMember,
} from "./lib/access";
import { callMetrics } from "./schema";
import { entitlementsFor, minuteRate, SMART_MODEL_ID } from "../src/lib/shared/plans";

const MIN_CREDIT_TO_START = 10;

/** The model a call actually runs on: the Smart model falls back to Fast when the plan lacks it. */
function agentModel(agent: Doc<"agents">, plan: ReturnType<typeof entitlementsFor>) {
  return agent.model === SMART_MODEL_ID && !plan.smartModel ? "" : agent.model;
}

/** Starts a browser call. Fails if the workspace has no talk time left. */
export const start = mutation({
  args: { agentId: v.id("agents"), recordingConsent: v.boolean() },
  handler: async (ctx, { agentId, recordingConsent }) => {
    const { agent, workspace } = await requireAgentAccess(ctx, agentId);
    if (agent.status === "paused") throw new ConvexError("This agent is paused");
    const plan = entitlementsFor(workspace);
    const rate = minuteRate(plan, agentModel(agent, plan));
    if (workspace.creditSeconds < MIN_CREDIT_TO_START * rate) {
      throw new ConvexError("Out of voice minutes. Pick a plan on the Usage page.");
    }
    const recording = recordingConsent && agent.behavior.recordCalls && plan.recording;
    const conversationId = await ctx.db.insert("conversations", {
      workspaceId: agent.workspaceId,
      agentId,
      agentName: agent.name,
      status: "active",
      startedAt: Date.now(),
      recordingConsent: recording,
      usage: { inputTokens: 0, outputTokens: 0, ttsCharacters: 0 },
    });
    return {
      conversationId,
      // A call can't outlast the remaining balance.
      maxCallSec: Math.min(agent.behavior.maxCallSec, Math.floor(workspace.creditSeconds / rate)),
      recording,
    };
  },
});

/** Everything the voice runtime needs for one agent turn. */
export const runtimeContext = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const { conversation } = await requireConversationAccess(ctx, conversationId);
    const stored = await ctx.db.get(conversation.agentId);
    if (!stored) throw new ConvexError("Agent was deleted");
    const workspace = await ctx.db.get(conversation.workspaceId);
    const plan = entitlementsFor(workspace ?? {});
    // Features the plan no longer includes (after a downgrade) are switched off
    // for the call; the agent's saved settings are kept.
    const agent = {
      ...stored,
      model: agentModel(stored, plan),
      customTools: plan.customTools ? stored.customTools : [],
    };
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .take(40);
    return { conversation, agent, history: messages.reverse() };
  },
});

async function activeConversation(ctx: MutationCtx, id: Id<"conversations">) {
  const { conversation } = await requireConversationAccess(ctx, id);
  if (conversation.status !== "active") throw new ConvexError("Call already ended");
  return conversation;
}

export const addMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("tool")),
    text: v.string(),
    interrupted: v.optional(v.boolean()),
    toolName: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, ...msg }) => {
    await activeConversation(ctx, conversationId);
    if (!msg.text.trim()) return null;
    return ctx.db.insert("messages", {
      conversationId,
      ...msg,
      text: msg.text.slice(0, 8000),
      at: Date.now(),
    });
  },
});

export const recordUsage = mutation({
  args: {
    conversationId: v.id("conversations"),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    ttsCharacters: v.optional(v.number()),
  },
  handler: async (ctx, { conversationId, ...delta }) => {
    const conversation = await activeConversation(ctx, conversationId);
    const u = conversation.usage;
    await ctx.db.patch(conversationId, {
      usage: {
        inputTokens: u.inputTokens + Math.max(0, delta.inputTokens ?? 0),
        outputTokens: u.outputTokens + Math.max(0, delta.outputTokens ?? 0),
        ttsCharacters: u.ttsCharacters + Math.max(0, delta.ttsCharacters ?? 0),
      },
    });
  },
});

export const addCapture = mutation({
  args: {
    conversationId: v.id("conversations"),
    kind: v.union(
      v.literal("lead"),
      v.literal("appointment"),
      v.literal("message"),
      v.literal("handoff"),
    ),
    data: v.record(v.string(), v.any()),
  },
  handler: async (ctx, { conversationId, kind, data }) => {
    const conversation = await activeConversation(ctx, conversationId);
    // One booking per call: a repeat call to book_appointment corrects it.
    if (kind === "appointment") {
      const existing = await ctx.db
        .query("captures")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
        .filter((q) => q.eq(q.field("kind"), "appointment"))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { data: { ...existing.data, ...data } });
        return existing._id;
      }
    }
    return ctx.db.insert("captures", {
      workspaceId: conversation.workspaceId,
      conversationId,
      agentId: conversation.agentId,
      kind,
      data,
    });
  },
});

async function settle(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  patch: Partial<Doc<"conversations">>,
) {
  const endedAt = Date.now();
  const durationSec = Math.max(1, Math.ceil((endedAt - conversation.startedAt) / 1000));
  await ctx.db.patch(conversation._id, { ...patch, endedAt, durationSec });
  const workspace = await ctx.db.get(conversation.workspaceId);
  if (workspace) {
    const agent = await ctx.db.get(conversation.agentId);
    const plan = entitlementsFor(workspace);
    const rate = agent ? minuteRate(plan, agentModel(agent, plan)) : 1;
    await ctx.db.patch(workspace._id, {
      creditSeconds: Math.max(0, workspace.creditSeconds - durationSec * rate),
    });
  }
  return durationSec;
}

/** Ends a call. Duration is measured on the server and deducted from credits. */
export const finish = mutation({
  args: {
    conversationId: v.id("conversations"),
    endReason: v.string(),
    metrics: callMetrics,
    failed: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, endReason, metrics, failed }) => {
    const { conversation } = await requireConversationAccess(ctx, conversationId);
    if (conversation.status !== "active") return conversation.durationSec ?? 0;
    return settle(ctx, conversation, {
      status: failed ? "failed" : "completed",
      endReason: endReason.slice(0, 200),
      failureReason: failed?.slice(0, 1000),
      metrics,
    });
  },
});

export const setSummary = mutation({
  args: {
    conversationId: v.id("conversations"),
    summary: v.string(),
    outcome: v.string(),
  },
  handler: async (ctx, { conversationId, summary, outcome }) => {
    await requireConversationAccess(ctx, conversationId);
    await ctx.db.patch(conversationId, {
      summary: summary.slice(0, 4000),
      outcome: outcome.slice(0, 60),
    });
  },
});

export const generateRecordingUploadUrl = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const { conversation } = await requireConversationAccess(ctx, conversationId);
    if (!conversation.recordingConsent) {
      throw new ConvexError("No recording consent for this call");
    }
    return ctx.storage.generateUploadUrl();
  },
});

export const attachRecording = mutation({
  args: { conversationId: v.id("conversations"), storageId: v.id("_storage") },
  handler: async (ctx, { conversationId, storageId }) => {
    const { conversation } = await requireConversationAccess(ctx, conversationId);
    if (!conversation.recordingConsent) {
      await ctx.storage.delete(storageId);
      throw new ConvexError("No recording consent for this call");
    }
    if (conversation.recordingId) await ctx.storage.delete(conversation.recordingId);
    await ctx.db.patch(conversationId, { recordingId: storageId });
  },
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, agentId, limit }) => {
    await requireMember(ctx, workspaceId);
    const n = Math.min(limit ?? 100, 500);
    if (agentId) {
      const rows = await ctx.db
        .query("conversations")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .order("desc")
        .take(n);
      return rows.filter((r) => r.workspaceId === workspaceId);
    }
    return ctx.db
      .query("conversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(n);
  },
});

export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const { conversation } = await requireConversationAccess(ctx, conversationId);
    const [messages, captures] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
        .collect(),
      ctx.db
        .query("captures")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
        .collect(),
    ]);
    const recordingUrl = conversation.recordingId
      ? await ctx.storage.getUrl(conversation.recordingId)
      : null;
    return { conversation, messages, captures, recordingUrl };
  },
});

/** Live transcript for an in-progress call (reactive). */
export const transcript = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    await requireConversationAccess(ctx, conversationId);
    return ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
  },
});

export const captures = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    return ctx.db
      .query("captures")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(200);
  },
});

/**
 * Closes calls whose browser tab vanished without calling `finish`
 * (closed tab, crash, lost network). Runs on a cron.
 */
export const reapStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 65 * 60 * 1000;
    const stale = await ctx.db
      .query("conversations")
      .filter((q) =>
        q.and(q.eq(q.field("status"), "active"), q.lt(q.field("startedAt"), cutoff)),
      )
      .take(100);
    for (const c of stale) {
      const agent = await ctx.db.get(c.agentId);
      // Bill at most the agent's max call length for abandoned calls.
      const capped = { ...c, startedAt: Date.now() - (agent?.behavior.maxCallSec ?? 900) * 1000 };
      await settle(ctx, capped, {
        status: "failed",
        endReason: "abandoned",
        failureReason: "Client disconnected without ending the call",
      });
    }
  },
});

/**
 * After a call: saves booking details the agent collected but never saved
 * (e.g. the caller hung up during the read-back), marked as a draft.
 */
export const addDraftAppointment = mutation({
  args: { conversationId: v.id("conversations"), data: v.record(v.string(), v.any()) },
  handler: async (ctx, { conversationId, data }) => {
    const { conversation } = await requireConversationAccess(ctx, conversationId);
    if (conversation.status === "active") throw new ConvexError("Call is still active");
    const existing = await ctx.db
      .query("captures")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .filter((q) => q.eq(q.field("kind"), "appointment"))
      .first();
    if (existing) return null;
    await ctx.db.insert("captures", {
      workspaceId: conversation.workspaceId,
      conversationId,
      agentId: conversation.agentId,
      kind: "appointment",
      data: { ...data, status: "draft", draftReason: "Call ended before the booking was saved" },
    });
    return null;
  },
});
