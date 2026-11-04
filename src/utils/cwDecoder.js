/**
 * cwDecoder.js — pure-JS CW (Morse) decoder core.
 *
 * Pipeline:  PCM → ToneDetector (Goertzel at the sidetone pitch, Hann window,
 *            75 % overlap) → tone power per hop → CWDecoder (dit-matched
 *            post-detection smoothing, adaptive threshold with hysteresis,
 *            glitch/dropout filter, dit-length tracking, dot/dash/gap
 *            classification, Morse table) → text.
 *
 * ToneFinder scans a pitch range and reports the strongest keyed tone so the
 * panel can "auto-find" a signal instead of asking the operator to guess.
 *
 * IMPORTANT: this file has NO imports and touches no DOM/Web Audio API — it
 * runs inside the AudioWorkletGlobalScope (src/worklets/cwDecoderWorklet.js
 * imports it; Vite bundles the pair via `?worker&url`) as well as in vitest.
 */

// ── Morse table ───────────────────────────────────────────────────────────
export const MORSE_TABLE = {
  '.-': 'A',
  '-...': 'B',
  '-.-.': 'C',
  '-..': 'D',
  '.': 'E',
  '..-.': 'F',
  '--.': 'G',
  '....': 'H',
  '..': 'I',
  '.---': 'J',
  '-.-': 'K',
  '.-..': 'L',
  '--': 'M',
  '-.': 'N',
  '---': 'O',
  '.--.': 'P',
  '--.-': 'Q',
  '.-.': 'R',
  '...': 'S',
  '-': 'T',
  '..-': 'U',
  '...-': 'V',
  '.--': 'W',
  '-..-': 'X',
  '-.--': 'Y',
  '--..': 'Z',
  '-----': '0',
  '.----': '1',
  '..---': '2',
  '...--': '3',
  '....-': '4',
  '.....': '5',
  '-....': '6',
  '--...': '7',
  '---..': '8',
  '----.': '9',
  '.-.-.-': '.',
  '--..--': ',',
  '..--..': '?',
  '-..-.': '/',
  '-...-': '=',
  '.-.-.': '+',
  '-....-': '-',
  '.--.-.': '@',
  '---...': ':',
  '.----.': "'",
  '-.--.': '(',
  '-.--.-': ')',
  '..--.-': '_',
  '.-..-.': '"',
  '...-..-': '$',
  '-.-.--': '!',
  '.-...': '<AS>',
  '...-.-': '<SK>',
  '-.-.-': '<KA>',
};

/** Reverse table: character → dots/dashes (used by the synthesizer/tests). */
export const CHAR_TO_MORSE = (() => {
  const out = {};
  for (const [code, ch] of Object.entries(MORSE_TABLE)) if (!(ch in out)) out[ch] = code;
  return out;
})();

export const CW_MIN_WPM = 5;
export const CW_MAX_WPM = 45;
export const CW_DEFAULT_TONE_HZ = 600;
export const CW_DEFAULT_BANDWIDTH_HZ = 100;

/** PARIS timing: one dit in ms at a given WPM. */
export function ditMsForWpm(wpm) {
  return 1200 / wpm;
}

/** Inverse of ditMsForWpm. */
export function wpmForDitMs(ditMs) {
  return 1200 / ditMs;
}

// ── Goertzel ──────────────────────────────────────────────────────────────

/**
 * Goertzel power of `length` samples starting at `start`, at `freq` Hz.
 * `window` (optional Float32Array of `length`) is multiplied in. The result
 * is normalised so a full-amplitude-A sine returns ≈ A² (with a Hann window
 * the coherent gain is 0.5, so pass `windowGain` = 0.5 to compensate).
 */
export function goertzelPower(samples, start, length, sampleRate, freq, window, windowGain = 1) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  if (window) {
    for (let i = 0; i < length; i++) {
      const s0 = samples[start + i] * window[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
  } else {
    for (let i = 0; i < length; i++) {
      const s0 = samples[start + i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  const norm = (length * windowGain) / 2;
  return power / (norm * norm);
}

/** Hann window of n samples (coherent gain 0.5, noise bandwidth 1.5 bins). */
export function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// ── ToneDetector: PCM → tone power per hop ────────────────────────────────

/**
 * Narrow bandpass energy detector built on Goertzel. Accepts PCM chunks of
 * any length, keeps a ring buffer of one analysis window and emits one power
 * value every `hop` samples (75 % overlap, Hann window).
 *
 * `bandwidth` is the filter's equivalent noise bandwidth in Hz: the window
 * length is 1.5·sampleRate/bandwidth (a Hann window spans 1.5 bins of noise).
 * Narrower = better weak-signal copy but less tuning tolerance (±bw/2).
 */
export class ToneDetector {
  constructor({
    sampleRate = 48000,
    tone = CW_DEFAULT_TONE_HZ,
    bandwidth = CW_DEFAULT_BANDWIDTH_HZ,
    probeFactors = null,
  } = {}) {
    this.sampleRate = sampleRate;
    this.tone = tone;
    // Optional off-tune probes at tone ± factor·bandwidth (just outside the
    // Hann main lobe, which spans ±1.33·bandwidth). See OffTuneTracker.
    this.probeFactors = probeFactors;
    this.probeOut = { lo: 0, hi: 0, loHz: 0, hiHz: 0 };
    this.setBandwidth(bandwidth);
  }

  setTone(hz) {
    this.tone = hz;
  }

  setBandwidth(bandwidth) {
    this.bandwidth = bandwidth;
    // Window length a multiple of 4 (so the hop is an integer), ≥ 32 samples
    const n = Math.max(32, Math.round((1.5 * this.sampleRate) / bandwidth / 4) * 4);
    this.n = n;
    this.hop = n / 4;
    this.hopMs = (this.hop / this.sampleRate) * 1000;
    this.window = hannWindow(n);
    this.ring = new Float32Array(n);
    this.linear = new Float32Array(n);
    this.writePos = 0;
    this.sinceHop = 0;
    this.filled = 0;
  }

  /**
   * Feed PCM. `onPower(power, dtMs, probes)` is called once per hop with the
   * tone power (≈ amplitude²) over the last window and the hop duration in ms;
   * `probes` ({ lo, hi, loHz, hiHz }, a reused object) is set when
   * probeFactors were given.
   */
  process(chunk, onPower) {
    const { n, hop } = this;
    for (let i = 0; i < chunk.length; i++) {
      this.ring[this.writePos] = chunk[i];
      this.writePos = (this.writePos + 1) % n;
      if (this.filled < n) this.filled++;
      if (++this.sinceHop >= hop && this.filled >= n) {
        this.sinceHop = 0;
        // Unroll the ring into a linear buffer (oldest sample first)
        const tail = n - this.writePos;
        this.linear.set(this.ring.subarray(this.writePos), 0);
        this.linear.set(this.ring.subarray(0, this.writePos), tail);
        const p = goertzelPower(this.linear, 0, n, this.sampleRate, this.tone, this.window, 0.5);
        let probes = null;
        if (this.probeFactors) {
          // Strongest power just outside the passband on each side, and where
          probes = this.probeOut;
          probes.lo = 0;
          probes.hi = 0;
          probes.loHz = 0;
          probes.hiHz = 0;
          for (const f of this.probeFactors) {
            const off = f * this.bandwidth;
            const lo = goertzelPower(this.linear, 0, n, this.sampleRate, this.tone - off, this.window, 0.5);
            const hi = goertzelPower(this.linear, 0, n, this.sampleRate, this.tone + off, this.window, 0.5);
            if (lo > probes.lo) {
              probes.lo = lo;
              probes.loHz = -off;
            }
            if (hi > probes.hi) {
              probes.hi = hi;
              probes.hiHz = off;
            }
          }
        }
        onPower(p, this.hopMs, probes);
      }
    }
  }
}

// ── ToneFinder: where is the strongest keyed tone? ────────────────────────

/**
 * Scans [minHz, maxHz] in `stepHz` steps over a long window and keeps a
 * peak-hold (with decay) per candidate so a keyed signal's pitch survives
 * the gaps between elements. `best()` returns the current winner.
 */
export class ToneFinder {
  constructor({ sampleRate = 48000, minHz = 300, maxHz = 1200, stepHz = 10, windowMs = 85, decayDbPerSec = 3 } = {}) {
    this.sampleRate = sampleRate;
    this.minHz = minHz;
    this.maxHz = maxHz;
    this.stepHz = stepHz;
    this.n = Math.max(256, Math.round((sampleRate * windowMs) / 1000) & ~1);
    this.window = hannWindow(this.n);
    this.buf = new Float32Array(this.n);
    this.fill = 0;
    this.freqs = [];
    for (let f = minHz; f <= maxHz + 1e-6; f += stepHz) this.freqs.push(f);
    this.held = new Float64Array(this.freqs.length).fill(-120);
    this.decayDb = (decayDbPerSec * this.n) / sampleRate; // per analysis window
    this.updates = 0;
  }

  reset() {
    this.held.fill(-120);
    this.fill = 0;
    this.updates = 0;
  }

  /** Feed PCM; analyses every full window. Returns true when an analysis ran. */
  process(chunk) {
    let analysed = false;
    let i = 0;
    while (i < chunk.length) {
      const take = Math.min(chunk.length - i, this.n - this.fill);
      this.buf.set(chunk.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === this.n) {
        this.analyse();
        this.fill = 0;
        analysed = true;
      }
    }
    return analysed;
  }

  analyse() {
    for (let k = 0; k < this.freqs.length; k++) {
      const p = goertzelPower(this.buf, 0, this.n, this.sampleRate, this.freqs[k], this.window, 0.5);
      const db = 10 * Math.log10(p + 1e-12);
      const decayed = this.held[k] - this.decayDb;
      this.held[k] = db > decayed ? db : decayed;
    }
    this.updates++;
  }

  /**
   * Strongest candidate: { freq, db, snrDb } where snrDb is the margin over
   * the median of all candidates (a rough "is there really a tone?" figure).
   */
  best() {
    let bestK = 0;
    for (let k = 1; k < this.held.length; k++) if (this.held[k] > this.held[bestK]) bestK = k;
    const sorted = Array.from(this.held).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    // Parabolic interpolation between neighbours for sub-step accuracy
    let freq = this.freqs[bestK];
    if (bestK > 0 && bestK < this.held.length - 1) {
      const a = this.held[bestK - 1];
      const b = this.held[bestK];
      const c = this.held[bestK + 1];
      const denom = a - 2 * b + c;
      if (denom < 0) freq += ((0.5 * (a - c)) / denom) * this.stepHz;
    }
    return { freq: Math.round(freq), db: this.held[bestK], snrDb: this.held[bestK] - median };
  }
}

// ── helpers for the timing machine ────────────────────────────────────────

/**
 * Two-means split of a list of durations. Returns { lo, hi, loN, hiN } or
 * null when the values do not separate into two clusters at least `minRatio`
 * apart.
 */
export function twoMeans(values, minRatio = 1.6) {
  if (values.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max < min * minRatio) return null;
  let lo = min;
  let hi = max;
  let loN = 0;
  let hiN = 0;
  for (let iter = 0; iter < 8; iter++) {
    const split = (lo + hi) / 2;
    let loSum = 0;
    let hiSum = 0;
    loN = 0;
    hiN = 0;
    for (const v of values) {
      if (v < split) {
        loSum += v;
        loN++;
      } else {
        hiSum += v;
        hiN++;
      }
    }
    if (!loN || !hiN) return null;
    lo = loSum / loN;
    hi = hiSum / hiN;
  }
  if (hi < lo * minRatio) return null;
  return { lo, hi, loN, hiN };
}

// ── Off-tune detection ────────────────────────────────────────────────────

/**
 * Notices when the passband sits beside a signal rather than on it.
 *
 * Tuned ~60–300 Hz off a CW signal, the narrow filter still sees its key
 * clicks and skirt leakage — keyed exactly in step with the real signal next
 * door — and prints a stream of E's and T's. The tracker compares, per hop,
 * the in-band amplitude with the strongest probe just outside the passband
 * on each side (exponentially weighted over ~2 s):
 *   - the side must be much stronger than the passband (≥ `ratio` × amplitude), and
 *   - the passband envelope must follow the side — its envelope (skirt
 *     leakage) or its on/off edges (key clicks): Pearson r ≥ corrOn.
 * Only both together mean "we are hearing that station's splatter".
 * Independently, every element the decoder hears in the passband is checked:
 * if ≥ 90 % of the last 16–20 coincided with a neighbour at least twice as
 * strong (the envelope test is too noisy at low SNR), that is splatter too.
 * A different, independently keyed station in the passband only overlaps a
 * strong neighbour part of the time and stays uncorrelated with it, so its
 * copy is not gated.
 */
export class OffTuneTracker {
  constructor({ tauSec = 2, ratio = 1.3, corrOn = 0.45, corrOff = 0.25, onMs = 1000, holdMs = 800 } = {}) {
    this.tauSec = tauSec;
    this.ratio = ratio;
    this.corrOn = corrOn;
    this.corrOff = corrOff;
    this.onMs = onMs; // both conditions must hold this long before gating
    this.holdMs = holdMs; // …and be gone this long before releasing
    this.reset();
  }

  reset() {
    const side = () => ({ mS: 0, vS: 0, cov: 0, prev: 0, mE: 0, vE: 0, covE: 0, hz: 0 });
    this.mA = 0;
    this.vA = 0;
    this.sides = [side(), side()];
    this.n = 0;
    this.offTune = false;
    this.offTuneHz = 0;
    this.clearMs = 0;
    this.setMs = 0;
    this.r = 0;
    // Mark coincidence: for each element the decoder hears in the passband,
    // was the neighbour much stronger the whole time?
    this.inMark = false;
    this.markHops = 0;
    this.markSideHops = 0;
    this.markSideHz = 0;
    this.marks = []; // verdicts for the last 20 elements (true = splatter-like)
  }

  /** Share of recent in-band elements that coincided with a much stronger neighbour. */
  get coincidence() {
    if (this.marks.length < 16) return 0;
    return this.marks.filter(Boolean).length / this.marks.length;
  }

  /**
   * Feed one hop. `rawKeyed` is the decoder's keyed state before any gating.
   * Returns true while the passband is judged off-tune.
   */
  update(power, probes, dtMs, rawKeyed = false) {
    const a = Math.sqrt(power);
    // ── mark coincidence ──
    const lo = Math.sqrt(probes.lo);
    const hi = Math.sqrt(probes.hi);
    const side = Math.max(lo, hi);
    if (rawKeyed) {
      if (!this.inMark) {
        this.inMark = true;
        this.markHops = 0;
        this.markSideHops = 0;
      }
      this.markHops++;
      if (side >= 2 * a) {
        this.markSideHops++;
        this.markSideHz = hi >= lo ? probes.hiHz : probes.loHz;
      }
    } else if (this.inMark) {
      this.inMark = false;
      this.marks.push(this.markSideHops >= 0.6 * this.markHops);
      if (this.marks.length > 20) this.marks.shift();
    }
    const alpha = Math.min(1, dtMs / 1000 / this.tauSec);
    if (this.n === 0) this.mA = a;
    const dA = a - this.mA;
    this.mA += alpha * dA;
    this.vA = (1 - alpha) * (this.vA + alpha * dA * dA);
    let best = null;
    const feeds = [
      [probes.lo, probes.loHz],
      [probes.hi, probes.hiHz],
    ];
    for (let i = 0; i < 2; i++) {
      const st = this.sides[i];
      const s = Math.sqrt(feeds[i][0]);
      if (this.n === 0) st.mS = s;
      const dS = s - st.mS;
      st.mS += alpha * dS;
      st.vS = (1 - alpha) * (st.vS + alpha * dS * dS);
      st.cov = (1 - alpha) * (st.cov + alpha * dA * dS);
      // Edge activity next door: key clicks land in the passband at the
      // neighbour's on/off transitions, not during its steady tone.
      const e = Math.abs(s - st.prev);
      st.prev = s;
      if (this.n === 0) st.mE = e;
      const dE = e - st.mE;
      st.mE += alpha * dE;
      st.vE = (1 - alpha) * (st.vE + alpha * dE * dE);
      st.covE = (1 - alpha) * (st.covE + alpha * dA * dE);
      st.hz = feeds[i][1];
      const rEnv = st.vS > 0 && this.vA > 0 ? st.cov / Math.sqrt(st.vS * this.vA) : 0;
      const rEdge = st.vE > 0 && this.vA > 0 ? st.covE / Math.sqrt(st.vE * this.vA) : 0;
      const r = Math.max(rEnv, rEdge);
      if (!best || st.mS > best.mS) best = { mS: st.mS, r, hz: st.hz };
    }
    this.n++;
    if (this.n * dtMs < 500) return this.offTune; // need some history first
    this.r = best.r;
    const strongSide = best.mS >= this.ratio * this.mA;
    this.strongSide = strongSide;
    const coincident = this.coincidence >= 0.9;
    if (!this.offTune) {
      this.setMs = strongSide && best.r >= this.corrOn ? this.setMs + dtMs : 0;
      if (this.setMs >= this.onMs || coincident) {
        this.offTune = true;
        this.offTuneHz = coincident && this.setMs < this.onMs ? this.markSideHz : best.hz;
        this.clearMs = 0;
        this.setMs = 0;
      }
    } else if (!coincident && (!strongSide || best.r < this.corrOff)) {
      this.clearMs += dtMs;
      if (this.clearMs >= this.holdMs) {
        this.offTune = false;
        this.offTuneHz = 0;
      }
    } else {
      this.clearMs = 0;
      this.offTuneHz = best.hz;
    }
    return this.offTune;
  }
}

// ── CWDecoder: tone power → keyed state → symbols → text ──────────────────

/**
 * @typedef {Object} CWDecoderOptions
 * @property {(text: string) => void} [onText]   decoded characters (may be several)
 * @property {number} [initialWpm=20]             starting dit estimate
 * @property {number} [minWpm=5]
 * @property {number} [maxWpm=45]
 * @property {number} [minSnrDb=6]                squelch: below this peak-to-noise ratio nothing is keyed
 * @property {number} [squelchDevs=5]             squelch: noise deviations a real element must clear
 * @property {number} [smoothDits=0.4]            post-detection integration, in dits
 */
export class CWDecoder {
  constructor(options = {}) {
    this.onText = options.onText || (() => {});
    this.minWpm = options.minWpm ?? CW_MIN_WPM;
    this.maxWpm = options.maxWpm ?? CW_MAX_WPM;
    this.ditMin = ditMsForWpm(this.maxWpm);
    this.ditMax = ditMsForWpm(this.minWpm);
    this.minSnrDb = options.minSnrDb ?? 6;
    this.squelchDevs = options.squelchDevs ?? 5;
    this.smoothDits = options.smoothDits ?? 0.3;
    this.initialDit = this.clampDit(ditMsForWpm(options.initialWpm ?? 20));
    this.reset();
  }

  clampDit(ms) {
    return Math.min(this.ditMax, Math.max(this.ditMin, ms));
  }

  reset() {
    // Level stage (linear power)
    this.smooth = new Float64Array(64);
    this.smoothPos = 0;
    this.smoothLen = 0;
    this.power = 0;
    this.noise = 0;
    this.peak = 0;
    this.noiseAmp = 0;
    this.noiseDev = 0;
    this.peakAmp = 0;
    this.clock = 0;
    this.holdUntil = 0;
    this.strongRun = 0;
    this.primed = false;
    this.keyed = false;
    this.rawKeyed = false;
    // Timing machine
    this.dit = this.initialDit;
    this.marks = []; // recent mark durations (ms) for dit tracking
    this.gaps = []; // recent inter-character/word gaps (ms) for spacing tracking
    this.on = false;
    this.markDur = 0;
    this.gapDur = 1e9; // "long silence" before the first mark
    this.pending = 0; // last confirmed mark (ms), awaiting the gap that follows it
    this.havePending = false;
    this.gapHandled = true; // the current gap already closed the character
    this.wordPending = false; // a character has been printed since the last space
    this.charMarks = [];
    this.decodedChars = 0;
  }

  get wpm() {
    return Math.round(wpmForDitMs(this.dit));
  }

  /** Peak-to-noise ratio in dB (signal meter). */
  get snrDb() {
    if (!this.primed || this.noise <= 0) return 0;
    return Math.max(0, 10 * Math.log10(this.peak / this.noise));
  }

  /** Current state snapshot for meters. */
  getState() {
    return {
      wpm: this.wpm,
      ditMs: this.dit,
      snrDb: this.snrDb,
      levelDb: 10 * Math.log10(this.power + 1e-12),
      noiseDb: 10 * Math.log10(this.noise + 1e-12),
      keyed: this.keyed,
      chars: this.decodedChars,
    };
  }

  /**
   * Feed one tone-power sample (≈ amplitude², linear) covering `dtMs`.
   * Smooths over ~0.4 dit, tracks noise (mean while unkeyed) and peak
   * (instant attack, slow decay), and keys with hysteresis at 50 % / 35 %
   * of the way from noise to peak in linear power — symmetric crossings, so
   * mark and space lengths survive the smoothing.
   */
  processLevel(power, dtMs, suppress = false) {
    // Boxcar over K hops of power, K tied to the current dit estimate
    const len = this.smooth.length;
    const k = Math.max(1, Math.min(len, Math.round((this.smoothDits * this.dit) / dtMs)));
    this.smooth[this.smoothPos] = power;
    this.smoothPos = (this.smoothPos + 1) % len;
    if (this.smoothLen < len) this.smoothLen++;
    let sum = 0;
    const n = Math.min(k, this.smoothLen);
    for (let i = 1; i <= n; i++) sum += this.smooth[(this.smoothPos - i + len) % len];
    const p = sum / n;
    this.power = p;
    // Thresholds work on amplitude: a Goertzel's amplitude ramps (nearly)
    // linearly through an edge, so mid-scale crossings preserve durations.
    const a = Math.sqrt(p);

    if (!this.primed) {
      this.primed = true;
      this.noiseAmp = a || 1e-7;
      this.noiseDev = this.noiseAmp * 0.5;
      this.peakAmp = this.noiseAmp;
    }
    const dtSec = dtMs / 1000;
    if (suppress) {
      // Gated (off-tune): the passband holds a neighbour's splatter — keep the
      // noise floor and peak from before so copy resumes cleanly on release.
    } else if (!this.keyed) {
      // Noise: mean and mean-absolute-deviation of the unkeyed amplitude.
      // Falls fast (a signal ended / QSB), rises slowly (a signal started).
      // The first 200 ms converge fast both ways (no history yet).
      const warm = this.clock < 200;
      const al = a < this.noiseAmp || warm ? Math.min(1, dtSec / (warm ? 0.04 : 0.1)) : Math.min(1, dtSec / 0.5);
      this.noiseAmp += (a - this.noiseAmp) * al;
      this.noiseDev += (Math.abs(a - this.noiseAmp) - this.noiseDev) * Math.min(1, dtSec / 0.5);
    } else {
      // +0.5 dB/s while keyed, so a stuck carrier eventually unkeys
      this.noiseAmp *= 10 ** ((0.5 * dtSec) / 20);
    }
    if (this.noiseAmp < 1e-7) this.noiseAmp = 1e-7;
    // Peak: instant attack, −6 dB/s decay, never below noise
    if (a > this.peakAmp) this.peakAmp = a;
    else this.peakAmp = Math.max(this.noiseAmp, this.peakAmp * 10 ** ((-6 * dtSec) / 20));
    this.noise = this.noiseAmp * this.noiseAmp;
    this.peak = this.peakAmp * this.peakAmp;

    // Squelch with hysteresis: the peak must clear the noise both in ratio
    // and in spread. Opening takes `squelchDevs` (5) noise deviations — random
    // noise practically never gets there, so it does not print E's — and once
    // a real signal has done that, the squelch holds at 70 % of that margin
    // for 4 s after each strong element so weak copy is not chopped.
    this.clock += dtMs;
    const strong = this.noiseAmp + this.squelchDevs * this.noiseDev;
    // "Strong" must persist for 0.6 dit: real elements last ≥ 1 dit, noise
    // spikes last about one analysis window.
    if (a >= strong && a >= this.noiseAmp * 10 ** (this.minSnrDb / 20)) this.strongRun += dtMs;
    else this.strongRun = 0;
    if (this.strongRun >= this.dit * 0.4) this.holdUntil = this.clock + 4000;
    const devs = this.clock < this.holdUntil ? this.squelchDevs * 0.7 : this.squelchDevs;
    let keyed = false;
    const open =
      this.peakAmp >= this.noiseAmp * 10 ** (this.minSnrDb / 20) &&
      this.peakAmp >= this.noiseAmp + devs * this.noiseDev;
    if (open) {
      const span = this.peakAmp - this.noiseAmp;
      const was = suppress ? this.rawKeyed : this.keyed;
      keyed = was ? a > this.noiseAmp + span * 0.4 : a > this.noiseAmp + span * 0.5;
    }
    // rawKeyed: what the passband shows; keyed: what is decoded (gated off-tune)
    this.rawKeyed = keyed;
    if (suppress) keyed = false;
    this.keyed = keyed;
    this.processEnvelope(keyed, dtMs);
  }

  /**
   * Feed a keyed/unkeyed state covering `dtMs` (what processLevel produces,
   * exposed so tests and other front ends can drive the timing machine).
   */
  processEnvelope(isOn, dtMs) {
    if (isOn) {
      if (!this.on) {
        this.on = true;
        this.markDur = 0;
      }
      this.markDur += dtMs;
      return;
    }
    if (this.on) {
      this.on = false;
      this.endMark(this.markDur);
    }
    this.gapDur += dtMs;
    this.checkTimeouts();
  }

  /** Force out whatever is pending (end of stream / source change). */
  flush() {
    if (this.on) {
      this.on = false;
      this.endMark(this.markDur);
    }
    if (this.havePending && !this.gapHandled) {
      this.appendElement(this.pending);
      this.havePending = false;
      this.gapHandled = true;
    }
    this.flushChar();
    this.gapDur = 1e9;
  }

  // ── internals ──

  endMark(mark) {
    const glitch = Math.max(5, this.dit * 0.3);
    if (mark < glitch) {
      // Noise spike: its time belongs to the surrounding gap
      this.gapDur += mark;
      return;
    }
    if (mark > this.ditMax * 5) {
      // A carrier (tune-up, beacon dash, stuck key) — not Morse. Drop it.
      this.charMarks = [];
      this.havePending = false;
      this.gapHandled = true;
      this.gapDur = 0;
      return;
    }
    const gap = this.gapDur;
    if (this.havePending && !this.gapHandled && gap < Math.max(5, this.dit * 0.3)) {
      // Dropout inside a mark (fading/QSB): merge
      this.pending += gap + mark;
      this.gapDur = 0;
      return;
    }
    // A mark far longer than a dash at the current estimate means the sender
    // is much slower than we think — rescale before classifying anything.
    if (mark > this.dit * 5) this.dit = this.clampDit(mark / 3);
    if (this.havePending) {
      this.appendElement(this.pending);
      if (!this.gapHandled) this.classifyGap(gap);
    }
    if (gap < this.ditMax * 20) this.noteGap(gap);
    this.pending = mark;
    this.havePending = true;
    this.gapHandled = false;
    this.gapDur = 0;
  }

  checkTimeouts() {
    if (this.havePending && !this.gapHandled && this.gapDur >= this.charGapThreshold()) {
      this.appendElement(this.pending);
      this.havePending = false;
      this.gapHandled = true;
      this.flushChar();
    }
    if (this.wordPending && this.gapDur >= this.wordGapThreshold()) {
      this.wordPending = false;
      this.emit(' ');
    }
  }

  charGapThreshold() {
    return this.dit * 2;
  }

  /**
   * Word-space threshold. Two-means over recent character/word gaps: with
   * both clusters present the split sits between them; with one cluster it
   * is assumed to be character spacing (most gaps in text are). Never below
   * 4.5 dits, so standard PARIS spacing (3 / 7) splits at ≥ 5 dits.
   */
  wordGapThreshold() {
    const base = this.dit * 5;
    if (this.gaps.length < 4) return base;
    const split = twoMeans(this.gaps, 1.6);
    let t;
    if (split) t = Math.max(split.lo * 1.5, (split.lo + split.hi) / 2);
    else {
      const mean = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length;
      t = mean * 1.6;
    }
    return Math.max(this.dit * 4.5, Math.min(t, this.dit * 20));
  }

  noteGap(ms) {
    if (ms < this.dit * 2) return; // intra-character
    this.gaps.push(ms);
    if (this.gaps.length > 16) this.gaps.shift();
  }

  classifyGap(ms) {
    if (ms < this.charGapThreshold()) return; // intra-character
    this.flushChar();
    if (this.wordPending && ms >= this.wordGapThreshold()) {
      this.wordPending = false;
      this.emit(' ');
    }
  }

  appendElement(ms) {
    this.marks.push(ms);
    if (this.marks.length > 24) this.marks.shift();
    this.updateDit();
    // Durations are kept raw and classified when the character closes, with
    // the dit estimate that already includes this character's own elements —
    // so the first letter after a speed change still decodes.
    this.charMarks.push(ms);
    if (this.charMarks.length > 8) this.flushChar();
  }

  flushChar() {
    if (!this.charMarks.length) return;
    let code = '';
    for (const ms of this.charMarks) code += ms >= this.dit * 2 ? '-' : '.';
    this.charMarks = [];
    const ch = MORSE_TABLE[code] || '*';
    this.decodedChars++;
    this.wordPending = true;
    this.emit(ch);
  }

  emit(text) {
    this.onText(text);
  }

  /**
   * Dit-length tracking: two-means clustering of recent mark durations.
   * When marks split into dots and dashes, the dit is the blend of the dot
   * cluster and a third of the dash cluster. With only one cluster visible
   * (EEEE / TTTT) it is assigned to whichever of dot or dash is nearer the
   * current estimate — that ambiguity is inherent to Morse.
   */
  updateDit() {
    const m = this.marks;
    if (m.length < 2) return;
    const split = twoMeans(m, 2);
    let est;
    if (split) est = (split.lo * split.loN + (split.hi / 3) * split.hiN) / (split.loN + split.hiN);
    else {
      const mean = m.reduce((a, b) => a + b, 0) / m.length;
      est = Math.abs(Math.log(mean / this.dit)) <= Math.abs(Math.log(mean / 3 / this.dit)) ? mean : mean / 3;
    }
    if (!Number.isFinite(est)) return;
    // Smooth a little so one odd element cannot yank the estimate around
    this.dit = this.clampDit(this.dit * 0.3 + est * 0.7);
  }
}

// ── CWPipeline: everything from PCM to text in one object ─────────────────

/**
 * Squelch presets: peak-to-noise ratio and noise-deviation multiple needed
 * to open. 'normal' is what the accuracy tests were tuned on.
 */
export const CW_SQUELCH_LEVELS = {
  low: { minSnrDb: 4, devs: 4 },
  normal: { minSnrDb: 6, devs: 5 },
  high: { minSnrDb: 9, devs: 6.5 },
};

/** Off-tune probe positions, in multiples of the filter bandwidth. */
export const OFF_TUNE_PROBES = [1.5, 2, 3, 4];

/** Auto filter width for a dit length: the window spans ≈ ½ dit. */
export function autoBandwidthForDit(ditMs) {
  const bw = 3000 / ditMs; // ENBW of a Hann window of ditMs/2
  return Math.max(50, Math.min(200, Math.round(bw / 10) * 10));
}

/**
 * PCM in, text out. Wraps ToneDetector + CWDecoder (+ an optional
 * ToneFinder) and, with `bandwidth: 'auto'`, re-sizes the Goertzel window to
 * about half a dit as the speed estimate moves — narrow (better weak-signal
 * copy) for slow senders, wide enough not to smear fast ones. This is the
 * object the AudioWorklet runs.
 */
export class CWPipeline {
  constructor({
    sampleRate = 48000,
    tone = CW_DEFAULT_TONE_HZ,
    bandwidth = 'auto',
    onText,
    initialWpm = 20,
    squelch = 'normal',
    findTone = false,
    offTuneGate = true,
  } = {}) {
    this.sampleRate = sampleRate;
    this.autoBandwidth = bandwidth === 'auto';
    this.decoder = new CWDecoder({ onText, initialWpm });
    this.setSquelch(squelch);
    const bw = this.autoBandwidth ? autoBandwidthForDit(this.decoder.dit) : bandwidth;
    this.detector = new ToneDetector({
      sampleRate,
      tone,
      bandwidth: bw,
      probeFactors: offTuneGate ? OFF_TUNE_PROBES : null,
    });
    this.finder = findTone ? new ToneFinder({ sampleRate }) : null;
    this.offTune = offTuneGate ? new OffTuneTracker() : null;
    this.onPower = (p, dt, probes) => {
      const gated = this.offTune && probes ? this.offTune.update(p, probes, dt, this.decoder.rawKeyed) : false;
      this.decoder.processLevel(p, dt, gated);
    };
  }

  get tone() {
    return this.detector.tone;
  }

  get bandwidth() {
    return this.detector.bandwidth;
  }

  setTone(hz) {
    if (Number.isFinite(hz) && hz > 0 && hz < this.sampleRate / 2) {
      this.detector.setTone(hz);
      this.offTune?.reset();
    }
  }

  setBandwidth(bw) {
    this.autoBandwidth = bw === 'auto';
    this.detector.setBandwidth(this.autoBandwidth ? autoBandwidthForDit(this.decoder.dit) : bw);
  }

  /** Squelch preset: 'low' (weak signals, may print noise) | 'normal' | 'high' (strong signals only). */
  setSquelch(level) {
    const p = CW_SQUELCH_LEVELS[level];
    if (!p) return;
    this.decoder.minSnrDb = p.minSnrDb;
    this.decoder.squelchDevs = p.devs;
  }

  enableToneFinder(on) {
    if (on && !this.finder) this.finder = new ToneFinder({ sampleRate: this.sampleRate });
    if (!on) this.finder = null;
  }

  process(chunk) {
    this.detector.process(chunk, this.onPower);
    if (this.finder) this.finder.process(chunk);
    this.trackNeighbour(chunk);
    // Hold the filter width while a much stronger neighbour dominates: its
    // splatter would otherwise drag the speed estimate (and the width) around.
    if (this.autoBandwidth && !this.offTune?.strongSide) {
      const want = autoBandwidthForDit(this.decoder.dit);
      if (Math.abs(want - this.detector.bandwidth) / this.detector.bandwidth > 0.25) this.detector.setBandwidth(want);
    }
  }

  flush() {
    this.decoder.flush();
  }

  reset() {
    this.decoder.reset();
    if (this.autoBandwidth) this.detector.setBandwidth(autoBandwidthForDit(this.decoder.dit));
    if (this.finder) this.finder.reset();
    this.offTune?.reset();
  }

  /**
   * While off-tune, find where the neighbour actually is: a narrow ToneFinder
   * scan from just outside the passband to five widths out on the gated side
   * (the probes only say which side, and roughly). Feeds "Retune".
   */
  trackNeighbour(chunk) {
    const ot = this.offTune;
    if (!ot || !ot.offTune) {
      this.sideFinder = null;
      return;
    }
    const side = Math.sign(ot.offTuneHz) || 1;
    const tone = this.detector.tone;
    const bw = this.detector.bandwidth;
    if (!this.sideFinder || this.sideFinder.side !== side || this.sideFinder.tone !== tone) {
      const a = tone + side * bw * 0.75;
      const b = tone + side * bw * 5;
      this.sideFinder = new ToneFinder({
        sampleRate: this.sampleRate,
        minHz: Math.max(100, Math.min(a, b)),
        maxHz: Math.min(this.sampleRate / 2 - 100, Math.max(a, b)),
        stepHz: 10, // parabolic interpolation in best() gets well under that
      });
      this.sideFinder.side = side;
      this.sideFinder.tone = tone;
    }
    this.sideFinder.process(chunk);
  }

  /** offTuneHz: 0, or the signed offset (Hz) of the station the passband sits beside. */
  getState() {
    let offTuneHz = 0;
    if (this.offTune?.offTune) {
      offTuneHz = this.offTune.offTuneHz;
      const f = this.sideFinder;
      if (f && f.updates >= 3) {
        const best = f.best();
        if (best.snrDb >= 6) offTuneHz = best.freq - this.detector.tone;
      }
    }
    return {
      ...this.decoder.getState(),
      tone: this.detector.tone,
      bandwidth: this.detector.bandwidth,
      offTuneHz: Math.round(offTuneHz),
    };
  }
}

// ── Callsign extraction ───────────────────────────────────────────────────

/**
 * Amateur callsign pattern for decoded text: optional prefix/, a 1–3
 * character prefix containing a letter, one digit, a 1–4 letter suffix and
 * an optional /suffix (5Z4/OZ6ABL, W1AW/7, VK2ABC/P, 9A1A).
 */
export const CALLSIGN_RE =
  /(?:^|[^A-Z0-9/])((?:[A-Z0-9]{1,3}\/)?(?:[A-Z][A-Z0-9]?|[0-9][A-Z])[0-9][A-Z]{1,4}(?:\/[A-Z0-9]{1,3})?)(?![A-Z0-9])/g;

// Q-codes / abbreviations that happen to match the callsign shape
const NOT_CALLS = new Set(['5NN', 'TU5NN']);

/**
 * Find amateur callsigns in decoded text. Returns unique calls in order of
 * first appearance with their character offsets.
 */
export function findCallsigns(text) {
  const out = [];
  const seen = new Set();
  for (const run of tokenizeCallsigns(text)) {
    if (run.call && !seen.has(run.call)) {
      seen.add(run.call);
      out.push({ call: run.call, index: run.index });
    }
  }
  return out;
}

/**
 * Split text into [{ text, call?, index? }] runs so a renderer can make
 * callsigns clickable. The runs concatenate back to the original text.
 */
export function tokenizeCallsigns(text) {
  const src = text || '';
  const upper = src.toUpperCase();
  const runs = [];
  const re = new RegExp(CALLSIGN_RE.source, 'g');
  let last = 0;
  let m;
  while ((m = re.exec(upper))) {
    const call = m[1];
    const start = m.index + m[0].length - call.length;
    // The match may have consumed the delimiter only; step back so the next
    // search can reuse it as its own leading delimiter.
    re.lastIndex = start + call.length;
    if (call.length < 3 || call.length > 12 || NOT_CALLS.has(call)) continue;
    if (start > last) runs.push({ text: src.slice(last, start) });
    runs.push({ text: src.slice(start, start + call.length), call, index: start });
    last = start + call.length;
  }
  if (last < src.length) runs.push({ text: src.slice(last) });
  return runs;
}
