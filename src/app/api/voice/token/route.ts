import { grantDeepgramToken } from "@/lib/server/deepgram";
import { readTicket } from "@/lib/server/ticket";

/** Fresh Deepgram token for reconnecting the STT socket mid-call. */
export async function POST(req: Request) {
  const ticket = readTicket(req.headers.get("x-ringlet-ticket"));
  if (!ticket) return Response.json({ error: "Invalid call ticket" }, { status: 401 });
  const { token } = await grantDeepgramToken(60);
  return Response.json({ sttToken: token });
}
