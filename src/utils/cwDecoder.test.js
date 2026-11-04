/**
 * CW decoder core tests — synthetic keying at several speeds and noise
 * levels, through both the timing machine alone (keyed envelope) and the
 * full PCM path (Goertzel tone detector → adaptive threshold → text).
 *
 * SNR figures are in a 2500 Hz reference bandwidth (see cwSynth.synthPcm).
 * Measured accuracy at the time of writing (3 seeds, QSO + rag-chew text):
 *   12–25 WPM: 100 % clean through −3 dB; 20 WPM −5 dB ≈ 96 %, 25 WPM −5 dB ≈ 86 %
 *   35 WPM:    100 % through 0 dB, ≈ 90 % at −3 dB
 *   −8 dB and below: unusable (the squelch mostly stays shut, by design)
 * The thresholds below sit a little under those numbers so a regression in
 * any stage fails loudly without making the suite flaky.
 */
import { describe, it, expect } from 'vitest';
import {
  CWDecoder,
  CWPipeline,
  ToneFinder,
  autoBandwidthForDit,
  ditMsForWpm,
  findCallsigns,
  goertzelPower,
  tokenizeCallsigns,
  twoMeans,
} from './cwDecoder.js';
import { accuracy, decodePcm, keying, synthPcm } from './cwSynth.js';

/** Drive the timing machine directly from keying segments at `stepMs`. */
function decodeEnvelope(segs, wpm, { stepMs = 2, initialWpm = 20 } = {}) {
  let out = '';
  const dec = new CWDecoder({ onText: (s) => (out += s), initialWpm });
  const all = [{ on: false, ms: 200 }, ...segs, { on: false, ms: ditMsForWpm(wpm) * 12 }];
  let carry = 0;
  for (const seg of all) {
    let t = seg.ms + carry;
    while (t >= stepMs) {
      dec.processEnvelope(seg.on, stepMs);
      t -= stepMs;
    }
    carry = t;
  }
  dec.flush();
  return { text: out.trim().replace(/\s+/g, ' '), wpm: dec.wpm };
}

const QSO = 'CQ CQ DE W1AW W1AW K';
const RAG = 'TNX FER CALL UR RST 599 5NN NAME BOB QTH NEWINGTON CT HW? BK';
const TEXT = `${QSO} ${RAG}`;

// ── Goertzel / detectors ──────────────────────────────────────────────────

describe('goertzelPower', () => {
  it('returns ≈ A² for an on-frequency sine and ≈ 0 well off frequency', () => {
    const fs = 8000;
    const n = 400;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 600 * i) / fs);
    expect(goertzelPower(x, 0, n, fs, 600)).toBeCloseTo(0.25, 2);
    expect(goertzelPower(x, 0, n, fs, 1400)).toBeLessThan(0.001);
  });
});

describe('ToneFinder', () => {
  it('finds a keyed 730 Hz tone within ±15 Hz in noise', () => {
    const fs = 8000;
    const pcm = synthPcm(keying('CQ CQ TEST', 20), { sampleRate: fs, toneHz: 730, snrDb: 0 });
    const finder = new ToneFinder({ sampleRate: fs });
    finder.process(pcm);
    const best = finder.best();
    expect(Math.abs(best.freq - 730)).toBeLessThanOrEqual(15);
    expect(best.snrDb).toBeGreaterThan(10);
  });
});

describe('helpers', () => {
  it('twoMeans separates dots from dashes and refuses a single cluster', () => {
    const s = twoMeans([60, 62, 180, 58, 175, 185]);
    expect(s.lo).toBeCloseTo(60, 0);
    expect(s.hi).toBeCloseTo(180, 0);
    expect(twoMeans([60, 61, 59, 62])).toBeNull();
  });

  it('auto bandwidth narrows for slow senders and is clamped', () => {
    expect(autoBandwidthForDit(ditMsForWpm(45))).toBeGreaterThan(autoBandwidthForDit(ditMsForWpm(15)));
    expect(autoBandwidthForDit(ditMsForWpm(5))).toBe(50);
    expect(autoBandwidthForDit(5)).toBe(200);
  });
});

// ── Timing machine on clean keyed envelopes ───────────────────────────────

describe('CWDecoder — keyed envelope', () => {
  for (const wpm of [5, 12, 20, 30, 45]) {
    it(`decodes perfect keying at ${wpm} WPM and tracks the speed`, () => {
      const { text, wpm: est } = decodeEnvelope(keying(TEXT, wpm), wpm);
      expect(accuracy(TEXT, text), text).toBeGreaterThanOrEqual(0.97);
      expect(text.endsWith('NEWINGTON CT HW? BK')).toBe(true);
      expect(Math.abs(est - wpm) / wpm).toBeLessThan(0.12);
    });
  }

  it('decodes a hand-sent fist (±20 % element jitter) at 18 WPM', () => {
    const { text } = decodeEnvelope(keying(TEXT, 18, { jitter: 0.2, seed: 3 }), 18);
    expect(accuracy(TEXT, text), text).toBeGreaterThanOrEqual(0.9);
  });

  it('adapts when the sender changes speed mid-stream (25 → 12 WPM)', () => {
    const segs = [
      ...keying('CQ CQ DE K1ABC K1ABC', 25),
      { on: false, ms: 7 * ditMsForWpm(25) },
      ...keying('R R TNX QSO 73 SK', 12),
    ];
    const { text, wpm } = decodeEnvelope(segs, 12);
    expect(text.endsWith('TNX QSO 73 SK'), text).toBe(true);
    expect(Math.abs(wpm - 12)).toBeLessThanOrEqual(2);
  });

  it('learns Farnsworth spacing (20 WPM characters, 2× gaps) without splitting words', () => {
    const { text } = decodeEnvelope(keying(TEXT, 20, { farnsworth: 2 }), 20);
    // Until a few gaps have been seen, a stretched character gap reads as a
    // word space; after that the copy must be exact.
    expect(text.endsWith('NAME BOB QTH NEWINGTON CT HW? BK'), text).toBe(true);
    expect(accuracy(TEXT, text), text).toBeGreaterThanOrEqual(0.9);
  });

  it('decodes prosigns as their bracket form', () => {
    let out = '';
    const dec = new CWDecoder({ onText: (s) => (out += s), initialWpm: 20 });
    const dit = ditMsForWpm(20);
    for (const el of '...-.-') {
      for (let t = 0; t < (el === '.' ? dit : 3 * dit); t += 2) dec.processEnvelope(true, 2);
      for (let t = 0; t < dit; t += 2) dec.processEnvelope(false, 2);
    }
    dec.flush();
    expect(out).toBe('<SK>');
  });

  it('ignores a long carrier (tune-up) instead of printing a dash', () => {
    let out = '';
    const dec = new CWDecoder({ onText: (s) => (out += s), initialWpm: 20 });
    for (let t = 0; t < 3000; t += 2) dec.processEnvelope(true, 2);
    for (let t = 0; t < 1000; t += 2) dec.processEnvelope(false, 2);
    dec.flush();
    expect(out.trim()).toBe('');
  });
});

// ── Full PCM path with noise ──────────────────────────────────────────────

describe('CWPipeline — PCM through the Goertzel tone detector', () => {
  const cases = [
    { wpm: 12, snrDb: null, min: 0.97 },
    { wpm: 20, snrDb: null, min: 0.97 },
    { wpm: 35, snrDb: null, min: 0.97 },
    { wpm: 45, snrDb: null, min: 0.95 },
    { wpm: 20, snrDb: 10, min: 0.97 },
    { wpm: 25, snrDb: 0, min: 0.97 },
    { wpm: 12, snrDb: -3, min: 0.95 },
    { wpm: 20, snrDb: -3, min: 0.95 },
    { wpm: 20, snrDb: -5, min: 0.8 },
  ];
  for (const { wpm, snrDb, min } of cases) {
    const label = snrDb == null ? 'clean' : `${snrDb} dB SNR`;
    it(`${wpm} WPM, ${label}: ≥ ${Math.round(min * 100)} % character accuracy`, () => {
      const pcm = synthPcm(keying(TEXT, wpm), { snrDb, seed: wpm * 31 + 1 });
      const { text: got, wpm: est } = decodePcm(pcm);
      const acc = accuracy(TEXT, got);
      expect(acc, `decoded: "${got}" (${(acc * 100).toFixed(1)} %)`).toBeGreaterThanOrEqual(min);
      expect(Math.abs(est - wpm) / wpm).toBeLessThan(0.2);
    });
  }

  it('decodes at 48 kHz (typical sound-card rate) and an off-default tone', () => {
    const pcm = synthPcm(keying(QSO, 22), { sampleRate: 48000, toneHz: 800, snrDb: 5 });
    const { text: got } = decodePcm(pcm, { sampleRate: 48000, toneHz: 800 });
    expect(accuracy(QSO, got), got).toBeGreaterThanOrEqual(0.95);
  });

  it('works with a fixed (non-auto) filter width', () => {
    const pcm = synthPcm(keying(QSO, 25), { snrDb: 3 });
    const { text: got } = decodePcm(pcm, { bandwidth: 150 });
    expect(accuracy(QSO, got), got).toBeGreaterThanOrEqual(0.95);
  });

  it('copies nothing when the filter is far off the signal pitch', () => {
    const pcm = synthPcm(keying(QSO, 20), { toneHz: 1000, snrDb: 10 });
    const { text: got } = decodePcm(pcm, { toneHz: 600 });
    expect(got.replace(/\s/g, '').length).toBeLessThanOrEqual(2);
  });

  it('prints nothing from 20 s of pure noise (squelch)', () => {
    const pcm = synthPcm([{ on: false, ms: 20000 }], { snrDb: 0 });
    const { text: got } = decodePcm(pcm);
    expect(got.replace(/\s/g, '').length).toBeLessThanOrEqual(2);
  });

  it('reports state for the meters', () => {
    const pipe = new CWPipeline({ sampleRate: 8000 });
    pipe.process(synthPcm(keying('TEST', 20), { snrDb: 10 }));
    const s = pipe.getState();
    expect(s.wpm).toBeGreaterThan(14);
    expect(s.wpm).toBeLessThan(26);
    expect(s.snrDb).toBeGreaterThan(10);
    expect(s.tone).toBe(600);
    expect(s.bandwidth).toBeGreaterThanOrEqual(50);
  });

  it('finds the tone when the tone finder is enabled', () => {
    const pipe = new CWPipeline({ sampleRate: 8000, findTone: true });
    pipe.process(synthPcm(keying('CQ CQ CQ', 18), { toneHz: 520, snrDb: 3 }));
    expect(Math.abs(pipe.finder.best().freq - 520)).toBeLessThanOrEqual(15);
  });
});

// ── Off-tune gate ─────────────────────────────────────────────────────────

describe('CWPipeline — off-tune gate', () => {
  const B = 'TEST DE K9ZZ K9ZZ TEST UP 1 5NN TU EE TEST DE K9ZZ QRZ? TEST K9ZZ AGN 73';
  const mix = (...xs) => {
    const out = new Float32Array(Math.max(...xs.map((x) => x.length)));
    for (const x of xs) for (let i = 0; i < x.length; i++) out[i] += x[i];
    return out;
  };
  const run = (pcm, opts = {}) => {
    let out = '';
    const pipe = new CWPipeline({ sampleRate: 8000, tone: 600, onText: (s) => (out += s), ...opts });
    let offTuneSeen = 0;
    for (let i = 0; i < pcm.length; i += 128) {
      pipe.process(pcm.subarray(i, i + 128));
      if (pipe.getState().offTuneHz) offTuneSeen = pipe.getState().offTuneHz;
    }
    pipe.flush();
    return { text: out.trim().replace(/\s+/g, ' '), offTuneSeen, pipe };
  };

  // Without the gate these print 30–300 characters of E/T/I junk (key clicks
  // and skirt leakage from the station next door); with it, only what slips
  // out in the second or so before the gate engages.
  for (const [wpm, off, snr] of [
    [15, 80, 10],
    [20, 100, 10],
    [20, 150, null],
    [15, -120, null],
  ]) {
    it(`${wpm} WPM station ${off > 0 ? '+' : ''}${off} Hz from the passband: no junk, reports the side`, () => {
      const pcm = synthPcm(keying(B, wpm), { toneHz: 600 + off, snrDb: snr, seed: 5 });
      const ungated = run(pcm, { offTuneGate: false });
      const gated = run(pcm);
      expect(ungated.text.replace(/\s/g, '').length).toBeGreaterThan(25);
      expect(gated.text.replace(/\s/g, '').length).toBeLessThanOrEqual(20);
      expect(Math.sign(gated.offTuneSeen)).toBe(Math.sign(off));
      // the hint points at the station, so "Retune" lands on it
      expect(Math.abs(gated.offTuneSeen - off), `estimated ${gated.offTuneSeen} Hz`).toBeLessThanOrEqual(15);
    });
  }

  // A different station in the passband with a stronger neighbour: its keying
  // is independent of the neighbour's, so the gate must stay open.
  for (const [wpm, off, db] of [
    [20, 100, 10],
    [20, 150, 20],
    [30, 80, 10],
    [30, 250, 20],
  ]) {
    it(`${wpm} WPM in the passband, neighbour +${off} Hz at +${db} dB: copy intact`, () => {
      const a = synthPcm(keying(TEXT, wpm), { toneHz: 600, snrDb: 10, seed: 1 });
      const b = synthPcm(keying(B, wpm + 3, { seed: 9 }), { toneHz: 600 + off, amp: 0.5 * 10 ** (db / 20), seed: 2 });
      const { text } = run(mix(a, b));
      expect(accuracy(TEXT, text), text).toBeGreaterThanOrEqual(0.97);
    });
  }

  it('copy resumes once the passband is moved onto the station', () => {
    const pcm = synthPcm(keying(`${B} ${B}`, 20), { toneHz: 700, snrDb: 10, seed: 3 });
    let out = '';
    const pipe = new CWPipeline({ sampleRate: 8000, tone: 600, onText: (s) => (out += s) });
    const half = Math.floor(pcm.length / 2);
    for (let i = 0; i < half; i += 128) pipe.process(pcm.subarray(i, Math.min(i + 128, half)));
    expect(pipe.getState().offTuneHz).toBeGreaterThan(0);
    const before = out.length;
    pipe.setTone(600 + pipe.getState().offTuneHz); // what the panel's "retune" hint suggests
    for (let i = half; i < pcm.length; i += 128) pipe.process(pcm.subarray(i, i + 128));
    pipe.flush();
    expect(out.slice(before)).toContain('K9ZZ');
  });
});

// ── Callsigns ─────────────────────────────────────────────────────────────

describe('findCallsigns / tokenizeCallsigns', () => {
  it('pulls callsigns out of decoded copy and skips RST/Q-codes', () => {
    const calls = findCallsigns('CQ CQ DE W1AW W1AW K VK2ABC/P TEST 599 5NN QTH').map((c) => c.call);
    expect(calls).toEqual(['W1AW', 'VK2ABC/P']);
  });

  it('matches portable prefixes and numeric-first prefixes', () => {
    expect(findCallsigns('DE 5Z4/OZ6ABL K').map((c) => c.call)).toEqual(['5Z4/OZ6ABL']);
    expect(findCallsigns('TU 9A1A').map((c) => c.call)).toEqual(['9A1A']);
  });

  it('finds adjacent callsigns separated by single spaces', () => {
    expect(findCallsigns('K1ABC DE W2XYZ').map((c) => c.call)).toEqual(['K1ABC', 'W2XYZ']);
  });

  it('tokenizes into clickable runs that reassemble the text', () => {
    const src = 'CQ DE K1ABC K1ABC K';
    const runs = tokenizeCallsigns(src);
    expect(runs.map((r) => r.text).join('')).toBe(src);
    expect(runs.filter((r) => r.call).map((r) => r.call)).toEqual(['K1ABC', 'K1ABC']);
  });
});
