/**
 * Dst (disturbance storm time) index — the ring-current measure of a
 * geomagnetic storm, for the Dst panel and the Solar Indices view.
 *
 * Primary: Kyoto WDC real-time Dst (fixed-width HTML table, parsed by
 * server/utils/kyotoDst.js). Fallback: SWPC's JSON mirror of the same
 * product. Both are hourly, so a 10-minute cache is plenty; stale data is
 * served when both upstreams fail.
 *
 * GET /api/swpc/dst → { current: { t, dst }, series: [{ t, dst }], source, updatedAt, fetchedAt }
 * series = trailing 72 h, hourly, t = epoch ms (start of the UT hour).
 */

const { parseKyotoDst, parseSwpcDst, trimSeries } = require('../utils/kyotoDst');

const KYOTO_URL = 'https://wdc.kugi.kyoto-u.ac.jp/dst_realtime/presentmonth/index.html';
const SWPC_URL = 'https://services.swpc.noaa.gov/products/kyoto-dst.json';

const CACHE_TTL = 10 * 60 * 1000;
const SERIES_HOURS = 72;

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  let cache = { data: null, timestamp: 0 };

  const headers = { 'User-Agent': `OpenHamClock/${APP_VERSION}` };

  async function fromKyoto() {
    const res = await fetch(KYOTO_URL, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Kyoto responded ${res.status}`);
    const parsed = parseKyotoDst(await res.text());
    return { series: parsed.series, updatedAt: parsed.updatedAt, source: 'Kyoto WDC' };
  }

  async function fromSwpc() {
    const res = await fetch(SWPC_URL, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`SWPC responded ${res.status}`);
    const parsed = parseSwpcDst(await res.json());
    return { series: parsed.series, updatedAt: null, source: 'SWPC (Kyoto mirror)' };
  }

  async function load() {
    let result;
    try {
      result = await fromKyoto();
    } catch (err) {
      logDebug('[Dst] Kyoto failed, trying SWPC mirror:', err.message);
      result = await fromSwpc();
    }
    const series = trimSeries(result.series, SERIES_HOURS);
    const current = series[series.length - 1] || null;
    return {
      current,
      series,
      source: result.source,
      updatedAt: result.updatedAt || (current ? new Date(current.t + 3600e3).toISOString() : null),
      fetchedAt: new Date().toISOString(),
    };
  }

  app.get('/api/swpc/dst', async (req, res) => {
    try {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) {
        return res.json(cache.data);
      }
      const data = await ctx.upstream.fetch('swpc:dst', load);
      cache = { data, timestamp: Date.now() };
      logDebug('[Dst]', data.series.length, 'hourly points from', data.source);
      res.json(data);
    } catch (error) {
      logErrorOnce('Dst', error.message);
      if (cache.data) return res.json({ ...cache.data, stale: true });
      res.status(502).json({ error: 'Failed to fetch Dst index' });
    }
  });
};
