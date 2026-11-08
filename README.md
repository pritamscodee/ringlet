# Ringlet

Real-time AI voice agents for sales calls, front desks, scheduling and support.

**Stack:** Next.js 16 · TypeScript · Tailwind v4 · shadcn/ui · TanStack Query · Convex (DB, auth, billing backend) · Mastra (agent) · Deepgram (STT + TTS) · Silero VAD · Sentry · SST · bun

## How a call works

```
mic (getUserMedia, echo-cancelled)
  → Silero VAD in the browser (speech start/end, barge-in)
  → Deepgram Nova-3 streaming STT (browser websocket, 60s token from /api/voice/session)
  → /api/voice/respond: Mastra agent with tools, streamed as NDJSON
  → /api/voice/tts per sentence: Deepgram Aura-2, streamed 24 kHz PCM
  → gapless Web Audio playback
```

When the caller speaks over the agent, playback stops, and the in-flight LLM and TTS requests are aborted. The partial reply is saved as `interrupted`, and the new utterance becomes the next turn. Code lives in `src/lib/voice/engine.ts`.

## Setup

```bash
bun install                 # also copies VAD/ONNX assets into public/vad
bunx convex dev             # links a Convex deployment and writes .env.local
```

Set Convex Auth keys once per deployment (`bunx @convex-dev/auth` does it, or set `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS` by hand).

Add to `.env.local` (see `.env.example`):

```
DEEPGRAM_API_KEY=...
ANTHROPIC_API_KEY=...
RINGLET_SESSION_SECRET=<long random string>
NEXT_PUBLIC_SENTRY_DSN=...   # optional
```

Then run `bun run dev` and open http://localhost:3000.

## Billing (Razorpay)

Customers subscribe monthly in INR through Razorpay Subscriptions (UPI Autopay, cards, netbanking e-mandate). Plans live in `src/lib/shared/plans.ts` (`INR_PLANS`); prices include GST.

| Plan | ₹/month | Minutes | Agents | Recordings | Webhook tools | Smart model | Knowledge |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Starter | 599 | 100 | 2 | no | no | no | 50k chars |
| Growth | 799 | 150 | 5 | yes | yes | no | 100k chars |
| Pro | 999 | 200 | unlimited | yes | yes | yes, at 2× minutes | 200k chars |

- Each successful charge adds the month's minutes. Unused minutes roll over, but the balance after renewal is capped at 2× the plan.
- Limits apply only while a Razorpay plan is active. Trial workspaces keep every feature.
- After a downgrade, saved agents keep their settings. Webhook tools, recording and the Smart model are switched off on calls.
- Razorpay plans are created automatically on first checkout (one per plan and price). Changing a price creates a new Razorpay plan; existing subscribers keep their old price.

1. Set these on the **Convex** deployment: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
2. Turn on Subscriptions in the Razorpay Dashboard.
3. Add the webhook `https://<deployment>.convex.site/webhooks/razorpay` with the `subscription.*` events (at least `authenticated`, `activated`, `charged`, `pending`, `halted`, `cancelled`, `completed`).

## Scripts

| | |
| --- | --- |
| `bun run dev` | Convex + Next.js |
| `bun run test` | unit tests (webhook signatures, chunker, knowledge search, plan limits) |
| `bun run typecheck` | app + Convex |
| `bun run deploy:convex` | deploy Convex |
| `bun run deploy` | SST deploy to AWS (`sst secret set …` first, see `sst.config.ts`) |
