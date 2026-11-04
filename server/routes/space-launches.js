/**
 * Upcoming orbital launches from Launch Library 2 (The Space Devs) for the
 * Space Launches panel and the launch-sites map layer.
 *
 * LL2 is rate limited (15 requests/hour anonymous), so this is the one
 * place in the app that talks to it: 30-minute cache, shared in-flight
 * promise, exponential backoff on 429/5xx, and the last good payload is
 * served (flagged stale) for up to 24 h when upstream is down.
 *
 * GET /api/space-launches → { launches: [...], count, fetchedAt, stale? }
 * launch shape: see server/utils/spaceLaunches.js slimLaunch().
 */

const { slimLaunches } = require('../utils/spaceLaunches');

const LL2_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=20&mode=normal';
const CACHE_TTL = 30 * 60 * 1000;
const MAX_STALE = 24 * 60 * 60 * 1000;
const SERVICE = 'll2';

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  let cache = { data: null, timestamp: 0 };

  async function load() {
    if (ctx.upstream.isBackedOff?.(SERVICE)) {
      throw new Error(`LL2 backed off for ${ctx.upstream.backoffRemaining(SERVICE)}s`);
    }
    const res = await fetch(LL2_URL, {
      headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      ctx.upstream.recordFailure?.(SERVICE, res.status);
      throw new Error(`LL2 responded ${res.status}`);
    }
    const json = await res.json();
    const launches = slimLaunches(json);
    if (!launches.length) throw new Error('LL2: no launches in response');
    ctx.upstream.recordSuccess?.(SERVICE);
    return { launches, count: launches.length, fetchedAt: new Date().toISOString() };
  }

  app.get('/api/space-launches', async (req, res) => {
    try {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) {
        return res.json(cache.data);
      }
      const data = await ctx.upstream.fetch('space-launches', load);
      cache = { data, timestamp: Date.now() };
      logDebug('[Space Launches]', data.count, 'upcoming launches');
      res.json(data);
    } catch (error) {
      logErrorOnce('Space Launches', error.message);
      if (cache.data && Date.now() - cache.timestamp < MAX_STALE) {
        return res.json({ ...cache.data, stale: true });
      }
      res.status(502).json({ error: 'Failed to fetch upcoming launches' });
    }
  });
};
