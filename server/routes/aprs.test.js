/**
 * Tests for server/routes/aprs.js — APRS telemetry store.
 *
 * Regression: the telemetryData / telemetryDefs maps and their size limits
 * were lost in a refactor while every use survived, so each T# frame threw a
 * ReferenceError (swallowed by parseAprsTelemetry's try/catch) and
 * GET /api/aprs/telemetry 500'd. Caught by ESLint no-undef.
 *
 * The route module is mounted on a minimal fake Express app; handlers are
 * invoked directly with stub req/res objects. No network: APRS_ENABLED is
 * unset, so no APRS-IS socket is opened.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mountAprs = require('./aprs.js');

function makeApp() {
  const routes = {};
  const register =
    (method) =>
    (path, ...handlers) => {
      routes[`${method} ${path}`] = handlers[handlers.length - 1];
    };
  return { routes, get: register('GET'), post: register('POST') };
}

function call(handler, { body = {}, query = {} } = {}) {
  let statusCode = 200;
  let payload;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      payload = data;
      return res;
    },
  };
  handler({ body, query }, res);
  return { statusCode, payload };
}

describe('APRS telemetry', () => {
  let app;

  beforeAll(() => {
    // The module starts a cleanup setInterval on mount; keep it off the real clock.
    vi.useFakeTimers();
    app = makeApp();
    const noop = () => {};
    mountAprs(app, {
      CONFIG: {},
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
    });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('stores T# frames from a local TNC and serves them with PARM labels', () => {
    const local = app.routes['POST /api/aprs/local'];
    const telemetry = app.routes['GET /api/aprs/telemetry'];

    const post = call(local, {
      body: {
        packets: [
          { source: 'N0CALL-11', destination: 'APRS', info: 'T#005,199,000,255,073,123,01101001' },
          { source: 'N0CALL-11', destination: 'APRS', info: ':N0CALL-11:PARM.Battery,Btemp,ATemp,Pres,Alt' },
        ],
      },
    });
    expect(post.statusCode).toBe(200);

    const one = call(telemetry, { query: { callsign: 'n0call' } });
    expect(one.statusCode).toBe(200);
    expect(one.payload).toMatchObject({
      call: 'N0CALL',
      seq: '005',
      values: [199, 0, 255, 73, 123],
      bits: '01101001',
      source: 'local-tnc',
      params: ['Battery', 'Btemp', 'ATemp', 'Pres', 'Alt'],
    });
    expect(one.payload.history).toHaveLength(1);

    const all = call(telemetry);
    expect(all.payload.count).toBe(1);
  });

  it('reports unknown callsigns instead of throwing', () => {
    const telemetry = app.routes['GET /api/aprs/telemetry'];
    const res = call(telemetry, { query: { callsign: 'NOBODY' } });
    expect(res.payload).toEqual({ error: 'No telemetry for this callsign' });
  });
});

describe('APRS net roster boot id and generation', () => {
  const mount = () => {
    const app = makeApp();
    const noop = () => {};
    mountAprs(app, {
      CONFIG: {},
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
    });
    return app;
  };

  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  it('bumps the generation on check-in and check-out and keeps the boot id', () => {
    const app = mount();
    const r0 = call(app.routes['GET /api/aprs/net']).payload;
    expect(r0.bootId).toMatch(/^[0-9a-f]{16}$/);
    call(app.routes['POST /api/aprs/net/checkin'], { body: { callsign: 'W1AW', netName: 'ARES' } });
    const r1 = call(app.routes['GET /api/aprs/net']).payload;
    expect(r1.generation).toBe(r0.generation + 1);
    call(app.routes['POST /api/aprs/net/checkout'], { body: { callsign: 'W1AW' } });
    call(app.routes['POST /api/aprs/net/checkout'], { body: { callsign: 'NOBODY' } }); // no change
    const r2 = call(app.routes['GET /api/aprs/net']).payload;
    expect(r2.generation).toBe(r1.generation + 1);
    expect(r2.bootId).toBe(r0.bootId);
  });

  it('a restart (new mount) gets a new boot id', () => {
    const a = call(mount().routes['GET /api/aprs/net']).payload.bootId;
    const b = call(mount().routes['GET /api/aprs/net']).payload.bootId;
    expect(a).not.toBe(b);
  });
});

describe('APRS net roster addresses (#1237, #1238, #1239)', () => {
  let app;
  beforeAll(() => {
    vi.useFakeTimers();
    app = makeApp();
    const noop = () => {};
    mountAprs(app, {
      CONFIG: {},
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
    });
  });
  afterAll(() => vi.useRealTimers());

  const rf = (source, info) => call(app.routes['POST /api/aprs/local'], { body: { packets: [{ source, info }] } });
  const roster = () => call(app.routes['GET /api/aprs/net']).payload.roster;

  it('records the address each check-in went to, one entry per address', () => {
    rf('KE8PLM-9', ':EMCOMM   :CQ OHNET at home{01');
    rf('KE8PLM-9', ':W8ROC    :CQ HAMCO at station 1{02');
    rf('N8TAG-7', ':W8ROC    :CQ HAMCO{03');
    const r = roster();
    expect(r.map((op) => `${op.alias}|${op.call}|${op.netName}`).sort()).toEqual([
      'EMCOMM|KE8PLM-9|OHNET',
      'W8ROC|KE8PLM-9|HAMCO',
      'W8ROC|N8TAG-7|HAMCO',
    ]);
  });

  it('a check-out to one address leaves the other', () => {
    rf('KE8PLM-9', ':W8ROC    :U HAMCO{04');
    expect(
      roster()
        .filter((op) => op.call === 'KE8PLM-9')
        .map((op) => op.alias),
    ).toEqual(['EMCOMM']);
  });

  it('removing by address takes only that entry; without one, every entry for the call', () => {
    const out = app.routes['POST /api/aprs/net/checkout'];
    rf('KE8PLM-9', ':W8ROC    :CQ HAMCO{05');
    expect(call(out, { body: { callsign: 'ke8plm-9', alias: 'w8roc' } }).payload).toEqual({ ok: true, removed: 1 });
    expect(roster().some((op) => op.call === 'KE8PLM-9' && op.alias === 'W8ROC')).toBe(false);
    rf('KE8PLM-9', ':W8ROC    :CQ HAMCO{06');
    expect(call(out, { body: { callsign: 'KE8PLM-9' } }).payload.removed).toBe(2);
    expect(roster().some((op) => op.call === 'KE8PLM-9')).toBe(false);
  });

  it('manual check-ins default to EMCOMM and reject a bad address', () => {
    const inn = app.routes['POST /api/aprs/net/checkin'];
    call(inn, { body: { callsign: 'w1aw', netName: 'ARES' } });
    expect(roster().find((op) => op.call === 'W1AW').alias).toBe('EMCOMM');
    expect(call(inn, { body: { callsign: 'W1AW', netName: 'ARES', alias: 'not valid!' } }).statusCode).toBe(400);
  });
});

describe('POST /api/aprs/message recordOnly (#1243)', () => {
  it('records a message the browser already transmitted, without contacting rig-bridge', () => {
    vi.useFakeTimers();
    const app = makeApp();
    const noop = () => {};
    const fetch = vi.fn();
    mountAprs(app, {
      CONFIG: { callsign: 'k0cjh' },
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
      fetch,
    });
    let out;
    app.routes['POST /api/aprs/message'](
      { body: { to: 'n8tag', message: 'hi', recordOnly: true } },
      {
        status() {
          return this;
        },
        json(d) {
          out = d;
        },
      },
    );
    expect(out).toEqual({ ok: true, recorded: true });
    expect(fetch).not.toHaveBeenCalled();
    const hist = call(app.routes['GET /api/aprs/messages/history'], { query: { call: 'N8TAG' } }).payload;
    expect(hist.messages[0]).toMatchObject({ from: 'K0CJH', to: 'N8TAG', text: 'hi', direction: 'sent' });
    vi.useRealTimers();
  });
});

describe('per-viewer internet APRS: one connection, union filter', () => {
  const { EventEmitter } = require('events');
  const saved = {};
  let sockets;
  let app;

  // Stands in for net.Socket: records writes, connects at once
  class FakeSocket extends EventEmitter {
    constructor() {
      super();
      this.writes = [];
      this.destroyed = false;
    }
    setTimeout() {}
    connect(port, host, cb) {
      this.target = `${host}:${port}`;
      cb();
    }
    write(s) {
      this.writes.push(s);
    }
    destroy() {
      this.destroyed = true;
      this.emit('close');
    }
    feed(...lines) {
      this.emit('data', Buffer.from(lines.map((l) => `${l}\r\n`).join('')));
    }
  }

  const mount = () => {
    const a = makeApp();
    const noop = () => {};
    mountAprs(a, {
      CONFIG: { callsign: 'K0CJH' },
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
      createAprsSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    return a;
  };
  const get = (query, ip = '203.0.113.1') => {
    let statusCode = 200;
    let payload;
    const res = {
      status(c) {
        statusCode = c;
        return res;
      },
      json(d) {
        payload = d;
        return res;
      },
    };
    app.routes['GET /api/aprs/stations']({ query, headers: {}, ip }, res);
    return { statusCode, payload };
  };
  const OHIO = { lat: '41.4', lon: '-81.7', radius: '250' };
  const LONDON = { lat: '51.5', lon: '-0.1', radius: '250' };
  const filterWrites = (s) => s.writes.filter((w) => w.startsWith('#filter'));
  const advance = (ms) => vi.advanceTimersByTime(ms);

  beforeAll(() => {
    for (const k of ['APRS_ENABLED', 'APRS_FILTER']) saved[k] = process.env[k];
    process.env.APRS_ENABLED = 'true';
    delete process.env.APRS_FILTER;
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    app = mount();
  });
  afterEach(() => vi.useRealTimers());

  it('does not connect until a viewer asks, then logs in with that area', () => {
    expect(sockets).toHaveLength(0);
    const r = get(OHIO);
    expect(r.payload).toMatchObject({ enabled: true, connected: true, areaRegistered: true });
    expect(r.payload.area).toEqual({ lat: 41.4, lon: -81.7, radius: 250 });
    expect(sockets).toHaveLength(1);
    expect(sockets[0].writes.join('')).toBe('user K0CJH pass -1 vers OpenHamClock test filter r/41.5/-81.5/300\r\n');
  });

  it('changes the filter on the open socket, at most once per 30 s', () => {
    get(OHIO);
    const s = sockets[0];
    get(LONDON);
    get({ lat: '41.45', lon: '-81.65', radius: '250' }); // same term as OHIO
    expect(filterWrites(s)).toEqual([]); // inside the window
    advance(30000);
    expect(filterWrites(s)).toEqual(['#filter r/41.5/-81.5/300 r/51.5/0/300\r\n']);
    get(LONDON); // known area: nothing to send
    advance(60000);
    expect(filterWrites(s)).toHaveLength(1);
    expect(sockets).toHaveLength(1); // never a second connection
  });

  it('returns only the stations inside the viewer circle, plus local RF', () => {
    get(OHIO);
    sockets[0].feed(
      '# aprsc 2.1.19',
      'K8OHI-9>APRS,TCPIP*,qAC,T2USA:!4130.00N/08142.00W>Ohio mobile',
      'G4LON>APRS,TCPIP*,qAC,T2UK:!5130.00N/00007.00W-London home',
    );
    call(app.routes['POST /api/aprs/local'], {
      body: { packets: [{ source: 'VK2RF', info: '!3352.00S/15112.00E-Sydney RF' }] },
    });
    const ohio = get(OHIO).payload.stations.map((s) => s.ssid);
    expect(ohio.sort()).toEqual(['K8OHI-9', 'VK2RF']); // RF is always included
    expect(get({}).payload.count).toBe(3); // no area: everything, as before
    const rfOnly = get({ ...OHIO, internet: '0' }).payload;
    expect(rfOnly.stations.map((s) => s.ssid)).toEqual(['VK2RF']);
    expect(rfOnly.area).toBeUndefined();
  });

  it('rejects an invalid area and clamps the radius', () => {
    expect(get({ lat: '95', lon: '0' }).statusCode).toBe(400);
    expect(get({ lat: 'abc', lon: '0' }).statusCode).toBe(400);
    expect(get({ lat: '10', lon: '10', radius: '5000' }).payload.area.radius).toBe(1000);
    expect(get({ lat: '10', lon: '10', radius: '1' }).payload.area.radius).toBe(10);
  });

  it('expires areas nobody polls, then hangs up after 15 idle minutes', () => {
    get(OHIO);
    get(LONDON);
    advance(30000);
    const s = sockets[0];
    expect(filterWrites(s)).toHaveLength(1);
    // Ohio keeps polling, London stops: after 10 min London drops out
    for (let i = 0; i < 12; i++) {
      advance(60000);
      get(OHIO);
    }
    advance(30000);
    expect(filterWrites(s).at(-1)).toBe('#filter r/41.5/-81.5/300\r\n');
    // Ohio goes quiet too: the last filter stays (no empty #filter) ...
    advance(11 * 60000);
    expect(filterWrites(s).at(-1)).toBe('#filter r/41.5/-81.5/300\r\n');
    expect(s.destroyed).toBe(false);
    // ... until 15 min with no areas, then one hang-up and no reconnect
    advance(16 * 60000);
    expect(s.destroyed).toBe(true);
    advance(5 * 60000);
    expect(sockets).toHaveLength(1);
    // A viewer arriving later connects again straight away
    get(LONDON);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].writes.join('')).toContain('filter r/51.5/0/300');
  });

  it('limits how many new areas one IP can add', () => {
    for (let i = 0; i < 10; i++) {
      expect(get({ lat: String(i * 5), lon: '20' }).payload.areaRegistered).toBe(true);
    }
    expect(get({ lat: '70', lon: '20' }).payload.areaRegistered).toBe(false);
    expect(get({ lat: '70', lon: '20' }, '198.51.100.7').payload.areaRegistered).toBe(true);
    expect(get({ lat: '0', lon: '20' }).payload.areaRegistered).toBe(true); // known area: free
    advance(10 * 60000 + 1000);
    expect(get({ lat: '75', lon: '20' }).payload.areaRegistered).toBe(true);
  });
});

describe('per-viewer internet APRS with APRS_ENABLED off', () => {
  it('filters by area but registers nothing and opens no socket', () => {
    vi.useFakeTimers();
    const prev = process.env.APRS_ENABLED;
    delete process.env.APRS_ENABLED;
    const app = makeApp();
    const noop = () => {};
    const createAprsSocket = vi.fn();
    mountAprs(app, {
      CONFIG: {},
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
      createAprsSocket,
    });
    const r = call(app.routes['GET /api/aprs/stations'], { query: { lat: '41', lon: '-81' } });
    expect(r.payload).toMatchObject({ enabled: false, connected: false, areaRegistered: false });
    expect(createAprsSocket).not.toHaveBeenCalled();
    if (prev !== undefined) process.env.APRS_ENABLED = prev;
    vi.useRealTimers();
  });
});

describe('APRS-IS login needs a real callsign', () => {
  const { EventEmitter } = require('events');
  const saved = {};
  beforeAll(() => {
    for (const k of ['APRS_ENABLED', 'APRS_FILTER', 'APRS_LOGIN']) saved[k] = process.env[k];
    process.env.APRS_ENABLED = 'true';
    delete process.env.APRS_FILTER;
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    delete process.env.APRS_LOGIN;
    vi.useRealTimers();
  });

  const mount = (CONFIG) => {
    const app = makeApp();
    const noop = () => {};
    const writes = [];
    const createAprsSocket = vi.fn(() => {
      const s = new EventEmitter();
      Object.assign(s, {
        setTimeout() {},
        connect: (port, host, cb) => cb(),
        write: (w) => writes.push(w),
        destroy() {},
      });
      return s;
    });
    mountAprs(app, {
      CONFIG,
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
      createAprsSocket,
    });
    const r = call(app.routes['GET /api/aprs/stations'], { query: { lat: '41.4', lon: '-81.7' } });
    return { r, createAprsSocket, writes };
  };

  it.each([
    [{}],
    [{ callsign: 'N0CALL' }],
    [{ callsign: 'nocall' }],
    [{ callsign: 'GUEST' }],
    [{ callsign: 'N0CALL-9' }],
  ])('never logs in without one: %j', (CONFIG) => {
    const { r, createAprsSocket } = mount(CONFIG);
    expect(createAprsSocket).not.toHaveBeenCalled();
    expect(r.payload).toMatchObject({ enabled: false, reason: 'no-callsign', areaRegistered: false });
  });

  it('logs in as APRS_LOGIN (with SSID) over the station callsign', () => {
    process.env.APRS_LOGIN = 'w1abc-10';
    const { r, writes } = mount({ callsign: 'N0CALL' });
    expect(r.payload).toMatchObject({ enabled: true });
    expect(r.payload.reason).toBeUndefined();
    expect(writes.join('')).toMatch(/^user W1ABC-10 pass -1 /);
  });
});
