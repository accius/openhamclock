'use strict';
/**
 * Web Push routes — TRUE closed-browser notifications via VAPID.
 *
 * v1 scope: server-pushed BROADCAST-class events only. The single event
 * source is NOAA SWPC space weather alerts at scale level >= 2 (the same
 * threshold the in-app severe-alert feed uses), plus a caller-scoped test
 * push. Per-user watchlist evaluation server-side is deliberately out of
 * scope — that's the phase-2 path (see the comment on broadcast()).
 *
 * Dormant by default: unless VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set
 * (see .env.example — `npx web-push generate-vapid-keys`), every endpoint
 * returns 503 and no timers, files, or upstream traffic are created. Zero
 * behavior change for existing installs.
 *
 * Subscriptions persist to a JSON file (same writable-path waterfall as
 * relay-tokens.json in rig-bridge.js), capped, pruned when the push service
 * answers 404/410. Pushed-alert dedupe keys persist alongside so server
 * restarts don't re-push the same product/serial.
 *
 * Endpoints:
 *   GET  /api/push/vapid-key    → { configured, publicKey }
 *   POST /api/push/subscribe    { subscription } → store it
 *   POST /api/push/unsubscribe  { endpoint }     → drop it
 *   POST /api/push/test         { subscription } → send a test push to the
 *                               caller's own subscription only
 *   POST /api/push/lightning/prefs { endpoint, lightning: { lat, lon, warnKm, alarmKm, imperial } | null }
 *                               → opt this subscription in/out of lightning
 *                               pushes for a location (rounded to 0.01°)
 *   POST /api/push/lightning    { endpoint, strike: { lat, lon, timestamp }, level,
 *                                 closer, simulated, relay, imperial }
 *                               → targeted: the strike is first VERIFIED
 *                               against the server's own Blitzortung feed
 *                               (ServerLightningFeed — runs only while some
 *                               subscription has opted in; a match within
 *                               5 km / 30 s); then every opted-in subscription
 *                               whose own radius the seen strike falls inside
 *                               gets a push computed for ITS location,
 *                               throttled per subscription. Unverifiable
 *                               reports, all-clear and simulated strikes go to
 *                               the caller's subscription only. The
 *                               caller must itself be opted in. Rate-limited
 *                               per client. PUSH_LIGHTNING_BROADCAST=true
 *                               (override) instead broadcasts the caller's
 *                               report to every subscriber, as before.
 */

const fs = require('fs');
const path = require('path');
const helpers = require('../utils/push-helpers');
const { ServerLightningFeed } = require('../utils/lightning-feed');

module.exports = function (app, ctx) {
  const { ROOT_DIR, logInfo, logWarn, logDebug } = ctx;

  const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
  // Contact URI push services may use to reach the operator (mailto: or https:).
  const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
  // Lightning guard pushes go to EVERY subscriber, so they are off unless the
  // operator says this server is theirs alone.
  const LIGHTNING_PUSH = /^(1|true|yes|on)$/i.test((process.env.PUSH_LIGHTNING_BROADCAST || '').trim());

  // ── Dormant mode: no keys → every endpoint 503s and nothing else runs ────
  let webpush = null;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
      webpush = ctx._webpush || require('web-push'); // ctx._webpush: test-only injection hook
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    } catch (err) {
      webpush = null;
      logWarn(`[Push] VAPID keys rejected (${err.message}) — Web Push disabled`);
    }
  }

  if (!webpush) {
    const dormant = (req, res) =>
      res.status(503).json({
        configured: false,
        error:
          'Web Push is not configured on this server. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys) to enable it.',
      });
    app.get('/api/push/vapid-key', dormant);
    app.post('/api/push/subscribe', dormant);
    app.post('/api/push/unsubscribe', dormant);
    app.post('/api/push/test', dormant);
    app.post('/api/push/lightning', dormant);
    app.post('/api/push/lightning/prefs', dormant);
    return {};
  }

  // ── Persistence (relay-tokens.json waterfall pattern) ────────────────────
  const PUSH_STORE_FILE = (() => {
    const candidates = [
      process.env.PUSH_SUBSCRIPTIONS_FILE,
      '/data/push-subscriptions.json',
      path.join(ROOT_DIR, 'data', 'push-subscriptions.json'),
      '/tmp/openhamclock-push-subscriptions.json',
    ];
    for (const p of candidates) {
      if (!p) continue;
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        return p;
      } catch {
        continue;
      }
    }
    return '/tmp/openhamclock-push-subscriptions.json';
  })();

  const store = { subscriptions: {}, pushedAlerts: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(PUSH_STORE_FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      for (const entry of Object.values(raw.subscriptions || {})) {
        if (entry?.subscription) {
          helpers.addSubscription(store, entry.subscription, helpers.MAX_SUBSCRIPTIONS, entry.addedAt ?? Date.now());
          if (entry.lightning) helpers.setLightningPrefs(store, entry.subscription.endpoint, entry.lightning);
        }
      }
      for (const [k, ts] of Object.entries(raw.pushedAlerts || {})) {
        if (Number.isFinite(ts)) store.pushedAlerts[k] = ts;
      }
    }
    logInfo(`[Push] Loaded ${Object.keys(store.subscriptions).length} subscription(s) from ${PUSH_STORE_FILE}`);
  } catch {
    /* file absent on first run — normal */
  }

  function saveStore() {
    try {
      fs.writeFileSync(PUSH_STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
      logWarn(`[Push] Could not persist subscriptions: ${err.message}`);
    }
  }

  // ── Delivery ─────────────────────────────────────────────────────────────
  const SEND_OPTIONS = { TTL: 6 * 60 * 60 }; // severe space weather stays relevant for hours

  /** Send one payload to one stored subscription. Returns { ok, statusCode, gone }. */
  async function sendTo(subscription, payloadJson) {
    try {
      await webpush.sendNotification(subscription, payloadJson, SEND_OPTIONS);
      return { ok: true };
    } catch (err) {
      const statusCode = err?.statusCode ?? 0;
      return { ok: false, statusCode, gone: statusCode === 404 || statusCode === 410 };
    }
  }

  /**
   * Broadcast a payload to every stored subscription, pruning the ones the
   * push service reports as gone (404/410).
   *
   * v1: broadcast-class only — every subscriber gets the same payload.
   * Phase 2: evaluate per-user watchlists server-side and target pushes per
   * subscription (needs per-subscription preferences stored alongside).
   */
  async function broadcast(payload) {
    const payloadJson = JSON.stringify(payload);
    const entries = Object.values(store.subscriptions);
    const CONCURRENCY = 25;
    let sent = 0;
    const gone = [];
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((e) => sendTo(e.subscription, payloadJson)));
      results.forEach((r, idx) => {
        if (r.ok) sent += 1;
        else if (r.gone) gone.push(batch[idx].subscription.endpoint);
      });
    }
    if (gone.length) {
      gone.forEach((endpoint) => helpers.removeSubscription(store, endpoint));
      saveStore();
    }
    logInfo(`[Push] Broadcast "${payload.title}" — ${sent}/${entries.length} delivered, ${gone.length} pruned`);
    return { sent, total: entries.length, pruned: gone.length };
  }

  // ── SWPC trigger ─────────────────────────────────────────────────────────
  // Evaluate every fresh SWPC alert refresh for new severe (scale >= 2)
  // products. Dedupe keys are recorded BEFORE delivery so an overlapping
  // refresh can't double-push, and persisted so restarts don't re-push.
  async function handleSwpcAlerts(alerts) {
    const now = Date.now();
    const pruned = helpers.prunePushedKeys(store.pushedAlerts, now);
    const fresh = helpers.selectNewSevereAlerts(alerts, store.pushedAlerts, now);
    if (fresh.length === 0) {
      if (pruned > 0) saveStore();
      return;
    }
    for (const alert of fresh) store.pushedAlerts[helpers.alertDedupeKey(alert)] = now;
    saveStore();
    for (const alert of fresh) {
      const payload = helpers.buildSwpcPushPayload(alert);
      logDebug(`[Push] New severe SWPC alert ${helpers.alertDedupeKey(alert)} → broadcasting`);
      await broadcast(payload);
    }
  }

  if (typeof ctx.onSwpcAlertsRefreshed === 'function') {
    ctx.onSwpcAlertsRefreshed((alerts) => {
      handleSwpcAlerts(alerts).catch((err) => logWarn(`[Push] SWPC broadcast failed: ${err.message}`));
    });
  }

  // Keep the SWPC cache turning over even with no browser connected — that is
  // the entire point of closed-browser push. refreshSwpcAlerts() is
  // cache-aware (5 min TTL), so this adds no upstream traffic beyond what an
  // open tab already causes.
  if (typeof ctx.refreshSwpcAlerts === 'function') {
    const SWPC_POLL_MS = 5 * 60 * 1000;
    const kick = () => ctx.refreshSwpcAlerts().catch(() => {});
    const interval = setInterval(kick, SWPC_POLL_MS);
    interval.unref?.();
    const boot = setTimeout(kick, 15000); // first poll shortly after boot, off the startup path
    boot.unref?.();
  }

  // ── Endpoints ────────────────────────────────────────────────────────────
  app.get('/api/push/vapid-key', (req, res) => {
    // lightning: targeted lightning pushes are available (always, when configured);
    // lightningBroadcast: the PUSH_LIGHTNING_BROADCAST override is on
    res.json({ configured: true, publicKey: VAPID_PUBLIC_KEY, lightning: true, lightningBroadcast: LIGHTNING_PUSH });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const sub = req.body?.subscription || req.body;
    const result = helpers.addSubscription(store, sub);
    if (!result.ok) {
      if (result.reason === 'full') return res.status(507).json({ error: 'Subscription limit reached' });
      return res.status(400).json({ error: 'Invalid push subscription' });
    }
    saveStore();
    logDebug(`[Push] Subscribed (${Object.keys(store.subscriptions).length} total)`);
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
    const removed = helpers.removeSubscription(store, endpoint);
    if (removed) {
      saveStore();
      refreshLightningFeed();
    }
    res.json({ ok: true, removed });
  });

  // Test push — delivered to the CALLER'S subscription only (echoed in body),
  // never broadcast. Lets the Settings card verify the full path end-to-end.
  app.post('/api/push/test', async (req, res) => {
    const sub = req.body?.subscription || req.body;
    if (!helpers.isValidSubscription(sub)) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }
    const payload = {
      title: 'OpenHamClock test push',
      body: 'Web Push is working — severe space weather alerts will arrive like this.',
      tag: 'ohc-push-test',
    };
    const result = await sendTo(sub, JSON.stringify(payload));
    if (result.ok) return res.json({ ok: true });
    if (result.gone) {
      if (helpers.removeSubscription(store, sub.endpoint)) saveStore();
      return res.status(410).json({ ok: false, error: 'Subscription expired — re-subscribe and try again' });
    }
    res
      .status(502)
      .json({ ok: false, error: `Push service rejected the request (${result.statusCode || 'network error'})` });
  });

  // ── Lightning guard ──────────────────────────────────────────────────────
  const lightningLimiter = helpers.makeKeyedLimiter(30, 60 * 1000); // strike reports per client per minute
  const prefsLimiter = helpers.makeKeyedLimiter(20, 60 * 1000);
  const lightningSent = new Map(); // endpoint → { at, level, km } (memory only)
  // The server's own view of the strike feed, to verify reports before they
  // reach anyone but the sender. ctx._lightningFeed: test-only injection hook.
  const lightningFeed = ctx._lightningFeed || new ServerLightningFeed({ log: logInfo });
  function refreshLightningFeed() {
    const areas = [];
    for (const entry of Object.values(store.subscriptions)) {
      if (entry.lightning) {
        areas.push({ lat: entry.lightning.lat, lon: entry.lightning.lon, radiusKm: entry.lightning.warnKm });
      }
    }
    lightningFeed.setWatchAreas(areas);
    // The override broadcasts reports unverified, so it needs no feed
    lightningFeed.setActive(areas.length > 0 && !LIGHTNING_PUSH);
  }
  refreshLightningFeed();
  let lastLightningBroadcast = null; // override mode
  const clientKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

  function pruneLightningSent(now) {
    for (const [endpoint, v] of lightningSent) {
      if (now - v.at > 60 * 60 * 1000 || !store.subscriptions[endpoint]) lightningSent.delete(endpoint);
    }
  }

  async function sendLightning(endpoint, payload) {
    const entry = store.subscriptions[endpoint];
    if (!entry) return { ok: false };
    const r = await sendTo(entry.subscription, JSON.stringify(payload));
    if (r.gone && helpers.removeSubscription(store, endpoint)) {
      saveStore();
      refreshLightningFeed();
    }
    return r;
  }

  app.post('/api/push/lightning/prefs', (req, res) => {
    if (!prefsLimiter(clientKey(req))) return res.status(429).json({ ok: false, error: 'Too many requests' });
    const { endpoint, lightning } = req.body || {};
    const r = helpers.setLightningPrefs(store, endpoint, lightning === null ? null : lightning);
    if (!r.ok) return res.status(r.reason === 'unknown-subscription' ? 404 : 400).json(r);
    saveStore();
    refreshLightningFeed();
    res.json(r);
  });

  app.post('/api/push/lightning', async (req, res) => {
    if (!lightningLimiter(clientKey(req))) return res.status(429).json({ ok: false, error: 'Too many requests' });
    const body = req.body || {};
    const level = body.level;
    if (!['warn', 'alarm', 'clear'].includes(level)) {
      return res.status(400).json({ ok: false, error: 'Invalid lightning report' });
    }
    const now = Date.now();

    // Override: the original station-wide broadcast (single-operator servers)
    if (LIGHTNING_PUSH) {
      const payload = helpers.buildLightningPushPayload(body);
      if (!helpers.shouldPushLightning(lastLightningBroadcast, level, now))
        return res.json({ ok: true, skipped: true });
      lastLightningBroadcast = { at: now, level };
      const result = await broadcast(payload);
      return res.json({ ok: true, mode: 'broadcast', ...result });
    }

    const caller = typeof body.endpoint === 'string' ? store.subscriptions[body.endpoint] : null;
    if (!caller || !caller.lightning) {
      return res.status(403).json({ ok: false, error: 'This browser is not subscribed to lightning pushes' });
    }
    pruneLightningSent(now);

    // All-clear and simulated strikes: the caller's own subscription only
    if (level === 'clear' || body.simulated === true) {
      let report = { level: 'clear', relay: body.relay };
      if (level !== 'clear') {
        const strike = helpers.sanitizeStrike(body.strike, now);
        if (!strike) return res.status(400).json({ ok: false, error: 'Invalid strike' });
        const hit = helpers.lightningForPrefs(caller.lightning, strike);
        report = { ...hit, level: hit.level || level, relay: body.relay, closer: body.closer, simulated: true };
      }
      const payload = helpers.buildLightningPushPayload({ ...report, imperial: caller.lightning.imperial });
      const r = await sendLightning(body.endpoint, payload);
      return res.json({ ok: true, mode: 'self', sent: r.ok ? 1 : 0 });
    }

    const reported = helpers.sanitizeStrike(body.strike, now);
    if (!reported) return res.status(400).json({ ok: false, error: 'Invalid strike' });

    // Verify against the server's own feed. A report the server cannot match
    // (fake, or the feed is down) only goes back to the caller.
    const seen = await lightningFeed.verify(reported);
    if (!seen) {
      const hit = helpers.lightningForPrefs(caller.lightning, reported);
      const last = lightningSent.get(body.endpoint);
      if (!hit.level || !helpers.shouldPushLightningTo(last, hit.level, hit.distanceKm, now)) {
        return res.json({ ok: true, mode: 'self-unverified', sent: 0 });
      }
      lightningSent.set(body.endpoint, { at: now, level: hit.level, km: hit.distanceKm });
      const payload = helpers.buildLightningPushPayload({
        ...hit,
        relay: body.relay,
        closer: body.closer,
        imperial: caller.lightning.imperial,
      });
      const r = await sendLightning(body.endpoint, payload);
      return res.json({ ok: true, mode: 'self-unverified', sent: r.ok ? 1 : 0 });
    }

    // Target from the strike as the server saw it, not as reported
    const strike = { lat: seen.lat, lon: seen.lon, timestamp: seen.timestamp };
    const targets = helpers.lightningTargets(store, strike);
    let sent = 0;
    let skipped = 0;
    for (const t of targets) {
      const last = lightningSent.get(t.endpoint);
      if (!helpers.shouldPushLightningTo(last, t.level, t.distanceKm, now)) {
        skipped++;
        continue;
      }
      const closer = !!last && t.level === 'alarm' && last.level === 'alarm' && t.distanceKm <= last.km / 2;
      lightningSent.set(t.endpoint, { at: now, level: t.level, km: t.distanceKm });
      // The caller's relay state only describes the caller's own station
      const relay = t.endpoint === body.endpoint ? body.relay : undefined;
      const payload = helpers.buildLightningPushPayload({ ...t, closer, relay });
      const r = await sendLightning(t.endpoint, payload);
      if (r.ok) sent++;
    }
    logDebug(`[Push] Lightning strike → ${targets.length} in range, ${sent} pushed, ${skipped} throttled`);
    res.json({ ok: true, mode: 'targeted', verified: true, inRange: targets.length, sent, skipped });
  });

  return {
    _pushStore: store,
    _broadcast: broadcast,
    _handleSwpcAlerts: handleSwpcAlerts,
    _lightningFeed: lightningFeed,
  };
};
