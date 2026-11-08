import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyRazorpayWebhook, verifySubscriptionPayment } from "../convex/lib/razorpay";
import { entitlementsFor, getInrPlan, minuteRate, renewedBalance, SMART_MODEL_ID } from "../src/lib/shared/plans";
import { SentenceChunker } from "../src/lib/voice/player";
import { searchKnowledge } from "../src/mastra/knowledge";

describe("sentence chunker", () => {
  test("emits the first clause early and later sentences whole", () => {
    const c = new SentenceChunker();
    const out: string[] = [];
    for (const piece of ["Sure thing, ", "I can help with that. ", "What day works ", "best for you? ", "Great"]) {
      out.push(...c.push(piece));
    }
    expect(out).toEqual(["Sure thing,", "I can help with that.", "What day works best for you?"]);
    expect(c.flush()).toBe("Great");
  });
});

describe("knowledge search", () => {
  test("ranks the relevant passage first", () => {
    const docs = [
      { title: "Hours", content: "We are open Monday to Friday, 9am to 6pm. Closed on weekends." },
      { title: "Pricing", content: "A standard cleaning costs 120 dollars. Whitening costs 300 dollars." },
    ];
    const hits = searchKnowledge(docs, "how much does whitening cost?");
    expect(hits[0].title).toBe("Pricing");
    expect(searchKnowledge(docs, "the and of")).toEqual([]);
  });
});

describe("razorpay signatures", () => {
  const hex = (secret: string, msg: string) => createHmac("sha256", secret).update(msg).digest("hex");

  test("verifies a checkout subscription signature", async () => {
    const sig = hex("key_secret", "pay_1|sub_1");
    expect(await verifySubscriptionPayment("pay_1", "sub_1", sig, "key_secret")).toBe(true);
    expect(await verifySubscriptionPayment("pay_2", "sub_1", sig, "key_secret")).toBe(false);
  });

  test("verifies a webhook body signature", async () => {
    const body = JSON.stringify({ event: "subscription.charged" });
    expect(await verifyRazorpayWebhook(body, hex("whs", body), "whs")).toBe(true);
    expect(await verifyRazorpayWebhook(body + " ", hex("whs", body), "whs")).toBe(false);
    expect(await verifyRazorpayWebhook(body, null, "whs")).toBe(false);
  });
});

describe("inr plans", () => {
  const starter = getInrPlan("in_starter")!;

  test("renewal rolls over at most one month of minutes", () => {
    expect(renewedBalance(0, starter)).toBe(100 * 60);
    expect(renewedBalance(30 * 60, starter)).toBe(130 * 60);
    expect(renewedBalance(500 * 60, starter)).toBe(200 * 60);
  });

  test("entitlements follow the subscription; others keep everything", () => {
    expect(entitlementsFor({ subscriptionPlanId: "in_starter" }).maxAgents).toBe(2);
    expect(entitlementsFor({}).customTools).toBe(true);
    const pro = entitlementsFor({ subscriptionPlanId: "in_pro" });
    expect(minuteRate(pro, SMART_MODEL_ID)).toBe(2);
    expect(minuteRate(entitlementsFor({}), SMART_MODEL_ID)).toBe(1);
  });
});
