// @vitest-environment node
/**
 * kiwi-audio plugin — streams a mock KiwiSDR's audio through the real
 * Express routes: handshake, PCM relay with the sample-rate header, retune,
 * one-stream-at-a-time, and closing the Kiwi socket when the listener leaves.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import plugin from './kiwi-audio.js';
import { encodeMsgFrame, encodeSndFrame } from '../lib/kiwi-protocol.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await wait(10);
  }
};

/** Mock Kiwi that sends a ramp of s16be samples in every SND frame. */
function startMockKiwi({ rejectWith = null } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const mock = { wss, sockets: new Set(), commands: [], port: null, opened: 0 };
  wss.on('connection', (ws) => {
    mock.opened++;
    mock.sockets.add(ws);
    let streamer = null;
    ws.on('close', () => {
      mock.sockets.delete(ws);
      if (streamer) clearInterval(streamer);
    });
    ws.on('message', (data) => {
      const text = data.toString();
      mock.commands.push(text);
      if (text.startsWith('SET auth')) {
        if (rejectWith) return ws.send(encodeMsgFrame(rejectWith));
        ws.send(encodeMsgFrame({ badp: 0 }));
        ws.send(encodeMsgFrame({ audio_rate: 12000 }));
      } else if (text.startsWith('SET AR OK')) {
        ws.send(encodeMsgFrame({ sample_rate: '12000.5' }));
        let seq = 0;
        streamer = setInterval(() => {
          const audio = Buffer.alloc(8);
          [100, -100, 2000, -32768].forEach((v, i) => audio.writeInt16BE(v, i * 2));
          if (ws.readyState === 1) ws.send(encodeSndFrame({ seq: seq++, rssiDbm: -90, audio }));
        }, 10);
      }
    });
  });
  return new Promise((resolve) =>
    wss.on('listening', () => resolve(Object.assign(mock, { port: wss.address().port }))),
  );
}

const closeMock = (mock) =>
  new Promise((resolve) => {
    for (const s of mock.sockets) s.terminate();
    mock.wss.close(() => resolve());
  });

function startBridge(config, services = {}) {
  const app = express();
  app.use(express.json());
  const requireAuth = (req, res, next) =>
    req.headers['x-rigbridge-token'] === 'secret' ? next() : res.status(401).json({ error: 'Unauthorized' });
  plugin.registerRoutes(app);
  plugin.registerAuthRoutes(app, requireAuth);
  const inst = plugin.create(config, services);
  inst.connect();
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, inst, port: server.address().port }));
  });
}

/** Open the stream; resolves once headers arrive, collecting body bytes. */
function openStream(port, path, token = 'secret') {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: { 'X-RigBridge-Token': token } }, (res) => {
      const out = { res, req, chunks: [], bytes: 0, ended: false };
      res.on('data', (c) => {
        out.chunks.push(c);
        out.bytes += c.length;
      });
      res.on('end', () => (out.ended = true));
      res.on('close', () => (out.ended = true));
      resolve(out);
    });
    req.on('error', reject);
  });
}

const getJson = (port, path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(JSON.parse(body)));
      })
      .on('error', reject);
  });

const postJson = (port, path, payload) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-RigBridge-Token': 'secret' },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });

describe('kiwi-audio plugin', () => {
  let mock;
  let bridge;
  afterEach(async () => {
    if (bridge) {
      bridge.inst.disconnect();
      await new Promise((r) => bridge.server.close(r));
    }
    bridge = null;
    if (mock) await closeMock(mock);
    mock = null;
  });

  it('validates tune parameters', () => {
    // CW: the Kiwi is tuned 600 Hz low so the station on 7030.0 is heard at 600 Hz
    expect(plugin.parseTune('7030', 'CW')).toMatchObject({ freqKHz: 7030, mode: 'cw', lowCut: 200, highCut: 1000 });
    expect(plugin.parseTune('7030', 'cw').kiwiKHz).toBeCloseTo(7029.4, 6);
    expect(plugin.parseTune('14074', 'usb')).toMatchObject({ kiwiKHz: 14074, lowCut: 100, highCut: 3000 });
    expect(plugin.parseTune('abc', 'cw').error).toBeTruthy();
    expect(plugin.parseTune('7030', 'fm').error).toBeTruthy();
    expect(plugin.parseTune('99999', 'cw').error).toBeTruthy();
  });

  it('falls back to the beacon monitor receiver when no host is set', () => {
    expect(plugin.receiverConfig({ beaconMonitor: { host: 'kiwi.lan', port: 8074, password: 'pw' } })).toEqual({
      host: 'kiwi.lan',
      port: 8074,
      password: 'pw',
      usesBeacon: true,
    });
    expect(
      plugin.receiverConfig({ kiwiAudio: { host: 'other.lan' }, beaconMonitor: { host: 'kiwi.lan', port: 8074 } }),
    ).toMatchObject({ host: 'other.lan', port: 8073, usesBeacon: false });
  });

  it('streams s16be PCM with the sample rate header, retunes, and closes the Kiwi socket when the listener leaves', async () => {
    mock = await startMockKiwi();
    bridge = await startBridge({ kiwiAudio: { enabled: true, host: '127.0.0.1', port: mock.port } });

    // Nothing touches the receiver until someone listens
    expect(mock.opened).toBe(0);
    expect(await getJson(bridge.port, '/api/kiwi-audio/status')).toMatchObject({ running: true, streaming: false });

    const s = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=7030&mode=cw');
    expect(s.res.statusCode).toBe(200);
    expect(s.res.headers['x-sample-rate']).toBe('12000.5');
    expect(s.res.headers['x-audio-format']).toBe('s16be');
    expect(s.res.headers['x-cw-pitch']).toBe('600');
    expect(mock.commands).toContain('SET mod=cw low_cut=200 high_cut=1000 freq=7029.400');

    await until(() => s.bytes >= 32);
    const buf = Buffer.concat(s.chunks);
    expect(buf.readInt16BE(0)).toBe(100);
    expect(buf.readInt16BE(2)).toBe(-100);
    expect(buf.readInt16BE(6)).toBe(-32768);

    const st = await getJson(bridge.port, '/api/kiwi-audio/status');
    expect(st).toMatchObject({ streaming: true, connected: true, tuning: { freqKHz: 7030, mode: 'cw' } });
    expect(JSON.stringify(st)).not.toContain('password');

    const tuned = await postJson(bridge.port, '/api/kiwi-audio/tune', { freqKHz: 14025, mode: 'cw' });
    expect(tuned.body.success).toBe(true);
    await until(() => mock.commands.includes('SET mod=cw low_cut=200 high_cut=1000 freq=14024.400'));

    s.req.destroy();
    await until(() => mock.sockets.size === 0);
    await until(() => bridge.inst.getStatus().streaming === false);
  });

  it('streams µ-law (half the bytes) when codec=ulaw is asked for', async () => {
    mock = await startMockKiwi();
    bridge = await startBridge({ kiwiAudio: { enabled: true, host: '127.0.0.1', port: mock.port } });
    const s = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=14074&mode=usb&codec=ulaw');
    expect(s.res.headers['x-audio-format']).toBe('ulaw');
    expect(s.res.headers['x-cw-pitch']).toBeUndefined();
    expect(mock.commands).toContain('SET mod=usb low_cut=100 high_cut=3000 freq=14074.000');
    await until(() => s.bytes >= 8);
    const b = Buffer.concat(s.chunks);
    // [100, -100, 2000, -32768] as µ-law
    const { encodeSample } = await import('../lib/mulaw.js');
    expect([...b.subarray(0, 4)]).toEqual([100, -100, 2000, -32768].map(encodeSample));
    s.req.destroy();
  });

  it('pauses a beacon monitor on the same Kiwi while listening, and resumes it after', async () => {
    mock = await startMockKiwi();
    const bm = {
      running: true,
      host: '127.0.0.1',
      port: mock.port,
      calls: [],
      pause(reason) {
        this.calls.push(['pause', reason]);
        return true;
      },
      resume() {
        this.calls.push(['resume']);
        return true;
      },
    };
    bridge = await startBridge(
      { kiwiAudio: { enabled: true, host: '127.0.0.1', port: mock.port } },
      { beaconMonitor: { getActive: () => bm } },
    );
    const s = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=7030');
    expect(bm.calls[0][0]).toBe('pause');
    expect((await getJson(bridge.port, '/api/kiwi-audio/status')).beaconMonitorPaused).toBe(true);
    s.req.destroy();
    await until(() => bm.calls.some((c) => c[0] === 'resume'));
  });

  it("leaves the beacon monitor alone with beaconMonitor: 'keep' or on another Kiwi", async () => {
    mock = await startMockKiwi();
    const bm = { running: true, host: 'other.kiwi', port: 8073, pause: vi.fn(() => true), resume: vi.fn() };
    bridge = await startBridge(
      { kiwiAudio: { enabled: true, host: '127.0.0.1', port: mock.port } },
      { beaconMonitor: { getActive: () => bm } },
    );
    const a = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=7030');
    expect(bm.pause).not.toHaveBeenCalled();
    a.req.destroy();
    bm.host = '127.0.0.1';
    bm.port = mock.port;
    bridge.inst.disconnect();
    await new Promise((r) => bridge.server.close(r));
    bridge = await startBridge(
      { kiwiAudio: { enabled: true, host: '127.0.0.1', port: mock.port, beaconMonitor: 'keep' } },
      { beaconMonitor: { getActive: () => bm } },
    );
    const b = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=7030');
    expect(b.res.statusCode).toBe(200);
    expect(bm.pause).not.toHaveBeenCalled();
    b.req.destroy();
  });

  it('keeps one receiver slot: a second listener replaces the first', async () => {
    mock = await startMockKiwi();
    bridge = await startBridge({ kiwiAudio: { enabled: true, host: '127.0.0.1', port: mock.port } });
    const a = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=7030');
    const b = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=10120');
    expect(b.res.statusCode).toBe(200);
    await until(() => a.ended);
    await until(() => mock.sockets.size === 1);
    b.req.destroy();
  });

  it('requires the API token and reports a Kiwi rejection as an error response', async () => {
    mock = await startMockKiwi({ rejectWith: { badp: 2 } });
    bridge = await startBridge({ kiwiAudio: { enabled: true, host: '127.0.0.1', port: mock.port } });
    const denied = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=7030', 'wrong');
    expect(denied.res.statusCode).toBe(401);
    const rejected = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=7030');
    expect(rejected.res.statusCode).toBe(503);
    await until(() => rejected.ended);
    expect(Buffer.concat(rejected.chunks).toString()).toContain('user limit');
  });

  it('answers 503 when no receiver is configured', async () => {
    bridge = await startBridge({ kiwiAudio: { enabled: true } });
    const r = await openStream(bridge.port, '/api/kiwi-audio/stream?freq=7030');
    expect(r.res.statusCode).toBe(503);
  });
});
