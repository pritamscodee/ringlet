import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { requireMember, requireUser } from "./lib/access";
import { TRIAL_SECONDS } from "../src/lib/shared/plans";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    return user ? { _id: user._id, email: user.email, name: user.name } : null;
  },
});

/** The caller's workspaces, with their role in each. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const result = [];
    for (const m of memberships) {
      const ws = await ctx.db.get(m.workspaceId);
      if (ws) result.push({ ...ws, role: m.role });
    }
    return result;
  },
});

export const get = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { workspace, membership } = await requireMember(ctx, workspaceId);
    return { ...workspace, role: membership.role };
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Workspace name is required");
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();
    const workspaceId = await ctx.db.insert("workspaces", {
      name: trimmed.slice(0, 80),
      ownerId: userId,
      // Only the first workspace a user creates gets trial minutes.
      creditSeconds: existing ? 0 : TRIAL_SECONDS,
    });
    await ctx.db.insert("memberships", { workspaceId, userId, role: "owner" });
    return workspaceId;
  },
});

export const rename = mutation({
  args: { workspaceId: v.id("workspaces"), name: v.string() },
  handler: async (ctx, { workspaceId, name }) => {
    await requireMember(ctx, workspaceId, ["owner", "admin"]);
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Workspace name is required");
    await ctx.db.patch(workspaceId, { name: trimmed.slice(0, 80) });
  },
});

export const members = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { _id: m._id, role: m.role, email: user?.email ?? "unknown" };
      }),
    );
  },
});

/** Adds an existing Ringlet user (by email) to the workspace. */
export const addMember = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, { workspaceId, email, role }) => {
    await requireMember(ctx, workspaceId, ["owner", "admin"]);
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (!user) {
      throw new ConvexError("No Ringlet account with that email. Ask them to sign up first.");
    }
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (existing.some((m) => m.workspaceId === workspaceId)) {
      throw new ConvexError("Already a member");
    }
    await ctx.db.insert("memberships", { workspaceId, userId: user._id, role });
  },
});

export const removeMember = mutation({
  args: { workspaceId: v.id("workspaces"), membershipId: v.id("memberships") },
  handler: async (ctx, { workspaceId, membershipId }) => {
    await requireMember(ctx, workspaceId, ["owner", "admin"]);
    const target = await ctx.db.get(membershipId);
    if (!target || target.workspaceId !== workspaceId) {
      throw new ConvexError("Member not found");
    }
    if (target.role === "owner") throw new ConvexError("The owner cannot be removed");
    await ctx.db.delete(membershipId);
  },
});
