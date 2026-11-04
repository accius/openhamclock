/**
 * satRelay — two-station satellite relay planning (DE → satellite → DX) for
 * the EME layout's satellite mode.
 *
 * Pure functions on satellite.js. Angles in degrees, distances in km, times
 * are Dates. Each satellite record is expected in the shape useSatellites
 * produces: { name, omm, relayTransmitters, … }.
 */
import * as satellite from 'satellite.js';

const C_KM_S = 299792.458;

/** Ground-station geodetic record for satellite.js from an OHC location. */
export function makeObserver(loc) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
  return {
    longitude: satellite.degreesToRadians(loc.lon),
    latitude: satellite.degreesToRadians(loc.lat),
    height: (Number.isFinite(loc.stationAlt) ? loc.stationAlt : 100) / 1000,
  };
}

const satrecCache = new Map();
/** satrec for an OMM, memoised on the element set's epoch + object. */
export function satrecFor(omm) {
  if (!omm) return null;
  const key = `${omm.NORAD_CAT_ID ?? omm.OBJECT_NAME ?? ''}|${omm.EPOCH ?? ''}|${omm.MEAN_MOTION ?? ''}`;
  let rec = satrecCache.get(key);
  if (!rec) {
    try {
      rec = satellite.json2satrec(omm);
    } catch {
      return null;
    }
    if (satrecCache.size > 200) satrecCache.clear();
    satrecCache.set(key, rec);
  }
  return rec;
}

/**
 * Where the satellite is and how each observer sees it at `date`.
 * @returns {null|{lat, lon, altKm, de:{azimuth,elevation,rangeKm,dopplerFactor}, dx:{…}|null}}
 */
export function relayGeometry(satrec, date, deGd, dxGd) {
  if (!satrec || !deGd) return null;
  let pv;
  try {
    pv = satellite.propagate(satrec, date);
  } catch {
    return null;
  }
  if (!pv?.position || typeof pv.position !== 'object') return null;
  const gmst = satellite.gstime(date);
  const gd = satellite.eciToGeodetic(pv.position, gmst);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const vEcf = pv.velocity ? satellite.eciToEcf(pv.velocity, gmst) : null;
  const view = (obsGd) => {
    if (!obsGd) return null;
    const la = satellite.ecfToLookAngles(obsGd, ecf);
    let dopplerFactor = 1;
    if (vEcf) {
      try {
        dopplerFactor = satellite.dopplerFactor(satellite.geodeticToEcf(obsGd), ecf, vEcf);
      } catch {
        dopplerFactor = 1;
      }
    }
    return {
      azimuth: (satellite.radiansToDegrees(la.azimuth) + 360) % 360,
      elevation: satellite.radiansToDegrees(la.elevation),
      rangeKm: la.rangeSat,
      dopplerFactor,
    };
  };
  return {
    lat: satellite.radiansToDegrees(gd.latitude),
    lon: satellite.radiansToDegrees(gd.longitude),
    altKm: gd.height,
    de: view(deGd),
    dx: view(dxGd),
  };
}

/** Lower of the two elevations, or -90 when something is missing. */
function commonElevation(satrec, t, deGd, dxGd) {
  const g = relayGeometry(satrec, t, deGd, dxGd);
  if (!g?.de || !g?.dx) return -90;
  return Math.min(g.de.elevation, g.dx.elevation);
}

function stationElevation(satrec, t, gd) {
  const g = relayGeometry(satrec, t, gd, null);
  return g?.de ? g.de.elevation : -90;
}

/** Bisect a threshold crossing between t0 and t1 (ms) to ~2 s. */
function refine(elevAt, t0, t1, minElev, rising) {
  let lo = t0;
  let hi = t1;
  for (let i = 0; i < 16 && hi - lo > 2000; i++) {
    const mid = (lo + hi) / 2;
    const above = elevAt(mid) >= minElev;
    if (above === rising) hi = mid;
    else lo = mid;
  }
  return rising ? hi : lo;
}

/** Walk outward from `inside` (ms) to the edges of the station's own pass. */
function stationPassAround(satrec, gd, insideMs, minElev, stepMs, limitMs) {
  const elevAt = (ms) => stationElevation(satrec, new Date(ms), gd);
  let a = insideMs;
  while (a - stepMs >= limitMs.lo && elevAt(a - stepMs) >= minElev) a -= stepMs;
  let b = insideMs;
  while (b + stepMs <= limitMs.hi && elevAt(b + stepMs) >= minElev) b += stepMs;
  const aos = a - stepMs >= limitMs.lo ? refine(elevAt, a - stepMs, a, minElev, true) : a;
  const los = b + stepMs <= limitMs.hi ? refine(elevAt, b, b + stepMs, minElev, false) : b;
  return { aos: new Date(aos), los: new Date(los) };
}

/**
 * Passes where BOTH stations see the satellite at or above `minElev`.
 * @param {object} omm
 * @param {Date} start
 * @param {{lat,lon,stationAlt?}} de
 * @param {{lat,lon,stationAlt?}} dx
 * @param {{hours?:number, stepSec?:number, minElev?:number, maxPasses?:number}} [opts]
 * @returns {Array<{start:Date,end:Date,peakCommonEl:number,peakAt:Date,open:boolean,de:{aos,los},dx:{aos,los}}>}
 */
export function computeMutualPasses(
  omm,
  start,
  de,
  dx,
  { hours = 24, stepSec = 30, minElev = 5, maxPasses = 12 } = {},
) {
  const satrec = satrecFor(omm);
  const deGd = makeObserver(de);
  const dxGd = makeObserver(dx);
  if (!satrec || !deGd || !dxGd) return [];
  const step = stepSec * 1000;
  const t0 = start.getTime();
  const tEnd = t0 + hours * 3_600_000;
  const limits = { lo: t0 - 3_600_000, hi: tEnd + 3_600_000 };
  const elevAt = (ms) => commonElevation(satrec, new Date(ms), deGd, dxGd);
  const passes = [];
  let cur = null;
  let prevT = t0;
  let prevAbove = elevAt(t0) >= minElev;
  if (prevAbove) cur = { start: new Date(t0), peakCommonEl: -90, peakAt: new Date(t0), open: true };
  for (let t = t0; t <= tEnd && passes.length < maxPasses; t += step) {
    const el = elevAt(t);
    const above = el >= minElev;
    if (above && !prevAbove) {
      const edge = refine(elevAt, prevT, t, minElev, true);
      cur = { start: new Date(edge), peakCommonEl: -90, peakAt: new Date(edge), open: false };
    }
    if (above && cur && el > cur.peakCommonEl) {
      cur.peakCommonEl = el;
      cur.peakAt = new Date(t);
    }
    if (!above && prevAbove && cur) {
      cur.end = new Date(refine(elevAt, prevT, t, minElev, false));
      passes.push(cur);
      cur = null;
    }
    prevAbove = above;
    prevT = t;
  }
  if (cur) {
    cur.end = new Date(tEnd);
    cur.truncated = true;
    passes.push(cur);
  }
  for (const p of passes) {
    const inside = p.peakAt.getTime();
    p.de = stationPassAround(satrec, deGd, inside, minElev, step, limits);
    p.dx = stationPassAround(satrec, dxGd, inside, minElev, step, limits);
  }
  return passes;
}

/**
 * Elevation at both ends on a regular grid — the satellite planner's plot.
 * Either station may be missing (its series is null). Sub-point included so
 * a click can report where the bird is.
 * @returns {Array<{t:Date, de:number|null, dx:number|null, lat:number, lon:number, altKm:number}>}
 */
export function computeElevationSeries(omm, start, de, dx, { hours = 24, stepSec = 60 } = {}) {
  const satrec = satrecFor(omm);
  const deGd = makeObserver(de);
  const dxGd = makeObserver(dx);
  if (!satrec || (!deGd && !dxGd)) return [];
  const out = [];
  const n = Math.floor((hours * 3600) / stepSec);
  for (let i = 0; i <= n; i++) {
    const t = new Date(start.getTime() + i * stepSec * 1000);
    const g = relayGeometry(satrec, t, deGd || dxGd, deGd ? dxGd : null);
    if (!g) continue;
    out.push({
      t,
      de: deGd ? g.de.elevation : null,
      dx: deGd ? (g.dx ? g.dx.elevation : null) : g.de.elevation,
      lat: g.lat,
      lon: g.lon,
      altKm: g.altKm,
    });
  }
  return out;
}

/** Does this satellite carry a repeater/transponder we can relay through? */
export function hasRelay(sat) {
  return Array.isArray(sat?.relayTransmitters) && sat.relayTransmitters.length > 0;
}

/**
 * Rank tracked satellites by their next mutual pass. Satellites without relay
 * data are still listed (after the others) so an operator can see what is
 * tracked; they get no pass scan.
 * @returns {Array<{sat:object, relay:boolean, nextPass:object|null}>}
 */
export function rankRelayCandidates(sats, now, de, dx, { hours = 24, stepSec = 60, minElev = 5 } = {}) {
  const rows = (sats || []).map((sat) => {
    const relay = hasRelay(sat);
    let nextPass = null;
    if (relay && sat.omm && de && dx) {
      const passes = computeMutualPasses(sat.omm, now, de, dx, { hours, stepSec, minElev, maxPasses: 1 });
      nextPass = passes[0] || null;
    }
    return { sat, relay, nextPass };
  });
  const key = (r) => (r.nextPass ? r.nextPass.start.getTime() : Number.MAX_SAFE_INTEGER);
  return rows.sort((a, b) => {
    if (a.relay !== b.relay) return a.relay ? -1 : 1;
    return key(a) - key(b) || String(a.sat.name).localeCompare(String(b.sat.name));
  });
}

/** Doppler-corrected frequencies for DE: what to listen on, what to transmit on. */
export function dopplerCorrected(tx, dopplerFactor) {
  if (!tx || !Number.isFinite(dopplerFactor) || dopplerFactor <= 0) return null;
  const mid = (lo, hi) => (lo && hi ? (lo + hi) / 2 : lo || hi || null);
  const down = mid(tx.downlinkLowHz, tx.downlinkHighHz);
  const up = mid(tx.uplinkLowHz, tx.uplinkHighHz);
  return {
    // Received signal is shifted by the factor; transmit the inverse so it
    // arrives on the transponder's nominal input.
    downlinkHz: down ? down * dopplerFactor : null,
    uplinkHz: up ? up / dopplerFactor : null,
    downlinkShiftHz: down ? down * (dopplerFactor - 1) : null,
    uplinkShiftHz: up ? up / dopplerFactor - up : null,
  };
}

export const formatMHz = (hz, digits = 4) => (Number.isFinite(hz) ? (hz / 1e6).toFixed(digits) : '—');
export { C_KM_S };

// ── Cluster spot matching ────────────────────────────────────────────────
/** Amateur satellite downlink/uplink ranges, MHz (incl. AO-7 mode A on 10 m). */
const SAT_BANDS_MHZ = [
  [29.3, 29.55],
  [145.8, 146.0],
  [435.0, 438.0],
  [1260.0, 1270.0],
  [2400.0, 2450.0],
];
const SAT_WORDS_RE = /\bSAT\b|\bSATELLITE\b|\bVIA\b|\bOSCAR\b|\bFM\s?SAT\b|\bLINEAR\b|\bTRANSPONDER\b/i;
const SAT_DESIGNATOR_RE =
  /\b(?:AO|SO|RS|FO|JO|IO|PO|CAS|TEVEL2?|LILACSAT|XW|EO|NO|HO|MO|QO|TO|UO|VO|ISS)-?\d*[A-Z]?\b/i;

/** Short designator a satellite is known by in spot comments: "AO-91 (Fox-1B)" → "AO-91", "ISS (ZARYA)" → "ISS". */
export function satShortName(name) {
  return String(name || '')
    .split(' (')[0]
    .trim()
    .toUpperCase();
}

/**
 * Is this cluster spot a satellite contact, and via which tracked satellite?
 * @param {object} spot  cluster spot ({ freq: "145.850" MHz string, comment })
 * @param {string[]} [trackedNames]  satellite names to recognise by designator
 * @returns {null|{ satName: string|null }}  null when not a satellite spot;
 *   satName is the tracked satellite's full name when the comment names it.
 */
export function matchSatSpot(spot, trackedNames = []) {
  if (!spot) return null;
  const f = Number(spot.freq);
  if (!Number.isFinite(f) || !SAT_BANDS_MHZ.some(([lo, hi]) => f >= lo && f <= hi)) return null;
  const comment = String(spot.comment || '').toUpperCase();
  let satName = null;
  for (const name of trackedNames) {
    const short = satShortName(name);
    if (short && new RegExp(`\\b${short.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(comment)) {
      satName = name;
      break;
    }
  }
  if (!satName && !SAT_WORDS_RE.test(comment) && !SAT_DESIGNATOR_RE.test(comment)) return null;
  return { satName };
}

/**
 * Pair AMSAT status rows with a tracked satellite. AMSAT names look like
 * "ISS [FM]", "FO-29 [V/u]", "AO-91 [FM]", "GRBBeta [UHF Digi]": designator
 * plus a bracketed mode tag. Match on the designator; when a bird has several
 * rows, prefer the voice/transponder one over data or digipeater rows.
 * @param {string} trackedName
 * @param {Array<{name:string}>} amsatRows
 */
export function findAmsatRow(trackedName, amsatRows = []) {
  const short = satShortName(trackedName);
  if (!short) return null;
  const parse = (n) => {
    const str = String(n || '');
    const m = str.match(/^\s*([^[\]]+?)\s*(?:\[([^\]]*)\])?\s*$/);
    return { short: (m ? m[1] : str).trim().toUpperCase().replace(/\s+/g, ''), tag: m && m[2] ? m[2] : '' };
  };
  const rows = amsatRows.map((r) => ({ r, ...parse(r.name) })).filter((x) => x.short === short);
  if (!rows.length) return null;
  const voice = rows.find((x) => /FM|V\/U|U\/V|L\/V|VOICE|REPEATER|TRANSPONDER|SSB|LINEAR/i.test(x.tag));
  return (voice || rows[0]).r;
}
