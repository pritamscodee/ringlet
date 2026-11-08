/**
 * Starting points for the Agent Builder, one per target use case.
 * Each template only pre-fills the builder; everything stays editable.
 */
export type BuiltinToolId =
  | "capture_lead"
  | "book_appointment"
  | "take_message"
  | "search_knowledge"
  | "transfer_to_human"
  | "end_call";

export const BUILTIN_TOOLS: {
  id: BuiltinToolId;
  label: string;
  description: string;
}[] = [
  {
    id: "capture_lead",
    label: "Capture lead",
    description: "Save a qualified prospect: contact details, need, budget, timeline.",
  },
  {
    id: "book_appointment",
    label: "Book appointment",
    description: "Record a requested booking with name, phone, time and reason.",
  },
  {
    id: "take_message",
    label: "Take message",
    description: "Leave a message or callback request for the team.",
  },
  {
    id: "search_knowledge",
    label: "Search knowledge",
    description: "Look up answers in this agent's knowledge sources.",
  },
  {
    id: "transfer_to_human",
    label: "Transfer to human",
    description: "Hand the caller to a person and log why.",
  },
  {
    id: "end_call",
    label: "End call",
    description: "Hang up politely once the conversation is finished.",
  },
];

export type AgentTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  personality: string;
  instructions: string;
  greeting: string;
  voice: string;
  tools: BuiltinToolId[];
};

const VOICE_RULES = `You are speaking on a live voice call. Keep every reply short: one to three sentences.
Never use markdown, lists, emojis or URLs. Spell out numbers the way people say them.
Ask one question at a time. If the caller interrupts, drop what you were saying and answer them.`;

export const BASE_SYSTEM_PROMPT = VOICE_RULES;

export const TEMPLATES: AgentTemplate[] = [
  {
    id: "sales-sdr",
    name: "Sales Development Rep",
    category: "Sales",
    description: "Calls or answers inbound leads, qualifies them and books a demo.",
    personality: "Confident, warm and curious. Sounds like a sharp human SDR, never pushy.",
    instructions: `Your goal is to qualify the prospect and book a demo with an account executive.
Discover: their company, role, the problem they want to solve, current solution, budget range and timeline.
Use the BANT framework loosely; do not interrogate. Handle objections with empathy, then redirect to value.
When you have contact details and a clear need, call capture_lead. If they want a demo, call book_appointment.
If they are not a fit, thank them and end the call.`,
    greeting: "Hi, this is Alex from the sales team. Do you have a quick minute to chat about what you're looking for?",
    voice: "aura-2-apollo-en",
    tools: ["capture_lead", "book_appointment", "search_knowledge", "end_call"],
  },
  {
    id: "receptionist",
    name: "AI Receptionist",
    category: "Front desk",
    description: "Answers the front desk line, routes callers, books visits and takes messages.",
    personality: "Friendly, calm and efficient, like an experienced front-desk receptionist.",
    instructions: `You answer the business's main phone line.
Find out why the person is calling. Answer common questions using search_knowledge (hours, location, services, prices).
To book a visit, collect name, phone number, preferred date and time, and reason, then call book_appointment.
If the caller wants a specific person or it's urgent, call transfer_to_human. Otherwise offer to take a message with take_message.
Read details back to the caller as you save them; if they correct something, save again.`,
    greeting: "Thanks for calling! This is the front desk. How can I help you today?",
    voice: "aura-2-thalia-en",
    tools: ["book_appointment", "take_message", "search_knowledge", "transfer_to_human", "end_call"],
  },
  {
    id: "support",
    name: "Customer Support",
    category: "Support",
    description: "Resolves tier-1 support questions from your knowledge base and escalates the rest.",
    personality: "Patient, empathetic and precise. Apologizes once, then focuses on fixing things.",
    instructions: `Help customers resolve their issue.
First understand the problem and collect the account email or order number.
Search the knowledge base before answering. Never invent policies, prices or refunds.
If you cannot solve it, or the customer is upset and asks for a person, call transfer_to_human with a clear summary.`,
    greeting: "Hi, you've reached support. What can I help you with today?",
    voice: "aura-2-athena-en",
    tools: ["search_knowledge", "take_message", "transfer_to_human", "end_call"],
  },
  {
    id: "appointment-scheduler",
    name: "Appointment Scheduler",
    category: "Scheduling",
    description: "Books, reschedules and confirms appointments for clinics, salons and services.",
    personality: "Organized and reassuring. Confirms every detail clearly.",
    instructions: `Book or reschedule appointments.
Collect: full name, phone number, service needed, preferred date and time, and any notes.
Call book_appointment as soon as you have them, while reading the details back. If the caller corrects anything, call it again.
If the requested time is unclear, offer two concrete options.`,
    greeting: "Hello! I can help you book or change an appointment. What would you like to do?",
    voice: "aura-2-luna-en",
    tools: ["book_appointment", "search_knowledge", "take_message", "end_call"],
  },
  {
    id: "lead-qualifier",
    name: "Inbound Lead Qualifier",
    category: "Sales",
    description: "Responds to web form leads within seconds and scores them for your sales team.",
    personality: "Upbeat and concise. Respects the prospect's time.",
    instructions: `A prospect just submitted a form. Thank them and qualify quickly.
Ask about company size, use case, timeline and decision maker.
Score the lead from 1 to 10 and call capture_lead with your score and reasoning.
Offer to book a call with a specialist using book_appointment.`,
    greeting: "Hi there, thanks for reaching out! I've got a few quick questions so we can point you to the right person.",
    voice: "aura-2-orion-en",
    tools: ["capture_lead", "book_appointment", "end_call"],
  },
  {
    id: "real-estate",
    name: "Real Estate Assistant",
    category: "Real estate",
    description: "Answers listing enquiries, qualifies buyers and books viewings.",
    personality: "Knowledgeable, personable and professional.",
    instructions: `Help buyers and renters with property enquiries.
Use search_knowledge for listing details. Ask about budget, preferred area, bedrooms, move-in date and financing.
Book viewings with book_appointment and save serious buyers with capture_lead.`,
    greeting: "Hi, thanks for calling about our listings. Which property are you interested in?",
    voice: "aura-2-hermes-en",
    tools: ["capture_lead", "book_appointment", "search_knowledge", "end_call"],
  },
  {
    id: "restaurant",
    name: "Restaurant Host",
    category: "Hospitality",
    description: "Takes reservations and answers questions about menu, hours and location.",
    personality: "Cheerful and welcoming, like a great host.",
    instructions: `Take table reservations: name, phone, party size, date and time, and special requests.
Call book_appointment as soon as you have the details, and read them back. Answer menu and hours questions using search_knowledge.`,
    greeting: "Good day, thanks for calling! Would you like to make a reservation?",
    voice: "aura-2-asteria-en",
    tools: ["book_appointment", "search_knowledge", "take_message", "end_call"],
  },
  {
    id: "survey",
    name: "Feedback & Survey",
    category: "Research",
    description: "Runs short customer satisfaction and NPS calls and records the answers.",
    personality: "Polite, neutral and brief. Never leads the respondent.",
    instructions: `Run a short feedback survey of at most five questions.
Start with: how likely are they to recommend us from zero to ten. Ask why.
Ask what we could do better. Save their answers with take_message, then thank them and end the call.`,
    greeting: "Hi! We'd love two minutes of your feedback about your recent experience. Is now a good time?",
    voice: "aura-2-cora-en",
    tools: ["take_message", "end_call"],
  },
  {
    id: "blank",
    name: "Blank agent",
    category: "Custom",
    description: "Start from scratch with only the voice rules.",
    personality: "Helpful and concise.",
    instructions: "Describe what this agent should do on calls.",
    greeting: "Hi! How can I help you today?",
    voice: "aura-2-thalia-en",
    tools: ["end_call"],
  },
];

export function getTemplate(id: string): AgentTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[TEMPLATES.length - 1];
}

export const VOICES = [
  { id: "aura-2-thalia-en", label: "Thalia (female, US, clear)" },
  { id: "aura-2-asteria-en", label: "Asteria (female, US, warm)" },
  { id: "aura-2-luna-en", label: "Luna (female, US, soft)" },
  { id: "aura-2-athena-en", label: "Athena (female, US, calm)" },
  { id: "aura-2-cora-en", label: "Cora (female, US, friendly)" },
  { id: "aura-2-apollo-en", label: "Apollo (male, US, confident)" },
  { id: "aura-2-orion-en", label: "Orion (male, US, upbeat)" },
  { id: "aura-2-hermes-en", label: "Hermes (male, US, professional)" },
  { id: "aura-2-arcas-en", label: "Arcas (male, US, natural)" },
  { id: "aura-2-celeste-es", label: "Celeste (female, Spanish)" },
  { id: "aura-2-nestor-es", label: "Nestor (male, Spanish)" },
];

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "multi", label: "Multilingual (auto-detect)" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "hi", label: "Hindi" },
  { id: "pt", label: "Portuguese" },
];

export const MODELS = [
  { id: "anthropic/claude-haiku-5-5", label: "Fast: lowest latency" },
  { id: "anthropic/claude-sonnet-5-5", label: "Smart: better reasoning" },
];

export const DEFAULT_BEHAVIOR = {
  allowInterruptions: true,
  endpointingMs: 300,
  silenceTimeoutSec: 30,
  maxCallSec: 900,
  temperature: 0.6,
  recordCalls: false,
};
