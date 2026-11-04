/**
 * Space-weather activity summary for the "Auto space-weather layer" feature
 * (Settings → Map Layers). One tiny JSON instead of every client pulling the
 * 1 MB OVATION grid and the D-RAP table just to compare two numbers.
 *
 * GET /api/swpc/activity → {
 *   aurora: { max, lat, lon, forecastTime } | null,
 *   drap:   { maxFreq, validAt } | null,
 *   fetchedAt
 * }
 * 5-minute cache (matches /api/noaa/aurora and /api/drap), stale-on-error.
 * Either half degrades to null if its feed is down.
 */

const { auroraPeak, drapMaxFreq } = require('../utils/spaceWxActivity');

const AURORA_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const DRAP_URL = 'https://services.swpc.noaa.gov/text/drap_global_frequencies.txt';
const CACHE_TTL = 5 * 60 * 1000;

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  let cache = { data: null, timestamp: 0 };
  const headers = { 'User-Agent': `OpenHamClock/${APP_VERSION}` };

  async function loadAurora() {
    const res = await fetch(AURORA_URL, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`ovation responded ${res.status}`);
    const json = await res.json();
    const peak = auroraPeak(json?.coordinates);
    return { ...peak, forecastTime: json?.['Forecast Time'] || null };
  }

  async function loadDrap() {
    const res = await fetch(DRAP_URL, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`drap responded ${res.status}`);
    return drapMaxFreq(await res.text());
  }

  async function load() {
    const [aurora, drap] = await Promise.allSettled([loadAurora(), loadDrap()]);
    if (aurora.status === 'rejected' && drap.status === 'rejected') {
      throw new Error(`aurora: ${aurora.reason?.message}; drap: ${drap.reason?.message}`);
    }
    return {
      aurora: aurora.status === 'fulfilled' ? aurora.value : null,
      drap: drap.status === 'fulfilled' ? drap.value : null,
      fetchedAt: new Date().toISOString(),
    };
  }

  app.get('/api/swpc/activity', async (req, res) => {
    try {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) {
        return res.json(cache.data);
      }
      const data = await ctx.upstream.fetch('swpc:activity', load);
      cache = { data, timestamp: Date.now() };
      logDebug('[SpaceWx activity] aurora max', data.aurora?.max, '% · D-RAP max', data.drap?.maxFreq, 'MHz');
      res.json(data);
    } catch (error) {
      logErrorOnce('SpaceWx activity', error.message);
      if (cache.data) return res.json({ ...cache.data, stale: true });
      res.status(502).json({ error: 'Failed to fetch space weather activity' });
    }
  });
};
