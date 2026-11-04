/**
 * HAB / pico-balloon tracking — SondeHub Amateur proxy.
 *
 *   GET /api/balloons            → { balloons, count, fetchedAt }   (6 h of telemetry, ≤ 500 payloads)
 *   GET /api/balloons/listeners  → { listeners, count, fetchedAt }  (receiving stations, 6 h)
 *
 * The amateur telemetry feed is ~0.75 MB per six hours; it is cached
 * server-side for 2 minutes (listeners 5 min), slimmed to the latest fix
 * plus a decimated trail per balloon (utils/balloons.js), and served stale
 * for up to 15 minutes if SondeHub is unreachable. One upstream pull per
 * cache window regardless of how many browsers are watching.
 */

const { slimBalloons, slimListeners, MAX_BALLOONS } = require('../utils/balloons');

const TELEMETRY_URL = 'https://api.v2.sondehub.org/amateur/telemetry?duration=6h';
const LISTENERS_URL = 'https://api.v2.sondehub.org/amateur/listeners/telemetry?duration=6h';
const TELEMETRY_TTL = 2 * 60 * 1000;
const LISTENERS_TTL = 5 * 60 * 1000;
const STALE_TTL = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25000;

module.exports = function (app, ctx) {
  const { fetch, upstream, logDebug, logErrorOnce, APP_VERSION } = ctx;

  const headers = {
    'User-Agent': `OpenHamClock/${APP_VERSION || '1.0'} (+https://openhamclock.com)`,
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };

  let telemetryCache = { data: null, timestamp: 0 };
  let listenersCache = { data: null, timestamp: 0 };

  async function fetchJson(url, service) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      upstream.recordFailure(service, res.status);
      throw new Error(`SondeHub responded ${res.status}`);
    }
    const body = await res.json();
    upstream.recordSuccess(service);
    return body;
  }

  async function cachedFetch({ cache, setCache, ttl, key, url, slim, service }) {
    const now = Date.now();
    if (cache.data && now - cache.timestamp < ttl) return cache.data;
    if (upstream.isBackedOff(service) && cache.data) return { ...cache.data, stale: true };
    try {
      const data = await upstream.fetch(key, async () => {
        const raw = await fetchJson(url, service);
        return slim(raw);
      });
      setCache({ data, timestamp: Date.now() });
      return data;
    } catch (err) {
      if (cache.data && Date.now() - cache.timestamp < STALE_TTL) {
        logDebug(`[Balloons] serving stale ${key}: ${err.message}`);
        return { ...cache.data, stale: true };
      }
      throw err;
    }
  }

  app.get('/api/balloons', async (req, res) => {
    try {
      const data = await cachedFetch({
        cache: telemetryCache,
        setCache: (c) => (telemetryCache = c),
        ttl: TELEMETRY_TTL,
        key: 'sondehub:amateur',
        url: TELEMETRY_URL,
        service: 'sondehub',
        slim: (raw) => {
          const balloons = slimBalloons(raw, { maxBalloons: MAX_BALLOONS });
          logDebug(`[Balloons] ${balloons.length} amateur payloads (6 h)`);
          return { balloons, count: balloons.length, fetchedAt: new Date().toISOString() };
        },
      });
      res.set('Cache-Control', 'public, max-age=60');
      res.json(data);
    } catch (err) {
      logErrorOnce('Balloons', err.message);
      res.status(502).json({ error: 'SondeHub unavailable', balloons: [], count: 0 });
    }
  });

  app.get('/api/balloons/listeners', async (req, res) => {
    try {
      const data = await cachedFetch({
        cache: listenersCache,
        setCache: (c) => (listenersCache = c),
        ttl: LISTENERS_TTL,
        key: 'sondehub:amateur-listeners',
        url: LISTENERS_URL,
        service: 'sondehub',
        slim: (raw) => {
          const listeners = slimListeners(raw);
          return { listeners, count: listeners.length, fetchedAt: new Date().toISOString() };
        },
      });
      res.set('Cache-Control', 'public, max-age=120');
      res.json(data);
    } catch (err) {
      logErrorOnce('Balloon listeners', err.message);
      res.status(502).json({ error: 'SondeHub unavailable', listeners: [], count: 0 });
    }
  });
};
