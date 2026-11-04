'use strict';
/**
 * hamalert.js — HamAlert spot feed plugin
 *
 * Keeps one persistent telnet session to HamAlert (hamalert.org:7300)
 * logged in with your HamAlert username/password, parses the alert lines
 * HamAlert pushes ("DX de HAMALERT: 14074.0 DL1ABC FT8 -12 dB [pskreporter]
 * 1234Z") and forwards them to the browser:
 *
 *   • local / LAN mode — pluginBus 'hamalert' → rig-bridge.js broadcasts
 *     { type:'plugin', event:'hamalert', source:'hamalert', data } on /stream
 *   • cloud relay mode — cloud-relay.js batches the same objects as
 *     `hamAlerts` in its state push; the OHC server fans them out to the
 *     browser's relay SSE stream
 *
 * Config section: config.hamalert
 *   enabled:   boolean  (default: false)
 *   username:  string   HamAlert username
 *   password:  string   HamAlert password
 *   host:      string   (default: 'hamalert.org')
 *   port:      number   (default: 7300)
 *   verbose:   boolean  Log every alert (default: false)
 *
 * API endpoints:
 *   GET /api/hamalert/status   Connection state + counters (no credentials)
 *   GET /api/hamalert/alerts   Last 200 alerts (newest first) for late joiners
 */

const { createHamAlertClient } = require('../lib/hamalert-client');
const { hamAlertKey } = require('../lib/hamalert-parser');

const RING_MAX = 200;

let _currentInstance = null;

const descriptor = {
  id: 'hamalert',
  name: 'HamAlert',
  // Spot-feed plugin; runs in parallel with the rig plugin like the other
  // integrations (the registry starts every enabled 'integration' plugin).
  category: 'integration',
  kind: 'spots',
  configKey: 'hamalert',

  registerRoutes(app) {
    app.get('/api/hamalert/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
    app.get('/api/hamalert/alerts', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, alerts: [] });
      res.json({ enabled: true, alerts: _currentInstance.getAlerts() });
    });
  },

  create(config, services) {
    const cfg = config.hamalert || {};
    const { pluginBus, updateState } = services || {};
    const verbose = !!cfg.verbose;

    const ring = [];
    const seen = new Map(); // key → timestamp, for de-dupe of re-sent lines
    let client = null;
    let status = { enabled: false, connected: false };

    function remember(alert) {
      const key = hamAlertKey(alert);
      const now = Date.now();
      // Evict de-dupe keys older than 30 min
      if (seen.size > 1000) {
        for (const [k, t] of seen) if (now - t > 30 * 60 * 1000) seen.delete(k);
      }
      if (seen.has(key)) return false;
      seen.set(key, now);
      ring.unshift(alert);
      if (ring.length > RING_MAX) ring.length = RING_MAX;
      return true;
    }

    function connect() {
      client = createHamAlertClient({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: cfg.password,
        log: (msg) => console.log(msg),
        onStatus: (s) => {
          status = s;
          // Mirror a boolean into shared state so /status consumers can see it
          if (typeof updateState === 'function') updateState('hamalertConnected', !!s.loggedIn);
        },
        onAlert: (alert) => {
          if (!remember(alert)) return;
          if (verbose) console.log(`[HamAlert] ${alert.freq} ${alert.call} ${alert.comment} ${alert.time}`);
          if (pluginBus) pluginBus.emit('hamalert', alert);
        },
      });
      const ok = client.connect();
      if (!ok) console.warn('[HamAlert] Not started — set hamalert.username/password in rig-bridge-config.json');
      _currentInstance = api;
    }

    function disconnect() {
      if (client) {
        client.disconnect();
        client = null;
      }
      _currentInstance = null;
      console.log('[HamAlert] Stopped');
    }

    const api = {
      connect,
      disconnect,
      getStatus() {
        const s = client ? client.getStatus() : status;
        // Never expose the password; username is fine (it's the login name)
        return { running: !!client, ...s, ringSize: ring.length };
      },
      getAlerts() {
        return ring.slice();
      },
    };
    return api;
  },
};

module.exports = descriptor;
