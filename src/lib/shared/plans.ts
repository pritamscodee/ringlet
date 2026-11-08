/**
 * Plan definitions and entitlements, shared by the Convex backend and the
 * Next.js app. Billing is monthly INR subscriptions through Razorpay.
 */

/** New workspaces get a free trial allowance so they can test agents. */
export const TRIAL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// India: monthly subscriptions in INR, paid through Razorpay (cards, UPI
// Autopay, netbanking e-mandate).
//
// How the numbers were picked. One call minute costs roughly ₹3–3.5 with the
// Fast model (Deepgram STT ~₹0.65 + Aura-2 TTS ~₹1.1 + LLM ~₹1.5, more with long
// prompts and knowledge). Prices include 18% GST, and Razorpay keeps ~2.4%, so
// ₹599 nets about ₹493. That leaves room for ~100 minutes at Starter while
// keeping a healthy margin; higher tiers get more minutes and a lower per-minute
// price, and are differentiated by features that drive real value (recordings,
// webhooks to the customer's own systems, the Smart model).
//
// The Smart model costs about 3× the Fast one per minute, so on these plans a
// Smart-model call uses minutes at 2×. Change SMART_MODEL_RATE to tune that.
// ---------------------------------------------------------------------------

export type Entitlements = {
  /** null = unlimited */
  maxAgents: number | null;
  recording: boolean;
  customTools: boolean;
  smartModel: boolean;
  /** Minutes a Smart-model call uses per minute of talk time. */
  smartModelRate: number;
  /** Knowledge characters per agent. */
  knowledgeChars: number;
};

export type InrPlan = {
  id: string;
  name: string;
  /** Monthly price in rupees, GST included. */
  priceInr: number;
  minutes: number;
  blurb: string;
  features: string[];
  entitlements: Entitlements;
};

export const SMART_MODEL_ID = "anthropic/claude-sonnet-5-5";
const SMART_MODEL_RATE = 2;

export const INR_PLANS: InrPlan[] = [
  {
    id: "in_starter",
    name: "Starter",
    priceInr: 599,
    minutes: 100,
    blurb: "One receptionist or enquiry line for a small business.",
    features: [
      "100 voice minutes / month",
      "2 agents",
      "All agent templates & built-in tools",
      "Transcripts, summaries & captured leads",
      "Knowledge base up to 50,000 characters",
    ],
    entitlements: {
      maxAgents: 2,
      recording: false,
      customTools: false,
      smartModel: false,
      smartModelRate: SMART_MODEL_RATE,
      knowledgeChars: 50_000,
    },
  },
  {
    id: "in_growth",
    name: "Growth",
    priceInr: 799,
    minutes: 150,
    blurb: "A few agents handling sales and bookings every day.",
    features: [
      "150 voice minutes / month",
      "5 agents",
      "Call recordings",
      "Custom webhook tools (CRM, booking system)",
      "Knowledge base up to 100,000 characters",
    ],
    entitlements: {
      maxAgents: 5,
      recording: true,
      customTools: true,
      smartModel: false,
      smartModelRate: SMART_MODEL_RATE,
      knowledgeChars: 100_000,
    },
  },
  {
    id: "in_pro",
    name: "Pro",
    priceInr: 999,
    minutes: 200,
    blurb: "Busy lines that need the best reasoning on every call.",
    features: [
      "200 voice minutes / month",
      "Unlimited agents",
      "Smart model (uses minutes at 2×)",
      "Call recordings & custom webhook tools",
      "Knowledge base up to 200,000 characters",
      "Priority support",
    ],
    entitlements: {
      maxAgents: null,
      recording: true,
      customTools: true,
      smartModel: true,
      smartModelRate: SMART_MODEL_RATE,
      knowledgeChars: 200_000,
    },
  },
];

export function getInrPlan(id: string): InrPlan | undefined {
  return INR_PLANS.find((p) => p.id === id);
}

/**
 * Trial workspaces keep every feature at the normal rate. Only an active
 * Razorpay subscription applies its tier's limits.
 */
export const FULL_ENTITLEMENTS: Entitlements = {
  maxAgents: null,
  recording: true,
  customTools: true,
  smartModel: true,
  smartModelRate: 1,
  knowledgeChars: 200_000,
};

export function entitlementsFor(workspace: { subscriptionPlanId?: string | null }): Entitlements {
  const plan = workspace.subscriptionPlanId ? getInrPlan(workspace.subscriptionPlanId) : undefined;
  return plan?.entitlements ?? FULL_ENTITLEMENTS;
}

/** Minutes billed per minute of talk time for an agent's model. */
export function minuteRate(entitlements: Entitlements, model: string) {
  return model === SMART_MODEL_ID ? entitlements.smartModelRate : 1;
}

/**
 * Minutes credited when a subscription renews: unused minutes roll over, but
 * only up to one month's allowance, so the balance tops out at 2× the plan.
 */
export function renewedBalance(currentSeconds: number, plan: InrPlan) {
  const allowance = plan.minutes * 60;
  return Math.min(currentSeconds, allowance) + allowance;
}
