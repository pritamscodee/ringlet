import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const agentBehavior = v.object({
  allowInterruptions: v.boolean(),
  // Deepgram endpointing: ms of trailing silence before a transcript is finalized.
  endpointingMs: v.number(),
  // Hang up after this many seconds with no user speech.
  silenceTimeoutSec: v.number(),
  maxCallSec: v.number(),
  temperature: v.number(),
  recordCalls: v.boolean(),
});

export const customTool = v.object({
  name: v.string(),
  description: v.string(),
  url: v.string(),
  method: v.union(v.literal("POST"), v.literal("GET")),
});

export const knowledgeDoc = v.object({
  title: v.string(),
  content: v.string(),
});

export const callMetrics = v.object({
  turns: v.number(),
  interruptions: v.number(),
  sttLatencyMs: v.optional(v.number()),
  llmFirstTokenMs: v.optional(v.number()),
  ttsFirstByteMs: v.optional(v.number()),
  responseLatencyMs: v.optional(v.number()),
});

export default defineSchema({
  ...authTables,

  workspaces: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    // Prepaid talk time, in seconds.
    creditSeconds: v.number(),
    // Set while a Razorpay subscription grants its plan's features (INR plans).
    subscriptionPlanId: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),

  memberships: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"]),

  agents: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    useCase: v.string(),
    personality: v.string(),
    instructions: v.string(),
    systemPrompt: v.string(),
    greeting: v.string(),
    voice: v.string(),
    language: v.string(),
    model: v.string(),
    behavior: agentBehavior,
    builtinTools: v.array(v.string()),
    customTools: v.array(customTool),
    knowledge: v.array(knowledgeDoc),
    status: v.union(v.literal("draft"), v.literal("live"), v.literal("paused")),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  conversations: defineTable({
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    agentName: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    endReason: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    summary: v.optional(v.string()),
    outcome: v.optional(v.string()),
    recordingConsent: v.boolean(),
    recordingId: v.optional(v.id("_storage")),
    metrics: v.optional(callMetrics),
    usage: v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      ttsCharacters: v.number(),
    }),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_agent", ["agentId"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("tool")),
    text: v.string(),
    interrupted: v.optional(v.boolean()),
    toolName: v.optional(v.string()),
    at: v.number(),
  }).index("by_conversation", ["conversationId"]),

  // Structured results captured by agent tools: leads, bookings, messages, handoffs.
  captures: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    agentId: v.id("agents"),
    kind: v.union(
      v.literal("lead"),
      v.literal("appointment"),
      v.literal("message"),
      v.literal("handoff"),
    ),
    data: v.record(v.string(), v.any()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_conversation", ["conversationId"]),

  // Razorpay (India) monthly subscriptions. One row per Razorpay subscription.
  subscriptions: defineTable({
    workspaceId: v.id("workspaces"),
    planId: v.string(),
    razorpaySubscriptionId: v.string(),
    // Razorpay statuses: created, authenticated, active, pending, halted,
    // cancelled, completed, expired, paused.
    status: v.string(),
    cancelAtCycleEnd: v.optional(v.boolean()),
    currentStart: v.optional(v.number()),
    currentEnd: v.optional(v.number()),
    shortUrl: v.optional(v.string()),
    lastError: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_razorpay_id", ["razorpaySubscriptionId"]),

  // Each successful charge, so a payment credits minutes exactly once.
  subscriptionPayments: defineTable({
    workspaceId: v.id("workspaces"),
    subscriptionId: v.id("subscriptions"),
    planId: v.string(),
    razorpayPaymentId: v.string(),
    razorpayInvoiceId: v.optional(v.string()),
    amountPaise: v.number(),
    creditSeconds: v.number(),
    method: v.optional(v.string()),
  })
    .index("by_payment", ["razorpayPaymentId"])
    .index("by_workspace", ["workspaceId"]),

  // Razorpay plan ids, created on first use for each of our plans and prices.
  razorpayPlans: defineTable({
    key: v.string(),
    razorpayPlanId: v.string(),
  }).index("by_key", ["key"]),

  webhookEvents: defineTable({
    provider: v.string(),
    eventId: v.string(),
    type: v.string(),
    linkedId: v.optional(v.string()),
    status: v.union(
      v.literal("processed"),
      v.literal("ignored"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
  }).index("by_event", ["provider", "eventId"]),
});
