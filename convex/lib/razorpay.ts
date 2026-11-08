/**
 * Minimal Razorpay REST client for Subscriptions (India, INR).
 *
 * Docs: https://razorpay.com/docs/api/payments/subscriptions/
 * - Auth: HTTP Basic with key id and key secret (rzp_test_… keys = test mode).
 * - Amounts are in paise.
 * - Checkout returns razorpay_payment_id, razorpay_subscription_id and
 *   razorpay_signature = HMAC_SHA256(payment_id + "|" + subscription_id, key_secret).
 * - Webhooks carry X-Razorpay-Signature = HMAC_SHA256(raw body, webhook secret)
 *   and X-Razorpay-Event-Id for de-duplication.
 *
 * Env vars, set on the Convex deployment (`bunx convex env set NAME value`):
 *   RAZORPAY_KEY_ID          required, rzp_test_… or rzp_live_…
 *   RAZORPAY_KEY_SECRET      required
 *   RAZORPAY_WEBHOOK_SECRET  required for webhooks (Dashboard → Webhooks)
 */

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

// Razorpay responses are untyped JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function razorpay<T = Record<string, any>>(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH"; json?: Record<string, unknown> } = {},
): Promise<T> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) {
    throw new RazorpayError(
      "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the Convex deployment.",
      0,
      null,
    );
  }
  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${keyId}:${secret}`)}`,
  };
  if (init.json) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`https://api.razorpay.com${path}`, {
      method: init.method ?? (init.json ? "POST" : "GET"),
      headers,
      body: init.json ? JSON.stringify(init.json) : undefined,
    });
  } catch (e) {
    throw new RazorpayError(`Razorpay request failed: ${String(e)}`, 0, null);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const desc =
      (body as { error?: { description?: string } } | null)?.error?.description ?? text;
    throw new RazorpayError(`Razorpay ${path} → ${res.status}: ${desc}`, res.status, body);
  }
  return body as T;
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies the signature Razorpay Checkout returns after a subscription payment. */
export async function verifySubscriptionPayment(
  paymentId: string,
  subscriptionId: string,
  signature: string,
  keySecret: string,
) {
  if (!paymentId || !subscriptionId || !signature) return false;
  return safeEqual(signature, await hmacHex(keySecret, `${paymentId}|${subscriptionId}`));
}

/** Verifies the X-Razorpay-Signature header of a webhook against the raw body. */
export async function verifyRazorpayWebhook(
  rawBody: string,
  signature: string | null,
  webhookSecret: string,
) {
  if (!signature) return false;
  return safeEqual(signature, await hmacHex(webhookSecret, rawBody));
}
