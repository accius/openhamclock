/**
 * Winlink server-side proxy (issue #297).
 *
 * Browsers can't call api.winlink.org directly — the key would leak and each
 * user would count against the Winlink team's rate limits. This route hits
 * the Winlink API server-side with the shared WINLINK_API_KEY env var and
 * caches the response for an hour (per Lor W3QA's guidance).
 *
 * The rig-bridge plugin at rig-bridge/plugins/winlink-gateway.js keeps
 * working for local self-hosters who have their own API key or who are
 * running Pat — the browser hook tries /api/winlink/* first and falls
 * back to the rig-bridge /winlink/* path if this route returns 503.
 *
 * Endpoints:
 *   GET /api/winlink/status                     → key-configured boolean, cache meta
 *   GET /api/winlink/gateways?grid=&range=&mode= → gateway list (cached)
 *   GET /api/winlink/gateways/:callsign         → one gateway (from the cache)
 */

const WINLINK_API_BASE = 'https://api.winlink.org';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h per Lor's recommendation
const PROXIMITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min for grid-scoped queries

module.exports = function (app, ctx) {
  const { fetch, WINLINK_API_KEY, logInfo, logWarn, logErrorOnce } = ctx;

  // Full gateway list (no grid filter) — shared across all users, refreshed hourly.
  let fullListCache = { data: null, ts: 0 };
  // Grid-scoped proximity results — keyed by `${grid}|${range}|${mode}`, shorter TTL.
  const proximityCache = new Map();

  function keyConfigured() {
    return WINLINK_API_KEY && WINLINK_API_KEY.length > 0;
  }

  function noCache(res) {
    res.setHeader('Cache-Control', 'no-store');
  }

  async function fetchFromWinlink(path) {
    const url = `${WINLINK_API_BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(WINLINK_API_KEY)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    // The API always returns JSON even on 400 — surface its error message rather
    // than a generic HTTP code so operators can tell "bad key" from "bad path".
    if (!res.ok) {
      const apiErr = body?.ResponseStatus?.Message || `HTTP ${res.status}`;
      throw new Error(`winlink.org ${path}: ${apiErr}`);
    }
    return body;
  }

  // Normalize both endpoint shapes to a single {gateways:[...]} with the
  // union of useful fields — callers don't need to know which underlying
  // endpoint served the data.
  //
  //   /gateway/channel/report    → {Channels:[{…Hours,…}]}         (global list)
  //   /gateway/proximity.json    → {GatewayList:[{…Distance,…}]}   (near a grid)
  function normalizeRow(r) {
    return {
      callsign: r.Callsign,
      gridsquare: r.Gridsquare,
      frequency: r.Frequency, // Hz
      mode: r.Mode, // integer code — map to label in the client
      serviceCode: r.ServiceCode,
      hours: r.Hours ?? null,
      baud: r.Baud ?? null,
      distance: r.Distance ?? null, // km, proximity only
      heading: r.Heading ?? null, // deg, proximity only
    };
  }

  async function getFullGatewayList() {
    if (fullListCache.data && Date.now() - fullListCache.ts < CACHE_TTL_MS) {
      return fullListCache.data;
    }
    const json = await fetchFromWinlink('/gateway/channel/report');
    const list = (json.Channels || []).map(normalizeRow);
    fullListCache = { data: list, ts: Date.now() };
    logInfo('[Winlink]', 'cached', list.length, 'gateways (global list)');
    return list;
  }

  async function getProximity(grid, range) {
    const key = `${grid}|${range || 500}`;
    const hit = proximityCache.get(key);
    if (hit && Date.now() - hit.ts < PROXIMITY_CACHE_TTL_MS) return hit.data;
    const json = await fetchFromWinlink(
      `/gateway/proximity.json?GridSquare=${encodeURIComponent(grid)}&MaxDistance=${Number(range) || 500}`,
    );
    const list = (json.GatewayList || []).map(normalizeRow);
    proximityCache.set(key, { data: list, ts: Date.now() });
    // Keep the proximity cache bounded — arbitrary 50 distinct queries is
    // plenty for a shared deployment and prevents slow memory growth.
    if (proximityCache.size > 50) {
      const oldest = [...proximityCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) proximityCache.delete(oldest[0]);
    }
    return list;
  }

  app.get('/api/winlink/status', (req, res) => {
    noCache(res);
    res.json({
      apiKeyConfigured: keyConfigured(),
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
      fullListCached: !!fullListCache.data,
      fullListAge: fullListCache.ts ? Math.round((Date.now() - fullListCache.ts) / 1000) : null,
      fullListSize: fullListCache.data?.length ?? 0,
    });
  });

  app.get('/api/winlink/gateways', async (req, res) => {
    if (!keyConfigured()) {
      noCache(res);
      return res.status(503).json({
        error: 'Winlink API key not configured on this server',
        hint: 'set WINLINK_API_KEY or use the rig-bridge /winlink/* endpoints',
      });
    }

    const { grid, range, mode } = req.query;
    try {
      const list = grid ? await getProximity(String(grid), range) : await getFullGatewayList();
      // Mode filter matches numeric mode code OR ServiceCode string (e.g. "PUBLIC", "EMCOMM").
      const filtered = mode
        ? list.filter((g) => {
            const needle = String(mode).toLowerCase();
            return (
              String(g.mode).toLowerCase().includes(needle) || String(g.serviceCode).toLowerCase().includes(needle)
            );
          })
        : list;
      // Short browser cache — fresh enough for map rendering without pounding
      // us every poll. The server-side cache is the real efficiency win.
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ count: filtered.length, gateways: filtered });
    } catch (err) {
      logErrorOnce('winlink-gateways', err.message);
      noCache(res);
      res.status(502).json({ error: 'winlink.org upstream error' });
    }
  });

  app.get('/api/winlink/gateways/:callsign', async (req, res) => {
    if (!keyConfigured()) {
      noCache(res);
      return res.status(503).json({ error: 'Winlink API key not configured' });
    }
    try {
      const list = await getFullGatewayList();
      const cs = String(req.params.callsign).toUpperCase();
      const found = list.find((g) => String(g.callsign).toUpperCase() === cs);
      if (!found) return res.status(404).json({ error: 'gateway not found' });
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(found);
    } catch (err) {
      logErrorOnce('winlink-gateway-lookup', err.message);
      noCache(res);
      res.status(502).json({ error: 'winlink.org upstream error' });
    }
  });

  if (keyConfigured()) {
    logInfo('[Winlink] ✓ API key configured — gateway proxy enabled at /api/winlink/gateways');
  } else {
    logWarn('[Winlink] WINLINK_API_KEY not set — /api/winlink/gateways will return 503');
  }
};
