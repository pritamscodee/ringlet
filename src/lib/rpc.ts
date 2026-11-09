"use client";

import {
  queryOptions,
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type { z } from "zod";
import type { Router } from "@/server/rpc";

/** Typed client for /api/rpc. Method names and types come from src/server/rpc.ts. */

export type Method = keyof Router;
export type RpcInput<M extends Method> = z.input<Router[M]["input"]>;
export type RpcOutput<M extends Method> = Awaited<ReturnType<Router[M]["handler"]>>;

export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export async function rpc<M extends Method>(method: M, input: RpcInput<M>): Promise<RpcOutput<M>> {
  const res = await fetch(`/api/rpc/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => null)) as { data?: unknown; error?: string } | null;
  if (!res.ok) throw new RpcError(body?.error ?? "Something went wrong. Try again.", res.status);
  return body?.data as RpcOutput<M>;
}

/** Query options for useQuery. All RPC queries share the "rpc" key prefix. */
export function rpcQuery<M extends Method>(method: M, input: RpcInput<M>) {
  return queryOptions({
    queryKey: ["rpc", method, input] as const,
    queryFn: () => rpc(method, input),
  });
}

/**
 * A mutation that refetches every RPC query when it succeeds, so lists,
 * balances and detail pages stay in step with what was just written.
 */
export function useRpcMutation<M extends Method>(
  method: M,
  options?: Omit<UseMutationOptions<RpcOutput<M>, Error, RpcInput<M>>, "mutationFn">,
) {
  const queryClient = useQueryClient();
  return useMutation<RpcOutput<M>, Error, RpcInput<M>>({
    ...options,
    mutationFn: (input) => rpc(method, input),
    onSuccess: async (...args) => {
      await options?.onSuccess?.(...args);
      void queryClient.invalidateQueries({ queryKey: ["rpc"] });
    },
  });
}
