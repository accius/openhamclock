/**
 * NDBC buoys — latest marine observations for the Marine panel and the
 * ndbc-buoys map layer.
 *
 * GET /api/ndbc/latest?lat=&lon=&limit=25 → nearest stations to a point
 * GET /api/ndbc/latest?all=1             → every reporting station (map layer)
 *   → { stations: [{ id, name, lat, lon, time, wdir, wspd, gst, wvht, dpd,
 *        apd, mwd, pres, ptdy, atmp, wtmp, dewp, km?, bearing? }],
 *        total, fetchedAt, stale? }
 *
 * Upstream: https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt (one
 * fetch per 15 min for everyone; nearest-N is computed from the cached
 * list) and station_table.txt for names (24 h).
 */
const { parseLatestObs, parseStationTable, nearestStations } = require('../utils/ndbcLatestObs');

const OBS_URL = 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt';
const TABLE_URL = 'https://www.ndbc.noaa.gov/data/stations/station_table.txt';
const OBS_TTL = 15 * 60 * 1000;
const TABLE_TTL = 24 * 60 * 60 * 1000;
const MAX_LIMIT = 100;
const MAX_ALL = 2000;

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;
  const headers = { 'User-Agent': `OpenHamClock/${APP_VERSION || '1.0'}` };

  let obsCache = { data: null, timestamp: 0 };
  let tableCache = { data: new Map(), timestamp: 0 };

  async function fetchText(url) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${url.split('/').pop()} responded ${res.status}`);
    return res.text();
  }

  async function getTable() {
    if (tableCache.data.size && Date.now() - tableCache.timestamp < TABLE_TTL) return tableCache.data;
    try {
      const map = await ctx.upstream.fetch('ndbc:table', async () => parseStationTable(await fetchText(TABLE_URL)));
      if (map.size) tableCache = { data: map, timestamp: Date.now() };
    } catch (err) {
      logErrorOnce('NDBC-Table', err.message);
    }
    return tableCache.data;
  }

  async function getObs() {
    if (obsCache.data && Date.now() - obsCache.timestamp < OBS_TTL) return obsCache.data;
    const data = await ctx.upstream.fetch('ndbc:latest', async () => {
      const [text, table] = await Promise.all([fetchText(OBS_URL), getTable()]);
      const rows = parseLatestObs(text).slice(0, MAX_ALL);
      if (!rows.length) throw new Error('NDBC latest_obs empty');
      const stations = rows.map((r) => {
        const meta = table.get(String(r.id).toUpperCase());
        return { ...r, name: meta?.name || null, type: meta?.type || null };
      });
      return { stations, fetchedAt: new Date().toISOString() };
    });
    obsCache = { data, timestamp: Date.now() };
    logDebug('[NDBC]', data.stations.length, 'stations');
    return data;
  }

  app.get('/api/ndbc/latest', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let data;
    let stale = false;
    try {
      data = await getObs();
    } catch (error) {
      logErrorOnce('NDBC', error.message);
      if (!obsCache.data) return res.status(502).json({ error: 'Failed to fetch NDBC observations' });
      data = obsCache.data;
      stale = true;
    }
    if (req.query.all === '1') {
      return res.json({ stations: data.stations, total: data.stations.length, fetchedAt: data.fetchedAt, stale });
    }
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'lat and lon required (or all=1)' });
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 25));
    res.json({
      stations: nearestStations(data.stations, lat, lon, limit),
      total: data.stations.length,
      fetchedAt: data.fetchedAt,
      stale,
    });
  });
};
