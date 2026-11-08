import { cn } from "@/lib/utils";

/** Ringlet wordmark: a small waveform in heat orange. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-medium tracking-tight", className)}>
      <svg viewBox="0 0 20 20" className="size-5 text-primary" aria-hidden="true">
        {[3, 7, 11, 15].map((x, i) => (
          <rect key={x} x={x} y={[7, 3, 5, 8][i]} width="2.4" height={[6, 14, 10, 4][i]} rx="1.2" fill="currentColor" />
        ))}
      </svg>
      Ringlet
    </span>
  );
}
