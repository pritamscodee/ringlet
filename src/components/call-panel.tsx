"use client";

import * as Sentry from "@sentry/nextjs";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { rpc } from "@/lib/rpc";
import type { AgentDto } from "@/server/services/agents";
import { VoiceSession, type CallState, type TranscriptEntry } from "@/lib/voice/engine";
import { ErrorNote } from "./app-ui";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<CallState, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  ended: "Call ended",
};

export function CallPanel({ agent }: { agent: AgentDto }) {
  const [state, setState] = useState<CallState | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [consent, setConsent] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lastCall, setLastCall] = useState<string | null>(null);
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

  // Hang up if the user navigates away mid-call.
  useEffect(() => () => void session.current?.end("page_closed"), []);

  async function startCall() {
    setError(null);
    setEntries([]);
    setElapsed(0);
    setMuted(false);
    setLastCall(null);
    const s = new VoiceSession({
      agentId: agent.id,
      recordingConsent: consent,
      onState: setState,
      onTranscript: setEntries,
      onError: (m) => {
        setError(m);
        Sentry.captureMessage(`Voice call error: ${m}`, { level: "warning", tags: { area: "voice.client" } });
      },
      onEnded: ({ conversationId }) => setLastCall(conversationId),
      uploadRecording: async (conversationId, blob) => {
        // Straight to the recordings bucket; the audio never passes through our server.
        const contentType = blob.type || "audio/webm";
        const url = await rpc("conversations.recordingUploadUrl", { conversationId, contentType });
        const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
        if (!res.ok) throw new Error(`Recording upload failed (${res.status})`);
        await rpc("conversations.attachRecording", { conversationId });
      },
    });
    session.current = s;
    setState("connecting");
    await s.start();
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <Card className="h-[560px] gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between border-b border px-5 py-3">
        <div>
          <div className="text-sm font-medium">Test call</div>
          <div className="text-xs text-muted-foreground">Talk to {agent.name} from your browser</div>
        </div>
        {live && <div className="font-mono text-sm tabular-nums text-muted-foreground">{mm}:{ss}</div>}
      </div>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {entries.length === 0 && !live && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Phone className="mb-3 h-8 w-8 text-illustration" />
            Start a call and speak naturally. Interrupt the agent any time; it stops and listens.
          </div>
        )}
        {entries.map((e) =>
          e.role === "system" ? (
            <div key={e.id} className="text-center text-xs text-muted-foreground">{e.text}</div>
          ) : (
            <div key={e.id} className={cn("flex", e.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                  e.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  e.interim && "opacity-60",
                )}
              >
                {e.text}
                {e.interrupted && <span className="ml-1 text-xs opacity-70">(interrupted)</span>}
              </div>
            </div>
          ),
        )}
      </div>

      <div className="space-y-3 border-t border px-5 py-4">
        <ErrorNote message={error} />
        {live ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  state === "listening" && "animate-pulse bg-success",
                  state === "speaking" && "bg-primary",
                  state === "thinking" && "animate-pulse bg-warning",
                  state === "connecting" && "bg-illustration",
                )}
              />
              {muted ? "Muted" : STATE_LABEL[state!]}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  session.current?.setMuted(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {muted ? "Unmute" : "Mute"}
              </Button>
              <Button className="bg-destructive text-white hover:bg-destructive/90" onClick={() => session.current?.hangUp()}>
                <PhoneOff /> Hang Up
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {agent.behavior.recordCalls ? (
              <div className="flex items-center gap-2">
                <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                <Label htmlFor="consent" className="font-normal text-muted-foreground-foreground">I consent to this call being recorded</Label>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Recording is off for this agent.</span>
            )}
            <div className="flex items-center gap-3">
              {lastCall && (
                <Link href={`/conversations/${lastCall}`} className="text-sm text-primary hover:underline">
                  View transcript & summary
                </Link>
              )}
              <Button className="h-10 px-4" onClick={startCall} disabled={agent.status === "paused"}>
                <Phone /> {lastCall ? "Call Again" : "Start Call"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
