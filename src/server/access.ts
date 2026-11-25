import "server-only";
import type { Role } from "@/generated/prisma/client";
import { db } from "./db";
import { UserError } from "./errors";

/** Resolves the caller's membership in a workspace, or throws. */
export async function requireMember(userId: string, workspaceId: string, roles?: Role[]) {
  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    include: { workspace: true },
  });
  if (!membership) throw new UserError("No access to this workspace", 403);
  if (roles && !roles.includes(membership.role)) {
    throw new UserError("Your role cannot do this", 403);
  }
  const { workspace, ...rest } = membership;
  return { userId, membership: rest, workspace };
}

export const MANAGERS: Role[] = ["owner", "admin"];

export async function requireAgentAccess(userId: string, agentId: string, roles?: Role[]) {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new UserError("Agent not found", 404);
  const access = await requireMember(userId, agent.workspaceId, roles);
  return { ...access, agent };
}

export async function requireConversationAccess(userId: string, conversationId: string) {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new UserError("Conversation not found", 404);
  const access = await requireMember(userId, conversation.workspaceId);
  return { ...access, conversation };
}
