/**
 * NOAA Space Weather Scales — R (radio blackout), S (solar radiation),
 * G (geomagnetic storm): current level plus the 1/2/3-day forecast, for the
 * NOAA Scales panel and the Space Wx Alerts header.
 *
 * Upstream: https://services.swpc.noaa.gov/products/noaa-scales.json
 *   { "0": today's observed, "1".."3": forecast days, "-1": yesterday }
 *   each: { DateStamp, TimeStamp, R: {Scale, Text, MinorProb, MajorProb},
 *           S: {Scale, Text, Prob}, G: {Scale, Text} }
 * Forecast days carry probabilities (R minor/major %, S %) instead of a
 * scale for R and S, and a predicted scale for G.
 *
 * GET /api/swpc/scales → { scales: <raw upstream object>, fetchedAt }
 * The client normalises the shape (src/utils/noaaScales.js) so the server
 * stays a dumb, cached proxy. 5-minute cache, stale-on-error.
 */

const SCALES_URL = 'https://services.swpc.noaa.gov/products/noaa-scales.json';
const CACHE_TTL = 5 * 60 * 1000;

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  let cache = { data: null, timestamp: 0 };

  async function load() {
    const res = await fetch(SCALES_URL, {
      headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`noaa-scales responded ${res.status}`);
    const json = await res.json();
    if (!json || typeof json !== 'object' || !json['0']) throw new Error('noaa-scales: unexpected shape');
    // Only keep the documented day keys — bounds the payload if upstream grows.
    const scales = {};
    for (const key of ['-1', '0', '1', '2', '3']) if (json[key]) scales[key] = json[key];
    return { scales, fetchedAt: new Date().toISOString() };
  }

  app.get('/api/swpc/scales', async (req, res) => {
    try {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) {
        return res.json(cache.data);
      }
      const data = await ctx.upstream.fetch('swpc:scales', load);
      cache = { data, timestamp: Date.now() };
      logDebug(
        '[NOAA Scales] R',
        data.scales['0']?.R?.Scale,
        'S',
        data.scales['0']?.S?.Scale,
        'G',
        data.scales['0']?.G?.Scale,
      );
      res.json(data);
    } catch (error) {
      logErrorOnce('NOAA Scales', error.message);
      if (cache.data) return res.json({ ...cache.data, stale: true });
      res.status(502).json({ error: 'Failed to fetch NOAA scales' });
    }
  });
};
