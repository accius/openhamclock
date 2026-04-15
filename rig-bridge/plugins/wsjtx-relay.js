'use strict';
/**
 * wsjtx-relay.js — WSJT-X Relay integration plugin
 *
 * Listens for WSJT-X UDP packets on the local machine and:
 *  1. Emits enriched events on the plugin bus for local SSE consumers.
 *  2. Optionally forwards raw decoded messages in batches to an OpenHamClock
 *     server via HTTPS.
 *
 * Enrichments applied locally (no server required)
 * ─────────────────────────────────────────────────
 *  decode   — FT8/FT4 message text parsed (type/caller/modifier/dxCall/deCall),
 *             in-message grid → lat/lon, grid cache fallback, band name, dedup ID
 *  status   — band name, band-change detection, DX lat/lon (from dxGrid or cache),
 *             DE lat/lon (from deGrid)
 *  qso      — band name, dxGrid → lat/lon, QSO deduplication (60 s window)
 *  wspr     — band name, grid → lat/lon              (new — was not emitted before)
 *  clear    — forwarded as-is                         (new — was not emitted before)
 *
 * Configuration (config.wsjtxRelay):
 *   enabled            boolean  Whether the relay is active (default: false)
 *   url                string   OpenHamClock server URL (e.g. https://openhamclock.com)
 *   key                string   Relay authentication key
 *   session            string   Browser session ID for per-user isolation
 *   myCall             string   Operator callsign (improves QSO direction detection)
 *   udpPort            number   UDP port to listen on (default: 2237)
 *   batchInterval      number   Batch send interval in ms (default: 2000)
 *   verbose            boolean  Log all decoded messages (default: false)
 *   multicast          boolean  Join a multicast group (default: false)
 *   multicastGroup     string   Multicast group IP (default: '224.0.0.1')
 *   multicastInterface string   Local NIC IP for multi-homed systems; '' = OS default
 *   relayToServer      boolean  Forward raw messages to OHC server (default: false)
 */

const dgram = require('dgram');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const {
  WSJTX_MSG,
  parseMessage,
  buildReply,
  buildHaltTx,
  buildFreeText,
  buildHighlightCallsign,
} = require('../lib/wsjtx-protocol');
const {
  createGridCache,
  createCallsignCache,
  loadCallsignCache,
  saveCallsignCache,
  enrichDecode,
  enrichStatus,
  enrichQso,
  enrichWspr,
  triggerHamqthLookup,
} = require('../lib/wsjtx-enrich');
const { CONFIG_DIR } = require('../core/config');

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

    // ── Server relay state ──────────────────────────────────────────────────
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
    // Resolved at connect() time: true only when relayToServer AND url/key/session are all set
    let willRelay = false;

    // Track the remote WSJT-X address for bidirectional communication
    let remoteAddress = null;
    let remotePort = null;
    let appId = 'WSJT-X'; // Updated from heartbeat/status messages

    // ── Local enrichment state ──────────────────────────────────────────────
    // Shared grid cache: remembers callsign → grid from CQ/exchange messages
    const gridCache = createGridCache();
    // HamQTH callsign lookup cache (only populated when cfg.hamqthLookup is true)
    const callsignCache = createCallsignCache();
    const hamqthInflight = new Set(); // callsigns currently being looked up
    const hamqthLastAttempted = new Map(); // callsign → timestamp of last attempt (for cooldown)
    // Persist HamQTH cache to disk so it survives rig-bridge restarts.
    // Only used when hamqthLookup is enabled; null disables all file I/O.
    const cacheFilePath = cfg.hamqthLookup ? path.join(CONFIG_DIR, 'hamqth-cache.json') : null;
    let cacheSaveTimer = null;
    // Per-client state needed for decode enrichment (band, freq, mode)
    const clientStates = Object.create(null); // clientId → { band, dialFrequency, mode }
    // Content-based decode deduplication (time + freq + message text)
    const seenDecodeIds = new Set();
    const SEEN_DECODE_MAX = 2000; // keep at most this many IDs to bound memory
    // QSO deduplication: track recent logged QSOs (call + freq + mode, 60 s window)
    const recentQsos = []; // { dxCall, frequency, mode, timestamp }
    const QSO_DEDUP_MS = 60_000;
    const QSO_DEDUP_MAX = 200; // max entries to scan
    // Prune grid and callsign caches every 5 minutes
    let gridPruneInterval = null;

    // ── Helpers ─────────────────────────────────────────────────────────────

    function getInterval() {
      if (consecutiveErrors === 0) return cfg.batchInterval || 2000;
      if (consecutiveErrors < 5) return (cfg.batchInterval || 2000) * 2;
      if (consecutiveErrors < 20) return 10000;
      return 30000;
    }

    // Debounced HamQTH cache save — coalesces rapid resolve bursts into one write.
    function scheduleCacheSave() {
      if (!cacheFilePath) return;
      if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
      cacheSaveTimer = setTimeout(() => {
        cacheSaveTimer = null;
        saveCallsignCache(cacheFilePath, callsignCache);
      }, 30_000);
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

    // ── Message handler ─────────────────────────────────────────────────────

    function handleMessage(buf, rinfo) {
      const msg = parseMessage(buf);
      if (!msg) return;

      // Track sender for bidirectional communication
      remoteAddress = rinfo.address;
      remotePort = rinfo.port;
      if (msg.id) appId = msg.id;

      // Queue raw message for server relay (unmodified — server does its own enrichment)
      if (msg.type !== WSJTX_MSG.REPLAY && willRelay) {
        messageQueue.push(msg);
      }

      switch (msg.type) {
        case WSJTX_MSG.STATUS: {
          const prevState = clientStates[msg.id] ?? null;
          const enriched = enrichStatus(msg, prevState, gridCache);

          // Update per-client state for decode enrichment
          clientStates[msg.id] = {
            band: enriched.band,
            dialFrequency: msg.dialFrequency,
            mode: msg.mode,
            deCall: msg.deCall ?? null,
            deGrid: msg.deGrid ?? null,
          };

          if (bus) bus.emit('status', { source: 'wsjtx-relay', ...msg, ...enriched });
          break;
        }

        case WSJTX_MSG.DECODE: {
          if (!msg.isNew) break;
          totalDecodes++;

          const clientState = clientStates[msg.id] ?? null;
          const decode = enrichDecode(
            msg,
            clientState,
            gridCache,
            cfg.myCall ?? null,
            cfg.hamqthLookup ? callsignCache : null,
          );

          // Content-based deduplication — skip if we have already emitted this decode
          if (seenDecodeIds.has(decode.id)) break;
          seenDecodeIds.add(decode.id);
          // Bound the set size by evicting the oldest entry when over limit
          if (seenDecodeIds.size > SEEN_DECODE_MAX) {
            seenDecodeIds.delete(seenDecodeIds.values().next().value);
          }

          if (bus) bus.emit('decode', { source: 'wsjtx-relay', ...decode });

          // Phase 5: if still no coordinates and HamQTH lookup is enabled,
          // start a background request. When it resolves, emit decode-update so
          // the frontend can retroactively place the map pin for this decode.
          if (cfg.hamqthLookup && decode.lat == null) {
            const targetCall = (decode.caller ?? decode.deCall ?? decode.dxCall ?? '').toUpperCase();
            if (targetCall) {
              triggerHamqthLookup(
                targetCall,
                callsignCache,
                hamqthInflight,
                ({ callsign, lat, lon }) => {
                  if (bus) bus.emit('decode-update', { source: 'wsjtx-relay', callsign, lat, lon });
                  scheduleCacheSave();
                },
                hamqthLastAttempted,
              );
            }
          }

          if (cfg.verbose) {
            const snr = decode.snr != null ? (decode.snr >= 0 ? `+${decode.snr}` : decode.snr) : '?';
            console.log(`[WsjtxRelay] Decode ${decode.time} ${snr}dB ${decode.freq}Hz ${decode.message}`);
          }
          break;
        }

        case WSJTX_MSG.CLEAR: {
          // WSJT-X cleared its band activity window — forward so the UI can react
          if (bus) bus.emit('clear', { source: 'wsjtx-relay', clientId: msg.id, window: msg.window });
          // Also clear seen-decode IDs for this client so a replay after a manual
          // clear is treated as fresh decodes
          for (const id of seenDecodeIds) {
            if (id.startsWith(`${msg.id}-`)) seenDecodeIds.delete(id);
          }
          break;
        }

        case WSJTX_MSG.QSO_LOGGED: {
          const qso = {
            ...enrichQso(msg),
            // Fill myCall/myGrid from client state when not present in the message
            myCall: msg.myCall || clientStates[msg.id]?.deCall || null,
            myGrid: msg.myGrid || clientStates[msg.id]?.deGrid || null,
          };

          // Deduplicate: same call + frequency + mode within 60 s
          const now = Date.now();
          const isDup = recentQsos.some(
            (q) =>
              q.dxCall === qso.dxCall &&
              q.frequency === qso.frequency &&
              q.mode === qso.mode &&
              now - q.timestamp < QSO_DEDUP_MS,
          );
          if (!isDup) {
            recentQsos.push({ dxCall: qso.dxCall, frequency: qso.frequency, mode: qso.mode, timestamp: now });
            if (recentQsos.length > QSO_DEDUP_MAX) recentQsos.shift();
            if (bus) bus.emit('qso', { source: 'wsjtx-relay', ...qso });
          }
          break;
        }

        case WSJTX_MSG.WSPR_DECODE: {
          if (!msg.isNew) break;
          const wspr = enrichWspr(msg);
          if (bus) bus.emit('wspr', { source: 'wsjtx-relay', ...wspr });
          break;
        }

        // HEARTBEAT and CLOSE need no SSE event; REPLAY is filtered above.
        default:
          break;
      }
    }

    // ── connect / disconnect ─────────────────────────────────────────────────

    function connect() {
      // Determine whether server relay is active for this session.
      // relayToServer requires url + key + session to all be set.
      willRelay = !!(cfg.relayToServer && cfg.url && cfg.key && cfg.session);

      if (cfg.relayToServer && !willRelay) {
        console.warn('[WsjtxRelay] relayToServer=true but url/key/session incomplete — running in SSE-only mode');
      }

      if (willRelay) {
        // Validate relay URL — protocol only; host restrictions are unnecessary because
        // the relay authenticates to the target via key + session, and the config API
        // is protected by the rig-bridge API token.
        try {
          const parsed = new URL(cfg.url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            console.error(`[WsjtxRelay] Blocked: only http/https URLs allowed (got ${parsed.protocol})`);
            willRelay = false;
          }
        } catch (e) {
          console.error(`[WsjtxRelay] Invalid relay URL: ${e.message}`);
          willRelay = false;
        }
      }

      if (cacheFilePath) loadCallsignCache(cacheFilePath, callsignCache);

      const udpPort = cfg.udpPort || 2237;
      socket = dgram.createSocket('udp4');

      socket.on('message', handleMessage);

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

        // Prune grid and callsign caches every 5 minutes to release stale entries
        gridPruneInterval = setInterval(
          () => {
            gridCache.prune();
            callsignCache.prune();
          },
          5 * 60 * 1000,
        );

        if (willRelay) {
          console.log(`[WsjtxRelay] Relaying to ${serverUrl}`);
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
        } else {
          console.log('[WsjtxRelay] SSE-only mode — decodes flow via /stream, no OHC server relay');
        }
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
      if (gridPruneInterval) {
        clearInterval(gridPruneInterval);
        gridPruneInterval = null;
      }
      // Flush HamQTH cache to disk on clean shutdown (cancel the debounced write
      // first so we don't fire twice if the save completes quickly).
      if (cacheSaveTimer) {
        clearTimeout(cacheSaveTimer);
        cacheSaveTimer = null;
      }
      if (cacheFilePath) saveCallsignCache(cacheFilePath, callsignCache);
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
      console.log(
        `[WsjtxRelay] Stopped (${totalDecodes} decode(s)${willRelay ? `, ${totalRelayed} relayed to server` : ', SSE-only mode'})`,
      );
    }

    function getStatus() {
      return {
        enabled: cfg.enabled,
        relayToServer: willRelay,
        running: socket !== null,
        serverReachable,
        decodeCount: totalDecodes,
        relayCount: totalRelayed,
        consecutiveErrors,
        udpPort: cfg.udpPort || 2237,
        serverUrl: willRelay ? serverUrl : null,
        multicast: mcEnabled,
        multicastGroup: mcEnabled ? mcGroup : null,
        gridCacheSize: gridCache.size,
        callsignCacheSize: callsignCache.size,
        hamqthLookup: !!cfg.hamqthLookup,
        hamqthInflight: hamqthInflight.size,
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
