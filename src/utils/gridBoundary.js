/**
 * gridBoundary — Maidenhead grid-edge math for rover mode.
 *
 * Pure functions: where are the edges of the grid square I'm in, how far
 * away are they, and — given my course and speed — which edge will I cross
 * first and when. Distances use a local flat-earth approximation, which is
 * accurate to well under 1 % at grid-square scale.
 */
import { latLonToMaidenhead } from './geo.js';

const KM_PER_DEG_LAT = 111.195; // mean meridional degree

/** Cell size in degrees for a locator of the given length. */
export const cellSizeDeg = (precision = 6) => {
  if (precision <= 2) return { lat: 10, lon: 20 };
  if (precision <= 4) return { lat: 1, lon: 2 };
  if (precision <= 6) return { lat: 2.5 / 60, lon: 5 / 60 };
  return { lat: 0.25 / 60, lon: 0.5 / 60 };
};

const normLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Edges of the grid cell containing (lat, lon).
 * @returns {{south:number, north:number, west:number, east:number}|null} degrees
 */
export const gridBoundsAt = (lat, lon, precision = 6) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  const { lat: dLat, lon: dLon } = cellSizeDeg(precision);
  const lonN = normLon(lon);
  // Index in cells from the dateline / south pole; floor on a rounded value
  // so 40.0 lands in the cell that starts at 40.0, not the one below it.
  const iLat = Math.floor(Math.round(((lat + 90) / dLat) * 1e6) / 1e6);
  const iLon = Math.floor(Math.round(((lonN + 180) / dLon) * 1e6) / 1e6);
  const south = iLat * dLat - 90;
  const west = iLon * dLon - 180;
  return { south, north: south + dLat, west, east: west + dLon };
};

/**
 * Distance in km from (lat, lon) to each edge of its grid cell.
 * @returns {{north:number, south:number, east:number, west:number}|null}
 */
export const distanceToGridEdges = (lat, lon, precision = 6) => {
  const b = gridBoundsAt(lat, lon, precision);
  if (!b) return null;
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const lonN = normLon(lon);
  return {
    north: (b.north - lat) * KM_PER_DEG_LAT,
    south: (lat - b.south) * KM_PER_DEG_LAT,
    east: (b.east - lonN) * kmPerDegLon,
    west: (lonN - b.west) * kmPerDegLon,
  };
};

/** Minutes to cover distKm at speedKmh; null when (practically) stationary. */
export const etaMinutes = (distKm, speedKmh) => {
  if (!Number.isFinite(distKm) || !Number.isFinite(speedKmh) || speedKmh < 1) return null;
  return (distKm / speedKmh) * 60;
};

/**
 * First grid edge crossed when travelling on `courseDeg` (true) from
 * (lat, lon), with the grid entered on the other side.
 *
 * @returns {{edge:'N'|'S'|'E'|'W', distanceKm:number, etaMin:number|null, nextGrid:string|null}|null}
 *          null when the course is unknown
 */
export const nextGridCrossing = (lat, lon, courseDeg, speedKmh, precision = 6) => {
  const d = distanceToGridEdges(lat, lon, precision);
  if (!d || !Number.isFinite(courseDeg)) return null;
  const rad = (courseDeg * Math.PI) / 180;
  const dx = Math.sin(rad); // east component (km per km travelled)
  const dy = Math.cos(rad); // north component
  const eps = 1e-9;
  const candidates = [];
  if (dy > eps) candidates.push({ edge: 'N', t: d.north / dy });
  if (dy < -eps) candidates.push({ edge: 'S', t: d.south / -dy });
  if (dx > eps) candidates.push({ edge: 'E', t: d.east / dx });
  if (dx < -eps) candidates.push({ edge: 'W', t: d.west / -dx });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.t - b.t);
  const { edge, t } = candidates[0];
  // Point 20 m past the crossing → the grid being entered
  const overKm = t + 0.02;
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const nLat = lat + (dy * overKm) / KM_PER_DEG_LAT;
  const nLon = normLon(lon + (dx * overKm) / kmPerDegLon);
  let nextGrid = null;
  try {
    nextGrid = Math.abs(nLat) <= 90 ? latLonToMaidenhead({ lat: nLat, lon: nLon }, precision) : null;
  } catch {
    nextGrid = null;
  }
  return { edge, distanceKm: t, etaMin: etaMinutes(t, speedKmh), nextGrid };
};

/** 'N' | 'S' | 'E' | 'W' → neighbouring grid locator (same precision). */
export const adjacentGrid = (lat, lon, edge, precision = 6) => {
  const b = gridBoundsAt(lat, lon, precision);
  if (!b) return null;
  const { lat: dLat, lon: dLon } = cellSizeDeg(precision);
  const midLat = (b.south + b.north) / 2;
  const midLon = (b.west + b.east) / 2;
  const target = {
    N: { lat: midLat + dLat, lon: midLon },
    S: { lat: midLat - dLat, lon: midLon },
    E: { lat: midLat, lon: normLon(midLon + dLon) },
    W: { lat: midLat, lon: normLon(midLon - dLon) },
  }[edge];
  if (!target || Math.abs(target.lat) > 90) return null;
  try {
    return latLonToMaidenhead(target, precision);
  } catch {
    return null;
  }
};

/** Great-circle-free speed sanity: km/h → the unit label the user chose. */
export const formatSpeed = (kmh, units = 'metric') => {
  if (!Number.isFinite(kmh)) return '—';
  return units === 'imperial' ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`;
};

export default {
  cellSizeDeg,
  gridBoundsAt,
  distanceToGridEdges,
  etaMinutes,
  nextGridCrossing,
  adjacentGrid,
  formatSpeed,
};
