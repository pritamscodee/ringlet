import "server-only";
import { z } from "zod";
import { agentFields, agentStatus } from "./schemas";
import * as agents from "./services/agents";
import * as analytics from "./services/analytics";
import * as conversations from "./services/conversations";
import * as workspaces from "./services/workspaces";

/**
 * Every method the browser can call, with its input schema. The route at
 * /api/rpc/[method] validates input and runs the handler as the signed-in
 * user; src/lib/rpc.ts gives the browser typed access to the same table.
 * The voice routes call the services directly.
 */
function method<S extends z.ZodType, R>(input: S, handler: (userId: string, args: z.infer<S>) => Promise<R>) {
  return { input, handler };
}

const id = z.string().min(1).max(64);
const ws = z.object({ workspaceId: id });

export const router = {
  "workspaces.mine": method(z.object({}), (u) => workspaces.mine(u)),
  "workspaces.get": method(ws, workspaces.get),
  "workspaces.create": method(z.object({ name: z.string().max(200) }), workspaces.create),
  "workspaces.rename": method(ws.extend({ name: z.string().max(200) }), workspaces.rename),
  "workspaces.members": method(ws, workspaces.members),
  "workspaces.addMember": method(
    ws.extend({ email: z.string().max(320), role: z.enum(["admin", "member"]) }),
    workspaces.addMember,
  ),
  "workspaces.removeMember": method(ws.extend({ membershipId: id }), workspaces.removeMember),

  "agents.list": method(ws, agents.list),
  "agents.get": method(z.object({ agentId: id }), agents.get),
  "agents.create": method(agentFields.extend({ workspaceId: id }), agents.create),
  "agents.update": method(agentFields.extend({ agentId: id }), agents.update),
  "agents.setStatus": method(z.object({ agentId: id, status: agentStatus }), agents.setStatus),
  "agents.remove": method(z.object({ agentId: id }), agents.remove),

  "conversations.list": method(
    ws.extend({ agentId: id.optional(), limit: z.number().int().positive().optional() }),
    conversations.list,
  ),
  "conversations.get": method(z.object({ conversationId: id }), conversations.get),
  "conversations.captures": method(ws, conversations.captures),
  "conversations.recordingUploadUrl": method(
    z.object({ conversationId: id, contentType: z.string().max(100) }),
    conversations.recordingUploadUrl,
  ),
  "conversations.attachRecording": method(z.object({ conversationId: id }), conversations.attachRecording),

  "analytics.overview": method(
    ws.extend({ days: z.number().int().optional() }),
    analytics.overview,
  ),
};

export type Router = typeof router;
