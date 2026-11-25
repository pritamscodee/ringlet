"use client";

import { rpcQuery } from "@/lib/rpc";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Wrench } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ErrorNote, errorText, formatDuration, Loading, ms, PageHeader, Row, StatusBadge } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useQuery(rpcQuery("conversations.get", { conversationId: id }));

  if (error) return <ErrorNote message={errorText(error)} />;
  if (!data) return <Loading />;
  const { conversation: c, messages, captures, recordingUrl } = data;

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground" asChild>
        <Link href="/conversations"><ArrowLeft /> Conversations</Link>
      </Button>
      <PageHeader
        title={`Call with ${c.agentName}`}
        description={new Date(c.startedAt).toLocaleString()}
        actions={<StatusBadge status={c.status} />}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {(c.summary || c.failureReason) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  Summary {c.outcome && <Badge variant="outline">{c.outcome.replace(/_/g, " ")}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {c.summary && <p className="text-muted-foreground">{c.summary}</p>}
                {c.failureReason && <p className="text-destructive">Failure: {c.failureReason}</p>}
              </CardContent>
            </Card>
          )}
          {recordingUrl && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Recording</CardTitle></CardHeader>
              <CardContent><audio controls src={recordingUrl} className="w-full" /></CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Transcript {c.status === "active" && <span className="text-xs font-normal text-primary">(live)</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {messages.map((m) =>
                  m.role === "tool" ? (
                    <li key={m.id} className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                      <Wrench className="mt-0.5 size-3.5 shrink-0" />
                      <span><span className="font-medium text-foreground">{m.toolName}</span> {m.text}</span>
                    </li>
                  ) : (
                    <li key={m.id} className="flex gap-3 text-sm">
                      <span className="w-12 shrink-0 pt-0.5 text-right font-mono text-xs text-muted-foreground">
                        {formatDuration(Math.max(0, Math.round((m.at - c.startedAt) / 1000)))}
                      </span>
                      <div>
                        <div className={cn("text-xs font-medium", m.role === "user" ? "text-primary" : "text-muted-foreground")}>
                          {m.role === "user" ? "Caller" : c.agentName}
                        </div>
                        <p>
                          {m.text}
                          {m.interrupted && <span className="ml-1 text-xs text-warning">(interrupted)</span>}
                        </p>
                      </div>
                    </li>
                  ),
                )}
                {!messages.length && <li className="text-sm text-muted-foreground">No messages.</li>}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2">
                <Row label="Duration">{formatDuration(c.durationSec)}</Row>
                <Row label="Ended by">{c.endReason?.replace(/_/g, " ") ?? "—"}</Row>
                <Row label="Turns">{c.metrics?.turns ?? "—"}</Row>
                <Row label="Interruptions">{c.metrics?.interruptions ?? "—"}</Row>
                <Row label="Recording consent">{c.recordingConsent ? "Yes" : "No"}</Row>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Latency (Average)</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2">
                <Row label="Speech recognition">{ms(c.metrics?.sttLatencyMs)}</Row>
                <Row label="LLM first token">{ms(c.metrics?.llmFirstTokenMs)}</Row>
                <Row label="TTS first byte">{ms(c.metrics?.ttsFirstByteMs)}</Row>
                <Row label="Voice-to-voice">{ms(c.metrics?.responseLatencyMs)}</Row>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Usage</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2">
                <Row label="Input tokens">{c.usage.inputTokens.toLocaleString()}</Row>
                <Row label="Output tokens">{c.usage.outputTokens.toLocaleString()}</Row>
                <Row label="TTS characters">{c.usage.ttsCharacters.toLocaleString()}</Row>
              </dl>
            </CardContent>
          </Card>
          {captures.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Captured</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {captures.map((cap) => (
                    <li key={cap.id} className="space-y-1">
                      <Badge variant="outline" className="capitalize">{cap.kind}</Badge>
                      <dl className="space-y-0.5 text-xs">
                        {Object.entries(cap.data).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="break-words">{String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
