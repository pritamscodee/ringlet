import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexAs, errorMessage } from "@/lib/server/convex";
import { summarizer } from "@/mastra";

const num = z.number().nonnegative().optional();
const Body = z.object({
  conversationId: z.string(),
  endReason: z.string().max(200),
  failed: z.string().max(1000).optional(),
  metrics: z.object({
    turns: z.number().int().nonnegative(),
    interruptions: z.number().int().nonnegative(),
    sttLatencyMs: num,
    llmFirstTokenMs: num,
    ttsFirstByteMs: num,
    responseLatencyMs: num,
  }),
});

/** Ends a call, bills its duration and writes the summary. */
export async function POST(req: Request) {
  const convex = await convexAs();
  if (!convex) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { conversationId: id, endReason, failed, metrics } = parsed.data;
  const conversationId = id as Id<"conversations">;

  try {
    const durationSec = await convex.mutation(api.conversations.finish, {
      conversationId,
      endReason,
      failed,
      metrics,
    });

    for (const [name, value] of Object.entries(metrics)) {
      if (name.endsWith("Ms") && typeof value === "number" && value > 0) {
        Sentry.metrics.distribution(`ringlet.call.${name}`, value, { unit: "millisecond" });
      }
    }
    if (failed) {
      Sentry.captureMessage("Voice call failed", {
        level: "warning",
        tags: { area: "voice.call" },
        extra: { conversationId, failed, endReason },
      });
    }

    const { messages, captures } = await convex.query(api.conversations.get, { conversationId });
    const savedKinds = new Set<string>(captures.map((c) => c.kind));
    const spoken = messages.filter((m) => m.role !== "tool");
    if (spoken.some((m) => m.role === "user")) {
      const transcript = messages
        .map((m) =>
          m.role === "tool"
            ? `[tool ${m.toolName}: ${m.text}]`
            : `${m.role === "user" ? "Caller" : "Agent"}: ${m.text}${m.interrupted ? " (interrupted)" : ""}`,
        )
        .join("\n");
      const result = await summarizer.generate(
        [
          {
            role: "user",
            content: `Records actually saved during the call: ${
              savedKinds.size ? [...savedKinds].join(", ") : "none"
            }.\n\nSummarize this call transcript:\n\n${transcript.slice(0, 30000)}`,
          },
        ],
        {
          structuredOutput: {
            schema: z.object({
              summary: z.string(),
              outcome: z.enum([
                "resolved",
                "lead_captured",
                "appointment_booked",
                "message_taken",
                "transferred",
                "not_interested",
                "no_answer",
                "other",
              ]),
              unsavedBooking: z
                .object({
                  name: z.string(),
                  phone: z.string().optional(),
                  when: z.string(),
                  service: z.string(),
                  notes: z.string().optional(),
                })
                .nullable()
                .describe(
                  "If the caller gave a name, service and time for an appointment but no appointment record was saved, those details. Otherwise null.",
                ),
            }),
          },
        },
      );
      if (result.object) {
        const { summary, unsavedBooking } = result.object;
        let outcome: string = result.object.outcome;
        let draftSaved = false;
        if (unsavedBooking && !savedKinds.has("appointment")) {
          await convex.mutation(api.conversations.addDraftAppointment, {
            conversationId,
            data: unsavedBooking,
          });
          draftSaved = true;
        }
        // Outcomes backed by a record only count if the record exists.
        const needs: Record<string, string> = {
          appointment_booked: "appointment",
          lead_captured: "lead",
          message_taken: "message",
          transferred: "handoff",
        };
        const required = needs[outcome];
        if (required && !savedKinds.has(required) && !(required === "appointment" && draftSaved)) {
          outcome = "other";
        }
        await convex.mutation(api.conversations.setSummary, {
          conversationId,
          summary: draftSaved
            ? `${summary} (Booking saved as a draft: the call ended before it was saved.)`
            : summary,
          outcome,
        });
      }
    } else {
      await convex.mutation(api.conversations.setSummary, {
        conversationId,
        summary: "The caller did not speak.",
        outcome: "no_answer",
      });
    }
    return Response.json({ durationSec });
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "voice.end" }, extra: { conversationId } });
    return Response.json({ error: errorMessage(e) }, { status: 500 });
  }
}
