/**
 * engine.js — the FT8 receive chain, independent of where it runs.
 *
 *   audio chunks (any rate) + wall clock
 *     → Resampler (→ 12 kHz) → SlotCollector (UTC 15 s slots)
 *     → decoder.decode(pcm) → parseFt8Message → onSlot({ slotStartMs, decodes })
 *
 * The worker (worker.js) wires this to the WASM decoder; tests wire it to a
 * fake one.
 */
import { Resampler, SlotCollector, parseFt8Message } from '../../utils/ft8Dsp.js';
import { FT8_SAMPLE_RATE } from '../../utils/ft8Wasm.js';

export class Ft8Engine {
  /**
   * @param {{ decoder: { decode(pcm: Float32Array, rate: number): Array, reset?(): void },
   *           onSlot: (r: { slotStartMs: number, decodes: Array, decodeMs: number }) => void,
   *           onLevel?: (s: { fill: number, slotStartMs: number|null }) => void,
   *           now?: () => number }} opts
   */
  constructor({ decoder, onSlot, onLevel, now = () => Date.now(), emitAtSec }) {
    this.decoder = decoder;
    this.onSlot = onSlot;
    this.onLevel = onLevel || (() => {});
    this.now = now;
    this.resampler = null;
    this.inRate = 0;
    // emitAtSec: a remote receiver (KiwiSDR) waits a little longer so a
    // transmission that arrives late is not cut off at the slot end
    this.collector = new SlotCollector(emitAtSec ? { emitAtSec } : {});
  }

  /** samples at `sampleRate`; endTimeMs = wall time just after the last sample. */
  push(samples, sampleRate, endTimeMs) {
    if (!this.resampler || sampleRate !== this.inRate) {
      this.inRate = sampleRate;
      this.resampler = new Resampler(sampleRate, FT8_SAMPLE_RATE);
      this.collector.reset();
    }
    const out = this.resampler.process(samples);
    if (!out.length) return null;
    // The resampler holds back ~halfWidth input samples; time the output by
    // its own length ending (halfWidth/inRate) before endTimeMs.
    const lagMs = (this.resampler.halfWidth / sampleRate) * 1000;
    const slot = this.collector.push(out, endTimeMs - lagMs);
    const startMs = this.collector.bufferStartMs;
    this.onLevel({ fill: this.collector.len / FT8_SAMPLE_RATE, bufferStartMs: startMs });
    if (!slot) return null;
    const t0 = this.now();
    let decodes = [];
    try {
      decodes = this.decoder.decode(slot.pcm, FT8_SAMPLE_RATE) || [];
    } catch (err) {
      this.onSlot({ slotStartMs: slot.slotStartMs, decodes: [], decodeMs: 0, error: err?.message || String(err) });
      return null;
    }
    const result = {
      slotStartMs: slot.slotStartMs,
      decodeMs: this.now() - t0,
      decodes: decodes.map((d) => ({ ...d, ...parseFt8Message(d.text) })).sort((a, b) => a.freq - b.freq),
    };
    this.onSlot(result);
    return result;
  }

  reset() {
    this.collector.reset();
    this.resampler = null;
    this.decoder.reset?.();
  }
}
