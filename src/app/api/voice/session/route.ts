import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { grantDeepgramToken } from "@/lib/server/deepgram";
import { issueTicket } from "@/lib/server/ticket";
import { currentUserId } from "@/server/auth";
import { errorMessage, errorStatus } from "@/server/errors";
import * as conversations from "@/server/services/conversations";

const Body = z.object({
  agentId: z.string().min(1).max(64),
  recordingConsent: z.boolean().default(false),
});

/** Starts a call: creates the conversation and returns everything the browser needs. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { agentId, recordingConsent } = parsed.data;

  let conversationId: string | undefined;
  try {
    const started = await conversations.start(userId, { agentId, recordingConsent });
    const { agent } = started;
    conversationId = started.conversationId;

    const [dg] = await Promise.all([
      grantDeepgramToken(60),
      conversations.addMessage(userId, { conversationId, role: "agent", text: agent.greeting }),
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
      await conversations
        .finish(userId, {
          conversationId,
          endReason: "setup_failed",
          failed: errorMessage(e),
          metrics: { turns: 0, interruptions: 0 },
        })
        .catch(() => {});
    }
    const status = errorStatus(e);
    return Response.json({ error: errorMessage(e) }, { status: status === 500 ? 400 : status });
  }
}
