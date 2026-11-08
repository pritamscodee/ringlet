"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { MotionConfig } from "motion/react";
import { useState } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: React.ReactNode }) {
  // Convex pushes live updates into TanStack Query's cache over its websocket.
  const [queryClient] = useState(() => {
    const convexQueryClient = new ConvexQueryClient(convex);
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          queryKeyHashFn: convexQueryClient.hashFn(),
          queryFn: convexQueryClient.queryFn(),
        },
      },
    });
    convexQueryClient.connect(client);
    return client;
  });

  return (
    <MotionConfig reducedMotion="user">
      <ConvexAuthNextjsProvider client={convex}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ConvexAuthNextjsProvider>
    </MotionConfig>
  );
}
