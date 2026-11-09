"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Mutations refetch what they touch (src/lib/rpc.ts); this keeps
            // data written elsewhere (teammates, other tabs) reasonably fresh.
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (count, error) => count < 2 && !("status" in error && Number(error.status) < 500),
          },
        },
      }),
  );

  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MotionConfig>
  );
}
