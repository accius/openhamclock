// @vitest-environment node
/**
 * KiwiSDR audio over the Cloud Relay, end to end in one process:
 *   browser (http GET) → server relay-audio routes → command queue →
 *   rig-bridge relay-audio (lib/relay-audio.js) → kiwi-audio plugin →
 *   mock KiwiSDR → µ-law upload → server → browser.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { registerRelayAudio } from './relayAudio.js';
import kiwiAudio from '../../rig-bridge/plugins/kiwi-audio.js';
import { createRelayAudio } from '../../rig-bridge/lib/relay-audio.js';
import { encodeMsgFrame, encodeSndFrame } from '../../rig-bridge/lib/kiwi-protocol.js';
import { encodeSample } from '../../rig-bridge/lib/mulaw.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await wait(10);
  }
};

function startMockKiwi() {
  const wss = new WebSocketServer({ port: 0 });
  const mock = { wss, sockets: new Set(), commands: [] };
  wss.on('connection', (ws) => {
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
        ws.send(encodeMsgFrame({ badp: 0 }));
        ws.send(encodeMsgFrame({ audio_rate: 12000 }));
      } else if (text.startsWith('SET AR OK')) {
        ws.send(encodeMsgFrame({ sample_rate: '12000' }));
        let seq = 0;
        streamer = setInterval(() => {
          const audio = Buffer.alloc(8);
          [100, -100, 2000, -32768].forEach((v, i) => audio.writeInt16BE(v, i * 2));
          if (ws.readyState === 1) ws.send(encodeSndFrame({ seq: seq++, rssiDbm: -90, audio }));
        }, 10);
      }
    });
  });
  return new Promise((r) => wss.on('listening', () => r(Object.assign(mock, { port: wss.address().port }))));
}

/** Server + in-process "bridge" wired through the command queue. */
async function startStack({ kiwiPort, bridgeAnswers = true, relaySessions = ['abcd1234'], segmentMs } = {}) {
  const app = express();
  app.use(express.json());
  const commands = [];
  let relay = null;
  const uploads = { count: 0 };
  const requireRelayAuth = (req, res, next) => {
    if (req.headers.authorization !== 'Bearer k') return res.status(401).json({ error: 'nope' });
    req.relaySessionId = req.headers['x-relay-session'] || req.query.session;
    uploads.count++;
    next();
  };
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const plugin = kiwiAudio.create(
    { kiwiAudio: { enabled: true, host: '127.0.0.1', port: kiwiPort } },
    { beaconMonitor: null },
  );
  plugin.connect();
  relay = createRelayAudio({
    serverUrl: base,
    apiKey: 'k',
    session: 'abcd1234',
    getKiwiAudio: () => plugin,
    parseTune: kiwiAudio.parseTune,
    segmentMs,
  });
  registerRelayAudio(app, {
    requireRelayAuth,
    canRead: (req, sid) => (req.headers['x-relay-read'] === 'good-token' ? 'ok' : 'denied'),
    hasSession: (sid) => relaySessions.includes(sid),
    startTimeoutMs: 400,
  });
  // The browser's signed kiwiAudioStart arrives at the bridge through the
  // command queue (signature checking: rig-bridge/plugins/cloud-relay-audio.test.js)
  const sendCommand = (cmd) => {
    commands.push(cmd.type);
    if (bridgeAnswers) setTimeout(() => relay.handleCommand(cmd), 5);
  };
  return {
    base,
    commands,
    sendCommand,
    uploads,
    relay,
    plugin,
    close: async () => {
      relay.stop('test end');
      plugin.disconnect();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

function listen(base, path, headers = { 'x-relay-read': 'good-token' }) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}${path}`, { headers }, (res) => {
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

describe('relay audio (server ⇄ bridge ⇄ Kiwi)', () => {
  let mock;
  let stack;
  afterEach(async () => {
    if (stack) await stack.close();
    stack = null;
    if (mock) {
      for (const s of mock.sockets) s.terminate();
      await new Promise((r) => mock.wss.close(r));
    }
    mock = null;
  });

  it('streams µ-law Kiwi audio to the browser and frees the Kiwi slot when it leaves', async () => {
    mock = await startMockKiwi();
    stack = await startStack({ kiwiPort: mock.port });
    stack.sendCommand({ type: 'kiwiAudioStart', payload: { freqKHz: 7030, mode: 'cw' } });
    const l = await listen(stack.base, '/api/rig-bridge/relay/audio?session=abcd1234&freq=7030&mode=cw');
    expect(l.res.statusCode).toBe(200);
    expect(l.res.headers['x-audio-format']).toBe('ulaw');
    expect(l.res.headers['x-sample-rate']).toBe('12000');
    expect(l.res.headers['x-cw-pitch']).toBe('600');
    expect(mock.commands).toContain('SET mod=cw low_cut=200 high_cut=1000 freq=7029.400');
    await until(() => l.bytes >= 8);
    expect([...Buffer.concat(l.chunks).subarray(0, 4)]).toEqual([100, -100, 2000, -32768].map(encodeSample));
    l.req.destroy();
    // the server ends the upload → the bridge ends the Kiwi session; no command needed
    await until(() => mock.sockets.size === 0);
    expect(stack.commands).toEqual(['kiwiAudioStart']);
    expect(stack.relay.status().active).toBe(false);
  });

  it('keeps the stream flowing across upload segment roll-overs', async () => {
    mock = await startMockKiwi();
    stack = await startStack({ kiwiPort: mock.port, segmentMs: 250 });
    stack.sendCommand({ type: 'kiwiAudioStart', payload: { freqKHz: 14074, mode: 'usb' } });
    const l = await listen(stack.base, '/api/rig-bridge/relay/audio?session=abcd1234&freq=14074&mode=usb');
    expect(l.res.statusCode).toBe(200);
    await wait(1100);
    const mid = l.bytes;
    expect(stack.relay.status().segments).toBeGreaterThanOrEqual(3);
    await wait(400);
    expect(l.bytes).toBeGreaterThan(mid); // still flowing after several roll-overs
    expect(l.ended).toBe(false);
    expect(mock.sockets.size).toBe(1); // one Kiwi slot throughout
    l.req.destroy();
  });

  it('fails fast without a relay session and times out when the bridge does not answer', async () => {
    mock = await startMockKiwi();
    stack = await startStack({ kiwiPort: mock.port, bridgeAnswers: false });
    const none = await listen(stack.base, '/api/rig-bridge/relay/audio?session=zzzz9999&freq=7030');
    expect(none.res.statusCode).toBe(503);
    const silent = await listen(stack.base, '/api/rig-bridge/relay/audio?session=abcd1234&freq=7030');
    expect(silent.res.statusCode).toBe(504);
    await until(() => silent.ended);
    expect(Buffer.concat(silent.chunks).toString()).toContain('Relay KiwiSDR audio');
  });

  it('needs the read token', async () => {
    mock = await startMockKiwi();
    stack = await startStack({ kiwiPort: mock.port });
    const none = await listen(stack.base, '/api/rig-bridge/relay/audio?session=abcd1234&freq=7030', {});
    expect(none.res.statusCode).toBe(401);
    const wrong = await listen(stack.base, '/api/rig-bridge/relay/audio?session=abcd1234&freq=7030', {
      'x-relay-read': 'nope',
    });
    expect(wrong.res.statusCode).toBe(401);
    expect(stack.commands).toEqual([]);
  });

  it('validates the request and refuses unauthenticated uploads', async () => {
    mock = await startMockKiwi();
    stack = await startStack({ kiwiPort: mock.port });
    expect((await listen(stack.base, '/api/rig-bridge/relay/audio?session=abcd1234&freq=abc')).res.statusCode).toBe(
      400,
    );
    expect(
      (await listen(stack.base, '/api/rig-bridge/relay/audio?session=abcd1234&freq=7030&mode=fm')).res.statusCode,
    ).toBe(400);
    const status = await new Promise((resolve) => {
      const req = http.request(
        `${stack.base}/api/rig-bridge/relay/audio/upload?session=abcd1234`,
        { method: 'POST' },
        (res) => resolve(res.statusCode),
      );
      req.end('x');
    });
    expect(status).toBe(401);
  });
});
