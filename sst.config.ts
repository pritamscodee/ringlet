/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Deploys the Next.js app to AWS (Lambda + CloudFront via OpenNext), with an
 * S3 bucket for call recordings. The database is Neon Postgres, hosted
 * separately: apply migrations with `bun run db:deploy` before deploying.
 *
 *   bunx sst secret set DatabaseUrl <neon pooled url> --stage production
 *   bunx sst secret set BetterAuthSecret <random 32+ chars> --stage production
 *   bunx sst secret set BetterAuthUrl https://<your-domain> --stage production
 *   bunx sst secret set DeepgramApiKey <key> --stage production
 *   bunx sst secret set AnthropicApiKey <key> --stage production
 *   bunx sst secret set SessionSecret <random 32+ chars> --stage production
 *   bunx sst secret set SentryDsn <dsn> --stage production
 *   bunx sst deploy --stage production
 */
export default $config({
  app(input) {
    return {
      name: "ringlet",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "aws",
    };
  },
  async run() {
    const database = new sst.Secret("DatabaseUrl");
    const authSecret = new sst.Secret("BetterAuthSecret");
    const authUrl = new sst.Secret("BetterAuthUrl");
    const deepgram = new sst.Secret("DeepgramApiKey");
    const anthropic = new sst.Secret("AnthropicApiKey");
    const session = new sst.Secret("SessionSecret");
    const sentry = new sst.Secret("SentryDsn", "");

    // Browsers upload recordings straight to S3 with presigned URLs.
    const recordings = new sst.aws.Bucket("Recordings", {
      cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "PUT"],
        allowHeaders: ["*"],
        maxAge: "1 day",
      },
    });

    const site = new sst.aws.Nextjs("Ringlet", {
      // Grants the server functions read/write access to the bucket.
      link: [recordings],
      environment: {
        DATABASE_URL: database.value,
        BETTER_AUTH_SECRET: authSecret.value,
        BETTER_AUTH_URL: authUrl.value,
        RECORDINGS_BUCKET: recordings.name,
        NEXT_PUBLIC_SENTRY_DSN: sentry.value,
        SENTRY_DSN: sentry.value,
        DEEPGRAM_API_KEY: deepgram.value,
        ANTHROPIC_API_KEY: anthropic.value,
        RINGLET_SESSION_SECRET: session.value,
      },
      server: {
        // Agent turns stream for several seconds; summaries can take longer.
        timeout: "60 seconds",
        memory: "1024 MB",
      },
    });

    return { url: site.url };
  },
});
