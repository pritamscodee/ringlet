import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireMember } from "./lib/access";
import { getInrPlan, INR_PLANS } from "../src/lib/shared/plans";

export const overview = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { workspace, membership } = await requireMember(ctx, workspaceId);
    return {
      creditSeconds: workspace.creditSeconds,
      canManage: membership.role !== "member",
    };
  },
});

export const memberCanManage = internalQuery({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users") },
  handler: async (ctx, { workspaceId, userId }) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const m = memberships.find((x) => x.workspaceId === workspaceId);
    return { isMember: !!m, canManage: !!m && m.role !== "member" };
  },
});

/**
 * Admin: grant a plan's minutes to a workspace. Run via `npx convex run`.
 * Accepts either the canonical id (`in_growth`) or its bare form (`growth`),
 * which is what the retired USD packs used.
 */
export const grantPlan = internalMutation({
  args: { workspaceId: v.id("workspaces"), planId: v.string() },
  handler: async (ctx, { workspaceId, planId }) => {
    const plan = getInrPlan(planId) ?? getInrPlan(`in_${planId}`);
    if (!plan) {
      throw new ConvexError(
        `Unknown plan "${planId}". Known plans: ${INR_PLANS.map((p) => p.id).join(", ")}.`,
      );
    }
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new ConvexError("Workspace not found");
    await ctx.db.patch(workspaceId, {
      creditSeconds: workspace.creditSeconds + plan.minutes * 60,
    });
    return null;
  },
});
