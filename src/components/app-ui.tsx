import type { LucideIcon } from "lucide-react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl leading-8 font-medium tracking-[-0.24px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{label}</span>
          {Icon && <Icon className="size-4" />}
        </div>
        <div
          className={cn(
            "mt-2 font-mono text-2xl font-medium tabular-nums",
            tone === "good" && "text-success",
            tone === "bad" && "text-destructive",
            tone === "warn" && "text-warning",
          )}
        >
          {value}
        </div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-10 text-center">
        <div className="rounded-full bg-accent p-3 text-primary">
          <Icon className="size-5" />
        </div>
        <h3 className="mt-4 font-medium">{title}</h3>
        {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
        {action && <div className="mt-5">{action}</div>}
      </CardContent>
    </Card>
  );
}

const TONE: Record<string, string> = {
  good: "border-success/25 bg-success/10 text-success",
  live: "border-primary/25 bg-accent text-primary",
  warn: "border-warning/25 bg-warning/10 text-warning",
  bad: "border-destructive/25 bg-destructive/10 text-destructive",
  idle: "border-border bg-muted text-muted-foreground",
};

const STATUS_TONE: Record<string, keyof typeof TONE> = {
  live: "good",
  completed: "good",
  paid: "good",
  activated: "good",
  active: "live",
  awaiting_payment: "warn",
  verifying: "warn",
  input_required: "warn",
  failed: "bad",
  hold: "bad",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize", TONE[STATUS_TONE[status] ?? "idle"])}>
      {status === "active" && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function ErrorNote({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function Loading() {
  return <div className="text-sm text-muted-foreground">Loading…</div>;
}

export function formatDuration(sec?: number | null) {
  if (!sec && sec !== 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

export function formatMinutes(sec: number) {
  return `${Math.floor(sec / 60).toLocaleString()} min`;
}

export function timeAgo(ms?: number | null) {
  if (!ms) return "never";
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function ms(v?: number | null) {
  return v ? `${v.toLocaleString()} ms` : "—";
}

export function errorText(e: unknown) {
  if (e && typeof e === "object" && "data" in e && typeof (e as { data: unknown }).data === "string") {
    return (e as { data: string }).data;
  }
  return e instanceof Error
    ? e.message.replace(/^\[CONVEX[^\]]*\]\s*/, "").replace(/Uncaught ConvexError:\s*/, "").split("\n")[0]
    : "Something went wrong";
}

/** A label/value row used in detail cards. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{children}</dd>
    </div>
  );
}
