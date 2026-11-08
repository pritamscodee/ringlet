# Ringlet

**Real-time AI voice agents your callers can interrupt.**

Build a receptionist, sales rep or support agent in minutes. Ringlet runs the
speech recognition, turn-taking and voice, so you don't build speech
infrastructure.

> **Live demo:** _not deployed yet_ — run it locally with
> [`docs/setup.md`](docs/setup.md), or read [How a call works](#how-a-call-works)
> below.

**Stack:** Next.js 16 · TypeScript · Tailwind v4 · shadcn/ui · TanStack Query ·
Convex (DB, auth, billing) · Mastra (agent) · Deepgram (Nova-3 STT, Aura-2 TTS) ·
Silero VAD · Razorpay · Sentry · SST · bun

---

## How a call works

```
mic (getUserMedia, echo-cancelled)
  → Silero VAD in the browser (speech start/end, barge-in)
  → Deepgram Nova-3 streaming STT (browser websocket, 60s token from /api/voice/session)
  → /api/voice/respond: Mastra agent with tools, streamed as NDJSON
  → /api/voice/tts per sentence: Deepgram Aura-2, streamed 24 kHz PCM
  → gapless Web Audio playback
```

Everything is streamed. The agent starts speaking on the first sentence rather
than waiting for a full reply, which is what keeps the pause after you stop
talking short enough to feel like a conversation.

## The hard parts

These are the problems that took the real work, and the files to read first.

### Barge-in — [`src/lib/voice/engine.ts`](src/lib/voice/engine.ts)

Letting the caller talk over the agent is the whole product, and it is harder
than muting the speaker. When VAD reports speech while the agent is talking:

- playback stops immediately, and the queued PCM is dropped;
- the **in-flight LLM request and every pending TTS request are aborted**, so
  the server stops generating a reply nobody will hear;
- the partial reply is persisted as `interrupted`, so the transcript records
  what the caller actually heard rather than what was generated;
- the new utterance becomes the next turn, with the truncated reply in context.

Getting the abort ordering wrong gives you an agent that talks over itself, or
one that pays for tokens and speech it throws away.

### Gapless playback — [`src/lib/voice/player.ts`](src/lib/voice/player.ts)

TTS arrives as a stream of PCM chunks per sentence. Scheduling each chunk on
the Web Audio clock — instead of playing them as they land — keeps sentences
from clicking or drifting apart, while still allowing an instant stop on
barge-in.

### Credentials never reach the browser — [`src/lib/server/ticket.ts`](src/lib/server/ticket.ts)

The browser needs a direct websocket to Deepgram for low-latency STT, but must
never hold the API key. `/api/voice/session` mints a 60-second scoped Deepgram
token, plus a signed **call ticket** that lets the hot-path TTS route authorize
each sentence without a database round trip.

### Webhooks that can't double-charge — [`convex/razorpay.ts`](convex/razorpay.ts)

Payment webhooks retry. Every event is signature-verified before anything
happens, recorded by event id, and ignored on redelivery, so a retried
`subscription.charged` cannot credit minutes twice. Unsigned delivery is
rejected with a 503 rather than trusted.

## What's in the app

Multi-tenant workspaces with role-based access, agent CRUD with a live
in-browser test call, turn-by-turn transcripts with captured leads and
bookings, usage analytics, and monthly INR subscriptions with plan-based
feature gating.

## Running it

See [`docs/setup.md`](docs/setup.md) for local setup, environment variables,
billing configuration and deployment.

```bash
bun install
bunx convex dev     # links a Convex deployment
bun run dev
```

| | |
| --- | --- |
| `bun run dev` | Convex + Next.js |
| `bun run typecheck` | app + Convex |
| `bun run test` | unit tests |
| `bun run lint` | ESLint |
| `bun run build` | production build |
