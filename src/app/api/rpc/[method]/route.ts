import * as Sentry from "@sentry/nextjs";
import { currentUserId } from "@/server/auth";
import { errorMessage, errorStatus, UserError } from "@/server/errors";
import { router } from "@/server/rpc";

export async function POST(req: Request, ctx: RouteContext<"/api/rpc/[method]">) {
  const { method: name } = await ctx.params;
  const method = Object.hasOwn(router, name) ? router[name as keyof typeof router] : undefined;
  if (!method) return Response.json({ error: "Unknown method" }, { status: 404 });

  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = method.input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  try {
    // Each entry's handler accepts its own schema's output.
    const handler = method.handler as (userId: string, args: unknown) => Promise<unknown>;
    const result = await handler(userId, parsed.data);
    return Response.json({ data: result ?? null });
  } catch (e) {
    if (!(e instanceof UserError)) Sentry.captureException(e, { tags: { area: "rpc", method: name } });
    return Response.json({ error: errorMessage(e) }, { status: errorStatus(e) });
  }
}
