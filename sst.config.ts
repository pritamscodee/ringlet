/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Deploys the Next.js app to AWS (Lambda + CloudFront via OpenNext).
 * Convex is hosted separately: deploy it with `bunx convex deploy`.
 *
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
    const deepgram = new sst.Secret("DeepgramApiKey");
    const anthropic = new sst.Secret("AnthropicApiKey");
    const session = new sst.Secret("SessionSecret");
    const sentry = new sst.Secret("SentryDsn", "");

    const site = new sst.aws.Nextjs("Ringlet", {
      environment: {
        NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL!,
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
