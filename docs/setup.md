# Setup and operations

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

## Production

`bunx convex deploy` pushes code and schema to the production deployment. It
does **not** copy data or environment variables from dev: a fresh production
deployment starts empty and unconfigured.

Point the production build at it with a `.env.production.local` (gitignored),
which Next.js loads for `next build` and `next start` only, so `bun run dev`
keeps using the dev deployment from `.env.local`:

```
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
```

Then set the deployment's own environment. Auth keys should be generated
fresh for production rather than copied from dev:

```bash
bunx @convex-dev/auth --prod
bunx convex env set SITE_URL https://<your-frontend-origin> --prod
```

`SITE_URL` must match the deployed frontend's origin or sign-in fails, so it
can only be set once the frontend has a URL.

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
