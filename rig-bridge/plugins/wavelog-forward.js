'use strict';
/**
 * wavelog-forward.js — forward QSOs from a logger to Wavelog
 *
 * Listens for the "QSO logged" ADIF packets that N1MM-compatible loggers
 * broadcast over UDP (RUMlogNG: UDP → "Contact info ADIF" or
 * "Contact N1MM & ADIF") and posts each record to Wavelog's API
 * (POST <url>/index.php/api/qso, type "adif").
 *
 * Every QSO is queued to disk before delivery, so nothing is lost while
 * Wavelog or the network is down; the queue is retried with backoff and
 * survives restarts. Wavelog skips duplicates on import, so a retry never
 * double-logs. A QSO Wavelog rejects outright (4xx other than 429, e.g. a
 * bad API key) is dropped and reported rather than retried forever.
 *
 * Only new QSOs are forwarded: edits and deletes arrive as N1MM
 * <contactreplace>/<contactdelete> packets, which Wavelog's API cannot apply.
 */

const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { CONFIG_DIR } = require('../core/config');
const { parseLoggedAdifPacket, describeAdif } = require('../lib/logged-adif');

const MAX_QUEUE = 1000; // oldest entries are dropped beyond this
const MAX_RETRY_MS = 60000;
const REQUEST_TIMEOUT_MS = 15000;

let _currentInstance = null;

function postJson(urlStr, body, callback) {
  let url;
  try {
    url = new URL(urlStr);
  } catch (e) {
    return callback(e);
  }
  const payload = JSON.stringify(body);
  const req = (url.protocol === 'https:' ? https : http).request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    },
    (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => callback(null, res.statusCode, data));
    },
  );
  req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('request timed out')));
  req.on('error', (e) => callback(e));
  req.end(payload);
}

const descriptor = {
  id: 'wavelog-forward',
  name: 'Wavelog QSO Forwarder',
  category: 'integration',
  configKey: 'wavelogForward',

  registerRoutes(app) {
    app.get('/api/wavelog-forward/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
  },

  create(config) {
    const cfg = config.wavelogForward || {};
    const baseUrl = (cfg.url || '').replace(/\/+$/, '');
    const apiKey = cfg.apiKey || '';
    const stationProfileId = cfg.stationProfileId != null ? String(cfg.stationProfileId) : '';
    const udpPort = cfg.udpPort || 12060;
    const udpBindAddress = cfg.udpBindAddress || '0.0.0.0';
    const queueFile = cfg.queueFile || path.join(CONFIG_DIR, 'wavelog-forward-queue.json');
    const retryBaseMs = cfg.retryBaseMs || 2000;
    const verbose = !!cfg.verbose;

    let socket = null;
    let running = false;
    let sending = false;
    let retryTimer = null;
    let failures = 0;
    let queue = [];
    let forwarded = 0;
    let rejected = 0;
    let lastError = null;
    let lastForwarded = null;

    function loadQueue() {
      try {
        const saved = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
        if (Array.isArray(saved)) queue = saved.filter((q) => typeof q === 'string');
      } catch (e) {
        if (e.code !== 'ENOENT') console.error(`[WavelogForward] Ignoring unreadable queue ${queueFile}: ${e.message}`);
      }
    }

    function saveQueue() {
      try {
        const tmp = `${queueFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(queue));
        fs.renameSync(tmp, queueFile);
      } catch (e) {
        console.error(`[WavelogForward] Could not save queue: ${e.message}`);
      }
    }

    function enqueue(adif) {
      queue.push(adif);
      if (queue.length > MAX_QUEUE) {
        const dropped = queue.splice(0, queue.length - MAX_QUEUE);
        console.error(`[WavelogForward] Queue full; dropped ${dropped.length} oldest QSO(s)`);
      }
      saveQueue();
      sendNext();
    }

    function scheduleRetry() {
      failures++;
      const delay = Math.min(retryBaseMs * 2 ** (failures - 1), MAX_RETRY_MS);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        sendNext();
      }, delay);
    }

    function sendNext() {
      if (!running || sending || retryTimer || queue.length === 0) return;
      sending = true;
      const adif = queue[0];
      postJson(
        `${baseUrl}/index.php/api/qso`,
        { key: apiKey, station_profile_id: stationProfileId, type: 'adif', string: adif },
        (err, status, data) => {
          sending = false;
          if (!running) return;
          const what = describeAdif(adif);
          if (!err && status >= 200 && status < 300) {
            queue.shift();
            saveQueue();
            failures = 0;
            forwarded++;
            lastForwarded = what;
            console.log(`[WavelogForward] Forwarded ${what}`);
            return sendNext();
          }
          const retryable = err || status === 429 || status >= 500;
          lastError = err ? err.message : `HTTP ${status}: ${String(data || '').slice(0, 200)}`;
          if (retryable) {
            if (verbose || failures === 0)
              console.error(`[WavelogForward] ${what} not delivered, will retry: ${lastError}`);
            return scheduleRetry();
          }
          // Wavelog refused this record (bad key, bad ADIF): don't block the queue on it.
          queue.shift();
          saveQueue();
          rejected++;
          console.error(`[WavelogForward] Wavelog rejected ${what}: ${lastError}`);
          sendNext();
        },
      );
    }

    function connect() {
      if (!baseUrl || !apiKey || !stationProfileId) {
        lastError = 'url, apiKey and stationProfileId are required';
        console.error(`[WavelogForward] Cannot start: ${lastError}`);
        return;
      }
      loadQueue();
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('message', (msg) => {
        const adif = parseLoggedAdifPacket(msg);
        if (!adif) return;
        if (verbose) console.log(`[WavelogForward] Logged: ${describeAdif(adif)}`);
        enqueue(adif);
      });
      socket.on('error', (e) => {
        lastError = `UDP ${udpBindAddress}:${udpPort}: ${e.message}`;
        console.error(`[WavelogForward] ${lastError}`);
      });
      socket.bind(udpPort, udpBindAddress, () => {
        running = true;
        console.log(
          `[WavelogForward] Listening on UDP ${udpBindAddress}:${udpPort}, forwarding to ${baseUrl}` +
            (queue.length ? ` (${queue.length} queued)` : ''),
        );
        sendNext();
      });
      _currentInstance = instance;
    }

    function disconnect() {
      running = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (socket) {
        try {
          socket.close();
        } catch (e) {}
        socket = null;
      }
      if (_currentInstance === instance) _currentInstance = null;
    }

    function getStatus() {
      return {
        enabled: !!cfg.enabled,
        running,
        udpPort,
        url: baseUrl,
        forwarded,
        rejected,
        queued: queue.length,
        lastForwarded,
        lastError,
      };
    }

    const instance = { connect, disconnect, getStatus };
    return instance;
  },
};

module.exports = descriptor;
