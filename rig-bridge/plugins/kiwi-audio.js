'use strict';
/**
 * kiwi-audio.js — relay a KiwiSDR's demodulated audio to the browser
 *
 * Feeds the OpenHamClock Decoder panel (CW decoder, FT8 decoder, waterfall)
 * with what a KiwiSDR actually hears. The browser cannot talk to a Kiwi itself
 * (the hosted site is HTTPS, Kiwis are plain ws://, and the Kiwi protocol
 * needs a handshake), so the bridge holds the Kiwi socket and streams raw
 * audio — directly over HTTP, or through the Cloud Relay (cloud-relay.js
 * opens a session with openSession()).
 *
 * ON DEMAND ONLY: nothing connects to the receiver until a listener opens a
 * session, and the Kiwi socket is closed the moment it ends. One session at a
 * time — a new one replaces the old, so a forgotten tab never holds two
 * receiver slots.
 *
 * Receiver slots: when the KiwiSDR Beacon Monitor runs on the same receiver
 * it is paused while someone listens and resumed afterwards, so only one slot
 * is used (kiwiAudio.beaconMonitor: 'pause' (default) | 'keep').
 *
 * CW pitch: a Kiwi demodulates CW as upper sideband relative to the frequency
 * it is sent; its own web UI subtracts the passband centre ("pbc") so the
 * station on the entered frequency is heard at that pitch. We do the same with
 * KIWI_CW_PITCH_HZ, so a CW station on the entered frequency arrives at 600 Hz
 * — the Decoder panel's default tone (sent to the browser as X-CW-Pitch).
 *
 * Config section: config.kiwiAudio
 *   enabled:       boolean (default false)
 *   host:          KiwiSDR host (no scheme) — falls back to beaconMonitor.host
 *   port:          number (default 8073)  — falls back to beaconMonitor.port
 *   password:      Kiwi user password     — falls back to beaconMonitor.password
 *   beaconMonitor: 'pause' | 'keep'        what to do with a beacon monitor on the same Kiwi
 *
 * Routes:
 *   GET  /api/kiwi-audio/status                                (open — no secrets in it)
 *   GET  /api/kiwi-audio/stream?freq=<kHz>&mode=cw&codec=s16be (token) → 200 application/octet-stream
 *        headers X-Sample-Rate (Hz, may be fractional), X-Audio-Format (s16be | ulaw),
 *        X-CW-Pitch (Hz, cw mode); body = mono audio, continuously, until either side closes.
 *   POST /api/kiwi-audio/tune  { freqKHz, mode }                (token) retune the live session
 *   POST /api/kiwi-audio/stop                                   (token) end the live session
 */

const { KiwiConnection } = require('../lib/kiwi-connection');
const { encodeS16be } = require('../lib/mulaw');

const READY_TIMEOUT_MS = 15000;
const KIWI_CW_PITCH_HZ = 600;

/**
 * Passband per mode, in audio Hz relative to the frequency sent to the Kiwi.
 * CW is centred on KIWI_CW_PITCH_HZ (and the sent frequency offset by it);
 * USB covers FT8's 200–3000 Hz.
 */
const PASSBANDS = {
  cw: { lowCut: KIWI_CW_PITCH_HZ - 400, highCut: KIWI_CW_PITCH_HZ + 400, pbcHz: KIWI_CW_PITCH_HZ },
  usb: { lowCut: 100, highCut: 3000, pbcHz: 0 },
  lsb: { lowCut: -2800, highCut: -200, pbcHz: 0 },
  am: { lowCut: -4000, highCut: 4000, pbcHz: 0 },
};
const CODECS = new Set(['s16be', 'ulaw']);

let _currentInstance = null;

function parseTune(freq, mode) {
  const freqKHz = Number(freq);
  if (!Number.isFinite(freqKHz) || freqKHz < 10 || freqKHz > 32000) return { error: 'freq must be 10–32000 kHz' };
  const m = String(mode || 'cw').toLowerCase();
  if (!PASSBANDS[m]) return { error: `mode must be one of ${Object.keys(PASSBANDS).join(', ')}` };
  const pb = PASSBANDS[m];
  // kiwiKHz: what the Kiwi is told (carrier); freqKHz: what the user asked for
  return { freqKHz, mode: m, lowCut: pb.lowCut, highCut: pb.highCut, kiwiKHz: freqKHz - pb.pbcHz / 1000 };
}

function receiverConfig(config) {
  const a = config.kiwiAudio || {};
  const b = config.beaconMonitor || {};
  const host = String(a.host || b.host || '').trim();
  const usesBeacon = !String(a.host || '').trim() && !!host;
  const port = Number(a.port) || (usesBeacon ? Number(b.port) : 0) || 8073;
  const password = a.password != null && a.password !== '' ? a.password : usesBeacon ? b.password || '' : '';
  return { host, port, password, usesBeacon };
}

function loadBeaconMonitor() {
  try {
    return require('./kiwi-beacon-monitor');
  } catch (e) {
    return null;
  }
}

/** An HTTP response as a session sink. */
function httpSink(res) {
  return {
    start(meta) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Sample-Rate': String(meta.sampleRate),
        'X-Audio-Format': meta.codec,
        ...(meta.cwPitchHz ? { 'X-CW-Pitch': String(meta.cwPitchHz) } : {}),
        'Access-Control-Expose-Headers': 'X-Sample-Rate, X-Audio-Format, X-CW-Pitch',
      });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
    },
    write(buf, onDrain) {
      const ok = res.write(buf);
      if (!ok) res.once('drain', onDrain);
      return ok;
    },
    fail(status, error) {
      try {
        if (!res.headersSent) res.status(status).json({ error });
        else res.end();
      } catch (e) {}
    },
    end() {
      try {
        res.end();
      } catch (e) {}
    },
  };
}

const descriptor = {
  id: 'kiwi-audio',
  name: 'KiwiSDR Audio (Decoder panel)',
  category: 'monitor',
  configKey: 'kiwiAudio',

  registerRoutes(app) {
    app.get('/api/kiwi-audio/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false, streaming: false });
      res.json(_currentInstance.getStatus());
    });
  },

  registerAuthRoutes(app, requireAuth) {
    app.get('/api/kiwi-audio/stream', requireAuth, (req, res) => {
      if (!_currentInstance) {
        return res.status(503).json({ error: 'KiwiSDR audio is not enabled in Rig Bridge' });
      }
      const t = parseTune(req.query.freq, req.query.mode);
      if (t.error) return res.status(400).json({ error: t.error });
      const codec = String(req.query.codec || 's16be').toLowerCase();
      if (!CODECS.has(codec)) return res.status(400).json({ error: 'codec must be s16be or ulaw' });
      const session = _currentInstance.openSession({ tuning: t, codec, sink: httpSink(res) });
      req.on('close', () => session.stop('listener disconnected'));
    });

    app.post('/api/kiwi-audio/tune', requireAuth, (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'KiwiSDR audio is not enabled in Rig Bridge' });
      const body = req.body || {};
      const t = parseTune(body.freqKHz, body.mode);
      if (t.error) return res.status(400).json({ error: t.error });
      const ok = _currentInstance.tune(t);
      res.json({ success: ok, tuning: _currentInstance.getStatus().tuning });
    });

    app.post('/api/kiwi-audio/stop', requireAuth, (req, res) => {
      if (_currentInstance) _currentInstance.stopSession('stopped by request');
      res.json({ success: true });
    });
  },

  create(config, services = {}) {
    const log = (msg) => console.log(`[KiwiAudio] ${msg}`);
    const ConnectionImpl = services.KiwiConnection || KiwiConnection;
    const beaconModule = services.beaconMonitor !== undefined ? services.beaconMonitor : loadBeaconMonitor();
    let running = false;
    let session = null; // { conn, sink, tuning, codec, startedAt, bytes, dropped, blocked, timer, started, pausedBeacon }
    let lastError = null;

    /** Pause a beacon monitor parked on the same Kiwi; returns it (to resume) or null. */
    function takeBeaconSlot(rx) {
      if (String((config.kiwiAudio || {}).beaconMonitor || 'pause') === 'keep') return null;
      const bm = beaconModule && typeof beaconModule.getActive === 'function' ? beaconModule.getActive() : null;
      if (!bm || !bm.running || typeof bm.pause !== 'function') return null;
      const same = String(bm.host).toLowerCase() === rx.host.toLowerCase() && Number(bm.port) === Number(rx.port);
      if (!same) return null;
      return bm.pause('Decoder panel is listening') ? bm : null;
    }

    function endSession(s, reason, failStatus) {
      if (!s || s.ended) return;
      s.ended = true;
      if (session === s) session = null;
      try {
        s.conn.removeAllListeners();
        s.conn.on('error', () => {});
        s.conn.close();
      } catch (e) {}
      if (s.timer) clearTimeout(s.timer);
      if (s.started) s.sink.end();
      else s.sink.fail(failStatus || 503, reason || 'stream closed');
      if (s.pausedBeacon) {
        try {
          s.pausedBeacon.resume();
        } catch (e) {}
      }
      if (reason) log(`stream ended (${reason})`);
    }

    function stopSession(reason) {
      endSession(session, reason);
    }

    /**
     * Open the (single) listening session.
     * @param {{ tuning: object, codec?: 's16be'|'ulaw', sink: { start(meta), write(buf, onDrain): boolean, fail(status, error), end() } }} opts
     * @returns {{ stop(reason?: string): void, tune(t): boolean }}
     */
    function openSession({ tuning, codec = 's16be', sink }) {
      const rx = receiverConfig(config);
      const handle = { stop: () => {}, tune: () => false };
      if (!rx.host) {
        sink.fail(503, 'No KiwiSDR host configured (kiwiAudio.host or beaconMonitor.host)');
        return handle;
      }
      // One receiver slot at a time: a new listener replaces the old one.
      if (session) endSession(session, 'replaced by a new stream');

      const pausedBeacon = takeBeaconSlot(rx);
      const conn = new ConnectionImpl({
        host: rx.host,
        port: rx.port,
        password: rx.password,
        ident: 'OpenHamClock decoder',
        tuning: { freqKHz: tuning.kiwiKHz, mode: tuning.mode, lowCut: tuning.lowCut, highCut: tuning.highCut },
        reconnect: { enabled: true, minMs: 2000, maxMs: 30000 },
        log: (m) => log(m),
      });
      const s = {
        conn,
        sink,
        tuning,
        codec,
        startedAt: Date.now(),
        bytes: 0,
        dropped: 0,
        blocked: false,
        timer: null,
        started: false,
        ended: false,
        pausedBeacon,
      };
      session = s;

      s.timer = setTimeout(() => {
        if (session === s && !s.started) {
          lastError = conn.lastError || 'KiwiSDR did not answer';
          endSession(s, lastError, 504);
        }
      }, READY_TIMEOUT_MS);

      conn.on('ready', ({ sampleRate }) => {
        if (session !== s || s.started) return;
        clearTimeout(s.timer);
        s.timer = null;
        lastError = null;
        s.started = true;
        s.sink.start({ sampleRate, codec, cwPitchHz: tuning.mode === 'cw' ? KIWI_CW_PITCH_HZ : 0 });
        log(
          `streaming ${tuning.freqKHz} kHz ${tuning.mode} (${codec}) from ${rx.host}:${rx.port} @ ${sampleRate} Hz` +
            (pausedBeacon ? ' — beacon monitor paused' : ''),
        );
      });
      conn.on('audio', ({ pcm }) => {
        if (session !== s || !s.started) return;
        // Live audio: never queue behind a slow listener — drop until it drains.
        if (s.blocked) {
          s.dropped += pcm.length;
          return;
        }
        const out = codec === 'ulaw' ? encodeS16be(pcm) : pcm;
        s.bytes += out.length;
        if (!s.sink.write(out, () => (s.blocked = false))) s.blocked = true;
      });
      conn.on('rejected', (ev) => {
        lastError = ev.reason;
        endSession(s, `rejected by KiwiSDR: ${ev.reason}`);
      });
      conn.on('error', (err) => {
        lastError = err && err.message ? err.message : String(err);
      });
      conn.connect();

      handle.stop = (reason) => endSession(s, reason);
      handle.tune = (t) => {
        if (session !== s) return false;
        s.tuning = t;
        return conn.tune(t.kiwiKHz, { mode: t.mode, lowCut: t.lowCut, highCut: t.highCut });
      };
      return handle;
    }

    function tune(t) {
      if (!session) return false;
      session.tuning = t;
      return session.conn.tune(t.kiwiKHz, { mode: t.mode, lowCut: t.lowCut, highCut: t.highCut });
    }

    function getStatus() {
      const rx = receiverConfig(config);
      const s = session;
      return {
        enabled: !!(config.kiwiAudio && config.kiwiAudio.enabled),
        running,
        configured: !!rx.host,
        host: rx.host || null,
        port: rx.port,
        sharedWithBeaconMonitor: rx.usesBeacon,
        beaconMonitorPolicy: String((config.kiwiAudio || {}).beaconMonitor || 'pause'),
        beaconMonitorPaused: !!(s && s.pausedBeacon),
        cwPitchHz: KIWI_CW_PITCH_HZ,
        streaming: !!s,
        connected: !!(s && s.conn.connected),
        sampleRate: s ? s.conn.sampleRate : null,
        codec: s ? s.codec : null,
        tuning: s ? { freqKHz: s.tuning.freqKHz, mode: s.tuning.mode } : null,
        startedAt: s ? s.startedAt : null,
        bytes: s ? s.bytes : 0,
        lastError,
      };
    }

    const instance = {
      connect() {
        running = true;
        log('ready — connects to the KiwiSDR only while a Decoder panel listens');
      },
      disconnect() {
        running = false;
        stopSession('plugin stopped');
        if (_currentInstance === instance) _currentInstance = null;
      },
      openSession,
      stopSession,
      tune,
      getStatus,
    };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
module.exports.parseTune = parseTune;
module.exports.receiverConfig = receiverConfig;
module.exports.KIWI_CW_PITCH_HZ = KIWI_CW_PITCH_HZ;
/** The running instance, if any (the Cloud Relay opens sessions through it). */
module.exports.getActive = () => _currentInstance;
