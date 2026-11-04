/**
 * Offline area packs — manifest handling (pure; no caches, no network).
 *
 * A pack manifest describes one downloaded area:
 *   {
 *     v: 1, id, name, styleId, styleName, urlTemplate, subdomains,
 *     bbox: { west, south, east, north }, minZoom, maxZoom,
 *     center: { lat, lon }, radiusKm (null for a map-view pack),
 *     dataCenter, retina, tileCount (tiles saved), failedCount, totalTiles,
 *     bytes, createdAt (ms), complete (false = stopped early, resumable),
 *     data: { alerts|shelters|repeaters|disasters: { fetchedAt, count, state? } }
 *   }
 * The list of manifests lives in the pack cache (see offlinePackStore.js);
 * everything here works on plain objects so it can be unit-tested.
 */
import { normalizeBbox, bboxContains, bboxCenter, tileInBbox } from './offlineTiles.js';
import { calculateDistance, calculateBearing } from './geo.js';

export const MANIFEST_VERSION = 1;

/** Storage budget choices (MB) and the default. */
export const BUDGET_OPTIONS_MB = [100, 250, 500, 1000, 2000];
export const DEFAULT_BUDGET_MB = 250;

/** Share of the browser's quota at which we warn / refuse to start. */
export const QUOTA_WARN_RATIO = 0.8;
export const QUOTA_BLOCK_RATIO = 0.95;

/** EmComm data kinds snapshotted with each pack. */
export const SNAPSHOT_KINDS = ['alerts', 'shelters', 'repeaters', 'disasters'];

/** Repeater snapshot radius — covers every Repeaters panel radius ≤ 200 km. */
export const SNAPSHOT_REPEATER_RADIUS_KM = 200;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Short unique id: base36 time + random suffix. */
export function newPackId(now = Date.now(), rand = Math.random) {
  return `p${Math.floor(now).toString(36)}${Math.floor(rand() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')}`;
}

/** True when an area stopped before all its tiles were saved. */
export function isIncomplete(m) {
  return !!m && m.complete === false;
}

/** Default pack name: "50 km around FN31" / "Map view near 40.0, -105.3". */
export function defaultPackName({ mode, radiusKm, locator, center }) {
  const where = locator
    ? String(locator).slice(0, 4).toUpperCase()
    : center && isNum(center.lat) && isNum(center.lon)
      ? `${center.lat.toFixed(1)}, ${center.lon.toFixed(1)}`
      : 'DE';
  if (mode === 'radius' && isNum(radiusKm)) return `${radiusKm} km around ${where}`;
  return `Map view near ${where}`;
}

/** Build a manifest from download parameters + results. */
export function createPackManifest(p) {
  const bbox = normalizeBbox(p.bbox);
  return {
    v: MANIFEST_VERSION,
    id: p.id || newPackId(),
    name: String(p.name || '').trim() || 'Offline area',
    styleId: p.styleId,
    styleName: p.styleName || p.styleId,
    urlTemplate: p.urlTemplate,
    subdomains: p.subdomains ?? 'abc',
    bbox,
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    center: p.center && isNum(p.center.lat) && isNum(p.center.lon) ? p.center : bboxCenter(bbox),
    radiusKm: isNum(p.radiusKm) ? p.radiusKm : null,
    dataCenter: p.dataCenter && isNum(p.dataCenter.lat) && isNum(p.dataCenter.lon) ? p.dataCenter : null,
    retina: !!p.retina,
    tileCount: p.tileCount || 0,
    failedCount: p.failedCount || 0,
    totalTiles: isNum(p.totalTiles) ? p.totalTiles : p.tileCount || 0,
    bytes: p.bytes || 0,
    createdAt: isNum(p.createdAt) ? p.createdAt : Date.now(),
    // false while downloading, after Cancel, or when it stopped early; such
    // an area can be resumed. Manifests from before resumable downloads
    // have no flag and are complete.
    complete: p.complete !== false,
    data: p.data && typeof p.data === 'object' ? p.data : {},
  };
}

/** Structural check — anything failing it is dropped on load. */
export function isValidManifest(m) {
  return !!(
    m &&
    typeof m === 'object' &&
    m.v === MANIFEST_VERSION &&
    typeof m.id === 'string' &&
    m.id &&
    typeof m.styleId === 'string' &&
    typeof m.urlTemplate === 'string' &&
    m.urlTemplate &&
    normalizeBbox(m.bbox) &&
    Number.isInteger(m.minZoom) &&
    Number.isInteger(m.maxZoom) &&
    m.minZoom <= m.maxZoom &&
    isNum(m.tileCount) &&
    isNum(m.bytes) &&
    isNum(m.createdAt)
  );
}

/** Parse a stored manifest list (JSON string or array), keeping valid ones. */
export function parseManifestList(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (list && !Array.isArray(list) && Array.isArray(list.packs)) list = list.packs;
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter((m) => {
    if (!isValidManifest(m) || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/** Insert or replace a manifest by id; newest first. */
export function upsertPack(list, manifest) {
  const rest = (list || []).filter((m) => m.id !== manifest.id);
  return [manifest, ...rest].sort((a, b) => b.createdAt - a.createdAt);
}

export function removePackById(list, id) {
  return (list || []).filter((m) => m.id !== id);
}

/** Sum of pack sizes. Overlapping packs share tiles, so this is an upper
 *  bound on what the packs really occupy — the safe side for a budget. */
export function totalPackBytes(list) {
  return (list || []).reduce((sum, m) => sum + (isNum(m.bytes) ? m.bytes : 0), 0);
}

/** Packs whose area contains the point, newest first. */
export function packsCoveringLocation(list, lat, lon) {
  return (list || []).filter((m) => bboxContains(m.bbox, lat, lon)).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Best pack to read snapshot data from for a location: the newest pack
 * covering it that holds that kind of data; otherwise null.
 */
export function pickPackForLocation(list, lat, lon, kind) {
  const hits = packsCoveringLocation(list, lat, lon);
  if (!kind) return hits[0] || null;
  return hits.find((m) => m.data && m.data[kind] && isNum(m.data[kind].fetchedAt)) || null;
}

/**
 * True when another pack of the same tile source also covers this tile,
 * i.e. deleting `pack` must leave the cached tile in place.
 */
export function tileSharedWithOtherPacks(tile, pack, list) {
  return (list || []).some(
    (m) =>
      m.id !== pack.id &&
      m.urlTemplate === pack.urlTemplate &&
      tile.z >= m.minZoom &&
      tile.z <= m.maxZoom &&
      tileInBbox(m.bbox, tile),
  );
}

/**
 * Pre-flight check for a new download.
 *   estimateBytes  - the new pack's estimated size
 *   packsBytes     - what existing packs already use (totalPackBytes)
 *   budgetBytes    - the operator's pack budget
 *   usage, quota   - navigator.storage.estimate() for the whole origin (optional)
 *   tileCount, maxTiles - per-pack tile cap
 * Returns { level: 'ok' | 'warn' | 'block', reasons: [codes] }.
 * Codes: 'empty', 'too-many-tiles', 'over-budget', 'quota-full', 'quota-near'.
 */
export function checkBudget({ estimateBytes, packsBytes = 0, budgetBytes, usage, quota, tileCount, maxTiles }) {
  const reasons = [];
  let level = 'ok';
  const block = (r) => {
    reasons.push(r);
    level = 'block';
  };
  if (isNum(tileCount) && tileCount <= 0) block('empty');
  if (isNum(tileCount) && isNum(maxTiles) && tileCount > maxTiles) block('too-many-tiles');
  if (isNum(budgetBytes) && packsBytes + (estimateBytes || 0) > budgetBytes) block('over-budget');
  if (isNum(quota) && quota > 0 && isNum(usage)) {
    const after = (usage + (estimateBytes || 0)) / quota;
    if (after >= QUOTA_BLOCK_RATIO) block('quota-full');
    else if (after >= QUOTA_WARN_RATIO) {
      reasons.push('quota-near');
      if (level === 'ok') level = 'warn';
    }
  }
  return { level, reasons };
}

/**
 * Which copy of a panel's data to show when the live request failed:
 * the service worker's last cached API response (stale) or the pack
 * snapshot — whichever is newer. Each candidate is { data, fetchedAt } or
 * null; returns the chosen candidate tagged with `source`, or null.
 */
export function chooseOfflineSource(stale, pack) {
  const s = stale && stale.data != null ? stale : null;
  const p = pack && pack.data != null ? pack : null;
  if (s && p) {
    return (p.fetchedAt || 0) > (s.fetchedAt || 0) ? { ...p, source: 'pack' } : { ...s, source: 'cache' };
  }
  if (s) return { ...s, source: 'cache' };
  if (p) return { ...p, source: 'pack' };
  return null;
}

/**
 * Re-centre a repeater snapshot on the operator's position: recompute
 * distance/bearing from (lat, lon), keep those within radiusKm, nearest
 * first. The snapshot may have been taken around a different centre.
 */
export function relocateRepeaters(repeaters, lat, lon, radiusKm) {
  if (!Array.isArray(repeaters) || !isNum(lat) || !isNum(lon)) return [];
  const out = [];
  for (const r of repeaters) {
    if (!r || !isNum(r.lat) || !isNum(r.lon)) continue;
    const km = calculateDistance(lat, lon, r.lat, r.lon);
    if (isNum(radiusKm) && km > radiusKm) continue;
    out.push({ ...r, km: Math.round(km * 10) / 10, bearing: calculateBearing(lat, lon, r.lat, r.lon) });
  }
  return out.sort((a, b) => a.km - b.km);
}

/** "as of" label: "14:32Z" today, "Oct 14 14:32Z" otherwise (UTC). */
export function formatAsOf(ts, now = Date.now()) {
  if (!isNum(ts)) return '';
  const d = new Date(ts);
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
  const n = new Date(now);
  const sameDay =
    d.getUTCFullYear() === n.getUTCFullYear() &&
    d.getUTCMonth() === n.getUTCMonth() &&
    d.getUTCDate() === n.getUTCDate();
  if (sameDay) return hhmm;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()} ${hhmm}`;
}

/**
 * Which storage caveats to show for this browser, as codes:
 *   'webkit-7day'  - Safari / any iOS browser in a tab: WebKit deletes all
 *                    script-written storage (offline areas included) for a
 *                    site not visited in 7 days of browser use
 *   'not-persistent' - the browser did not grant persistent storage, so it
 *                    may clear areas under storage pressure
 * `ua`/`vendor` are navigator.userAgent / navigator.vendor; `standalone`
 * is true when running as an installed (Home Screen / Dock) web app,
 * which WebKit exempts from the 7-day rule.
 */
export function storageNotes({ ua = '', vendor = '', standalone = false, persisted = null } = {}) {
  const notes = [];
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));
  const safari = /Apple/.test(vendor) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg\//.test(ua);
  if ((iOS || safari) && !standalone) notes.push('webkit-7day');
  if (persisted === false) notes.push('not-persistent');
  return notes;
}
