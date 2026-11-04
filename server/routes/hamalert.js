/**
 * HamAlert — optional server-side feed for self-hosted installs.
 *
 * Set HAMALERT_USER and HAMALERT_PASS in .env and the server keeps one
 * persistent telnet session to hamalert.org:7300 (see utils/hamalertClient.js),
 * parses the pushed alert lines and holds the last 200 in a ring buffer:
 *
 *   GET /api/hamalert/alerts[?since=<epoch ms>]
 *     → { enabled, connected, alerts: [...newest first], count, status }
 *
 * Without credentials the endpoint answers { enabled: false } and nothing
 * connects — the hosted site never has a shared HamAlert account (alerts
 * are per-user; use the Rig Bridge plugin there). Credentials never appear
 * in responses or logs.
 */

const { createHamAlertClient } = require('../utils/hamalertClient');
const { hamAlertKey } = require('../utils/hamalertParser');

const RING_MAX = 200;

module.exports = function (app, ctx) {
  const { logInfo, logWarn } = ctx;

  const username = (process.env.HAMALERT_USER || '').trim();
  const password = process.env.HAMALERT_PASS || '';

  if (!username || !password) {
    app.get('/api/hamalert/alerts', (req, res) => {
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ enabled: false, connected: false, alerts: [], count: 0 });
    });
    return;
  }

  const ring = [];
  const seen = new Map();
  let status = {};

  const client = createHamAlertClient({
    username,
    password,
    host: process.env.HAMALERT_HOST || undefined,
    port: process.env.HAMALERT_PORT || undefined,
    log: (msg) => logInfo(msg),
    onStatus: (s) => {
      status = s;
    },
    onAlert: (alert) => {
      const key = hamAlertKey(alert);
      const now = Date.now();
      if (seen.size > 1000) {
        for (const [k, t] of seen) if (now - t > 30 * 60 * 1000) seen.delete(k);
      }
      if (seen.has(key)) return;
      seen.set(key, now);
      ring.unshift(alert);
      if (ring.length > RING_MAX) ring.length = RING_MAX;
    },
  });

  // Start after the server is up; failures only log (never crash the app).
  setTimeout(() => {
    try {
      client.connect();
    } catch (e) {
      logWarn(`[HamAlert] start failed: ${e.message}`);
    }
  }, 2000);

  app.get('/api/hamalert/alerts', (req, res) => {
    const since = Number(req.query.since) || 0;
    const alerts = since > 0 ? ring.filter((a) => (a.timestamp || 0) > since) : ring;
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled: true,
      connected: !!status.loggedIn,
      count: alerts.length,
      alerts,
      status: {
        connected: !!status.connected,
        loggedIn: !!status.loggedIn,
        lastError: status.lastError || null,
        lastAlertAt: status.lastAlertAt || null,
        alertsTotal: status.alertsTotal || 0,
        attempts: status.attempts || 0,
      },
    });
  });
};
