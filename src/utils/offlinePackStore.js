/**
 * Offline area packs — storage and download engine (browser side).
 *
 * Everything lives in one Cache Storage cache, OFFLINE_PACK_CACHE
 * ('ohc-offline-packs', defined in public/sw-policy.js and kept across
 * deploys and the ?nosw sweep):
 *   - tile responses, keyed by the exact URL Leaflet requests, so the
 *     service worker can answer the map's own requests from the pack
 *   - the manifest list at MANIFEST_URL
 *   - per-pack EmComm data snapshots at dataUrl(packId, kind)
 *
 * The download runs in the page (not the worker) through a module-level
 * manager, so it keeps going when Settings closes and every view of the
 * control (Settings, EmComm rail) shows the same progress. It is polite on
 * purpose: a few requests at a time with a pause between them, tiles a
 * previous pack already holds are not fetched again, and a server that
 * starts refusing (429/503) gets a long pause, then the download stops.
 * Browsers do not let pages set User-Agent, so pacing is the courtesy we
 * can offer.
 *
 * Pure math and manifest logic are in offlineTiles.js and
 * offlinePackManifest.js; this file is the thin I/O layer around them.
 */
import { OFFLINE_PACK_CACHE, tileUrlPrefixes } from './swPolicy.js';
import { resolveUsState } from './usState.js';
import { enumerateTiles, countTiles, buildTileUrl } from './offlineTiles.js';
import {
  createPackManifest,
  parseManifestList,
  upsertPack,
  removePackById,
  pickPackForLocation,
  chooseOfflineSource,
  tileSharedWithOtherPacks,
  newPackId,
  SNAPSHOT_KINDS,
  SNAPSHOT_REPEATER_RADIUS_KM,
  DEFAULT_BUDGET_MB,
  BUDGET_OPTIONS_MB,
} from './offlinePackManifest.js';

export const MANIFEST_URL = '/__ohc-offline-packs/manifest.json';
export const dataUrl = (packId, kind) => `/__ohc-offline-packs/${encodeURIComponent(packId)}/${kind}.json`;

/** Fired on window whenever the pack list changes (download, delete). */
export const PACKS_CHANGED_EVENT = 'ohc:offline-packs-changed';

const BUDGET_KEY = 'openhamclock_offlinePackBudgetMB';

export const DOWNLOAD_CONCURRENCY = 3;
export const DOWNLOAD_DELAY_MS = 120;
const BACKOFF_MS = 10000;
const CHECKPOINT_EVERY = 100;
const MAX_CONSECUTIVE_FAILURES = 25;

/** Cache API needs a secure context (https or localhost). */
export function offlinePacksSupported() {
  return typeof window !== 'undefined' && !!window.isSecureContext && typeof caches !== 'undefined';
}

/** True when a service worker controls the page, i.e. packs will be served. */
export function packServingActive() {
  return typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
}

export function getBudgetMB() {
  try {
    const v = Number(localStorage.getItem(BUDGET_KEY));
    return BUDGET_OPTIONS_MB.includes(v) ? v : DEFAULT_BUDGET_MB;
  } catch {
    return DEFAULT_BUDGET_MB;
  }
}

export function setBudgetMB(mb) {
  try {
    localStorage.setItem(BUDGET_KEY, String(mb));
  } catch {
    /* storage unavailable — default budget applies */
  }
}

const openCache = (cachesImpl = globalThis.caches) => cachesImpl.open(OFFLINE_PACK_CACHE);

const jsonResponse = (obj) => new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } });

function announceChange() {
  try {
    window.dispatchEvent(new CustomEvent(PACKS_CHANGED_EVENT));
  } catch {
    /* non-browser */
  }
  // The worker re-reads pack manifests (over-zoom) and tile-source routing.
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'OHC_PACKS_CHANGED' });
  } catch {
    /* no worker */
  }
}

/** True for the storage-full errors the Cache API throws in each engine. */
export function isQuotaError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  return (
    name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(String(err.message || ''))
  );
}

export const SOURCES_URL = '/__ohc-offline-packs/sources.json';

/**
 * Tell the service worker which operator-supplied tile source to route
 * through the pack cache (stored in the cache so it survives worker
 * restarts). Pass the source's URL template (and subdomains, for {s}), or
 * null to clear.
 */
export async function registerTileSource(template, { cachesImpl, subdomains } = {}) {
  if (!cachesImpl && !offlinePacksSupported()) return;
  try {
    const cache = await openCache(cachesImpl);
    await cache.put(SOURCES_URL, jsonResponse({ prefixes: template ? tileUrlPrefixes(template, subdomains) : [] }));
  } catch {
    /* best-effort */
  }
  announceChange();
}

export async function listPacks({ cachesImpl } = {}) {
  if (!cachesImpl && !offlinePacksSupported()) return [];
  try {
    const cache = await openCache(cachesImpl);
    const res = await cache.match(MANIFEST_URL);
    if (!res) return [];
    return parseManifestList(await res.text());
  } catch {
    return [];
  }
}

async function savePacks(cache, list) {
  await cache.put(MANIFEST_URL, jsonResponse({ packs: list }));
}

/** Origin storage usage/quota and whether storage is persistent. */
export async function storageStatus() {
  const out = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      out.usage = e.usage ?? null;
      out.quota = e.quota ?? null;
    }
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch {
    /* unsupported */
  }
  return out;
}

/** Ask the browser not to evict our storage under pressure (best-effort). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* unsupported */
  }
  return false;
}

// ── EmComm data snapshot ───────────────────────────────────────────────────

/** Endpoints snapshotted with a pack — the same ones the EmComm layout and
 *  Repeaters panel poll, so the URLs (and the SW API cache) line up. */
export function snapshotRequests(lat, lon, usState = null) {
  return {
    alerts: `/api/emcomm/alerts?lat=${lat}&lon=${lon}`,
    shelters: `/api/emcomm/shelters?lat=${lat}&lon=${lon}&radius=200`,
    repeaters: `/api/repeaters?lat=${lat}&lon=${lon}&radius=${SNAPSHOT_REPEATER_RADIUS_KM}&limit=200`,
    // FEMA declarations are per US state, resolved from DE while online.
    ...(usState ? { disasters: `/api/emcomm/disasters?state=${encodeURIComponent(usState)}` } : {}),
  };
}

const countOf = (kind, data) =>
  kind === 'repeaters'
    ? Array.isArray(data?.repeaters)
      ? data.repeaters.length
      : 0
    : Array.isArray(data)
      ? data.length
      : 0;

/**
 * Fetch and store the EmComm data for a pack. Returns the manifest `data`
 * summary { kind: { fetchedAt, count } } for the kinds that succeeded.
 * A response the service worker served from its cache (X-OHC-Stale) keeps
 * its original Date as fetchedAt rather than pretending to be fresh.
 */
export async function snapshotPackData(packId, center, { fetchImpl = fetch, cachesImpl, resolveState } = {}) {
  const summary = {};
  if (!center) return summary;
  const cache = await openCache(cachesImpl);
  const lookup = resolveState || ((la, lo) => resolveUsState(la, lo, fetchImpl));
  const usState = await lookup(center.lat, center.lon);
  const reqs = snapshotRequests(center.lat, center.lon, usState);
  for (const [kind, url] of Object.entries(reqs)) {
    try {
      const res = await fetchImpl(url, { cache: 'no-store' });
      if (!res?.ok) continue;
      const data = await res.json();
      let fetchedAt = Date.now();
      if (res.headers?.get?.('x-ohc-stale')) {
        const d = Date.parse(res.headers.get('date') || '');
        if (Number.isFinite(d)) fetchedAt = d;
      }
      await cache.put(dataUrl(packId, kind), jsonResponse({ fetchedAt, center, data, usState }));
      summary[kind] = { fetchedAt, count: countOf(kind, data), ...(kind === 'disasters' ? { state: usState } : {}) };
    } catch (err) {
      if (isQuotaError(err)) break; // storage full: keep what we have
      /* this kind stays without a snapshot */
    }
  }
  return summary;
}

/** Re-take a pack's data snapshot (button in the pack list). */
export async function refreshPackData(packId) {
  const cache = await openCache();
  const list = await listPacks();
  const pack = list.find((m) => m.id === packId);
  if (!pack) return null;
  const data = await snapshotPackData(packId, pack.dataCenter || pack.center);
  const updated = { ...pack, data: { ...pack.data, ...data } };
  await savePacks(cache, upsertPack(list, updated));
  announceChange();
  return updated;
}

/**
 * Last-known data of one kind for a location from the newest covering pack:
 * { data, fetchedAt, center, packName } or null.
 */
export async function loadPackSnapshot(lat, lon, kind) {
  if (!offlinePacksSupported() || lat == null || lon == null) return null;
  try {
    const list = await listPacks();
    const pack = pickPackForLocation(list, lat, lon, kind);
    if (!pack) return null;
    const cache = await openCache();
    const res = await cache.match(dataUrl(pack.id, kind));
    if (!res) return null;
    const body = await res.json();
    return { data: body.data, fetchedAt: body.fetchedAt, center: body.center, packName: pack.name };
  } catch {
    return null;
  }
}

/**
 * Interpret a live API response for offline display: returns
 * { ok: true, data, staleAt } where staleAt is the original Date of a
 * service-worker cached copy (null for a live answer), or { ok: false }
 * when the request failed / came back as the worker's offline 503.
 */
export async function readApiResponse(res) {
  if (!res) return { ok: false };
  if (!res.ok) return { ok: false };
  const data = await res.json();
  let staleAt = null;
  if (res.headers?.get?.('x-ohc-stale')) {
    const d = Date.parse(res.headers.get('date') || '');
    staleAt = Number.isFinite(d) ? d : 0;
  }
  return { ok: true, data, staleAt };
}

/**
 * Fetch an EmComm endpoint, falling back to last-known data when offline.
 *
 * Returns null while apiFetch is in a 429 backoff (leave state alone), or
 *   { source: 'live', data }                       — fresh from the server
 *   { source: 'cache' | 'pack', data, fetchedAt }  — last-known copy: the
 *       service worker's cached response or an offline pack snapshot,
 *       whichever is newer
 *   { source: 'none' }                             — failed, nothing stored
 */
export async function fetchWithPackFallback(fetcher, url, init, { kind, lat, lon }) {
  let stale = null;
  try {
    const res = await fetcher(url, init);
    if (res === null) return null;
    const r = await readApiResponse(res);
    if (r.ok && r.staleAt == null) return { source: 'live', data: r.data };
    if (r.ok) stale = { data: r.data, fetchedAt: r.staleAt };
  } catch {
    /* network down — fall through to the offline copies */
  }
  const pack = await loadPackSnapshot(lat, lon, kind);
  const chosen = chooseOfflineSource(stale, pack);
  return chosen || { source: 'none' };
}

// ── Delete ────────────────────────────────────────────────────────────────

/** Delete a pack: its manifest entry, its data snapshot, and every tile no
 *  other pack still needs. */
export async function deletePack(packId, { cachesImpl } = {}) {
  const cache = await openCache(cachesImpl);
  const list = await listPacks({ cachesImpl });
  const pack = list.find((m) => m.id === packId);
  if (!pack) return list;
  const remaining = removePackById(list, packId);
  // Manifest first: if the tab closes mid-delete the pack is already gone
  // from the list; orphaned tiles are harmless and swept on the next delete.
  await savePacks(cache, remaining);
  for (const kind of SNAPSHOT_KINDS) {
    await cache.delete(dataUrl(packId, kind)).catch(() => {});
  }
  for (const tile of enumerateTiles(pack.bbox, pack.minZoom, pack.maxZoom)) {
    if (tileSharedWithOtherPacks(tile, pack, remaining)) continue;
    await cache.delete(buildTileUrl(pack.urlTemplate, tile, { subdomains: pack.subdomains })).catch(() => {});
  }
  // Last pack gone: clear anything an interrupted download or delete left.
  if (remaining.length === 0) await clearAllButManifest(cache);
  announceChange();
  return remaining;
}

async function clearAllButManifest(cache) {
  try {
    const keys = await cache.keys();
    for (const req of keys) {
      if (!req.url.endsWith(MANIFEST_URL)) await cache.delete(req);
    }
  } catch {
    /* best-effort */
  }
}

// ── Download manager ──────────────────────────────────────────────────────

const IDLE = { status: 'idle', done: 0, total: 0, bytes: 0, failed: 0, skipped: 0, name: '', error: null };
let state = IDLE;
let controller = null;
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* listener errors never stop a download */
    }
  });
}

export const getDownloadState = () => state;

export function subscribeDownload(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function cancelPackDownload() {
  if (controller) controller.abort();
}

/** Clear a finished/failed/cancelled status back to idle. */
export function resetDownloadState() {
  if (state.status !== 'running') setState(IDLE);
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

const sizeOf = async (res) => {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > 0) return len;
  try {
    return (await res.blob()).size;
  } catch {
    return 0;
  }
};

/**
 * Download every tile of an area into the pack cache, then snapshot the
 * EmComm data. The manifest is written at the start (marked incomplete)
 * and checkpointed as tiles arrive, so a cancel, a full disk, a dead tile
 * server, or a closed tab leaves a resumable area rather than orphaned
 * tiles. Passing the `id` of an incomplete area resumes it: tiles already
 * in the cache are skipped. Dependencies are injectable for tests.
 *
 * @param {object} o
 *   id?, createdAt?, name, styleId, styleName, urlTemplate, subdomains,
 *   lang, retina, bbox, minZoom, maxZoom, center, radiusKm, dataCenter
 *   onProgress({ done, total, bytes, failed, skipped })
 *   signal (AbortSignal), fetchImpl, cachesImpl, concurrency, delayMs,
 *   resolveState (test hook for the US-state lookup)
 * @returns {Promise<{ manifest, status: 'done'|'cancelled'|'error', error?: 'quota'|'network' }>}
 */
export async function runPackDownload(o) {
  const {
    fetchImpl = fetch,
    cachesImpl,
    concurrency = DOWNLOAD_CONCURRENCY,
    delayMs = DOWNLOAD_DELAY_MS,
    signal,
    onProgress = () => {},
  } = o;
  const cache = await openCache(cachesImpl);
  const total = countTiles(o.bbox, o.minZoom, o.maxZoom);
  const urlOpts = { subdomains: o.subdomains, lang: o.lang, retina: o.retina };
  const iter = enumerateTiles(o.bbox, o.minZoom, o.maxZoom);
  let done = 0;
  let bytes = 0;
  let failed = 0;
  let skipped = 0;
  let consecutiveFailures = 0;
  let fatal = null;

  const base = {
    id: o.id || newPackId(),
    name: o.name,
    styleId: o.styleId,
    styleName: o.styleName,
    urlTemplate: o.urlTemplate,
    subdomains: o.subdomains,
    retina: !!o.retina,
    bbox: o.bbox,
    minZoom: o.minZoom,
    maxZoom: o.maxZoom,
    center: o.center,
    dataCenter: o.dataCenter || o.center,
    radiusKm: o.radiusKm,
    createdAt: o.createdAt,
    totalTiles: total,
  };
  const snapshot = (extra) =>
    createPackManifest({ ...base, tileCount: done - failed, failedCount: failed, bytes, ...extra });

  // Serialized manifest writes (workers checkpoint concurrently).
  let saving = Promise.resolve();
  const save = (m) => {
    saving = saving.then(async () => {
      try {
        await savePacks(cache, upsertPack(await listPacks({ cachesImpl }), m));
      } catch (err) {
        if (isQuotaError(err)) fatal = fatal || 'quota';
      }
    });
    return saving;
  };

  const report = () => onProgress({ done, total, bytes, failed, skipped, packId: base.id });

  const fetchTile = async (url) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchImpl(url, { mode: 'cors', credentials: 'omit', signal });
      if (res.ok && String(res.headers.get('content-type') || '').startsWith('image/')) return res;
      if (res.status === 429 || res.status === 503) {
        await sleep(BACKOFF_MS, signal);
        continue;
      }
      return null; // 404 / non-image: nothing to cache at this tile
    }
    return null;
  };

  const worker = async () => {
    for (;;) {
      if (signal?.aborted || fatal) return;
      const next = iter.next();
      if (next.done) return;
      const url = buildTileUrl(o.urlTemplate, next.value, urlOpts);
      try {
        const have = await cache.match(url);
        if (have) {
          // Read first, then add: `bytes += await …` would read `bytes`
          // before the await and lose other workers' increments.
          const size = await sizeOf(have);
          bytes += size;
          skipped++;
        } else {
          const res = await fetchTile(url);
          if (res) {
            await cache.put(url, res.clone());
            const size = await sizeOf(res);
            bytes += size;
            consecutiveFailures = 0;
          } else {
            failed++;
          }
          await sleep(delayMs, signal);
        }
      } catch (err) {
        if (signal?.aborted) return;
        if (isQuotaError(err)) {
          fatal = 'quota';
          return;
        }
        failed++;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          fatal = 'network';
          return;
        }
        await sleep(delayMs * 4, signal);
      }
      done++;
      if (done % CHECKPOINT_EVERY === 0) save(snapshot({ complete: false }));
      report();
    }
  };

  // A resumed area keeps its earlier data snapshot until a new one is taken.
  const prior = o.id ? (await listPacks({ cachesImpl })).find((m) => m.id === o.id) : null;
  if (prior?.data) base.data = prior.data;
  await save(snapshot({ complete: false }));
  if (!fatal) {
    report();
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  }
  await saving;

  if (signal?.aborted || fatal) {
    const manifest = snapshot({ complete: false });
    await save(manifest);
    return { manifest, status: fatal ? 'error' : 'cancelled', ...(fatal ? { error: fatal } : {}) };
  }

  const data = await snapshotPackData(base.id, base.dataCenter, {
    fetchImpl,
    cachesImpl,
    resolveState: o.resolveState,
  });
  const manifest = snapshot({ complete: true, data: { ...(base.data || {}), ...data } });
  await save(manifest);
  return { manifest, status: fatal ? 'error' : 'done', ...(fatal ? { error: fatal } : {}) };
}

async function runManaged(opts) {
  if (state.status === 'running') return null;
  controller = new AbortController();
  setState({
    ...IDLE,
    status: 'running',
    name: opts.name,
    packId: opts.id || null,
    total: countTiles(opts.bbox, opts.minZoom, opts.maxZoom),
  });
  const persisted = await requestPersistence();
  try {
    const r = await runPackDownload({ ...opts, signal: controller.signal, onProgress: (p) => setState(p) });
    setState({ status: r.status, error: r.error || null, packId: r.manifest.id, persisted });
    announceChange();
    return r.manifest;
  } catch (err) {
    setState({ status: 'error', error: isQuotaError(err) ? 'quota' : 'error' });
    announceChange();
    return null;
  } finally {
    controller = null;
  }
}

/** Start a download through the shared manager (one at a time). */
export function startPackDownload(opts) {
  return runManaged(opts);
}

/** Continue an incomplete area where it stopped. */
export async function resumePackDownload(packId) {
  const pack = (await listPacks()).find((m) => m.id === packId);
  if (!pack) return null;
  return runManaged({
    id: pack.id,
    createdAt: pack.createdAt,
    name: pack.name,
    styleId: pack.styleId,
    styleName: pack.styleName,
    urlTemplate: pack.urlTemplate,
    subdomains: pack.subdomains,
    retina: pack.retina,
    bbox: pack.bbox,
    minZoom: pack.minZoom,
    maxZoom: pack.maxZoom,
    center: pack.center,
    dataCenter: pack.dataCenter,
    radiusKm: pack.radiusKm,
  });
}
