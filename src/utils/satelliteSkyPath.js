/**
 * Polar sky-plot geometry for a satellite pass (the HamClock-style view:
 * zenith at the centre, horizon on the rim, north up).
 *
 * Pure: propagation via satellite.js, SVG coordinates as plain numbers.
 */
import * as satellite from 'satellite.js';

export const DEFAULT_SKY_STEP_SEC = 30;
export const MAX_SKY_POINTS = 600;

/** Observer record for satellite.js from an OHC location. */
export function observerFromLocation(loc) {
  if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) return null;
  return {
    longitude: satellite.degreesToRadians(Number(loc.lon)),
    latitude: satellite.degreesToRadians(Number(loc.lat)),
    height: (Number.isFinite(Number(loc.stationAlt)) ? Number(loc.stationAlt) : 100) / 1000,
  };
}

/** Look angles (deg, km) from an observer at `date`, or null when propagation fails. */
export function lookAnglesAt(satrec, observerGd, date) {
  if (!satrec || !observerGd) return null;
  let pv;
  try {
    pv = satellite.propagate(satrec, date);
  } catch {
    return null;
  }
  if (!pv?.position || typeof pv.position !== 'object') return null;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const la = satellite.ecfToLookAngles(observerGd, ecf);
  let rangeRate = 0;
  if (pv.velocity && typeof pv.velocity === 'object') {
    const observerEcf = satellite.geodeticToEcf(observerGd);
    const vEcf = satellite.eciToEcf(pv.velocity, gmst);
    const k = satellite.dopplerFactor(observerEcf, ecf, vEcf);
    rangeRate = (1 - k) * 299792.458;
  }
  return {
    azimuth: satellite.radiansToDegrees(la.azimuth),
    elevation: satellite.radiansToDegrees(la.elevation),
    rangeKm: la.rangeSat,
    rangeRateKmS: rangeRate,
  };
}

/**
 * Sample a pass between AOS and LOS.
 * @returns {null|{points:Array<{t:number,az:number,el:number}>, aos:{t,az}, los:{t,az}, max:{t,az,el}}}
 */
export function computePassSkyPath(satrec, observerGd, startMs, endMs, stepSec = DEFAULT_SKY_STEP_SEC) {
  if (!satrec || !observerGd || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  let step = Math.max(1, Number(stepSec) || DEFAULT_SKY_STEP_SEC) * 1000;
  if ((endMs - startMs) / step > MAX_SKY_POINTS) step = (endMs - startMs) / MAX_SKY_POINTS;

  const points = [];
  for (let t = startMs; t <= endMs + 1; t += step) {
    const tt = Math.min(t, endMs);
    const la = lookAnglesAt(satrec, observerGd, new Date(tt));
    if (!la) continue;
    points.push({ t: tt, az: la.azimuth, el: la.elevation });
    if (tt === endMs) break;
  }
  if (points.length < 2) return null;

  const above = points.filter((p) => p.el >= 0);
  const path = above.length >= 2 ? above : points;
  let max = path[0];
  for (const p of path) if (p.el > max.el) max = p;
  const first = path[0];
  const last = path[path.length - 1];
  return {
    points: path,
    aos: { t: first.t, az: first.az },
    los: { t: last.t, az: last.az },
    max: { t: max.t, az: max.az, el: max.el },
  };
}

/** Polar projection: elevation 90 at the centre, 0 on the rim, north up. */
export function polarXY(az, el, radius, cx = radius, cy = radius) {
  const e = Math.max(0, Math.min(90, Number(el) || 0));
  const r = radius * (1 - e / 90);
  const a = ((Number(az) || 0) * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** SVG `points` attribute for a polyline through the pass. */
export function skyPathToSvgPoints(points, radius, cx = radius, cy = radius, decimals = 1) {
  return (points || [])
    .map((p) => {
      const { x, y } = polarXY(p.az, p.el, radius, cx, cy);
      return `${x.toFixed(decimals)},${y.toFixed(decimals)}`;
    })
    .join(' ');
}

export default { observerFromLocation, lookAnglesAt, computePassSkyPath, polarXY, skyPathToSvgPoints };
