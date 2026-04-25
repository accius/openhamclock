// Browser-side P.533 engine. Drives the Web Worker over all 24 UTC hours and
// produces a response shape byte-compatible with GET /api/propagation so
// usePropagation can swap engines without touching any downstream UI.
//
// Scope in B5b: prove the WASM stack works end-to-end in production traffic.
// Runs AFTER the REST endpoint returns and uses the REST response's solar
// data (SSN) so we don't double-hit NOAA/N0NBH from the browser. If WASM
// fails at any point, callers keep the REST data — see usePropagation.js.
//
// Cost model: 24 serial predictInWorker calls × ~50-100 ms each after the
// module is warm. First call also pays ~3-5 s for module + coefficient
// downloads. Budget accordingly at the caller.

import { predictInWorker } from './predictInWorker.js';
import {
  ANTENNA_PROFILES,
  calculateSignalMargin,
  adjustReliability,
  calculateSNR,
  getStatus,
} from '../../utils/propagationAdjust.js';

// UI band labels and their "operating" frequencies, matched to the server's
// currentBands array.
const BANDS = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];
const UI_FREQS_MHZ = [1.8, 3.5, 7.0, 10.0, 14.0, 18.0, 21.0, 24.0, 28.0];

// Map a P.533 output frequency to the nearest UI band. 2 MHz tolerance covers
// the 40m (7.0/7.1) and 12m (24.0/24.9) drift between the UI and ITURHFProp
// center frequencies — same logic as server/routes/propagation.js.
function freqToBand(freq) {
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < UI_FREQS_MHZ.length; i++) {
    const d = Math.abs(freq - UI_FREQS_MHZ[i]);
    if (d < bestDist) {
      bestDist = d;
      best = BANDS[i];
    }
  }
  return bestDist < 2 ? best : null;
}

/**
 * Run a full 24h × 9-band prediction in the browser and return a
 * /api/propagation-compatible payload. The hourly WASM call is identical to
 * the server's `fetchITURHFPropHourly` result — we reuse the same
 * adjustReliability/signal-margin math on both sides.
 *
 * @param {Object}          opts
 * @param {{lat,lon}}       opts.deLocation
 * @param {{lat,lon}}       opts.dxLocation
 * @param {string}          [opts.mode='SSB']
 * @param {number}          [opts.power=100]            watts
 * @param {string}          [opts.antenna='isotropic']  key into ANTENNA_PROFILES
 * @param {number}          [opts.ssn=100]              smoothed sunspot number
 * @param {string}          [opts.wasmUrl]              override module URL
 * @param {AbortSignal}     [opts.signal]               abort the 24-hour loop
 * @param {(progress)=>void}[opts.onProgress]           {hour, total} after each call
 * @returns {Promise<Object>} Response shape mirrors /api/propagation.
 */
export async function runBrowserEngine({
  deLocation,
  dxLocation,
  mode = 'SSB',
  power = 100,
  antenna = 'isotropic',
  ssn = 100,
  wasmUrl,
  signal,
  onProgress,
}) {
  if (!deLocation || !dxLocation) {
    throw new Error('runBrowserEngine: deLocation and dxLocation are required');
  }

  const txPower = parseFloat(power) || 100;
  const antProfile = ANTENNA_PROFILES[antenna] || ANTENNA_PROFILES.isotropic;
  const txGain = antProfile.gain;
  const signalMarginDb = calculateSignalMargin(mode, txPower, txGain);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const currentHour = now.getUTCHours();

  const predictions = {};
  BANDS.forEach((b) => {
    predictions[b] = [];
  });

  let mufForCurrentHour = null;
  const clock = typeof performance !== 'undefined' && performance.now ? performance : Date;
  const started = clock.now();
  const hourTimings = []; // ms per predictInWorker call — h=0 includes cold-start

  for (let h = 0; h < 24; h++) {
    if (signal?.aborted) throw new Error('runBrowserEngine: aborted');

    const hourStart = clock.now();
    const hourResult = await predictInWorker(
      {
        txLat: deLocation.lat,
        txLon: deLocation.lon,
        rxLat: dxLocation.lat,
        rxLon: dxLocation.lon,
        year,
        month,
        hour: h,
        ssn,
        txPower,
        txGain,
      },
      wasmUrl ? { wasmUrl } : undefined,
    );
    hourTimings.push(clock.now() - hourStart);

    const perBand = {};
    for (const f of hourResult.frequencies || []) {
      const band = freqToBand(f.freq);
      if (band) {
        const raw = Math.max(0, Math.min(99, Math.round(f.reliability)));
        perBand[band] = adjustReliability(raw, signalMarginDb);
      }
    }

    BANDS.forEach((band) => {
      const rel = perBand[band] ?? 0;
      predictions[band].push({ hour: h, reliability: rel, snr: calculateSNR(rel) });
    });

    if (h === currentHour && Number.isFinite(hourResult.muf)) {
      mufForCurrentHour = hourResult.muf;
    }

    onProgress?.({ hour: h + 1, total: 24 });
  }

  const currentBands = BANDS.map((band, i) => {
    const rel = predictions[band][currentHour].reliability;
    return {
      band,
      freq: UI_FREQS_MHZ[i],
      reliability: rel,
      snr: calculateSNR(rel),
      status: getStatus(rel),
    };
  }).sort((a, b) => b.reliability - a.reliability);

  return {
    model: 'ITU-R P.533-14',
    engine: 'wasm',
    elapsed: Math.round(clock.now() - started),
    muf: mufForCurrentHour,
    currentHour,
    currentBands,
    hourlyPredictions: predictions,
    mode,
    power: txPower,
    antenna: { key: antenna, name: antProfile.name, gain: txGain },
    signalMargin: Math.round(signalMarginDb * 10) / 10,
    iturhfprop: { enabled: true, available: true },
    dataSource: 'ITURHFProp (ITU-R P.533-14) — browser WASM',
    benchmark: summarizeTimings(hourTimings),
  };
}

// Turn 24 per-hour timings into the small summary we ship in every WASM
// response. h=0 is special — it includes the one-time cold start (module
// load + coefficient download) — so we report it separately from the
// warm-call percentiles.
function summarizeTimings(hourTimings) {
  const first = hourTimings[0];
  const warm = hourTimings.slice(1).sort((a, b) => a - b);
  const pct = (p) => warm[Math.min(warm.length - 1, Math.floor(warm.length * p))];
  const total = hourTimings.reduce((s, x) => s + x, 0);
  return {
    totalMs: Math.round(total),
    firstCallMs: Math.round(first ?? 0),
    warmMinMs: Math.round(warm[0] ?? 0),
    warmMaxMs: Math.round(warm[warm.length - 1] ?? 0),
    warmP50Ms: Math.round(pct(0.5) ?? 0),
    warmP90Ms: Math.round(pct(0.9) ?? 0),
    warmTotalMs: Math.round(total - (first ?? 0)),
    samples: hourTimings.length,
  };
}

export const __internal = { BANDS, UI_FREQS_MHZ, freqToBand, summarizeTimings };
