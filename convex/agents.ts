import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAgentAccess, requireMember } from "./lib/access";
import { agentBehavior, customTool, knowledgeDoc } from "./schema";
import type { Doc } from "./_generated/dataModel";
import { entitlementsFor, SMART_MODEL_ID } from "../src/lib/shared/plans";

const agentFields = {
  name: v.string(),
  useCase: v.string(),
  personality: v.string(),
  instructions: v.string(),
  systemPrompt: v.string(),
  greeting: v.string(),
  voice: v.string(),
  language: v.string(),
  model: v.string(),
  behavior: agentBehavior,
  builtinTools: v.array(v.string()),
  customTools: v.array(customTool),
  knowledge: v.array(knowledgeDoc),
};

const TOOL_NAME = /^[a-z][a-z0-9_]{1,40}$/;

function validate(
  workspace: Doc<"workspaces">,
  fields: {
    name: string;
    model: string;
    customTools: { name: string; url: string }[];
    knowledge: { content: string }[];
    behavior: { maxCallSec: number; endpointingMs: number; temperature: number; recordCalls: boolean };
  },
) {
  const plan = entitlementsFor(workspace);
  if (fields.customTools.length > 0 && !plan.customTools) {
    throw new ConvexError("Custom webhook tools are available on the Growth plan and above");
  }
  if (fields.behavior.recordCalls && !plan.recording) {
    throw new ConvexError("Call recordings are available on the Growth plan and above");
  }
  if (fields.model === SMART_MODEL_ID && !plan.smartModel) {
    throw new ConvexError("The Smart model is available on the Pro plan");
  }
  if (!fields.name.trim()) throw new ConvexError("Agent name is required");
  for (const t of fields.customTools) {
    if (!TOOL_NAME.test(t.name)) {
      throw new ConvexError(
        `Tool name "${t.name}" must be snake_case letters, digits and underscores`,
      );
    }
    let url: URL;
    try {
      url = new URL(t.url);
    } catch {
      throw new ConvexError(`Tool "${t.name}" has an invalid URL`);
    }
    if (url.protocol !== "https:") {
      throw new ConvexError(`Tool "${t.name}" must use an https:// URL`);
    }
  }
  const knowledgeSize = fields.knowledge.reduce((n, k) => n + k.content.length, 0);
  if (knowledgeSize > plan.knowledgeChars) {
    throw new ConvexError(
      `Knowledge sources are limited to ${plan.knowledgeChars.toLocaleString("en-US")} characters per agent on your plan`,
    );
  }
  const b = fields.behavior;
  if (b.maxCallSec < 30 || b.maxCallSec > 3600) {
    throw new ConvexError("Max call length must be between 30 seconds and 1 hour");
  }
  if (b.endpointingMs < 10 || b.endpointingMs > 5000) {
    throw new ConvexError("Endpointing must be between 10 and 5000 ms");
  }
  if (b.temperature < 0 || b.temperature > 1) {
    throw new ConvexError("Temperature must be between 0 and 1");
  }
}

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
    return Promise.all(
      agents.map(async (a) => {
        const calls = await ctx.db
          .query("conversations")
          .withIndex("by_agent", (q) => q.eq("agentId", a._id))
          .collect();
        return {
          ...a,
          callCount: calls.length,
          lastCallAt: calls.reduce((t, c) => Math.max(t, c.startedAt), 0) || null,
        };
      }),
    );
  },
});

export const get = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { agent } = await requireAgentAccess(ctx, agentId);
    return agent;
  },
});

export const create = mutation({
  args: { workspaceId: v.id("workspaces"), ...agentFields },
  handler: async (ctx, { workspaceId, ...fields }) => {
    const { workspace } = await requireMember(ctx, workspaceId, ["owner", "admin"]);
    validate(workspace, fields);
    const { maxAgents } = entitlementsFor(workspace);
    if (maxAgents !== null) {
      const existing = await ctx.db
        .query("agents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .take(maxAgents);
      if (existing.length >= maxAgents) {
        throw new ConvexError(
          `Your plan includes ${maxAgents} agents. Upgrade on the Usage page to add more.`,
        );
      }
    }
    return ctx.db.insert("agents", {
      workspaceId,
      ...fields,
      status: "live",
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: { agentId: v.id("agents"), ...agentFields },
  handler: async (ctx, { agentId, ...fields }) => {
    const { agent } = await requireAgentAccess(ctx, agentId);
    const { workspace } = await requireMember(ctx, agent.workspaceId, ["owner", "admin"]);
    validate(workspace, fields);
    await ctx.db.patch(agentId, { ...fields, updatedAt: Date.now() });
  },
});

export const setStatus = mutation({
  args: {
    agentId: v.id("agents"),
    status: v.union(v.literal("draft"), v.literal("live"), v.literal("paused")),
  },
  handler: async (ctx, { agentId, status }) => {
    const { agent } = await requireAgentAccess(ctx, agentId);
    await requireMember(ctx, agent.workspaceId, ["owner", "admin"]);
    await ctx.db.patch(agentId, { status, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { agent } = await requireAgentAccess(ctx, agentId);
    await requireMember(ctx, agent.workspaceId, ["owner", "admin"]);
    // Conversations keep agentName, so history stays readable after deletion.
    await ctx.db.delete(agentId);
  },
});
