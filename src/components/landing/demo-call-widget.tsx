"use client";

import * as Sentry from "@sentry/nextjs";
import { Mic, Phone, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { VoiceSession, type CallState, type TranscriptEntry } from "@/lib/voice/engine";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AsciiWave } from "./ascii-wave";

const STATE_LABEL: Record<CallState, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Agent speaking",
  ended: "Call ended",
};

/** Mic permission is the usual first-call failure, so name it plainly. */
function friendlyError(message: string) {
  if (/permission|denied|NotAllowed/i.test(message)) {
    return "Your browser blocked the microphone. Allow mic access for this site, then start the call again.";
  }
  if (/NotFound|no microphone/i.test(message)) {
    return "No microphone found. Plug one in or switch audio device, then try again.";
  }
  return message;
}

/**
 * The real, unscripted demo call: it drives the same VoiceSession the product
 * uses, so interrupting the agent here exercises the actual barge-in path.
 *
 * `sessionPath` lets this point at a public, rate-limited endpoint instead of
 * the signed-in one.
 */
export function DemoCallWidget({
  agentId,
  sessionPath,
  agentLabel = "AI Receptionist",
}: {
  agentId: string;
  sessionPath?: string;
  agentLabel?: string;
}) {
  const [state, setState] = useState<CallState | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [starting, setStarting] = useState(false);
  const session = useRef<VoiceSession | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const live = state !== null && state !== "ended";

  useEffect(() => {
    if (!live) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  // Hang up if the visitor scrolls away and unmounts us mid-call.
  useEffect(() => () => void session.current?.end("page_closed"), []);

  async function startCall() {
    setError(null);
    setEntries([]);
    setElapsed(0);
    setStarting(true);
    const s = new VoiceSession({
      agentId,
      sessionPath,
      recordingConsent: false,
      onState: setState,
      onTranscript: setEntries,
      onError: (m) => {
        setError(friendlyError(m));
        Sentry.captureMessage(`Demo call error: ${m}`, {
          level: "warning",
          tags: { area: "voice.demo" },
        });
      },
    });
    session.current = s;
    try {
      await s.start();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : "Could not start the call"));
      setState("ended");
    } finally {
      setStarting(false);
    }
  }

  async function hangUp() {
    await session.current?.end("user_hung_up");
  }

  const phase: CallState = state ?? "listening";
  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-surface">
      <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full transition-[background-color] duration-150",
              !live && "bg-muted-foreground/40",
              live && phase === "speaking" && "bg-primary",
              live && phase === "listening" && "bg-success",
              live && (phase === "thinking" || phase === "connecting") && "bg-warning",
            )}
          />
          <span className="font-medium">{agentLabel}</span>
          <span className="text-muted-foreground">
            {live ? STATE_LABEL[phase] : state === "ended" ? "Call ended" : "Ready"}
          </span>
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {mins}:{secs}
        </span>
      </div>

      <AsciiWave
        columns={72}
        rows={5}
        energy={live ? (phase === "speaking" ? 1 : phase === "listening" ? 0.45 : 0.08) : 0.04}
        className={cn(
          "overflow-hidden border-b px-4 py-3 font-mono text-[10px] leading-[12px] transition-[color] duration-150",
          live && phase === "speaking" ? "text-primary" : "text-illustration",
        )}
      />

      <div
        ref={scroller}
        className="h-[300px] space-y-2.5 overflow-y-auto overscroll-contain px-4 py-4"
        aria-live="polite"
      >
        {entries.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Mic className="size-6 text-muted-foreground" strokeWidth={1.5} />
            <p className="max-w-[280px] text-sm leading-5 text-muted-foreground">
              Start the call and talk to the agent. Try speaking over it mid-sentence — it stops and
              answers what you actually asked.
            </p>
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} className={cn("flex", e.role === "user" ? "justify-end" : "justify-start")}>
            <p
              className={cn(
                "max-w-[85%] rounded-xl px-3.5 py-2 text-sm leading-5",
                e.role === "user"
                  ? "bg-foreground text-background"
                  : e.role === "system"
                    ? "bg-muted font-mono text-xs text-muted-foreground"
                    : "bg-card text-foreground shadow-surface",
                e.interim && "opacity-60",
              )}
            >
              {e.text || " "}
              {e.interrupted && (
                <span className="ml-1.5 rounded-sm bg-accent px-1 font-mono text-[11px] text-primary">
                  interrupted
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <p className="border-t bg-warning/10 px-4 py-2.5 text-sm leading-5 text-foreground">{error}</p>
      )}

      <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
        <p className="font-mono text-xs text-muted-foreground">
          {live ? "Interrupt it — that's the point" : "Microphone required"}
        </p>
        {live ? (
          <Button variant="secondary" className="h-9" onClick={hangUp}>
            <PhoneOff className="size-4" strokeWidth={1.5} /> Hang Up
          </Button>
        ) : (
          <Button className="h-9" onClick={startCall} disabled={starting}>
            <Phone className="size-4" strokeWidth={1.5} />
            {starting ? "Starting…" : state === "ended" ? "Call Again" : "Start Call"}
          </Button>
        )}
      </div>
    </div>
  );
}
