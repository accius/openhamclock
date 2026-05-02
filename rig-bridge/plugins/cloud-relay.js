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
    const pushInterval = cfg.pushInterval || 2000; // Fallback interval for data batches
    const { state, pluginBus, onStateChange, removeStateChangeListener } = services;

    let pushTimer = null;
    let pollRetryTimer = null; // Used only for error-backoff delays between long-poll attempts
    let pollAborted = false; // Set on disconnect to stop the long-poll loop
    let immediatePushTimer = null;
    let stateChangeHandler = null;
    let lastPttState = null; // Track PTT separately to detect PTT-specific changes
    let serverReachable = false;
    let totalPushed = 0;
    let totalCommands = 0;
    let totalDecodes = 0;
    let consecutiveErrors = 0;
    let lastState = {};
    let pendingDecodes = []; // Batched decodes to push
    let pendingAprs = []; // Batched APRS packets to push

    function makeRequest(urlStr, method, body, callback, timeoutMs) {
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
      req.setTimeout(timeoutMs || 5000, () => {
        req.destroy(new Error('Timeout'));
      });
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    }

    // Push current rig state + batched decodes to cloud
    function pushState() {
      const currentState = {
        freq: state.freq,
        mode: state.mode,
        ptt: state.ptt,
        connected: state.connected,
        width: state.width,
        timestamp: Date.now(),
      };

      const hasDecodes = pendingDecodes.length > 0;
      const hasAprs = pendingAprs.length > 0;
      const stateChanged =
        currentState.freq !== lastState.freq ||
        currentState.mode !== lastState.mode ||
        currentState.ptt !== lastState.ptt ||
        currentState.connected !== lastState.connected;

      // Only push if state changed or there's data to send
      if (!stateChanged && !hasDecodes && !hasAprs) return;
      lastState = { ...currentState };

      // Include batched data in the push
      const payload = { ...currentState, session };
      if (hasDecodes) {
        payload.decodes = pendingDecodes.splice(0, 50);
        totalDecodes += payload.decodes.length;
      }
      if (hasAprs) {
        payload.aprsPackets = pendingAprs.splice(0, 50);
      }

      makeRequest(`${serverUrl}/api/rig-bridge/relay/state`, 'POST', payload, (err, status, data) => {
        if (err) {
          if (serverReachable) console.error(`[CloudRelay] Push error: ${err.message}`);
          serverReachable = false;
          consecutiveErrors++;
          // Put decodes back if push failed
          if (payload.decodes) pendingDecodes.unshift(...payload.decodes);
          return;
        }
        if (status === 200) {
          serverReachable = true;
          consecutiveErrors = 0;
          totalPushed++;
          if (cfg.verbose) {
            const decodeInfo = payload.decodes ? ` + ${payload.decodes.length} decodes` : '';
            console.log(`[CloudRelay] Pushed state (${currentState.freq} Hz ${currentState.mode}${decodeInfo})`);
          }
        } else if (status === 401 || status === 403) {
          try {
            const msg = JSON.parse(data)?.error || data;
            console.error(`[CloudRelay] Authentication failed (${status}): ${msg}`);
          } catch {
            console.error(`[CloudRelay] Authentication failed (${status}) — check relay API key and session`);
          }
        }
      });
    }

    // Long-poll loop — holds the connection open for up to LONG_POLL_WAIT ms.
    // The server resolves the request immediately when a command is queued,
    // so latency is ~network RTT rather than the push interval.
    // On timeout (no commands) it restarts immediately. On network error it
    // waits 1 s before retrying to avoid hammering a temporarily unreachable server.
    const LONG_POLL_WAIT = 28000; // ms to hold open (server caps at 30 s)

    function longPollCommands() {
      if (pollAborted) return;
      const url =
        `${serverUrl}/api/rig-bridge/relay/commands` + `?session=${encodeURIComponent(session)}&wait=${LONG_POLL_WAIT}`;

      makeRequest(
        url,
        'GET',
        null,
        (err, status, data) => {
          if (pollAborted) return;

          if (!err && status === 200) {
            try {
              const response = JSON.parse(data);
              const commands = response.commands || [];
              for (const cmd of commands) executeCommand(cmd);
            } catch (e) {}
            // Restart immediately — no delay when things are healthy
            longPollCommands();
          } else {
            // Network error or unexpected status — back off 1 s before retry
            pollRetryTimer = setTimeout(longPollCommands, 1000);
          }
        },
        LONG_POLL_WAIT + 4000, // HTTP timeout = hold window + 4 s network buffer
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
      if (!serverUrl || !apiKey || !session) {
        console.error('[CloudRelay] Cannot start: url, apiKey, and session are required');
        return;
      }

      console.log(`[CloudRelay] Starting relay to ${serverUrl}`);
      console.log(`[CloudRelay] Push interval: ${pushInterval}ms, Command delivery: long-poll`);

      // Initial health check
      makeRequest(`${serverUrl}/api/health`, 'GET', null, (err, status) => {
        if (!err && status === 200) {
          serverReachable = true;
          console.log(`[CloudRelay] Server reachable (${serverUrl})`);
        } else {
          console.error(`[CloudRelay] Server not reachable: ${err ? err.message : `HTTP ${status}`}`);
        }
      });

      // Push on state changes:
      //   PTT changes → push immediately (no debounce) — operators need instant TX feedback
      //   freq/mode/connected changes → 50ms debounce to collapse rapid VFO spinning
      if (typeof onStateChange === 'function') {
        stateChangeHandler = () => {
          const pttChanged = state.ptt !== lastPttState;
          if (pttChanged) {
            lastPttState = state.ptt;
            // Cancel any pending debounced push and push right now
            if (immediatePushTimer) clearTimeout(immediatePushTimer);
            immediatePushTimer = null;
            pushState();
          } else {
            if (immediatePushTimer) clearTimeout(immediatePushTimer);
            immediatePushTimer = setTimeout(pushState, 50);
          }
        };
        onStateChange(stateChangeHandler);
        console.log('[CloudRelay] Subscribed to immediate state changes');
      }

      // Fallback interval for batched data (decodes, APRS) even if state hasn't changed
      pushTimer = setInterval(pushState, pushInterval);

      // Start long-poll command loop — replaces the old fixed-interval poll.
      // Each iteration holds the server connection open until a command arrives
      // or the 28 s window expires, so commands are delivered within ~RTT.
      longPollCommands();

      // Subscribe to plugin bus — batch decodes and APRS packets for push
      if (pluginBus) {
        pluginBus.on('decode', (msg) => {
          pendingDecodes.push({
            source: msg.source,
            message: msg.message,
            snr: msg.snr,
            deltaFreq: msg.deltaFreq,
            mode: msg.mode,
            time: msg.time?.formatted,
            timestamp: msg.timestamp,
          });
          // Cap pending queue
          if (pendingDecodes.length > 200) pendingDecodes.splice(0, pendingDecodes.length - 200);
        });
        pluginBus.on('aprs', (packet) => {
          pendingAprs.push(packet);
          if (pendingAprs.length > 200) pendingAprs.splice(0, pendingAprs.length - 200);
        });
        console.log('[CloudRelay] Subscribed to plugin bus (decodes, APRS, status, QSOs)');
      }
    }

    function disconnect() {
      if (pushTimer) {
        clearInterval(pushTimer);
        pushTimer = null;
      }
      // Signal the long-poll loop to stop; clear any pending error-backoff timer
      pollAborted = true;
      if (pollRetryTimer) {
        clearTimeout(pollRetryTimer);
        pollRetryTimer = null;
      }
      if (immediatePushTimer) {
        clearTimeout(immediatePushTimer);
        immediatePushTimer = null;
      }
      if (stateChangeHandler && typeof removeStateChangeListener === 'function') {
        removeStateChangeListener(stateChangeHandler);
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
        commandDelivery: 'long-poll',
      };
    }

    const instance = { connect, disconnect, getStatus };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
