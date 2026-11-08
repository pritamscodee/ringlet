"use client";

import { Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AsciiWave } from "./ascii-wave";

type Line = { role: "agent" | "caller" | "tool"; text: string; interrupted?: boolean };
type Phase = "speaking" | "listening" | "thinking";

/**
 * A scripted demo call showing the thing Ringlet is built for: the caller
 * talks over the agent, the agent stops mid-sentence and answers the new
 * question. Depicted UI, so it carries its own simple timing.
 */
const SCRIPT: { at: number; line?: Line; type?: string; phase: Phase; cut?: boolean }[] = [
  { at: 0, phase: "speaking", type: "Hi, thanks for calling Northside Dental. We're open Monday to Friday from eight to six, and on Saturdays we also" },
  { at: 4200, phase: "listening", cut: true, line: { role: "caller", text: "Sorry, can I book a cleaning for Tuesday?" } },
  { at: 6200, phase: "thinking" },
  { at: 6800, phase: "speaking", type: "Of course. I have Tuesday at ten or at two. Which works better?" },
  { at: 10400, phase: "listening", line: { role: "caller", text: "Two, please. It's Maya Chen." } },
  { at: 12000, phase: "thinking", line: { role: "tool", text: "book_appointment · Maya Chen · Tue 2:00 pm · cleaning" } },
  { at: 12900, phase: "speaking", type: "Done, Maya. You're booked for Tuesday at two. See you then!" },
];
const LOOP_MS = 18500;

const FINAL: Line[] = [
  { role: "agent", text: "Hi, thanks for calling Northside Dental. We're open Monday to Friday from eight to six, and on Saturdays we also", interrupted: true },
  { role: "caller", text: "Sorry, can I book a cleaning for Tuesday?" },
  { role: "agent", text: "Of course. I have Tuesday at ten or at two. Which works better?" },
  { role: "caller", text: "Two, please. It's Maya Chen." },
  { role: "tool", text: "book_appointment · Maya Chen · Tue 2:00 pm · cleaning" },
  { role: "agent", text: "Done, Maya. You're booked for Tuesday at two. See you then!" },
];

const PHASE_LABEL: Record<Phase, string> = {
  speaking: "Agent speaking",
  listening: "Listening",
  thinking: "Thinking…",
};

export function LiveCallDemo() {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>(FINAL);
  const [phase, setPhase] = useState<Phase>("listening");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timers: ReturnType<typeof setTimeout>[] = [];
    let typing: ReturnType<typeof setInterval> | null = null;
    let clock: ReturnType<typeof setInterval> | null = null;
    let running = false;

    const stop = () => {
      timers.forEach(clearTimeout);
      timers = [];
      if (typing) clearInterval(typing);
      if (clock) clearInterval(clock);
      typing = clock = null;
      running = false;
    };

    const play = () => {
      stop();
      running = true;
      setLines([]);
      setSeconds(0);
      const started = Date.now();
      clock = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
      for (const step of SCRIPT) {
        timers.push(
          setTimeout(() => {
            setPhase(step.phase);
            if (step.cut) {
              if (typing) clearInterval(typing);
              setLines((ls) => ls.map((l, i) => (i === ls.length - 1 && l.role === "agent" ? { ...l, interrupted: true } : l)));
            }
            if (step.line) setLines((ls) => [...ls, step.line!]);
            if (step.type) {
              const words = step.type.split(" ");
              let n = 0;
              setLines((ls) => [...ls, { role: "agent", text: "" }]);
              if (typing) clearInterval(typing);
              typing = setInterval(() => {
                n++;
                setLines((ls) => {
                  const copy = [...ls];
                  copy[copy.length - 1] = { role: "agent", text: words.slice(0, n).join(" ") };
                  return copy;
                });
                if (n >= words.length && typing) {
                  clearInterval(typing);
                  typing = null;
                }
              }, 150);
            }
          }, step.at),
        );
      }
      timers.push(setTimeout(play, LOOP_MS));
    };

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) play();
      if (!entry.isIntersecting && running) stop();
    }, { threshold: 0.35 });
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div ref={root} className="rounded-2xl bg-card p-2 shadow-surface">
      {/* inner radius 8px + 8px padding = 16px outer */}
      <div className="overflow-hidden rounded-lg bg-background-lighter">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm">
            <span
              className={cn(
                "size-2 rounded-full transition-[background-color] duration-150",
                phase === "speaking" && "bg-primary",
                phase === "listening" && "bg-success",
                phase === "thinking" && "bg-warning",
              )}
            />
            <span className="font-medium">AI Receptionist</span>
            <span className="text-muted-foreground">{PHASE_LABEL[phase]}</span>
          </div>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            00:{String(seconds).padStart(2, "0")}
          </span>
        </div>

        <AsciiWave
          columns={72}
          rows={5}
          energy={phase === "speaking" ? 1 : phase === "listening" ? 0.45 : 0.08}
          className={cn(
            "overflow-hidden border-b px-4 py-3 font-mono text-[10px] leading-[12px] transition-[color] duration-150",
            phase === "speaking" ? "text-primary" : "text-illustration",
          )}
        />

        <div ref={scroller} className="h-[300px] space-y-2.5 overflow-y-auto overscroll-contain px-4 py-4" aria-live="off">
          {lines.map((l, i) =>
            l.role === "tool" ? (
              <div key={i} className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                <Wrench className="size-3.5 shrink-0" strokeWidth={1.5} />
                {l.text}
              </div>
            ) : (
              <div key={i} className={cn("flex", l.role === "caller" ? "justify-end" : "justify-start")}>
                <p
                  className={cn(
                    "max-w-[85%] rounded-xl px-3.5 py-2 text-sm leading-5",
                    l.role === "caller" ? "bg-foreground text-background" : "bg-card text-foreground shadow-surface",
                  )}
                >
                  {l.text || " "}
                  {l.interrupted && (
                    <span className="ml-1.5 rounded-sm bg-accent px-1 font-mono text-[11px] text-primary">interrupted</span>
                  )}
                </p>
              </div>
            ),
          )}
        </div>

        <div className="grid grid-cols-3 border-t font-mono text-xs">
          {[
            ["Language", "English"],
            ["Interruptions", "Handled"],
            ["Captured", "1 booking"],
          ].map(([k, v]) => (
            <div key={k} className="border-r px-4 py-2.5 last:border-r-0">
              <div className="text-muted-foreground">{k}</div>
              <div className="truncate">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
