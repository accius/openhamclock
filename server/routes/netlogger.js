/**
 * NetLogger live nets — proxy for the public NetLogger API so the Nets
 * panel can show what is on the air right now.
 *
 *   GET /api/netlogger/nets                        → { nets, servers, fetchedAt }
 *   GET /api/netlogger/checkins?server=X&net=NAME  → { server, net, count, checkins, fetchedAt }
 *
 * Both are cached 60 s (NetLogger asks clients not to poll faster), share
 * one in-flight upstream request per key, serve stale on error, and the
 * check-in cache is bounded to CHECKIN_CACHE_MAX nets. Street addresses,
 * ZIP codes and member numbers in the upstream check-in records never
 * leave the server (see utils/netlogger.js).
 *
 * NetLogger's http:// endpoint answers 403 to non-browser agents; https://
 * works with a plain User-Agent, so that is what we use.
 */

const { parseActiveNets, parseCheckins } = require('../utils/netlogger');

const BASE_URL = 'https://www.netlogger.org/api';
const CACHE_TTL = 60 * 1000;
const STALE_TTL = 10 * 60 * 1000;
const CHECKIN_CACHE_MAX = 50;
const FETCH_TIMEOUT_MS = 15000;

module.exports = function (app, ctx) {
  const { fetch, upstream, logDebug, logErrorOnce, APP_VERSION } = ctx;

  const headers = { 'User-Agent': `OpenHamClock/${APP_VERSION || '1.0'} (+https://openhamclock.com)` };

  let netsCache = { data: null, timestamp: 0 };
  const checkinCache = new Map(); // key → { data, timestamp }

  async function fetchText(url) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      upstream.recordFailure('netlogger', res.status);
      throw new Error(`NetLogger responded ${res.status}`);
    }
    const text = await res.text();
    upstream.recordSuccess('netlogger');
    return text;
  }

  async function getNets() {
    const now = Date.now();
    if (netsCache.data && now - netsCache.timestamp < CACHE_TTL) return netsCache.data;
    if (upstream.isBackedOff('netlogger') && netsCache.data) return netsCache.data;
    try {
      const data = await upstream.fetch('netlogger:nets', async () => {
        const xml = await fetchText(`${BASE_URL}/GetActiveNets.php`);
        const parsed = parseActiveNets(xml);
        if (!parsed.servers.length && !parsed.nets.length && !/NetLoggerXML/i.test(xml)) {
          throw new Error('NetLogger returned an unexpected document');
        }
        return {
          nets: parsed.nets,
          servers: parsed.servers,
          apiVersion: parsed.apiVersion,
          fetchedAt: new Date().toISOString(),
        };
      });
      netsCache = { data, timestamp: Date.now() };
      logDebug(`[NetLogger] ${data.nets.length} active nets on ${data.servers.length} servers`);
      return data;
    } catch (err) {
      if (netsCache.data && Date.now() - netsCache.timestamp < STALE_TTL) {
        logDebug(`[NetLogger] serving stale nets: ${err.message}`);
        return { ...netsCache.data, stale: true };
      }
      throw err;
    }
  }

  app.get('/api/netlogger/nets', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=30');
      res.json(await getNets());
    } catch (err) {
      logErrorOnce('NetLogger nets', err.message);
      res.status(502).json({ error: 'NetLogger unavailable', nets: [], servers: [] });
    }
  });

  const validServer = (s) => /^[A-Z0-9_-]{1,24}$/i.test(s);
  const validNet = (n) => typeof n === 'string' && n.length >= 1 && n.length <= 80 && !/[\u0000-\u001F<>]/.test(n);

  app.get('/api/netlogger/checkins', async (req, res) => {
    const server = String(req.query.server || '').trim();
    const net = String(req.query.net || '').trim();
    if (!validServer(server) || !validNet(net)) {
      return res.status(400).json({ error: 'server and net are required' });
    }
    const key = `${server.toUpperCase()}|${net}`;
    const now = Date.now();
    const cached = checkinCache.get(key);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      res.set('Cache-Control', 'public, max-age=30');
      return res.json(cached.data);
    }
    if (upstream.isBackedOff('netlogger') && cached) return res.json({ ...cached.data, stale: true });
    try {
      const data = await upstream.fetch(`netlogger:checkins:${key}`, async () => {
        const url = `${BASE_URL}/GetCheckins.php?ServerName=${encodeURIComponent(server)}&NetName=${encodeURIComponent(net)}`;
        const body = await fetchText(url);
        const parsed = parseCheckins(body);
        return {
          server: parsed.server || server,
          net: parsed.net || net,
          count: parsed.count,
          checkins: parsed.checkins,
          fetchedAt: new Date().toISOString(),
        };
      });
      // Bounded cache — evict the oldest entry when full
      if (!checkinCache.has(key) && checkinCache.size >= CHECKIN_CACHE_MAX) {
        let oldestKey = null;
        let oldestTs = Infinity;
        for (const [k, v] of checkinCache) {
          if (v.timestamp < oldestTs) {
            oldestTs = v.timestamp;
            oldestKey = k;
          }
        }
        if (oldestKey) checkinCache.delete(oldestKey);
      }
      checkinCache.set(key, { data, timestamp: Date.now() });
      res.set('Cache-Control', 'public, max-age=30');
      res.json(data);
    } catch (err) {
      if (cached && Date.now() - cached.timestamp < STALE_TTL) return res.json({ ...cached.data, stale: true });
      logErrorOnce('NetLogger checkins', err.message);
      res.status(502).json({ error: 'NetLogger unavailable', checkins: [] });
    }
  });
};
