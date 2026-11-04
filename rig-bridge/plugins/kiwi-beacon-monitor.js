'use strict';
/**
 * kiwi-beacon-monitor.js — automated NCDXF/IBP beacon SNR logging through a KiwiSDR
 *
 * Connects to one KiwiSDR over its audio WebSocket (same handshake as
 * kiwiclient/kiwirecorder), follows the International Beacon Project
 * schedule in UTC and, every 10-second slot, retunes to the beacon that is
 * transmitting on the band whose turn it is, reads the Kiwi's S-meter during
 * seconds 1–9 of the slot and records SNR against a per-band noise floor.
 *
 * Measurements are kept in a local ring buffer (served to the browser from
 * GET /api/beacon-monitor/measurements) and, when serverForward is on,
 * POSTed in batches to the OpenHamClock server's /api/ibp/measurements so
 * the hosted/remote UI and the Prediction Check panel can use them.
 *
 * Config section: config.beaconMonitor
 *   enabled:       boolean  (default: false)
 *   host:          string   KiwiSDR host (no scheme)
 *   port:          number   KiwiSDR port (default: 8073)
 *   password:      string   Kiwi user password, if the receiver needs one
 *   bands:         array|string  '20m','17m','15m','12m','10m' (default: all five)
 *   callsign:      string   listening station callsign (identity for the server store)
 *   grid:          string   listening station / Kiwi grid locator
 *   lat, lon:      number   listening station / Kiwi coordinates (optional)
 *   serverForward: boolean  POST batches to the OpenHamClock server (default: true)
 *   ohcUrl:        string   OpenHamClock server URL (default: 'http://localhost:3000')
 *   ohcApiKey:     string   that server's API_WRITE_KEY, if it has one
 *   verbose:       boolean  log every measurement (default: false)
 *
 * API endpoints (served by the bridge, no auth — read-only):
 *   GET /api/beacon-monitor/status
 *   GET /api/beacon-monitor/measurements?band=20m&hours=24&since=<ms>
 *
 * Etiquette: ONE socket per Kiwi. Public receivers often cap session length
 * per IP — the monitor reconnects with backoff, but a receiver you own (or
 * have permission to park on) is the intended use.
 */

const http = require('http');
const https = require('https');
const { KiwiConnection } = require('../lib/kiwi-connection');
const { BeaconSampler, resolveBands } = require('../lib/beacon-sampler');
const { CYCLE_MS } = require('../lib/ibp-schedule');

const TICK_MS = 250;
const FLUSH_INTERVAL_MS = CYCLE_MS; // one POST per 3-minute cycle at most
const FLUSH_THRESHOLD = 36; // …or sooner once two cycles' worth has piled up
const FORWARD_QUEUE_MAX = 2000;
const CW_LOW_CUT = 300;
const CW_HIGH_CUT = 700;

let _currentInstance = null;

function clampHours(v, dflt = 24) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(168, n);
}

const descriptor = {
  id: 'kiwi-beacon-monitor',
  name: 'KiwiSDR Beacon Monitor',
  category: 'monitor',
  configKey: 'beaconMonitor',

  registerRoutes(app) {
    app.get('/api/beacon-monitor/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });

    app.get('/api/beacon-monitor/measurements', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false, measurements: [] });
      const hours = clampHours(req.query.hours, 24);
      const since = Number(req.query.since);
      const sinceMs = Number.isFinite(since) && since > 0 ? since : Date.now() - hours * 3600 * 1000;
      const band = typeof req.query.band === 'string' && req.query.band ? req.query.band.toLowerCase() : null;
      const status = _currentInstance.getStatus();
      res.json({
        enabled: status.enabled,
        running: status.running,
        connected: status.connected,
        station: status.station,
        kiwi: status.kiwi,
        measurements: _currentInstance.getMeasurements({ sinceMs, band }),
      });
    });
  },

  create(config, services = {}) {
    const live = () => config.beaconMonitor || {};
    const cfg0 = live();
    const bands = resolveBands(cfg0.bands);
    const host = String(cfg0.host || '').trim();
    const port = Number(cfg0.port) || 8073;

    const sampler = new BeaconSampler({ bands });
    let conn = null;
    let tickTimer = null;
    let flushTimer = null;
    let running = false;
    let currentSlotStart = null;
    let currentTarget = null;
    let lastMeasurement = null;
    let measurementCount = 0;
    let lastPost = null; // { at, ok, status, error, count }
    let paused = null; // { reason, since } while another listener has the receiver slot
    const forwardQueue = [];

    const verbose = () => !!live().verbose;
    const forwardEnabled = () => live().serverForward !== false;
    const forwardUrl = () => {
      const base = String(live().ohcUrl || 'http://localhost:3000').replace(/\/$/, '');
      try {
        return new URL(`${base}/api/ibp/measurements`);
      } catch (e) {
        return null;
      }
    };
    const station = () => {
      const c = live();
      const out = {};
      if (c.callsign) out.callsign = String(c.callsign).trim().toUpperCase();
      if (c.grid) out.grid = String(c.grid).trim();
      if (Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)) && c.lat !== '' && c.lon !== '') {
        out.lat = Number(c.lat);
        out.lon = Number(c.lon);
      }
      return out;
    };
    const kiwiInfo = () => ({ id: `${host}:${port}`, host, port, name: live().name || undefined });

    function log(msg) {
      console.log(`[BeaconMonitor] ${msg}`);
    }

    // ── Forwarding to the OpenHamClock server ───────────────────────────
    function flushForwardQueue() {
      if (!forwardQueue.length || !forwardEnabled()) return;
      const target = forwardUrl();
      if (!target) return;
      const batch = forwardQueue.slice(0, 500);
      const body = JSON.stringify({ station: station(), kiwi: kiwiInfo(), measurements: batch });
      const mod = target.protocol === 'https:' ? https : http;
      const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
      const key = String(live().ohcApiKey || '').trim();
      if (key) headers.Authorization = `Bearer ${key}`;
      const req = mod.request(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: target.pathname,
          method: 'POST',
          headers,
        },
        (res) => {
          res.resume();
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          lastPost = { at: Date.now(), ok, status: res.statusCode, count: batch.length };
          if (ok) {
            forwardQueue.splice(0, batch.length);
          } else if (res.statusCode === 401 || res.statusCode === 400) {
            // Rejected for good — do not resend the same batch forever.
            forwardQueue.splice(0, batch.length);
            log(`server rejected batch (${res.statusCode}) — check ohcUrl / ohcApiKey`);
          }
        },
      );
      req.on('error', (err) => {
        lastPost = { at: Date.now(), ok: false, error: err.message, count: batch.length };
      });
      req.setTimeout(8000, () => req.destroy(new Error('timeout')));
      req.write(body);
      req.end();
    }

    function enqueueForward(m) {
      if (!forwardEnabled()) return;
      forwardQueue.push(m);
      if (forwardQueue.length > FORWARD_QUEUE_MAX) forwardQueue.splice(0, forwardQueue.length - FORWARD_QUEUE_MAX);
      if (forwardQueue.length >= FLUSH_THRESHOLD) flushForwardQueue();
    }

    // ── Slot scheduler ──────────────────────────────────────────────────
    function tick() {
      const now = Date.now();
      const target = sampler.targetFor(now);
      if (target.slotStart === currentSlotStart) return;
      currentSlotStart = target.slotStart;
      currentTarget = target;

      const finished = sampler.beginSlot(now);
      if (finished) {
        lastMeasurement = finished;
        measurementCount++;
        enqueueForward(finished);
        if (verbose()) {
          log(
            `${finished.band} ${finished.beacon.padEnd(6)} SNR ${finished.snrDb >= 0 ? '+' : ''}${finished.snrDb} dB ` +
              `(level ${finished.levelDbm} dBm, noise ${finished.noiseDbm} dBm, n=${finished.n})`,
          );
        }
      }
      if (conn) conn.tune(target.band.mhz * 1000, { mode: 'cw', lowCut: CW_LOW_CUT, highCut: CW_HIGH_CUT });
    }

    function openConn() {
      const first = sampler.targetFor(Date.now());
      conn = new KiwiConnection({
        host,
        port,
        password: cfg0.password == null ? '' : String(cfg0.password),
        ident: 'OpenHamClock',
        tuning: { freqKHz: first.band.mhz * 1000, mode: 'cw', lowCut: CW_LOW_CUT, highCut: CW_HIGH_CUT },
        log: (m) => log(m),
      });
      conn.on('smeter', ({ dbm, t }) => sampler.addSample(dbm, t));
      conn.on('ready', () => {
        const target = sampler.targetFor(Date.now());
        conn.tune(target.band.mhz * 1000, { mode: 'cw', lowCut: CW_LOW_CUT, highCut: CW_HIGH_CUT });
      });
      conn.on('close', ({ wasReady, code }) => {
        if (wasReady) log(`Kiwi connection closed (code ${code}) — will reconnect`);
      });
      conn.on('reconnect', ({ inMs, attempt }) => {
        if (attempt > 1 || verbose()) log(`reconnecting in ${Math.round(inMs / 1000)} s (attempt ${attempt})`);
      });
      conn.on('error', (err) => {
        if (verbose()) log(`socket error: ${err && err.message ? err.message : err}`);
      });
      conn.connect();
    }

    function closeConn() {
      if (!conn) return;
      try {
        conn.close();
      } catch (e) {}
      conn = null;
    }

    function connect() {
      if (!host) {
        log('no KiwiSDR host configured — set beaconMonitor.host in the setup UI');
        return;
      }
      running = true;
      log(`monitoring ${bands.map((b) => b.label).join('/')} via KiwiSDR ${host}:${port}`);
      openConn();

      tickTimer = setInterval(tick, TICK_MS);
      flushTimer = setInterval(flushForwardQueue, FLUSH_INTERVAL_MS);
      tick();
    }

    function disconnect() {
      running = false;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      if (flushTimer) clearInterval(flushTimer);
      flushTimer = null;
      closeConn();
      paused = null;
      flushForwardQueue();
      if (_currentInstance === instance) _currentInstance = null;
      log('Stopped');
    }

    /**
     * Give the receiver slot to someone else (the Decoder panel's KiwiSDR
     * audio) — the Kiwi socket closes, the schedule keeps ticking, and slots
     * without readings simply produce no measurement. resume() reconnects.
     */
    function pause(reason = 'paused') {
      if (!running || paused) return false;
      paused = { reason, since: Date.now() };
      closeConn();
      log(`paused (${reason}) — receiver slot released`);
      return true;
    }

    function resume() {
      if (!running || !paused) return false;
      paused = null;
      log('resumed');
      openConn();
      return true;
    }

    function getMeasurements({ sinceMs = 0, band = null } = {}) {
      return sampler.query({ sinceMs, band });
    }

    function getStatus() {
      return {
        enabled: !!live().enabled,
        running,
        paused: paused ? { reason: paused.reason, since: paused.since } : null,
        connected: !!(conn && conn.connected),
        state: conn ? conn.state : 'idle',
        host,
        port,
        kiwi: kiwiInfo(),
        station: station(),
        bands: bands.map((b) => b.label),
        currentBand: currentTarget ? currentTarget.band.label : null,
        currentBeacon: currentTarget ? currentTarget.beacon.callsign : null,
        sampleRate: conn ? conn.sampleRate : null,
        framesRx: conn ? conn.framesRx : 0,
        lastFrameAt: conn ? conn.lastFrameAt : 0,
        measurementCount,
        lastMeasurement,
        lastError: conn ? conn.lastError : null,
        lastRejection: conn ? conn.lastRejection : null,
        serverForward: forwardEnabled(),
        ohcUrl: forwardEnabled() ? String(forwardUrl()?.origin || '') : undefined,
        queued: forwardQueue.length,
        lastPost,
      };
    }

    const instance = {
      connect,
      disconnect,
      getStatus,
      getMeasurements,
      pause,
      resume,
      get host() {
        return host;
      },
      get port() {
        return port;
      },
      get running() {
        return running;
      },
      _sampler: sampler,
    };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
/** The running monitor instance, if any (used by kiwi-audio to share the receiver). */
module.exports.getActive = () => _currentInstance;
