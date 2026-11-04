/**
 * Tests for server/routes/mqtt-publish.js — the optional outbound MQTT
 * publisher. Uses a fake mqtt client (ctx._mqttLib seam) and a stubbed
 * ctx.fetch for the two local endpoints it reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const route = require('./mqtt-publish.js');

function fakeApp() {
  const routes = {};
  return { get: (path, handler) => (routes[path] = handler), routes };
}

function fakeMqtt() {
  const client = new EventEmitter();
  client.connected = false;
  client.published = [];
  client.publish = vi.fn((topic, payload, opts) =>
    client.published.push({ topic, payload: JSON.parse(payload), opts }),
  );
  client.end = vi.fn();
  return { client, connect: vi.fn(() => client) };
}

const indices = { sfi: { current: 150 }, kp: { current: 3 }, ssn: { current: 90 }, bz: { current: -1 } };
const openings = {
  generated_at: 'g',
  warming: false,
  openings: [{ band: '20m', from_continent: 'EU', to_continent: 'NA', factor: 4, shortCount: 9 }],
  zone_openings: [],
};

function makeCtx(mqttLib) {
  const fetch = vi.fn(async (url) => {
    if (url.endsWith('/api/solar-indices')) return { ok: true, json: async () => indices };
    if (url.endsWith('/api/band-openings')) return { ok: true, json: async () => openings };
    return { ok: false };
  });
  return {
    fetch,
    PORT: 3000,
    APP_VERSION: '26.10.1',
    logInfo: vi.fn(),
    logDebug: vi.fn(),
    logErrorOnce: vi.fn(),
    n0nbhCache: { data: { solarData: { aIndex: '7', xray: 'C1.0' } } },
    refreshSwpcAlerts: vi.fn(async () => [
      { productId: 'K05W', serial: '1', title: 'Watch', scale: { band: 'G', level: 1 } },
    ]),
    onSwpcAlertsRefreshed: vi.fn(),
    getSubsystemsHealth: () => ({ aggregate: 'ok', rbn: { status: 'up' } }),
    _mqttLib: mqttLib,
  };
}

const envBackup = { ...process.env };
beforeEach(() => {
  vi.useFakeTimers();
  process.env.MQTT_PUBLISH_URL = 'mqtt://broker.test:1883';
  process.env.MQTT_PUBLISH_PREFIX = 'shack';
  process.env.MQTT_PUBLISH_HA_DISCOVERY = 'true';
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...envBackup };
});

describe('mqtt-publish route', () => {
  it('stays dormant without MQTT_PUBLISH_URL and still serves /api/mqtt/status', () => {
    delete process.env.MQTT_PUBLISH_URL;
    const app = fakeApp();
    const lib = fakeMqtt();
    route(app, makeCtx(lib));
    expect(lib.connect).not.toHaveBeenCalled();
    const res = { set: vi.fn(), json: vi.fn() };
    app.routes['/api/mqtt/status']({}, res);
    expect(res.json.mock.calls[0][0]).toMatchObject({ enabled: false, connected: false });
  });

  it('publishes HA discovery + all retained topics on connect, then only on change', async () => {
    const app = fakeApp();
    const lib = fakeMqtt();
    const ctx = makeCtx(lib);
    route(app, ctx);
    expect(lib.connect).toHaveBeenCalledWith(
      'mqtt://broker.test:1883',
      expect.objectContaining({ will: expect.objectContaining({ topic: 'shack/status', retain: true }) }),
    );

    lib.client.connected = true;
    lib.client.emit('connect');
    await vi.advanceTimersByTimeAsync(10);

    const topics = lib.client.published.map((p) => p.topic);
    expect(topics.filter((t) => t.startsWith('homeassistant/sensor/openhamclock_')).length).toBeGreaterThanOrEqual(10);
    for (const t of ['shack/status', 'shack/spaceweather', 'shack/band-openings', 'shack/alerts/swpc']) {
      expect(topics).toContain(t);
    }
    expect(lib.client.published.every((p) => p.opts.retain === true)).toBe(true);
    const sw = lib.client.published.find((p) => p.topic === 'shack/spaceweather').payload;
    expect(sw).toMatchObject({ sfi: 150, kp: 3, ssn: 90, a_index: 7, xray_class: 'C1.0' });
    expect(lib.client.published.find((p) => p.topic === 'shack/band-openings').payload.count).toBe(1);
    expect(lib.client.published.find((p) => p.topic === 'shack/status').payload.state).toBe('online');

    // Next minute tick: nothing changed → nothing re-published.
    const before = lib.client.published.length;
    await vi.advanceTimersByTimeAsync(60 * 1000 + 50);
    expect(lib.client.published.length).toBe(before);

    // Data changes → the changed topic is published again (one minute later).
    indices.sfi.current = 160;
    await vi.advanceTimersByTimeAsync(60 * 1000 + 50);
    const again = lib.client.published.slice(before);
    expect(again.map((p) => p.topic)).toEqual(['shack/spaceweather']);
    expect(again[0].payload.sfi).toBe(160);

    // Status endpoint reflects connection + last publish times.
    const res = { set: vi.fn(), json: vi.fn() };
    app.routes['/api/mqtt/status']({}, res);
    const status = res.json.mock.calls[0][0];
    expect(status).toMatchObject({ enabled: true, connected: true, prefix: 'shack', haDiscovery: true });
    expect(Object.keys(status.lastPublish)).toContain('shack/spaceweather');
  });

  it('pushes fresh SWPC alerts through the registered listener', async () => {
    const app = fakeApp();
    const lib = fakeMqtt();
    const ctx = makeCtx(lib);
    route(app, ctx);
    lib.client.connected = true;
    const listener = ctx.onSwpcAlertsRefreshed.mock.calls[0][0];
    listener([{ productId: 'A', serial: '9', title: 'Alert', scale: { band: 'R', level: 3 } }]);
    const pub = lib.client.published.find((p) => p.topic === 'shack/alerts/swpc');
    expect(pub.payload.max_level).toBe(3);
  });
});
