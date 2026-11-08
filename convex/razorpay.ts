import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { razorpay, RazorpayError, verifySubscriptionPayment } from "./lib/razorpay";
import { getInrPlan, type InrPlan } from "../src/lib/shared/plans";

/** Charge for up to 10 years; Razorpay requires a finite cycle count. */
const TOTAL_CYCLES = 120;

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function customerError(e: unknown, context: string) {
  console.error(`razorpay: ${context} failed`, errorText(e));
  if (e instanceof RazorpayError && e.status === 0) {
    return "Payments are not available right now. Try again later.";
  }
  return "Our payment provider could not process this. Try again, or contact support if it keeps happening.";
}

async function requireManager(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Not signed in");
  const access = await ctx.runQuery(internal.billing.memberCanManage, { workspaceId, userId });
  if (!access.canManage) throw new ConvexError("Only owners and admins can manage billing");
  return userId;
}

/** Razorpay plan for one of our plans at its current price, created on first use. */
async function ensureRazorpayPlan(ctx: ActionCtx, plan: InrPlan): Promise<string> {
  const key = `${plan.id}:${plan.priceInr}`;
  const existing = await ctx.runQuery(internal.subscriptions.getRazorpayPlan, { key });
  if (existing) return existing;
  const created = await razorpay("/v1/plans", {
    json: {
      period: "monthly",
      interval: 1,
      item: {
        name: `Ringlet ${plan.name}`,
        amount: plan.priceInr * 100,
        currency: "INR",
        description: `${plan.minutes} voice agent minutes per month`,
      },
      notes: { plan_id: plan.id },
    },
  });
  return ctx.runMutation(internal.subscriptions.saveRazorpayPlan, {
    key,
    razorpayPlanId: created.id as string,
  });
}

type RzpSubscription = {
  id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  short_url?: string | null;
  notes?: Record<string, string> | null;
};

function syncArgs(s: RzpSubscription, cancelAtCycleEnd?: boolean) {
  return {
    razorpaySubscriptionId: s.id,
    status: s.status,
    currentStart: s.current_start ? s.current_start * 1000 : undefined,
    currentEnd: s.current_end ? s.current_end * 1000 : undefined,
    shortUrl: s.short_url ?? undefined,
    cancelAtCycleEnd,
  };
}

/** Credits a captured subscription payment (idempotent per payment id). */
async function applyPayment(
  ctx: ActionCtx,
  razorpaySubscriptionId: string,
  payment: { id: string; status?: string; amount?: number; invoice_id?: string | null; method?: string },
) {
  if (payment.status !== "captured") return false;
  return ctx.runMutation(internal.subscriptions.recordCharge, {
    razorpaySubscriptionId,
    razorpayPaymentId: payment.id,
    razorpayInvoiceId: payment.invoice_id ?? undefined,
    amountPaise: Number(payment.amount ?? 0),
    method: payment.method,
  });
}

/** Re-reads a subscription and its paid invoices from Razorpay. */
async function syncFromApi(ctx: ActionCtx, razorpaySubscriptionId: string) {
  const s = await razorpay<RzpSubscription>(`/v1/subscriptions/${razorpaySubscriptionId}`);
  await ctx.runMutation(internal.subscriptions.sync, syncArgs(s));
  const invoices = await razorpay<{ items: { status: string; payment_id?: string | null }[] }>(
    `/v1/invoices?subscription_id=${encodeURIComponent(razorpaySubscriptionId)}&count=12`,
  );
  for (const inv of invoices.items ?? []) {
    if (inv.status !== "paid" || !inv.payment_id) continue;
    const payment = await razorpay(`/v1/payments/${inv.payment_id}`);
    await applyPayment(ctx, razorpaySubscriptionId, payment as { id: string });
  }
  return s.status;
}

// ---------------------------------------------------------------------------
// Customer actions
// ---------------------------------------------------------------------------

/** Creates a Razorpay subscription and returns what Checkout needs to open. */
export const subscribe = action({
  args: { workspaceId: v.id("workspaces"), planId: v.string() },
  handler: async (
    ctx,
    { workspaceId, planId },
  ): Promise<{
    keyId: string;
    subscriptionId: string;
    planName: string;
    description: string;
    prefill: { email?: string; name?: string };
  }> => {
    const userId = await requireManager(ctx, workspaceId);
    const plan = getInrPlan(planId);
    if (!plan) throw new ConvexError("Unknown plan");
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId || !process.env.RAZORPAY_KEY_SECRET) {
      throw new ConvexError("Payments are not available right now. Try again later.");
    }
    await ctx.runQuery(internal.subscriptions.assertCanSubscribe, { workspaceId });
    const info = await ctx.runQuery(internal.subscriptions.checkoutContext, { workspaceId, userId });

    try {
      // Unpaid checkouts and halted subscriptions left behind would otherwise
      // charge later; close them before starting a new one.
      for (const old of info.open) {
        if (old.status === "created" || old.status === "halted") {
          const s = await razorpay<RzpSubscription>(
            `/v1/subscriptions/${old.razorpaySubscriptionId}/cancel`,
            { json: { cancel_at_cycle_end: 0 } },
          ).catch(() => null);
          if (s) await ctx.runMutation(internal.subscriptions.sync, syncArgs(s));
        }
      }

      const razorpayPlanId = await ensureRazorpayPlan(ctx, plan);
      const s = await razorpay<RzpSubscription>("/v1/subscriptions", {
        json: {
          plan_id: razorpayPlanId,
          total_count: TOTAL_CYCLES,
          quantity: 1,
          customer_notify: 1,
          notes: { workspace_id: workspaceId, plan_id: plan.id },
        },
      });
      await ctx.runMutation(internal.subscriptions.insert, {
        workspaceId,
        planId: plan.id,
        razorpaySubscriptionId: s.id,
        status: s.status,
        shortUrl: s.short_url ?? undefined,
      });
      return {
        keyId,
        subscriptionId: s.id,
        planName: plan.name,
        description: `${plan.name} · ₹${plan.priceInr}/month · ${plan.minutes} minutes`,
        prefill: { email: info.email, name: info.name },
      };
    } catch (e) {
      throw new ConvexError(customerError(e, "subscribe"));
    }
  },
});

/** Called by the page after Checkout succeeds; activates without waiting for the webhook. */
export const confirmCheckout = action({
  args: {
    workspaceId: v.id("workspaces"),
    paymentId: v.string(),
    subscriptionId: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, { workspaceId, paymentId, subscriptionId, signature }): Promise<string> => {
    await requireManager(ctx, workspaceId);
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new ConvexError("Payments are not available right now.");
    if (!(await verifySubscriptionPayment(paymentId, subscriptionId, signature, secret))) {
      throw new ConvexError("We couldn't verify this payment. If you were charged, it will be applied automatically.");
    }
    const row = await ctx.runQuery(internal.subscriptions.byRazorpayId, {
      razorpaySubscriptionId: subscriptionId,
    });
    if (!row || row.workspaceId !== workspaceId) throw new ConvexError("Subscription not found");
    try {
      const s = await razorpay<RzpSubscription>(`/v1/subscriptions/${subscriptionId}`);
      await ctx.runMutation(internal.subscriptions.sync, syncArgs(s));
      const payment = await razorpay(`/v1/payments/${paymentId}`);
      await applyPayment(ctx, subscriptionId, payment as { id: string });
      return s.status;
    } catch (e) {
      // The webhook will still deliver the charge; don't fail the checkout.
      console.error("razorpay: confirm failed", errorText(e));
      return row.status;
    }
  },
});

/** Cancels at the end of the paid month (immediately if nothing was paid yet). */
export const cancel = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<null> => {
    await requireManager(ctx, workspaceId);
    const sub = await ctx.runQuery(internal.subscriptions.current, { workspaceId });
    if (!sub || ["cancelled", "completed", "expired"].includes(sub.status)) {
      throw new ConvexError("There is no active plan to cancel");
    }
    const atCycleEnd = sub.status === "active" || sub.status === "pending";
    try {
      const s = await razorpay<RzpSubscription>(
        `/v1/subscriptions/${sub.razorpaySubscriptionId}/cancel`,
        { json: { cancel_at_cycle_end: atCycleEnd ? 1 : 0 } },
      );
      await ctx.runMutation(internal.subscriptions.sync, syncArgs(s, atCycleEnd));
    } catch (e) {
      throw new ConvexError(customerError(e, "cancel"));
    }
    return null;
  },
});

/** Manual "refresh" for when a webhook was missed. */
export const refresh = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<string | null> => {
    await requireManager(ctx, workspaceId);
    const sub = await ctx.runQuery(internal.subscriptions.current, { workspaceId });
    if (!sub) return null;
    try {
      return await syncFromApi(ctx, sub.razorpaySubscriptionId);
    } catch (e) {
      throw new ConvexError(customerError(e, "refresh"));
    }
  },
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const processEvent = internalAction({
  args: {
    eventId: v.string(),
    type: v.string(),
    // The signed `payload` object of the event.
    payload: v.any(),
  },
  handler: async (ctx, { eventId, type, payload }) => {
    if (await ctx.runQuery(internal.subscriptions.webhookSeen, { eventId })) return;
    const sub = payload?.subscription?.entity as RzpSubscription | undefined;
    const payment = payload?.payment?.entity as
      | { id: string; status?: string; amount?: number; invoice_id?: string; method?: string }
      | undefined;
    try {
      let handled = false;
      if (type.startsWith("subscription.") && sub?.id) {
        handled = await ctx.runMutation(internal.subscriptions.sync, syncArgs(sub));
        if (handled && type === "subscription.charged" && payment?.id) {
          await applyPayment(ctx, sub.id, payment);
        }
      }
      await ctx.runMutation(internal.subscriptions.recordWebhook, {
        eventId,
        type,
        linkedId: sub?.id,
        status: handled ? "processed" : "ignored",
      });
    } catch (e) {
      await ctx.runMutation(internal.subscriptions.recordWebhook, {
        eventId,
        type,
        linkedId: sub?.id,
        status: "error",
        error: errorText(e),
      });
      // Let Razorpay retry: every step above is idempotent.
      throw e;
    }
  },
});
