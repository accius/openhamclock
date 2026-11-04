/**
 * Eclipse computations for the Eclipse panel.
 *
 * Canon: solar and lunar eclipses are found from the lunar phase series
 * (Meeus, Astronomical Algorithms ch. 49/54): for every new/full moon,
 * gamma (shadow-axis distance from Earth's centre in Earth radii) and u
 * (umbral radius on the fundamental plane) decide whether there is an
 * eclipse and of what type. Times of greatest eclipse come out within a few
 * minutes, gamma/magnitude within ~0.01 of the NASA canon. The bundled
 * table (src/utils/eclipses-2026-2040.json) adds what no formula gives —
 * where on Earth each one is visible — and is merged by date.
 *
 * Local circumstances (DE): topocentric Sun/Moon from utils/planets.js,
 * scanned around greatest eclipse. The Moon series is good to ~2′, so
 * obscuration is an estimate (±5 %) and a deep total at DE may read 98 %.
 * Lunar eclipses are simply "is the Moon up during the umbral phase".
 */

import { bodyTopocentric, angularSeparation, BODY_RADIUS_KM } from './planets.js';
import eclipseTable from './eclipses-2026-2040.json';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const JD_UNIX = 2440587.5;

const sin = (deg) => Math.sin(deg * DEG);
const cos = (deg) => Math.cos(deg * DEG);
const jdToDate = (jd) => new Date((jd - JD_UNIX) * 86400000);

export const ECLIPSE_TABLE_SOURCE = eclipseTable.source;

/**
 * Meeus ch. 54 for lunation k (integer → new moon / solar, k+0.5 → full
 * moon / lunar). Returns null when no eclipse occurs.
 */
export function eclipseForLunation(k) {
  const solar = Number.isInteger(k);
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  const jdeMean = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

  if (Math.abs(sin(F)) > 0.36) return null;

  const F1 = F - 0.02665 * sin(Om);
  const A1 = 299.77 + 0.107408 * k - 0.009173 * T2;

  let jde = jdeMean;
  jde += solar ? -0.4075 * sin(Mp) + 0.1721 * E * sin(M) : -0.4065 * sin(Mp) + 0.1727 * E * sin(M);
  jde +=
    0.0161 * sin(2 * Mp) -
    0.0097 * sin(2 * F1) +
    0.0073 * E * sin(Mp - M) -
    0.005 * E * sin(Mp + M) -
    0.0023 * sin(Mp - 2 * F1) +
    0.0021 * E * sin(2 * M) +
    0.0012 * sin(Mp + 2 * F1) +
    0.0006 * E * sin(2 * Mp + M) -
    0.0004 * sin(3 * Mp) -
    0.0003 * E * sin(M + 2 * F1) +
    0.0003 * sin(A1) -
    0.0002 * E * sin(M - 2 * F1) -
    0.0002 * E * sin(2 * Mp - M) -
    0.0002 * sin(Om);

  const P =
    0.207 * E * sin(M) +
    0.0024 * E * sin(2 * M) -
    0.0392 * sin(Mp) +
    0.0116 * sin(2 * Mp) -
    0.0073 * E * sin(Mp + M) +
    0.0067 * E * sin(Mp - M) +
    0.0118 * sin(2 * F1);
  const Q =
    5.2207 -
    0.0048 * E * cos(M) +
    0.002 * E * cos(2 * M) -
    0.3299 * cos(Mp) -
    0.006 * E * cos(Mp + M) +
    0.0041 * E * cos(Mp - M);
  const W = Math.abs(cos(F1));
  const gamma = (P * cos(F1) + Q * sin(F1)) * (1 - 0.0048 * W);
  const u = 0.0059 + 0.0046 * E * cos(M) - 0.0182 * cos(Mp) + 0.0004 * cos(2 * Mp) - 0.0005 * cos(M + Mp);
  const ag = Math.abs(gamma);

  if (solar) {
    if (ag > 1.5433 + u) return null;
    let type;
    let magnitude = null;
    if (ag < 0.9972 + Math.abs(u)) {
      // Central (or barely non-central) eclipse
      if (u < 0) type = 'total';
      else if (u > 0.0047) type = 'annular';
      else {
        const omega = 0.00464 * Math.sqrt(Math.max(0, 1 - gamma * gamma));
        type = u < omega ? 'hybrid' : 'annular';
      }
      // Umbral ratio ≈ apparent diameter ratio Moon/Sun on the axis: 1 − u/0.5461... not
      // in Meeus; we report the partial-formula magnitude for partials only.
    } else {
      type = 'partial';
      magnitude = (1.5433 + u - ag) / (0.5461 + 2 * u);
    }
    return { kind: 'solar', type, k, time: jdToDate(jde), gamma, u, magnitude };
  }

  // Lunar
  const penMag = (1.5573 + u - ag) / 0.545;
  if (penMag < 0) return null;
  const umbMag = (1.0128 - u - ag) / 0.545;
  const n = 0.5458 + 0.04 * cos(Mp);
  const semi = (radius) => {
    const v = radius * radius - gamma * gamma;
    return v > 0 ? (60 / n) * Math.sqrt(v) : null; // minutes
  };
  const type = umbMag < 0 ? 'penumbral' : umbMag >= 1 ? 'total' : 'partial';
  return {
    kind: 'lunar',
    type,
    k,
    time: jdToDate(jde),
    gamma,
    u,
    magnitude: umbMag >= 0 ? umbMag : penMag,
    penumbralMagnitude: penMag,
    umbralMagnitude: umbMag,
    semiPenumbral: semi(1.5573 + u),
    semiPartial: semi(1.0128 - u),
    semiTotal: semi(0.4678 - u),
  };
}

/** Approximate lunation number for a Date (Meeus 49.2). */
export function lunationFor(date) {
  const y = date.getUTCFullYear() + (date.getUTCMonth() + date.getUTCDate() / 31) / 12;
  return (y - 2000) * 12.3685;
}

/**
 * All solar and lunar eclipses with greatest eclipse between two dates,
 * chronological.
 */
export function computeEclipses(from, to) {
  const out = [];
  const k0 = Math.floor(lunationFor(from)) - 1;
  const k1 = Math.ceil(lunationFor(to)) + 1;
  for (let k = k0; k <= k1; k++) {
    for (const kk of [k, k + 0.5]) {
      const e = eclipseForLunation(kk);
      if (e && e.time >= from && e.time <= to) out.push(e);
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

const dayKey = (d) => d.toISOString().slice(0, 10);

/** Find the bundled table row for a computed eclipse (same kind, ±1 day). */
export function tableEntryFor(e, rows = eclipseTable.eclipses) {
  const t = e.time.getTime();
  return (
    rows.find((r) => {
      if (r.kind !== e.kind) return false;
      const rt = Date.parse(r.date + 'T12:00:00Z');
      return Math.abs(rt - t) < 1.5 * 86400000;
    }) || null
  );
}

/** Merge the computed canon with the table's visibility text. */
export function eclipseCatalog(from, to) {
  return computeEclipses(from, to).map((e) => {
    const row = tableEntryFor(e);
    return {
      ...e,
      date: dayKey(e.time),
      // NASA's type wins on the rare annular/hybrid borderline
      type: row?.type || e.type,
      magnitude: row?.magnitude ?? e.magnitude,
      gammaCanon: row?.gamma ?? null,
      visibility: row?.visibility || null,
      path: row?.path || null,
      inTable: !!row,
    };
  });
}

// ── Local circumstances ─────────────────────────────────────

/** Fraction of the solar disk covered given angular radii and separation (all degrees). */
export function obscuration(rSun, rMoon, sep) {
  if (sep >= rSun + rMoon) return 0;
  if (sep <= Math.abs(rSun - rMoon)) return Math.min(1, (rMoon * rMoon) / (rSun * rSun));
  // Lens area of two overlapping disks
  const r1 = rSun;
  const r2 = rMoon;
  const d = sep;
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const a3 = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return Math.max(0, Math.min(1, (a1 + a2 - a3) / (Math.PI * r1 * r1)));
}

function sunMoonGeometry(t, lat, lon) {
  const sun = bodyTopocentric('Sun', t, lat, lon);
  const moon = bodyTopocentric('Moon', t, lat, lon);
  const rSun = Math.asin(BODY_RADIUS_KM.Sun / sun.distanceKm) * RAD;
  const rMoon = Math.asin(BODY_RADIUS_KM.Moon / moon.distanceKm) * RAD;
  const sep = angularSeparation(sun.ra, sun.dec, moon.ra, moon.dec);
  return { sunEl: sun.el, sunAz: sun.az, rSun, rMoon, sep, obs: obscuration(rSun, rMoon, sep) };
}

/**
 * Solar eclipse as seen from an observer. Scans ±4 h around greatest
 * eclipse (4-minute steps, then 30-second refinement around the peak).
 * Only moments with the Sun above the horizon count.
 * @returns {{ visible, maxTime, obscuration, magnitude, sunEl, sunAz, start, end, localType }}
 */
export function solarEclipseLocal(greatest, lat, lon) {
  const SPAN = 4 * 3600e3;
  const STEP = 4 * 60e3;
  const t0 = greatest.getTime();
  let best = null;
  let start = null;
  let end = null;
  let prevIn = false;
  for (let t = t0 - SPAN; t <= t0 + SPAN; t += STEP) {
    const g = sunMoonGeometry(new Date(t), lat, lon);
    const up = g.sunEl > -0.833;
    const inEclipse = up && g.obs > 0;
    if (inEclipse && !prevIn && start == null) start = new Date(t);
    if (!inEclipse && prevIn && end == null && start != null) end = new Date(t);
    prevIn = inEclipse;
    if (up && (!best || g.obs > best.obs)) best = { ...g, t };
  }
  if (!best || best.obs <= 0) {
    return {
      visible: false,
      maxTime: null,
      obscuration: 0,
      magnitude: 0,
      sunEl: null,
      sunAz: null,
      start: null,
      end: null,
      localType: null,
    };
  }
  // Refine the peak
  let peak = best;
  for (let t = best.t - STEP; t <= best.t + STEP; t += 30e3) {
    const g = sunMoonGeometry(new Date(t), lat, lon);
    if (g.sunEl > -0.833 && g.obs > peak.obs) peak = { ...g, t };
  }
  const magnitude = Math.max(0, (peak.rSun + peak.rMoon - peak.sep) / (2 * peak.rSun));
  const localType =
    peak.sep <= Math.abs(peak.rSun - peak.rMoon) ? (peak.rMoon >= peak.rSun ? 'total' : 'annular') : 'partial';
  return {
    visible: true,
    maxTime: new Date(peak.t),
    obscuration: peak.obs,
    magnitude,
    sunEl: peak.sunEl,
    sunAz: peak.sunAz,
    start,
    end: end || (prevIn ? null : end),
    localType,
  };
}

/**
 * Lunar eclipse as seen from an observer: is the Moon up during the
 * umbral (or, for penumbral eclipses, penumbral) phase?
 * @returns {{ visible, elAtMax, start, end, coverage: 'all'|'part'|'none' }}
 */
export function lunarEclipseLocal(eclipse, lat, lon) {
  const semi = eclipse.semiPartial ?? eclipse.semiPenumbral ?? 60;
  const t0 = eclipse.time.getTime();
  const start = new Date(t0 - semi * 60e3);
  const end = new Date(t0 + semi * 60e3);
  let up = 0;
  let total = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 10 * 60e3) {
    total++;
    if (bodyTopocentric('Moon', new Date(t), lat, lon).el > -0.833) up++;
  }
  const elAtMax = bodyTopocentric('Moon', eclipse.time, lat, lon).el;
  const coverage = up === 0 ? 'none' : up === total ? 'all' : 'part';
  return { visible: up > 0, elAtMax, start, end, coverage };
}

/**
 * Upcoming eclipses for the panel: the catalog from `now` (minus a day so
 * an eclipse in progress still shows) through `years` ahead, with DE local
 * circumstances attached when a location is given.
 */
export function upcomingEclipses(now = new Date(), { lat = null, lon = null, years = 15, limit = 12 } = {}) {
  const from = new Date(now.getTime() - 86400000);
  const to = new Date(now.getTime() + years * 365.25 * 86400000);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lon);
  return eclipseCatalog(from, to)
    .slice(0, limit)
    .map((e) => ({
      ...e,
      local: hasLoc
        ? e.kind === 'solar'
          ? solarEclipseLocal(e.time, lat, lon)
          : lunarEclipseLocal(e, lat, lon)
        : null,
    }));
}

export default { computeEclipses, eclipseCatalog, upcomingEclipses, solarEclipseLocal, lunarEclipseLocal };
