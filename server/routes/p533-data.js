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

// server.js uses node-fetch, whose response.body is already a Node Readable
// (PassThrough). Node's native fetch returns a Web ReadableStream. Detect and
// normalize so the proxy works regardless of which one ctx.fetch happens to be.
function asNodeReadable(body) {
  if (body && typeof body.pipe === 'function') return body;
  return Readable.fromWeb(body);
}

module.exports = function (app, ctx) {
  const { fetch, logWarn, logErrorOnce } = ctx;

  const DATA_VERSION = process.env.P533_DATA_VERSION || 'v14.3';
  const UPSTREAM_BASE = `https://github.com/accius/openhamclock/releases/download/p533-data-${DATA_VERSION}`;

  // Matches the asset names emitted by publish-p533-data.yml.
  const ALLOW = /^(ionos\d{2}\.bin\.gz|COEFF\d{2}W\.txt\.gz|P1239-3-Decile-Factors\.txt\.gz|manifest\.json)$/;

  // Cloudflare will cache upstream-error responses by default even when the
  // origin says Cache-Control: no-store, which turned a transient 502 into a
  // stuck 502 for 15+ minutes in practice. Explicitly pin error responses to
  // "do not cache at any layer" so a later retry actually hits the proxy.
  function sendNoCacheError(res, status, body) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    return res.status(status).json(body);
  }

  app.get('/api/p533-data/:file', async (req, res) => {
    const file = req.params.file;
    if (!ALLOW.test(file)) {
      return sendNoCacheError(res, 404, { error: 'unknown p533 data file' });
    }

    let upstreamRes;
    try {
      upstreamRes = await fetch(`${UPSTREAM_BASE}/${file}`, { redirect: 'follow' });
    } catch (err) {
      logErrorOnce('p533-data-proxy', err.message);
      return sendNoCacheError(res, 502, { error: 'upstream error' });
    }

    if (!upstreamRes.ok) {
      logWarn('[p533-data]', file, 'upstream returned', upstreamRes.status);
      return sendNoCacheError(res, upstreamRes.status, { error: 'upstream fetch failed' });
    }

    // Release assets are version-tagged — content is immutable for a given
    // DATA_VERSION, so cache aggressively at any edge/CDN and in the browser.
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    const upstreamLen = upstreamRes.headers.get('content-length');
    if (upstreamLen) res.setHeader('Content-Length', upstreamLen);

    // Stream rather than buffering — the ionos*.bin.gz files are ~9 MB each.
    try {
      asNodeReadable(upstreamRes.body).pipe(res);
    } catch (err) {
      logErrorOnce('p533-data-stream', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'stream error' });
    }
  });
};
