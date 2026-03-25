'use strict';
/**
 * wsjtx-relay.js — WSJT-X Relay integration plugin
 *
 * Listens for WSJT-X UDP packets on the local machine and forwards decoded
 * messages in batches to an OpenHamClock server via HTTPS.
 *
 * Configuration (config.wsjtxRelay):
 *   enabled       boolean  Whether the relay is active (default: false)
 *   url           string   OpenHamClock server URL (e.g. https://openhamclock.com)
 *   key           string   Relay authentication key
 *   session       string   Browser session ID for per-user isolation
 *   udpPort            number   UDP port to listen on (default: 2237)
 *   batchInterval      number   Batch send interval in ms (default: 2000)
 *   verbose            boolean  Log all decoded messages (default: false)
 *   multicast          boolean  Join a multicast group (default: false)
 *   multicastGroup     string   Multicast group IP (default: '224.0.0.1')
 *   multicastInterface string   Local NIC IP for multi-homed systems; '' = OS default
 */

const dgram = require('dgram');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const {
  WSJTX_MSG,
  parseMessage,
  buildReply,
  buildHaltTx,
  buildFreeText,
  buildHighlightCallsign,
} = require('../lib/wsjtx-protocol');

const RELAY_VERSION = require('../package.json').version;

// ──────────────────────────────────────────────────────────────────────────────
// Plugin descriptor
// ──────────────────────────────────────────────────────────────────────────────

// Module-level reference to the currently running instance so that
// descriptor-level registerRoutes() can always delegate to it.
let _currentInstance = null;

const descriptor = {
  id: 'wsjtx-relay',
  name: 'WSJT-X Relay',
  category: 'integration',
  configKey: 'wsjtxRelay',

  // Routes are registered at server startup (before any instance exists),
  // so we delegate to _currentInstance which is set/cleared by create/disconnect.
  registerRoutes(app) {
    app.get('/api/wsjtxrelay/status', (req, res) => {
      if (!_currentInstance) {
        return res.json({ enabled: false, running: false });
      }
      res.json(_currentInstance.getStatus());
    });

    // Bidirectional control endpoints — send commands TO WSJT-X
    app.post('/wsjtx/reply', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'WSJT-X relay not running' });
      const { time, snr, deltaTime, deltaFreq, mode, message, lowConfidence, modifiers } = req.body;
      if (!message) return res.status(400).json({ error: 'Missing message (decoded text)' });
      if (
        !_currentInstance.send(
          buildReply(
            _currentInstance.getAppId(),
            time || 0,
            snr || 0,
            deltaTime || 0,
            deltaFreq || 0,
            mode || '',
            message,
            lowConfidence,
            modifiers,
          ),
        )
      ) {
        return res.status(503).json({ error: 'No WSJT-X instance connected (no packets received yet)' });
      }
      res.json({ success: true });
    });

    app.post('/wsjtx/halt', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'WSJT-X relay not running' });
      const { autoTxOnly } = req.body || {};
      if (!_currentInstance.send(buildHaltTx(_currentInstance.getAppId(), autoTxOnly))) {
        return res.status(503).json({ error: 'No WSJT-X instance connected' });
      }
      console.log('[WsjtxRelay] Sent HALT_TX');
      res.json({ success: true });
    });

    app.post('/wsjtx/freetext', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'WSJT-X relay not running' });
      const { text, send } = req.body;
      if (!text) return res.status(400).json({ error: 'Missing text' });
      if (!_currentInstance.send(buildFreeText(_currentInstance.getAppId(), text, send))) {
        return res.status(503).json({ error: 'No WSJT-X instance connected' });
      }
      console.log(`[WsjtxRelay] Sent FREE_TEXT: "${text}" (send=${!!send})`);
      res.json({ success: true });
    });

    app.post('/wsjtx/highlight', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'WSJT-X relay not running' });
      const { callsign, bgColor, fgColor, highlight } = req.body;
      if (!callsign) return res.status(400).json({ error: 'Missing callsign' });
      const bg = bgColor || { r: 255, g: 255, b: 0 };
      const fg = fgColor || { r: 0, g: 0, b: 0 };
      if (
        !_currentInstance.send(
          buildHighlightCallsign(
            _currentInstance.getAppId(),
            callsign,
            bg.r,
            bg.g,
            bg.b,
            fg.r,
            fg.g,
            fg.b,
            highlight !== false,
          ),
        )
      ) {
        return res.status(503).json({ error: 'No WSJT-X instance connected' });
      }
      console.log(`[WsjtxRelay] Sent HIGHLIGHT: ${callsign} (${highlight !== false ? 'on' : 'off'})`);
      res.json({ success: true });
    });
  },

  create(config, services) {
    const cfg = config.wsjtxRelay || {};
    const serverUrl = (cfg.url || '').replace(/\/$/, '');
    const relayEndpoint = `${serverUrl}/api/wsjtx/relay`;
    const bus = services?.pluginBus;

    const mcEnabled = !!cfg.multicast;
    const mcGroup = cfg.multicastGroup || '224.0.0.1';
    const mcInterface = cfg.multicastInterface || undefined; // undefined → OS picks NIC

    let socket = null;
    let batchTimer = null;
    let heartbeatInterval = null;
    let healthInterval = null;
    let messageQueue = [];
    let sendInFlight = false;
    let consecutiveErrors = 0;
    let totalDecodes = 0;
    let totalRelayed = 0;
    let serverReachable = false;

    // Track the remote WSJT-X address for bidirectional communication
    let remoteAddress = null;
    let remotePort = null;
    let appId = 'WSJT-X'; // Updated from heartbeat/status messages

    function getInterval() {
      if (consecutiveErrors === 0) return cfg.batchInterval || 2000;
      if (consecutiveErrors < 5) return (cfg.batchInterval || 2000) * 2;
      if (consecutiveErrors < 20) return 10000;
      return 30000;
    }

    function makeRequest(urlStr, method, body, extraHeaders, onDone) {
      let parsed;
      try {
        parsed = new URL(urlStr);
      } catch (e) {
        console.error(`[WsjtxRelay] Invalid URL: ${urlStr}`);
        return;
      }
      const transport = parsed.protocol === 'https:' ? https : http;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
        'X-Relay-Version': RELAY_VERSION,
        Connection: 'close',
        ...extraHeaders,
      };
      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      const reqOpts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method,
        headers,
        timeout: 10000,
      };

      const req = transport.request(reqOpts, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => onDone && onDone(null, res.statusCode, data));
      });
      req.on('error', (err) => onDone && onDone(err, null, null));
      req.on('timeout', () => {
        req.destroy();
        onDone && onDone(new Error('timeout'), null, null);
      });
      if (body) req.write(body);
      req.end();
    }

    function sendBatch() {
      if (sendInFlight || messageQueue.length === 0) return;

      const batch = messageQueue.splice(0, messageQueue.length);
      sendInFlight = true;

      const body = JSON.stringify({ messages: batch, session: cfg.session });

      makeRequest(relayEndpoint, 'POST', body, {}, (err, statusCode, data) => {
        sendInFlight = false;

        if (err) {
          consecutiveErrors++;
          messageQueue.unshift(...batch);
          if (consecutiveErrors <= 3 || consecutiveErrors % 10 === 0) {
            console.error(`[WsjtxRelay] Send error (attempt ${consecutiveErrors}): ${err.message}`);
          }
          return;
        }

        if (statusCode === 200) {
          consecutiveErrors = 0;
          serverReachable = true;
          const decodes = batch.filter((m) => m.type === WSJTX_MSG.DECODE).length;
          totalRelayed += batch.length;
          if (decodes > 0 || cfg.verbose) {
            console.log(`[WsjtxRelay] Relayed ${batch.length} msg(s) (${decodes} decode(s)) — total: ${totalRelayed}`);
          }
        } else if (statusCode === 401 || statusCode === 403) {
          consecutiveErrors++;
          console.error(`[WsjtxRelay] Authentication failed (${statusCode}) — check relay key`);
        } else if (statusCode >= 500) {
          consecutiveErrors++;
          messageQueue.unshift(...batch);
          console.error(`[WsjtxRelay] Server error ${statusCode}: ${(data || '').substring(0, 100)}`);
        } else {
          consecutiveErrors++;
          console.error(`[WsjtxRelay] Unexpected response ${statusCode}`);
        }
      });
    }

    function scheduleBatch() {
      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => {
        sendBatch();
        scheduleBatch();
      }, getInterval());
    }

    function sendHeartbeat() {
      const body = JSON.stringify({
        relay: true,
        version: RELAY_VERSION,
        port: cfg.udpPort || 2237,
        session: cfg.session,
      });
      makeRequest(relayEndpoint, 'POST', body, { 'X-Relay-Heartbeat': 'true' }, (err, statusCode) => {
        if (err) {
          if (!serverReachable) console.error(`[WsjtxRelay] Cannot reach server: ${err.message}`);
          return;
        }
        if (statusCode === 200) {
          if (!serverReachable) {
            console.log('[WsjtxRelay] Connected to server — relay active');
            serverReachable = true;
          }
          if (consecutiveErrors > 0) {
            console.log('[WsjtxRelay] Server connection restored');
            consecutiveErrors = 0;
          }
        } else if (statusCode === 503) {
          console.error('[WsjtxRelay] Relay not configured on server — WSJTX_RELAY_KEY not set');
        } else if (statusCode === 401 || statusCode === 403) {
          console.error(`[WsjtxRelay] Authentication failed (${statusCode}) — relay key mismatch`);
        }
      });
    }

    function connect() {
      if (!cfg.url || !cfg.key || !cfg.session) {
        console.error('[WsjtxRelay] Cannot start: url, key, and session are required');
        return;
      }

      // Validate relay URL — protocol only; host restrictions are unnecessary because
      // the relay authenticates to the target via key + session, and the config API
      // is protected by the rig-bridge API token.
      try {
        const parsed = new URL(cfg.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          console.error(`[WsjtxRelay] Blocked: only http/https URLs allowed (got ${parsed.protocol})`);
          return;
        }
      } catch (e) {
        console.error(`[WsjtxRelay] Invalid relay URL: ${e.message}`);
        return;
      }

      const udpPort = cfg.udpPort || 2237;
      socket = dgram.createSocket('udp4');

      socket.on('message', (buf, rinfo) => {
        const msg = parseMessage(buf);
        if (!msg) return;
        // Track sender for bidirectional communication
        remoteAddress = rinfo.address;
        remotePort = rinfo.port;
        if (msg.id) appId = msg.id;
        if (msg.type === WSJTX_MSG.DECODE && msg.isNew) {
          totalDecodes++;
          if (bus) bus.emit('decode', { source: 'wsjtx-relay', ...msg });
        }
        if (msg.type === WSJTX_MSG.STATUS && bus) bus.emit('status', { source: 'wsjtx-relay', ...msg });
        if (msg.type === WSJTX_MSG.QSO_LOGGED && bus) bus.emit('qso', { source: 'wsjtx-relay', ...msg });
        if (msg.type !== WSJTX_MSG.REPLAY) {
          messageQueue.push(msg);
          if (cfg.verbose && msg.type === WSJTX_MSG.DECODE) {
            const snr = msg.snr != null ? (msg.snr >= 0 ? `+${msg.snr}` : msg.snr) : '?';
            console.log(
              `[WsjtxRelay] Decode ${msg.time?.formatted || '??'} ${snr}dB ${msg.deltaFreq}Hz ${msg.message}`,
            );
          }
        }
      });

      socket.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[WsjtxRelay] UDP port ${udpPort} already in use — is another listener running?`);
        } else {
          console.error(`[WsjtxRelay] UDP error: ${err.message}`);
        }
        socket = null;
      });

      socket.on('listening', () => {
        const addr = socket.address();
        console.log(`[WsjtxRelay] Listening for WSJT-X on UDP ${addr.address}:${addr.port}`);
        console.log(`[WsjtxRelay] Relaying to ${serverUrl}`);

        if (mcEnabled) {
          try {
            socket.addMembership(mcGroup, mcInterface);
            const ifaceLabel = mcInterface || '0.0.0.0 (OS default)';
            console.log(`[WsjtxRelay] Joined multicast group ${mcGroup} on interface ${ifaceLabel}`);
          } catch (err) {
            console.error(`[WsjtxRelay] Failed to join multicast group ${mcGroup}: ${err.message}`);
            console.error(
              `[WsjtxRelay] Falling back to unicast — check that ${mcGroup} is a valid multicast address and your OS supports multicast on this interface`,
            );
          }
        }

        scheduleBatch();

        // Initial health check then heartbeat
        const healthUrl = `${serverUrl}/api/health`;
        makeRequest(healthUrl, 'GET', null, {}, (err, statusCode) => {
          if (!err && statusCode === 200) {
            console.log(`[WsjtxRelay] Server reachable (${serverUrl})`);
          } else if (err) {
            console.error(`[WsjtxRelay] Cannot reach server: ${err.message}`);
          }
          sendHeartbeat();
        });

        heartbeatInterval = setInterval(sendHeartbeat, 30000);

        healthInterval = setInterval(() => {
          const checkUrl = `${serverUrl}/api/wsjtx`;
          makeRequest(checkUrl, 'GET', null, {}, (err, statusCode) => {
            if (!err && statusCode === 200 && consecutiveErrors > 0) {
              console.log('[WsjtxRelay] Server connection restored');
              consecutiveErrors = 0;
            }
          });
        }, 60000);
      });

      // SECURITY: Bind to localhost by default to prevent external UDP packet injection.
      // Multicast requires joining a group on a real (non-loopback) interface, so fall
      // back to '0.0.0.0' automatically when multicast is enabled. For the rare case
      // where multicast is disabled but WSJT-X runs on a different machine, set
      // wsjtxRelay.udpBindAddress to "0.0.0.0" in rig-bridge-config.json.
      const bindAddr = cfg.multicast ? '0.0.0.0' : cfg.udpBindAddress || '127.0.0.1';
      socket.bind(udpPort, bindAddr);
    }

    function disconnect() {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (healthInterval) {
        clearInterval(healthInterval);
        healthInterval = null;
      }
      if (socket) {
        if (mcEnabled) {
          try {
            socket.dropMembership(mcGroup, mcInterface);
            console.log(`[WsjtxRelay] Left multicast group ${mcGroup}`);
          } catch (err) {
            // Socket may already be closing or membership was never joined — safe to ignore
            console.error(`[WsjtxRelay] dropMembership failed (non-fatal): ${err.message}`);
          }
        }
        try {
          socket.close();
        } catch (e) {}
        socket = null;
      }
      _currentInstance = null;
      console.log(`[WsjtxRelay] Stopped (session: ${totalDecodes} decodes, ${totalRelayed} relayed)`);
    }

    function getStatus() {
      return {
        enabled: !!(cfg.url && cfg.key && cfg.session),
        running: socket !== null,
        serverReachable,
        decodeCount: totalDecodes,
        relayCount: totalRelayed,
        consecutiveErrors,
        udpPort: cfg.udpPort || 2237,
        serverUrl,
        multicast: mcEnabled,
        multicastGroup: mcEnabled ? mcGroup : null,
      };
    }

    function send(buffer) {
      if (!socket || !remoteAddress || !remotePort) return false;
      socket.send(buffer, 0, buffer.length, remotePort, remoteAddress, (err) => {
        if (err) console.error(`[WsjtxRelay] Send error: ${err.message}`);
      });
      return true;
    }

    function getAppId() {
      return appId;
    }

    const instance = { connect, disconnect, getStatus, send, getAppId };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
