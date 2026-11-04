/**
 * SWPC 27-day outlook proxy — predicted 10.7 cm flux, Ap and max Kp per day.
 *
 * GET /api/swpc/outlook → { issued, days: [{ date, sfi, ap, kp }], fetchedAt, stale? }
 *
 * SWPC reissues the table once a day (Mondays get the full refresh), so a
 * 6 h cache is generous; stale data is served when upstream is down. One
 * upstream fetch per instance, shared across all users (ctx.upstream dedupes
 * concurrent misses).
 */
const { parse27DayOutlook } = require('../utils/swpcOutlook');

const OUTLOOK_URL = 'https://services.swpc.noaa.gov/text/27-day-outlook.txt';
const CACHE_TTL = 6 * 60 * 60 * 1000;

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  let cache = { data: null, timestamp: 0 };

  async function getOutlook() {
    if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) return cache.data;
    try {
      const data = await ctx.upstream.fetch('swpc:outlook', async () => {
        const response = await fetch(OUTLOOK_URL, {
          headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`27-day-outlook responded ${response.status}`);
        const parsed = parse27DayOutlook(await response.text());
        if (!parsed.days.length) throw new Error('27-day outlook parsed to zero rows');
        return { ...parsed, fetchedAt: new Date().toISOString() };
      });
      cache = { data, timestamp: Date.now() };
      logDebug?.(`[SWPC Outlook] ${data.days.length} days, issued ${data.issued}`);
      return data;
    } catch (error) {
      logErrorOnce?.('SWPC Outlook', error.message);
      if (cache.data) return { ...cache.data, stale: true };
      throw error;
    }
  }

  // Shared with other server modules (MQTT publisher) without an HTTP hop.
  ctx.getSolarOutlook = getOutlook;

  app.get('/api/swpc/outlook', async (req, res) => {
    try {
      const data = await getOutlook();
      res.set('Cache-Control', 'public, max-age=1800');
      res.json(data);
    } catch {
      res.status(502).json({ error: 'Failed to fetch SWPC 27-day outlook' });
    }
  });

  return { getSolarOutlook: getOutlook };
};
