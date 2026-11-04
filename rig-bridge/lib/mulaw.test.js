// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { encodeSample, decodeSample, encodeS16be } from './mulaw.js';
import { createMulawDecoder } from '../../src/utils/pcmStream.js';

describe('µ-law codec', () => {
  it('round-trips within G.711 quantisation error across the range', () => {
    for (const s of [0, 1, -1, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000, 32767, -32768]) {
      const back = decodeSample(encodeSample(s));
      const err = Math.abs(back - Math.max(-32635, Math.min(32635, s)));
      // step size grows with level: ≤ ~3 % above the linear segment
      expect(err).toBeLessThanOrEqual(Math.max(8, Math.abs(s) * 0.035));
    }
  });

  it('matches the G.711 reference points', () => {
    expect(encodeSample(0)).toBe(0xff);
    expect(encodeSample(-1)).toBe(0x7f);
    expect(encodeSample(32767)).toBe(0x80);
    expect(encodeSample(-32768)).toBe(0x00);
  });

  it('keeps a sine wave ≥ 35 dB above the quantisation noise', () => {
    const n = 12000;
    const buf = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) buf.writeInt16BE(Math.round(8000 * Math.sin((2 * Math.PI * 700 * i) / 12000)), i * 2);
    const u = encodeS16be(buf);
    expect(u.length).toBe(n);
    // decode with the browser-side decoder (shared table)
    const f = createMulawDecoder()(new Uint8Array(u));
    let sig = 0;
    let err = 0;
    for (let i = 0; i < n; i++) {
      const ref = buf.readInt16BE(i * 2) / 32768;
      sig += ref * ref;
      err += (f[i] - ref) ** 2;
    }
    expect(10 * Math.log10(sig / err)).toBeGreaterThan(35);
  });
});
