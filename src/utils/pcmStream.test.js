import { describe, it, expect } from 'vitest';
import { createS16beDecoder, PlayheadScheduler } from './pcmStream.js';

const s16be = (values) => {
  const b = new Uint8Array(values.length * 2);
  const dv = new DataView(b.buffer);
  values.forEach((v, i) => dv.setInt16(i * 2, v, false));
  return b;
};

describe('createS16beDecoder', () => {
  it('decodes big-endian samples to −1…1 floats', () => {
    const out = createS16beDecoder()(s16be([0, 16384, -16384, 32767, -32768]));
    expect(Array.from(out)).toEqual([0, 0.5, -0.5, 32767 / 32768, -1]);
  });

  it('carries a sample split across chunk boundaries', () => {
    const bytes = s16be([1000, -2000, 3000]);
    const dec = createS16beDecoder();
    const a = dec(bytes.subarray(0, 3)); // one whole sample + half of the next
    const b = dec(bytes.subarray(3, 5)); // other half + half of the third
    const c = dec(bytes.subarray(5));
    const all = [...a, ...b, ...c].map((v) => Math.round(v * 32768));
    expect(all).toEqual([1000, -2000, 3000]);
    expect(a.length).toBe(1);
  });

  it('handles empty and single-byte chunks', () => {
    const dec = createS16beDecoder();
    expect(dec(new Uint8Array(0)).length).toBe(0);
    expect(dec(new Uint8Array([0x7f])).length).toBe(0);
    expect(Math.round(dec(new Uint8Array([0xff]))[0] * 32768)).toBe(32767);
  });
});

describe('PlayheadScheduler', () => {
  it('starts with a lead and plays chunks back to back', () => {
    const s = new PlayheadScheduler({ leadSec: 0.25 });
    expect(s.next(10, 0.04)).toBeCloseTo(10.25);
    expect(s.next(10.01, 0.04)).toBeCloseTo(10.29);
    expect(s.backlog(10.01)).toBeCloseTo(0.32);
  });

  it('recovers from an underrun with a fresh lead and counts it', () => {
    const s = new PlayheadScheduler({ leadSec: 0.2 });
    s.next(0, 0.1);
    expect(s.next(5, 0.1)).toBeCloseTo(5.2);
    expect(s.underruns).toBe(1);
  });

  it('drops chunks while the backlog is too long', () => {
    const s = new PlayheadScheduler({ leadSec: 0.1, maxLagSec: 0.5 });
    let dropped = 0;
    for (let i = 0; i < 20; i++) if (s.next(0, 0.1) === null) dropped++;
    expect(dropped).toBeGreaterThan(10);
    expect(s.backlog(0)).toBeLessThanOrEqual(0.6);
  });
});
