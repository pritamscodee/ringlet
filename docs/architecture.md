# Ringlet — architecture and internal workflows

This is the single reference for Ringlet's internal diagrams. It is derived from the code in `src/`, `prisma/`, `scripts/`, `sst.config.ts` and `.github/workflows/ci.yml`, not from `docs/setup.md` (see [Documentation drift](#documentation-drift)).

The runtime is a Next.js 16 App Router application deployed with SST on AWS Lambda. The browser owns the latency-critical audio path; the server owns secrets, the agent turn, persistence and billing.

---

## 1. System context / runtime topology

Sources: `src/lib/voice/engine.ts`, `src/app/api/voice/*`, `src/server/*`, `src/mastra/*`, `sst.config.ts`.

```mermaid
flowchart LR
    subgraph Browser["Browser"]
        UI["Next.js UI<br/>dashboard, builder, call panel"]
        ENG["VoiceSession<br/>src/lib/voice/engine.ts"]
        VAD["Silero VAD<br/>on-device, ONNX"]
        PLY["PcmPlayer<br/>Web Audio clock"]
        MIC(("Microphone"))
        SPK(("Speaker"))
        MIC --> VAD --> ENG
        ENG --> PLY --> SPK
    end

    subgraph Server["Next.js server — AWS Lambda via SST"]
        AUTH["/api/auth/[...all]<br/>Better Auth"]
        RPC["/api/rpc/[method]<br/>typed RPC"]
        SES["/api/voice/session"]
        TOK["/api/voice/token"]
        RES["/api/voice/respond"]
        TTS["/api/voice/tts"]
        END["/api/voice/end"]
        SVC["Services<br/>workspaces · agents · conversations · analytics"]
        MAS["Mastra agent + tools<br/>Anthropic Claude"]
        AUTH --> SVC
        RPC --> SVC
        SES --> SVC
        RES --> SVC
        RES --> MAS
        END --> SVC
    end

    subgraph External["External services"]
        DGS["Deepgram Nova-3<br/>streaming STT"]
        DGT["Deepgram Aura-2 / agent.voice<br/>TTS"]
        LLM["Anthropic Claude"]
        HOOK["Customer HTTPS APIs<br/>custom tools"]
    end

    DB[("Neon Postgres<br/>Prisma 7")]
    S3[("S3<br/>recordings bucket")]

    UI --> AUTH
    UI --> RPC
    ENG -- "start call + consent" --> SES
    ENG -- "renew 60s grant" --> TOK
    ENG <-- "16 kHz PCM over websocket" --> DGS
    ENG -- "final utterance + signed ticket" --> RES
    RES -- "NDJSON text events" --> ENG
    ENG -- "one request per sentence" --> TTS
    TTS --> DGT
    TTS -- "streamed 24 kHz PCM" --> ENG
    ENG -- "hangup reason + metrics" --> END
    ENG -. "presigned PUT" .-> S3
    MAS --> LLM
    MAS --> HOOK
    SVC --> DB
    AUTH --> DB
    END --> LLM
```

**Boundary rule:** API keys (`DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`) and `RINGLET_SESSION_SECRET` never reach the browser. The browser holds only a 60-second Deepgram grant and a signed call ticket.

---

## 2. Data model

Source: `prisma/schema.prisma`, `prisma/migrations/20261109000000_init/migration.sql`, `src/server/schemas.ts`.

```mermaid
erDiagram
    User ||--o{ Session : has
    User ||--o{ Account : has
    User ||--o{ Membership : has
    User ||--o{ Workspace : owns
    Workspace ||--o{ Membership : has
    Workspace ||--o{ Agent : owns
    Workspace ||--o{ Conversation : owns
    Workspace ||--o{ Capture : owns
    Agent ||--o{ Conversation : handles
    Agent ||--o{ Capture : produces
    Conversation ||--o{ Message : contains
    Conversation ||--o{ Capture : produces

    Workspace {
        string id "uuid(7)"
        string name
        string ownerId "RESTRICT on delete"
        int creditSeconds "talk-time balance"
    }
    Membership {
        enum role "owner | admin | member"
    }
    Agent {
        string name
        string greeting
        string voice
        string language
        string model
        json behavior "turn-taking + recordCalls"
        string builtinTools "string array of enabled tool ids"
        json customTools
        json knowledge
        enum status "draft | live | paused"
    }
    Conversation {
        enum status "active | completed | failed"
        string agentName "snapshot survives agent delete"
        int durationSec
        string endReason
        string failureReason
        string summary
        string outcome
        json metrics "latency per stage"
        int inputTokens
        int outputTokens
        int ttsCharacters
        string recordingKey
    }
    Message {
        enum role "user | agent | tool"
        string text
        bool interrupted
        string toolName
    }
    Capture {
        enum kind "lead | appointment | message | handoff"
        json data
    }
```

`Agent` and `Conversation` use `ON DELETE SET NULL` for `agentId`: deleting an agent preserves call history because each conversation snapshots `agentName`. Everything else cascades from `Workspace`.

---

## 3. Authentication and request boundaries

Sources: `src/server/auth.ts`, `src/app/api/auth/[...all]/route.ts`, `src/proxy.ts`, `src/lib/auth-client.ts`, `src/components/workspace.tsx`.

```mermaid
flowchart TD
    Signin["/signin and /onboarding pages"] --> AuthClient["authClient.signIn.email / signUp.email"]
    AuthClient --> AuthRoute["POST /api/auth/[...all]"]
    AuthRoute --> BA["Better Auth<br/>email + password, min 8 chars"]
    BA --> Adapter["prismaAdapter(db, postgresql)"]
    Adapter --> DB[("user · session · account · verification")]
    BA --> Cookie["session cookie"]

    AnyPage["Any navigation"] --> Proxy["src/proxy.ts<br/>getSessionCookie — optimistic, no DB call"]
    Proxy -->|"no cookie, non-public path"| ToSignin["redirect /signin"]
    Proxy -->|"cookie on /signin"| ToDash["redirect /dashboard"]
    Proxy -->|"public paths"| Pass["allow: / , /signin, /monitoring, /api/*"]

    API["/api/rpc/[method] or /api/voice/*"] --> Current["currentUserId()<br/>auth.api.getSession"]
    Current -->|"no session"| U401["401 Not signed in"]
    Current --> Services["services + access checks"]

    WorkspaceProvider["WorkspaceProvider"] -->|"workspaces.mine = empty"| Onboarding["redirect /onboarding"]
    WorkspaceProvider -->|"RpcError 401"| SignOut["authClient.signOut<br/>clear stale cookie"]
```

`RINGLET_SESSION_SECRET` is **not** a login secret. It only signs short-lived call tickets (`src/lib/server/ticket.ts`).

---

## 4. Typed RPC pipeline (all dashboard reads and writes)

Sources: `src/server/rpc.ts`, `src/app/api/rpc/[method]/route.ts`, `src/lib/rpc.ts`, `src/components/providers.tsx`, `src/server/errors.ts`.

```mermaid
sequenceDiagram
    participant C as React component
    participant H as useRpcMutation / rpcQuery
    participant R as POST /api/rpc/[method]
    participant A as currentUserId
    participant Z as zod input
    participant S as Service function
    participant X as requireMember / requireAgentAccess
    participant D as Postgres

    C->>H: rpc("agents.update", input)
    H->>R: POST JSON
    R->>R: Object.hasOwn(router, method) else 404
    R->>A: get session
    A-->>R: userId else 401
    R->>Z: method.input.safeParse(body)
    Z-->>R: parsed data else 400
    R->>S: handler(userId, data)
    S->>X: membership / role check
    X->>D: findUnique membership
    D-->>X: role or 403
    X-->>S: access + workspace
    S->>D: Prisma read/write
    D-->>S: result
    S-->>R: DTO
    R-->>H: { data: result ?? null }
    H->>H: invalidateQueries(["rpc"])
    H-->>C: refreshed UI
```

Registered method families: `workspaces.*` (mine, get, create, rename, members, addMember, removeMember), `agents.*` (list, get, create, update, setStatus, remove), `conversations.*` (list, get, captures, recordingUploadUrl, attachRecording), `analytics.overview`.

Query defaults: `staleTime: 10s`, refetch on window focus, retry only for 5xx/unknown errors and fewer than 2 retries.

---

## 5. Access-control decision tree

Source: `src/server/access.ts`; UI mirror in `src/components/workspace.tsx` (`canManage`).

```mermaid
flowchart TD
    Start["Service call with userId"] --> Target{"Target type"}
    Target -->|workspaceId| M["requireMember(userId, workspaceId, roles?)"]
    Target -->|agentId| AG["requireAgentAccess:<br/>find agent → requireMember(agent.workspaceId)"]
    Target -->|conversationId| CO["requireConversationAccess:<br/>find conversation → requireMember(conversation.workspaceId)"]

    M --> Found{"Membership row?"}
    Found -->|no| E403a["403 No access to this workspace"]
    Found -->|yes| Role{"Role allowed?<br/>MANAGERS = owner, admin"}
    Role -->|no| E403b["403 Your role cannot do this"]
    Role -->|yes| OK["Return userId, membership, workspace"]

    AG --> AgentFound{"Agent exists?"}
    AgentFound -->|no| E404["404 Agent not found"]
    AgentFound -->|yes| M

    CO --> ConvFound{"Conversation exists?"}
    ConvFound -->|no| E404c["404 Conversation not found"]
    ConvFound -->|yes| M
```

Read methods accept any role. `workspaces.rename/addMember/removeMember` and all `agents.*` writes require an owner or admin.

---

## 6. Workspace and agent setup

Sources: `src/app/onboarding/page.tsx`, `src/server/services/workspaces.ts`, `src/lib/shared/templates.ts`, `src/components/agent-form.tsx`, `src/server/services/agents.ts`.

```mermaid
flowchart TD
    Signup["signup → /onboarding"] --> Create["workspaces.create({name})"]
    Create --> Tx{"$transaction:<br/>first workspace owned by user?"}
    Tx -->|yes| Trial["creditSeconds = 900<br/>15-minute trial"]
    Tx -->|no| Zero["creditSeconds = 0"]
    Trial --> Owner["nested Membership role=owner"]
    Zero --> Owner
    Owner --> Local["localStorage['ringlet.workspace'] = id"]
    Local --> Templates["/agents/new → pick one of 9 templates"]

    Templates --> Draft["draftFromTemplate:<br/>useCase, personality, instructions, greeting,<br/>voice, tools, DEFAULT_BEHAVIOR"]
    Draft --> Form["AgentForm: name, prompt, voice,<br/>knowledge docs, custom tools, behavior"]
    Form --> Validate["agents.validate"]
    Validate --> V1["name non-blank"]
    Validate --> V2["custom tool name /^[a-z][a-z0-9_]{1,40}$/"]
    Validate --> V3["custom tool URL parses + https:"]
    Validate --> V4["knowledge content sum ≤ 200,000 chars"]
    Validate --> V5["maxCallSec 30–3600<br/>endpointingMs 10–5000<br/>temperature 0–1"]
    V1 --> Persist["agents.create → status=live"]
    V2 --> Persist
    V3 --> Persist
    V4 --> Persist
    V5 --> Persist
    Persist --> Ready["/agents/{id}?call=1"]
```

Only the **first** workspace a user owns receives trial minutes. Additional workspaces start at zero and need an operator top-up via `bun run grant-minutes`.

---

## 7. Call bootstrap

Sources: `src/lib/voice/engine.ts` (`start`), `src/app/api/voice/session/route.ts`, `src/server/services/conversations.ts` (`start`), `src/lib/server/ticket.ts`, `src/lib/server/deepgram.ts`.

```mermaid
sequenceDiagram
    actor U as User
    participant P as CallPanel / demo widget
    participant E as VoiceSession.start
    participant S as POST /api/voice/session
    participant C as conversations.start
    participant D as Postgres
    participant DG as Deepgram auth

    U->>P: click Call
    P->>E: start({agentId, recordingConsent})
    E->>S: POST {agentId, recordingConsent}
    S->>S: currentUserId else 401
    S->>S: zod: agentId 1–64, consent boolean
    S->>C: start(userId, args)
    C->>C: requireAgentAccess
    C->>D: load agent + workspace
    C->>C: paused? creditSeconds < 10?
    C-->>S: 402 / paused error / start result
    C->>D: create Conversation(status=active, agentName snapshot)
    C-->>S: conversationId, agent, maxCallSec, recording
    par
        S->>DG: POST /v1/auth/grant {ttl_seconds:60}
        DG-->>S: sttToken
    and
        S->>D: addMessage(agent greeting)
    end
    S-->>E: {conversationId, ticket, sttToken,<br/>maxCallSec, recording, agent config}
    E->>E: new AudioContext + resume
    E->>E: getUserMedia (echo cancel, noise suppression, AGC, mono)
    E->>E: new PcmPlayer; optional MediaRecorder(dest of mic + agent audio)
    E->>E: openStt(sttToken) → wss Deepgram
    E->>E: startVad() → Silero v5 from /vad/
    E->>E: timers: maxCallSec timeout + 1s silence watchdog
    E->>E: speakScripted(greeting)
    Note over E,DG: maxCallSec = min(agent.behavior.maxCallSec, workspace.creditSeconds)
    Note over E,S: ticket = HMAC-SHA256 over base64url {c, v, exp}<br/>TTL = maxCallSec + 600; v = agent.voice
```

Startup failures call `onError(...)` then `end("setup_failed", message)`; the session route closes any conversation it created with the same reason.

---

## 8. Browser call state machine

Source: `src/lib/voice/engine.ts` (`setState`, `runTurn`, `bargeIn`, `onPlaybackIdle`, `end`).

```mermaid
stateDiagram-v2
    [*] --> connecting: UI mounts CallPanel
    connecting --> speaking: POST /session + greeting queued
    speaking --> listening: player idle after greeting
    listening --> thinking: final utterance committed → runTurn
    thinking --> speaking: first PCM byte of reply
    speaking --> listening: queued speech drained, no pending hangup
    thinking --> listening: runTurn error
    listening --> speaking: silence nudge "Are you still there?"
    speaking --> ended: pendingHangup after playback
    listening --> ended: caller hangup / silence timeout / max duration
    thinking --> ended: barge-in then hangup / setup or STT failure
    ended --> [*]

    note right of ended
        Reasons: max_duration, setup_failed,
        stt_disconnected, agent_ended, transferred,
        silence_timeout, caller_hung_up,
        user_hung_up, page_closed, abandoned
    end note
```

`setState` refuses to emit after `state === "ended"`.

---

## 9. Speech input: VAD, Deepgram websocket and barge-in triggers

Sources: `src/lib/voice/engine.ts` (`openStt`, `reconnectStt`, `onSttMessage`, `startVad`, `bargeIn`), `src/app/api/voice/token/route.ts`.

```mermaid
flowchart TD
    MIC(("Mic 16 kHz")) --> VAD["MicVAD v5<br/>positive 0.6 / negative 0.45<br/>redemption 600ms / minSpeech 250ms"]
    VAD -->|"onFrameProcessed"| PCM["floatTo16BitPcm"]
    PCM --> WS["wss Deepgram /v1/listen<br/>nova-3, 16kHz, mono, interim_results,<br/>smart_format, punctuate, vad_events,<br/>endpointing=agent.behavior.endpointingMs,<br/>utterance_end_ms=1000"]
    WS --> MSG{"onSttMessage"}
    MSG -->|UtteranceEnd| Commit["commitUtterance if finalBuf"]
    MSG -->|"Results + speech_final + empty text"| Commit
    MSG -->|"Results + is_final + text"| Append["finalBuf += text; show interim"]
    Append -->|speech_final| Commit
    MSG -->|interim text| Interim["update single interim transcript row"]
    Append --> BCheck{"agentAudible AND ≥2 words?"}
    VAD -->|"onSpeechRealStart while agent audible or turn active"| Barge
    BCheck -->|yes| Barge["bargeIn()"]
    Barge --> Guard{"allowInterruptions AND<br/>(turn OR player.playing)?"}
    Guard -->|no| Keep["keep playing"]
    Guard -->|yes| Actions["interruptions++ · player.stop()<br/>turn.abort.abort('turn interrupted')<br/>mark entry interrupted=true<br/>turn=null · pendingHangup=null<br/>state=listening"]
    Commit --> Turn["runTurn(text)"]
    WS -->|onclose while not ended| Reconnect{"reconnects < 3?"}
    Reconnect -->|yes| Token["POST /api/voice/token<br/>x-ringlet-ticket → fresh 60s grant"]
    Token --> WS
    Reconnect -->|no| Fail["onError + end('stt_disconnected')"]
```

Interim text updates one transcript row in place; final text clears `finalBuf` and starts a turn. Any non-empty transcript resets the silence nudge.

---

## 10. One conversational turn (end-to-end sequence)

Sources: `src/lib/voice/engine.ts` (`runTurn`, `enqueueSpeech`), `src/app/api/voice/respond/route.ts`, `src/app/api/voice/tts/route.ts`, `src/lib/voice/player.ts`.

```mermaid
sequenceDiagram
    autonumber
    actor Caller
    participant B as Browser engine
    participant STT as Deepgram STT
    participant R as /api/voice/respond
    participant A as Mastra agent + Claude
    participant DB as Postgres
    participant T as /api/voice/tts
    participant DG as Deepgram TTS
    participant P as PcmPlayer

    Caller->>B: speaks
    B->>STT: PCM frames over websocket
    STT-->>B: interim + final transcript
    B->>R: POST {conversationId, text} + x-ringlet-ticket
    R->>DB: runtimeContext: agent + last 40 messages
    R->>DB: addMessage(user text) fire-and-forget
    R->>A: stream(messages, maxSteps 4, abortSignal)
    loop each NDJSON event
        A-->>R: text-delta / tool-call / tool-result / error
        R-->>B: {t:delta|tool|action|done|error}
        B->>B: delta → live transcript + SentenceChunker
        B->>T: POST {text: sentence} per chunk, in parallel
        T->>DG: POST /v1/speak model=ticket.v, linear16, 24 kHz
        DG-->>T: PCM stream
        T-->>B: octet-stream PCM + X-Sample-Rate: 24000
        B->>P: push chunks, scheduled on Web Audio clock
        P->>Caller: gapless audio
    end
    R->>DB: recordUsage + save agent reply, even if interrupted
```

The browser starts speaking after the **first sentence**; later sentences are synthesized in parallel and played in order through `turn.chain`.

### NDJSON event contract (`RespondEvent`)

| Event | Server emits when | Browser behavior |
| --- | --- | --- |
| `{ t: "delta", text }` | model `text-delta` | Append to transcript, feed `SentenceChunker` |
| `{ t: "tool", name }` | model `tool-call` | Ignored by the engine |
| `{ t: "action", action, reason? }` | `tool-result` for `end_call` / `transfer_to_human`, not an error | Set `pendingHangup`; transfer also adds a system transcript line |
| `{ t: "done", firstTokenMs }` | after stream + usage | Ignored by the engine |
| `{ t: "error", message }` | stream error or thrown exception, unless request aborted | Throw → `onError`, state back to `listening` |

Server-side `firstTokenMs` is measured from request start; the client's `llmFirstTokenMs` is measured from VAD speech end. They are different metrics and are not interchangeable.

---

## 11. Server-side agent turn internals

Source: `src/app/api/voice/respond/route.ts`.

```mermaid
flowchart TD
    Start["POST /api/voice/respond"] --> Ticket["readTicket(x-ringlet-ticket)<br/>HMAC + expiry"]
    Ticket --> Body["zod {conversationId, text 1–4000}"]
    Body --> Match{"ticket.c === conversationId?"}
    Match -->|no| E401["401 Invalid call ticket"]
    Match -->|yes| User["currentUserId() else 401"]
    User --> Ctx["runtimeContext:<br/>membership → agent + last 40 messages"]
    Ctx --> Active{"status === active?"}
    Active -->|no| E409["409 Call already ended"]
    Active -->|yes| Save["fire-and-forget addMessage(user)<br/>AFTER context load to avoid duplication"]
    Save --> History["filter role=tool<br/>agent → assistant; prefix interrupted replies<br/>with '[cut off: the caller interrupted]'"]
    History --> Build["voiceAgentFor(agent, userId, conversationId)"]
    Build --> Stream["agent.stream: maxSteps 4,<br/>temperature from agent.behavior,<br/>maxOutputTokens 1024, thinking disabled, effort low,<br/>abortSignal = request signal"]
    Stream --> Chunk{"fullStream chunk"}
    Chunk -->|text-delta| Delta["first delta: Sentry ringlet.llm.first_token<br/>send {t:delta}"]
    Chunk -->|tool-call| Tool["send {t:tool}"]
    Chunk -->|tool-result| Result["addMessage(role=tool, text=args JSON ≤2000)<br/>control tool? → send {t:action}"]
    Chunk -->|error| Err["throw payload.error or Model error"]
    Delta --> Chunk
    Tool --> Chunk
    Result --> Chunk
    Chunk -->|done| Usage["await out.usage<br/>recordUsage(inputTokens, outputTokens,<br/>ttsCharacters = reply.length)"]
    Usage --> Done["send {t:done}"]
    Err --> Catch{"request aborted?"}
    Catch -->|no| ErrEvent["Sentry voice.agent + send {t:error}"]
    Catch -->|yes| Silent["stay silent"]
    Done --> Finally["finally: close span;<br/>await addMessage(role=agent,<br/>text=reply.trim(), interrupted=aborted)"]
    ErrEvent --> Finally
    Silent --> Finally
```

History is Postgres-backed, not Mastra memory: no `storage` or `memory` is configured. Only the latest 40 messages are replayed, and no summary is folded into the prompt.

---

## 12. Agent prompt assembly

Source: `src/mastra/index.ts` (`buildInstructions`, `voiceAgentFor`), `src/lib/shared/templates.ts`.

```mermaid
flowchart TD
    A["BASE_SYSTEM_PROMPT<br/>short replies, no markdown,<br/>one question at a time"] --> B["Your name is {agent.name}"]
    B --> C{"personality?"}
    C -->|yes| C1["Personality: ..."]
    C -->|no| D
    C1 --> D{"instructions?"}
    D -->|yes| D1["## Your job"]
    D -->|no| E
    D1 --> E{"systemPrompt?"}
    E -->|yes| E1["## Additional rules"]
    E -->|no| F
    E1 --> F{"language"}
    F -->|multi| F1["Reply in the language the caller speaks"]
    F -->|en/es/fr/de/hi/pt| F2["Always reply in {mapped name}"]
    F1 --> G["Current date and time: UTC"]
    F2 --> G
    G --> H{"knowledge.length > 0?"}
    H -->|"size ≤ 6000 chars"| H1["inline full knowledge<br/>'Only state facts found here'"]
    H -->|"size > 6000 + search_knowledge enabled"| H2["'Use search_knowledge for any factual question'"]
    H -->|"size > 6000 + tool disabled"| H3["no knowledge injected"]
    H1 --> I
    H2 --> I
    H3 --> I
    I{"book_appointment enabled?"} -->|yes| I1["Booking override:<br/>save at read-back, never wait for yes"]
    I -->|no| J
    I1 --> J{"end_call enabled?"}
    J -->|yes| J1["Say goodbye then call end_call"]
    J -->|no| K["filter(Boolean).join with blank lines → instructions"]
    J1 --> K
    K --> L["new Agent per call<br/>id=ringlet-{agentId}<br/>model=agent.model or RINGLET_DEFAULT_MODEL<br/>tools=toolsFor(...)"]
```

The greeting is **not** in the prompt. It is persisted as an `agent` message at session start and spoken by the browser via scripted TTS.

---

## 13. Tool execution and SSRF boundary

Sources: `src/mastra/tools.ts`, `src/server/services/conversations.ts` (`addCapture`), `src/server/access.ts`.

```mermaid
flowchart TD
    Call["Model emits tool-call"] --> Reg{"toolsFor(agent)"}
    Reg --> BI["Built-ins filtered by agent.builtinTools:<br/>capture_lead · book_appointment · take_message<br/>search_knowledge · transfer_to_human · end_call"]
    Reg --> CU["Custom tools merged AFTER built-ins<br/>(same name overrides built-in)"]
    BI --> Kind{"Which tool?"}
    CU --> Guard["new URL(t.url)"]
    Guard --> Check{"https: AND<br/>hostname NOT matching PRIVATE_HOST?"}
    Check -->|no| Blocked["return {error:'Tool URL is not allowed'}<br/>no network request"]
    Check -->|yes| Fetch["fetch with redirect:'manual',<br/>AbortSignal.timeout(8000),<br/>GET=query params, POST=JSON body,<br/>response text sliced to 2000 chars"]
    Kind -->|capture_lead| Cap["addCapture('lead')"]
    Kind -->|book_appointment| Cap2["addCapture('appointment', status=requested)"]
    Kind -->|take_message| Cap3["addCapture('message')"]
    Kind -->|transfer_to_human| Cap4["addCapture('handoff') + action"]
    Kind -->|end_call| Act["return {ending:true, reason} + action"]
    Kind -->|search_knowledge| Search["searchKnowledge(agent.knowledge, query)"]
    Cap --> Merge{"kind = appointment<br/>and one already exists?"}
    Cap2 --> Merge
    Merge -->|yes| Update["merge JSON: {...existing, ...new}<br/>one booking per call, corrections update it"]
    Merge -->|no| Insert["insert Capture row"]
    Cap3 --> Insert
    Cap4 --> Insert
    Search --> Hits{"hits?"}
    Hits -->|no| NoHit["{results:[], note:'Nothing found. Do not guess'}")
    Hits -->|yes| Hit["top 3 {source, text} back into model context"]
```

`PRIVATE_HOST` blocks `localhost*`, `127.*`, `10.*`, `192.168.*`, `169.254.*`, `172.16–31.*`, `0.*`, `::1` and IPv6 `fc/fd` prefixes. It is a string/regex guard: DNS names resolving to private IPs and IPv4-mapped IPv6 are not resolved or blocked. Redirects are not followed.

Tool messages stored in `Message` contain the **arguments**, not the tool result. Custom-tool fetch errors throw and surface as an NDJSON `error` event rather than a tool result.

---

## 14. Knowledge base pipeline

Sources: `src/components/agent-form.tsx`, `src/server/services/agents.ts`, `src/mastra/index.ts`, `src/mastra/knowledge.ts`, `tests/logic.test.ts`.

```mermaid
flowchart LR
    subgraph Save["Save time"]
        UI["Add Text Source / upload .txt .md .csv"] --> Docs["KnowledgeDoc[] {title, content}"]
        Docs --> V["agents.validate:<br/>sum(content.length) ≤ 200,000"]
        V --> Col["Agent.knowledge JSON column"]
    end

    subgraph Prompt["Prompt time — per call"]
        Col --> Size{"knowledgeSize = sum(title + content)"}
        Size -->|"≤ 6,000"| Inline["inlineKnowledge:<br/>### title + content into instructions"]
        Size -->|"> 6,000 + tool enabled"| Tool["search_knowledge tool available"]
        Size -->|"> 6,000 + tool disabled"| None["knowledge silently absent"]
    end

    subgraph Search["searchKnowledge(query)"]
        Tool --> Q["terms(query): lowercase,<br/>split non-alphanumeric, drop ≤1 char + stopwords"]
        Q --> Chunk["chunk(docs): split on blank lines,<br/>pack paragraphs to ~800 chars"]
        Chunk --> Score["BM25-lite: idf × tf × 2.2 / (tf + 1.2 × normalized length)"]
        Score --> Top["filter score > 0,<br/>sort desc, take 3 → {title, text, score}"]
    end
```

There is no embedding model or vector store. Chunks are recomputed on every search and never persisted.

---

## 15. Sentence chunking, parallel synthesis and gapless playback

Sources: `src/lib/voice/player.ts`, `src/lib/voice/engine.ts` (`enqueueSpeech`, `onPlaybackIdle`), `tests/logic.test.ts`.

```mermaid
flowchart TD
    Delta["NDJSON delta text"] --> Chunker["SentenceChunker.push(delta)"]
    Chunker --> First{"first emitted chunk?"}
    First -->|yes| P1["first: ≥10 chars + punctuation [.!?;:,]<br/>followed by whitespace — may break on a comma"]
    First -->|no| P2["later: ≥20 chars + punctuation [.!?;:]<br/>followed by whitespace — comma not enough"]
    P1 --> Sentence["complete sentence"]
    P2 --> Sentence
    Sentence --> Req["Immediately POST /api/voice/tts<br/>with same ticket + abort signal"]
    Req --> Chain["append to turn.chain<br/>— playback waits for earlier sentences"]
    Chain --> Read["getReader() on PCM stream"]
    Read --> FirstByte{"first non-empty chunk?"}
    FirstByte -->|yes| Metric["ttsFirstByteMs = now - requestedAt<br/>first audio: state=speaking"]
    FirstByte -->|no| Push
    Metric --> Push["PcmPlayer.push(bytes)<br/>Int16 LE → normalized AudioBuffer"]
    Push --> Sched["startAt = max(ctx.currentTime + 0.02, nextTime)<br/>nextTime = startAt + duration"]
    Sched --> Idle{"sources.size === 0?"}
    Idle -->|yes| CB["onIdle → onPlaybackIdle()"]
    CB --> Hangup{"pendingHangup set?"}
    Hangup -->|yes| End["end('agent_ended' or 'transferred')"]
    Hangup -->|no| Listen["state=listening; reset lastActivity"]
    Flush["stream done → chunker.flush()"] --> Sentence
```

`PcmPlayer.stop()` nulls `onended`, stops all sources, clears `leftover` and resets `nextTime` — this is the instant-silence path used by barge-in. A 20 ms lead-in prevents clicks.

---

## 16. Barge-in: abort and partial-reply persistence

Sources: `src/lib/voice/engine.ts` (`bargeIn`, `runTurn`), `src/app/api/voice/respond/route.ts` (`finally`), `src/app/api/voice/tts/route.ts`.

```mermaid
sequenceDiagram
    participant C as Caller
    participant V as VAD / STT
    participant E as VoiceSession
    participant P as PcmPlayer
    participant R as /api/voice/respond
    participant T as /api/voice/tts
    participant D as Postgres

    R-->>E: delta events (reply being spoken)
    C->>V: talks over the agent
    V->>E: onSpeechRealStart OR ≥2 transcribed words while audible
    E->>E: allowInterruptions? interruptions++
    E->>P: stop() — silence + drop queued audio
    E->>R: AbortController.abort("turn interrupted")
    E->>T: same signal aborts pending synthesis (499)
    E->>E: mark agent transcript entry interrupted=true
    E->>E: turn=null, pendingHangup=null, state=listening
    R->>R: req.signal aborted → skip {t:error}
    R->>D: finally: save partial reply role=agent, interrupted=true
    E->>R: next finalized utterance becomes a fresh turn
```

Getting the abort order wrong makes the agent talk over itself or wastes tokens and TTS on audio nobody hears.

---

## 17. Call end, billing and post-call summary

Sources: `src/lib/voice/engine.ts` (`end`), `src/app/api/voice/end/route.ts`, `src/server/services/conversations.ts` (`finish`, `settle`), `src/mastra/index.ts` (`summarizer`).

```mermaid
sequenceDiagram
    participant B as Browser engine
    participant E as POST /api/voice/end
    participant C as conversations service
    participant D as Postgres
    participant S as Sentry
    participant A as Summarizer agent (Claude)

    B->>B: clear timers, abort turn, stop player/VAD/WS/mic
    B->>B: state = ended
    B->>E: keepalive POST {conversationId, endReason,<br/>failed?, metrics averages}
    E->>C: finish(userId, args)
    C->>D: requireConversationAccess
    C->>D: settle() transaction:
    D->>D: UPDATE conversation SET status/endReason/<br/>metrics/endedAt/durationSec WHERE status='active'
    D->>D: if count=0 return null (idempotent)
    D->>D: UPDATE workspace SET creditSeconds =<br/>GREATEST(0, creditSeconds - durationSec)
    C-->>E: durationSec
    E->>S: ringlet.call.<metric>Ms distributions;<br/>warning if failed
    E->>C: get() → messages + captures
    alt caller spoke
        E->>A: transcript ≤30,000 chars + saved capture kinds
        A-->>E: {summary, outcome, unsavedBooking|null}
        E->>C: addDraftAppointment if unsavedBooking and no appointment
        E->>E: outcome guard:<br/>appointment_booked→appointment,<br/>lead_captured→lead, message_taken→message,<br/>transferred→handoff; else downgrade to "other"
        E->>C: setSummary(summary ≤4000, outcome ≤60)
    else no caller messages
        E->>C: setSummary("The caller did not speak.", "no_answer")
    end
    E-->>B: {durationSec}
    B->>B: upload recording (if any), close AudioContext, onEnded
```

`durationSec = max(1, ceil((endedAt - startedAt) / 1000))`, capped only for the stale reaper. Settlement happens before summarization, so a summarizer failure leaves a billed, completed call without a summary.

### Talk-time accounting

```mermaid
flowchart TD
    Start["Workspace created"] --> First{"first owned workspace?"}
    First -->|yes| Trial["creditSeconds = 900"]
    First -->|no| Zero["creditSeconds = 0"]
    Trial --> Gate{"Call start: creditSeconds ≥ 10?"}
    Zero --> Gate
    Gate -->|no| E402["402 Out of voice minutes"]
    Gate -->|yes| Cap["maxCallSec = min(agent.maxCallSec, creditSeconds)"]
    Cap --> Browser["browser timer ends call at maxCallSec"]
    Browser --> Settle["settle(): clamped decrement in transaction"]
    Settle --> Admin["bun run grant-minutes <id|email> <minutes><br/>creditSeconds = GREATEST(0, creditSeconds + minutes*60)"]
    Admin --> Gate
    Reaper["reapStale(): active older than 65 min,<br/>max 100 per read, capped at agent.maxCallSec"] --> Settle
```

The reaper is lazy: it runs from `conversations.list` and `analytics.overview`, not from a cron. There is no payment provider in the current code — an operator tops up minutes manually.

---

## 18. Recording lifecycle

Sources: `src/lib/voice/engine.ts`, `src/server/recordings.ts`, `src/server/services/conversations.ts`, `src/components/call-panel.tsx`.

```mermaid
sequenceDiagram
    participant U as User
    participant P as CallPanel
    participant E as VoiceSession
    participant R as RPC
    participant S3 as S3 bucket
    participant D as Postgres

    U->>P: ticks recording consent (only if agent.recordCalls)
    P->>E: start({recordingConsent})
    E->>E: effective recording = consent && behavior.recordCalls && RECORDINGS_BUCKET set
    E->>E: MediaRecorder captures mic + agent output, 1s timeslices
    E->>E: end(): MediaRecorder.stop() → Blob
    E->>E: POST /api/voice/end first
    E->>R: conversations.recordingUploadUrl({conversationId, contentType})
    R->>D: check membership + recordingConsent
    R-->>E: presigned PUT URL (600s)
    E->>S3: PUT audio/webm blob directly from browser
    E->>R: conversations.attachRecording({conversationId})
    R->>D: set recordingKey = recordings/{workspaceId}/{conversationId}.webm
    Note over D: detail page calls conversations.get →<br/>presigned GET URL (3600s) → audio element
```

`deleteRecording` exists in `src/server/recordings.ts` but is not called anywhere.

---

## 19. Dashboard read and analytics aggregation

Sources: `src/server/services/analytics.ts`, `src/server/services/conversations.ts`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/usage/page.tsx`.

```mermaid
flowchart TD
    UI["Dashboard / Usage page"] --> RPC["analytics.overview({workspaceId, days})"]
    RPC --> Access["requireMember(any role)"]
    Access --> Reap["reapStale(workspaceId)"]
    Reap --> Span["span = clamp(days ?? 30, 1, 90)"]
    Span --> Par["parallel queries"]
    Par --> Q1["workspace.creditSeconds"]
    Par --> Q2["conversation.findMany<br/>startedAt ≥ now - span days, take 5000"]
    Par --> Q3["agent.findMany(workspaceId)"]
    Q1 --> Agg["in-memory aggregation"]
    Q2 --> Agg
    Q3 --> Agg
    Agg --> T["totals: calls, completed, failed,<br/>successRate, minutes, turns, interruptions"]
    Agg --> L["latency: sttAvg, llmFirstTokenAvg,<br/>ttsFirstByteAvg, responseAvg, responseP95"]
    Agg --> S["series: per-day calls, failed, minutes"]
    Agg --> PA["perAgent incl. zero-call agents, sorted by calls"]
    Agg --> FR["failureReasons: top 5"]
    T --> View["stats + daily chart + per-agent table<br/>+ recent calls + usage + failure reasons"]
    L --> View
    S --> View
    PA --> View
    FR --> View
```

Conversation list reads also call `reapStale` and cap `take` at 500 (dashboard requests 200). Captures are limited to the latest 200 rows per workspace and exported to CSV in the browser.

---

## 20. Observability flow

Sources: `src/instrumentation.ts`, `next.config.ts`, voice routes.

```mermaid
flowchart LR
    subgraph Emit["Emission points"]
        M1["/respond: ringlet.llm.first_token<br/>+ span agent.turn / ai.agent"]
        M2["/tts: ringlet.tts.upstream_headers"]
        M3["/end: ringlet.call.turns,<br/>.interruptions, .sttLatencyMs,<br/>.llmFirstTokenMs, .ttsFirstByteMs,<br/>.responseLatencyMs"]
        M4["error tags: voice.session, voice.respond,<br/>voice.persist, voice.agent, voice.end,<br/>voice.tts, voice.client, voice.demo, rpc"]
    end
    subgraph Sentry["Sentry"]
        DSN["withSentryConfig<br/>tunnelRoute /monitoring<br/>tracesSampleRate default 0.2"]
        Metrics["distributions + spans + errors"]
    end
    M1 --> DSN
    M2 --> DSN
    M3 --> DSN
    M4 --> DSN
    DSN --> Metrics
    Metrics --> Dash["Sentry performance + Ringlet<br/>latency section in dashboard"]
```

---

## 21. Deployment and CI

Sources: `.github/workflows/ci.yml`, `sst.config.ts`, `package.json`, `scripts/copy-vad-assets.mjs`.

```mermaid
flowchart TD
    Push["push to main / pull_request"] --> CI["GitHub Actions: check"]
    CI --> Bun["setup-bun 1.3.6"]
    Bun --> Install["bun install --frozen-lockfile<br/>postinstall: prisma generate + copy VAD assets to public/vad"]
    Install --> Typecheck["bun run typecheck<br/>prisma generate → next typegen → tsc --noEmit"]
    Install --> Lint["bun run lint"]
    Install --> Test["bun run test<br/>sentence chunker + knowledge search"]
    Typecheck --> Gate{"all green?"}
    Lint --> Gate
    Test --> Gate

    Gate -->|manual| Deploy["bun run deploy → sst deploy --stage production"]
    Secrets["bunx sst secret set:<br/>DatabaseUrl, BetterAuthSecret, BetterAuthUrl,<br/>DeepgramApiKey, AnthropicApiKey,<br/>SessionSecret, SentryDsn"] --> Deploy
    Migrate["bun run db:deploy<br/>prisma migrate deploy against Neon"] --> Deploy
    Deploy --> Bucket["sst.aws.Bucket('Recordings')<br/>CORS GET + PUT"]
    Deploy --> Nextjs["sst.aws.Nextjs('Ringlet')<br/>Lambda 60s timeout, 1024 MB<br/>env injects secrets + bucket + Sentry"]
    Nextjs --> Prod["production: removal=retain, protect=true"]
```

SST links the recordings bucket so server functions receive AWS credentials automatically. CI has no deploy job; deployment is operator-run.

---

## Documentation drift

These are known inconsistencies between documents and code. Trust the code.

| Document | Claim | Reality in this checkout |
| --- | --- | --- |
| `AGENTS.md` / `CLAUDE.md` | Convex guideline block | `convex/_generated/ai/guidelines.md` does not exist; no Convex code to govern. The block is re-added by tooling, so it is not removed from the diff. |
| `src/components/landing/call-demo.tsx` | `sessionPath="/api/voice/demo-session"` | No `demo-session` route exists. Only `session`, `token`, `respond`, `tts`, `end` are implemented. |
| `README.md` | "Deepgram Aura-2" TTS | Code uses the per-agent `agent.voice` string carried in the ticket as the Deepgram `model`. The template defaults are Aura-2 voice IDs. |

### Test coverage note

Only `tests/logic.test.ts` exists: it pins the sentence chunker and knowledge search. There are no automated tests for the voice state machine, barge-in abort ordering, ticket validation, tool SSRF guard, event protocol, billing idempotency or summarizer outcome repair.
