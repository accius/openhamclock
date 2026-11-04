/**
 * Rig Bridge cloud relay (server side) — fldigi / NBEMS plugin events pushed
 * by rig-bridge are fanned out to the browser's relay stream, unknown events
 * are dropped, and the latest status + receive tail replay to a browser that
 * opens the stream later. Handlers are captured from a stub app.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let dir;
const routes = {};

const call = (method, url, req = {}) =>
  new Promise((resolve) => {
    const handlers = routes[`${method} ${url}`];
    const res = {
      code: 200,
      status(c) {
        this.code = c;
        return this;
      },
      json(body) {
        resolve({ code: this.code, body });
      },
    };
    const full = { headers: {}, query: {}, body: {}, protocol: 'http', get: () => 'localhost', ...req };
    let i = 0;
    const next = () => handlers[++i](full, res, next);
    handlers[0](full, res, next);
  });

/** A fake SSE response that records what the route writes. */
function openStream(session) {
  const writes = [];
  const req = new EventEmitter();
  req.query = { session };
  const res = {
    setHeader() {},
    flushHeaders() {},
    write: (s) => writes.push(s),
  };
  routes['GET /api/rig-bridge/relay/stream'][0](req, res);
  const events = () =>
    writes
      .filter((w) => w.startsWith('data: '))
      .map((w) => JSON.parse(w.slice(6)))
      .filter((m) => m.type === 'plugin');
  return { events, close: () => req.emit('close') };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-relay-'));
  process.env.RELAY_TOKENS_FILE = path.join(dir, 'relay-tokens.json');
  const app = {};
  for (const m of ['get', 'post', 'delete', 'put', 'use']) {
    app[m] = (p, ...h) => (routes[`${m.toUpperCase()} ${p}`] = h);
  }
  const noop = () => {};
  require('./rig-bridge.js')(app, {
    ROOT_DIR: dir,
    logInfo: noop,
    logWarn: noop,
    requireWriteAuth: (q, r, n) => n(),
    RIG_BRIDGE_RELAY_KEY: 'k',
    fetch: () => Promise.resolve({ ok: true }),
    PORT: 0,
  });
});

afterAll(() => {
  vi.useRealTimers();
  delete process.env.RELAY_TOKENS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('relay: fldigi plugin events', () => {
  it('fans out known events, drops others, and replays status + RX to late streams', async () => {
    const cred = await call('GET', '/api/rig-bridge/relay/credentials', { query: { session: 'sess0001' } });
    const auth = { authorization: `Bearer ${cred.body.relayKey}`, 'x-relay-session': 'sess0001' };
    const push = (pluginEvents) =>
      call('POST', '/api/rig-bridge/relay/state', { headers: auth, body: { session: 'sess0001', pluginEvents } });

    await push([]); // creates the session
    const early = openStream('sess0001');
    await push([
      { event: 'fldigi', source: 'fldigi', data: { connected: true, mode: 'BPSK31' } },
      { event: 'fldigi-rx', source: 'fldigi', data: { text: 'CQ CQ ', reset: true } },
      { event: 'fldigi-rx', source: 'fldigi', data: { text: 'de N8TAG' } },
      { event: 'fldigi-cmd-result', source: 'fldigi', data: { requestId: 'r1', ok: true } },
      { event: 'relay-cmd-refused', source: 'cloud-relay', data: { type: 'setPTT', reason: 'unsigned', at: 1 } },
      { event: 'relay-cmd-result', source: 'cloud-relay', data: { requestId: 'ind-1', type: 'indicators', ok: true } },
      { event: 'gpio', source: 'gpio', data: { pin: 1 } },
      { event: 'nbems-form', source: 'fldigi', data: { blob: 'x'.repeat(30000) } },
    ]);
    expect(early.events().map((e) => e.event)).toEqual([
      'fldigi',
      'fldigi-rx',
      'fldigi-rx',
      'fldigi-cmd-result',
      'relay-cmd-refused',
      'relay-cmd-result',
    ]);
    expect(early.events().find((e) => e.event === 'relay-cmd-refused').source).toBe('cloud-relay');
    early.close();

    const late = openStream('sess0001');
    expect(late.events()).toEqual([
      { type: 'plugin', event: 'fldigi', source: 'fldigi', data: { connected: true, mode: 'BPSK31' } },
      { type: 'plugin', event: 'fldigi-rx', source: 'fldigi', data: { text: 'CQ CQ de N8TAG', reset: true } },
    ]);
    late.close();
  });

  it('refuses pushes without the relay credentials', async () => {
    const r = await call('POST', '/api/rig-bridge/relay/state', {
      headers: { 'x-relay-session': 'sess0001', authorization: 'Bearer nope' },
      body: { pluginEvents: [{ event: 'fldigi', data: {} }] },
    });
    expect(r.code).toBe(401);
  });
});
