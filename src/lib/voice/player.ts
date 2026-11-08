/**
 * Gapless playback of streamed 16-bit PCM. Chunks are scheduled back to back
 * on the Web Audio clock; `stop()` silences everything instantly (barge-in).
 */
export class PcmPlayer {
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private leftover: Uint8Array | null = null;
  readonly output: GainNode;
  onIdle?: () => void;

  constructor(
    private ctx: AudioContext,
    private sampleRate = 24000,
  ) {
    this.output = ctx.createGain();
    this.output.connect(ctx.destination);
  }

  get playing() {
    return this.sources.size > 0;
  }

  /** Seconds of audio still queued. */
  get buffered() {
    return Math.max(0, this.nextTime - this.ctx.currentTime);
  }

  push(bytes: Uint8Array) {
    let data = bytes;
    if (this.leftover) {
      const merged = new Uint8Array(this.leftover.length + bytes.length);
      merged.set(this.leftover);
      merged.set(bytes, this.leftover.length);
      data = merged;
      this.leftover = null;
    }
    // 16-bit samples: keep an odd trailing byte for the next chunk.
    if (data.length % 2) {
      this.leftover = data.slice(data.length - 1);
      data = data.slice(0, data.length - 1);
    }
    if (!data.length) return;

    const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
    const buffer = this.ctx.createBuffer(1, samples.length, this.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.output);
    const startAt = Math.max(this.ctx.currentTime + 0.02, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.onIdle?.();
    };
  }

  stop() {
    for (const src of this.sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.leftover = null;
    this.nextTime = 0;
  }
}

export function floatTo16BitPcm(frame: Float32Array) {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const s = Math.max(-1, Math.min(1, frame[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/** Splits streamed text into speakable chunks as early as possible. */
export class SentenceChunker {
  private buf = "";
  private emitted = 0;

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    // The first chunk may break on a comma so audio starts sooner.
    for (;;) {
      const re = this.emitted === 0 ? /^(.{10,}?[.!?;:,])\s+/s : /^(.{20,}?[.!?;:])\s+/s;
      const m = this.buf.match(re);
      if (!m) break;
      out.push(m[1].trim());
      this.buf = this.buf.slice(m[0].length);
      this.emitted++;
    }
    return out;
  }

  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    return rest || null;
  }
}
