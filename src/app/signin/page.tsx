"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNote } from "@/components/app-ui";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const { error } =
      flow === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: email.split("@")[0] });
    setBusy(false);
    if (error) {
      setError(
        flow === "signIn"
          ? "Wrong email or password. Check both and try again."
          : "Account not created. Use at least 8 characters, or sign in if the email is already registered.",
      );
      return;
    }
    router.push(flow === "signUp" ? "/onboarding" : "/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <Card>
          <CardHeader>
            <CardTitle>{flow === "signIn" ? "Sign In" : "Create Account"}</CardTitle>
            <CardDescription>AI voice agents for sales, front desk and support.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                />
              </div>
              <ErrorNote message={error} />
              <Button type="submit" disabled={busy} className="h-10 w-full">
                {busy ? "Signing in…" : flow === "signIn" ? "Sign In" : "Create Account"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {flow === "signIn" ? "New to Ringlet?" : "Already have an account?"}{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
                >
                  {flow === "signIn" ? "Create an account" : "Sign in"}
                </Button>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
