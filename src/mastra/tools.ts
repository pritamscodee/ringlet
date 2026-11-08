import "server-only";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { ConvexAs } from "@/lib/server/convex";
import { searchKnowledge } from "./knowledge";

type ToolDeps = {
  convex: ConvexAs;
  conversationId: Id<"conversations">;
  agent: Doc<"agents">;
};

/** Tool names whose results the browser acts on (hang up, hand off). */
export const CONTROL_TOOLS = new Set(["end_call", "transfer_to_human"]);

function builtinTools({ convex, conversationId, agent }: ToolDeps) {
  const capture = (kind: "lead" | "appointment" | "message" | "handoff", data: Record<string, unknown>) =>
    convex.mutation(api.conversations.addCapture, { conversationId, kind, data });

  return {
    capture_lead: createTool({
      id: "capture_lead",
      description:
        "Save a sales lead once you know who the prospect is and what they need. Call it once per prospect; call again only to correct details.",
      inputSchema: z.object({
        name: z.string().describe("Prospect full name"),
        company: z.string().optional(),
        role: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        need: z.string().describe("Problem or use case in one sentence"),
        budget: z.string().optional(),
        timeline: z.string().optional(),
        score: z.number().min(1).max(10).describe("Fit score from 1 (poor) to 10 (perfect)"),
        notes: z.string().optional(),
      }),
      execute: async (input) => {
        await capture("lead", input);
        return { saved: true };
      },
    }),

    book_appointment: createTool({
      id: "book_appointment",
      description:
        "Save a booking request as soon as you know the caller's name, the service and the requested time (and phone if they gave it). Call it in the same turn you read the details back; do not wait for a yes. If the caller corrects anything, call it again with the fixed details. Use their words for the time, for example 'Tuesday at 3pm'.",
      inputSchema: z.object({
        name: z.string(),
        phone: z.string().optional(),
        email: z.string().optional(),
        when: z.string().describe("Requested date and time"),
        service: z.string().describe("What the appointment is for"),
        partySize: z.number().optional(),
        notes: z.string().optional(),
      }),
      execute: async (input) => {
        await capture("appointment", { ...input, status: "requested" });
        return { saved: true, note: "Saved as a request. Tell the caller the team will confirm it." };
      },
    }),

    take_message: createTool({
      id: "take_message",
      description: "Leave a message, callback request or survey answers for the team.",
      inputSchema: z.object({
        from: z.string().optional().describe("Caller name"),
        phone: z.string().optional(),
        message: z.string(),
        urgent: z.boolean().optional(),
      }),
      execute: async (input) => {
        await capture("message", input);
        return { saved: true };
      },
    }),

    search_knowledge: createTool({
      id: "search_knowledge",
      description:
        "Search the business's knowledge sources (FAQs, hours, pricing, policies, listings) before answering factual questions.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const hits = searchKnowledge(agent.knowledge, query);
        if (!hits.length) return { results: [], note: "Nothing found. Do not guess; offer to take a message." };
        return { results: hits.map((h) => ({ source: h.title, text: h.text })) };
      },
    }),

    transfer_to_human: createTool({
      id: "transfer_to_human",
      description:
        "Hand the caller to a human when they ask for one, when it's urgent, or when you cannot help. Tell them you're transferring first.",
      inputSchema: z.object({
        reason: z.string(),
        summary: z.string().describe("What a human needs to know to take over"),
      }),
      execute: async (input) => {
        await capture("handoff", input);
        return { transferring: true };
      },
    }),

    end_call: createTool({
      id: "end_call",
      description: "Hang up after you said goodbye and the caller has nothing else.",
      inputSchema: z.object({ reason: z.string() }),
      execute: async ({ reason }) => ({ ending: true, reason }),
    }),
  };
}

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

function customTools(agent: Doc<"agents">) {
  const tools: Record<string, ReturnType<typeof createTool>> = {};
  for (const t of agent.customTools) {
    tools[t.name] = createTool({
      id: t.name,
      description: t.description,
      inputSchema: z.object({
        payload: z
          .record(z.string(), z.any())
          .describe("JSON fields to send, as described in the tool description"),
      }),
      execute: async ({ payload }) => {
        const url = new URL(t.url);
        if (url.protocol !== "https:" || PRIVATE_HOST.test(url.hostname)) {
          return { error: "Tool URL is not allowed" };
        }
        if (t.method === "GET") {
          for (const [k, v] of Object.entries(payload)) url.searchParams.set(k, String(v));
        }
        const res = await fetch(url, {
          method: t.method,
          headers: { "Content-Type": "application/json", "User-Agent": "Ringlet-Agent/1.0" },
          body: t.method === "POST" ? JSON.stringify(payload) : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        const text = (await res.text()).slice(0, 2000);
        return { status: res.status, body: text };
      },
    });
  }
  return tools;
}

export function toolsFor(deps: ToolDeps) {
  const builtin = builtinTools(deps);
  const enabled = Object.fromEntries(
    Object.entries(builtin).filter(([id]) => deps.agent.builtinTools.includes(id)),
  );
  return { ...enabled, ...customTools(deps.agent) };
}
