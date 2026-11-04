/**
 * KiwiSDR audio over the Cloud Relay (server side, through the real
 * rig-bridge.js routes): GET /relay/audio follows the same read rule as the
 * live stream — the read token in X-Relay-Read, or a one-time ticket bought
 * with it — and the server never queues an (unsignable) audio command itself.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sign = require('../../rig-bridge/lib/relay-sign.js');
let dir;

function loadServer() {
  const routes = {};
  const app = {};
  for (const m of ['get', 'post', 'delete', 'put', 'use'])
    app[m] = (p, ...h) => (routes[`${m.toUpperCase()} ${p}`] = h);
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
      const full = { headers: {}, query: {}, body: {}, protocol: 'http', get: () => 'localhost', on() {}, ...req };
      let i = 0;
      const next = () => handlers[++i](full, res, next);
      handlers[0](full, res, next);
    });
  /** Open the audio route; returns whether it was refused and the queued commands. */
  const listen = (query, headers = {}) => {
    const req = new EventEmitter();
    req.query = query;
    req.headers = headers;
    let refused = null;
    const res = new EventEmitter();
    Object.assign(res, {
      headersSent: false,
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        refused = { code: this.code || 200, body: b };
      },
      writeHead() {
        this.headersSent = true;
      },
      write: () => true,
      end() {},
    });
    routes['GET /api/rig-bridge/relay/audio'][0](req, res);
    return { refused, close: () => req.emit('close') };
  };
  return { call, listen };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-relay-audio-'));
  process.env.RELAY_TOKENS_FILE = path.join(dir, 'relay-tokens.json');
});

afterAll(() => {
  vi.useRealTimers();
  delete process.env.RELAY_TOKENS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const KEY = '5'.repeat(64);

async function pair(srv, id) {
  const cred = await srv.call('GET', '/api/rig-bridge/relay/credentials', { query: { session: id } });
  const headers = {
    authorization: `Bearer ${cred.body.relayKey}`,
    'x-relay-session': id,
    'x-relay-read-hash': sign.readTokenHash(sign.deriveReadToken(KEY, id)),
  };
  await srv.call('POST', '/api/rig-bridge/relay/state', { headers, body: { session: id, freq: 7030000 } });
  return { token: sign.deriveReadToken(KEY, id), headers };
}

const Q = (session) => ({ session, freq: '7030', mode: 'cw' });

describe('GET /api/rig-bridge/relay/audio — read token', () => {
  it('refuses a missing or wrong read token and accepts the right one', async () => {
    const srv = loadServer();
    const id = 'audio00000000a01';
    const { token } = await pair(srv, id);
    expect(srv.listen(Q(id)).refused.code).toBe(401);
    const wrong = { 'x-relay-read': sign.deriveReadToken('6'.repeat(64), id) };
    expect(srv.listen(Q(id), wrong).refused.code).toBe(401);
    const ok = srv.listen(Q(id), { 'x-relay-read': token });
    expect(ok.refused).toBeNull(); // held open, waiting for the bridge's upload
    ok.close();
  });

  it('accepts a one-time ticket bought with the read token, once', async () => {
    const srv = loadServer();
    const id = 'audio00000000a02';
    const { token } = await pair(srv, id);
    const t = await srv.call('POST', '/api/rig-bridge/relay/stream-ticket', {
      query: { session: id },
      headers: { 'x-relay-read': token },
    });
    const first = srv.listen({ ...Q(id), ticket: t.body.ticket });
    expect(first.refused).toBeNull();
    first.close();
    expect(srv.listen({ ...Q(id), ticket: t.body.ticket }).refused.code).toBe(401); // single use
  });

  it('never queues an audio command itself — the browser sends it signed', async () => {
    const srv = loadServer();
    const id = 'audio00000000a03';
    const { token, headers } = await pair(srv, id);
    const l = srv.listen(Q(id), { 'x-relay-read': token });
    l.close();
    const polled = await srv.call('GET', '/api/rig-bridge/relay/commands', { query: { session: id }, headers });
    expect(polled.body.commands).toEqual([]);
  });

  it('a signed kiwiAudioStart is queued with its signature; an unsigned one is refused for a paired session', async () => {
    const srv = loadServer();
    const id = 'audio00000000a04';
    const { headers } = await pair(srv, id);
    // the bridge reports that it verifies signatures
    await srv.call('POST', '/api/rig-bridge/relay/state', {
      headers,
      body: { session: id, commandAuth: 'hmac-sha256' },
    });
    const payload = { freqKHz: 7030, mode: 'cw' };
    const unsigned = await srv.call('POST', '/api/rig-bridge/relay/command', {
      query: { session: id },
      body: { type: 'kiwiAudioStart', payload },
    });
    expect(unsigned.code).toBe(401);
    const auth = sign.signCommand(KEY, id, 'kiwiAudioStart', payload);
    const ok = await srv.call('POST', '/api/rig-bridge/relay/command', {
      query: { session: id },
      body: { type: 'kiwiAudioStart', payload, auth },
    });
    expect(ok.code).toBe(200);
    const polled = await srv.call('GET', '/api/rig-bridge/relay/commands', { query: { session: id }, headers });
    expect(polled.body.commands[0]).toMatchObject({ type: 'kiwiAudioStart', payload, auth: { sig: auth.sig } });
  });
});
