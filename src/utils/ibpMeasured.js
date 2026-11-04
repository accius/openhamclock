/**
 * ibpMeasured.js — pure helpers for MEASURED beacon SNR (KiwiSDR beacon monitor)
 *
 * Measurements come from the Rig Bridge kiwi-beacon-monitor plugin, either
 * straight from the bridge (GET /api/beacon-monitor/measurements) or via the
 * OpenHamClock server (GET /api/ibp/measurements). Shape:
 *   { beacon, band, t, snrDb, levelDbm?, noiseDbm?, n? }   t = slot start (ms)
 *
 * Everything here is pure so the IBP panel, the Prediction Check panel and
 * the beacon-opening alert feed share one definition of "heard".
 */
import { IBP_BANDS } from './ibp.js';

/** SNR at or above which a beacon counts as heard. */
export const HEARD_SNR_DB = 6;
/** SNR at or above which a (beacon, band) pair counts as "open" for alerts. */
export const OPENING_SNR_DB = 10;
/** Colour scale bounds for measured SNR. */
export const SNR_SCALE_MIN = -10;
export const SNR_SCALE_MAX = 30;
/** Colour for "not heard" / no data cells (data-driven scale, not a theme colour). */
export const NOT_HEARD_COLOR = '#555c66';

export const pairKey = (beacon, band) => `${beacon}|${band}`;

/** 0–1 position of an SNR on the −10…+30 dB scale. */
export function snrFraction(snr) {
  if (!Number.isFinite(snr)) return null;
  return Math.max(0, Math.min(1, (snr - SNR_SCALE_MIN) / (SNR_SCALE_MAX - SNR_SCALE_MIN)));
}

/**
 * Colour for a measured SNR: grey below HEARD_SNR_DB, then a red→amber→green
 * ramp from the heard threshold to +30 dB (data scale, intentionally not a
 * theme variable).
 */
export function snrColor(snr) {
  if (!Number.isFinite(snr) || snr < HEARD_SNR_DB) return NOT_HEARD_COLOR;
  const f = Math.max(0, Math.min(1, (snr - HEARD_SNR_DB) / (SNR_SCALE_MAX - HEARD_SNR_DB)));
  const hue = Math.round(f * 120); // 0 = red … 120 = green
  return `hsl(${hue}, 80%, 48%)`;
}

/** Latest measurement per (beacon, band): Map<pairKey, measurement>. */
export function latestByPair(measurements) {
  const map = new Map();
  for (const m of measurements || []) {
    if (!m || !m.beacon || !m.band || !Number.isFinite(m.t)) continue;
    const k = pairKey(m.beacon, m.band);
    const prev = map.get(k);
    if (!prev || m.t > prev.t) map.set(k, m);
  }
  return map;
}

/**
 * Heat strip for one beacon: `buckets` equal time bins over the last `hours`,
 * each the best SNR heard (any band, or one band when `band` is given) or
 * null when nothing was measured in that bin.
 */
export function heatStrip(measurements, beacon, { now = Date.now(), hours = 24, buckets = 48, band = null } = {}) {
  const windowMs = hours * 3600 * 1000;
  const binMs = windowMs / buckets;
  const start = now - windowMs;
  const out = Array.from({ length: buckets }, (_, i) => ({ t: start + i * binMs, maxSnr: null, n: 0 }));
  for (const m of measurements || []) {
    if (!m || m.beacon !== beacon || !Number.isFinite(m.t) || !Number.isFinite(m.snrDb)) continue;
    if (band && m.band !== band) continue;
    const idx = Math.floor((m.t - start) / binMs);
    if (idx < 0 || idx >= buckets) continue;
    const b = out[idx];
    b.n++;
    if (b.maxSnr == null || m.snrDb > b.maxSnr) b.maxSnr = m.snrDb;
  }
  return out;
}

/** CSS linear-gradient that paints a heat strip in one element. */
export function heatStripGradient(strip) {
  if (!strip || !strip.length) return 'transparent';
  const step = 100 / strip.length;
  const stops = strip.map((b, i) => {
    const c = b.n ? snrColor(b.maxSnr) : 'transparent';
    return `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Normalize a measured SNR to the same 0–99 scale as P.533 reliability. */
export function snrToScore(snr) {
  const f = snrFraction(snr);
  if (f == null) return null;
  return Math.round(f * 99);
}

/**
 * Per-band summary of recent measurements for the Prediction Check panel:
 *   { '20m': { maxSnr, n, heard, score }, … } — only bands with data.
 * The window defaults to 20 minutes: with five bands enabled every pair is
 * sampled once per 15 min, so 20 min guarantees at least one pass.
 */
export function measuredBandSummary(measurements, { now = Date.now(), windowMs = 20 * 60 * 1000 } = {}) {
  const out = {};
  const cutoff = now - windowMs;
  for (const m of measurements || []) {
    if (!m || !Number.isFinite(m.t) || m.t < cutoff || !Number.isFinite(m.snrDb)) continue;
    const b = out[m.band] || (out[m.band] = { maxSnr: -Infinity, n: 0, heard: 0 });
    b.n++;
    if (m.snrDb > b.maxSnr) b.maxSnr = m.snrDb;
    if (m.snrDb >= HEARD_SNR_DB) b.heard++;
  }
  for (const b of Object.values(out)) b.score = snrToScore(b.maxSnr);
  return out;
}

/**
 * Current openings: (beacon, band) pairs whose latest measurement is at or
 * above OPENING_SNR_DB, with `openedAt` = start of the contiguous run of
 * heard measurements that led to it (so an alert fires once per opening,
 * not once per cycle). Only runs that began within `windowMs` count.
 */
export function beaconOpenings(measurements, { now = Date.now(), windowMs = 6 * 3600 * 1000 } = {}) {
  const byPair = new Map();
  for (const m of measurements || []) {
    if (!m || !m.beacon || !m.band || !Number.isFinite(m.t) || !Number.isFinite(m.snrDb)) continue;
    if (m.t < now - windowMs) continue;
    const k = pairKey(m.beacon, m.band);
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(m);
  }
  const openings = [];
  for (const list of byPair.values()) {
    list.sort((a, b) => a.t - b.t);
    let runStart = null;
    let last = null;
    for (const m of list) {
      if (m.snrDb >= HEARD_SNR_DB) {
        if (runStart == null) runStart = m.t;
      } else {
        runStart = null;
      }
      last = m;
    }
    if (last && runStart != null && last.snrDb >= OPENING_SNR_DB) {
      openings.push({ beacon: last.beacon, band: last.band, snrDb: last.snrDb, openedAt: runStart, t: last.t });
    }
  }
  return openings.sort((a, b) => b.snrDb - a.snrDb);
}

/** Map a P.533 output frequency (MHz) to an IBP band label, or null. */
export function ibpBandForFreq(freqMhz) {
  let best = null;
  let bestDist = Infinity;
  for (const b of IBP_BANDS) {
    const d = Math.abs(freqMhz - b.mhz);
    if (d < bestDist) {
      bestDist = d;
      best = b.label;
    }
  }
  return bestDist < 2 ? best : null;
}

/**
 * Agreement between a P.533 reliability (0–99) for the DE→beacon path and
 * the latest measured SNR on that band.
 *   'agrees'  predicted open & heard, or predicted closed & not heard, or
 *             the prediction is in the grey zone (20–50 %)
 *   'worse'   predicted ≥ 50 % but not heard
 *   'better'  predicted < 20 % but heard
 *   'nodata'  either side missing
 */
export function agreement(predicted, snr) {
  if (!Number.isFinite(predicted) || !Number.isFinite(snr)) return 'nodata';
  const heard = snr >= HEARD_SNR_DB;
  if (predicted >= 50) return heard ? 'agrees' : 'worse';
  if (predicted < 20) return heard ? 'better' : 'agrees';
  return 'agrees';
}

/**
 * Per-beacon agreement tally for the MEASURED view's "vs P.533" column.
 * @param {Map} latest        latestByPair()
 * @param {Object} predicted  { beacon: { band: reliability } }
 * @param {number} maxAgeMs   ignore measurements older than this (default 2 h)
 * @returns {Object} { beacon: { agrees, worse, better, total, verdicts: {band: verdict} } }
 */
export function agreementByBeacon(latest, predicted, { now = Date.now(), maxAgeMs = 2 * 3600 * 1000 } = {}) {
  const out = {};
  for (const [beacon, byBand] of Object.entries(predicted || {})) {
    const row = { agrees: 0, worse: 0, better: 0, total: 0, verdicts: {} };
    for (const [band, rel] of Object.entries(byBand || {})) {
      const m = latest.get(pairKey(beacon, band));
      if (!m || now - m.t > maxAgeMs) continue;
      const v = agreement(rel, m.snrDb);
      if (v === 'nodata') continue;
      row.verdicts[band] = v;
      row[v]++;
      row.total++;
    }
    out[beacon] = row;
  }
  return out;
}

/** Compact "3m ago" style age label. */
export function ageLabel(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}
