/**
 * WEFAX — NWS/USCG HF radiofax charts for the WEFAX panel.
 *
 * GET /api/wefax/catalog     → bundled station/chart catalogue (server/utils/wefaxCatalog)
 * GET /api/wefax/chart/:id   → the chart GIF proxied from tgftp.nws.noaa.gov/fax
 *
 * Chart ids are validated against the catalogue (no open proxy). Images are
 * cached 30 min, at most 20 at a time (each ~80 KB), with one in-flight fetch
 * per id; a stale copy is served when the upstream fails.
 */
const { getCatalog, isKnownChart, chartUrl } = require('../utils/wefaxCatalog');

const IMAGE_TTL = 30 * 60 * 1000;
const IMAGE_CACHE_MAX = 20;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;
  const headers = { 'User-Agent': `OpenHamClock/${APP_VERSION || '1.0'}` };

  /** id → { buf, contentType, lastModified, timestamp } (insertion-ordered for LRU-ish eviction) */
  const images = new Map();
  const catalog = getCatalog();

  app.get('/api/wefax/catalog', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(catalog);
  });

  async function fetchChart(id) {
    const res = await fetch(chartUrl(id), { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${id}.gif responded ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new Error(`${id}.gif unexpected size ${buf.length}`);
    const entry = {
      buf,
      contentType: res.headers.get('content-type') || 'image/gif',
      lastModified: res.headers.get('last-modified') || null,
      timestamp: Date.now(),
    };
    images.delete(id);
    images.set(id, entry);
    while (images.size > IMAGE_CACHE_MAX) images.delete(images.keys().next().value);
    return entry;
  }

  function send(res, id, entry, stale) {
    res.set('Content-Type', entry.contentType);
    res.set('Cache-Control', 'public, max-age=600');
    res.set('X-Chart-Fetched-At', new Date(entry.timestamp).toISOString());
    if (entry.lastModified) res.set('Last-Modified', entry.lastModified);
    if (stale) res.set('X-Chart-Stale', '1');
    res.send(entry.buf);
  }

  app.get('/api/wefax/chart/:id', async (req, res) => {
    const id = String(req.params.id || '').toUpperCase();
    if (!isKnownChart(id)) return res.status(404).json({ error: 'Unknown chart id' });
    const cached = images.get(id);
    if (cached && Date.now() - cached.timestamp < IMAGE_TTL) return send(res, id, cached, false);
    try {
      const entry = await ctx.upstream.fetch(`wefax:${id}`, () => fetchChart(id));
      logDebug('[WEFAX] fetched', id, entry.buf.length, 'bytes');
      send(res, id, entry, false);
    } catch (error) {
      logErrorOnce(`WEFAX-${id}`, error.message);
      if (cached) return send(res, id, cached, true);
      res.status(502).json({ error: 'Chart unavailable' });
    }
  });
};
