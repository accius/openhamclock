/**
 * eme — Earth-Moon-Earth (moonbounce) planning math for the EME layout.
 *
 * Everything here is pure and built on the moon primitives in geo.js
 * (getMoonAzEl is topocentric with parallax, so DE and DX elevations are
 * what each dish actually sees). Times are Dates; angles are degrees.
 */
import { getMoonAzEl, getMoonPosition, getMoonTimes, getMoonPhase, getMoonPhaseEmoji } from './geo.js';

/** Mean Earth–Moon distance, km. Path loss is quoted as a delta against it. */
export const EME_MEAN_DISTANCE_KM = 384400;

/** Amateur EME bands, MHz. 6 m upward — nobody bounces 10 m off the moon. */
export const EME_BANDS_MHZ = [
  [50, 54],
  [70, 71],
  [144, 148],
  [222, 225],
  [420, 450],
  [902, 928],
  [1240, 1300],
  [2300, 2450],
  [3300, 3500],
  [5650, 5925],
  [10000, 10500],
  [24000, 24250],
  [47000, 47200],
];

/** Two-way path-loss delta vs. mean distance: loss ∝ d⁴, so 40·log10(d/d̄). */
export function moonPathDeltaDb(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  return 40 * Math.log10(distanceKm / EME_MEAN_DISTANCE_KM);
}

const hasPos = (loc) => loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon);

function stationView(now, loc) {
  if (!hasPos(loc)) return null;
  const azel = getMoonAzEl(now, loc.lat, loc.lon);
  const times = getMoonTimes(now, loc.lat, loc.lon);
  return {
    azimuth: azel.azimuth,
    elevation: azel.elevation,
    up: azel.elevation >= 0,
    rise: times.rise,
    set: times.set,
  };
}

/**
 * Everything the "moon now" readout needs for both ends of the path.
 * @returns {null|{moon:object, de:object, dx:object|null, mutual:boolean}}
 */
export function computeEmeSnapshot(now, de, dx) {
  if (!hasPos(de)) return null;
  const pos = getMoonPosition(now);
  const phase = getMoonPhase(now);
  const deView = stationView(now, de);
  const dxView = stationView(now, dx);
  return {
    moon: {
      distanceKm: pos.distanceKm,
      pathDeltaDb: moonPathDeltaDb(pos.distanceKm),
      declination: pos.lat,
      sublunar: { lat: pos.lat, lon: pos.lon },
      phase,
      phaseEmoji: getMoonPhaseEmoji(phase),
    },
    de: deView,
    dx: dxView,
    mutual: !!(deView?.up && dxView?.up),
  };
}

/** Lower of the two elevations — the number a mutual window is judged on. */
function commonElevation(t, de, dx) {
  const a = getMoonAzEl(t, de.lat, de.lon).elevation;
  const b = getMoonAzEl(t, dx.lat, dx.lon).elevation;
  return Math.min(a, b);
}

/** Bisect a crossing of `minElev` between t0 (below) and t1 (above), to 30 s. */
function refineCrossing(t0, t1, de, dx, minElev, rising) {
  let lo = t0;
  let hi = t1;
  for (let i = 0; i < 12 && hi - lo > 30_000; i++) {
    const mid = (lo + hi) / 2;
    const above = commonElevation(new Date(mid), de, dx) >= minElev;
    if (above === rising) hi = mid;
    else lo = mid;
  }
  return rising ? hi : lo;
}

/**
 * Windows where BOTH stations have the moon at or above `minElev`.
 * @param {Date} start
 * @param {{lat,lon}} de
 * @param {{lat,lon}} dx
 * @param {{hours?:number, stepMin?:number, minElev?:number}} [opts]
 * @returns {Array<{start:Date, end:Date, peakMinEl:number, peakAt:Date, open:boolean}>}
 *   `open` marks a window already in progress at `start`.
 */
export function computeMutualWindows(start, de, dx, { hours = 48, stepMin = 5, minElev = 0 } = {}) {
  if (!hasPos(de) || !hasPos(dx)) return [];
  const step = stepMin * 60_000;
  const t0 = start.getTime();
  const tEnd = t0 + hours * 3_600_000;
  const windows = [];
  let cur = null;
  let prevT = t0;
  let prevAbove = commonElevation(start, de, dx) >= minElev;
  if (prevAbove) {
    cur = { start: new Date(t0), peakMinEl: -90, peakAt: new Date(t0), open: true };
  }
  for (let t = t0; t <= tEnd; t += step) {
    const el = commonElevation(new Date(t), de, dx);
    const above = el >= minElev;
    if (above && !prevAbove) {
      const edge = refineCrossing(prevT, t, de, dx, minElev, true);
      cur = { start: new Date(edge), peakMinEl: -90, peakAt: new Date(edge), open: false };
    }
    if (above && cur && el > cur.peakMinEl) {
      cur.peakMinEl = el;
      cur.peakAt = new Date(t);
    }
    if (!above && prevAbove && cur) {
      const edge = refineCrossing(prevT, t, de, dx, minElev, false);
      cur.end = new Date(edge);
      windows.push(cur);
      cur = null;
    }
    prevAbove = above;
    prevT = t;
  }
  if (cur) {
    cur.end = new Date(tEnd);
    cur.truncated = true;
    windows.push(cur);
  }
  return windows;
}

/**
 * Above-horizon moon track samples for the polar chart, per station.
 * @returns {{de:Array<{az,el,t}>, dx:Array<{az,el,t}>}}
 */
export function computeSkyTracks(now, de, dx, { hours = 24, stepMin = 20 } = {}) {
  const trackFor = (loc) => {
    if (!hasPos(loc)) return [];
    const out = [];
    for (let m = 0; m <= hours * 60; m += stepMin) {
      const t = new Date(now.getTime() + m * 60_000);
      const p = getMoonAzEl(t, loc.lat, loc.lon);
      if (p.elevation >= 0) out.push({ az: p.azimuth, el: p.elevation, t });
    }
    return out;
  };
  return { de: trackFor(de), dx: trackFor(dx) };
}

/** Speed of light, km/s — for the round-trip echo delay readout. */
const C_KM_S = 299792.458;

/**
 * Moon elevation at both ends on a regular grid — the EME planner's plot.
 * @returns {Array<{t:Date, de:number|null, dx:number|null, distanceKm:number}>}
 */
export function computeElevationSeries(start, de, dx, { hours = 48, stepMin = 10 } = {}) {
  const out = [];
  if (!hasPos(de) && !hasPos(dx)) return out;
  const n = Math.floor((hours * 60) / stepMin);
  for (let i = 0; i <= n; i++) {
    const t = new Date(start.getTime() + i * stepMin * 60_000);
    const pos = getMoonPosition(t);
    out.push({
      t,
      de: hasPos(de) ? getMoonAzEl(t, de.lat, de.lon).elevation : null,
      dx: hasPos(dx) ? getMoonAzEl(t, dx.lat, dx.lon).elevation : null,
      distanceKm: pos.distanceKm,
    });
  }
  return out;
}

/**
 * Click-a-point readout: az/el at both ends, distance, path-loss delta and
 * round-trip delay at instant `t`.
 */
export function emePointReadout(t, de, dx) {
  const pos = getMoonPosition(t);
  const view = (loc) => (hasPos(loc) ? getMoonAzEl(t, loc.lat, loc.lon) : null);
  const deV = view(de);
  const dxV = view(dx);
  return {
    t,
    de: deV ? { azimuth: deV.azimuth, elevation: deV.elevation } : null,
    dx: dxV ? { azimuth: dxV.azimuth, elevation: dxV.elevation } : null,
    distanceKm: pos.distanceKm,
    pathDeltaDb: moonPathDeltaDb(pos.distanceKm),
    delayS: (2 * pos.distanceKm) / C_KM_S,
    mutual: !!(deV && dxV && deV.elevation >= 0 && dxV.elevation >= 0),
  };
}

/**
 * Decorate mutual windows with the best (lowest) path-loss delta inside each
 * — "min degradation" for the planner table. Mutates nothing.
 */
export function withWindowDegradation(windows, stepMin = 15) {
  return (windows || []).map((w) => {
    let best = Infinity;
    for (let t = w.start.getTime(); t <= w.end.getTime(); t += stepMin * 60_000) {
      const d = moonPathDeltaDb(getMoonPosition(new Date(t)).distanceKm);
      if (d < best) best = d;
    }
    const last = moonPathDeltaDb(getMoonPosition(w.end).distanceKm);
    if (last < best) best = last;
    return { ...w, minDegradationDb: Number.isFinite(best) ? best : null };
  });
}

/** Is this frequency (MHz) inside an amateur EME band? */
export function isEmeBand(freqMHz) {
  const f = Number(freqMHz);
  if (!Number.isFinite(f)) return false;
  return EME_BANDS_MHZ.some(([lo, hi]) => f >= lo && f <= hi);
}

const EME_COMMENT_RE = /\bEME\b|MOON\s?BOUNCE|\bJT65\b|\bQ65\b|\bQRA64\b|\bMOON\b/i;

/**
 * Cluster spot filter for the EME spot list: VHF+ EME band AND a comment
 * that says so. Cluster spots carry `freq` in MHz as a string ("144.174").
 */
export function isEmeSpot(spot) {
  if (!spot) return false;
  if (!isEmeBand(spot.freq)) return false;
  return EME_COMMENT_RE.test(String(spot.comment || ''));
}

/** "2h 15m" / "45m" style duration. */
export function formatDurationShort(ms) {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
