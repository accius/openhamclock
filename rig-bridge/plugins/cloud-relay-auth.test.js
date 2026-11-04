/**
 * Cloud relay command authentication (bridge side). Loopback HTTP servers
 * stand in for the hosted server and for this bridge's own /freq, /mode,
 * /ptt routes, so we see exactly which commands reach the radio.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import EventEmitter from 'events';
import http from 'http';
import relay from './cloud-relay.js';
import signLib from '../lib/relay-sign.js';

const { signCommand } = signLib;
const KEY = '0123456789abcdef'.repeat(4);
const SESSION = 'sess000000000001';

const servers = [];
const listen = (handler) =>
  new Promise((resolve) => {
    const s = http.createServer(handler);
    servers.push(s);
    s.listen(0, '127.0.0.1', () => resolve(s.address().port));
  });

afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections?.();
    s.close();
  }
  vi.restoreAllMocks();
});

const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });

async function setup(relayCfg = {}) {
  const pushes = [];
  const polls = [];
  const hostedPort = await listen(async (req, res) => {
    if (req.url.startsWith('/api/rig-bridge/relay/commands')) polls.push(req.headers);
    if (req.url.startsWith('/api/rig-bridge/relay/state')) {
      pushes.push(JSON.parse(await readBody(req)));
      res.writeHead(200);
      return res.end('{"ok":true}');
    }
    if (req.url.startsWith('/api/rig-bridge/relay/commands')) return; // hold the long-poll
    res.writeHead(200);
    res.end('{}');
  });
  const radio = [];
  const bridgePort = await listen(async (req, res) => {
    radio.push({
      url: req.url,
      token: req.headers['x-rigbridge-token'],
      body: JSON.parse((await readBody(req)) || '{}'),
    });
    res.writeHead(200);
    res.end('{"success":true}');
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const config = {
    port: bridgePort,
    apiToken: 'local-token',
    cloudRelay: {
      url: `http://127.0.0.1:${hostedPort}`,
      apiKey: 'k',
      session: SESSION,
      pushInterval: 60000,
      ...relayCfg,
    },
  };
  const inst = relay.create(config, { state: { freq: 7074000, mode: 'USB' }, pluginBus: new EventEmitter() });
  inst.connect();
  const settle = () => new Promise((r) => setTimeout(r, 150));
  return { inst, config, radio, pushes, polls, settle };
}

describe('paired bridge (commandKey set)', () => {
  it('runs signed commands, refuses unsigned, tampered and replayed ones', async () => {
    const { inst, radio, settle } = await setup({ commandKey: KEY });
    const auth = signCommand(KEY, SESSION, 'setPTT', { ptt: true });
    inst._executeCommand({ type: 'setPTT', payload: { ptt: true }, auth });
    inst._executeCommand({ type: 'setPTT', payload: { ptt: true }, auth }); // replay
    inst._executeCommand({ type: 'setPTT', payload: { ptt: true } }); // unsigned
    inst._executeCommand({ type: 'setFreq', payload: { freq: 1 }, auth }); // signature for another command
    const f = signCommand(KEY, SESSION, 'setFreq', { freq: 14074000 });
    inst._executeCommand({ type: 'setFreq', payload: { freq: 14074000 }, auth: f });
    await settle();
    expect(radio.map((r) => `${r.url} ${JSON.stringify(r.body)}`)).toEqual([
      '/ptt {"ptt":true}',
      '/freq {"freq":14074000}',
    ]);
    expect(inst.getStatus()).toMatchObject({ commandAuth: 'hmac-sha256', refusedCommands: 3 });
    inst.disconnect();
  });

  it('accepts a key pasted into the setup page without a restart', async () => {
    const { inst, config, radio, settle } = await setup();
    config.cloudRelay = { ...config.cloudRelay, commandKey: KEY }; // what POST /api/config does
    inst._executeCommand({ type: 'setPTT', payload: { ptt: true } });
    inst._executeCommand({
      type: 'setPTT',
      payload: { ptt: false },
      auth: signCommand(KEY, SESSION, 'setPTT', { ptt: false }),
    });
    await settle();
    expect(radio.map((r) => r.body)).toEqual([{ ptt: false }]);
    inst.disconnect();
  });

  it('tells the server it signs commands', async () => {
    const { inst, pushes } = await setup({ commandKey: KEY });
    inst._pushState();
    await vi.waitFor(() => expect(pushes.length).toBeGreaterThan(0));
    expect(pushes[0].commandAuth).toBe('hmac-sha256');
    inst.disconnect();
  });

  it('registers the hash of its read token on pushes and command polls, never the token', async () => {
    const { inst, pushes, polls } = await setup({ commandKey: KEY });
    const hash = signLib.readTokenHash(signLib.deriveReadToken(KEY, SESSION));
    inst._pushState();
    await vi.waitFor(() => expect(pushes.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(polls.length).toBeGreaterThan(0));
    expect(pushes[0].readTokenHash).toBe(hash);
    expect(polls[0]['x-relay-read-hash']).toBe(hash);
    expect(JSON.stringify(pushes)).not.toContain(signLib.deriveReadToken(KEY, SESSION));
    inst.disconnect();
  });

  it('reports refused commands back as relay-cmd-refused events, rate-limited', async () => {
    const { inst, pushes } = await setup({ commandKey: KEY });
    inst._executeCommand({ type: 'setPTT', payload: { ptt: true } });
    inst._executeCommand({ type: 'setPTT', payload: { ptt: true } }); // same type + reason: not repeated
    inst._executeCommand({
      type: 'indicators',
      payload: {},
      auth: signCommand('9'.repeat(64), SESSION, 'indicators', {}),
    });
    await vi.waitFor(() => expect(pushes.some((p) => p.pluginEvents)).toBe(true));
    const ev = pushes.flatMap((p) => p.pluginEvents || []);
    expect(ev.map((e) => [e.event, e.source, e.data.type, e.data.reason])).toEqual([
      ['relay-cmd-refused', 'cloud-relay', 'setPTT', 'unsigned'],
      ['relay-cmd-refused', 'cloud-relay', 'indicators', 'bad-signature'],
    ]);
    inst.disconnect();
  });
});

describe('answers for commands that carry a requestId', () => {
  it('an applied indicators command comes back as relay-cmd-result; a refused one always as relay-cmd-refused', async () => {
    const { inst, radio, pushes } = await setup({ commandKey: KEY });
    const payload = { satVisible: false, countdown: 'off', lightningRelay: false, requestId: 'ind-1' };
    inst._executeCommand({ type: 'indicators', payload, auth: signCommand(KEY, SESSION, 'indicators', payload) });
    // two refusals of the same type + reason, each with its own requestId: both reported
    inst._executeCommand({ type: 'indicators', payload: { requestId: 'ind-2' } });
    inst._executeCommand({ type: 'indicators', payload: { requestId: 'ind-3' } });
    await vi.waitFor(() => {
      const ev = pushes.flatMap((p) => p.pluginEvents || []);
      expect(ev.filter((e) => e.data.requestId).length).toBe(3);
    });
    const ev = pushes.flatMap((p) => p.pluginEvents || []);
    expect(radio.map((r) => r.url)).toEqual(['/api/indicators']);
    expect(ev.find((e) => e.data.requestId === 'ind-1')).toMatchObject({
      event: 'relay-cmd-result',
      data: { type: 'indicators', ok: true, status: 200 },
    });
    expect(ev.filter((e) => e.event === 'relay-cmd-refused').map((e) => e.data.requestId)).toEqual(['ind-2', 'ind-3']);
    inst.disconnect();
  });
});

describe('bridge not yet re-paired (no commandKey)', () => {
  it('during the grace period accepts unsigned tuning but never PTT', async () => {
    const { inst, radio, settle, pushes } = await setup({ unsignedGraceUntil: '2999-01-01' });
    inst._executeCommand({ type: 'setFreq', payload: { freq: 7074000 } });
    inst._executeCommand({ type: 'setMode', payload: { mode: 'USB' } });
    inst._executeCommand({ type: 'setPTT', payload: { ptt: true } });
    await settle();
    expect(radio.map((r) => r.url)).toEqual(['/freq', '/mode']);
    inst._pushState();
    await vi.waitFor(() => expect(pushes.length).toBeGreaterThan(0));
    expect(pushes[0].commandAuth).toBe('none');
    expect(inst.getStatus()).toMatchObject({ commandAuth: 'legacy', unsignedGraceUntil: '2999-01-01' });
    inst.disconnect();
  });

  it('after the grace period refuses unsigned tuning too', async () => {
    const { inst, radio, settle } = await setup({ unsignedGraceUntil: '2020-01-01' });
    inst._executeCommand({ type: 'setFreq', payload: { freq: 7074000 } });
    await settle();
    expect(radio).toEqual([]);
    inst.disconnect();
  });

  it('allowUnsigned restores the old behaviour, PTT included', async () => {
    const { inst, radio, settle } = await setup({ allowUnsigned: true, unsignedGraceUntil: '2020-01-01' });
    inst._executeCommand({ type: 'setPTT', payload: { ptt: true } });
    await settle();
    expect(radio.map((r) => r.url)).toEqual(['/ptt']);
    expect(inst.getStatus().commandAuth).toBe('unsigned-allowed');
    inst.disconnect();
  });
});
