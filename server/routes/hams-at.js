'use strict';

/**
 * hams.at satellite pass alerts proxy.
 *
 * GET /api/hams-at/alerts/upcoming
 *   Optional header `X-HamsAt-Key: <personal API key>` — forwarded upstream
 *   as `Authorization: Bearer`, so hams.at can rank the alerts against the
 *   caller's own station. hams.at sends no CORS headers, hence the proxy.
 *
 * The key is never stored: responses are cached under a SHA-256 of the key,
 * for 5 minutes, at most 100 keys (oldest evicted). Requests without a key
 * share one anonymous cache entry. Self-hosted installs proxy keyed requests
 * by default; set HAMS_AT_KEYED_PROXY=false on a multi-user deployment to
 * serve only the anonymous feed.
 *
 * Response: { alerts: [...raw hams.at records...], fetchedAt, keyed }
 */

const crypto = require('crypto');

const UPSTREAM = 'https://hams.at/api/alerts/upcoming';
const CACHE_TTL = 5 * 60 * 1000;
const MAX_KEYS = 100;
const MAX_ALERTS = 200;
const KEY_RE = /^[A-Za-z0-9_\-.:]{8,160}$/;

/** Bounded per-key cache with in-flight de-duplication (exported for tests). */
function createAlertCache({ ttlMs = CACHE_TTL, maxKeys = MAX_KEYS, now = Date.now } = {}) {
  const entries = new Map(); // keyHash → { data, fetchedAt, inflight }

  const touch = (hash) => {
    const e = entries.get(hash);
    if (!e) return;
    entries.delete(hash);
    entries.set(hash, e); // Map keeps insertion order → LRU at the front
  };

  const evict = () => {
    while (entries.size > maxKeys) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  };

  async function get(hash, fetchFn) {
    const existing = entries.get(hash);
    const t = now();
    if (existing?.data && t - existing.fetchedAt < ttlMs) {
      touch(hash);
      return { data: existing.data, fetchedAt: existing.fetchedAt, stale: false };
    }
    if (existing?.inflight) return existing.inflight;

    const entry = existing || { data: null, fetchedAt: 0, inflight: null };
    entry.inflight = (async () => {
      try {
        const data = await fetchFn();
        entry.data = data;
        entry.fetchedAt = now();
        return { data, fetchedAt: entry.fetchedAt, stale: false };
      } catch (err) {
        if (entry.data) return { data: entry.data, fetchedAt: entry.fetchedAt, stale: true }; // stale-while-error
        entries.delete(hash);
        throw err;
      } finally {
        entry.inflight = null;
      }
    })();
    entries.set(hash, entry);
    touch(hash);
    evict();
    return entry.inflight;
  }

  return { get, size: () => entries.size, _entries: entries };
}

const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;
  const keyedProxyEnabled = String(process.env.HAMS_AT_KEYED_PROXY ?? 'true').toLowerCase() !== 'false';
  const cache = createAlertCache();

  async function fetchUpstream(apiKey) {
    const headers = { 'User-Agent': `OpenHamClock/${APP_VERSION}`, Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(UPSTREAM, { headers, signal: AbortSignal.timeout(12000) });
    if (res.status === 401 || res.status === 403) {
      const err = new Error('hams.at rejected the API key');
      err.status = 401;
      throw err;
    }
    if (!res.ok) throw new Error(`hams.at responded ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    return rows.slice(0, MAX_ALERTS);
  }

  app.get('/api/hams-at/alerts/upcoming', async (req, res) => {
    const rawKey = String(req.get('x-hamsat-key') || '').trim();
    const keyed = rawKey.length > 0;

    if (keyed && !keyedProxyEnabled) {
      return res.status(403).json({ error: 'Keyed hams.at proxying is disabled on this server', keyed: true });
    }
    if (keyed && !KEY_RE.test(rawKey)) {
      return res.status(400).json({ error: 'Invalid hams.at API key format' });
    }

    const hash = keyed ? hashKey(rawKey) : 'anonymous';
    res.setHeader('Cache-Control', keyed ? 'private, no-store' : 'public, max-age=60');

    try {
      const { data, fetchedAt, stale } = await cache.get(hash, () => fetchUpstream(keyed ? rawKey : null));
      res.json({ alerts: data, fetchedAt, keyed, stale: !!stale });
    } catch (err) {
      if (err.status === 401) {
        return res.status(401).json({ error: 'hams.at rejected the API key', keyed: true });
      }
      logErrorOnce?.('hams-at', `[hams.at] ${err.message}`);
      logDebug?.(`[hams.at] fetch failed: ${err.message}`);
      res.status(502).json({ error: 'hams.at unavailable' });
    }
  });
};

module.exports.createAlertCache = createAlertCache;
module.exports.hashKey = hashKey;
module.exports.KEY_RE = KEY_RE;
