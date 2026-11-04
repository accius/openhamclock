/**
 * End-to-end: ICS 213 "Send as APRS message" → OpenHamClock server →
 * Rig Bridge aprs-tnc plugin → KISS over TCP → (fake) TNC.
 *
 * Every hop is the real code except the radio:
 *   - client:     src/utils/aprsMessageSend.js sendAprsParts (what the panel calls),
 *                 with the parts from icsForms.js splitForAprs
 *   - server:     server/routes/aprs.js POST /api/aprs/message on a real Express app
 *   - rig-bridge: this plugin's registerRoutes on a real Express app, connected
 *                 to the fake TNC with kiss-tcp
 *   - fake TNC:   a Node net server on 127.0.0.1 that collects the KISS frames and
 *                 decodes them with its own (independent) KISS/AX.25 decoder
 *
 * Asserts the addressing (source/destination/path), the APRS message format
 * (":ADDRESSEE:text", addressee padded to 9) and that every part fits in 67
 * characters — then drops the TNC mid-message and resumes from the first
 * unsent part, as the panel's "Resend remaining parts" does.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import net from 'net';
import express from 'express';
import plugin from './aprs-tnc.js';
import { sendAprsParts } from '../../src/utils/aprsMessageSend.js';
import {
  ics213AprsText,
  splitForAprs,
  newSendState,
  applySendResult,
  firstUnsentPart,
} from '../../src/utils/icsForms.js';

const mountAprsRoutes = require('../../server/routes/aprs.js');
const { buildAx25Frame, encodeKissFrame } = require('../lib/kiss-protocol');

// ── Independent KISS / AX.25 decoder (deliberately not kiss-protocol.js) ─────
const FEND = 0xc0;
const FESC = 0xdb;
const TFEND = 0xdc;
const TFESC = 0xdd;

function splitKiss(buf) {
  const frames = [];
  let cur = null;
  for (const b of buf) {
    if (b === FEND) {
      if (cur && cur.length) frames.push(Buffer.from(cur));
      cur = [];
    } else if (cur) cur.push(b);
  }
  return frames;
}

function unescapeKiss(frame) {
  const out = [];
  for (let i = 0; i < frame.length; i++) {
    if (frame[i] === FESC) {
      i++;
      out.push(frame[i] === TFEND ? FEND : frame[i] === TFESC ? FESC : frame[i]);
    } else out.push(frame[i]);
  }
  return Buffer.from(out);
}

function decodeAddr(buf, off) {
  let call = '';
  for (let i = 0; i < 6; i++) call += String.fromCharCode(buf[off + i] >> 1);
  const ssid = (buf[off + 6] >> 1) & 0x0f;
  call = call.trim();
  return { name: ssid ? `${call}-${ssid}` : call, last: (buf[off + 6] & 1) === 1 };
}

function decodeAx25(kissFrame) {
  const data = unescapeKiss(kissFrame);
  expect(data[0]).toBe(0x00); // KISS data frame, port 0
  const ax = data.subarray(1);
  const dest = decodeAddr(ax, 0);
  const src = decodeAddr(ax, 7);
  const path = [];
  let off = 14;
  let last = src.last;
  while (!last) {
    const d = decodeAddr(ax, off);
    path.push(d.name);
    last = d.last;
    off += 7;
  }
  expect(ax[off]).toBe(0x03); // UI frame
  expect(ax[off + 1]).toBe(0xf0); // no layer 3
  return { dest: dest.name, src: src.name, path, info: ax.subarray(off + 2).toString('ascii') };
}

// ── Harness ─────────────────────────────────────────────────────────────────
const listen = (srv) =>
  new Promise((resolve) => {
    const s = srv.listen(0, '127.0.0.1', () => resolve(s.address().port));
  });

async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for condition');
}

describe('ICS 213 over APRS: panel send path → server → rig-bridge aprs-tnc → KISS TCP', () => {
  let tnc; // fake TNC server
  let tncSockets = [];
  let received = Buffer.alloc(0);
  let tncPort;
  let bridgeHttp;
  let ohcHttp;
  let ohcBase;
  let instance;
  const config = {
    aprs: {
      enabled: true,
      protocol: 'kiss-tcp',
      host: '127.0.0.1',
      port: 0,
      callsign: 'K0CJH',
      ssid: 9,
      beaconInterval: 0,
      serverForward: false,
      // These tests are about splitting and ordering; retries (#1247) are
      // covered in their own test below, which switches them on live.
      messageRetry: false,
    },
  };
  const frames = () => splitKiss(received).map(decodeAx25);
  const fetchOhc = (url, opts) => fetch(`${ohcBase}${url}`, opts);

  const startPlugin = async () => {
    instance = plugin.create(config, {});
    instance.connect();
    await waitFor(() => instance.getStatus().connected);
  };

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    tnc = net.createServer((sock) => {
      tncSockets.push(sock);
      sock.on('data', (d) => {
        received = Buffer.concat([received, d]);
      });
      sock.on('error', () => {});
    });
    tncPort = await listen(tnc);
    config.aprs.port = tncPort;

    // Rig Bridge HTTP side: just this plugin's routes
    const bridge = express();
    bridge.use(express.json());
    plugin.registerRoutes(bridge);
    bridgeHttp = bridge.listen(0, '127.0.0.1');
    await new Promise((r) => bridgeHttp.once('listening', r));
    const bridgePort = bridgeHttp.address().port;

    // OpenHamClock server side: the real APRS routes, pointed at that bridge.
    // The module starts a cleanup interval on mount — keep it off the real clock.
    const ohc = express();
    ohc.use(express.json());
    const noop = () => {};
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    mountAprsRoutes(ohc, {
      CONFIG: { callsign: 'K0CJH', rigControl: { host: 'http://127.0.0.1', port: bridgePort } },
      APP_VERSION: 'test',
      fetch: (...a) => fetch(...a),
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
    });
    vi.useRealTimers();
    ohcHttp = ohc.listen(0, '127.0.0.1');
    await new Promise((r) => ohcHttp.once('listening', r));
    ohcBase = `http://127.0.0.1:${ohcHttp.address().port}`;

    await startPlugin();
  });

  afterAll(async () => {
    instance?.disconnect();
    for (const s of tncSockets) s.destroy();
    await new Promise((r) => tnc.close(r));
    await new Promise((r) => bridgeHttp.close(r));
    await new Promise((r) => ohcHttp.close(r));
    vi.restoreAllMocks();
  });

  it('transmits a short ICS 213 as one APRS message frame', async () => {
    received = Buffer.alloc(0);
    const parts = splitForAprs(ics213AprsText({ subject: 'Water', message: 'Need 200 gal at shelter 3' }));
    expect(parts).toEqual(['Water: Need 200 gal at shelter 3']);

    const r = await sendAprsParts('n0eoc', parts, fetchOhc);
    expect(r).toEqual({ sent: 1, total: 1 });
    await waitFor(() => frames().length === 1);

    const [f] = frames();
    expect(f.src).toBe('K0CJH-9');
    expect(f.dest).toBe('APOHC1');
    expect(f.path).toEqual(['WIDE1-1', 'WIDE2-1']);
    expect(f.info).toBe(':N0EOC    :Water: Need 200 gal at shelter 3');

    // The server kept our side of the conversation for the message history
    const hist = await (await fetchOhc('/api/aprs/messages/history?call=N0EOC')).json();
    expect(hist.messages[0]).toMatchObject({ direction: 'sent', to: 'N0EOC', text: parts[0] });
  });

  it('splits a long ICS 213 into numbered parts of ≤ 67 characters, sent in order', async () => {
    received = Buffer.alloc(0);
    const text = ics213AprsText({
      subject: 'Resource request',
      message:
        'Shelter 3 at Lincoln Elementary needs 200 gallons of potable water, 50 cots, two generators ' +
        'and fuel for 48 hours before 2200 local tonight. Contact the shelter manager on the tactical net.',
    });
    const parts = splitForAprs(text);
    expect(parts.length).toBeGreaterThanOrEqual(3);

    const r = await sendAprsParts('N0EOC', parts, fetchOhc);
    expect(r).toEqual({ sent: parts.length, total: parts.length });
    await waitFor(() => frames().length === parts.length);

    const sent = frames().map((f) => {
      expect(f.info.startsWith(':N0EOC    :')).toBe(true);
      return f.info.slice(11);
    });
    expect(sent).toEqual(parts);
    sent.forEach((p, i) => {
      expect(p.length).toBeLessThanOrEqual(67);
      expect(p.startsWith(`${i + 1}/${parts.length} `)).toBe(true);
    });
    // Reassembling the parts gives back the message
    expect(sent.map((p) => p.replace(/^\d+\/\d+ /, '')).join(' ')).toBe(text);
  });

  it('rejects an over-length part at the server without transmitting', async () => {
    received = Buffer.alloc(0);
    const res = await fetchOhc('/api/aprs/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'N0EOC', message: 'x'.repeat(68) }),
    });
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 50));
    expect(frames().length).toBe(0);
  });

  it('stops when the TNC drops mid-message and resumes from the first unsent part', async () => {
    received = Buffer.alloc(0);
    const parts = splitForAprs(
      'Road closure update: Highway 34 closed at mile 112 eastbound, detour via County Road 12 and ' +
        'Main Street. Expect delays of 45 minutes. Next update at 1900 local from the EOC.',
    );
    expect(parts.length).toBeGreaterThanOrEqual(3);

    // Let the first part through, then pull the plug on the TNC
    let st = newSendState('N0EOC', parts);
    let r = await sendAprsParts('N0EOC', parts.slice(0, 1), fetchOhc);
    st = applySendResult(st, 0, r);
    await waitFor(() => frames().length === 1);
    for (const s of tncSockets) s.destroy();
    tncSockets = [];
    await waitFor(() => !instance.getStatus().connected);

    r = await sendAprsParts('N0EOC', parts.slice(1), fetchOhc);
    expect(r.sent).toBe(0);
    expect(r.error).toMatch(/TNC not connected/);
    st = applySendResult(st, 1, r);
    expect(st.parts.map((p) => p.state)).toEqual(['sent', 'failed', ...parts.slice(2).map(() => 'pending')]);
    expect(firstUnsentPart(st)).toBe(1);

    // TNC back (fresh plugin start, as after a rig-bridge restart) → resume
    instance.disconnect();
    await startPlugin();
    const from = firstUnsentPart(st);
    r = await sendAprsParts('N0EOC', parts.slice(from), fetchOhc);
    st = applySendResult(st, from, r);
    expect(firstUnsentPart(st)).toBe(-1);
    await waitFor(() => frames().length === parts.length);
    // Each part on the air exactly once, in order
    expect(frames().map((f) => f.info.slice(11))).toEqual(parts);
  });

  it('requests an ack from a callsign, marks it delivered, and acks a message sent to us (#1244, #1247)', async () => {
    config.aprs.messageRetry = true; // live setting — no restart
    received = Buffer.alloc(0);
    const bridgeBase = `http://127.0.0.1:${bridgeHttp.address().port}`;
    const post = await fetch(`${bridgeBase}/aprs/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'ke8plm-9', message: 'Status?' }),
    }).then((r) => r.json());
    expect(post).toMatchObject({ success: true, ackRequested: true });
    const id = post.msgId;
    await waitFor(() => frames().length === 1);
    expect(frames()[0].info).toBe(`:KE8PLM-9 :Status?{${id}`);

    // KE8PLM-9 acks over the air
    const sock = tncSockets[tncSockets.length - 1];
    sock.write(encodeKissFrame(buildAx25Frame('KE8PLM-9', 'APY400', ['WIDE1-1'], `:K0CJH-9  :ack${id}`)));
    await waitFor(async () => {
      const list = await fetch(`${bridgeBase}/aprs/messages`).then((r) => r.json());
      return list.messages[0]?.state === 'acked';
    });

    // ...and sends us a message with an id: we ack it
    received = Buffer.alloc(0);
    sock.write(encodeKissFrame(buildAx25Frame('KE8PLM-9', 'APY400', ['WIDE1-1'], ':K0CJH-9  :Roger{77')));
    await waitFor(() => frames().length === 1);
    expect(frames()[0].info).toBe(':KE8PLM-9 :ack77');
    config.aprs.messageRetry = false;
  });
});
