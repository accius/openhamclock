/**
 * Unit tests for server/utils/push-helpers.js — the pure decision logic
 * behind the Web Push feature (subscription store dedupe/cap/prune, severe
 * SWPC alert selection, payload building).
 */

import { describe, expect, it } from 'vitest';

const helpers = require('./push-helpers.js');

const NOW = Date.parse('2026-08-28T12:00:00Z');

function makeSub(n = 1) {
  return {
    endpoint: `https://push.example.com/sub/${n}`,
    expirationTime: null,
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  };
}

function makeAlert(overrides = {}) {
  return {
    productId: 'ALTK07',
    serial: 123,
    issueTime: new Date(NOW - 5 * 60 * 1000).toISOString(),
    type: 'ALERT',
    title: 'Geomagnetic K-index of 7',
    scale: { band: 'G', level: 3, text: 'G3 - Strong' },
    message: '...',
    ...overrides,
  };
}

function emptyStore() {
  return { subscriptions: {}, pushedAlerts: {} };
}

describe('isValidSubscription', () => {
  it('accepts a well-formed https subscription', () => {
    expect(helpers.isValidSubscription(makeSub())).toBe(true);
  });

  it('rejects malformed shapes', () => {
    expect(helpers.isValidSubscription(null)).toBe(false);
    expect(helpers.isValidSubscription({})).toBe(false);
    expect(helpers.isValidSubscription({ endpoint: 'http://insecure.example', keys: makeSub().keys })).toBe(false);
    expect(helpers.isValidSubscription({ endpoint: makeSub().endpoint })).toBe(false);
    expect(helpers.isValidSubscription({ endpoint: makeSub().endpoint, keys: { p256dh: 'x' } })).toBe(false);
    expect(
      helpers.isValidSubscription({ endpoint: `https://x.example/${'a'.repeat(2050)}`, keys: makeSub().keys }),
    ).toBe(false);
  });
});

describe('addSubscription / removeSubscription', () => {
  it('stores a subscription keyed by endpoint', () => {
    const store = emptyStore();
    expect(helpers.addSubscription(store, makeSub(), 10, NOW)).toEqual({ ok: true });
    expect(Object.keys(store.subscriptions)).toEqual([makeSub().endpoint]);
    expect(store.subscriptions[makeSub().endpoint].addedAt).toBe(NOW);
  });

  it('dedupes re-subscription of the same endpoint, keeping original addedAt', () => {
    const store = emptyStore();
    helpers.addSubscription(store, makeSub(), 10, NOW);
    helpers.addSubscription(store, makeSub(), 10, NOW + 5000);
    expect(Object.keys(store.subscriptions)).toHaveLength(1);
    expect(store.subscriptions[makeSub().endpoint].addedAt).toBe(NOW);
  });

  it('enforces the cap for NEW endpoints but allows refreshing existing ones', () => {
    const store = emptyStore();
    helpers.addSubscription(store, makeSub(1), 2, NOW);
    helpers.addSubscription(store, makeSub(2), 2, NOW);
    expect(helpers.addSubscription(store, makeSub(3), 2, NOW)).toEqual({ ok: false, reason: 'full' });
    expect(helpers.addSubscription(store, makeSub(2), 2, NOW)).toEqual({ ok: true });
  });

  it('rejects invalid subscriptions', () => {
    const store = emptyStore();
    expect(helpers.addSubscription(store, { nope: true }, 10, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(Object.keys(store.subscriptions)).toHaveLength(0);
  });

  it('removes by endpoint and reports whether anything was removed', () => {
    const store = emptyStore();
    helpers.addSubscription(store, makeSub(), 10, NOW);
    expect(helpers.removeSubscription(store, makeSub().endpoint)).toBe(true);
    expect(helpers.removeSubscription(store, makeSub().endpoint)).toBe(false);
    expect(helpers.removeSubscription(store, undefined)).toBe(false);
    expect(Object.keys(store.subscriptions)).toHaveLength(0);
  });
});

describe('selectNewSevereAlerts', () => {
  it('selects fresh severe alerts not yet pushed', () => {
    const alerts = [makeAlert()];
    expect(helpers.selectNewSevereAlerts(alerts, {}, NOW)).toHaveLength(1);
  });

  it('skips alerts below scale level 2 (same threshold as the in-app feed)', () => {
    const alerts = [makeAlert({ scale: { band: 'G', level: 1, text: 'G1 - Minor' } }), makeAlert({ scale: null })];
    expect(helpers.selectNewSevereAlerts(alerts, {}, NOW)).toHaveLength(0);
  });

  it('skips alerts already recorded in pushedKeys (dedupe by product/serial)', () => {
    const alert = makeAlert();
    const pushed = { [helpers.alertDedupeKey(alert)]: NOW - 1000 };
    expect(helpers.selectNewSevereAlerts([alert], pushed, NOW)).toHaveLength(0);
  });

  it('skips stale alerts (cold-start protection) and missing issueTime', () => {
    const old = makeAlert({ issueTime: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() });
    const noTime = makeAlert({ issueTime: null });
    expect(helpers.selectNewSevereAlerts([old, noTime], {}, NOW)).toHaveLength(0);
  });

  it('handles non-array input', () => {
    expect(helpers.selectNewSevereAlerts(null, {}, NOW)).toEqual([]);
  });
});

describe('prunePushedKeys', () => {
  it('drops keys past retention and keeps recent ones', () => {
    const keys = {
      old: NOW - helpers.PUSHED_KEY_RETENTION_MS - 1000,
      recent: NOW - 1000,
      garbage: 'not-a-number',
    };
    expect(helpers.prunePushedKeys(keys, NOW)).toBe(2);
    expect(Object.keys(keys)).toEqual(['recent']);
  });
});

describe('buildSwpcPushPayload', () => {
  it('builds title from scale text and body from type + headline', () => {
    expect(helpers.buildSwpcPushPayload(makeAlert())).toEqual({
      title: 'Space Weather: G3 - Strong',
      body: 'ALERT: Geomagnetic K-index of 7',
      tag: 'ohc-push-swpc',
    });
  });

  it('degrades gracefully with missing fields and truncates long bodies', () => {
    const bare = helpers.buildSwpcPushPayload({});
    expect(bare.title).toBe('Space Weather Alert');
    expect(bare.tag).toBe('ohc-push-swpc');

    const long = helpers.buildSwpcPushPayload(makeAlert({ title: 'x'.repeat(300) }));
    expect(long.body.length).toBeLessThanOrEqual(140);
    expect(long.body.endsWith('…')).toBe(true);
  });
});

describe('lightning guard push helpers', () => {
  it('builds payloads from validated numbers only', () => {
    expect(helpers.buildLightningPushPayload({ level: 'warn', distanceKm: 41, bearingDeg: 270 })).toEqual({
      title: 'Lightning warning',
      body: 'Nearest strike 41 km W',
      tag: 'ohc-lightning',
    });
    expect(helpers.buildLightningPushPayload({ level: 'alarm', distanceKm: 8, imperial: true }).body).toBe(
      'Nearest strike 5.0 mi',
    );
    expect(helpers.buildLightningPushPayload({ level: 'clear', relay: false })).toEqual({
      title: 'Lightning all clear',
      body: 'No strikes nearby for the all-clear time · antenna relay released',
      tag: 'ohc-lightning',
    });
    expect(helpers.buildLightningPushPayload({ level: 'alarm', distanceKm: 'abc' }).body).toBe('');
    expect(helpers.buildLightningPushPayload({ level: 'boom' })).toBeNull();
    expect(helpers.buildLightningPushPayload(null)).toBeNull();
  });

  it('throttles: minimum gap, and no repeat of the same level within ten minutes', () => {
    expect(helpers.shouldPushLightning(null, 'warn', NOW)).toBe(true);
    const last = { at: NOW, level: 'warn' };
    expect(helpers.shouldPushLightning(last, 'alarm', NOW + 5000)).toBe(false);
    expect(helpers.shouldPushLightning(last, 'alarm', NOW + helpers.LIGHTNING_PUSH_MIN_GAP_MS)).toBe(true);
    expect(helpers.shouldPushLightning(last, 'warn', NOW + 5 * 60 * 1000)).toBe(false);
    expect(helpers.shouldPushLightning(last, 'warn', NOW + helpers.LIGHTNING_PUSH_REPEAT_MS)).toBe(true);
  });
});

describe('targeted lightning push helpers', () => {
  const sub = (n) => ({
    endpoint: `https://push.example.com/sub/${n}`,
    keys: { p256dh: 'p', auth: 'a' },
  });

  it('sanitizes prefs (rounded location, clamped radii, alarm inside warn)', () => {
    expect(helpers.sanitizeLightningPrefs({ lat: 40.019, lon: -105.271, warnKm: 900, alarmKm: 999 })).toEqual({
      lat: 40.02,
      lon: -105.27,
      warnKm: 500,
      alarmKm: 500,
      imperial: false,
    });
    expect(helpers.sanitizeLightningPrefs({ lat: 'x', lon: 1 })).toBeNull();
    expect(helpers.sanitizeLightningPrefs(null)).toBeNull();
  });

  it('targets only opted-in subscriptions in range, nearest first, bounded', () => {
    const store = { subscriptions: {}, pushedAlerts: {} };
    for (const n of [1, 2, 3, 4]) helpers.addSubscription(store, sub(n), 10, NOW);
    helpers.setLightningPrefs(store, sub(1).endpoint, { lat: 40, lon: -105 });
    helpers.setLightningPrefs(store, sub(2).endpoint, { lat: 40.2, lon: -105 });
    helpers.setLightningPrefs(store, sub(3).endpoint, { lat: 10, lon: 10 });
    const t = helpers.lightningTargets(store, { lat: 40.21, lon: -105, timestamp: NOW });
    expect(t.map((x) => x.endpoint)).toEqual([sub(2).endpoint, sub(1).endpoint]);
    expect(t[0].level).toBe('alarm');
    expect(t[1].level).toBe('alarm'); // ~23 km
    expect(helpers.lightningTargets(store, { lat: 40.21, lon: -105, timestamp: NOW }, 1)).toHaveLength(1);
  });

  it('validates posted strikes', () => {
    expect(helpers.sanitizeStrike({ lat: 1, lon: 2, timestamp: NOW }, NOW)).toEqual({ lat: 1, lon: 2, timestamp: NOW });
    expect(helpers.sanitizeStrike({ lat: 1, lon: 2, timestamp: NOW - 20 * 60 * 1000 }, NOW)).toBeNull();
    expect(helpers.sanitizeStrike({ lat: 1, lon: 2, timestamp: NOW + 10 * 60 * 1000 }, NOW)).toBeNull();
    expect(helpers.sanitizeStrike({ lat: 100, lon: 2, timestamp: NOW }, NOW)).toBeNull();
  });

  it('per-subscription throttle', () => {
    const last = { at: NOW, level: 'warn', km: 40 };
    expect(helpers.shouldPushLightningTo(null, 'warn', 40, NOW)).toBe(true);
    expect(helpers.shouldPushLightningTo(last, 'alarm', 20, NOW + 5000)).toBe(false); // min gap
    expect(helpers.shouldPushLightningTo(last, 'alarm', 20, NOW + 30000)).toBe(true); // escalation
    expect(helpers.shouldPushLightningTo(last, 'warn', 30, NOW + 5 * 60000)).toBe(false);
    expect(helpers.shouldPushLightningTo(last, 'warn', 19, NOW + 60000)).toBe(false); // halved, < 2 min
    expect(helpers.shouldPushLightningTo(last, 'warn', 19, NOW + 3 * 60000)).toBe(true);
    expect(helpers.shouldPushLightningTo(last, 'warn', 39, NOW + 10 * 60000)).toBe(true); // repeat window over
  });

  it('keyed limiter is per key, windowed and bounded', () => {
    const allow = helpers.makeKeyedLimiter(2, 1000, 2);
    expect([allow('a', 0), allow('a', 1), allow('a', 2)]).toEqual([true, true, false]);
    expect(allow('b', 2)).toBe(true);
    expect(allow('a', 1000)).toBe(true); // new window
    allow('c', 1001); // evicts the oldest key
    expect(allow('b', 1002)).toBe(true);
  });
});
