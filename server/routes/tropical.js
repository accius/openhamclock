/**
 * Tropical cyclones — active storms worldwide for the Tropical panel and the
 * tropical-cyclones map layer.
 *
 * Sources
 *   NHC  https://www.nhc.noaa.gov/CurrentStorms.json  (Atlantic / E+C Pacific)
 *        + per-storm forecast TRACK and CONE KMZ (parsed with server/utils/kmz)
 *   JTWC https://www.metoc.navy.mil/jtwc/rss/jtwc.rss (W Pacific, Indian
 *        Ocean, southern hemisphere) + per-storm warning text and KMZ.
 *
 * GET /api/tropical/storms → { storms: [...], fetchedAt, sources: { nhc, jtwc }, stale? }
 *
 * One cache for every user: 10 min TTL, shared in-flight promise, stale data
 * served when both upstreams fail. Per-storm GIS products that fail degrade
 * to "current position only" instead of dropping the storm.
 */
const { extractKml } = require('../utils/kmz');
const { parseNhcTrack, parseNhcCone, parseJtwcKml } = require('../utils/tropicalKml');
const { parseJtwcRss, parseJtwcWarningText } = require('../utils/jtwcWarning');
const { normalizeNhcStorm, normalizeJtwcStorm, dedupeStorms } = require('../utils/tropicalStorms');

const NHC_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const JTWC_RSS_URL = 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss';
const JTWC_HOST = 'https://www.metoc.navy.mil/';
const NHC_HOST = 'https://www.nhc.noaa.gov/';

const CACHE_TTL = 10 * 60 * 1000;
const MAX_STORMS_PER_SOURCE = 20;
const FETCH_TIMEOUT = 15000;
const MAX_KMZ_BYTES = 2 * 1024 * 1024;
const MAX_CONE_POINTS = 400;

/** Thin a ring to at most `max` points (keeps first and last). */
function thinRing(ring, max = MAX_CONE_POINTS) {
  if (!Array.isArray(ring) || ring.length <= max) return ring || [];
  const step = ring.length / max;
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[Math.floor(i)]);
  if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
  return out;
}

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;
  const headers = { 'User-Agent': `OpenHamClock/${APP_VERSION || '1.0'} (https://openhamclock.com)` };

  let cache = { data: null, timestamp: 0 };

  async function fetchText(url) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    return res.text();
  }

  async function fetchKml(url) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_KMZ_BYTES) throw new Error(`${url} too large (${buf.length} bytes)`);
    return extractKml(buf);
  }

  // Only follow links back to the host that published them
  const sameHost = (url, host) => typeof url === 'string' && url.startsWith(host);

  async function loadNhc() {
    const json = JSON.parse(await fetchText(NHC_URL));
    const active = Array.isArray(json.activeStorms) ? json.activeStorms.slice(0, MAX_STORMS_PER_SOURCE) : [];
    return Promise.all(
      active.map(async (storm) => {
        const trackUrl = storm.forecastTrack?.kmzFile;
        const coneUrl = storm.trackCone?.kmzFile;
        const [track, cone] = await Promise.allSettled([
          sameHost(trackUrl, NHC_HOST) ? fetchKml(trackUrl).then(parseNhcTrack) : Promise.reject(new Error('no track')),
          sameHost(coneUrl, NHC_HOST) ? fetchKml(coneUrl).then(parseNhcCone) : Promise.reject(new Error('no cone')),
        ]);
        if (track.status === 'rejected')
          logDebug('[Tropical] NHC track unavailable for', storm.id, track.reason?.message);
        if (cone.status === 'rejected') logDebug('[Tropical] NHC cone unavailable for', storm.id, cone.reason?.message);
        return normalizeNhcStorm(
          storm,
          track.status === 'fulfilled' ? track.value : null,
          cone.status === 'fulfilled' ? thinRing(cone.value) : null,
        );
      }),
    );
  }

  async function loadJtwc() {
    const entries = parseJtwcRss(await fetchText(JTWC_RSS_URL)).slice(0, MAX_STORMS_PER_SOURCE);
    return Promise.all(
      entries.map(async (entry) => {
        const [warning, kml] = await Promise.allSettled([
          sameHost(entry.textUrl, JTWC_HOST)
            ? fetchText(entry.textUrl).then(parseJtwcWarningText)
            : Promise.reject(new Error('no text')),
          sameHost(entry.kmzUrl, JTWC_HOST)
            ? fetchKml(entry.kmzUrl).then(parseJtwcKml)
            : Promise.reject(new Error('no kmz')),
        ]);
        if (warning.status === 'rejected')
          logDebug('[Tropical] JTWC text unavailable for', entry.id, warning.reason?.message);
        if (kml.status === 'rejected') logDebug('[Tropical] JTWC kmz unavailable for', entry.id, kml.reason?.message);
        const storm = normalizeJtwcStorm(
          entry,
          warning.status === 'fulfilled' ? warning.value : null,
          kml.status === 'fulfilled' ? kml.value : null,
        );
        storm.cone = thinRing(storm.cone);
        return storm;
      }),
    );
  }

  async function refresh() {
    const [nhc, jtwc] = await Promise.allSettled([loadNhc(), loadJtwc()]);
    if (nhc.status === 'rejected' && jtwc.status === 'rejected') {
      throw new Error(`NHC: ${nhc.reason?.message}; JTWC: ${jtwc.reason?.message}`);
    }
    if (nhc.status === 'rejected') logErrorOnce('Tropical-NHC', nhc.reason?.message);
    if (jtwc.status === 'rejected') logErrorOnce('Tropical-JTWC', jtwc.reason?.message);
    const storms = dedupeStorms(
      nhc.status === 'fulfilled' ? nhc.value : [],
      jtwc.status === 'fulfilled' ? jtwc.value : [],
    ).filter((s) => s.lat != null && s.lon != null);
    return {
      storms,
      fetchedAt: new Date().toISOString(),
      sources: {
        nhc: nhc.status === 'fulfilled' ? 'ok' : 'error',
        jtwc: jtwc.status === 'fulfilled' ? 'ok' : 'error',
      },
    };
  }

  app.get('/api/tropical/storms', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) return res.json(cache.data);
      const data = await ctx.upstream.fetch('tropical:storms', refresh);
      cache = { data, timestamp: Date.now() };
      logDebug('[Tropical]', data.storms.length, 'active storms');
      res.json(data);
    } catch (error) {
      logErrorOnce('Tropical', error.message);
      if (cache.data) return res.json({ ...cache.data, stale: true });
      res.status(502).json({ error: 'Failed to fetch tropical cyclone data' });
    }
  });
};

module.exports.thinRing = thinRing;
