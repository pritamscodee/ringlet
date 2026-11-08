import * as Sentry from "@sentry/nextjs";
import { speak, TTS_SAMPLE_RATE } from "@/lib/server/deepgram";
import { readTicket } from "@/lib/server/ticket";

/**
 * Text to speech for one sentence. Streams raw PCM back so playback can start
 * on the first bytes. The browser aborts this request on barge-in.
 */
export async function POST(req: Request) {
  const ticket = readTicket(req.headers.get("x-ringlet-ticket"));
  if (!ticket) return Response.json({ error: "Invalid call ticket" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) return Response.json({ error: "Missing text" }, { status: 400 });
  if (text.length > 2000) return Response.json({ error: "Text too long" }, { status: 413 });

  const started = performance.now();
  try {
    const upstream = await speak(text, ticket.v, req.signal);
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text();
      Sentry.captureMessage("Deepgram TTS failed", {
        level: "error",
        tags: { area: "voice.tts" },
        extra: { status: upstream.status, detail, conversationId: ticket.c },
      });
      return Response.json({ error: "Speech synthesis failed" }, { status: 502 });
    }
    Sentry.metrics.distribution("ringlet.tts.upstream_headers", performance.now() - started, {
      unit: "millisecond",
      attributes: { voice: ticket.v },
    });
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Sample-Rate": String(TTS_SAMPLE_RATE),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    Sentry.captureException(e, { tags: { area: "voice.tts" } });
    return Response.json({ error: "Speech synthesis failed" }, { status: 502 });
  }
}
