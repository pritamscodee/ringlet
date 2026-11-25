"use client";

import { useRpcMutation } from "@/lib/rpc";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AgentForm, draftFromTemplate } from "@/components/agent-form";
import { errorText, PageHeader } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/workspace";
import { TEMPLATES, type AgentTemplate } from "@/lib/shared/templates";
import { cn } from "@/lib/utils";

export default function NewAgentPage() {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const create = useRpcMutation("agents.create", {
    onSuccess: (id) => router.push(`/agents/${id}?call=1`),
  });

  if (!template) {
    return (
      <>
        <PageHeader title="New Agent" description="Pick what this agent is for. You can change everything afterwards." />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => setTemplate(t)} className="rounded-xl text-left">
              <Card className={cn("h-full transition-colors hover:border-primary/50 hover:bg-accent/40", t.id === "blank" && "border-dashed")}>
                <CardHeader>
                  <div className="font-mono text-xs uppercase tracking-wide text-primary">{t.category}</div>
                  <CardTitle>{t.name}</CardTitle>
                  <CardDescription>{t.description}</CardDescription>
                </CardHeader>
              </Card>
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`New ${template.name}`}
        actions={<Button variant="outline" onClick={() => setTemplate(null)}>Change Template</Button>}
      />
      <AgentForm
        key={template.id}
        initial={draftFromTemplate(template)}
        submitLabel="Create Agent"
        busy={create.isPending}
        error={create.error ? errorText(create.error) : null}
        onSubmit={(draft) => create.mutate({ workspaceId, ...draft })}
      />
    </>
  );
}
