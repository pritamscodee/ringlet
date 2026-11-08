"use client";

import type { MicVAD } from "@ricky0123/vad-web";
import type { RespondEvent } from "@/app/api/voice/respond/route";
import { floatTo16BitPcm, PcmPlayer, SentenceChunker } from "./player";

export type CallState = "connecting" | "listening" | "thinking" | "speaking" | "ended";

export type TranscriptEntry = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  interim?: boolean;
  interrupted?: boolean;
};

type SessionConfig = {
  conversationId: string;
  ticket: string;
  sttToken: string;
  maxCallSec: number;
  recording: boolean;
  agent: {
    name: string;
    greeting: string;
    voice: string;
    language: string;
    endpointingMs: number;
    silenceTimeoutSec: number;
    allowInterruptions: boolean;
  };
};

type Turn = {
  abort: AbortController;
  chain: Promise<void>;
  entryId: string;
  text: string;
  startedAt: number;
  firstAudio: boolean;
  firstToken: boolean;
};

export type VoiceSessionOptions = {
  agentId: string;
  recordingConsent: boolean;
  onState: (s: CallState) => void;
  onTranscript: (entries: TranscriptEntry[]) => void;
  onError: (message: string) => void;
  onEnded?: (info: { conversationId: string; reason: string }) => void;
  uploadRecording?: (conversationId: string, blob: Blob) => Promise<void>;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const avg = (xs: number[]) =>
  xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined;

/**
 * Browser side of a Ringlet call:
 *   mic (WebRTC getUserMedia, echo cancelled)
 *     -> Silero VAD (speech start/end, barge-in)
 *     -> Deepgram streaming STT (websocket, short-lived token)
 *     -> /api/voice/respond (Mastra agent, streamed text)
 *     -> /api/voice/tts per sentence (Deepgram Aura, streamed PCM)
 *     -> gapless Web Audio playback
 * When the caller speaks over the agent, playback stops at once and the
 * in-flight LLM and TTS requests are aborted.
 */
export class VoiceSession {
  private cfg!: SessionConfig;
  private ctx!: AudioContext;
  private player!: PcmPlayer;
  private stream!: MediaStream;
  private vad: MicVAD | null = null;
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];

  private state: CallState = "connecting";
  private entries: TranscriptEntry[] = [];
  private turn: Turn | null = null;
  private finalBuf = "";
  private interimId: string | null = null;
  private userSpeaking = false;
  private speechEndedAt = 0;
  private lastActivity = Date.now();
  private nudged = false;
  private pendingHangup: string | null = null;
  private ended = false;
  private muted = false;
  private reconnects = 0;

  private m = {
    turns: 0,
    interruptions: 0,
    stt: [] as number[],
    llm: [] as number[],
    tts: [] as number[],
    response: [] as number[],
  };

  constructor(private opts: VoiceSessionOptions) {}

  get conversationId() {
    return this.cfg?.conversationId;
  }

  async start() {
    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: this.opts.agentId,
          recordingConsent: this.opts.recordingConsent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the call");
      this.cfg = data as SessionConfig;

      this.ctx = new AudioContext();
      await this.ctx.resume();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      this.player = new PcmPlayer(this.ctx);
      this.player.onIdle = () => this.onPlaybackIdle();

      if (this.cfg.recording && typeof MediaRecorder !== "undefined") {
        const dest = this.ctx.createMediaStreamDestination();
        this.ctx.createMediaStreamSource(this.stream).connect(dest);
        this.player.output.connect(dest);
        this.recorder = new MediaRecorder(dest.stream);
        this.recorder.ondataavailable = (e) => e.data.size && this.recordChunks.push(e.data);
        this.recorder.start(1000);
      }

      this.openStt(this.cfg.sttToken);
      await this.startVad();

      this.timers.push(setTimeout(() => this.end("max_duration"), this.cfg.maxCallSec * 1000));
      this.timers.push(setInterval(() => this.checkSilence(), 1000));

      this.speakScripted(this.cfg.agent.greeting);
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone permission was denied"
          : e instanceof Error
            ? e.message
            : "Could not start the call";
      this.opts.onError(msg);
      await this.end("setup_failed", msg);
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  /** Caller hangs up. */
  hangUp() {
    void this.end("caller_hung_up");
  }

  // ---------------------------------------------------------------------------
  // Speech to text
  // ---------------------------------------------------------------------------

  private openStt(token: string) {
    const p = new URLSearchParams({
      model: "nova-3",
      language: this.cfg.agent.language,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: String(this.cfg.agent.endpointingMs),
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${p}`, ["bearer", token]);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      this.reconnects = 0;
    };
    ws.onmessage = (ev) => this.onSttMessage(ev.data);
    ws.onclose = () => {
      if (this.ended || this.ws !== ws) return;
      void this.reconnectStt();
    };
    this.ws = ws;
  }

  private async reconnectStt() {
    if (this.reconnects++ >= 3) {
      this.opts.onError("Lost connection to speech recognition");
      return this.end("stt_disconnected", "Speech recognition connection was lost");
    }
    try {
      const res = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "x-ringlet-ticket": this.cfg.ticket },
      });
      const { sttToken } = await res.json();
      if (!this.ended) this.openStt(sttToken);
    } catch {
      setTimeout(() => this.reconnectStt(), 1000);
    }
  }

  private onSttMessage(raw: string) {
    let msg: {
      type: string;
      is_final?: boolean;
      speech_final?: boolean;
      channel?: { alternatives: { transcript: string }[] };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "UtteranceEnd") {
      if (this.finalBuf.trim()) this.commitUtterance();
      return;
    }
    if (msg.type !== "Results") return;
    const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!text) {
      if (msg.speech_final && this.finalBuf.trim()) this.commitUtterance();
      return;
    }
    this.lastActivity = Date.now();
    this.nudged = false;

    // Transcript-based barge-in backs up VAD when it misses soft speech.
    if (this.agentAudible() && text.split(/\s+/).length >= 2) this.bargeIn();

    if (msg.is_final) {
      this.finalBuf = `${this.finalBuf} ${text}`.trim();
      this.showInterim(this.finalBuf);
      if (msg.speech_final) this.commitUtterance();
    } else {
      this.showInterim(`${this.finalBuf} ${text}`.trim());
    }
  }

  private showInterim(text: string) {
    if (!this.interimId) {
      this.interimId = uid();
      this.entries.push({ id: this.interimId, role: "user", text, interim: true });
    } else {
      const e = this.entries.find((x) => x.id === this.interimId);
      if (e) e.text = text;
    }
    this.emitTranscript();
  }

  private commitUtterance() {
    const text = this.finalBuf.trim();
    this.finalBuf = "";
    if (!text) return;
    if (this.interimId) {
      const e = this.entries.find((x) => x.id === this.interimId);
      if (e) {
        e.text = text;
        e.interim = false;
      }
      this.interimId = null;
    } else {
      this.entries.push({ id: uid(), role: "user", text });
    }
    this.emitTranscript();
    if (this.speechEndedAt && Date.now() - this.speechEndedAt < 5000) {
      this.m.stt.push(Date.now() - this.speechEndedAt);
    }
    void this.runTurn(text);
  }

  // ---------------------------------------------------------------------------
  // Voice activity detection and barge-in
  // ---------------------------------------------------------------------------

  private async startVad() {
    const { MicVAD } = await import("@ricky0123/vad-web");
    this.vad = await MicVAD.new({
      model: "v5",
      baseAssetPath: "/vad/",
      onnxWASMBasePath: "/vad/",
      getStream: async () => this.stream,
      pauseStream: async () => {},
      resumeStream: async () => this.stream,
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.45,
      redemptionMs: 600,
      minSpeechMs: 250,
      onFrameProcessed: (_p, frame) => {
        if (this.muted || this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(floatTo16BitPcm(frame));
      },
      onSpeechStart: () => {
        if (this.muted) return;
        this.userSpeaking = true;
        this.lastActivity = Date.now();
      },
      onSpeechRealStart: () => {
        // Sustained speech (not a cough or echo) while the agent talks or thinks.
        if (!this.muted && (this.agentAudible() || this.turn)) this.bargeIn();
      },
      onSpeechEnd: () => {
        this.userSpeaking = false;
        this.speechEndedAt = Date.now();
      },
      onVADMisfire: () => {
        this.userSpeaking = false;
      },
    });
    await this.vad.start();
  }

  private agentAudible() {
    return this.player?.playing ?? false;
  }

  private bargeIn() {
    if (!this.cfg.agent.allowInterruptions) return;
    if (!this.turn && !this.player.playing) return;
    this.m.interruptions++;
    this.player.stop();
    if (this.turn) {
      this.turn.abort.abort();
      const e = this.entries.find((x) => x.id === this.turn!.entryId);
      if (e && e.text) e.interrupted = true;
      this.turn = null;
      this.emitTranscript();
    }
    this.pendingHangup = null;
    this.setState("listening");
  }

  // ---------------------------------------------------------------------------
  // Agent turn: LLM text stream -> sentence TTS -> playback
  // ---------------------------------------------------------------------------

  private newTurn(text = ""): Turn {
    const entryId = uid();
    this.entries.push({ id: entryId, role: "agent", text });
    this.emitTranscript();
    return {
      abort: new AbortController(),
      chain: Promise.resolve(),
      entryId,
      text,
      startedAt: Date.now(),
      firstAudio: false,
      firstToken: false,
    };
  }

  private speakScripted(text: string) {
    const turn = (this.turn = this.newTurn(text));
    this.setState("speaking");
    this.enqueueSpeech(turn, text);
    void turn.chain.then(() => this.finishTurn(turn));
  }

  private async runTurn(userText: string) {
    if (this.turn) {
      this.turn.abort.abort();
      this.player.stop();
    }
    this.m.turns++;
    const turn = (this.turn = this.newTurn());
    const reference = this.speechEndedAt && Date.now() - this.speechEndedAt < 5000 ? this.speechEndedAt : Date.now();
    turn.startedAt = reference;
    this.setState("thinking");
    const chunker = new SentenceChunker();

    try {
      const res = await fetch("/api/voice/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ringlet-ticket": this.cfg.ticket },
        body: JSON.stringify({ conversationId: this.cfg.conversationId, text: userText }),
        signal: turn.abort.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Agent request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as RespondEvent;
          if (this.turn !== turn) return;
          if (ev.t === "delta") {
            if (!turn.firstToken) {
              turn.firstToken = true;
              this.m.llm.push(Date.now() - reference);
            }
            turn.text += ev.text;
            this.updateEntry(turn.entryId, turn.text);
            for (const sentence of chunker.push(ev.text)) this.enqueueSpeech(turn, sentence);
          } else if (ev.t === "action") {
            this.pendingHangup = ev.action === "end_call" ? "agent_ended" : "transferred";
            if (ev.action === "transfer_to_human") {
              this.entries.push({ id: uid(), role: "system", text: "Transferring to a human…" });
              this.emitTranscript();
            }
          } else if (ev.t === "error") {
            throw new Error(ev.message);
          }
        }
      }
      const rest = chunker.flush();
      if (rest) this.enqueueSpeech(turn, rest);
      await turn.chain;
      this.finishTurn(turn);
    } catch (e) {
      if (turn.abort.signal.aborted) return;
      const msg = e instanceof Error ? e.message : "Agent failed";
      this.opts.onError(msg);
      if (this.turn === turn) {
        this.turn = null;
        this.setState("listening");
      }
    }
  }

  private enqueueSpeech(turn: Turn, text: string) {
    if (!/[\p{L}\p{N}]/u.test(text)) return;
    const requestedAt = Date.now();
    // Start synthesis now; play in order once earlier sentences are queued.
    const audio = fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ringlet-ticket": this.cfg.ticket },
      body: JSON.stringify({ text }),
      signal: turn.abort.signal,
    });
    turn.chain = turn.chain.then(async () => {
      if (this.turn !== turn) return;
      const res = await audio.catch(() => null);
      if (!res?.ok || !res.body) {
        if (!turn.abort.signal.aborted) this.opts.onError("Speech synthesis failed");
        return;
      }
      const reader = res.body.getReader();
      let first = true;
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done || this.turn !== turn) break;
        if (!value?.length) continue;
        if (first) {
          first = false;
          this.m.tts.push(Date.now() - requestedAt);
        }
        if (!turn.firstAudio) {
          turn.firstAudio = true;
          if (this.m.turns > 0) this.m.response.push(Date.now() - turn.startedAt);
          this.setState("speaking");
        }
        this.player.push(value);
      }
    });
  }

  private finishTurn(turn: Turn) {
    if (this.turn !== turn) return;
    if (!this.player.playing) this.onPlaybackIdle();
  }

  private onPlaybackIdle() {
    if (this.ended || this.player.playing) return;
    const turn = this.turn;
    // Still streaming more sentences for this turn.
    if (turn && !turn.abort.signal.aborted) {
      void turn.chain.then(() => {
        if (this.turn === turn && !this.player.playing) {
          this.turn = null;
          this.lastActivity = Date.now();
          if (this.pendingHangup) return void this.end(this.pendingHangup);
          this.setState("listening");
        }
      });
    }
  }

  private checkSilence() {
    if (this.ended || this.turn || this.player.playing || this.userSpeaking) return;
    const idle = (Date.now() - this.lastActivity) / 1000;
    const limit = this.cfg.agent.silenceTimeoutSec;
    if (idle > limit && !this.nudged) {
      this.nudged = true;
      this.lastActivity = Date.now();
      this.speakScripted("Are you still there?");
    } else if (idle > limit && this.nudged) {
      void this.end("silence_timeout");
    }
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  async end(reason: string, failed?: string) {
    if (this.ended) return;
    this.ended = true;
    this.timers.forEach((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.turn?.abort.abort();
    this.turn = null;
    this.player?.stop();
    try {
      await this.vad?.destroy();
    } catch {
      // ignore
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        ws.close();
      } catch {
        // ignore
      }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.setState("ended");

    const conversationId = this.cfg?.conversationId;
    if (!conversationId) return;

    const recording = this.stopRecorder();
    await fetch("/api/voice/end", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        endReason: reason,
        failed,
        metrics: {
          turns: this.m.turns,
          interruptions: this.m.interruptions,
          sttLatencyMs: avg(this.m.stt),
          llmFirstTokenMs: avg(this.m.llm),
          ttsFirstByteMs: avg(this.m.tts),
          responseLatencyMs: avg(this.m.response),
        },
      }),
    }).catch(() => {});

    const blob = await recording;
    if (blob && this.opts.uploadRecording) {
      await this.opts.uploadRecording(conversationId, blob).catch(() => {});
    }
    await this.ctx?.close().catch(() => {});
    this.opts.onEnded?.({ conversationId, reason });
  }

  private stopRecorder(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () =>
        resolve(this.recordChunks.length ? new Blob(this.recordChunks, { type: rec.mimeType }) : null);
      rec.stop();
    });
  }

  // ---------------------------------------------------------------------------

  private setState(s: CallState) {
    if (this.state === "ended") return;
    this.state = s;
    this.opts.onState(s);
  }

  private updateEntry(id: string, text: string) {
    const e = this.entries.find((x) => x.id === id);
    if (e) e.text = text;
    this.emitTranscript();
  }

  private emitTranscript() {
    this.opts.onTranscript(this.entries.filter((e) => e.text).map((e) => ({ ...e })));
  }
}
