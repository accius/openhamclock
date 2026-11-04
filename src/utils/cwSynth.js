/**
 * cwSynth.js — synthetic Morse for testing the CW decoder.
 *
 * Builds PARIS-timed keying from text (optionally with a hand-sent "fist"
 * jitter or Farnsworth spacing), renders it as a shaped sine tone with white
 * Gaussian noise at a chosen SNR, and runs PCM through the same
 * ToneDetector → CWDecoder chain the AudioWorklet uses. Used by the vitest
 * suite and by the Decoder panel's built-in test signal.
 */
import { CHAR_TO_MORSE, CWPipeline, ditMsForWpm } from './cwDecoder.js';

/** Deterministic PRNG (mulberry32) so noisy tests are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
export function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Text → [{ on: bool, ms }] keying segments (PARIS timing). `jitter` (0–1)
 * randomly stretches/shrinks every element like a hand-sent fist;
 * `farnsworth` multiplies character and word gaps.
 */
export function keying(text, wpm, { jitter = 0, seed = 1, farnsworth = 1 } = {}) {
  const dit = ditMsForWpm(wpm);
  const rand = rng(seed);
  const j = (ms) => ms * (1 + (rand() * 2 - 1) * jitter);
  const segs = [];
  const words = text.trim().split(/\s+/);
  words.forEach((word, wi) => {
    [...word].forEach((ch, ci) => {
      const code = CHAR_TO_MORSE[ch];
      if (!code) throw new Error(`no morse for ${ch}`);
      [...code].forEach((el, ei) => {
        segs.push({ on: true, ms: j(el === '.' ? dit : 3 * dit) });
        if (ei < code.length - 1) segs.push({ on: false, ms: j(dit) });
      });
      if (ci < word.length - 1) segs.push({ on: false, ms: j(3 * dit * farnsworth) });
    });
    if (wi < words.length - 1) segs.push({ on: false, ms: j(7 * dit * farnsworth) });
  });
  return segs;
}

/**
 * Render keying as PCM: a `toneHz` sine with 5 ms raised-cosine edges, plus
 * white Gaussian noise. `snrDb` is measured in a 2500 Hz reference bandwidth
 * (the conventional receiver SNR figure, as WSJT-X reports it), so a 0 dB
 * signal is as strong as all the noise heard through a voice filter.
 */
export function synthPcm(
  segs,
  { sampleRate = 8000, toneHz = 600, amp = 0.5, snrDb = null, seed = 7, leadMs = 300, tailMs = 600 } = {},
) {
  const totalMs = leadMs + segs.reduce((a, s) => a + s.ms, 0) + tailMs;
  const n = Math.ceil((totalMs / 1000) * sampleRate);
  const pcm = new Float32Array(n);
  const rise = Math.round(0.005 * sampleRate);
  let idx = Math.round((leadMs / 1000) * sampleRate);
  for (const seg of segs) {
    const len = Math.round((seg.ms / 1000) * sampleRate);
    if (seg.on) {
      for (let i = 0; i < len && idx + i < n; i++) {
        let env = 1;
        if (i < rise) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / rise);
        else if (i > len - rise) env = 0.5 - 0.5 * Math.cos((Math.PI * (len - i)) / rise);
        const k = idx + i;
        pcm[k] = amp * env * Math.sin((2 * Math.PI * toneHz * k) / sampleRate);
      }
    }
    idx += len;
  }
  if (snrDb != null) {
    // Signal power amp²/2; noise power in 2500 Hz = σ² · 2500 / (fs/2)
    const sigP = (amp * amp) / 2;
    const noiseIn2500 = sigP / 10 ** (snrDb / 10);
    const sigma = Math.sqrt((noiseIn2500 * (sampleRate / 2)) / 2500);
    const rand = rng(seed);
    for (let i = 0; i < n; i++) pcm[i] += sigma * gauss(rand);
  }
  return pcm;
}

/** Full PCM path, fed in 128-sample render quanta like an AudioWorklet. */
export function decodePcm(pcm, { sampleRate = 8000, toneHz = 600, initialWpm = 20, bandwidth = 'auto' } = {}) {
  let out = '';
  const pipe = new CWPipeline({ sampleRate, tone: toneHz, bandwidth, initialWpm, onText: (s) => (out += s) });
  for (let i = 0; i < pcm.length; i += 128) pipe.process(pcm.subarray(i, i + 128));
  pipe.flush();
  return { text: out.trim().replace(/\s+/g, ' '), wpm: pipe.decoder.wpm };
}

/** Levenshtein distance → character accuracy (1 = perfect, can go negative). */
export function accuracy(expected, got) {
  const a = expected;
  const b = got;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(1, a.length);
}
