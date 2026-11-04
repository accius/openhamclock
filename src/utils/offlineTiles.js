/**
 * Offline area packs — pure tile math (no DOM, no network, no caches).
 *
 * Web Mercator "slippy map" tiles: at zoom z the world is 2^z × 2^z tiles of
 * 256 px, x growing east from the antimeridian and y growing south from
 * ±85.0511°. Everything here is deterministic so the pack size shown before
 * a download matches what the download actually fetches.
 *
 * A bbox is { west, south, east, north } in degrees. `west > east` means the
 * box crosses the antimeridian (e.g. west 170, east -170).
 */

import { subdomainFor, buildTileUrl } from './swPolicy.js';

export const MAX_MERCATOR_LAT = 85.0511287798066;

/** Zoom range offered by the download control. */
export const OFFLINE_ZOOM_MIN = 3;
export const OFFLINE_ZOOM_MAX = 16;
export const DEFAULT_MIN_ZOOM = 6;
export const DEFAULT_MAX_ZOOM = 12;

/** "Radius around DE" presets, km. */
export const RADIUS_PRESETS_KM = [25, 50, 100];
export const DEFAULT_RADIUS_KM = 50;

/** Hard cap per pack — keeps one click from hammering a volunteer-friendly
 *  tile server or filling the disk. ~10k tiles ≈ 250–300 MB. */
export const MAX_TILES_PER_PACK = 10000;

/** Fallback when a style has no measured average tile size. */
export const DEFAULT_AVG_TILE_BYTES = 25 * 1024;

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_KM) / 180; // ≈ 111.19

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Wrap a longitude into [-180, 180). */
export function wrapLon(lon) {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  // Keep +180 itself as 180 so an eastern edge on the antimeridian is not
  // flipped to the far west.
  return w === -180 && lon > 0 ? 180 : w;
}

export function clampLat(lat) {
  return clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
}

/** Tile column containing a longitude at zoom z. */
export function lonToTileX(lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((wrapLon(lon) + 180) / 360) * n);
  return clamp(x, 0, n - 1);
}

/** Tile row containing a latitude at zoom z. */
export function latToTileY(lat, z) {
  const n = 2 ** z;
  const r = (clampLat(lat) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return clamp(y, 0, n - 1);
}

/** North-west corner of a tile, degrees (inverse of the two above). */
export function tileToLonLat(x, y, z) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

/**
 * Validate and normalize a bbox: finite numbers, latitudes clamped to the
 * Mercator limit and ordered, longitudes wrapped. A box 360° or wider (a
 * zoomed-out map view) becomes the whole world. Returns null when invalid.
 */
export function normalizeBbox(bbox) {
  if (!bbox) return null;
  let { west, south, east, north } = bbox;
  if (![west, south, east, north].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  if (south > north) [south, north] = [north, south];
  south = clampLat(south);
  north = clampLat(north);
  if (south === north) return null;
  if (east - west >= 360) return { west: -180, south, east: 180, north };
  if (east === west) return null;
  return { west: wrapLon(west), south, east: wrapLon(east), north };
}

/** Square-ish bbox covering a circle of radiusKm around a point. */
export function bboxAroundPoint(lat, lon, radiusKm) {
  if (![lat, lon, radiusKm].every((v) => typeof v === 'number' && Number.isFinite(v)) || radiusKm <= 0) return null;
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const cosLat = Math.max(Math.cos((clampLat(lat) * Math.PI) / 180), 0.01);
  const dLon = Math.min(radiusKm / (KM_PER_DEG_LAT * cosLat), 179.999);
  return normalizeBbox({ west: lon - dLon, south: lat - dLat, east: lon + dLon, north: lat + dLat });
}

/** True when the point lies inside the (normalized) bbox. */
export function bboxContains(bbox, lat, lon) {
  const b = normalizeBbox(bbox);
  if (!b || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < b.south || lat > b.north) return false;
  const l = wrapLon(lon);
  return b.west <= b.east ? l >= b.west && l <= b.east : l >= b.west || l <= b.east;
}

/** Center of a bbox (antimeridian-aware). */
export function bboxCenter(bbox) {
  const b = normalizeBbox(bbox);
  if (!b) return null;
  const span = b.west <= b.east ? b.east - b.west : b.east + 360 - b.west;
  return { lat: (b.south + b.north) / 2, lon: wrapLon(b.west + span / 2) };
}

/**
 * Tile ranges ({ z, minX, maxX, minY, maxY }, inclusive) covering a bbox at
 * one zoom. Usually one range; two when the box crosses the antimeridian.
 */
export function tileRangesForBbox(bbox, z) {
  const b = normalizeBbox(bbox);
  if (!b || !Number.isInteger(z) || z < 0) return [];
  const minY = latToTileY(b.north, z);
  const maxY = latToTileY(b.south, z);
  const n = 2 ** z;
  // An east edge exactly on a tile boundary belongs to the tile to its west.
  const eastX = (lon) => (lon >= 180 ? n - 1 : lonToTileX(lon, z));
  if (b.west <= b.east) {
    return [{ z, minX: lonToTileX(b.west, z), maxX: eastX(b.east), minY, maxY }];
  }
  const ranges = [
    { z, minX: lonToTileX(b.west, z), maxX: n - 1, minY, maxY },
    { z, minX: 0, maxX: eastX(b.east), minY, maxY },
  ];
  // At low zooms both halves can land on overlapping columns — merge them.
  if (ranges[1].maxX >= ranges[0].minX) return [{ z, minX: 0, maxX: n - 1, minY, maxY }];
  return ranges;
}

const rangeCount = (r) => (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);

/** Tile count per zoom level: [{ z, count }]. */
export function countTilesPerZoom(bbox, minZoom, maxZoom) {
  const out = [];
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom > maxZoom) return out;
  for (let z = minZoom; z <= maxZoom; z++) {
    out.push({ z, count: tileRangesForBbox(bbox, z).reduce((sum, r) => sum + rangeCount(r), 0) });
  }
  return out;
}

/** Total tiles for a bbox across a zoom range. */
export function countTiles(bbox, minZoom, maxZoom) {
  return countTilesPerZoom(bbox, minZoom, maxZoom).reduce((sum, row) => sum + row.count, 0);
}

/**
 * Every tile in the bbox/zoom range, low zoom first (so a cancelled or
 * capped download still leaves a usable overview). A generator, so a big
 * area never materializes as one huge array.
 */
export function* enumerateTiles(bbox, minZoom, maxZoom) {
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom)) return;
  for (let z = minZoom; z <= maxZoom; z++) {
    for (const r of tileRangesForBbox(bbox, z)) {
      for (let y = r.minY; y <= r.maxY; y++) {
        for (let x = r.minX; x <= r.maxX; x++) yield { z, x, y };
      }
    }
  }
}

/** True when tile z/x/y falls inside the bbox's tile ranges at its zoom. */
export function tileInBbox(bbox, tile) {
  if (!tile) return false;
  return tileRangesForBbox(bbox, tile.z).some(
    (r) => tile.x >= r.minX && tile.x <= r.maxX && tile.y >= r.minY && tile.y <= r.maxY,
  );
}

/** Estimated bytes for a pack (tile count × the style's average tile size). */
export function estimatePackBytes(tileCount, avgTileBytes = DEFAULT_AVG_TILE_BYTES) {
  const n = Number(tileCount) || 0;
  const avg = Number(avgTileBytes) > 0 ? Number(avgTileBytes) : DEFAULT_AVG_TILE_BYTES;
  return Math.max(0, Math.round(n * avg));
}

/** Human-readable size: 950 B, 12.3 KB, 4.6 MB, 1.20 GB. */
export function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Leaflet-identical subdomain choice and URL filling. The implementation
 * lives in public/sw-policy.js so the service worker (which rebuilds
 * ancestor-tile URLs for over-zoom) and the page share one copy.
 */
export { subdomainFor, buildTileUrl };

/** Whether a MAP_STYLES entry may be downloaded as an offline pack. */
export function isOfflinePackStyle(style) {
  return !!(style && style.offlinePack === true && typeof style.url === 'string' && style.url && !style.isCanvas);
}

/** Style ids eligible for offline packs, in MAP_STYLES order. */
export function offlinePackStyleIds(styles) {
  return Object.keys(styles || {}).filter((id) => isOfflinePackStyle(styles[id]));
}
