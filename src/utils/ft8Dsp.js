/**
 * ft8Dsp.js — everything between the sound card and the FT8 decoder, in
 * pure JS (no Web Audio, no DOM), so it runs in the FT8 worker and in vitest.
 *
 *   Resampler       any rate → 12 kHz (windowed-sinc, anti-aliased)
 *   SlotCollector   continuous 12 kHz audio + wall clock → one 15 s buffer per
 *                   UTC FT8 slot (:00 :15 :30 :45), zero-filled at the edges
 *   parseFt8Message decoded text → { cq, to, de, grid, report, calls }
 */
import { FT8_SAMPLE_RATE, FT8_SLOT_SECONDS } from './ft8Wasm.js';

// ── Resampler ─────────────────────────────────────────────────────────────

/**
 * Streaming band-limited resampler. Output sample n sits at input position
 * n·(inRate/outRate); each is a Blackman-windowed sinc sum over ±halfWidth
 * input samples with the cut-off at 0.45·min(inRate, outRate) — FT8 lives
 * below 3 kHz, so everything up to ~5.4 kHz passes flat and nothing aliases.
 */
export class Resampler {
  constructor(inRate, outRate = FT8_SAMPLE_RATE, { zeroCrossings = 8 } = {}) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error('Resampler: bad rate');
    this.inRate = inRate;
    this.outRate = outRate;
    this.step = inRate / outRate; // input samples per output sample
    const scale = Math.min(1, outRate / inRate); // cut-off relative to input Nyquist
    this.fc = 0.45 * 2 * scale; // normalised to input rate (cycles/sample ×2)
    this.halfWidth = Math.ceil(zeroCrossings / scale);
    this.hist = new Float32Array(0); // tail of previous input kept for the kernel
    this.pos = this.halfWidth; // next output position, in hist+input coordinates
  }

  kernel(x) {
    // windowed sinc, x in input samples from the output instant
    const hw = this.halfWidth;
    if (x <= -hw || x >= hw) return 0;
    const t = Math.PI * this.fc * x;
    const sinc = x === 0 ? 1 : Math.sin(t) / t;
    const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / hw) + 0.08 * Math.cos((2 * Math.PI * x) / hw);
    return this.fc * sinc * w;
  }

  /** Feed input, get whatever output is now computable. */
  process(input) {
    const buf = new Float32Array(this.hist.length + input.length);
    buf.set(this.hist, 0);
    buf.set(input, this.hist.length);
    const hw = this.halfWidth;
    const out = [];
    while (this.pos + hw < buf.length) {
      const c = Math.floor(this.pos);
      const frac = this.pos - c;
      let acc = 0;
      for (let k = c - hw + 1; k <= c + hw; k++) acc += buf[k] * this.kernel(k - c - frac);
      out.push(acc);
      this.pos += this.step;
    }
    // Keep enough history for the next kernel and rebase positions
    const keepFrom = Math.max(0, Math.floor(this.pos) - hw);
    this.hist = buf.slice(keepFrom);
    this.pos -= keepFrom;
    return Float32Array.from(out);
  }
}

// ── Slot collector ────────────────────────────────────────────────────────

const SLOT_MS = FT8_SLOT_SECONDS * 1000;

/** FT8 dial frequencies (kHz, USB) — the same islands utils/callsign.js classifies. */
export const FT8_DIALS = [1840, 3573, 7074, 10136, 14074, 18100, 21074, 24915, 28074, 50313];

/**
 * Collects 12 kHz audio against UTC and hands out one buffer per FT8 slot.
 *
 * push(samples, endTimeMs): endTimeMs = wall-clock time of the sample just
 * after the chunk. Timing then advances by sample count (sample-accurate);
 * the wall clock only re-anchors it after a gap or > maxDriftMs of drift.
 *
 * A slot is emitted once audio reaches slot start + emitAtSec (default
 * 14.6 s — FT8 transmissions end at 13.14 s) and only if the buffer began no
 * later than slot start + maxLateStartSec, so a slot joined halfway through
 * is skipped rather than half-decoded.
 */
export class SlotCollector {
  constructor({
    sampleRate = FT8_SAMPLE_RATE,
    emitAtSec = 14.6,
    maxLateStartSec = 0.4,
    maxDriftMs = 300,
    maxGapMs = 250,
    keepSec = 20,
  } = {}) {
    this.rate = sampleRate;
    this.emitAtMs = emitAtSec * 1000;
    this.maxLateStartMs = maxLateStartSec * 1000;
    this.maxDriftMs = maxDriftMs;
    this.maxGapMs = maxGapMs;
    this.capacity = Math.round(keepSec * sampleRate);
    this.reset();
  }

  reset() {
    this.buf = new Float32Array(this.capacity);
    this.len = 0; // valid samples at the end of buf
    this.endMs = null; // wall time just after the last sample
    this.startMs = null; // wall time of the first contiguous sample
    this.lastSlotMs = null;
  }

  /** Wall time of the first sample currently held. */
  get bufferStartMs() {
    return this.endMs == null ? null : this.endMs - (this.len / this.rate) * 1000;
  }

  push(samples, endTimeMs) {
    const durMs = (samples.length / this.rate) * 1000;
    if (this.endMs == null) {
      this.endMs = endTimeMs - durMs;
      this.startMs = this.endMs;
    } else {
      const predicted = this.endMs; // where this chunk should start
      const actualStart = endTimeMs - durMs;
      const err = actualStart - predicted;
      if (err > this.maxGapMs || err < -this.maxDriftMs) {
        // Lost audio (tab throttled, device change) or clock jump: start over
        this.len = 0;
        this.endMs = actualStart;
        this.startMs = actualStart;
      } else if (Math.abs(err) > this.maxDriftMs) {
        this.endMs = actualStart; // gentle re-anchor
      }
    }
    // Append (keep the newest `capacity` samples)
    if (samples.length >= this.capacity) {
      this.buf.set(samples.subarray(samples.length - this.capacity));
      this.len = this.capacity;
    } else {
      const overflow = Math.max(0, this.len + samples.length - this.capacity);
      if (overflow) {
        this.buf.copyWithin(0, overflow, this.len);
        this.len -= overflow;
      }
      this.buf.set(samples, this.len);
      this.len += samples.length;
    }
    this.endMs += durMs;
    if (this.startMs != null && this.bufferStartMs > this.startMs) this.startMs = this.bufferStartMs;
    return this.takeSlot();
  }

  /** The slot whose emit point has been reached, or null. */
  takeSlot() {
    if (this.endMs == null) return null;
    const slotMs = Math.floor((this.endMs - this.emitAtMs) / SLOT_MS) * SLOT_MS;
    if (slotMs === this.lastSlotMs) return null;
    if (this.endMs < slotMs + this.emitAtMs) return null;
    this.lastSlotMs = slotMs;
    if (this.startMs > slotMs + this.maxLateStartMs) return null; // joined too late
    const n = FT8_SLOT_SECONDS * this.rate;
    const pcm = new Float32Array(n);
    const bufStart = this.bufferStartMs;
    const offset = Math.round(((slotMs - bufStart) / 1000) * this.rate); // index in buf of slot start
    for (let i = 0; i < n; i++) {
      const j = offset + i;
      if (j >= 0 && j < this.len) pcm[i] = this.buf[j];
    }
    return { slotStartMs: slotMs, pcm };
  }
}

// ── Message parsing ───────────────────────────────────────────────────────

const GRID_RE = /^[A-R]{2}\d{2}$/;
const REPORT_RE = /^R?[+-]\d{2}$/;
const ACK = new Set(['RRR', 'RR73', '73']);
const CALL_RE = /^<?((?:[A-Z0-9]{1,4}\/)?(?:[A-Z][A-Z0-9]?|[0-9][A-Z])[0-9][A-Z0-9]{0,4}[A-Z](?:\/[A-Z0-9]{1,4})?)>?$/;

const callOf = (tok) => {
  if (!tok || tok === '<...>') return null;
  const m = tok.match(CALL_RE);
  return m ? m[1] : null;
};

/**
 * Parse a decoded FT8 message.
 *   "CQ K1ABC FN42"        → { cq: true, de: 'K1ABC', grid: 'FN42' }
 *   "CQ POTA W1AW FN31"    → { cq: true, cqTo: 'POTA', de: 'W1AW', grid: 'FN31' }
 *   "K1ABC W9XYZ -12"      → { to: 'K1ABC', de: 'W9XYZ', report: '-12' }
 *   "W9XYZ K1ABC RR73"     → { to: 'W9XYZ', de: 'K1ABC', ack: 'RR73' }
 * calls: every callsign in the message, in order (for click-to-lookup).
 */
export function parseFt8Message(text) {
  const toks = String(text || '')
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  const out = { cq: false, cqTo: null, to: null, de: null, grid: null, report: null, ack: null, calls: [] };
  if (!toks.length) return out;
  let i = 0;
  if (toks[0] === 'CQ' || toks[0] === 'QRZ') {
    out.cq = true;
    i = 1;
    // "CQ DX K1ABC", "CQ POTA K1ABC", "CQ 145 K1ABC"
    if (toks.length > 2 && !callOf(toks[1]) && /^[A-Z0-9]{1,4}$/.test(toks[1])) {
      out.cqTo = toks[1];
      i = 2;
    }
    out.de = callOf(toks[i]);
    i++;
  } else {
    out.to = callOf(toks[0]);
    out.de = callOf(toks[1]);
    i = 2;
  }
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (GRID_RE.test(t) && t !== 'RR73') out.grid = t;
    else if (REPORT_RE.test(t)) out.report = t;
    else if (ACK.has(t)) out.ack = t;
  }
  for (const t of toks) {
    const c = callOf(t);
    if (c && !out.calls.includes(c)) out.calls.push(c);
  }
  return out;
}

/** "143015" style UTC label for a slot start. */
export function slotLabel(slotStartMs) {
  const d = new Date(slotStartMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// ── Receive-path delay (remote receivers) ─────────────────────────────────

/**
 * Learns the constant delay of a remote receive path from the decodes.
 * Audio from a KiwiSDR reaches the browser hundreds of ms late (Kiwi
 * buffering and two network hops), so every station looks late by the same
 * amount — and worse, the end of each transmission spills past the 15 s slot
 * the decoder is given. Most FT8 stations keep their clocks within a few
 * tenths of a second, so the median DT is the delay.
 *
 * Use: shift the audio's timestamps earlier by `delayS` (so slots are cut
 * where the transmissions really are) and feed each slot's DTs to `add()`.
 * Once `minSamples` DTs are in and their median is beyond `deadbandS`, the
 * median is added to the delay and collection starts over — it converges in
 * one or two steps and then tracks slow drift.
 */
export class ReceiverDelayTracker {
  constructor({ minSamples = 8, deadbandS = 0.15, maxS = 4 } = {}) {
    this.minSamples = minSamples;
    this.deadbandS = deadbandS;
    this.maxS = maxS;
    this.reset();
  }

  reset() {
    this.delayS = 0;
    this.pending = [];
  }

  /** Feed the DTs of one slot; returns true when the delay estimate changed. */
  add(dts) {
    for (const d of dts) if (Number.isFinite(d) && Math.abs(d) < 5) this.pending.push(d);
    if (this.pending.length < this.minSamples) return false;
    const s = [...this.pending].sort((a, b) => a - b);
    const m = s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    this.pending = [];
    if (Math.abs(m) <= this.deadbandS) return false;
    this.delayS = Math.max(0, Math.min(this.maxS, Math.round((this.delayS + m) * 10) / 10));
    return true;
  }
}
