import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexAs, errorMessage } from "@/lib/server/convex";
import { readTicket } from "@/lib/server/ticket";
import { voiceAgentFor } from "@/mastra";
import { CONTROL_TOOLS } from "@/mastra/tools";

const Body = z.object({
  conversationId: z.string(),
  text: z.string().min(1).max(4000),
});

/** Events sent to the browser as newline-delimited JSON. */
export type RespondEvent =
  | { t: "delta"; text: string }
  | { t: "tool"; name: string }
  | { t: "action"; action: "end_call" | "transfer_to_human"; reason?: string }
  | { t: "done"; firstTokenMs: number | null }
  | { t: "error"; message: string };

/**
 * One agent turn: takes the caller's finalized utterance, runs the Mastra
 * agent and streams the reply text. If the caller barges in, the browser
 * aborts this request and the partial reply is saved as interrupted.
 */
export async function POST(req: Request) {
  const started = performance.now();
  const ticket = readTicket(req.headers.get("x-ringlet-ticket"));
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!ticket || ticket.c !== parsed.data.conversationId) {
    return Response.json({ error: "Invalid call ticket" }, { status: 401 });
  }
  const convex = await convexAs();
  if (!convex) return Response.json({ error: "Not signed in" }, { status: 401 });

  const conversationId = parsed.data.conversationId as Id<"conversations">;
  const userText = parsed.data.text.trim();

  let context;
  try {
    // Load context first, then save the new utterance, so it isn't duplicated.
    context = await convex.query(api.conversations.runtimeContext, { conversationId });
    if (context.conversation.status !== "active") {
      return Response.json({ error: "Call already ended" }, { status: 409 });
    }
    void convex
      .mutation(api.conversations.addMessage, { conversationId, role: "user", text: userText })
      .catch((e) => Sentry.captureException(e, { tags: { area: "voice.persist" } }));
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "voice.respond" } });
    return Response.json({ error: errorMessage(e) }, { status: 400 });
  }

  const { agent, history } = context;
  type Msg = { role: "user"; content: string } | { role: "assistant"; content: string };
  const messages: Msg[] = history
    .filter((m) => m.role !== "tool")
    .map((m): Msg =>
      m.role === "user"
        ? { role: "user", content: m.text }
        : {
            role: "assistant",
            content: m.interrupted ? `${m.text} [cut off: the caller interrupted]` : m.text,
          },
    );
  messages.push({ role: "user", content: userText });

  const voiceAgent = voiceAgentFor(agent, { convex, conversationId });
  const encoder = new TextEncoder();
  let reply = "";
  let firstTokenMs: number | null = null;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: RespondEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // stream already closed (client aborted)
        }
      };
      const span = Sentry.startInactiveSpan({
        name: "agent.turn",
        op: "ai.agent",
        attributes: { model: agent.model, agentId: agent._id },
      });
      try {
        const out = await voiceAgent.stream(messages, {
          abortSignal: req.signal,
          maxSteps: 4,
          modelSettings: { temperature: agent.behavior.temperature, maxOutputTokens: 300 },
        });
        for await (const chunk of out.fullStream) {
          if (chunk.type === "text-delta") {
            if (firstTokenMs === null) {
              firstTokenMs = Math.round(performance.now() - started);
              Sentry.metrics.distribution("ringlet.llm.first_token", firstTokenMs, {
                unit: "millisecond",
                attributes: { model: agent.model },
              });
            }
            reply += chunk.payload.text;
            send({ t: "delta", text: chunk.payload.text });
          } else if (chunk.type === "tool-call") {
            send({ t: "tool", name: chunk.payload.toolName });
          } else if (chunk.type === "tool-result") {
            const name = chunk.payload.toolName;
            void convex
              .mutation(api.conversations.addMessage, {
                conversationId,
                role: "tool",
                toolName: name,
                text: JSON.stringify(chunk.payload.args ?? {}).slice(0, 2000),
              })
              .catch(() => {});
            if (CONTROL_TOOLS.has(name) && !chunk.payload.isError) {
              const args = (chunk.payload.args ?? {}) as { reason?: string };
              send({
                t: "action",
                action: name as "end_call" | "transfer_to_human",
                reason: args.reason,
              });
            }
          } else if (chunk.type === "error") {
            throw (chunk.payload as { error?: unknown }).error ?? new Error("Model error");
          }
        }
        const usage = await out.usage.catch(() => null);
        if (usage) {
          void convex
            .mutation(api.conversations.recordUsage, {
              conversationId,
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              ttsCharacters: reply.length,
            })
            .catch(() => {});
        }
        send({ t: "done", firstTokenMs });
      } catch (e) {
        if (!req.signal.aborted) {
          Sentry.captureException(e, {
            tags: { area: "voice.agent" },
            extra: { conversationId, model: agent.model },
          });
          send({ t: "error", message: "The agent failed to respond" });
        }
      } finally {
        span.end();
        // Save what the agent said, even if the caller cut it off.
        if (reply.trim()) {
          await convex
            .mutation(api.conversations.addMessage, {
              conversationId,
              role: "agent",
              text: reply.trim(),
              interrupted: req.signal.aborted || undefined,
            })
            .catch(() => {});
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
