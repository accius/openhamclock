'use strict';
/**
 * digital-mode-base.js — Shared factory for WSJT-X-protocol digital mode plugins
 *
 * MSHV, JTDX, and JS8Call all speak the same WSJT-X UDP binary protocol
 * (with minor variations). This factory creates a bidirectional plugin
 * for any of them with the correct config key, default port, and app name.
 *
 * Each plugin:
 *   - Listens on a configurable UDP port for incoming messages
 *   - Parses the WSJT-X binary protocol via the shared library
 *   - Enriches events with band name, grid → lat/lon, and parsed message text
 *   - Tracks the remote app's address/port for bidirectional communication
 *   - Exposes API endpoints for sending commands back to the app
 *   - Does NOT relay to OHC server (that's wsjtx-relay's job)
 *
 * Enrichments applied (same subset as wsjtx-relay SSE mode)
 * ──────────────────────────────────────────────────────────
 *  decode  — FT8 message text parsed, in-message grid → lat/lon, band name, dedup ID
 *  status  — band name, band-change detection, DX/DE lat/lon from grids
 *  qso     — band name, dxGrid → lat/lon
 *  clear   — forwarded as-is  (new — was not emitted before)
 */

const dgram = require('dgram');
const {
  WSJTX_MSG,
  parseMessage,
  buildReply,
  buildHaltTx,
  buildFreeText,
  buildHighlightCallsign,
} = require('../lib/wsjtx-protocol');
const { createGridCache, enrichDecode, enrichStatus, enrichQso } = require('../lib/wsjtx-enrich');

/**
 * Create a digital mode plugin descriptor.
 *
 * @param {object} opts
 * @param {string} opts.id          Plugin ID (e.g. 'mshv', 'jtdx', 'js8call')
 * @param {string} opts.name        Display name (e.g. 'MSHV', 'JTDX', 'JS8Call')
 * @param {string} opts.configKey   Config section key (e.g. 'mshv', 'jtdx', 'js8call')
 * @param {number} opts.defaultPort Default UDP port
 * @param {string} opts.tag         Console log prefix (e.g. 'MSHV', 'JTDX', 'JS8Call')
 */
function createDigitalModePlugin({ id, name, configKey, defaultPort, tag }) {
  let _currentInstance = null;

  const descriptor = {
    id,
    name,
    category: 'integration',
    configKey,

    registerRoutes(app) {
      const prefix = `/api/${id}`;

      app.get(`${prefix}/status`, (req, res) => {
        if (!_currentInstance) {
          return res.json({ enabled: false, running: false });
        }
        res.json(_currentInstance.getStatus());
      });

      // Bidirectional control endpoints
      app.post(`${prefix}/reply`, (req, res) => {
        if (!_currentInstance) return res.status(503).json({ error: `${name} plugin not running` });
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
          return res.status(503).json({ error: `No ${name} instance connected` });
        }
        res.json({ success: true });
      });

      app.post(`${prefix}/halt`, (req, res) => {
        if (!_currentInstance) return res.status(503).json({ error: `${name} plugin not running` });
        const { autoTxOnly } = req.body || {};
        if (!_currentInstance.send(buildHaltTx(_currentInstance.getAppId(), autoTxOnly))) {
          return res.status(503).json({ error: `No ${name} instance connected` });
        }
        console.log(`[${tag}] Sent HALT_TX`);
        res.json({ success: true });
      });

      app.post(`${prefix}/freetext`, (req, res) => {
        if (!_currentInstance) return res.status(503).json({ error: `${name} plugin not running` });
        const { text, send } = req.body;
        if (!text) return res.status(400).json({ error: 'Missing text' });
        if (!_currentInstance.send(buildFreeText(_currentInstance.getAppId(), text, send))) {
          return res.status(503).json({ error: `No ${name} instance connected` });
        }
        console.log(`[${tag}] Sent FREE_TEXT: "${text}" (send=${!!send})`);
        res.json({ success: true });
      });

      app.post(`${prefix}/highlight`, (req, res) => {
        if (!_currentInstance) return res.status(503).json({ error: `${name} plugin not running` });
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
          return res.status(503).json({ error: `No ${name} instance connected` });
        }
        console.log(`[${tag}] Sent HIGHLIGHT: ${callsign} (${highlight !== false ? 'on' : 'off'})`);
        res.json({ success: true });
      });
    },

    create(config, services) {
      const cfg = config[configKey] || {};
      const udpPort = cfg.udpPort || defaultPort;
      const bus = services?.pluginBus;

      let socket = null;
      let remoteAddress = null;
      let remotePort = null;
      let appId = name;
      let totalDecodes = 0;
      let lastStatus = null;

      // ── Enrichment state ──────────────────────────────────────────────────
      const gridCache = createGridCache();
      // Per-client state for decode enrichment (band, freq, mode)
      const clientStates = Object.create(null);
      // Content-based deduplication (time + freq + message)
      const seenDecodeIds = new Set();
      const SEEN_DECODE_MAX = 2000;
      let gridPruneInterval = null;

      function connect() {
        socket = dgram.createSocket('udp4');

        socket.on('message', (buf, rinfo) => {
          const msg = parseMessage(buf);
          if (!msg) return;

          remoteAddress = rinfo.address;
          remotePort = rinfo.port;
          if (msg.id) appId = msg.id;

          switch (msg.type) {
            case WSJTX_MSG.HEARTBEAT: {
              console.log(`[${tag}] Connected: ${msg.version || 'unknown version'} (${appId})`);
              break;
            }

            case WSJTX_MSG.STATUS: {
              const prevState = clientStates[msg.id] ?? null;
              const enriched = enrichStatus(msg, prevState, gridCache);

              clientStates[msg.id] = {
                band: enriched.band,
                dialFrequency: msg.dialFrequency,
                mode: msg.mode,
              };
              lastStatus = { ...msg, ...enriched };

              if (bus) bus.emit('status', { source: id, ...msg, ...enriched });
              break;
            }

            case WSJTX_MSG.DECODE: {
              if (!msg.isNew) break;
              totalDecodes++;

              const clientState = clientStates[msg.id] ?? null;
              const decode = enrichDecode(msg, clientState, gridCache, cfg.myCall ?? null);

              if (seenDecodeIds.has(decode.id)) break;
              seenDecodeIds.add(decode.id);
              if (seenDecodeIds.size > SEEN_DECODE_MAX) {
                seenDecodeIds.delete(seenDecodeIds.values().next().value);
              }

              if (bus) bus.emit('decode', { source: id, ...decode });

              if (cfg.verbose) {
                const snr = decode.snr != null ? (decode.snr >= 0 ? `+${decode.snr}` : decode.snr) : '?';
                console.log(`[${tag}] Decode ${decode.time} ${snr}dB ${decode.freq}Hz ${decode.message}`);
              }
              break;
            }

            case WSJTX_MSG.CLEAR: {
              if (bus) bus.emit('clear', { source: id, clientId: msg.id, window: msg.window });
              // Clear seen IDs for this client so post-clear replays are treated as fresh
              for (const seenId of seenDecodeIds) {
                if (seenId.startsWith(`${msg.id}-`)) seenDecodeIds.delete(seenId);
              }
              break;
            }

            case WSJTX_MSG.QSO_LOGGED: {
              const qso = {
                ...enrichQso(msg),
                myCall: msg.myCall || clientStates[msg.id]?.deCall || null,
                myGrid: msg.myGrid || clientStates[msg.id]?.deGrid || null,
              };
              if (bus) bus.emit('qso', { source: id, ...qso });
              break;
            }

            default:
              break;
          }
        });

        socket.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.error(`[${tag}] UDP port ${udpPort} already in use`);
          } else {
            console.error(`[${tag}] UDP error: ${err.message}`);
          }
          socket = null;
        });

        socket.on('listening', () => {
          const addr = socket.address();
          console.log(`[${tag}] Listening on UDP ${addr.address}:${addr.port}`);
          gridPruneInterval = setInterval(() => gridCache.prune(), 5 * 60 * 1000);
        });

        const bindAddr = cfg.bindAddress || '127.0.0.1';
        socket.bind(udpPort, bindAddr);
      }

      function disconnect() {
        if (gridPruneInterval) {
          clearInterval(gridPruneInterval);
          gridPruneInterval = null;
        }
        if (socket) {
          try {
            socket.close();
          } catch (e) {}
          socket = null;
        }
        _currentInstance = null;
        console.log(`[${tag}] Stopped (${totalDecodes} decodes)`);
      }

      function send(buffer) {
        if (!socket || !remoteAddress || !remotePort) return false;
        socket.send(buffer, 0, buffer.length, remotePort, remoteAddress, (err) => {
          if (err) console.error(`[${tag}] Send error: ${err.message}`);
        });
        return true;
      }

      function getAppId() {
        return appId;
      }

      function getStatus() {
        return {
          enabled: !!cfg.enabled,
          running: socket !== null,
          connected: !!(remoteAddress && remotePort),
          remoteAddress,
          remotePort,
          appId,
          decodeCount: totalDecodes,
          udpPort,
          gridCacheSize: gridCache.size,
          lastFrequency: lastStatus?.dialFrequency ?? null,
          lastBand: lastStatus?.band ?? null,
          lastMode: lastStatus?.mode ?? null,
          transmitting: lastStatus?.transmitting ?? false,
        };
      }

      const instance = { connect, disconnect, getStatus, send, getAppId };
      _currentInstance = instance;
      return instance;
    },
  };

  return descriptor;
}

module.exports = { createDigitalModePlugin };
