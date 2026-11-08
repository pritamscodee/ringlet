import "server-only";

const DG = "https://api.deepgram.com/v1";

function key() {
  const k = process.env.DEEPGRAM_API_KEY;
  if (!k) throw new Error("DEEPGRAM_API_KEY is not set");
  return k;
}

/**
 * Mints a short-lived Deepgram token so the browser can open the streaming
 * STT socket directly (lowest latency) without seeing the API key.
 * The TTL only limits opening a connection; open sockets stay up.
 */
export async function grantDeepgramToken(ttlSeconds = 60) {
  const res = await fetch(`${DG}/auth/grant`, {
    method: "POST",
    headers: { Authorization: `Token ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  });
  if (!res.ok) {
    throw new Error(`Deepgram token grant failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { token: data.access_token, expiresIn: data.expires_in };
}

export const TTS_SAMPLE_RATE = 24000;

/** Streams raw 16-bit PCM (mono, 24 kHz) for a piece of text. */
export async function speak(text: string, voice: string, signal?: AbortSignal) {
  const url = new URL(`${DG}/speak`);
  url.searchParams.set("model", voice);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(TTS_SAMPLE_RATE));
  url.searchParams.set("container", "none");
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
}
