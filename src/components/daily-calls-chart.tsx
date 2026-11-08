"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

type Day = { day: string; calls: number; failed: number; minutes: number };

const OK = "#2a6dfb";
const FAIL = "#fa5d19";

function label(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Calls per day, split into completed and failed. Hover a bar for details. */
export function DailyCallsChart({ series }: { series: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((d) => d.calls));
  const h = 160;
  const tick = Math.ceil(max / 2);

  return (
    <Card>
      <CardContent>
      <figure>
      <div className="mb-4 flex items-center justify-between">
        <figcaption className="text-sm font-medium">Calls per day</figcaption>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OK }} /> Completed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FAIL }} /> Failed
          </span>
        </div>
      </div>

      <div className="relative flex gap-3">
        <div className="flex flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground" style={{ height: h }}>
          <span>{tick * 2}</span>
          <span>{tick}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1">
          {/* recessive gridlines */}
          {[0, 0.5, 1].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-border/60" style={{ top: f * h }} />
          ))}
          <div className="relative flex items-end gap-[2px]" style={{ height: h }} onMouseLeave={() => setHover(null)}>
            {series.map((d, i) => {
              const ok = d.calls - d.failed;
              const scale = h / (tick * 2);
              return (
                <div
                  key={d.day}
                  className="group relative flex h-full flex-1 flex-col justify-end"
                  onMouseEnter={() => setHover(i)}
                >
                  <div className={hover === i ? "opacity-100" : hover === null ? "opacity-100" : "opacity-60"}>
                    {ok > 0 && (
                      <div
                        className="rounded-t-[4px]"
                        style={{ height: ok * scale, background: OK }}
                      />
                    )}
                    {d.failed > 0 && (
                      <div
                        className={ok > 0 ? "mt-[2px]" : "rounded-t-[4px]"}
                        style={{ height: Math.max(2, d.failed * scale - 2), background: FAIL }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border bg-popover px-3 py-2 text-xs shadow-sm"
              style={{ left: `${((hover + 0.5) / series.length) * 100}%`, top: -8 }}
            >
              <div className="font-medium">{label(series[hover].day)}</div>
              <div className="text-muted-foreground">
                {series[hover].calls} calls · {series[hover].failed} failed · {series[hover].minutes} min
              </div>
            </div>
          )}
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{series[0] && label(series[0].day)}</span>
            <span>{series.at(-1) && label(series.at(-1)!.day)}</span>
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>Calls per day</caption>
        <thead>
          <tr><th>Day</th><th>Calls</th><th>Failed</th><th>Minutes</th></tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.day}><td>{d.day}</td><td>{d.calls}</td><td>{d.failed}</td><td>{d.minutes}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
      </CardContent>
    </Card>
  );
}
