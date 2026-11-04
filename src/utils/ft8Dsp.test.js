import { describe, it, expect } from 'vitest';
import { ReceiverDelayTracker, Resampler, SlotCollector, parseFt8Message, slotLabel } from './ft8Dsp.js';
import { goertzelPower } from './cwDecoder.js';

const tone = (rate, hz, seconds, amp = 0.5) => {
  const n = Math.round(rate * seconds);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
};

/** Run a resampler over `x` in irregular chunks (like real audio callbacks). */
const resampleChunked = (r, x) => {
  const parts = [];
  let i = 0;
  let k = 0;
  while (i < x.length) {
    const n = [128, 4096, 777, 2048][k++ % 4];
    parts.push(r.process(x.subarray(i, i + n)));
    i += n;
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe('Resampler', () => {
  for (const inRate of [48000, 44100, 12001, 8000]) {
    it(`${inRate} Hz → 12 kHz keeps the length and a 1500 Hz tone`, () => {
      const out = resampleChunked(new Resampler(inRate, 12000), tone(inRate, 1500, 2));
      expect(Math.abs(out.length - 24000)).toBeLessThan(80);
      const seg = out.subarray(2000, 14000);
      const p = goertzelPower(seg, 0, seg.length, 12000, 1500);
      expect(10 * Math.log10(p / 0.25)).toBeGreaterThan(-0.5); // passband ≈ flat
      expect(goertzelPower(seg, 0, seg.length, 12000, 2500)).toBeLessThan(1e-4);
    });
  }

  it('rejects energy above the new Nyquist (no aliasing)', () => {
    // 9 kHz at 48 kHz would alias to 3 kHz at 12 kHz without the low-pass
    const out = resampleChunked(new Resampler(48000, 12000), tone(48000, 9000, 1));
    const seg = out.subarray(1000, 11000);
    const leak = goertzelPower(seg, 0, seg.length, 12000, 3000) / 0.25;
    expect(10 * Math.log10(leak + 1e-15)).toBeLessThan(-50);
  });
});

describe('SlotCollector', () => {
  const rate = 12000;
  const feed = (c, startMs, seconds, chunk = 1200) => {
    let t = startMs;
    const out = [];
    const total = Math.round(seconds * rate);
    for (let i = 0; i < total; i += chunk) {
      const n = Math.min(chunk, total - i);
      const s = new Float32Array(n).fill(((t / 1000) % 15) / 15); // value encodes slot time
      t += (n / rate) * 1000;
      const slot = c.push(s, t);
      if (slot) out.push(slot);
    }
    return out;
  };

  it('emits one 15 s buffer per UTC slot, aligned to :00/:15/:30/:45', () => {
    const c = new SlotCollector();
    const t0 = Date.UTC(2026, 9, 15, 14, 30, 0) - 300; // start 0.3 s before a slot
    const slots = feed(c, t0, 46);
    expect(slots.map((s) => slotLabel(s.slotStartMs))).toEqual(['143000', '143015', '143030']);
    for (const s of slots) {
      expect(s.slotStartMs % 15000).toBe(0);
      expect(s.pcm.length).toBe(180000);
      // first sample of the buffer is audio recorded at slot time ≈ 0 s
      expect(s.pcm[10]).toBeLessThan(0.01);
      expect(s.pcm[12000 * 10]).toBeCloseTo(10 / 15, 2);
    }
  });

  it('skips a slot joined too late and zero-fills nothing it did not hear', () => {
    const c = new SlotCollector();
    const t0 = Date.UTC(2026, 9, 15, 14, 30, 5); // 5 s into a slot
    const slots = feed(c, t0, 26);
    expect(slots.map((s) => slotLabel(s.slotStartMs))).toEqual(['143015']);
  });

  it('starts over after a gap in the audio', () => {
    const c = new SlotCollector();
    const t0 = Date.UTC(2026, 9, 15, 14, 30, 0) - 100;
    feed(c, t0, 8);
    // 3 s of nothing (throttled tab), then audio resumes mid-slot
    const slots = feed(c, t0 + 11000, 20);
    expect(slots.map((s) => slotLabel(s.slotStartMs))).toEqual(['143015']);
  });
});

describe('parseFt8Message', () => {
  it('reads CQ calls with and without a modifier', () => {
    expect(parseFt8Message('CQ K1ABC FN42')).toMatchObject({ cq: true, de: 'K1ABC', grid: 'FN42', calls: ['K1ABC'] });
    expect(parseFt8Message('CQ POTA W1AW FN31')).toMatchObject({ cq: true, cqTo: 'POTA', de: 'W1AW', grid: 'FN31' });
    expect(parseFt8Message('CQ DX R6WA LN32')).toMatchObject({ cq: true, cqTo: 'DX', de: 'R6WA' });
  });

  it('reads exchanges, reports and acknowledgements', () => {
    expect(parseFt8Message('K1ABC W9XYZ -12')).toMatchObject({ cq: false, to: 'K1ABC', de: 'W9XYZ', report: '-12' });
    expect(parseFt8Message('W9XYZ K1ABC R-09')).toMatchObject({ report: 'R-09' });
    expect(parseFt8Message('W9XYZ K1ABC RR73')).toMatchObject({ ack: 'RR73', grid: null });
    expect(parseFt8Message('OH3NIV ZS6S -03').calls).toEqual(['OH3NIV', 'ZS6S']);
  });

  it('handles hashed and portable calls', () => {
    expect(parseFt8Message('<...> RY8CAA R-10')).toMatchObject({ to: null, de: 'RY8CAA' });
    expect(parseFt8Message('GI7KMC F8IJV/P 73')).toMatchObject({ de: 'F8IJV/P', ack: '73' });
    expect(parseFt8Message('<PJ4/K1ABC> W9XYZ -05').to).toBe('PJ4/K1ABC');
  });
});

describe('ReceiverDelayTracker', () => {
  it('learns a constant remote-receiver delay from the median DT', () => {
    const t = new ReceiverDelayTracker();
    // ten stations, clocks within ±0.3 s, all heard 0.8 s late
    const late = [0.9, 0.6, 0.8, 1.1, 0.7, 0.8, 0.5, 0.9, 0.8, 0.8];
    expect(t.add(late.slice(0, 5))).toBe(false); // not enough yet
    expect(t.add(late.slice(5))).toBe(true);
    expect(t.delayS).toBe(0.8);
    // with the audio shifted by 0.8 s the next slots read ≈ 0: no change
    expect(t.add(late.map((d) => Math.round((d - 0.8) * 10) / 10))).toBe(false);
    expect(t.delayS).toBe(0.8);
  });

  it('ignores small offsets, refuses to go negative and caps the delay', () => {
    const t = new ReceiverDelayTracker();
    expect(t.add([0.1, 0.0, 0.2, 0.1, -0.1, 0.1, 0.0, 0.1])).toBe(false);
    t.add(Array(8).fill(-1));
    expect(t.delayS).toBe(0);
    t.add(Array(8).fill(4.9));
    expect(t.delayS).toBe(4);
  });
});
