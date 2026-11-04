/**
 * Runs the real AudioWorklet module in a fake AudioWorkletGlobalScope:
 * registerProcessor / AudioWorkletProcessor / sampleRate / currentTime are
 * provided as globals, then synthetic CW is pushed through process() in
 * 128-sample render quanta exactly as the browser would.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { keying, synthPcm, accuracy } from '../utils/cwSynth.js';

const RATE = 48000;
let Processor = null;
let TapProcessor = null;

class FakePort {
  constructor() {
    this.sent = [];
    this.onmessage = null;
  }
  postMessage(m) {
    this.sent.push(m);
  }
  deliver(data) {
    this.onmessage?.({ data });
  }
}

beforeAll(async () => {
  globalThis.sampleRate = RATE;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = new FakePort();
    }
  };
  globalThis.registerProcessor = (name, cls) => {
    if (name === 'cw-decoder') Processor = cls;
    if (name === 'pcm-tap') TapProcessor = cls;
  };
  await import('./cwDecoderWorklet.js');
});

function run(proc, pcm) {
  for (let i = 0; i < pcm.length; i += 128) {
    globalThis.currentTime = i / RATE;
    proc.process([[pcm.subarray(i, i + 128)]]);
  }
}

const textOf = (proc) =>
  proc.port.sent
    .map((m) => m.text)
    .join('')
    .trim()
    .replace(/\s+/g, ' ');

describe('cw-decoder AudioWorklet', () => {
  it('registers and decodes CW posted back to the main thread', () => {
    expect(Processor).toBeTypeOf('function');
    const proc = new Processor({ processorOptions: { tone: 700, bandwidth: 'auto' } });
    const msg = 'CQ CQ DE K1ABC K1ABC K';
    run(proc, synthPcm(keying(msg, 22), { sampleRate: RATE, toneHz: 700, snrDb: 6 }));
    proc.pipe.flush();
    expect(accuracy(msg, textOf(proc))).toBeGreaterThanOrEqual(0.95);
    const last = proc.port.sent.at(-1);
    expect(last.type).toBe('update');
    expect(last.state.wpm).toBeGreaterThan(17);
    expect(last.state.wpm).toBeLessThan(27);
    // ~10 updates per second of audio, not one per render quantum
    const seconds = proc.port.sent.length / 10;
    expect(seconds).toBeGreaterThan(2);
    expect(proc.port.sent.length).toBeLessThan(200);
  });

  it('Find locks onto the strongest tone and then decodes it', () => {
    const proc = new Processor({ processorOptions: { tone: 600 } });
    proc.port.deliver({ type: 'find', seconds: 2 });
    const msg = 'TEST DE W1AW W1AW W1AW TEST DE W1AW';
    run(proc, synthPcm(keying(msg, 20), { sampleRate: RATE, toneHz: 840, snrDb: 3 }));
    const found = proc.port.sent.find((m) => m.found)?.found;
    expect(found).toBeTruthy();
    expect(Math.abs(found.freq - 840)).toBeLessThanOrEqual(15);
    expect(proc.pipe.tone).toBe(found.freq);
    proc.pipe.flush();
    expect(textOf(proc)).toContain('W1AW');
  });

  it('accepts tone / filter / squelch / reset messages', () => {
    const proc = new Processor({ processorOptions: {} });
    proc.port.deliver({ type: 'tone', hz: 512 });
    proc.port.deliver({ type: 'bandwidth', value: 150 });
    proc.port.deliver({ type: 'squelch', level: 'high' });
    expect(proc.pipe.tone).toBe(512);
    expect(proc.pipe.bandwidth).toBe(150);
    expect(proc.pipe.decoder.minSnrDb).toBe(9);
    proc.port.deliver({ type: 'bandwidth', value: 'auto' });
    expect(proc.pipe.autoBandwidth).toBe(true);
    proc.port.deliver({ type: 'reset' });
    expect(proc.pipe.decoder.decodedChars).toBe(0);
  });

  it('reports the off-tune state with the meters', () => {
    const proc = new Processor({ processorOptions: { tone: 600 } });
    run(
      proc,
      synthPcm(keying('TEST DE K9ZZ K9ZZ TEST UP 1 5NN TU EE TEST DE K9ZZ QRZ? TEST K9ZZ AGN 73', 20), {
        sampleRate: RATE,
        toneHz: 700,
        snrDb: 10,
      }),
    );
    expect(proc.port.sent.some((m) => m.state.offTuneHz > 0)).toBe(true);
  });
});

describe('pcm-tap AudioWorklet', () => {
  it('hands the main thread contiguous 4096-sample batches with the audio-clock end time', () => {
    expect(TapProcessor).toBeTypeOf('function');
    const tap = new TapProcessor();
    const x = new Float32Array(10000).map((_, i) => i);
    run(tap, x);
    const batches = tap.port.sent;
    expect(batches).toHaveLength(2); // 8192 of 10000 samples
    expect(batches[0].samples).toHaveLength(4096);
    expect(batches[0].samples[0]).toBe(0);
    expect(batches[1].samples[0]).toBe(4096); // nothing lost or repeated between batches
    expect(batches[0].endTime).toBeCloseTo(4096 / RATE, 6);
    expect(batches[1].endTime).toBeCloseTo(8192 / RATE, 6);
  });
});
