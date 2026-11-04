// @vitest-environment node
/**
 * kiwi-beacon-monitor plugin — descriptor, config handling and the local
 * read endpoints, without a Kiwi (the connection loop is covered by
 * lib/kiwi-connection.test.js against a mock receiver, the slot/SNR maths
 * by lib/beacon-sampler.test.js).
 */
import { describe, it, expect, afterEach } from 'vitest';
import plugin from './kiwi-beacon-monitor.js';

const fakeApp = () => {
  const routes = {};
  return { routes, get: (path, fn) => (routes[path] = fn) };
};
const fakeRes = () => {
  const r = { body: null, code: 200 };
  r.json = (b) => ((r.body = b), r);
  r.status = (c) => ((r.code = c), r);
  return r;
};

describe('kiwi-beacon-monitor descriptor', () => {
  let inst = null;
  afterEach(() => {
    if (inst) inst.disconnect();
    inst = null;
  });

  it('is a monitor-category plugin on the beaconMonitor config section', () => {
    expect(plugin).toMatchObject({ id: 'kiwi-beacon-monitor', category: 'monitor', configKey: 'beaconMonitor' });
    expect(typeof plugin.create).toBe('function');
    expect(typeof plugin.registerRoutes).toBe('function');
  });

  it('reads host/port/bands/station identity from config and reports them in getStatus()', () => {
    const config = {
      beaconMonitor: {
        enabled: true,
        host: 'kiwi.example.org',
        port: '8074',
        bands: '10m, 20m',
        callsign: 'ke8plm',
        grid: 'EN82ab',
        lat: '42.1',
        lon: '-83.5',
        ohcUrl: 'http://192.168.1.50:8080/',
        serverForward: true,
      },
    };
    inst = plugin.create(config, {});
    const st = inst.getStatus();
    expect(st).toMatchObject({
      enabled: true,
      running: false,
      connected: false,
      host: 'kiwi.example.org',
      port: 8074,
      bands: ['20m', '10m'],
      station: { callsign: 'KE8PLM', grid: 'EN82ab', lat: 42.1, lon: -83.5 },
      kiwi: { id: 'kiwi.example.org:8074' },
      serverForward: true,
      ohcUrl: 'http://192.168.1.50:8080',
    });
    // Forwarding follows the live config object (settings save without restart).
    config.beaconMonitor = { ...config.beaconMonitor, serverForward: false };
    expect(inst.getStatus()).toMatchObject({ serverForward: false, ohcUrl: undefined });
  });

  it('refuses to start without a host and stays idle', () => {
    inst = plugin.create({ beaconMonitor: { enabled: true } }, {});
    inst.connect();
    expect(inst.getStatus()).toMatchObject({ running: false, connected: false, host: '' });
  });

  it('serves status and measurements from its local ring buffer', () => {
    const app = fakeApp();
    plugin.registerRoutes(app);
    expect(Object.keys(app.routes)).toEqual(['/api/beacon-monitor/status', '/api/beacon-monitor/measurements']);

    // No instance yet → disabled.
    let res = fakeRes();
    app.routes['/api/beacon-monitor/measurements']({ query: {} }, res);
    expect(res.body).toMatchObject({ enabled: false, running: false, measurements: [] });

    inst = plugin.create({ beaconMonitor: { enabled: true, host: 'h', bands: ['20m'] } }, {});
    // Seed a measurement straight into the sampler ring buffer.
    const now = Date.now();
    inst._sampler.measurements.push(
      { beacon: '4U1UN', band: '20m', mhz: 14.1, t: now - 60_000, snrDb: 12, levelDbm: -90, noiseDbm: -102, n: 50 },
      { beacon: 'OH2B', band: '17m', mhz: 18.11, t: now - 30_000, snrDb: 3, levelDbm: -99, noiseDbm: -102, n: 50 },
    );
    res = fakeRes();
    app.routes['/api/beacon-monitor/measurements']({ query: { hours: '1' } }, res);
    expect(res.body.measurements).toHaveLength(2);
    expect(res.body.kiwi).toEqual({ id: 'h:8073', host: 'h', port: 8073, name: undefined });

    res = fakeRes();
    app.routes['/api/beacon-monitor/measurements']({ query: { band: '17M' } }, res);
    expect(res.body.measurements.map((m) => m.beacon)).toEqual(['OH2B']);

    res = fakeRes();
    app.routes['/api/beacon-monitor/measurements']({ query: { since: String(now - 45_000) } }, res);
    expect(res.body.measurements.map((m) => m.beacon)).toEqual(['OH2B']);

    res = fakeRes();
    app.routes['/api/beacon-monitor/status']({ query: {} }, res);
    expect(res.body).toMatchObject({ enabled: true, host: 'h', port: 8073, bands: ['20m'] });
  });
});
