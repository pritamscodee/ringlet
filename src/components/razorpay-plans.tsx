"use client";

import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ErrorNote, errorText, formatMinutes, StatusBadge } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CheckoutResponse = {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
};

type RazorpayCtor = new (options: Record<string, unknown>) => {
  open(): void;
  on(event: string, cb: (e: { error?: { description?: string } }) => void): void;
};

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let scriptPromise: Promise<RazorpayCtor> | null = null;

function loadCheckout(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Checkout failed to load")));
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Couldn't load Razorpay Checkout. Check your connection and try again."));
    };
    document.body.appendChild(s);
  });
  return scriptPromise;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const date = (ms?: number) => (ms ? new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Monthly INR plans for customers in India, paid through Razorpay. */
export function RazorpayPlans({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const { data } = useQuery(convexQuery(api.subscriptions.overview, { workspaceId }));
  const subscribe = useConvexAction(api.razorpay.subscribe);
  const confirm = useConvexAction(api.razorpay.confirmCheckout);
  const cancel = useMutation({ mutationFn: useConvexAction(api.razorpay.cancel) });
  const refresh = useMutation({ mutationFn: useConvexAction(api.razorpay.refresh) });

  const checkout = useMutation({
    mutationFn: async (planId: string) => {
      const [Razorpay, session] = await Promise.all([loadCheckout(), subscribe({ workspaceId, planId })]);
      await new Promise<void>((resolve, reject) => {
        const rzp = new Razorpay({
          key: session.keyId,
          subscription_id: session.subscriptionId,
          name: "Ringlet",
          description: session.description,
          prefill: session.prefill,
          theme: { color: "#000000" },
          handler: (r: CheckoutResponse) => {
            confirm({
              workspaceId,
              paymentId: r.razorpay_payment_id,
              subscriptionId: r.razorpay_subscription_id,
              signature: r.razorpay_signature,
            }).then(() => resolve(), reject);
          },
          // Closing Checkout isn't an error; the unpaid subscription is
          // replaced next time a plan is picked.
          modal: { ondismiss: () => resolve() },
        });
        rzp.on("payment.failed", (e) => reject(new Error(e.error?.description ?? "Payment failed")));
        rzp.open();
      });
    },
  });

  if (!data) return null;
  const sub = data.subscription;
  const active = !!data.activePlanId && !!sub && ["active", "pending"].includes(sub.status);
  const activePlan = data.plans.find((p) => p.id === data.activePlanId);
  const busy = checkout.isPending || cancel.isPending;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">India: monthly plans</h2>
        <p className="text-sm text-muted-foreground">
          Pay in rupees by UPI Autopay, card or netbanking. Renews monthly, cancel any time. Prices include GST. Unused
          minutes roll over for one month.
        </p>
      </div>

      {!data.razorpayConfigured && (
        <p className="text-sm text-muted-foreground">Rupee plans aren&apos;t available right now.</p>
      )}

      {sub && sub.status !== "created" && (
        <Card className="gap-3">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                {data.plans.find((p) => p.id === sub.planId)?.name ?? sub.planId} plan <StatusBadge status={sub.status} />
              </CardTitle>
              <CardDescription>
                {sub.status === "pending" && "Your last renewal payment failed. Razorpay will retry it automatically. "}
                {sub.status === "halted" && "Renewal payments failed, so the plan is paused. Pick a plan again to restart. "}
                {sub.cancelAtCycleEnd && sub.currentEnd
                  ? `Cancelled. Plan features stay on until ${date(sub.currentEnd)}.`
                  : sub.currentEnd && active
                    ? `Renews on ${date(sub.currentEnd)}.`
                    : null}
              </CardDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate({ workspaceId })}>
                <RefreshCw className={cn(refresh.isPending && "animate-spin")} /> Refresh
              </Button>
              {data.canManage && active && !sub.cancelAtCycleEnd && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Cancel your plan? It stays active until the end of the month you've paid for.")) {
                      cancel.mutate({ workspaceId });
                    }
                  }}
                >
                  {cancel.isPending ? "Cancelling…" : "Cancel Plan"}
                </Button>
              )}
            </div>
          </CardHeader>
          {data.payments.length > 0 && (
            <CardContent>
              <ul className="divide-y text-sm">
                {data.payments.map((p) => (
                  <li key={p._id} className="flex justify-between py-1.5">
                    <span className="text-muted-foreground">
                      {date(p._creationTime)} · {data.plans.find((x) => x.id === p.planId)?.name}
                      {p.method ? ` · ${p.method.toUpperCase()}` : ""}
                    </span>
                    <span className="font-mono tabular-nums">
                      {inr(p.amountPaise / 100)} · +{formatMinutes(p.creditSeconds)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {data.plans.map((p) => {
          const current = active && activePlan?.id === p.id;
          return (
            <Card key={p.id} className={cn(current && "border-primary/50")}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {p.name}
                  {p.id === "in_growth" && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-normal text-primary">Most Popular</span>}
                </CardTitle>
                <div className="font-mono text-2xl font-medium">
                  {inr(p.priceInr)}<span className="text-sm text-muted-foreground">/month</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {p.minutes} min · ₹{(p.priceInr / p.minutes).toFixed(2)}/min
                </div>
                <CardDescription>{p.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-1 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /> {f}</li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={p.id === "in_growth" ? "default" : "outline"}
                  disabled={!data.canManage || !data.razorpayConfigured || busy || (active && !sub?.cancelAtCycleEnd)}
                  onClick={() => checkout.mutate(p.id)}
                >
                  {current
                    ? "Current Plan"
                    : checkout.isPending && checkout.variables === p.id
                      ? "Opening checkout…"
                      : `Subscribe to ${p.name}`}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
      {active && !sub?.cancelAtCycleEnd && data.canManage && (
        <p className="text-sm text-muted-foreground">To switch plans, cancel your current plan first, then pick a new one.</p>
      )}
      <ErrorNote
        message={
          checkout.error ? errorText(checkout.error) : cancel.error ? errorText(cancel.error) : refresh.error ? errorText(refresh.error) : null
        }
      />
    </section>
  );
}
