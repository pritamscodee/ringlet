import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyRazorpayWebhook } from "./lib/razorpay";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Razorpay webhook endpoint (India subscriptions). In the Razorpay Dashboard →
 * Webhooks, add https://<your-deployment>.convex.site/webhooks/razorpay with the
 * subscription.* events, and set RAZORPAY_WEBHOOK_SECRET to the same secret.
 */
http.route({
  path: "/webhooks/razorpay",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return new Response("Webhook secret not configured", { status: 503 });
    const raw = await request.text();
    if (!(await verifyRazorpayWebhook(raw, request.headers.get("x-razorpay-signature"), secret))) {
      return new Response("Invalid signature", { status: 401 });
    }
    let event: { event?: unknown; created_at?: unknown; payload?: unknown };
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (typeof event.event !== "string" || !event.payload || typeof event.payload !== "object") {
      return new Response("Missing event", { status: 400 });
    }
    const payload = event.payload as { subscription?: { entity?: { id?: string } } };
    const eventId =
      request.headers.get("x-razorpay-event-id") ??
      `${event.event}:${payload.subscription?.entity?.id ?? ""}:${String(event.created_at ?? "")}`;
    try {
      await ctx.runAction(internal.razorpay.processEvent, {
        eventId,
        type: event.event,
        payload: event.payload,
      });
    } catch (e) {
      console.error("razorpay webhook failed", event.event, eventId, e);
      return new Response("Temporary failure", { status: 500 });
    }
    return new Response(null, { status: 200 });
  }),
});

export default http;
