import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexAs, errorMessage } from "@/lib/server/convex";
import { grantDeepgramToken } from "@/lib/server/deepgram";
import { issueTicket } from "@/lib/server/ticket";

const Body = z.object({
  agentId: z.string(),
  recordingConsent: z.boolean().default(false),
});

/** Starts a call: creates the conversation and returns everything the browser needs. */
export async function POST(req: Request) {
  const convex = await convexAs();
  if (!convex) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const agentId = parsed.data.agentId as Id<"agents">;

  let conversationId: Id<"conversations"> | undefined;
  try {
    const agent = await convex.query(api.agents.get, { agentId });
    const started = await convex.mutation(api.conversations.start, {
      agentId,
      recordingConsent: parsed.data.recordingConsent,
    });
    conversationId = started.conversationId;

    const [dg] = await Promise.all([
      grantDeepgramToken(60),
      convex.mutation(api.conversations.addMessage, {
        conversationId,
        role: "agent",
        text: agent.greeting,
      }),
    ]);

    return Response.json({
      conversationId,
      // Valid a little longer than the longest allowed call.
      ticket: issueTicket(conversationId, agent.voice, started.maxCallSec + 600),
      sttToken: dg.token,
      maxCallSec: started.maxCallSec,
      recording: started.recording,
      agent: {
        name: agent.name,
        greeting: agent.greeting,
        voice: agent.voice,
        language: agent.language,
        endpointingMs: agent.behavior.endpointingMs,
        silenceTimeoutSec: agent.behavior.silenceTimeoutSec,
        allowInterruptions: agent.behavior.allowInterruptions,
      },
    });
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "voice.session" }, extra: { agentId } });
    if (conversationId) {
      await convex
        .mutation(api.conversations.finish, {
          conversationId,
          endReason: "setup_failed",
          failed: errorMessage(e),
          metrics: { turns: 0, interruptions: 0 },
        })
        .catch(() => {});
    }
    return Response.json({ error: errorMessage(e) }, { status: 400 });
  }
}
