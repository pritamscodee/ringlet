import { z } from "zod";

/** Shapes stored in Postgres JSON columns, and the inputs that write them. */

export const agentBehavior = z.object({
  allowInterruptions: z.boolean(),
  // Deepgram endpointing: ms of trailing silence before a transcript is finalized.
  endpointingMs: z.number(),
  // Hang up after this many seconds with no user speech.
  silenceTimeoutSec: z.number(),
  maxCallSec: z.number(),
  temperature: z.number(),
  recordCalls: z.boolean(),
});

export const customTool = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string(),
  method: z.enum(["POST", "GET"]),
});

export const knowledgeDoc = z.object({
  title: z.string(),
  content: z.string(),
});

export const callMetrics = z.object({
  turns: z.number().int().nonnegative(),
  interruptions: z.number().int().nonnegative(),
  sttLatencyMs: z.number().nonnegative().optional(),
  llmFirstTokenMs: z.number().nonnegative().optional(),
  ttsFirstByteMs: z.number().nonnegative().optional(),
  responseLatencyMs: z.number().nonnegative().optional(),
});

export const agentFields = z.object({
  name: z.string().max(120),
  useCase: z.string(),
  personality: z.string(),
  instructions: z.string(),
  systemPrompt: z.string(),
  greeting: z.string(),
  voice: z.string(),
  language: z.string(),
  model: z.string(),
  behavior: agentBehavior,
  builtinTools: z.array(z.string()),
  customTools: z.array(customTool),
  knowledge: z.array(knowledgeDoc),
});

export const agentStatus = z.enum(["draft", "live", "paused"]);
export const captureKind = z.enum(["lead", "appointment", "message", "handoff"]);
export const messageRole = z.enum(["user", "agent", "tool"]);
export const memberRole = z.enum(["owner", "admin", "member"]);

export type AgentBehavior = z.infer<typeof agentBehavior>;
export type CustomTool = z.infer<typeof customTool>;
export type KnowledgeDoc = z.infer<typeof knowledgeDoc>;
export type CallMetrics = z.infer<typeof callMetrics>;
export type AgentFields = z.infer<typeof agentFields>;
export type CaptureKind = z.infer<typeof captureKind>;
export type MemberRole = z.infer<typeof memberRole>;
