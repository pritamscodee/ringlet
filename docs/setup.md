# Setup and operations

The app uses one database: **Neon Postgres**, reached through Prisma 7. Convex
was removed in commit `e3b816f`; there is no Convex backend in this repository.

## Setup

```bash
bun install                 # also copies VAD/ONNX assets into public/vad
cp .env.example .env.local  # then fill in the values below
bunx prisma migrate deploy  # or: bun run db:deploy
bun run dev
```

Fill `.env.local` with:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon pooled endpoint, used by the app at runtime |
| `DIRECT_URL` | Same database, unpooled; used by Prisma migrations |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Email/password sessions |
| `DEEPGRAM_API_KEY` | Speech-to-text and text-to-speech, including browser grant tokens |
| `ANTHROPIC_API_KEY` | Agent turns via Mastra |
| `RINGLET_SESSION_SECRET` | Signs short-lived per-call tickets |
| `RECORDINGS_BUCKET` | Optional; enables call recording |
| `NEXT_PUBLIC_DEMO_AGENT_ID` | Optional; makes the landing-page hero callable |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_*` | Optional observability |

`DIRECT_URL` must be the unpooled Neon host: migrations cannot run through the
pooler. `prisma.config.ts` loads `.env.local` for the CLI, while
`src/server/db.ts` uses `DATABASE_URL` through the Neon driver adapter.

## Production

Migrations are applied to Neon separately from the app deploy. Point
`DATABASE_URL`/`DIRECT_URL` at the production database when running them, then
deploy the Next.js app with SST:

```bash
bun run db:deploy
bun run deploy           # sst deploy --stage production
```

SST injects the runtime secrets; set them once with `bunx sst secret set` as
listed at the top of `sst.config.ts`. `DatabaseUrl` is the pooled Neon URL.
The production stage is protected and uses `removal: "retain"`.

## Talk time

There is no payment provider. The first workspace a user creates gets a
15-minute trial; every other workspace starts at zero. An operator tops up
minutes with:

```bash
bun run grant-minutes <workspace-id-or-email> <minutes>
```

Calls end when the balance is exhausted, and settlement clamps the balance at
zero.

## Scripts

| | |
| --- | --- |
| `bun run dev` | Next.js dev server |
| `bun run build` | Prisma client generation + production build |
| `bun run db:migrate` | Create/apply a migration in development |
| `bun run db:deploy` | Apply migrations to the configured database |
| `bun run db:studio` | Browse the database |
| `bun run grant-minutes` | Add talk time to a workspace |
| `bun run test` | Unit tests (sentence chunker, knowledge search) |
| `bun run typecheck` | Client generation, Next typegen, `tsc --noEmit` |
| `bun run lint` | ESLint |
| `bun run deploy` | SST deploy to AWS (`sst secret set …` first, see `sst.config.ts`) |
