import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireMember } from "./lib/access";
import { razorpayConfigured } from "./lib/razorpay";
import { entitlementsFor, getInrPlan, INR_PLANS, renewedBalance } from "../src/lib/shared/plans";

/** Razorpay statuses in which the plan's features apply. */
const GRANTING = new Set(["active", "pending"]);
/** Statuses that still bill the customer, so a second subscription is refused. */
const LIVE = new Set(["authenticated", "active", "pending", "paused"]);
/** Terminal statuses: the subscription can never charge again. */
const TERMINAL = new Set(["cancelled", "completed", "expired"]);

export const overview = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { workspace, membership } = await requireMember(ctx, workspaceId);
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .first();
    const payments = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(24);
    return {
      plans: INR_PLANS,
      subscription,
      payments,
      activePlanId: workspace.subscriptionPlanId ?? null,
      entitlements: entitlementsFor(workspace),
      canManage: membership.role !== "member",
      razorpayConfigured: razorpayConfigured(),
    };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers used by the Razorpay actions and webhook
// ---------------------------------------------------------------------------

export const current = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: (ctx, { workspaceId }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .first(),
});

export const byRazorpayId = internalQuery({
  args: { razorpaySubscriptionId: v.string() },
  handler: (ctx, { razorpaySubscriptionId }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_razorpay_id", (q) => q.eq("razorpaySubscriptionId", razorpaySubscriptionId))
      .unique(),
});

export const checkoutContext = internalQuery({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users") },
  handler: async (ctx, { workspaceId, userId }) => {
    const user = await ctx.db.get(userId);
    const workspace = await ctx.db.get(workspaceId);
    const live = await ctx.db
      .query("subscriptions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(10);
    return {
      email: user?.email ?? undefined,
      name: user?.name ?? undefined,
      workspaceName: workspace?.name ?? "",
      // Older subscriptions that may still need cancelling on Razorpay.
      open: live.filter((s) => !TERMINAL.has(s.status)),
    };
  },
});

export const getRazorpayPlan = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) =>
    (await ctx.db
      .query("razorpayPlans")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first())?.razorpayPlanId ?? null,
});

export const saveRazorpayPlan = internalMutation({
  args: { key: v.string(), razorpayPlanId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("razorpayPlans")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) return existing.razorpayPlanId;
    await ctx.db.insert("razorpayPlans", args);
    return args.razorpayPlanId;
  },
});

export const assertCanSubscribe = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(10);
    const live = rows.find((s) => LIVE.has(s.status) && !s.cancelAtCycleEnd);
    if (live) {
      throw new ConvexError(
        "This workspace already has an active plan. Cancel it first to switch plans.",
      );
    }
    return null;
  },
});

export const insert = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    planId: v.string(),
    razorpaySubscriptionId: v.string(),
    status: v.string(),
    shortUrl: v.optional(v.string()),
  },
  handler: (ctx, args) => ctx.db.insert("subscriptions", args),
});

/** Keeps the workspace's feature tier in line with its latest subscription. */
async function applyTier(ctx: MutationCtx, sub: Doc<"subscriptions">) {
  const latestGranting = (
    await ctx.db
      .query("subscriptions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", sub.workspaceId))
      .order("desc")
      .take(10)
  ).find((s) => GRANTING.has(s.status));
  const workspace = await ctx.db.get(sub.workspaceId);
  if (!workspace) return;
  const planId = latestGranting?.planId;
  if (workspace.subscriptionPlanId !== planId) {
    await ctx.db.patch(workspace._id, { subscriptionPlanId: planId });
  }
}

/** Mirrors a Razorpay subscription entity onto our row. */
export const sync = internalMutation({
  args: {
    razorpaySubscriptionId: v.string(),
    status: v.string(),
    currentStart: v.optional(v.number()),
    currentEnd: v.optional(v.number()),
    cancelAtCycleEnd: v.optional(v.boolean()),
    shortUrl: v.optional(v.string()),
  },
  handler: async (ctx, { razorpaySubscriptionId, status, ...rest }) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_razorpay_id", (q) => q.eq("razorpaySubscriptionId", razorpaySubscriptionId))
      .unique();
    if (!sub) return false;
    // Webhooks can arrive out of order: never move a subscription back to an
    // earlier setup state, and never revive a terminal one.
    const regress =
      TERMINAL.has(sub.status) ||
      ((status === "created" || status === "authenticated") && sub.status !== "created");
    const patch = Object.fromEntries(
      Object.entries({ ...rest, ...(regress ? {} : { status }) }).filter(
        ([, val]) => val !== undefined,
      ),
    );
    await ctx.db.patch(sub._id, { ...patch, lastError: undefined });
    await applyTier(ctx, { ...sub, ...patch });
    return true;
  },
});

export const setError = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), lastError: v.string() },
  handler: async (ctx, { subscriptionId, lastError }) => {
    await ctx.db.patch(subscriptionId, { lastError });
  },
});

/** Idempotent: credits a month of minutes exactly once per Razorpay payment. */
export const recordCharge = internalMutation({
  args: {
    razorpaySubscriptionId: v.string(),
    razorpayPaymentId: v.string(),
    razorpayInvoiceId: v.optional(v.string()),
    amountPaise: v.number(),
    method: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_payment", (q) => q.eq("razorpayPaymentId", args.razorpayPaymentId))
      .unique();
    if (seen) return false;
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_razorpay_id", (q) => q.eq("razorpaySubscriptionId", args.razorpaySubscriptionId))
      .unique();
    if (!sub) throw new Error(`No subscription ${args.razorpaySubscriptionId}`);
    const plan = getInrPlan(sub.planId);
    if (!plan) throw new Error(`Unknown plan ${sub.planId}`);
    const workspace = await ctx.db.get(sub.workspaceId);
    if (!workspace) return false;

    const balance = renewedBalance(workspace.creditSeconds, plan);
    await ctx.db.insert("subscriptionPayments", {
      workspaceId: sub.workspaceId,
      subscriptionId: sub._id,
      planId: plan.id,
      razorpayPaymentId: args.razorpayPaymentId,
      razorpayInvoiceId: args.razorpayInvoiceId,
      amountPaise: args.amountPaise,
      creditSeconds: balance - workspace.creditSeconds,
      method: args.method,
    });
    await ctx.db.patch(workspace._id, { creditSeconds: balance });
    // A successful charge means the subscription is active, even if the
    // "activated" webhook hasn't arrived yet.
    if (!TERMINAL.has(sub.status) && sub.status !== "active") {
      await ctx.db.patch(sub._id, { status: "active" });
    }
    await applyTier(ctx, { ...sub, status: TERMINAL.has(sub.status) ? sub.status : "active" });
    return true;
  },
});

export const webhookSeen = internalQuery({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event", (q) => q.eq("provider", "razorpay").eq("eventId", eventId))
      .unique();
    return row?.status === "processed" || row?.status === "ignored";
  },
});

export const recordWebhook = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    linkedId: v.optional(v.string()),
    status: v.union(v.literal("processed"), v.literal("ignored"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_event", (q) => q.eq("provider", "razorpay").eq("eventId", args.eventId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { status: args.status, error: args.error });
    } else {
      await ctx.db.insert("webhookEvents", { provider: "razorpay", ...args });
    }
  },
});
