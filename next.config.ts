import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Mastra and Deepgram are server-only Node packages; don't bundle them.
  serverExternalPackages: ["@mastra/core", "@deepgram/sdk"],
  async headers() {
    return [
      {
        // The VAD model and ONNX runtime are large and immutable per install.
        source: "/vad/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Proxies browser Sentry events through the app so ad blockers don't drop them.
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
});
