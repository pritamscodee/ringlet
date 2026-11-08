import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function requireUser(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Not signed in");
  return userId;
}

/** Resolves the caller's membership in a workspace, or throws. */
export async function requireMember(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  roles?: Doc<"memberships">["role"][],
) {
  const userId = await requireUser(ctx);
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const membership = memberships.find((m) => m.workspaceId === workspaceId);
  if (!membership) throw new ConvexError("No access to this workspace");
  if (roles && !roles.includes(membership.role)) {
    throw new ConvexError("Your role cannot do this");
  }
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) throw new ConvexError("Workspace not found");
  return { userId, membership, workspace };
}

export async function requireAgentAccess(ctx: Ctx, agentId: Id<"agents">) {
  const agent = await ctx.db.get(agentId);
  if (!agent) throw new ConvexError("Agent not found");
  const access = await requireMember(ctx, agent.workspaceId);
  return { ...access, agent };
}

export async function requireConversationAccess(
  ctx: Ctx,
  conversationId: Id<"conversations">,
) {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) throw new ConvexError("Conversation not found");
  const access = await requireMember(ctx, conversation.workspaceId);
  return { ...access, conversation };
}
