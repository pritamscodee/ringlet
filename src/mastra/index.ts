import "server-only";
import { Agent } from "@mastra/core/agent";
import type { AgentDto } from "@/server/services/agents";
import { BASE_SYSTEM_PROMPT } from "@/lib/shared/templates";
import { inlineKnowledge, INLINE_KNOWLEDGE_LIMIT, knowledgeSize } from "./knowledge";
import { toolsFor } from "./tools";

export const DEFAULT_MODEL = process.env.RINGLET_DEFAULT_MODEL ?? "anthropic/claude-haiku-5-5";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  hi: "Hindi",
  pt: "Portuguese",
};

export function buildInstructions(agent: AgentDto) {
  const parts = [
    BASE_SYSTEM_PROMPT,
    `Your name is ${agent.name}.`,
    agent.personality && `Personality: ${agent.personality}`,
    agent.instructions && `## Your job\n${agent.instructions}`,
    agent.systemPrompt && `## Additional rules\n${agent.systemPrompt}`,
    agent.language === "multi"
      ? "Reply in the language the caller speaks."
      : `Always reply in ${LANGUAGE_NAMES[agent.language] ?? "English"}.`,
    `Current date and time: ${new Date().toUTCString()}.`,
  ];
  if (agent.knowledge.length) {
    if (knowledgeSize(agent.knowledge) <= INLINE_KNOWLEDGE_LIMIT) {
      parts.push(`## Knowledge\nOnly state facts found here.\n${inlineKnowledge(agent.knowledge)}`);
    } else if (agent.builtinTools.includes("search_knowledge")) {
      parts.push("Use search_knowledge for any factual question about the business.");
    }
  }
  if (agent.builtinTools.includes("book_appointment")) {
    // Overrides older saved instructions that say to wait for a "yes":
    // callers often hang up during the read-back, losing the booking.
    parts.push(
      "## Booking\nCall book_appointment the moment you have the caller's name, service and requested time, in the same turn you read them back. Never wait for confirmation first. If they correct a detail, call it again.",
    );
  }
  if (agent.builtinTools.includes("end_call")) {
    parts.push("When the conversation is over, say a short goodbye and call end_call.");
  }
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Builds the Mastra agent for one conversation, with tools bound to it.
 * Conversation history is stored in Postgres and passed in per turn, so no
 * Mastra storage or memory is configured.
 */
export function voiceAgentFor(
  agent: AgentDto,
  deps: { userId: string; conversationId: string },
) {
  return new Agent({
    id: `ringlet-${agent.id}`,
    name: agent.name,
    instructions: buildInstructions(agent),
    model: agent.model || DEFAULT_MODEL,
    tools: toolsFor({ ...deps, agent }),
  });
}

/** Writes post-call summaries. */
export const summarizer = new Agent({
  id: "call-summarizer",
  name: "Call summarizer",
  instructions: `You summarize voice agent calls for a business dashboard.
Return a 2 to 4 sentence summary: who called, what they wanted, what was agreed or captured, and any follow-up needed.
Pick an outcome label from: resolved, lead_captured, appointment_booked, message_taken, transferred, not_interested, no_answer, other.`,
  model: DEFAULT_MODEL,
});

