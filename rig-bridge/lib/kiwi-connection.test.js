// @vitest-environment node
/**
 * Connection-loop test against a mock KiwiSDR WebSocket server that speaks
 * the handshake kiwiclient expects: auth → badp/audio_rate → AR OK →
 * sample_rate → setup commands → SND frames with an S-meter.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { KiwiConnection } from './kiwi-connection.js';
import { encodeMsgFrame, encodeSndFrame } from './kiwi-protocol.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await wait(10);
  }
};

function startMockKiwi({ password = '', rssiDbm = -100, rejectWith = null, maxUsers = 1 } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const mock = { wss, connections: 0, sockets: new Set(), commands: [], paths: [], port: null, rssiDbm };
  wss.on('connection', (ws, req) => {
    mock.connections++;
    mock.paths.push(req.url);
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
        if (mock.sockets.size > maxUsers) {
          ws.send(encodeMsgFrame({ too_busy: maxUsers }));
          return;
        }
        if (rejectWith) {
          ws.send(encodeMsgFrame(rejectWith));
          return;
        }
        const pw = text.slice('SET auth t=kiwi p='.length);
        if (password && pw !== password) {
          ws.send(encodeMsgFrame({ badp: 1 }));
          return;
        }
        ws.send(encodeMsgFrame({ version_maj: 1, version_min: 800 }));
        ws.send(encodeMsgFrame({ badp: 0 }));
        ws.send(encodeMsgFrame({ audio_rate: 12000 }));
      } else if (text.startsWith('SET AR OK')) {
        ws.send(encodeMsgFrame({ sample_rate: '12001.123' }));
        let seq = 0;
        streamer = setInterval(() => {
          if (ws.readyState === 1) ws.send(encodeSndFrame({ seq: seq++, rssiDbm: mock.rssiDbm }));
        }, 20);
      }
    });
  });
  return new Promise((resolve) => {
    wss.on('listening', () => {
      mock.port = wss.address().port;
      resolve(mock);
    });
  });
}

const closeMock = (mock) =>
  new Promise((resolve) => {
    for (const s of mock.sockets) s.terminate();
    mock.wss.close(() => resolve());
  });

describe('KiwiConnection against a mock KiwiSDR', () => {
  let mock;
  let conn;
  afterEach(async () => {
    if (conn) conn.close();
    conn = null;
    if (mock) await closeMock(mock);
    mock = null;
  });

  it('performs the kiwiclient handshake, tunes CW 300–700 Hz and streams S-meter readings', async () => {
    mock = await startMockKiwi({ rssiDbm: -97.3 });
    const readings = [];
    conn = new KiwiConnection({
      host: '127.0.0.1',
      port: mock.port,
      keepaliveMs: 50,
      tuning: { freqKHz: 14100, mode: 'cw', lowCut: 300, highCut: 700 },
      reconnect: { minMs: 50, maxMs: 200 },
    });
    conn.on('smeter', (s) => readings.push(s));
    conn.connect();

    await until(() => conn.connected);
    // The setup commands follow the sample_rate reply, which can land a tick
    // after `connected` flips — wait for the tune command before asserting.
    await until(() => mock.commands.some((c) => c.startsWith('SET mod=cw')));
    expect(conn.sampleRate).toBeCloseTo(12001.123);
    expect(mock.paths[0]).toMatch(/^\/kiwi\/\d+\/SND$/);
    expect(mock.commands[0]).toBe('SET auth t=kiwi p=');
    expect(mock.commands).toContain('SET AR OK in=12000 out=44100');
    expect(mock.commands).toContain('SET mod=cw low_cut=300 high_cut=700 freq=14100.000');
    expect(mock.commands).toContain('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
    expect(mock.commands).toContain('SET compression=0');
    expect(mock.commands).toContain('SET ident_user=OpenHamClock');

    await until(() => readings.length >= 5);
    expect(readings[0].dbm).toBeCloseTo(-97.3, 1);
    expect(readings[1].seq).toBe(readings[0].seq + 1);

    // Keepalive is sent periodically once ready.
    await until(() => mock.commands.filter((c) => c === 'SET keepalive').length >= 2);

    // Retune is a single SET line on the live socket.
    expect(conn.tune(28200)).toBe(true);
    await until(() => mock.commands.includes('SET mod=cw low_cut=300 high_cut=700 freq=28200.000'));
  });

  it('sends the password and surfaces badp=1 as a rejection, then backs off at the maximum', async () => {
    mock = await startMockKiwi({ password: 'letmein' });
    const rejections = [];
    const reconnects = [];
    conn = new KiwiConnection({
      host: '127.0.0.1',
      port: mock.port,
      password: 'wrong',
      reconnect: { minMs: 10, maxMs: 150 },
    });
    conn.on('rejected', (r) => rejections.push(r));
    conn.on('reconnect', (r) => reconnects.push(r));
    conn.connect();
    await until(() => rejections.length >= 1);
    expect(rejections[0]).toMatchObject({ event: 'badp', reason: 'bad password' });
    expect(mock.commands[0]).toBe('SET auth t=kiwi p=wrong');
    expect(conn.connected).toBe(false);
    expect(reconnects[0].inMs).toBeGreaterThanOrEqual(150);
    expect(conn.lastRejection.event).toBe('badp');

    // Fix the password: the next attempt succeeds.
    conn.password = 'letmein';
    await until(() => conn.connected, 2000);
  });

  it('reconnects with backoff after the server drops the socket, keeping its tuning', async () => {
    mock = await startMockKiwi();
    conn = new KiwiConnection({ host: '127.0.0.1', port: mock.port, reconnect: { minMs: 20, maxMs: 100 } });
    const closes = [];
    conn.on('close', (c) => closes.push(c));
    conn.connect();
    await until(() => conn.connected);
    conn.tune(21150);
    await until(() => mock.commands.some((c) => c.includes('freq=21150.000')));

    // Kick the client from the server side.
    for (const s of mock.sockets) s.close(1001, 'bye');
    await until(() => closes.length >= 1);
    expect(closes[0].wasReady).toBe(true);
    await until(() => mock.connections >= 2 && conn.connected, 3000);
    // Only one live socket at a time (Kiwi user limit).
    expect(mock.sockets.size).toBe(1);
    // The new session is tuned where we left off.
    const tuneCmds = mock.commands.filter((c) => c.startsWith('SET mod='));
    expect(tuneCmds[tuneCmds.length - 1]).toContain('freq=21150.000');
  });

  it('retries when the receiver is unreachable and stops cleanly on close()', async () => {
    const errors = [];
    const reconnects = [];
    conn = new KiwiConnection({ host: '127.0.0.1', port: 1, reconnect: { minMs: 10, maxMs: 40 } });
    conn.on('error', (e) => errors.push(e));
    conn.on('reconnect', (r) => reconnects.push(r));
    conn.connect();
    await until(() => reconnects.length >= 3, 4000);
    expect(errors.length).toBeGreaterThan(0);
    expect(reconnects[2].inMs).toBeGreaterThanOrEqual(reconnects[0].inMs);
    conn.close();
    const n = reconnects.length;
    await wait(120);
    expect(reconnects.length).toBe(n);
    expect(conn.state).toBe('closed');
  });

  it('reports when the module cannot open a socket at all (no host)', () => {
    conn = new KiwiConnection({ host: '', port: 8073 });
    const errors = [];
    conn.on('error', (e) => errors.push(e));
    expect(conn.connect()).toBe(false);
    expect(errors[0].message).toMatch(/host/);
  });
});
