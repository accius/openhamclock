/**
 * Fire weather — NWS Red Flag Warnings and Fire Weather Watches for the
 * Fire Weather panel and the fire-weather-alerts map layer.
 *
 * GET /api/fire-weather/alerts → { alerts: [...], fetchedAt, zonesPending, stale? }
 *
 * Fire weather alerts are zone-based: api.weather.gov returns them with
 * `geometry: null` and a list of affectedZones URLs. The route resolves each
 * fire zone's polygon once (zones change rarely: 7-day TTL, bounded map),
 * simplifies it, and attaches a merged MultiPolygon + centroid to the alert
 * so the client can draw it and compute distance from DE itself. One cache
 * serves every user (5 min TTL); alerts whose zones are not resolved yet are
 * still listed and pick up geometry on the next refresh.
 */
const { simplifyGeometry, mergePolygons, centroid } = require('../utils/geojsonSimplify');

const ALERTS_URL = 'https://api.weather.gov/alerts/active?event=Red%20Flag%20Warning,Fire%20Weather%20Watch';
const ZONE_URL_RE = /^https:\/\/api\.weather\.gov\/zones\/(fire|county|public|forecast)\/([A-Z]{2}[CZ]\d{3})$/;

const CACHE_TTL = 5 * 60 * 1000;
const ZONE_TTL = 7 * 24 * 60 * 60 * 1000;
const ZONE_CACHE_MAX = 600;
const ZONE_FETCH_PER_REFRESH = 60;
const ZONE_CONCURRENCY = 6;
const SIMPLIFY_TOLERANCE_DEG = 0.02;
const MAX_ALERTS = 200;
const DESCRIPTION_MAX = 800;

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;
  const headers = {
    'User-Agent': `OpenHamClock/${APP_VERSION || '1.0'} (https://openhamclock.com)`,
    Accept: 'application/geo+json',
  };

  let cache = { data: null, timestamp: 0 };
  /** zoneId → { geometry, centroid, name, state, timestamp } (geometry may be null when the zone has none) */
  const zoneCache = new Map();

  function pruneZones() {
    const now = Date.now();
    for (const [k, v] of zoneCache) if (now - v.timestamp > ZONE_TTL) zoneCache.delete(k);
    while (zoneCache.size > ZONE_CACHE_MAX) zoneCache.delete(zoneCache.keys().next().value);
  }

  async function fetchZone(url) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`zone ${url} responded ${res.status}`);
    const json = await res.json();
    const geometry = json.geometry ? simplifyGeometry(json.geometry, SIMPLIFY_TOLERANCE_DEG) : null;
    return {
      geometry,
      centroid: centroid(geometry),
      name: json.properties?.name || null,
      state: json.properties?.state || null,
      timestamp: Date.now(),
    };
  }

  /** Resolve up to ZONE_FETCH_PER_REFRESH unknown zones, a few at a time. */
  async function resolveZones(urls) {
    const todo = [...new Set(urls)]
      .filter((u) => ZONE_URL_RE.test(u) && !zoneCache.has(u))
      .slice(0, ZONE_FETCH_PER_REFRESH);
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const url = todo[i++];
        try {
          zoneCache.set(url, await fetchZone(url));
        } catch (err) {
          logDebug('[FireWx] zone fetch failed:', err.message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ZONE_CONCURRENCY, todo.length) }, worker));
    pruneZones();
    return urls.filter((u) => ZONE_URL_RE.test(u) && !zoneCache.has(u)).length;
  }

  // Keep resolving zones in the background after a refresh that left some
  // pending, then expire the alert cache so the next request re-attaches
  // geometry — a big watch (60+ zones) is complete within a minute or two
  // instead of waiting several 5-minute refreshes.
  let warming = false;
  async function warmZones(urls) {
    if (warming) return;
    warming = true;
    try {
      for (let round = 0; round < 6; round++) {
        const pending = await resolveZones(urls);
        if (pending <= 0) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      cache.timestamp = 0;
    } catch (err) {
      logDebug('[FireWx] zone warm-up failed:', err.message);
    } finally {
      warming = false;
    }
  }

  async function refresh() {
    const res = await fetch(ALERTS_URL, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`NWS alerts responded ${res.status}`);
    const json = await res.json();
    const features = (json.features || []).slice(0, MAX_ALERTS);
    const zoneUrls = features.flatMap((f) => f.properties?.affectedZones || []);
    const pending = await resolveZones(zoneUrls);
    if (pending > 0) warmZones(zoneUrls);

    const alerts = features.map((f) => {
      const p = f.properties || {};
      const zones = (p.affectedZones || []).filter((u) => ZONE_URL_RE.test(u));
      const resolved = zones.map((u) => zoneCache.get(u)).filter(Boolean);
      const geometry = f.geometry
        ? simplifyGeometry(f.geometry, SIMPLIFY_TOLERANCE_DEG)
        : mergePolygons(resolved.map((z) => z.geometry));
      return {
        id: p.id || f.id,
        event: p.event,
        severity: p.severity,
        urgency: p.urgency,
        certainty: p.certainty,
        headline: p.headline,
        areaDesc: p.areaDesc,
        senderName: p.senderName,
        onset: p.onset,
        ends: p.ends || p.expires,
        expires: p.expires,
        web: p.web || null,
        description: typeof p.description === 'string' ? p.description.slice(0, DESCRIPTION_MAX) : null,
        zones: zones.map((u) => u.split('/').pop()),
        zoneNames: resolved.map((z) => z.name).filter(Boolean),
        geometry,
        centroid: centroid(geometry),
      };
    });

    return { alerts, fetchedAt: new Date().toISOString(), zonesPending: pending };
  }

  app.get('/api/fire-weather/alerts', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) return res.json(cache.data);
      const data = await ctx.upstream.fetch('fire-weather:alerts', refresh);
      cache = { data, timestamp: Date.now() };
      logDebug('[FireWx]', data.alerts.length, 'alerts,', data.zonesPending, 'zones pending');
      res.json(data);
    } catch (error) {
      logErrorOnce('FireWeather', error.message);
      if (cache.data) return res.json({ ...cache.data, stale: true });
      res.status(502).json({ error: 'Failed to fetch fire weather alerts' });
    }
  });
};
