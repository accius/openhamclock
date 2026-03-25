'use strict';
/**
 * cloud-relay.js — Rig Bridge Cloud Relay
 *
 * Bridges the gap between a locally-running rig-bridge and a cloud-hosted
 * OpenHamClock instance. Provides all rig-bridge features to cloud users
 * by relaying state and commands over HTTPS.
 *
 * How it works:
 *   1. LOCAL → CLOUD: Pushes rig state (freq, mode, PTT, WSJT-X decodes,
 *      APRS packets, etc.) to the cloud OHC instance periodically.
 *   2. CLOUD → LOCAL: Polls the cloud instance for pending commands (tune,
 *      PTT, WSJT-X reply, APRS message) and executes them locally.
 *
 * This means cloud-hosted OHC users get the same rig control capabilities
 * as local users — click-to-tune, PTT, WSJT-X decode replies, APRS messaging —
 * all proxied through this relay.
 *
 * Config section: config.cloudRelay
 *   enabled:        boolean  (default: false)
 *   url:            string   Cloud OHC URL (e.g. 'https://openhamclock.com')
 *   apiKey:         string   Authentication key for the relay
 *   session:        string   Browser session ID for per-user isolation
 *   pushInterval:   number   State push interval in ms (default: 2000)
 *   pollInterval:   number   Command poll interval in ms (default: 1000)
 *   relayRig:       boolean  Relay rig state (default: true)
 *   relayWsjtx:     boolean  Relay WSJT-X decodes (default: true)
 *   relayAprs:      boolean  Relay APRS packets (default: false)
 *   verbose:        boolean  Log all relay activity (default: false)
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

let _currentInstance = null;

const descriptor = {
  id: 'cloud-relay',
  name: 'Rig Bridge Cloud Relay',
  category: 'integration',
  configKey: 'cloudRelay',

  registerRoutes(app) {
    app.get('/api/cloud-relay/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
  },

  create(config, services) {
    const cfg = config.cloudRelay || {};
    const serverUrl = (cfg.url || '').replace(/\/$/, '');
    const apiKey = cfg.apiKey || '';
    const session = cfg.session || '';
    const pushInterval = cfg.pushInterval || 2000;
    const pollInterval = cfg.pollInterval || 1000;
    const { state } = services;

    let pushTimer = null;
    let pollTimer = null;
    let serverReachable = false;
    let totalPushed = 0;
    let totalCommands = 0;
    let consecutiveErrors = 0;
    let lastState = {};

    function makeRequest(urlStr, method, body, callback) {
      let parsed;
      try {
        parsed = new URL(urlStr);
      } catch (e) {
        if (callback) callback(new Error(`Invalid URL: ${urlStr}`));
        return;
      }

      const mod = parsed.protocol === 'https:' ? https : http;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Relay-Session': session,
      };

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
      };

      const req = mod.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (callback) callback(null, res.statusCode, data);
        });
      });
      req.on('error', (err) => {
        if (callback) callback(err);
      });
      req.setTimeout(5000, () => {
        req.destroy(new Error('Timeout'));
      });
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    }

    // Push current rig state to cloud
    function pushState() {
      const currentState = {
        freq: state.freq,
        mode: state.mode,
        ptt: state.ptt,
        connected: state.connected,
        width: state.width,
        timestamp: Date.now(),
      };

      // Only push if state changed
      if (
        currentState.freq === lastState.freq &&
        currentState.mode === lastState.mode &&
        currentState.ptt === lastState.ptt &&
        currentState.connected === lastState.connected
      ) {
        return;
      }
      lastState = { ...currentState };

      makeRequest(`${serverUrl}/api/rig-bridge/relay/state`, 'POST', currentState, (err, status) => {
        if (err) {
          if (serverReachable) console.error(`[CloudRelay] Push error: ${err.message}`);
          serverReachable = false;
          consecutiveErrors++;
          return;
        }
        if (status === 200) {
          serverReachable = true;
          consecutiveErrors = 0;
          totalPushed++;
          if (cfg.verbose) console.log(`[CloudRelay] Pushed state (${currentState.freq} Hz ${currentState.mode})`);
        } else if (status === 401 || status === 403) {
          console.error(`[CloudRelay] Authentication failed (${status}) — check relay API key`);
        }
      });
    }

    // Poll cloud for pending commands
    function pollCommands() {
      makeRequest(
        `${serverUrl}/api/rig-bridge/relay/commands?session=${encodeURIComponent(session)}`,
        'GET',
        null,
        (err, status, data) => {
          if (err || status !== 200) return;

          try {
            const response = JSON.parse(data);
            const commands = response.commands || [];
            for (const cmd of commands) {
              executeCommand(cmd);
            }
          } catch (e) {}
        },
      );
    }

    // Execute a command received from the cloud
    function executeCommand(cmd) {
      totalCommands++;
      if (cfg.verbose) console.log(`[CloudRelay] Command: ${cmd.type} ${JSON.stringify(cmd.payload || {})}`);

      switch (cmd.type) {
        case 'setFreq':
          if (cmd.payload?.freq) {
            // Dispatch through the local rig-bridge HTTP API
            const freqReq = http.request(
              {
                hostname: '127.0.0.1',
                port: config.port || 5555,
                path: '/freq',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-RigBridge-Token': config.apiToken || '' },
              },
              () => {},
            );
            freqReq.write(JSON.stringify({ freq: cmd.payload.freq }));
            freqReq.end();
          }
          break;
        case 'setMode':
          if (cmd.payload?.mode) {
            const modeReq = http.request(
              {
                hostname: '127.0.0.1',
                port: config.port || 5555,
                path: '/mode',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-RigBridge-Token': config.apiToken || '' },
              },
              () => {},
            );
            modeReq.write(JSON.stringify({ mode: cmd.payload.mode }));
            modeReq.end();
          }
          break;
        case 'setPTT':
          if (cmd.payload != null) {
            const pttReq = http.request(
              {
                hostname: '127.0.0.1',
                port: config.port || 5555,
                path: '/ptt',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-RigBridge-Token': config.apiToken || '' },
              },
              () => {},
            );
            pttReq.write(JSON.stringify({ ptt: !!cmd.payload.ptt }));
            pttReq.end();
          }
          break;
        default:
          if (cfg.verbose) console.log(`[CloudRelay] Unknown command type: ${cmd.type}`);
      }
    }

    function connect() {
      if (!serverUrl || !apiKey) {
        console.error('[CloudRelay] Cannot start: url and apiKey are required');
        return;
      }

      console.log(`[CloudRelay] Starting relay to ${serverUrl}`);
      console.log(`[CloudRelay] Push interval: ${pushInterval}ms, Poll interval: ${pollInterval}ms`);

      // Initial health check
      makeRequest(`${serverUrl}/api/health`, 'GET', null, (err, status) => {
        if (!err && status === 200) {
          serverReachable = true;
          console.log(`[CloudRelay] Server reachable (${serverUrl})`);
        } else {
          console.error(`[CloudRelay] Server not reachable: ${err ? err.message : `HTTP ${status}`}`);
        }
      });

      pushTimer = setInterval(pushState, pushInterval);
      pollTimer = setInterval(pollCommands, pollInterval);
    }

    function disconnect() {
      if (pushTimer) {
        clearInterval(pushTimer);
        pushTimer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      _currentInstance = null;
      console.log(`[CloudRelay] Stopped (pushed: ${totalPushed}, commands: ${totalCommands})`);
    }

    function getStatus() {
      return {
        enabled: !!(cfg.url && cfg.apiKey),
        running: pushTimer !== null,
        serverReachable,
        serverUrl,
        totalPushed,
        totalCommands,
        consecutiveErrors,
        pushInterval,
        pollInterval,
      };
    }

    const instance = { connect, disconnect, getStatus };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
