import { describe, it, expect, vi } from 'vitest';
import { Ft8Engine } from './engine.js';
import { createFt8Client } from './client.js';
import { createFt8Decoder } from '../../utils/ft8Wasm.js';
import { goertzelPower } from '../../utils/cwDecoder.js';

/** Fake Emscripten module with the ft8_wrapper ABI over a plain ArrayBuffer. */
function fakeModule(respond) {
  const mem = new ArrayBuffer(16 * 1024 * 1024);
  const mod = {
    HEAPF32: new Float32Array(mem),
    HEAPU8: new Uint8Array(mem),
    live: new Map(),
    next: 1024,
    calls: [],
    _malloc(n) {
      const p = mod.next;
      mod.next += (n + 7) & ~7;
      mod.live.set(p, n);
      return p;
    },
    _free(p) {
      mod.live.delete(p);
    },
    _ft8_free(p) {
      mod.live.delete(p);
    },
    _ft8_reset: vi.fn(),
    _ft8_decode(ptr, n, rate, fMin, fMax) {
      const pcm = mod.HEAPF32.slice(ptr >> 2, (ptr >> 2) + n);
      mod.calls.push({ pcm, rate, fMin, fMax });
      const bytes = new TextEncoder().encode(JSON.stringify(respond(pcm)) + '\0');
      const p = mod._malloc(bytes.length);
      mod.HEAPU8.set(bytes, p);
      return p;
    },
    UTF8ToString(p) {
      let e = p;
      while (mod.HEAPU8[e]) e++;
      return new TextDecoder().decode(mod.HEAPU8.subarray(p, e));
    },
  };
  return mod;
}

describe('createFt8Decoder (JS glue)', () => {
  it('copies PCM into the heap, parses the JSON and frees both buffers', () => {
    const mod = fakeModule(() => [{ snr: -12, dt: 0.3, freq: 1234, text: 'CQ K1ABC FN42' }]);
    const dec = createFt8Decoder(mod);
    const pcm = new Float32Array(180000).map((_, i) => Math.sin(i));
    const out = dec.decode(pcm);
    expect(out).toEqual([{ snr: -12, dt: 0.3, freq: 1234, text: 'CQ K1ABC FN42' }]);
    expect(mod.calls[0]).toMatchObject({ rate: 12000, fMin: 200, fMax: 3000 });
    expect(mod.calls[0].pcm[12345]).toBeCloseTo(Math.sin(12345), 5);
    expect(mod.live.size).toBe(0);
    dec.reset();
    expect(mod._ft8_reset).toHaveBeenCalled();
  });

  it('frees the input even when the decoder fails', () => {
    const mod = fakeModule(() => []);
    mod._ft8_decode = () => 0; // out of memory
    const dec = createFt8Decoder(mod);
    expect(() => dec.decode(new Float32Array(10))).toThrow(/memory/);
    expect(mod.live.size).toBe(0);
  });

  it('refuses something that is not the ft8 module', () => {
    expect(() => createFt8Decoder({})).toThrow();
  });
});

describe('Ft8Engine', () => {
  it('resamples 48 kHz audio, cuts UTC slots and annotates decodes', () => {
    const seen = [];
    const decoder = {
      decode: vi.fn((pcm, rate) => {
        seen.push({ len: pcm.length, rate, p1500: goertzelPower(pcm, 60000, 24000, 12000, 1500) });
        return [
          { snr: 3, dt: 0.1, freq: 1500, text: 'CQ W1AW FN31' },
          { snr: -15, dt: 0.4, freq: 900, text: 'W1AW K1ABC -15' },
        ];
      }),
    };
    const slots = [];
    const eng = new Ft8Engine({ decoder, onSlot: (r) => slots.push(r) });
    const rate = 48000;
    let t = Date.UTC(2026, 9, 15, 14, 30, 0) - 200;
    let phase = 0;
    for (let k = 0; k < 340; k++) {
      // 100 ms chunks of a 1500 Hz tone
      const x = new Float32Array(4800);
      for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin(phase++ * ((2 * Math.PI * 1500) / rate));
      t += 100;
      eng.push(x, rate, t);
    }
    expect(slots.map((s) => new Date(s.slotStartMs).toISOString())).toEqual([
      '2026-10-15T14:30:00.000Z',
      '2026-10-15T14:30:15.000Z',
    ]);
    expect(seen[0]).toMatchObject({ len: 180000, rate: 12000 });
    expect(10 * Math.log10(seen[0].p1500 / 0.09)).toBeGreaterThan(-1); // tone survived resampling
    // sorted by audio frequency, parsed
    expect(slots[0].decodes.map((d) => d.freq)).toEqual([900, 1500]);
    expect(slots[0].decodes[1]).toMatchObject({ cq: true, de: 'W1AW', grid: 'FN31' });
    expect(slots[0].decodes[0]).toMatchObject({ to: 'W1AW', de: 'K1ABC', report: '-15' });
  });

  it('reports a decoder error for the slot instead of throwing', () => {
    const slots = [];
    const eng = new Ft8Engine({
      decoder: {
        decode: () => {
          throw new Error('boom');
        },
      },
      onSlot: (r) => slots.push(r),
    });
    let t = Date.UTC(2026, 9, 15, 14, 30, 0);
    for (let k = 0; k < 160; k++) eng.push(new Float32Array(1200), 12000, (t += 100));
    expect(slots[0]).toMatchObject({ decodes: [], error: 'boom' });
  });
});

describe('createFt8Client', () => {
  it('initialises the worker, forwards audio once ready and relays slots', () => {
    const posted = [];
    class FakeWorker {
      constructor() {
        FakeWorker.inst = this;
      }
      postMessage(m, transfer) {
        posted.push({ m, transfer });
      }
      terminate() {
        this.dead = true;
      }
    }
    const status = [];
    const slots = [];
    const c = createFt8Client({
      WorkerImpl: FakeWorker,
      wasmUrl: '/wasm/ft8.mjs',
      onStatus: (s) => status.push(s),
      onSlot: (s) => slots.push(s),
    });
    expect(posted[0].m).toEqual({ type: 'init', wasmUrl: '/wasm/ft8.mjs' });
    c.push(new Float32Array(4), 48000, 1); // not ready yet → dropped
    expect(posted).toHaveLength(1);
    FakeWorker.inst.onmessage({ data: { type: 'ready' } });
    const s = new Float32Array(4);
    c.push(s, 48000, 2);
    expect(posted[1].m).toMatchObject({ type: 'audio', sampleRate: 48000, endTimeMs: 2 });
    expect(posted[1].transfer).toEqual([s.buffer]);
    FakeWorker.inst.onmessage({ data: { type: 'slot', slotStartMs: 15000, decodes: [] } });
    expect(slots).toHaveLength(1);
    FakeWorker.inst.onmessage({ data: { type: 'unavailable', message: '404' } });
    expect(status).toEqual(['loading', 'ready', 'unavailable']);
    c.terminate();
    expect(FakeWorker.inst.dead).toBe(true);
  });
});
