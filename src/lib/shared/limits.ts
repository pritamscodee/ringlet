/**
 * Workspace limits, shared by the server and the app. There is no paid
 * billing: a workspace has a talk-time balance that starts with a trial
 * allowance and is topped up by an admin (`bun run grant-minutes`).
 */

/** New users' first workspace gets this much talk time so they can test agents. */
export const TRIAL_SECONDS = 15 * 60;

/** Knowledge characters per agent. */
export const KNOWLEDGE_CHAR_LIMIT = 200_000;

/** A call needs at least this many seconds of balance to start. */
export const MIN_CREDIT_TO_START = 10;
