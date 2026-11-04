/**
 * Tests for server/routes/push.js — Web Push endpoints and SWPC trigger.
 *
 * web-push is mocked via the ctx._webpush test-only injection hook (same
 * idiom as ctx._dxNewsFetchers in dxpeditions.js), so no real VAPID crypto
 * or network delivery happens. Persistence goes to a per-test temp file via
 * the PUSH_SUBSCRIPTIONS_FILE env override.
 *
 * Covers:
 *   - dormant mode: no VAPID keys → every endpoint 503s
 *   - subscribe: stores + persists, validates, dedupes, caps
 *   - unsubscribe: removes
 *   - test push: caller-only delivery, 410 prunes the stored subscription
 *   - SWPC trigger: new severe alert broadcasts once; dedupe survives a
 *     simulated restart (fresh module instance, same store file)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const route = require('./push.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  const handlers = {};
  return {
    get: (p, h) => {
      handlers[`GET ${p}`] = h;
    },
    post: (p, h) => {
      handlers[`POST ${p}`] = h;
    },
    handlers,
  };
}

async function callRoute(app, method, p, body) {
  const handler = app.handlers[`${method} ${p}`];
  if (!handler) throw new Error(`No handler for ${method} ${p}`);
  const req = { body };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set() {
      return this;
    },
  };
  await handler(req, res);
  return res;
}

/**
 * Stand-in for the server's own Blitzortung feed (never opens a socket).
 * By default every reported strike counts as seen; `seen(null)` makes reports
 * unverifiable, `seen({ lat, lon, timestamp })` returns that strike instead.
 */
function makeFeedMock() {
  let answer = 'echo';
  return {
    setWatchAreas: vi.fn(),
    setActive: vi.fn(),
    verify: vi.fn(async (report) => (answer === 'echo' ? report : answer)),
    seen(v) {
      answer = v;
    },
  };
}

let feedMock;

function makeCtx(webpushMock) {
  return {
    ROOT_DIR: os.tmpdir(),
    logInfo: () => {},
    logWarn: () => {},
    logDebug: () => {},
    _webpush: webpushMock,
    _lightningFeed: feedMock,
    // NOTE: no refreshSwpcAlerts / onSwpcAlertsRefreshed — keeps the module
    // from creating timers during tests; the trigger is exercised directly
    // via the returned _handleSwpcAlerts.
  };
}

function makeWebpushMock() {
  return {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  };
}

function makeSub(n = 1) {
  return {
    endpoint: `https://push.example.com/sub/${n}`,
    expirationTime: null,
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  };
}

function severeAlert(serial = 1) {
  return {
    productId: 'ALTK07',
    serial,
    issueTime: new Date(Date.now() - 60 * 1000).toISOString(),
    type: 'ALERT',
    title: 'Geomagnetic K-index of 7',
    scale: { band: 'G', level: 3, text: 'G3 - Strong' },
  };
}

let storeFile;
const ENV_KEYS = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'PUSH_SUBSCRIPTIONS_FILE',
  'PUSH_LIGHTNING_BROADCAST',
];
const savedEnv = {};

beforeEach(() => {
  feedMock = makeFeedMock();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  storeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-push-test-')), 'push-subscriptions.json');
  process.env.PUSH_SUBSCRIPTIONS_FILE = storeFile;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(path.dirname(storeFile), { recursive: true, force: true });
});

function mountConfigured(webpushMock = makeWebpushMock()) {
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  const app = makeApp();
  const exports_ = route(app, makeCtx(webpushMock));
  return { app, exports_, webpushMock };
}

// ─── Dormant mode ─────────────────────────────────────────────────────────────

describe('dormant mode (no VAPID keys)', () => {
  it('returns 503 with configured:false from every endpoint', async () => {
    const app = makeApp();
    route(app, makeCtx(makeWebpushMock()));
    for (const [method, p] of [
      ['GET', '/api/push/vapid-key'],
      ['POST', '/api/push/subscribe'],
      ['POST', '/api/push/unsubscribe'],
      ['POST', '/api/push/test'],
      ['POST', '/api/push/lightning'],
    ]) {
      const res = await callRoute(app, method, p, {});
      expect(res.statusCode).toBe(503);
      expect(res.body.configured).toBe(false);
      expect(res.body.error).toMatch(/not configured/i);
    }
  });

  it('creates no store file while dormant', async () => {
    const app = makeApp();
    route(app, makeCtx(makeWebpushMock()));
    expect(fs.existsSync(storeFile)).toBe(false);
  });
});

// ─── Configured mode ──────────────────────────────────────────────────────────

describe('configured mode', () => {
  it('serves the VAPID public key', async () => {
    const { app } = mountConfigured();
    const res = await callRoute(app, 'GET', '/api/push/vapid-key');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      configured: true,
      publicKey: 'test-public-key',
      lightning: true,
      lightningBroadcast: false,
    });
  });

  it('subscribe stores and persists; invalid bodies are rejected', async () => {
    const { app } = mountConfigured();
    const ok = await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    expect(ok.statusCode).toBe(200);
    const persisted = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    expect(Object.keys(persisted.subscriptions)).toEqual([makeSub().endpoint]);

    const bad = await callRoute(app, 'POST', '/api/push/subscribe', { subscription: { endpoint: 'nope' } });
    expect(bad.statusCode).toBe(400);
  });

  it('subscribe dedupes by endpoint', async () => {
    const { app, exports_ } = mountConfigured();
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    expect(Object.keys(exports_._pushStore.subscriptions)).toHaveLength(1);
  });

  it('unsubscribe removes the stored subscription', async () => {
    const { app, exports_ } = mountConfigured();
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    const res = await callRoute(app, 'POST', '/api/push/unsubscribe', { endpoint: makeSub().endpoint });
    expect(res.body).toEqual({ ok: true, removed: true });
    expect(Object.keys(exports_._pushStore.subscriptions)).toHaveLength(0);
  });

  it('test push targets the caller subscription only', async () => {
    const { app, webpushMock } = mountConfigured();
    const res = await callRoute(app, 'POST', '/api/push/test', { subscription: makeSub() });
    expect(res.statusCode).toBe(200);
    expect(webpushMock.sendNotification).toHaveBeenCalledTimes(1);
    const [subArg, payloadArg] = webpushMock.sendNotification.mock.calls[0];
    expect(subArg.endpoint).toBe(makeSub().endpoint);
    expect(JSON.parse(payloadArg).tag).toBe('ohc-push-test');
  });

  it('test push handles delivery failure gracefully and prunes on 410', async () => {
    const webpushMock = makeWebpushMock();
    webpushMock.sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    const { app, exports_ } = mountConfigured(webpushMock);
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    const res = await callRoute(app, 'POST', '/api/push/test', { subscription: makeSub() });
    expect(res.statusCode).toBe(410);
    expect(res.body.ok).toBe(false);
    expect(Object.keys(exports_._pushStore.subscriptions)).toHaveLength(0);
  });

  it('test push reports non-gone failures as 502 without pruning', async () => {
    const webpushMock = makeWebpushMock();
    webpushMock.sendNotification.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 400 }));
    const { app, exports_ } = mountConfigured(webpushMock);
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    const res = await callRoute(app, 'POST', '/api/push/test', { subscription: makeSub() });
    expect(res.statusCode).toBe(502);
    expect(Object.keys(exports_._pushStore.subscriptions)).toHaveLength(1);
  });
});

// ─── SWPC trigger ─────────────────────────────────────────────────────────────

describe('SWPC severe alert trigger', () => {
  it('broadcasts a new severe alert to all subscriptions exactly once', async () => {
    const { app, exports_, webpushMock } = mountConfigured();
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub(1) });
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub(2) });

    await exports_._handleSwpcAlerts([severeAlert(42)]);
    expect(webpushMock.sendNotification).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(webpushMock.sendNotification.mock.calls[0][1]);
    expect(payload).toEqual({
      title: 'Space Weather: G3 - Strong',
      body: 'ALERT: Geomagnetic K-index of 7',
      tag: 'ohc-push-swpc',
    });

    // Same refresh cycle content again → no re-push
    await exports_._handleSwpcAlerts([severeAlert(42)]);
    expect(webpushMock.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('ignores sub-threshold alerts', async () => {
    const { app, exports_, webpushMock } = mountConfigured();
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    await exports_._handleSwpcAlerts([{ ...severeAlert(1), scale: { band: 'G', level: 1, text: 'G1 - Minor' } }]);
    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it('prunes subscriptions the push service reports gone during broadcast', async () => {
    const webpushMock = makeWebpushMock();
    webpushMock.sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    const { app, exports_ } = mountConfigured(webpushMock);
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    await exports_._handleSwpcAlerts([severeAlert(7)]);
    expect(Object.keys(exports_._pushStore.subscriptions)).toHaveLength(0);
  });

  it('does not re-push a seen alert after a restart (dedupe keys persist)', async () => {
    const first = mountConfigured();
    await callRoute(first.app, 'POST', '/api/push/subscribe', { subscription: makeSub() });
    await first.exports_._handleSwpcAlerts([severeAlert(99)]);
    expect(first.webpushMock.sendNotification).toHaveBeenCalledTimes(1);

    // Simulated restart: fresh module instance loads the same store file.
    const second = mountConfigured();
    expect(Object.keys(second.exports_._pushStore.subscriptions)).toHaveLength(1);
    await second.exports_._handleSwpcAlerts([severeAlert(99)]);
    expect(second.webpushMock.sendNotification).not.toHaveBeenCalled();
  });
});

// ─── Lightning guard broadcast ────────────────────────────────────────────────

describe('lightning guard push', () => {
  // A point `km` from (lat, lon) along `brg` (spherical earth)
  const destination = (lat, lon, km, brg) => {
    const rad = (d) => (d * Math.PI) / 180;
    const deg = (r) => (r * 180) / Math.PI;
    const d = km / 6371;
    const p1 = rad(lat);
    const b = rad(brg);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 =
      rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: deg(p2), lon: deg(l2) };
  };
  const HOME = { lat: 40, lon: -105 };
  const FAR = { lat: 51.5, lon: -0.1 };
  const strikeNear = (where, km, brg = 0) => ({ ...destination(where.lat, where.lon, km, brg), timestamp: Date.now() });
  const optIn = (app, n, where, extra = {}) =>
    callRoute(app, 'POST', '/api/push/lightning/prefs', {
      endpoint: makeSub(n).endpoint,
      lightning: { ...where, warnKm: 50, alarmKm: 25, ...extra },
    });

  async function setup() {
    const ctx = mountConfigured();
    for (const n of [1, 2, 3]) await callRoute(ctx.app, 'POST', '/api/push/subscribe', { subscription: makeSub(n) });
    return ctx;
  }

  it('advertises targeted lightning pushes; the broadcast override is off by default', async () => {
    const { app } = mountConfigured();
    const key = await callRoute(app, 'GET', '/api/push/vapid-key');
    expect(key.body).toMatchObject({ lightning: true, lightningBroadcast: false });
  });

  it('prefs: opt-in stores a rounded location, survives re-subscribe and restart; null opts out', async () => {
    const { app, exports_ } = await setup();
    const res = await optIn(app, 1, { lat: 40.01234, lon: -105.27051, imperial: true });
    expect(res.body.lightning).toEqual({ lat: 40.01, lon: -105.27, warnKm: 50, alarmKm: 25, imperial: true });
    await callRoute(app, 'POST', '/api/push/subscribe', { subscription: makeSub(1) });
    expect(exports_._pushStore.subscriptions[makeSub(1).endpoint].lightning.lat).toBe(40.01);
    // A fresh module instance reading the same store file keeps the opt-in
    const again = mountConfigured();
    expect(again.exports_._pushStore.subscriptions[makeSub(1).endpoint].lightning.lon).toBe(-105.27);

    expect((await optIn(app, 9, HOME)).statusCode).toBe(404); // unknown subscription
    expect((await optIn(app, 1, { lat: 99, lon: 0 })).statusCode).toBe(400);
    const off = await callRoute(app, 'POST', '/api/push/lightning/prefs', {
      endpoint: makeSub(1).endpoint,
      lightning: null,
    });
    expect(off.body).toEqual({ ok: true, lightning: null });
    expect(exports_._pushStore.subscriptions[makeSub(1).endpoint].lightning).toBeUndefined();
  });

  it('sends only to opted-in subscriptions whose own radius the strike falls inside', async () => {
    const { app, webpushMock } = await setup();
    await optIn(app, 1, HOME); // the reporting station
    await optIn(app, 2, FAR); // another user, on another continent
    // sub 3 is subscribed (space weather) but not opted in to lightning

    const res = await callRoute(app, 'POST', '/api/push/lightning', {
      endpoint: makeSub(1).endpoint,
      level: 'alarm',
      strike: strikeNear(HOME, 12, 45),
      relay: true,
    });
    expect(res.body).toMatchObject({ mode: 'targeted', inRange: 1, sent: 1 });
    const [sub, json] = webpushMock.sendNotification.mock.calls[0];
    expect(sub.endpoint).toBe(makeSub(1).endpoint);
    expect(JSON.parse(json)).toEqual({
      title: 'Lightning ALARM',
      body: 'Nearest strike 12 km NE · antenna relay engaged',
      tag: 'ohc-lightning',
    });
  });

  it('computes level and distance for each recipient, and keeps the relay text to the caller', async () => {
    const { app, webpushMock } = await setup();
    const NEAR = { lat: HOME.lat, lon: HOME.lon + 0.4 }; // ~34 km east of HOME
    await optIn(app, 1, HOME);
    await optIn(app, 2, NEAR);
    const strike = strikeNear(HOME, 10, 270); // 10 km west of HOME → ~44 km from NEAR
    await callRoute(app, 'POST', '/api/push/lightning', {
      endpoint: makeSub(1).endpoint,
      level: 'alarm',
      strike,
      relay: true,
    });
    const byEndpoint = Object.fromEntries(
      webpushMock.sendNotification.mock.calls.map(([s, j]) => [s.endpoint, JSON.parse(j)]),
    );
    expect(byEndpoint[makeSub(1).endpoint].title).toBe('Lightning ALARM');
    expect(byEndpoint[makeSub(1).endpoint].body).toMatch(/antenna relay engaged/);
    expect(byEndpoint[makeSub(2).endpoint].title).toBe('Lightning warning');
    expect(byEndpoint[makeSub(2).endpoint].body).toMatch(/^Nearest strike 4\d km W$/);
  });

  it('throttles per subscription: escalation and halving pass, repeats do not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
      const { app, webpushMock } = await setup();
      await optIn(app, 1, HOME);
      const post = (km) =>
        callRoute(app, 'POST', '/api/push/lightning', {
          endpoint: makeSub(1).endpoint,
          level: 'warn',
          strike: strikeNear(HOME, km),
        });
      expect((await post(40)).body.sent).toBe(1); // warn
      vi.setSystemTime(new Date('2026-07-01T12:00:30Z'));
      expect((await post(38)).body.skipped).toBe(1); // same level, not halved
      expect((await post(20)).body.sent).toBe(1); // escalates to alarm
      vi.setSystemTime(new Date('2026-07-01T12:01:30Z'));
      expect((await post(9)).body.skipped).toBe(1); // halved, but < 2 min after the last push
      vi.setSystemTime(new Date('2026-07-01T12:03:00Z'));
      expect((await post(9)).body.sent).toBe(1);
      expect(JSON.parse(webpushMock.sendNotification.mock.calls.at(-1)[1]).title).toBe('Lightning closer');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses callers that are not opted in, stale strikes, and garbage', async () => {
    const { app, webpushMock } = await setup();
    await optIn(app, 1, HOME);
    const notOpted = await callRoute(app, 'POST', '/api/push/lightning', {
      endpoint: makeSub(3).endpoint,
      level: 'alarm',
      strike: strikeNear(HOME, 5),
    });
    expect(notOpted.statusCode).toBe(403);
    const stale = await callRoute(app, 'POST', '/api/push/lightning', {
      endpoint: makeSub(1).endpoint,
      level: 'alarm',
      strike: { ...strikeNear(HOME, 5), timestamp: Date.now() - 60 * 60 * 1000 },
    });
    expect(stale.statusCode).toBe(400);
    expect((await callRoute(app, 'POST', '/api/push/lightning', { level: 'storm' })).statusCode).toBe(400);
    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it('all-clear and simulated strikes go to the caller only', async () => {
    const { app, webpushMock } = await setup();
    await optIn(app, 1, HOME);
    await optIn(app, 2, HOME); // a neighbour at the same place
    const sim = await callRoute(app, 'POST', '/api/push/lightning', {
      endpoint: makeSub(1).endpoint,
      level: 'alarm',
      simulated: true,
      strike: strikeNear(HOME, 8, 90),
    });
    expect(sim.body).toMatchObject({ mode: 'self', sent: 1 });
    expect(JSON.parse(webpushMock.sendNotification.mock.calls[0][1]).body).toBe(
      'Nearest strike 8.0 km E · test strike',
    );
    const clear = await callRoute(app, 'POST', '/api/push/lightning', {
      endpoint: makeSub(1).endpoint,
      level: 'clear',
      relay: false,
    });
    expect(clear.body).toMatchObject({ mode: 'self', sent: 1 });
    expect(webpushMock.sendNotification.mock.calls.map(([s]) => s.endpoint)).toEqual([
      makeSub(1).endpoint,
      makeSub(1).endpoint,
    ]);
  });

  it('rate-limits strike reports per client', async () => {
    const { app } = await setup();
    await optIn(app, 1, HOME);
    let last;
    for (let i = 0; i < 31; i++) {
      last = await callRoute(app, 'POST', '/api/push/lightning', { endpoint: makeSub(1).endpoint, level: 'clear' });
    }
    expect(last.statusCode).toBe(429);
  });

  it('PUSH_LIGHTNING_BROADCAST override: the old broadcast to every subscriber', async () => {
    process.env.PUSH_LIGHTNING_BROADCAST = 'true';
    const { app, webpushMock } = await setup();
    const key = await callRoute(app, 'GET', '/api/push/vapid-key');
    expect(key.body.lightningBroadcast).toBe(true);
    const res = await callRoute(app, 'POST', '/api/push/lightning', {
      level: 'alarm',
      distanceKm: 12.4,
      bearingDeg: 45,
      relay: true,
      title: 'ignored free text',
    });
    expect(res.body).toMatchObject({ mode: 'broadcast', sent: 3 });
    expect(JSON.parse(webpushMock.sendNotification.mock.calls[0][1])).toEqual({
      title: 'Lightning ALARM',
      body: 'Nearest strike 12 km NE · antenna relay engaged',
      tag: 'ohc-lightning',
    });
    const again = await callRoute(app, 'POST', '/api/push/lightning', { level: 'alarm', distanceKm: 8 });
    expect(again.body.skipped).toBe(true);
  });

  describe("verification against the server's own feed", () => {
    it('runs the feed only while some subscription has opted in, watching those areas', async () => {
      const { app } = await setup();
      expect(feedMock.setActive).toHaveBeenLastCalledWith(false);
      await optIn(app, 1, HOME);
      expect(feedMock.setActive).toHaveBeenLastCalledWith(true);
      expect(feedMock.setWatchAreas).toHaveBeenLastCalledWith([{ lat: 40, lon: -105, radiusKm: 50 }]);
      await callRoute(app, 'POST', '/api/push/lightning/prefs', { endpoint: makeSub(1).endpoint, lightning: null });
      expect(feedMock.setActive).toHaveBeenLastCalledWith(false);
      await optIn(app, 2, HOME);
      await callRoute(app, 'POST', '/api/push/unsubscribe', { endpoint: makeSub(2).endpoint });
      expect(feedMock.setActive).toHaveBeenLastCalledWith(false);
    });

    it('an unverifiable (fake) report reaches the sender only', async () => {
      const { app, webpushMock } = await setup();
      await optIn(app, 1, HOME);
      await optIn(app, 2, HOME); // neighbour who would otherwise be warned
      feedMock.seen(null);
      const res = await callRoute(app, 'POST', '/api/push/lightning', {
        endpoint: makeSub(1).endpoint,
        level: 'alarm',
        strike: strikeNear(HOME, 10),
      });
      expect(res.body).toMatchObject({ mode: 'self-unverified', sent: 1 });
      expect(webpushMock.sendNotification.mock.calls.map(([s]) => s.endpoint)).toEqual([makeSub(1).endpoint]);
    });

    it('targets from the strike as the server saw it, not as reported', async () => {
      const { app, webpushMock } = await setup();
      await optIn(app, 1, HOME);
      await optIn(app, 2, FAR);
      // Reported 10 km from HOME, but the matching strike the server saw is near FAR
      feedMock.seen({ ...strikeNear(FAR, 5), timestamp: Date.now() });
      const res = await callRoute(app, 'POST', '/api/push/lightning', {
        endpoint: makeSub(1).endpoint,
        level: 'alarm',
        strike: strikeNear(HOME, 10),
      });
      expect(res.body).toMatchObject({ mode: 'targeted', verified: true, inRange: 1 });
      expect(webpushMock.sendNotification.mock.calls.map(([s]) => s.endpoint)).toEqual([makeSub(2).endpoint]);
    });

    it('the broadcast override needs no feed', async () => {
      process.env.PUSH_LIGHTNING_BROADCAST = 'true';
      const { app } = await setup();
      await optIn(app, 1, HOME);
      expect(feedMock.setActive).toHaveBeenLastCalledWith(false);
    });
  });
});
