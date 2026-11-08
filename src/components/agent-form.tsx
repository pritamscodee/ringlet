"use client";

import { Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import type { Doc } from "../../convex/_generated/dataModel";
import {
  BUILTIN_TOOLS,
  DEFAULT_BEHAVIOR,
  getTemplate,
  LANGUAGES,
  MODELS,
  VOICES,
  type AgentTemplate,
} from "@/lib/shared/templates";
import { cn } from "@/lib/utils";
import { ErrorNote } from "./app-ui";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Separator } from "./ui/separator";
import { Textarea } from "./ui/textarea";

export type AgentDraft = Omit<Doc<"agents">, "_id" | "_creationTime" | "workspaceId" | "status" | "updatedAt">;

export function draftFromTemplate(t: AgentTemplate): AgentDraft {
  return {
    name: t.id === "blank" ? "New agent" : t.name,
    useCase: t.id,
    personality: t.personality,
    instructions: t.instructions,
    systemPrompt: "",
    greeting: t.greeting,
    voice: t.voice,
    language: "en",
    model: MODELS[0].id,
    behavior: { ...DEFAULT_BEHAVIOR },
    builtinTools: [...t.tools],
    customTools: [],
    knowledge: [],
  };
}

export function draftFromAgent(a: Doc<"agents">): AgentDraft {
  const { _id, _creationTime, workspaceId, status, updatedAt, ...rest } = a;
  void _id; void _creationTime; void workspaceId; void status; void updatedAt;
  return rest;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({ id, checked, onChange, title, body }: { id: string; checked: boolean; onChange: (v: boolean) => void; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <Label htmlFor={id} className="flex-col items-start gap-0.5 font-normal">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{body}</span>
      </Label>
    </div>
  );
}

export function AgentForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  initial: AgentDraft;
  submitLabel: string;
  busy: boolean;
  error?: string | null;
  onSubmit: (draft: AgentDraft) => void;
}) {
  const [d, setD] = useState<AgentDraft>(initial);
  const set = <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setB = <K extends keyof AgentDraft["behavior"]>(k: K, v: AgentDraft["behavior"][K]) =>
    setD((x) => ({ ...x, behavior: { ...x.behavior, [k]: v } }));
  const template = getTemplate(d.useCase);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(d);
      }}
    >
      <Section title="Identity" description={`Based on the ${template.name} template.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Agent name" htmlFor="name">
            <Input id="name" required value={d.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Personality" htmlFor="personality">
            <Input id="personality" value={d.personality} onChange={(e) => set("personality", e.target.value)} />
          </Field>
        </div>
        <Field label="Greeting" htmlFor="greeting" hint="The first thing the agent says when a call connects.">
          <Input id="greeting" value={d.greeting} onChange={(e) => set("greeting", e.target.value)} />
        </Field>
      </Section>

      <Section title="Instructions" description="What the agent should do on calls.">
        <Field label="Job description" htmlFor="instructions">
          <Textarea id="instructions" className="min-h-40 font-mono text-[13px]" value={d.instructions} onChange={(e) => set("instructions", e.target.value)} />
        </Field>
        <Field
          label="Extra system prompt (optional)"
          htmlFor="systemPrompt"
          hint="Added after the built-in voice rules: short replies, no markdown, one question at a time."
        >
          <Textarea
            id="systemPrompt"
            className="min-h-20 font-mono text-[13px]"
            value={d.systemPrompt}
            placeholder="Hard rules, compliance wording, things never to say…"
            onChange={(e) => set("systemPrompt", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Voice & Language">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Voice">
            <NativeSelect className="w-full" value={d.voice} onChange={(e) => set("voice", e.target.value)}>
              {VOICES.map((v) => <NativeSelectOption key={v.id} value={v.id}>{v.label}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field label="Caller language">
            <NativeSelect className="w-full" value={d.language} onChange={(e) => set("language", e.target.value)}>
              {LANGUAGES.map((l) => <NativeSelectOption key={l.id} value={l.id}>{l.label}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field label="Model">
            <NativeSelect className="w-full" value={d.model} onChange={(e) => set("model", e.target.value)}>
              {MODELS.map((m) => <NativeSelectOption key={m.id} value={m.id}>{m.label}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        </div>
      </Section>

      <Section title="Conversation Behavior">
        <Toggle
          id="interrupt"
          checked={d.behavior.allowInterruptions}
          onChange={(v) => setB("allowInterruptions", v)}
          title="Allow interruptions (barge-in)"
          body="Stop talking as soon as the caller speaks."
        />
        <Toggle
          id="record"
          checked={d.behavior.recordCalls}
          onChange={(v) => setB("recordCalls", v)}
          title="Record calls"
          body="Only when the caller consents at the start of the call."
        />
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="End-of-speech wait" hint="ms of silence before replying">
            <Input type="number" min={10} max={5000} step={10} value={d.behavior.endpointingMs} onChange={(e) => setB("endpointingMs", Number(e.target.value))} />
          </Field>
          <Field label="Silence timeout" hint="seconds">
            <Input type="number" min={5} max={300} value={d.behavior.silenceTimeoutSec} onChange={(e) => setB("silenceTimeoutSec", Number(e.target.value))} />
          </Field>
          <Field label="Max call length" hint="seconds">
            <Input type="number" min={30} max={3600} value={d.behavior.maxCallSec} onChange={(e) => setB("maxCallSec", Number(e.target.value))} />
          </Field>
          <Field label="Creativity" hint="0 = strict, 1 = creative">
            <Input type="number" min={0} max={1} step={0.1} value={d.behavior.temperature} onChange={(e) => setB("temperature", Number(e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Tools" description="Actions the agent can take during a call. Results appear in Leads & Bookings.">
        <div className="grid gap-2 sm:grid-cols-2">
          {BUILTIN_TOOLS.map((t) => {
            const on = d.builtinTools.includes(t.id);
            return (
              <Label
                key={t.id}
                htmlFor={`tool-${t.id}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal transition-colors",
                  on ? "border-primary/40 bg-accent" : "hover:bg-muted",
                )}
              >
                <Checkbox
                  id={`tool-${t.id}`}
                  checked={on}
                  className="mt-0.5"
                  onCheckedChange={(v) =>
                    set("builtinTools", v === true ? [...d.builtinTools, t.id] : d.builtinTools.filter((x) => x !== t.id))
                  }
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{t.label}</span>
                  <span className="text-muted-foreground">{t.description}</span>
                </span>
              </Label>
            );
          })}
        </div>

        <Separator />
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Custom webhook tools</div>
            <p className="text-xs text-muted-foreground">The agent sends JSON to your HTTPS endpoint, for example to check a CRM or create an order.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set("customTools", [...d.customTools, { name: "", description: "", url: "https://", method: "POST" }])}
          >
            <Plus /> Add Tool
          </Button>
        </div>
        <div className="space-y-3">
          {d.customTools.map((t, i) => {
            const update = (patch: Partial<typeof t>) => set("customTools", d.customTools.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_2fr_auto]">
                <Input placeholder="check_order_status" value={t.name} onChange={(e) => update({ name: e.target.value })} />
                <Input placeholder="https://api.example.com/orders/lookup" value={t.url} onChange={(e) => update({ url: e.target.value })} />
                <div className="flex gap-2">
                  <NativeSelect value={t.method} onChange={(e) => update({ method: e.target.value as "POST" | "GET" })}>
                    <NativeSelectOption>POST</NativeSelectOption>
                    <NativeSelectOption>GET</NativeSelectOption>
                  </NativeSelect>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove tool" onClick={() => set("customTools", d.customTools.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  className="sm:col-span-3"
                  placeholder="When to use it and which fields to send, e.g. 'Look up an order. Send {order_number}.'"
                  value={t.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Knowledge Sources" description="FAQs, hours, prices, policies or listings the agent can answer from.">
        {d.knowledge.map((k, i) => {
          const update = (patch: Partial<typeof k>) => set("knowledge", d.knowledge.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex gap-2">
                <Input placeholder="Opening hours" value={k.title} onChange={(e) => update({ title: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove source" onClick={() => set("knowledge", d.knowledge.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
              <Textarea className="min-h-28" placeholder="Paste text…" value={k.content} onChange={(e) => update({ content: e.target.value })} />
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => set("knowledge", [...d.knowledge, { title: "", content: "" }])}>
            <Plus /> Add Text Source
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <Upload /> Upload .txt / .md
              <input
                type="file"
                accept=".txt,.md,.csv,text/plain,text/markdown"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const content = await file.text();
                  set("knowledge", [...d.knowledge, { title: file.name, content }]);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
        </div>
        {d.knowledge.length > 0 && !d.builtinTools.includes("search_knowledge") && (
          <p className="text-xs text-muted-foreground">Small sources go to the agent directly. For large ones, turn on the Search knowledge tool.</p>
        )}
      </Section>

      <ErrorNote message={error} />
      <div className="sticky bottom-0 -mx-1 flex justify-end bg-gradient-to-t from-background via-background px-1 py-4">
        <Button className="h-10 px-4" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
