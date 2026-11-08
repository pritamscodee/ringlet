"use client";

import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { ErrorNote, errorText } from "@/components/app-ui";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rememberWorkspace } from "@/components/workspace";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: useConvexMutation(api.workspaces.create),
    onSuccess: (id) => {
      rememberWorkspace(id as string);
      router.push("/agents/new");
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <Card>
          <CardHeader>
            <CardTitle>Create Your Workspace</CardTitle>
            <CardDescription>
              A workspace holds your agents, calls and billing. It starts with 15 free minutes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate({ name });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">Company or team name</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Dental" />
              </div>
              <ErrorNote message={create.error ? errorText(create.error) : null} />
              <Button className="h-10 w-full" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create Workspace"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
