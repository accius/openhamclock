/**
 * opportunityScore — rank "things worth working right now".
 *
 *   score = needWeight × activity × reliability
 *
 *   needWeight  1 + Σ NEED_WEIGHTS for every award need the spot satisfies
 *               (new DXCC entity, new band slot, new CQ zone, new VUCC grid,
 *               new WAS state) — derived from the native logbook (useAwards)
 *   activity    (1 + log2 spotters) × 0.5^(age / 7 min) — how many distinct
 *               spotters/skimmers reported the station in the last 15 min,
 *               decayed by the age of the newest report
 *   reliability P.533 predicted circuit reliability DE → spot (0–1, floor
 *               0.05 so a "0 %" path still ranks on need); when no
 *               prediction is available yet, the band-opening fallback
 *               (openings for this band towards my zone/continent) is used.
 *
 * Pure: everything (clock, cty resolver, awards object) is injected, so the
 * whole pipeline is unit-testable without React, workers, or the cluster.
 */

export const NEED_WEIGHTS = { dxcc: 10, zone: 6, band: 4, state: 3, grid: 2 };
export const NEED_LABELS = {
  dxcc: 'NEW DXCC',
  band: 'NEW BAND',
  zone: 'NEW ZONE',
  grid: 'NEW GRID',
  state: 'NEW STATE',
};
export const NEED_ORDER = ['dxcc', 'zone', 'band', 'state', 'grid'];
export const WINDOW_MS = 15 * 60 * 1000;
export const HALF_LIFE_MS = 7 * 60 * 1000;
export const MAX_PREDICTION_CANDIDATES = 40;
export const PREDICTION_TTL_MS = 10 * 60 * 1000;
const MIN_RELIABILITY_FACTOR = 0.05;
const UNKNOWN_OPENING_SCORE = 0.3;

const HF_BANDS = {
  '160m': [1.8, 2.0],
  '80m': [3.5, 4.0],
  '60m': [5.25, 5.45],
  '40m': [7.0, 7.3],
  '30m': [10.1, 10.15],
  '20m': [14.0, 14.35],
  '17m': [18.068, 18.168],
  '15m': [21.0, 21.45],
  '12m': [24.89, 24.99],
  '10m': [28.0, 29.7],
  '6m': [50.0, 54.0],
  '4m': [70.0, 70.5],
  '2m': [144.0, 148.0],
  '70cm': [420.0, 450.0],
};

/** Frequency in MHz from MHz / kHz / Hz input (null when unparsable). */
export function toMHz(freq) {
  const v = parseFloat(freq);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v > 1e6) return v / 1e6; // Hz
  if (v > 1000) return v / 1000; // kHz
  return v;
}

export function bandOf(freqMHz) {
  if (freqMHz == null) return null;
  for (const [band, [lo, hi]] of Object.entries(HF_BANDS)) if (freqMHz >= lo && freqMHz <= hi) return band;
  return null;
}

/** Spot age in ms from an absolute timestamp or an 'HH:MMz' time-of-day string. */
export function spotAgeMs(spot, now = Date.now()) {
  if (!spot) return Infinity;
  const ts = spot.timestamp ?? spot.timestampMs ?? spot.spotTime;
  if (ts != null && ts !== '') {
    const ms = typeof ts === 'number' ? ts : Date.parse(ts);
    if (Number.isFinite(ms)) return Math.max(0, now - ms);
  }
  const m = String(spot.time || '').match(/^(\d{2}):?(\d{2})z?$/i);
  if (m) {
    const d = new Date(now);
    d.setUTCHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    let age = now - d.getTime();
    if (age < -60 * 1000) age += 24 * 60 * 60 * 1000; // wrapped past midnight UTC
    return Math.max(0, age);
  }
  return Infinity;
}

/** US state from a POTA/WWFF location descriptor like 'US-CO' or 'US-CO,US-WY'. */
export function stateFromLocationDesc(desc) {
  const m = String(desc || '').match(/\bUS-([A-Z]{2})\b/);
  return m ? m[1] : null;
}

/**
 * Collapse raw spots (cluster rows + activation spots) into one candidate per
 * station+band with distinct-spotter counts and the newest report.
 *
 * Accepts the two shapes the app already has:
 *   cluster (useDXClusterData.rawSpots): { dxCall, freq (kHz string), spotter, timestamp, dxLat, dxLon, dxGrid, comment }
 *   activations (usePOTASpots & co):     { call, freq (MHz string), mode, ref, lat, lon, grid, time ('HH:MMz'), locationDesc }
 */
export function aggregateSpots(spots, { now = Date.now(), windowMs = WINDOW_MS, source = 'cluster' } = {}) {
  const byKey = new Map();
  for (const s of Array.isArray(spots) ? spots : []) {
    if (!s) continue;
    const call = String(s.dxCall || s.call || '')
      .trim()
      .toUpperCase();
    if (!call) continue;
    const age = spotAgeMs(s, now);
    if (!(age <= windowMs)) continue;
    const freq = toMHz(s.freq ?? s.frequency);
    const band = bandOf(freq) || s.band || null;
    if (!band) continue;
    const key = `${call}|${band}`;
    const spotter = String(s.spotter || s.source || source).toUpperCase();
    let c = byKey.get(key);
    if (!c) {
      c = {
        key,
        call,
        band,
        freq,
        mode: s.mode || null,
        spotters: new Set(),
        ageMs: age,
        lat: Number.isFinite(s.dxLat) ? s.dxLat : Number.isFinite(s.lat) ? s.lat : null,
        lon: Number.isFinite(s.dxLon) ? s.dxLon : Number.isFinite(s.lon) ? s.lon : null,
        grid: s.dxGrid || s.grid || null,
        ref: s.ref || null,
        state: stateFromLocationDesc(s.locationDesc),
        comment: s.comment || s.comments || '',
        source,
      };
      byKey.set(key, c);
    }
    c.spotters.add(spotter);
    if (age < c.ageMs) {
      c.ageMs = age;
      if (freq) c.freq = freq;
      if (s.mode) c.mode = s.mode;
    }
    if (c.lat == null && Number.isFinite(s.dxLat ?? s.lat)) {
      c.lat = s.dxLat ?? s.lat;
      c.lon = s.dxLon ?? s.lon;
    }
    if (!c.grid && (s.dxGrid || s.grid)) c.grid = s.dxGrid || s.grid;
  }
  return [...byKey.values()].map((c) => ({ ...c, spotters: c.spotters.size }));
}

/** Merge candidate lists from several sources, keeping the best-attested row per station+band. */
export function mergeCandidates(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const c of list || []) {
      const prev = byKey.get(c.key);
      if (!prev) {
        byKey.set(c.key, { ...c });
        continue;
      }
      prev.spotters += c.spotters;
      prev.ageMs = Math.min(prev.ageMs, c.ageMs);
      prev.lat = prev.lat ?? c.lat;
      prev.lon = prev.lon ?? c.lon;
      prev.grid = prev.grid || c.grid;
      prev.mode = prev.mode || c.mode;
      prev.ref = prev.ref || c.ref;
      prev.state = prev.state || c.state;
      if (c.source !== 'cluster') prev.source = c.source;
    }
  }
  return [...byKey.values()];
}

/**
 * Which award needs does this candidate satisfy?
 * @param {object} candidate  from aggregateSpots
 * @param {object} opts
 * @param {object} opts.awards   computeAwards() result (may be empty)
 * @param {Function} opts.resolve call → { dxcc, cq, entity } | null
 * @returns {{ needs: string[], weight: number, entity: string|null, zone: number|null }}
 */
export function evaluateNeeds(candidate, { awards, resolve }) {
  const resolved = typeof resolve === 'function' ? resolve(candidate.call) : null;
  const entity = resolved?.entity || resolved?.dxcc || null;
  const zone = Number.isFinite(resolved?.cq) ? resolved.cq : null;
  const needs = [];
  const hasLog = !!awards && awards.totalQsos > 0;
  const logResolves = hasLog && !(awards.dxcc.worked.size === 0 && awards.dxcc.unresolved === awards.totalQsos);
  if (logResolves && resolved?.dxcc) {
    const rec = awards.dxcc.worked.get(resolved.dxcc);
    if (!rec) needs.push('dxcc');
    else if (candidate.band && !rec.bands.has(candidate.band)) needs.push('band');
    if (zone && !awards.waz.worked.has(zone)) needs.push('zone');
  }
  if (hasLog && candidate.state && awards.was.qsosWithState > 0 && !awards.was.worked.has(candidate.state)) {
    needs.push('state');
  }
  if (hasLog && candidate.grid && awards.vucc.worked.size > 0) {
    const g4 = String(candidate.grid).toUpperCase().slice(0, 4);
    if (/^[A-R]{2}\d{2}$/.test(g4) && !awards.vucc.worked.has(g4)) needs.push('grid');
  }
  needs.sort((a, b) => NEED_ORDER.indexOf(a) - NEED_ORDER.indexOf(b));
  const weight = 1 + needs.reduce((sum, n) => sum + (NEED_WEIGHTS[n] || 0), 0);
  return { needs, weight, entity, zone };
}

export function activityScore({ spotters = 1, ageMs = 0 } = {}) {
  const n = Math.max(1, spotters);
  const decay = Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);
  return (1 + Math.log2(n)) * decay;
}

export function reliabilityFactor(reliabilityPct) {
  if (reliabilityPct == null || reliabilityPct === '') return null;
  const r = Number(reliabilityPct);
  if (!Number.isFinite(r)) return null;
  return Math.max(MIN_RELIABILITY_FACTOR, Math.min(1, r / 100));
}

/**
 * Fallback when no P.533 prediction is available: is this band open towards
 * me according to the server's band-opening detector? 0.3 = unknown,
 * climbing with the opening's surge factor to 1.
 */
export function bandOpeningScore(openingsPayload, band, { myZone = null, myContinent = null } = {}) {
  if (!openingsPayload || !band) return UNKNOWN_OPENING_SCORE;
  let best = 0;
  for (const o of openingsPayload.zone_openings || []) {
    if (o?.band === band && myZone != null && Number(o.to_zone) === Number(myZone))
      best = Math.max(best, o.factor || 0);
  }
  for (const o of openingsPayload.openings || []) {
    if (o?.band === band && myContinent && o.to_continent === myContinent) best = Math.max(best, o.factor || 0);
  }
  if (!best) return UNKNOWN_OPENING_SCORE;
  const f = Number.isFinite(best) ? best : 10;
  return Math.min(1, UNKNOWN_OPENING_SCORE + f / 10);
}

export function scoreOpportunity({ weight = 1, activity = 1, reliability = null, fallback = UNKNOWN_OPENING_SCORE }) {
  const rel = reliabilityFactor(reliability);
  return weight * activity * (rel ?? fallback);
}

/**
 * Pick the candidates worth spending a P.533 prediction on: top N by
 * need × activity among those with a known location.
 */
export function selectForPrediction(candidates, { max = MAX_PREDICTION_CANDIDATES } = {}) {
  return candidates
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .map((c) => ({ c, pre: (c.weight || 1) * activityScore(c) }))
    .sort((a, b) => b.pre - a.pre)
    .slice(0, max)
    .map((x) => x.c);
}

/**
 * Final ranking.
 * @param {Array} candidates  aggregateSpots rows already passed through evaluateNeeds ({ ...c, needs, weight })
 * @param {object} opts
 * @param {(c)=>number|null} [opts.reliabilityFor]  P.533 reliability % for a candidate (null = unknown)
 * @param {object} [opts.openings]   /api/band-openings payload for the fallback
 * @param {number} [opts.myZone] / [opts.myContinent]
 * @param {number} [opts.limit=30]
 */
export function rankOpportunities(
  candidates,
  { reliabilityFor = () => null, openings = null, myZone = null, myContinent = null, limit = 30 } = {},
) {
  const rows = [];
  for (const c of candidates || []) {
    const activity = activityScore(c);
    const reliability = reliabilityFor(c);
    const fallback = bandOpeningScore(openings, c.band, { myZone, myContinent });
    const score = scoreOpportunity({ weight: c.weight || 1, activity, reliability, fallback });
    rows.push({
      ...c,
      activity,
      reliability: Number.isFinite(reliability) ? Math.round(reliability) : null,
      reliabilitySource: Number.isFinite(reliability) ? 'p533' : 'openings',
      openingScore: fallback,
      score,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.ageMs - b.ageMs);
  return rows.slice(0, limit);
}

/** Pick the P.533 frequency row closest to the spot's frequency. */
export function nearestFrequencyReliability(frequencies, freqMHz) {
  if (!Array.isArray(frequencies) || !Number.isFinite(freqMHz)) return null;
  let best = null;
  for (const f of frequencies) {
    if (!Number.isFinite(f?.freq) || !Number.isFinite(f?.reliability)) continue;
    const d = Math.abs(f.freq - freqMHz);
    if (!best || d < best.d) best = { d, rel: f.reliability };
  }
  return best && best.d < 2 ? Math.max(0, Math.min(100, best.rel)) : null;
}

export default {
  NEED_WEIGHTS,
  NEED_LABELS,
  WINDOW_MS,
  MAX_PREDICTION_CANDIDATES,
  PREDICTION_TTL_MS,
  toMHz,
  bandOf,
  spotAgeMs,
  stateFromLocationDesc,
  aggregateSpots,
  mergeCandidates,
  evaluateNeeds,
  activityScore,
  reliabilityFactor,
  bandOpeningScore,
  scoreOpportunity,
  selectForPrediction,
  rankOpportunities,
  nearestFrequencyReliability,
};
