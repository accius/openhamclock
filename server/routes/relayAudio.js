'use strict';
/**
 * relayAudio.js — KiwiSDR audio over the Rig Bridge Cloud Relay (opt-in).
 *
 *   browser  POST /api/rig-bridge/relay/command  kiwiAudioStart { freqKHz, mode }
 *            — signed end-to-end like every relay command (src/utils/relaySign.js);
 *              Rig Bridge refuses it unsigned (it starts a receiver), no grace period
 *   browser  GET  /api/rig-bridge/relay/audio?session=…&ticket=…
 *            — needs the session's read token: X-Relay-Read header, or a one-time
 *              ticket bought with it (POST /relay/stream-ticket) for clients that
 *              cannot send headers; no secret ever goes in the URL
 *   bridge   POST /api/rig-bridge/relay/audio/upload?session=   (relay auth)
 *            → one long chunked request; we copy its body to every listener
 *            → we answer it (ending the upload, and the bridge's Kiwi session)
 *              when the last listener leaves
 *
 * This server never queues audio commands itself: it cannot sign them.
 * Audio arrives as 8-bit µ-law (X-Audio-Format: ulaw, ~12 kB/s); headers
 * X-Sample-Rate / X-Audio-Format / X-CW-Pitch are passed through. Limits:
 * RELAY_AUDIO_MAX_STREAMS concurrent sessions server-wide (default 10),
 * 3 listeners per session; a listener that cannot keep up drops audio
 * instead of buffering it.
 */

const MODES = new Set(['cw', 'usb', 'lsb', 'am']);
const MAX_LISTENERS = 3;
const START_TIMEOUT_MS = 20000;

/**
 * @param {import('express').Express} app
 * @param {{ requireRelayAuth: Function,
 *           canRead: (req: object, sessionId: string) => 'ok'|'denied'|'unpaired-expired',
 *           hasSession: (sessionId: string) => boolean,
 *           logInfo?: Function, logWarn?: Function, maxStreams?: number, startTimeoutMs?: number,
 *           graceMs?: number }} ctx
 */
function registerRelayAudio(app, ctx) {
  const { requireRelayAuth, canRead, hasSession } = ctx;
  const logInfo = ctx.logInfo || (() => {});
  const maxStreams = ctx.maxStreams || Number(process.env.RELAY_AUDIO_MAX_STREAMS) || 10;
  const startTimeoutMs = ctx.startTimeoutMs || START_TIMEOUT_MS;
  const graceMs = ctx.graceMs || 3000;
  const hubs = new Map(); // sessionId → { listeners: Set<res>, upstream, meta, timer }

  const validSession = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(s);

  function headersFor(meta) {
    return {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Sample-Rate': meta.sampleRate,
      'X-Audio-Format': meta.format,
      ...(meta.cwPitch ? { 'X-CW-Pitch': meta.cwPitch } : {}),
      'Access-Control-Expose-Headers': 'X-Sample-Rate, X-Audio-Format, X-CW-Pitch',
    };
  }

  function endUpstream(hub, why) {
    const up = hub.upstream;
    hub.upstream = null;
    hub.meta = null;
    if (!up) return;
    try {
      if (!up.res.headersSent) up.res.status(200).json({ stop: true, reason: why });
    } catch (e) {}
  }

  function dropHub(sessionId, hub, why) {
    if (hub.timer) clearTimeout(hub.timer);
    if (hub.grace) clearTimeout(hub.grace);
    endUpstream(hub, why);
    for (const l of hub.listeners) {
      try {
        if (!l.headersSent) l.status(504).json({ error: why });
        else l.end();
      } catch (e) {}
    }
    hubs.delete(sessionId);
  }

  // ── browser: listen ──
  app.get('/api/rig-bridge/relay/audio', (req, res) => {
    const sessionId = req.query.session;
    const freqKHz = Number(req.query.freq);
    const mode = String(req.query.mode || 'cw').toLowerCase();
    if (!validSession(sessionId)) return res.status(400).json({ error: 'Missing or invalid session' });
    if (!Number.isFinite(freqKHz) || freqKHz < 10 || freqKHz > 32000)
      return res.status(400).json({ error: 'freq must be 10–32000 kHz' });
    if (!MODES.has(mode)) return res.status(400).json({ error: 'mode must be cw, usb, lsb or am' });
    const read = canRead(req, sessionId);
    if (read !== 'ok') {
      return res.status(401).json({
        error:
          read === 'unpaired-expired'
            ? 'This relay session has no command key — re-run Connect Cloud Relay in Settings → Rig Bridge'
            : 'Relay read token missing or wrong — re-run Connect Cloud Relay in Settings → Rig Bridge on this browser',
      });
    }

    let hub = hubs.get(sessionId);
    if (!hub) {
      if (hubs.size >= maxStreams) return res.status(503).json({ error: 'Relay audio is busy — try again later' });
      hub = { listeners: new Set(), upstream: null, meta: null, timer: null, grace: null };
      hubs.set(sessionId, hub);
    }
    if (hub.listeners.size >= MAX_LISTENERS) return res.status(429).json({ error: 'Too many listeners' });
    hub.listeners.add(res);
    res.blocked = false;

    if (hub.meta) {
      res.writeHead(200, headersFor(hub.meta));
      res.flushHeaders?.();
    } else if (!hub.timer) {
      // The browser has sent its signed kiwiAudioStart through /relay/command;
      // we wait for the bridge's upload.
      if (!hasSession(sessionId)) {
        hub.listeners.delete(res);
        if (hub.listeners.size === 0) hubs.delete(sessionId);
        return res.status(503).json({ error: 'Rig Bridge Cloud Relay is not connected for this session' });
      }
      hub.timer = setTimeout(() => {
        hub.timer = null;
        if (!hub.meta && hubs.get(sessionId) === hub) {
          dropHub(
            sessionId,
            hub,
            'Rig Bridge did not start KiwiSDR audio — enable "Relay KiwiSDR audio" in its Cloud Relay plugin and the KiwiSDR Audio plugin, and make sure this browser is paired (Connect Cloud Relay) so the start command is signed',
          );
        }
      }, startTimeoutMs);
    }

    req.on('close', () => {
      hub.listeners.delete(res);
      // Ending the upload ends the bridge's Kiwi session (no command needed)
      if (hub.listeners.size === 0 && hubs.get(sessionId) === hub) dropHub(sessionId, hub, 'no listeners');
    });
  });

  // ── bridge: upload ──
  app.post('/api/rig-bridge/relay/audio/upload', requireRelayAuth, (req, res) => {
    const sessionId = req.relaySessionId;
    const hub = hubs.get(sessionId);
    if (!hub || hub.listeners.size === 0) {
      req.resume();
      return res.status(410).json({ stop: true, reason: 'no listeners' });
    }
    if (hub.upstream) endUpstream(hub, 'replaced');
    if (hub.grace) {
      clearTimeout(hub.grace);
      hub.grace = null;
    }
    if (hub.timer) {
      clearTimeout(hub.timer);
      hub.timer = null;
    }
    const meta = {
      sampleRate: String(Number(req.headers['x-sample-rate']) || 12000),
      format: req.headers['x-audio-format'] === 'ulaw' ? 'ulaw' : 's16be',
      cwPitch: Number(req.headers['x-cw-pitch']) > 0 ? String(Number(req.headers['x-cw-pitch'])) : null,
    };
    hub.upstream = { req, res };
    hub.meta = meta;
    for (const l of hub.listeners) {
      if (!l.headersSent) {
        l.writeHead(200, headersFor(meta));
        l.flushHeaders?.();
      }
    }
    logInfo(`[RigBridge] relay audio flowing for session ${String(sessionId).slice(0, 8)}… (${meta.format})`);

    req.on('data', (chunk) => {
      for (const l of hub.listeners) {
        if (l.blocked) continue; // live audio: drop for a slow listener
        if (!l.write(chunk)) {
          l.blocked = true;
          l.once('drain', () => (l.blocked = false));
        }
      }
    });
    // The bridge rolls its upload over to a fresh request every few minutes
    // (Node's requestTimeout), so an upload that finishes is given a short
    // grace period for its successor before the listeners are let go.
    const finished = () => {
      if (!hub.upstream || hub.upstream.req !== req) return;
      try {
        if (!res.headersSent) res.status(200).json({ stop: true, reason: 'upload ended' });
      } catch (e) {}
      if (hub.grace) return;
      hub.grace = setTimeout(() => {
        hub.grace = null;
        if (!hub.upstream || hub.upstream.req !== req) return; // a successor took over
        hub.upstream = null;
        for (const l of hub.listeners) {
          try {
            l.end();
          } catch (e) {}
        }
        if (hubs.get(sessionId) === hub) hubs.delete(sessionId);
      }, graceMs);
    };
    req.on('end', finished);
    req.on('close', finished);
  });

  return {
    /** For tests / status: active relay audio sessions. */
    get activeSessions() {
      return hubs.size;
    },
  };
}

module.exports = { registerRelayAudio };
