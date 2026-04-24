/**
 * P.533 coefficient data proxy.
 *
 * Browsers can't fetch GitHub release assets directly — the 302 redirects to
 * release-assets.githubusercontent.com, which doesn't set CORS headers, so
 * the cross-origin request is blocked. This route is a thin streaming proxy
 * that runs server-side (where CORS doesn't apply) and re-emits the bytes
 * with our own headers so dataLoader.js on the client can fetch them
 * same-origin from /api/p533-data/<file>.
 *
 * Allowlist prevents this from being abused as an open proxy — only the
 * files actually published by .github/workflows/publish-p533-data.yml can
 * be requested.
 */

const { Readable } = require('node:stream');

module.exports = function (app, ctx) {
  const { fetch, logWarn, logErrorOnce } = ctx;

  const DATA_VERSION = process.env.P533_DATA_VERSION || 'v14.3';
  const UPSTREAM_BASE = `https://github.com/accius/openhamclock/releases/download/p533-data-${DATA_VERSION}`;

  // Matches the asset names emitted by publish-p533-data.yml.
  const ALLOW = /^(ionos\d{2}\.bin\.gz|COEFF\d{2}W\.txt\.gz|P1239-3-Decile-Factors\.txt\.gz|manifest\.json)$/;

  app.get('/api/p533-data/:file', async (req, res) => {
    const file = req.params.file;
    if (!ALLOW.test(file)) {
      return res.status(404).json({ error: 'unknown p533 data file' });
    }

    let upstreamRes;
    try {
      upstreamRes = await fetch(`${UPSTREAM_BASE}/${file}`, { redirect: 'follow' });
    } catch (err) {
      logErrorOnce('p533-data-proxy', err.message);
      return res.status(502).json({ error: 'upstream error' });
    }

    if (!upstreamRes.ok) {
      logWarn('[p533-data]', file, 'upstream returned', upstreamRes.status);
      return res.status(upstreamRes.status).json({ error: 'upstream fetch failed' });
    }

    // Release assets are version-tagged — content is immutable for a given
    // DATA_VERSION, so cache aggressively at any edge/CDN and in the browser.
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    const upstreamLen = upstreamRes.headers.get('content-length');
    if (upstreamLen) res.setHeader('Content-Length', upstreamLen);

    // Stream rather than buffering — the ionos*.bin.gz files are ~9 MB each.
    try {
      Readable.fromWeb(upstreamRes.body).pipe(res);
    } catch (err) {
      logErrorOnce('p533-data-stream', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'stream error' });
    }
  });
};
