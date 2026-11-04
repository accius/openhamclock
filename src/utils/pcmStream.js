/**
 * pcmStream.js — pure helpers for streamed PCM audio (no Web Audio here).
 *
 * The Rig Bridge kiwi-audio route sends 16-bit big-endian mono PCM as a
 * plain HTTP body; fetch() hands it over in arbitrary chunks, so a sample
 * can be split across two reads. createS16beDecoder carries the odd byte.
 *
 * PlayheadScheduler decides when each decoded chunk should start so a
 * stream with network jitter plays back gap-free with a small, bounded
 * latency — the decoder and waterfall then see continuous audio.
 */

/**
 * Returns decode(Uint8Array) → Float32Array (−1…1). Stateful: an odd
 * trailing byte is kept and prefixed to the next chunk.
 */
export function createS16beDecoder() {
  let carry = null; // number | null
  return function decode(bytes) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const total = src.length + (carry !== null ? 1 : 0);
    const n = total >> 1;
    const out = new Float32Array(n);
    let i = 0;
    let o = 0;
    if (carry !== null && n > 0) {
      const v = (carry << 8) | src[0];
      out[o++] = (v & 0x8000 ? v - 0x10000 : v) / 32768;
      i = 1;
      carry = null;
    }
    for (; i + 1 < src.length; i += 2) {
      const v = (src[i] << 8) | src[i + 1];
      out[o++] = (v & 0x8000 ? v - 0x10000 : v) / 32768;
    }
    if (i < src.length) carry = src[i];
    return out;
  };
}

// G.711 µ-law → float lookup (the Cloud Relay sends Kiwi audio as µ-law to
// halve its bandwidth; encoder in rig-bridge/lib/mulaw.js).
const MULAW_TABLE = (() => {
  const t = new Float32Array(256);
  for (let b = 0; b < 256; b++) {
    const u = ~b & 0xff;
    const exponent = (u >> 4) & 0x07;
    const s = ((((u & 0x0f) << 3) + 0x84) << exponent) - 0x84;
    t[b] = (u & 0x80 ? -s : s) / 32768;
  }
  return t;
})();

/** Returns decode(Uint8Array of µ-law bytes) → Float32Array (−1…1). Stateless. */
export function createMulawDecoder() {
  return function decode(bytes) {
    const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = MULAW_TABLE[src[i]];
    return out;
  };
}

/** Decoder for an X-Audio-Format header value ('s16be' default, 'ulaw'). */
export function createAudioDecoder(format) {
  return String(format || '').toLowerCase() === 'ulaw' ? createMulawDecoder() : createS16beDecoder();
}

/**
 * Schedules consecutive chunks on an audio clock.
 *   next(nowSec, durationSec) → start time (sec), or null to drop the chunk
 *
 * - First chunk (or after an underrun) starts `leadSec` ahead of now, so a
 *   little jitter never causes a gap.
 * - When the backlog exceeds `maxLagSec` (sender clock faster than ours,
 *   or a burst after a stall), chunks are dropped until it shrinks again.
 */
export class PlayheadScheduler {
  constructor({ leadSec = 0.25, maxLagSec = 1.5 } = {}) {
    this.leadSec = leadSec;
    this.maxLagSec = maxLagSec;
    this.playhead = 0;
    this.underruns = 0;
    this.dropped = 0;
  }

  next(nowSec, durationSec) {
    if (this.playhead < nowSec) {
      if (this.playhead > 0) this.underruns++;
      this.playhead = nowSec + this.leadSec;
    }
    if (this.playhead - nowSec > this.maxLagSec) {
      this.dropped++;
      return null;
    }
    const start = this.playhead;
    this.playhead += durationSec;
    return start;
  }

  /** Seconds of audio queued ahead of `nowSec`. */
  backlog(nowSec) {
    return Math.max(0, this.playhead - nowSec);
  }
}
