/**
 * aircraftQuery — build the /api/aircraft URL for a point (#1284).
 *
 * adsb.lol only answers within 250 NM of a point, so the server fetches per
 * 0.5° cell. The client snaps to the same cell first: viewers near each
 * other hit the same URL, the request carries no precise location, and a
 * map pan only refetches when it crosses into another cell.
 */
export const AIRCRAFT_CELL_DEG = 0.5;
export const AIRCRAFT_RADIUS_NM = 250;
// Guaranteed coverage around the requested point: 250 NM less the worst-case
// snap offset (half a cell diagonal, ~21 NM) ≈ 424 km.
export const AIRCRAFT_COVERAGE_KM = 424;

/** Centre of the cell containing (lat, lon), or null for an invalid point. */
export function aircraftCell(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const snap = (v) => Math.round(v / AIRCRAFT_CELL_DEG) * AIRCRAFT_CELL_DEG;
  const cLat = Math.max(-90, Math.min(90, snap(lat)));
  let cLon = snap(wrapped);
  if (cLon >= 180) cLon -= 360;
  return { lat: cLat, lon: cLon, key: `${cLat.toFixed(1)},${cLon.toFixed(1)}` };
}

/** /api/aircraft URL for the cell around (lat, lon), or null. */
export function aircraftUrl(lat, lon) {
  const cell = aircraftCell(lat, lon);
  return cell ? `/api/aircraft?lat=${cell.lat.toFixed(1)}&lon=${cell.lon.toFixed(1)}` : null;
}
