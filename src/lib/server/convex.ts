import "server-only";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import type { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server";

/**
 * Convex calls from route handlers, made as the signed-in user so every
 * workspace permission check in Convex applies here too.
 */
export async function convexAs() {
  const token = await convexAuthNextjsToken();
  if (!token) return null;
  return {
    token,
    query<Q extends FunctionReference<"query">>(fn: Q, args: FunctionArgs<Q>) {
      return fetchQuery(fn, args, { token }) as Promise<FunctionReturnType<Q>>;
    },
    mutation<M extends FunctionReference<"mutation">>(fn: M, args: FunctionArgs<M>) {
      return fetchMutation(fn, args, { token }) as Promise<FunctionReturnType<M>>;
    },
    action<A extends FunctionReference<"action">>(fn: A, args: FunctionArgs<A>) {
      return fetchAction(fn, args, { token }) as Promise<FunctionReturnType<A>>;
    },
  };
}

export type ConvexAs = NonNullable<Awaited<ReturnType<typeof convexAs>>>;

/**
 * A message that is safe to show customers. ConvexError messages are written
 * for users; anything else (provider errors, stack details) stays in logs and
 * Sentry and is replaced with a generic line.
 */
export function errorMessage(e: unknown) {
  if (e && typeof e === "object" && "data" in e && typeof e.data === "string") {
    return e.data;
  }
  return "Something went wrong on our side. Try again in a moment.";
}
