"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = " .:-=+*#%@";

/**
 * An ASCII voice waveform, the page's one decorative flourish. It runs at
 * ~85ms a frame only while on screen and holds a still frame under reduced
 * motion.
 */
export function AsciiWave({
  columns = 64,
  rows = 7,
  energy = 1,
  className,
}: {
  columns?: number;
  rows?: number;
  /** 0 = flat line, 1 = full speech. */
  energy?: number;
  className?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const [t, setT] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !timer) timer = setInterval(() => setT((x) => x + 1), 85);
      if (!entry.isIntersecting && timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
    };
  }, []);

  const lines: string[] = [];
  const mid = (rows - 1) / 2;
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < columns; c++) {
      const x = c / columns;
      const envelope = Math.sin(Math.PI * x) ** 1.5;
      const amp =
        energy *
        envelope *
        (0.55 * Math.abs(Math.sin(c * 0.45 + t * 0.6)) + 0.45 * Math.abs(Math.sin(c * 0.13 - t * 0.35)));
      const height = amp * mid;
      const dist = Math.abs(r - mid);
      const v = Math.max(0, Math.min(1, height - dist + 1));
      line += dist < 0.01 && v === 0 ? "-" : GLYPHS[Math.round(v * (GLYPHS.length - 1))];
    }
    lines.push(line);
  }

  return (
    <pre ref={ref} aria-hidden="true" className={className}>
      {lines.join("\n")}
    </pre>
  );
}
