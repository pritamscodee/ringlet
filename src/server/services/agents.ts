import "server-only";
import type { Agent } from "@/generated/prisma/client";
import { KNOWLEDGE_CHAR_LIMIT } from "@/lib/shared/limits";
import { MANAGERS, requireAgentAccess, requireMember } from "../access";
import { db } from "../db";
import { UserError } from "../errors";
import type { AgentBehavior, AgentFields, CustomTool, KnowledgeDoc } from "../schemas";

export type AgentDto = AgentFields & {
  id: string;
  workspaceId: string;
  status: Agent["status"];
  createdAt: number;
  updatedAt: number;
};

export function toAgentDto(a: Agent): AgentDto {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    name: a.name,
    useCase: a.useCase,
    personality: a.personality,
    instructions: a.instructions,
    systemPrompt: a.systemPrompt,
    greeting: a.greeting,
    voice: a.voice,
    language: a.language,
    model: a.model,
    behavior: a.behavior as AgentBehavior,
    builtinTools: a.builtinTools,
    customTools: a.customTools as CustomTool[],
    knowledge: a.knowledge as KnowledgeDoc[],
    status: a.status,
    createdAt: a.createdAt.getTime(),
    updatedAt: a.updatedAt.getTime(),
  };
}

const TOOL_NAME = /^[a-z][a-z0-9_]{1,40}$/;

function validate(fields: AgentFields) {
  if (!fields.name.trim()) throw new UserError("Agent name is required");
  for (const t of fields.customTools) {
    if (!TOOL_NAME.test(t.name)) {
      throw new UserError(`Tool name "${t.name}" must be snake_case letters, digits and underscores`);
    }
    let url: URL;
    try {
      url = new URL(t.url);
    } catch {
      throw new UserError(`Tool "${t.name}" has an invalid URL`);
    }
    if (url.protocol !== "https:") throw new UserError(`Tool "${t.name}" must use an https:// URL`);
  }
  const knowledgeSize = fields.knowledge.reduce((n, k) => n + k.content.length, 0);
  if (knowledgeSize > KNOWLEDGE_CHAR_LIMIT) {
    throw new UserError(
      `Knowledge sources are limited to ${KNOWLEDGE_CHAR_LIMIT.toLocaleString("en-US")} characters per agent`,
    );
  }
  const b = fields.behavior;
  if (b.maxCallSec < 30 || b.maxCallSec > 3600) {
    throw new UserError("Max call length must be between 30 seconds and 1 hour");
  }
  if (b.endpointingMs < 10 || b.endpointingMs > 5000) {
    throw new UserError("Endpointing must be between 10 and 5000 ms");
  }
  if (b.temperature < 0 || b.temperature > 1) throw new UserError("Temperature must be between 0 and 1");
}

export async function list(userId: string, { workspaceId }: { workspaceId: string }) {
  await requireMember(userId, workspaceId);
  const agents = await db.agent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { conversations: true } },
      conversations: { select: { startedAt: true }, orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  return agents.map(({ _count, conversations, ...a }) => ({
    ...toAgentDto(a),
    callCount: _count.conversations,
    lastCallAt: conversations[0]?.startedAt.getTime() ?? null,
  }));
}

export async function get(userId: string, { agentId }: { agentId: string }) {
  const { agent } = await requireAgentAccess(userId, agentId);
  return toAgentDto(agent);
}

export async function create(userId: string, { workspaceId, ...fields }: AgentFields & { workspaceId: string }) {
  await requireMember(userId, workspaceId, MANAGERS);
  validate(fields);
  const agent = await db.agent.create({ data: { workspaceId, ...fields, status: "live" } });
  return agent.id;
}

export async function update(userId: string, { agentId, ...fields }: AgentFields & { agentId: string }) {
  await requireAgentAccess(userId, agentId, MANAGERS);
  validate(fields);
  await db.agent.update({ where: { id: agentId }, data: fields });
}

export async function setStatus(
  userId: string,
  { agentId, status }: { agentId: string; status: Agent["status"] },
) {
  await requireAgentAccess(userId, agentId, MANAGERS);
  await db.agent.update({ where: { id: agentId }, data: { status } });
}

export async function remove(userId: string, { agentId }: { agentId: string }) {
  await requireAgentAccess(userId, agentId, MANAGERS);
  // Conversations keep agentName, so history stays readable after deletion.
  await db.agent.delete({ where: { id: agentId } });
}
