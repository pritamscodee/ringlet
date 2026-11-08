import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived signed "call ticket". It lets the hot-path TTS route
 * authorize a request without a database round trip on every sentence.
 */
type Ticket = { c: string; v: string; exp: number };

function secret() {
  const s = process.env.RINGLET_SESSION_SECRET;
  if (!s) throw new Error("RINGLET_SESSION_SECRET is not set");
  return s;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueTicket(conversationId: string, voice: string, ttlSec: number) {
  const payload = Buffer.from(
    JSON.stringify({ c: conversationId, v: voice, exp: Date.now() + ttlSec * 1000 } satisfies Ticket),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readTicket(ticket: string | null | undefined): Ticket | null {
  if (!ticket) return null;
  const [payload, sig] = ticket.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Ticket;
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
