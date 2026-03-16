/**
 * WSJT-X UDP listener, relay, rig distribution, CTY routes.
 * Lines ~11162-12669 of original server.js
 */

const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { initCtyData, getCtyData, lookupCall } = require('../../src/server/ctydat.js');
const { gridToLatLon, getBandFromHz } = require('../utils/grid');

module.exports = function (app, ctx) {
  const {
    fetch,
    CONFIG,
    APP_VERSION,
    ROOT_DIR,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    writeLimiter,
    requireWriteAuth,
    maidenheadToLatLon,
    extractBaseCallsign,
    estimateLocationFromPrefix,
    extractGridFromComment,
    hamqthLookup,
    cacheCallsignLookup,
    callsignLookupCache,
  } = ctx;

  // Receives decoded messages from WSJT-X, JTDX, etc.
  // Configure WSJT-X: Settings > Reporting > UDP Server > address/port
  // Protocol: QDataStream binary format per NetworkMessage.hpp

  const WSJTX_UDP_PORT = parseInt(process.env.WSJTX_UDP_PORT || '2237');
  const WSJTX_ENABLED = process.env.WSJTX_ENABLED !== 'false'; // enabled by default
  const WSJTX_MULTICAST_ADDRESS = process.env.WSJTX_MULTICAST_ADDRESS;
  const WSJTX_RELAY_KEY = process.env.WSJTX_RELAY_KEY || ''; // auth key for remote relay agent
  const WSJTX_MAX_DECODES = 500; // max decodes to keep in memory
  const WSJTX_MAX_AGE = 60 * 60 * 1000; // 60 minutes (configurable via client)

  // WSJT-X protocol magic number
  const WSJTX_MAGIC = 0xadbccbda;

  // Message types
  const WSJTX_MSG = {
    HEARTBEAT: 0,
    STATUS: 1,
    DECODE: 2,
    CLEAR: 3,
    REPLY: 4,
    QSO_LOGGED: 5,
    CLOSE: 6,
    REPLAY: 7,
    HALT_TX: 8,
    FREE_TEXT: 9,
    WSPR_DECODE: 10,
    LOCATION: 11,
    LOGGED_ADIF: 12,
    HIGHLIGHT_CALLSIGN: 13,
    SWITCH_CONFIG: 14,
    CONFIGURE: 15,
  };

  // In-memory store (for local UDP — no session)
  const wsjtxState = {
    clients: {}, // clientId -> { status, lastSeen }
    decodes: [], // decoded messages (ring buffer)
    qsos: [], // logged QSOs
    wspr: [], // WSPR decodes
    relay: null, // not used for local UDP
  };

  // Per-session relay storage — each browser gets its own isolated data
  const wsjtxRelaySessions = {}; // sessionId -> { clients, decodes, qsos, wspr, relay, lastAccess }
  const WSJTX_SESSION_MAX_AGE = 60 * 60 * 1000; // 1 hour inactive expiry
  const WSJTX_MAX_SESSIONS = 50; // prevent memory abuse

  // Validate session IDs to prevent prototype pollution via __proto__/constructor/prototype
  function isValidSessionId(id) {
    if (!id || typeof id !== 'string') return false;
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') return false;
    return /^[A-Za-z0-9_\-:.]{1,128}$/.test(id);
  }

  function getRelaySession(sessionId) {
    if (!isValidSessionId(sessionId)) return null;
    if (!wsjtxRelaySessions[sessionId]) {
      // Check session limit
      if (Object.keys(wsjtxRelaySessions).length >= WSJTX_MAX_SESSIONS) {
        // Evict oldest session
        let oldestId = null,
          oldestTime = Infinity;
        for (const [id, s] of Object.entries(wsjtxRelaySessions)) {
          if (s.lastAccess < oldestTime) {
            oldestTime = s.lastAccess;
            oldestId = id;
          }
        }
        if (oldestId) delete wsjtxRelaySessions[oldestId];
      }
      wsjtxRelaySessions[sessionId] = {
        clients: {},
        decodes: [],
        qsos: [],
        wspr: [],
        relay: null,
        lastAccess: Date.now(),
      };
    }
    wsjtxRelaySessions[sessionId].lastAccess = Date.now();
    return wsjtxRelaySessions[sessionId];
  }

  // Cleanup expired sessions and stale grid cache entries every 5 minutes
  setInterval(
    () => {
      const now = Date.now();
      for (const [id, session] of Object.entries(wsjtxRelaySessions)) {
        if (now - session.lastAccess > WSJTX_SESSION_MAX_AGE) {
          delete wsjtxRelaySessions[id];
        }
      }
      // Prune grid cache entries older than 2 hours
      const gridCutoff = now - 2 * 60 * 60 * 1000;
      for (const [call, entry] of wsjtxGridCache) {
        if (entry.timestamp < gridCutoff) wsjtxGridCache.delete(call);
      }
    },
    5 * 60 * 1000,
  );

  /**
   * QDataStream binary reader for WSJT-X protocol
   * Reads big-endian Qt-serialized data types
   */
  class WSJTXReader {
    constructor(buffer) {
      this.buf = buffer;
      this.offset = 0;
    }

    remaining() {
      return this.buf.length - this.offset;
    }

    readUInt8() {
      if (this.remaining() < 1) return null;
      const v = this.buf.readUInt8(this.offset);
      this.offset += 1;
      return v;
    }

    readInt32() {
      if (this.remaining() < 4) return null;
      const v = this.buf.readInt32BE(this.offset);
      this.offset += 4;
      return v;
    }

    readUInt32() {
      if (this.remaining() < 4) return null;
      const v = this.buf.readUInt32BE(this.offset);
      this.offset += 4;
      return v;
    }

    readUInt64() {
      if (this.remaining() < 8) return null;
      // JavaScript can't do 64-bit ints natively, use BigInt or approximate
      const high = this.buf.readUInt32BE(this.offset);
      const low = this.buf.readUInt32BE(this.offset + 4);
      this.offset += 8;
      return high * 0x100000000 + low;
    }

    readBool() {
      const v = this.readUInt8();
      return v === null ? null : v !== 0;
    }

    readDouble() {
      if (this.remaining() < 8) return null;
      const v = this.buf.readDoubleBE(this.offset);
      this.offset += 8;
      return v;
    }

    // Qt utf8 string: uint32 length + bytes (0xFFFFFFFF = null)
    readUtf8() {
      const len = this.readUInt32();
      if (len === null || len === 0xffffffff) return null;
      if (len === 0) return '';
      if (this.remaining() < len) return null;
      const str = this.buf.toString('utf8', this.offset, this.offset + len);
      this.offset += len;
      return str;
    }

    // QTime: uint32 milliseconds since midnight
    readQTime() {
      const ms = this.readUInt32();
      if (ms === null) return null;
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return {
        ms,
        hours: h,
        minutes: m,
        seconds: s,
        formatted: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      };
    }

    // QDateTime: QDate (int64 julian day) + QTime (uint32 ms) + timespec
    readQDateTime() {
      const julianDay = this.readUInt64();
      const time = this.readQTime();
      const timeSpec = this.readUInt8();
      if (timeSpec === 2) this.readInt32(); // UTC offset
      return { julianDay, time, timeSpec };
    }
  }

  /**
   * Parse a WSJT-X UDP datagram
   */
  function parseWSJTXMessage(buffer) {
    const reader = new WSJTXReader(buffer);

    // Header
    const magic = reader.readUInt32();
    if (magic !== WSJTX_MAGIC) return null;

    const schema = reader.readUInt32();
    const type = reader.readUInt32();
    const id = reader.readUtf8();

    if (type === null || id === null) return null;

    const msg = { type, id, schema, timestamp: Date.now() };

    try {
      switch (type) {
        case WSJTX_MSG.HEARTBEAT: {
          msg.maxSchema = reader.readUInt32();
          msg.version = reader.readUtf8();
          msg.revision = reader.readUtf8();
          break;
        }

        case WSJTX_MSG.STATUS: {
          msg.dialFrequency = reader.readUInt64();
          msg.mode = reader.readUtf8();
          msg.dxCall = reader.readUtf8();
          msg.report = reader.readUtf8();
          msg.txMode = reader.readUtf8();
          msg.txEnabled = reader.readBool();
          msg.transmitting = reader.readBool();
          msg.decoding = reader.readBool();
          msg.rxDF = reader.readUInt32();
          msg.txDF = reader.readUInt32();
          msg.deCall = reader.readUtf8();
          msg.deGrid = reader.readUtf8();
          msg.dxGrid = reader.readUtf8();
          msg.txWatchdog = reader.readBool();
          msg.subMode = reader.readUtf8();
          msg.fastMode = reader.readBool();
          msg.specialOp = reader.readUInt8();
          msg.freqTolerance = reader.readUInt32();
          msg.trPeriod = reader.readUInt32();
          msg.configName = reader.readUtf8();
          msg.txMessage = reader.readUtf8();
          break;
        }

        case WSJTX_MSG.DECODE: {
          msg.isNew = reader.readBool();
          msg.time = reader.readQTime();
          msg.snr = reader.readInt32();
          msg.deltaTime = reader.readDouble();
          msg.deltaFreq = reader.readUInt32();
          msg.mode = reader.readUtf8();
          msg.message = reader.readUtf8();
          msg.lowConfidence = reader.readBool();
          msg.offAir = reader.readBool();
          break;
        }

        case WSJTX_MSG.CLEAR: {
          msg.window = reader.readUInt8();
          break;
        }

        case WSJTX_MSG.QSO_LOGGED: {
          msg.dateTimeOff = reader.readQDateTime();
          msg.dxCall = reader.readUtf8();
          msg.dxGrid = reader.readUtf8();
          msg.txFrequency = reader.readUInt64();
          msg.mode = reader.readUtf8();
          msg.reportSent = reader.readUtf8();
          msg.reportRecv = reader.readUtf8();
          msg.txPower = reader.readUtf8();
          msg.comments = reader.readUtf8();
          msg.name = reader.readUtf8();
          msg.dateTimeOn = reader.readQDateTime();
          msg.operatorCall = reader.readUtf8();
          msg.myCall = reader.readUtf8();
          msg.myGrid = reader.readUtf8();
          msg.exchangeSent = reader.readUtf8();
          msg.exchangeRecv = reader.readUtf8();
          msg.adifPropMode = reader.readUtf8();
          break;
        }

        case WSJTX_MSG.WSPR_DECODE: {
          msg.isNew = reader.readBool();
          msg.time = reader.readQTime();
          msg.snr = reader.readInt32();
          msg.deltaTime = reader.readDouble();
          msg.frequency = reader.readUInt64();
          msg.drift = reader.readInt32();
          msg.callsign = reader.readUtf8();
          msg.grid = reader.readUtf8();
          msg.power = reader.readInt32();
          msg.offAir = reader.readBool();
          break;
        }

        case WSJTX_MSG.LOGGED_ADIF: {
          msg.adif = reader.readUtf8();
          break;
        }

        case WSJTX_MSG.CLOSE:
          break;

        default:
          // Unknown message type - ignore per protocol spec
          return null;
      }
    } catch (e) {
      // Malformed packet - ignore
      return null;
    }

    return msg;
  }

  /**
   * Parse decoded message text to extract callsigns and grid
   * FT8/FT4 messages follow a standard format
   */
  // Callsign → grid cache: remembers grids seen in CQ messages for later QSO exchanges
  const wsjtxGridCache = new Map(); // callsign → { grid, lat, lon, timestamp }
  const wsjtxHamqthInflight = new Set(); // callsigns currently being looked up (prevents duplicate requests)

  function parseDecodeMessage(text) {
    if (!text) return {};
    const result = {};

    // FT8/FT4 protocol tokens that look like valid Maidenhead grids but aren't
    // RR73 matches [A-R]{2}\d{2} but is a QSO acknowledgment
    const FT8_TOKENS = new Set(['RR73', 'RR53', 'RR13', 'RR23', 'RR33', 'RR43', 'RR63', 'RR83', 'RR93']);

    // Validate grid: must be valid Maidenhead AND not an FT8 protocol token
    function isGrid(s) {
      if (!s || s.length < 4) return false;
      const g = s.toUpperCase();
      if (FT8_TOKENS.has(g)) return false;
      return /^[A-R]{2}\d{2}(?:[A-Xa-x]{2})?$/.test(s);
    }

    // Grid square regex: 2 alpha (A-R) + 2 digits, optionally + 2 alpha (a-x)
    const gridRegex = /\b([A-R]{2}\d{2}(?:[a-x]{2})?)\b/i;

    // ── CQ messages ──
    // Format: "CQ [modifier] CALLSIGN [GRID]"
    // Examples: "CQ K1ABC FN42", "CQ DX K1ABC FN42", "CQ POTA N0VIG EM28", "CQ K1ABC"
    if (/^CQ\s/i.test(text)) {
      result.type = 'CQ';
      const tokens = text.split(/\s+/).slice(1); // drop "CQ"

      // Work backwards: last token might be a grid
      let grid = null;
      if (tokens.length >= 2 && isGrid(tokens[tokens.length - 1])) {
        grid = tokens.pop();
      }

      // Remaining tokens: [modifier] CALLSIGN
      // The callsign is always the LAST remaining token
      // Modifiers (DX, POTA, NA, EU, etc.) come before it
      if (tokens.length >= 1) {
        result.caller = tokens[tokens.length - 1];
        result.modifier = tokens.length >= 2 ? tokens.slice(0, -1).join(' ') : null;
      }

      result.grid = grid;

      // Cache this callsign's grid for future lookups
      if (result.caller && result.grid) {
        const coords = gridToLatLon(result.grid);
        if (coords) {
          wsjtxGridCache.set(result.caller.toUpperCase(), {
            grid: result.grid,
            lat: coords.latitude,
            lon: coords.longitude,
            timestamp: Date.now(),
          });
        }
      }
      return result;
    }

    // ── Standard QSO exchange ──
    // Format: "DXCALL DECALL EXCHANGE"
    // Exchange can be: grid (EN82), report (+05, -12, R+05, R-12), 73, RR73, RRR
    const qsoMatch = text.match(/^([A-Z0-9/<>.]+)\s+([A-Z0-9/<>.]+)\s+(.*)/i);
    if (qsoMatch) {
      result.type = 'QSO';
      result.dxCall = qsoMatch[1];
      result.deCall = qsoMatch[2];
      result.exchange = qsoMatch[3].trim();

      // Look for a grid square in the exchange, but NOT FT8 protocol tokens
      const gridMatch = result.exchange.match(gridRegex);
      if (gridMatch && isGrid(gridMatch[1])) {
        result.grid = gridMatch[1];
        // Cache grid — in exchange it typically belongs to the calling station (dxCall)
        const coords = gridToLatLon(result.grid);
        if (coords) {
          const call = (result.deCall == CONFIG.callsign ? result.dxCall : result.deCall).toUpperCase();
          wsjtxGridCache.set(call, {
            grid: result.grid,
            lat: coords.latitude,
            lon: coords.longitude,
            timestamp: Date.now(),
          });
        }
      }
      return result;
    }

    return result;
  }

  /**
   * Convert frequency in Hz to band name
   */
  function freqToBand(freqHz) {
    const mhz = freqHz / 1000000;
    if (mhz >= 1.8 && mhz < 2.0) return '160m';
    if (mhz >= 3.5 && mhz < 4.0) return '80m';
    if (mhz >= 5.3 && mhz < 5.4) return '60m';
    if (mhz >= 7.0 && mhz < 7.3) return '40m';
    if (mhz >= 10.1 && mhz < 10.15) return '30m';
    if (mhz >= 14.0 && mhz < 14.35) return '20m';
    if (mhz >= 18.068 && mhz < 18.168) return '17m';
    if (mhz >= 21.0 && mhz < 21.45) return '15m';
    if (mhz >= 24.89 && mhz < 24.99) return '12m';
    if (mhz >= 28.0 && mhz < 29.7) return '10m';
    if (mhz >= 40.0 && mhz < 42.0) return '8m';
    if (mhz >= 50.0 && mhz < 54.0) return '6m';
    if (mhz >= 70.0 && mhz < 70.5) return '4m';
    if (mhz >= 144.0 && mhz < 148.0) return '2m';
    if (mhz >= 420.0 && mhz < 450.0) return '70cm';
    return `${mhz.toFixed(3)} MHz`;
  }

  /**
   * Handle incoming WSJT-X messages
   * @param {Object} msg - parsed WSJT-X message
   * @param {Object} state - state object to update (wsjtxState for local, session for relay)
   */
  function handleWSJTXMessage(msg, state) {
    if (!msg) return;
    if (!state) state = wsjtxState;
    // Reject dangerous msg.id values to prevent prototype pollution on state.clients
    if (msg.id && !isValidSessionId(msg.id)) return;

    // Ensure clients is a prototype-less object to prevent prototype pollution
    if (!state.clients || Object.getPrototypeOf(state.clients) !== null) {
      state.clients = Object.assign(Object.create(null), state.clients || {});
    }

    switch (msg.type) {
      case WSJTX_MSG.HEARTBEAT: {
        state.clients[msg.id] = {
          ...(state.clients[msg.id] || {}),
          version: msg.version,
          lastSeen: msg.timestamp,
        };
        break;
      }

      case WSJTX_MSG.STATUS: {
        const prev = state.clients[msg.id] || {};
        const newBand = msg.dialFrequency ? freqToBand(msg.dialFrequency) : null;

        // ── Resolve DX callsign to coordinates ──
        // When the operator selects a callsign in WSJT-X (setting Std Msgs),
        // dxCall and optionally dxGrid are sent in the STATUS message.
        // We resolve to lat/lon so the client can set the DX target.
        let dxLat = null;
        let dxLon = null;
        let dxGrid = msg.dxGrid || null;
        const dxCall = (msg.dxCall || '').replace(/[<>]/g, '').trim();

        if (dxCall) {
          // 1. Try dxGrid from WSJT-X (if it knows the DX station's grid)
          if (dxGrid) {
            const coords = gridToLatLon(dxGrid);
            if (coords) {
              dxLat = coords.latitude;
              dxLon = coords.longitude;
            }
          }
          // 2. Try grid cache (from prior CQ/exchange messages with grids)
          if (dxLat === null) {
            const cached = wsjtxGridCache.get(dxCall.toUpperCase());
            if (cached) {
              dxLat = cached.lat;
              dxLon = cached.lon;
              dxGrid = dxGrid || cached.grid;
            }
          }
          // 3. Try callsign lookup cache (HamQTH/QRZ)
          if (dxLat === null) {
            const baseCall = extractBaseCallsign(dxCall);
            if (baseCall) {
              const cached = callsignLookupCache.get(baseCall);
              if (cached && Date.now() - cached.timestamp < CALLSIGN_CACHE_TTL && cached.data?.lat != null) {
                dxLat = cached.data.lat;
                dxLon = cached.data.lon;
              }
            }
          }
          // 4. Last resort: estimate from callsign prefix
          if (dxLat === null) {
            const prefixLoc = estimateLocationFromPrefix(dxCall);
            if (prefixLoc) {
              dxLat = prefixLoc.lat;
              dxLon = prefixLoc.lon;
              dxGrid = dxGrid || prefixLoc.grid;
            }
          }
        }

        // ── Detect band change ──
        // When the operator changes bands in WSJT-X, old-band decodes are stale.
        // Track the change so clients can clear their decode list.
        const bandChanged = prev.band && newBand && prev.band !== newBand;

        state.clients[msg.id] = {
          ...prev,
          lastSeen: msg.timestamp,
          dialFrequency: msg.dialFrequency,
          mode: msg.mode,
          dxCall: dxCall || null,
          dxGrid: dxGrid,
          dxLat,
          dxLon,
          deCall: msg.deCall,
          deGrid: msg.deGrid,
          txEnabled: msg.txEnabled,
          transmitting: msg.transmitting,
          decoding: msg.decoding,
          subMode: msg.subMode,
          band: newBand,
          configName: msg.configName,
          txMessage: msg.txMessage,
          bandChanged: bandChanged ? { from: prev.band, to: newBand, at: msg.timestamp } : prev.bandChanged || null,
        };

        // Clear bandChanged flag after 10 seconds (client has had time to see it)
        if (bandChanged) {
          setTimeout(() => {
            const client = state.clients[msg.id];
            if (client?.bandChanged?.at === msg.timestamp) {
              client.bandChanged = null;
            }
          }, 10000);
        }
        break;
      }

      case WSJTX_MSG.DECODE: {
        const clientStatus = state.clients[msg.id] || {};
        const parsed = parseDecodeMessage(msg.message);

        const decode = {
          id: `${msg.id}-${(msg.time?.formatted || '').replace(/[^0-9]/g, '')}-${msg.deltaFreq}-${(msg.message || '').replace(/\s+/g, '')}`,
          clientId: msg.id,
          isNew: msg.isNew,
          time: msg.time?.formatted || '',
          timeMs: msg.time?.ms || 0,
          snr: msg.snr,
          dt: msg.deltaTime ? msg.deltaTime.toFixed(1) : '0.0',
          freq: msg.deltaFreq,
          mode: msg.mode || clientStatus.mode || '',
          message: msg.message,
          lowConfidence: msg.lowConfidence,
          offAir: msg.offAir,
          dialFrequency: clientStatus.dialFrequency || 0,
          band: clientStatus.band || '',
          ...parsed,
          timestamp: msg.timestamp,
        };

        // Resolve grid to lat/lon for map plotting
        if (parsed.grid) {
          const coords = gridToLatLon(parsed.grid);
          if (coords) {
            decode.lat = coords.latitude;
            decode.lon = coords.longitude;
          }
        }

        // If no grid from message, try callsign → grid cache (from prior CQ/exchange with grid)
        if (!decode.lat) {
          const targetCall = (
            parsed.caller ||
            (parsed.deCall == CONFIG.callsign ? parsed.dxCall : parsed.deCall) ||
            ''
          ).toUpperCase();
          if (targetCall) {
            const cached = wsjtxGridCache.get(targetCall);
            if (cached) {
              decode.lat = cached.lat;
              decode.lon = cached.lon;
              decode.grid = decode.grid || cached.grid;
              decode.gridSource = 'cache';
            }
          }
        }

        // Try HamQTH callsign cache (DXCC-level, more accurate than prefix centroid)
        if (!decode.lat) {
          const rawCall = (
            parsed.caller ||
            (parsed.deCall == CONFIG.callsign ? parsed.dxCall : parsed.deCall) ||
            ''
          ).toUpperCase();
          const targetCall = extractBaseCallsign(rawCall);
          if (targetCall) {
            const cached = callsignLookupCache.get(targetCall);
            if (cached && Date.now() - cached.timestamp < CALLSIGN_CACHE_TTL && cached.data?.lat != null) {
              decode.lat = cached.data.lat;
              decode.lon = cached.data.lon;
              decode.gridSource = 'hamqth';
            } else if (targetCall.length >= 3 && !wsjtxHamqthInflight.has(targetCall) && wsjtxHamqthInflight.size < 5) {
              // Background lookup for next cycle (fire-and-forget, max 5 concurrent)
              wsjtxHamqthInflight.add(targetCall);
              fetch(`https://www.hamqth.com/dxcc.php?callsign=${encodeURIComponent(targetCall)}`, {
                headers: { 'User-Agent': 'OpenHamClock/' + APP_VERSION },
                signal: AbortSignal.timeout(5000),
              })
                .then(async (resp) => {
                  if (!resp.ok) return;
                  const text = await resp.text();
                  const latMatch = text.match(/<lat>([^<]+)<\/lat>/);
                  const lonMatch = text.match(/<lng>([^<]+)<\/lng>/);
                  const countryMatch = text.match(/<n>([^<]+)<\/name>/);
                  if (latMatch && lonMatch) {
                    cacheCallsignLookup(targetCall, {
                      data: {
                        callsign: targetCall,
                        lat: parseFloat(latMatch[1]),
                        lon: parseFloat(lonMatch[1]),
                        country: countryMatch ? countryMatch[1] : '',
                      },
                      timestamp: Date.now(),
                    });
                  }
                })
                .catch(() => {})
                .finally(() => {
                  wsjtxHamqthInflight.delete(targetCall);
                });
            }
          }
        }

        // Last resort: estimate from callsign prefix
        if (!decode.lat) {
          const rawCall = parsed.caller || (parsed.deCall == CONFIG.callsign ? parsed.dxCall : parsed.deCall) || '';
          const targetCall = extractBaseCallsign(rawCall);
          if (targetCall) {
            const prefixLoc = estimateLocationFromPrefix(targetCall);
            if (prefixLoc) {
              decode.lat = prefixLoc.lat;
              decode.lon = prefixLoc.lon;
              decode.grid = decode.grid || prefixLoc.grid;
              decode.gridSource = 'prefix';
            }
          }
        }

        // Only keep new decodes (not replays), deduplicate by content-based ID
        if (msg.isNew) {
          const isDup = state.decodes.some((d) => d.id === decode.id);
          if (!isDup) {
            state.decodes.push(decode);

            // Trim old decodes
            const cutoff = Date.now() - WSJTX_MAX_AGE;
            while (
              state.decodes.length > WSJTX_MAX_DECODES ||
              (state.decodes.length > 0 && state.decodes[0].timestamp < cutoff)
            ) {
              state.decodes.shift();
            }
          }
        }
        break;
      }

      case WSJTX_MSG.CLEAR: {
        // WSJT-X cleared its band activity - optionally clear our decodes for this client
        state.decodes = state.decodes.filter((d) => d.clientId !== msg.id);
        break;
      }

      case WSJTX_MSG.QSO_LOGGED: {
        const clientStatus = state.clients[msg.id] || {};
        const qso = {
          clientId: msg.id,
          dxCall: msg.dxCall,
          dxGrid: msg.dxGrid,
          frequency: msg.txFrequency,
          band: msg.txFrequency ? freqToBand(msg.txFrequency) : '',
          mode: msg.mode,
          reportSent: msg.reportSent,
          reportRecv: msg.reportRecv,
          myCall: msg.myCall || clientStatus.deCall,
          myGrid: msg.myGrid || clientStatus.deGrid,
          timestamp: msg.timestamp,
        };
        // Resolve grid to lat/lon
        if (msg.dxGrid) {
          const coords = gridToLatLon(msg.dxGrid);
          if (coords) {
            qso.lat = coords.latitude;
            qso.lon = coords.longitude;
          }
        }
        // Deduplicate: skip if same call + freq + mode within 60 seconds
        const isDupQso = state.qsos.some(
          (q) =>
            q.dxCall === qso.dxCall &&
            q.frequency === qso.frequency &&
            q.mode === qso.mode &&
            Math.abs(q.timestamp - qso.timestamp) < 60000,
        );
        if (!isDupQso) {
          state.qsos.push(qso);
          // Keep last 50 QSOs
          if (state.qsos.length > 50) state.qsos.shift();
        }
        break;
      }

      case WSJTX_MSG.WSPR_DECODE: {
        const wsprDecode = {
          clientId: msg.id,
          isNew: msg.isNew,
          time: msg.time?.formatted || '',
          snr: msg.snr,
          dt: msg.deltaTime ? msg.deltaTime.toFixed(1) : '0.0',
          frequency: msg.frequency,
          drift: msg.drift,
          callsign: msg.callsign,
          grid: msg.grid,
          power: msg.power,
          timestamp: msg.timestamp,
        };
        // Resolve grid to lat/lon for map plotting
        if (msg.grid) {
          const coords = gridToLatLon(msg.grid);
          if (coords) {
            wsprDecode.lat = coords.latitude;
            wsprDecode.lon = coords.longitude;
          }
        }
        if (msg.isNew) {
          state.wspr.push(wsprDecode);
          if (state.wspr.length > 100) state.wspr.shift();
        }
        break;
      }

      case WSJTX_MSG.CLOSE: {
        delete state.clients[msg.id];
        break;
      }
    }
  }

  // ---- N3FJP Logged QSO relay (in-memory) ----
  const N3FJP_QSO_RETENTION_MINUTES = parseInt(process.env.N3FJP_QSO_RETENTION_MINUTES || '1440', 10);
  let n3fjpQsos = [];

  function pruneN3fjpQsos() {
    const cutoff = Date.now() - N3FJP_QSO_RETENTION_MINUTES * 60 * 1000;
    n3fjpQsos = n3fjpQsos.filter((q) => {
      const t = Date.parse(q.ts_utc || q.ts || '');
      return !Number.isNaN(t) && t >= cutoff;
    });
  }

  // Simple in-memory cache so we don't hammer callsign lookup on every QSO
  const n3fjpCallCache = new Map(); // key=callsign, val={ts, result}
  const N3FJP_CALL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  async function lookupCallLatLon(callsign) {
    const call = (callsign || '').toUpperCase().trim();
    if (!call) return null;

    const cached = n3fjpCallCache.get(call);
    if (cached && Date.now() - cached.ts < N3FJP_CALL_CACHE_TTL_MS) {
      return cached.result;
    }

    try {
      // Reuse your existing endpoint (keeps all HamQTH/grid logic in one place)
      const resp = await fetch(`http://localhost:${PORT}/api/callsign/${encodeURIComponent(call)}`);
      if (!resp.ok) return null;

      const data = await resp.json();
      if (typeof data.lat === 'number' && typeof data.lon === 'number') {
        n3fjpCallCache.set(call, { ts: Date.now(), result: data });
        return data;
      }
    } catch (e) {
      // swallow: mapping should never crash the server
    }
    return null;
  }

  // POST one QSO from a bridge (your Python script)
  app.post('/api/n3fjp/qso', writeLimiter, requireWriteAuth, async (req, res) => {
    const qso = req.body || {};
    if (!qso.dx_call) return res.status(400).json({ ok: false, error: 'dx_call required' });

    if (!qso.ts_utc) qso.ts_utc = new Date().toISOString();
    if (!qso.source) qso.source = 'n3fjp_to_timemapper_udp';

    // Always ACK immediately so the bridge never times out
    res.json({ ok: true });

    // Do enrichment + storage after ACK
    setImmediate(async () => {
      try {
        //
        // Enrich DX location: GRID → (preferred) → HamQTH fallback
        //
        let locSource = '';

        // 1) Prefer exact operating grid (N3FJP “Grid Rec” field)
        if (qso.dx_grid) {
          const loc = maidenheadToLatLon(qso.dx_grid);
          if (loc) {
            qso.lat = loc.lat;
            qso.lon = loc.lon;
            qso.loc_source = 'grid';
            locSource = 'grid';
          }
        }

        // 2) If no grid provided, fall back to HamQTH/home QTH lookup
        if (!locSource) {
          const dx = await lookupCallLatLon(qso.dx_call);
          if (dx) {
            qso.lat = dx.lat;
            qso.lon = dx.lon;
            qso.dx_country = dx.country || '';
            qso.dx_cqZone = dx.cqZone || '';
            qso.dx_ituZone = dx.ituZone || '';
            qso.loc_source = 'hamqth';
          }
        }

        n3fjpQsos.unshift(qso);
        pruneN3fjpQsos();

        // cap memory
        if (n3fjpQsos.length > 200) n3fjpQsos.length = 200;
      } catch (e) {
        console.error('[/api/n3fjp/qso] post-ack processing failed:', e);
      }
    });
  });

  // GET recent QSOs (pruned to retention window)
  app.get('/api/n3fjp/qsos', (req, res) => {
    pruneN3fjpQsos();
    res.json({
      ok: true,
      retention_minutes: N3FJP_QSO_RETENTION_MINUTES,
      qsos: n3fjpQsos,
    });
  });

  // Start UDP listener
  let wsjtxSocket = null;
  if (WSJTX_ENABLED) {
    try {
      wsjtxSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      wsjtxSocket.on('message', (buf, rinfo) => {
        const msg = parseWSJTXMessage(buf);
        if (msg) handleWSJTXMessage(msg);
      });

      wsjtxSocket.on('error', (err) => {
        logErrorOnce('WSJT-X UDP', err.message);
      });

      wsjtxSocket.on('listening', () => {
        const addr = wsjtxSocket.address();
        console.log(`[WSJT-X] UDP listener on ${addr.address}:${addr.port}`);

        if (WSJTX_MULTICAST_ADDRESS) {
          try {
            wsjtxSocket.addMembership(WSJTX_MULTICAST_ADDRESS);
            console.log(`[WSJT-X] Joined multicast group ${WSJTX_MULTICAST_ADDRESS}`);
          } catch (e) {
            console.error(`[WSJT-X] Failed to join multicast group ${WSJTX_MULTICAST_ADDRESS}: ${e.message}`);
          }
        }
      });

      if (WSJTX_MULTICAST_ADDRESS) {
        wsjtxSocket.bind(
          {
            port: WSJTX_UDP_PORT,
            exclusive: false,
          },
          () => {
            wsjtxSocket.setMulticastLoopback(true);
          },
        );
      } else {
        wsjtxSocket.bind({
          port: WSJTX_UDP_PORT,
          address: '0.0.0.0',
        });
      }
    } catch (e) {
      console.error(`[WSJT-X] Failed to start UDP listener: ${e.message}`);
    }
  }

  // API endpoint: get WSJT-X data
  app.get('/api/wsjtx', (req, res) => {
    const sessionId = req.query.session || '';

    // Use session-specific state for relay mode, or global state for local UDP
    const state =
      sessionId && WSJTX_RELAY_KEY
        ? wsjtxRelaySessions[sessionId] || {
            clients: {},
            decodes: [],
            qsos: [],
            wspr: [],
            relay: null,
          }
        : wsjtxState;

    const clients = {};
    for (const [id, client] of Object.entries(state.clients)) {
      // Only include clients seen in last 5 minutes
      if (Date.now() - client.lastSeen < 5 * 60 * 1000) {
        clients[id] = client;
      }
    }

    // Relay is "connected" if this session's relay was seen in last 60 seconds
    const relayConnected = state.relay && Date.now() - state.relay.lastSeen < 60000;

    res.json({
      enabled: WSJTX_ENABLED,
      port: WSJTX_UDP_PORT,
      relayEnabled: !!WSJTX_RELAY_KEY,
      relayConnected: !!relayConnected,
      clients,
      decodes: state.decodes.slice(-100), // last 100
      qsos: state.qsos.slice(-20), // last 20
      wspr: state.wspr.slice(-50), // last 50
      stats: {
        totalDecodes: state.decodes.length,
        totalQsos: state.qsos.length,
        totalWspr: state.wspr.length,
        activeClients: Object.keys(clients).length,
      },
    });
  });

  // API endpoint: get just decodes (lightweight polling)
  app.get('/api/wsjtx/decodes', (req, res) => {
    const sessionId = req.query.session || '';
    const state = sessionId && WSJTX_RELAY_KEY ? wsjtxRelaySessions[sessionId] || { decodes: [] } : wsjtxState;

    const since = parseInt(req.query.since) || 0;
    const decodes = since ? state.decodes.filter((d) => d.timestamp > since) : state.decodes.slice(-100);

    res.json({ decodes, timestamp: Date.now() });
  });

  // API endpoint: relay — receive messages from remote relay agent
  // The relay agent runs on the same machine as WSJT-X and forwards
  // parsed messages over HTTPS for cloud-hosted instances.
  app.post('/api/wsjtx/relay', (req, res) => {
    // Auth check
    if (!WSJTX_RELAY_KEY) {
      return res.status(503).json({ error: 'Relay not configured — set WSJTX_RELAY_KEY in .env' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== WSJTX_RELAY_KEY) {
      return res.status(401).json({ error: 'Invalid relay key' });
    }

    // Session ID is required for relay — isolates data per browser
    const sessionId = req.body.session || req.headers['x-relay-session'] || '';
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const session = getRelaySession(sessionId);

    // Relay heartbeat — just registers the relay as alive for this session
    if (req.body && req.body.relay === true) {
      session.relay = {
        lastSeen: Date.now(),
        version: req.body.version || '1.0.0',
        port: req.body.port || 2237,
      };
      return res.json({ ok: true, timestamp: Date.now() });
    }

    // Regular message batch
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    // Update relay last seen on every batch too
    session.relay = { ...(session.relay || {}), lastSeen: Date.now() };

    // Rate limit: max 100 messages per request
    const batch = messages.slice(0, 100);
    let processed = 0;

    for (const msg of batch) {
      if (msg && typeof msg.type === 'number' && msg.id) {
        // Ensure timestamp is reasonable (within last 5 minutes or use server time)
        if (!msg.timestamp || Math.abs(Date.now() - msg.timestamp) > 5 * 60 * 1000) {
          msg.timestamp = Date.now();
        }
        handleWSJTXMessage(msg, session);
        processed++;
      }
    }

    res.json({ ok: true, processed, timestamp: Date.now() });
  });

  // API endpoint: serve raw relay.js (used by Windows .bat launcher)
  app.get('/api/wsjtx/relay/agent.js', (req, res) => {
    const relayJsPath = path.join(ROOT_DIR, 'wsjtx-relay', 'relay.js');
    try {
      const content = fs.readFileSync(relayJsPath, 'utf8');
      res.setHeader('Content-Type', 'application/javascript');
      res.send(content);
    } catch (e) {
      res.status(500).json({ error: 'relay.js not found on server' });
    }
  });

  // API endpoint: download pre-configured relay agent script
  // Embeds relay.js + server URL + relay key into a one-file launcher
  app.get('/api/wsjtx/relay/download/:platform', (req, res) => {
    if (!WSJTX_RELAY_KEY) {
      return res.status(503).json({ error: 'Relay not configured — set WSJTX_RELAY_KEY in .env' });
    }

    const platform = req.params.platform; // 'linux', 'mac', or 'windows'
    const relayJsPath = path.join(ROOT_DIR, 'wsjtx-relay', 'relay.js');

    let relayJs;
    try {
      relayJs = fs.readFileSync(relayJsPath, 'utf8');
    } catch (e) {
      return res.status(500).json({ error: 'relay.js not found on server' });
    }

    // Detect server URL from request
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const serverURL = proto + '://' + host;

    // Session ID from query param — ties this relay to the downloading browser
    const sessionId = req.query.session || '';
    if (!sessionId) {
      return res.status(400).json({
        error: 'Session ID required — download from the OpenHamClock dashboard',
      });
    }

    // SECURITY: Validate platform parameter
    if (!['linux', 'mac', 'windows'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform. Use: linux, mac, or windows' });
    }

    // SECURITY: Sanitize all values embedded into generated scripts to prevent command injection
    // Only allow URL-safe characters in serverURL, alphanumeric + hyphen/underscore in session/key
    function sanitizeForShell(str) {
      return String(str).replace(/[^a-zA-Z0-9._\-:\/\@]/g, '');
    }
    const safeServerURL = sanitizeForShell(serverURL);
    const safeSessionId = sanitizeForShell(sessionId);
    const safeRelayKey = sanitizeForShell(WSJTX_RELAY_KEY);

    if (platform === 'linux' || platform === 'mac') {
      // Build bash script with relay.js embedded as heredoc
      const lines = [
        '#!/bin/bash',
        '# OpenHamClock WSJT-X Relay — Auto-configured',
        '# Generated by ' + safeServerURL,
        '#',
        '# Usage:  bash ' + (platform === 'mac' ? 'start-relay.command' : 'start-relay.sh'),
        '# Stop:   Ctrl+C',
        '# Requires: Node.js 14+ (https://nodejs.org)',
        '#',
        '# In WSJT-X: Settings > Reporting > UDP Server',
        '#   Address: 127.0.0.1   Port: 2237',
        '',
        'set -e',
        '',
        '# Check for Node.js',
        'if ! command -v node &> /dev/null; then',
        '    echo ""',
        '    echo "Node.js is not installed."',
        '    echo "Install from https://nodejs.org (LTS recommended)"',
        '    echo ""',
        '    echo "Quick install:"',
        '    echo "  Ubuntu/Debian: sudo apt install nodejs"',
        '    echo "  Mac (Homebrew): brew install node"',
        '    echo "  Fedora: sudo dnf install nodejs"',
        '    echo ""',
        '    exit 1',
        'fi',
        '',
        '# Write relay agent to temp file',
        'RELAY_FILE=$(mktemp /tmp/ohc-relay-XXXXXX.js)',
        'trap "rm -f $RELAY_FILE" EXIT',
        '',
        'cat > "$RELAY_FILE" << \'OPENHAMCLOCK_RELAY_EOF\'',
        relayJs,
        'OPENHAMCLOCK_RELAY_EOF',
        '',
        '# Run relay',
        'exec node "$RELAY_FILE" \\',
        '  --url "' + safeServerURL + '" \\',
        '  --key "' + safeRelayKey + '" \\',
        '  --session "' + safeSessionId + '"',
      ];

      const script = lines.join('\n') + '\n';
      const filename = platform === 'mac' ? 'start-relay.command' : 'start-relay.sh';
      res.setHeader('Content-Type', 'application/x-sh');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      return res.send(script);
    } else if (platform === 'windows') {
      // .bat that auto-downloads portable Node.js if needed, then runs relay
      // No install, no admin, no PowerShell execution policy issues
      const NODE_VERSION = 'v22.13.1'; // LTS
      const NODE_ZIP = 'node-' + NODE_VERSION + '-win-x64.zip';
      const NODE_DIR = 'node-' + NODE_VERSION + '-win-x64';
      const NODE_URL = 'https://nodejs.org/dist/' + NODE_VERSION + '/' + NODE_ZIP;

      const batLines = [
        '@echo off',
        'setlocal',
        'title OpenHamClock WSJT-X Relay',
        'echo.',
        'echo  =========================================',
        'echo   OpenHamClock WSJT-X Relay Agent v1.0',
        'echo  =========================================',
        'echo.',
        '',
        ':: Check for Node.js (system-installed or portable)',
        'set "NODE_EXE=node"',
        'set "PORTABLE_DIR=%TEMP%\\ohc-node"',
        '',
        'where node >nul 2>nul',
        'if not errorlevel 1 (',
        '    for /f "tokens=*" %%i in (\'node -v\') do echo   Found Node.js %%i',
        '    goto :have_node',
        ')',
        '',
        ':: Check for previously downloaded portable Node.js',
        'if exist "%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe" (',
        '    set "NODE_EXE=%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe"',
        '    echo   Found portable Node.js',
        '    goto :have_node',
        ')',
        '',
        ':: Download portable Node.js',
        'echo   Node.js not found. Downloading portable version...',
        'echo   (This is a one-time ~30MB download^)',
        'echo.',
        '',
        'if not exist "%PORTABLE_DIR%" mkdir "%PORTABLE_DIR%"',
        '',
        'powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \'' +
          NODE_URL +
          "' -OutFile '%PORTABLE_DIR%\\" +
          NODE_ZIP +
          '\' } catch { Write-Host $_.Exception.Message; exit 1 }"',
        'if errorlevel 1 (',
        '    echo.',
        '    echo   Failed to download Node.js!',
        '    echo   Check your internet connection and try again.',
        '    echo.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'echo   Extracting...',
        'powershell -Command "Expand-Archive -Path \'%PORTABLE_DIR%\\' +
          NODE_ZIP +
          "' -DestinationPath '%PORTABLE_DIR%' -Force\"",
        'if errorlevel 1 (',
        '    echo   Failed to extract Node.js!',
        '    echo.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'del "%PORTABLE_DIR%\\' + NODE_ZIP + '" >nul 2>nul',
        'set "NODE_EXE=%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe"',
        'echo   Portable Node.js ready.',
        'echo.',
        '',
        ':have_node',
        'echo   Server: ' + safeServerURL,
        'echo.',
        '',
        ':: Download relay agent',
        'echo   Downloading relay agent...',
        'powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \'' +
          safeServerURL +
          "/api/wsjtx/relay/agent.js' -OutFile '%TEMP%\\ohc-relay.js' } catch { Write-Host $_.Exception.Message; exit 1 }\"",
        'if errorlevel 1 (',
        '    echo   Failed to download relay agent!',
        '    echo   Check your internet connection and try again.',
        '    echo.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'echo   Relay agent ready.',
        'echo.',
        'echo   In WSJT-X: Settings ^> Reporting ^> UDP Server',
        'echo     Address: 127.0.0.1   Port: 2237',
        'echo.',
        'echo   Press Ctrl+C to stop',
        'echo.',
        '',
        ':: Run relay',
        '%NODE_EXE% "%TEMP%\\ohc-relay.js" --url "' +
          safeServerURL +
          '" --key "' +
          safeRelayKey +
          '" --session "' +
          safeSessionId +
          '"',
        '',
        'echo.',
        'echo   Relay stopped.',
        'del "%TEMP%\\ohc-relay.js" >nul 2>nul',
        'echo.',
        'pause',
      ];

      const script = batLines.join('\r\n') + '\r\n';
      res.setHeader('Content-Type', 'application/x-msdos-program');
      res.setHeader('Content-Disposition', 'attachment; filename="start-relay.bat"');
      return res.send(script);
    } else {
      return res.status(400).json({ error: 'Invalid platform. Use: linux, mac, or windows' });
    }
  });

  // CONTEST LOGGER UDP + API (N1MM / DXLog)
  // ============================================

  // ── CTY.DAT — DXCC Entity Database ────────────────────────
  // Serves the parsed cty.dat prefix → entity lookup for client-side callsign identification.
  // Data from country-files.com (AD1C), refreshed every 24h.

  app.get('/api/cty', (req, res) => {
    const data = getCtyData();
    if (!data) {
      return res.status(503).json({ error: 'CTY data not yet loaded' });
    }
    // Long cache — data only changes every few weeks upstream
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.json(data);
  });

  // Lightweight single-call lookup (avoids sending full 200KB+ database to client)
  app.get('/api/cty/lookup/:call', (req, res) => {
    const result = lookupCall(req.params.call);
    if (!result) {
      return res.status(404).json({ error: 'Unknown callsign prefix' });
    }
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.json(result);
  });

  // ── RIG LISTENER DOWNLOAD ─────────────────────────────────
  // Serves the rig-listener.js agent and generates one-click launcher scripts
  // that auto-download portable Node.js + serialport. User double-clicks → wizard runs.

  app.get('/api/rig/listener.js', (req, res) => {
    const listenerPath = path.join(ROOT_DIR, 'rig-listener', 'rig-listener.js');
    try {
      const js = fs.readFileSync(listenerPath, 'utf8');
      res.setHeader('Content-Type', 'application/javascript');
      res.send(js);
    } catch (e) {
      res.status(500).json({ error: 'rig-listener.js not found on server' });
    }
  });

  app.get('/api/rig/package.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
      name: 'ohc-rig',
      version: '1.0.0',
      dependencies: { serialport: '^12.0.0' },
    });
  });

  app.get('/api/rig/download/:platform', (req, res) => {
    const platform = req.params.platform;
    if (!['linux', 'mac', 'windows'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform. Use: linux, mac, or windows' });
    }

    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const serverURL = (proto + '://' + host).replace(/[^a-zA-Z0-9._\-:\/\@]/g, '');

    if (platform === 'windows') {
      const NODE_VERSION = 'v22.13.1';
      const NODE_ZIP = 'node-' + NODE_VERSION + '-win-x64.zip';
      const NODE_DIR = 'node-' + NODE_VERSION + '-win-x64';
      const NODE_URL = 'https://nodejs.org/dist/' + NODE_VERSION + '/' + NODE_ZIP;

      const bat =
        [
          '@echo off',
          'setlocal',
          'title OpenHamClock Rig Listener',
          'echo.',
          'echo  =========================================',
          'echo   OpenHamClock Rig Listener v1.0',
          'echo  =========================================',
          'echo.',
          '',
          ':: Persistent install folder next to this .bat',
          'set "RIG_DIR=%~dp0openhamclock-rig"',
          'if not exist "%RIG_DIR%" mkdir "%RIG_DIR%"',
          '',
          ':: ---- Node.js ----',
          'set "NODE_EXE=node"',
          'set "NPM_EXE=npm"',
          'set "PORTABLE_DIR=%RIG_DIR%\\.node"',
          '',
          'where node >nul 2>nul',
          'if not errorlevel 1 (',
          '    for /f "tokens=*" %%i in (\'node -v\') do echo   Found Node.js %%i',
          '    for /f "delims=" %%i in (\'where node\') do set "NODE_EXE=%%i"',
          '    for /f "delims=" %%i in (\'where npm\') do set "NPM_EXE=%%i"',
          '    goto :have_node',
          ')',
          '',
          'if exist "%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe" (',
          '    set "NODE_EXE=%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe"',
          '    set "NPM_EXE=%PORTABLE_DIR%\\' + NODE_DIR + '\\npm.cmd"',
          '    echo   Found portable Node.js',
          '    goto :have_node',
          ')',
          '',
          'echo   Node.js not found. Downloading portable version...',
          'echo   (One-time ~30MB download)',
          'echo.',
          'if not exist "%PORTABLE_DIR%" mkdir "%PORTABLE_DIR%"',
          '',
          'powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \'' +
            NODE_URL +
            "' -OutFile '%PORTABLE_DIR%\\" +
            NODE_ZIP +
            '\' } catch { Write-Host $_.Exception.Message; exit 1 }"',
          'if errorlevel 1 (',
          '    echo   Failed to download Node.js! Check your internet connection.',
          '    pause',
          '    exit /b 1',
          ')',
          '',
          'echo   Extracting...',
          'powershell -Command "Expand-Archive -Path \'%PORTABLE_DIR%\\' +
            NODE_ZIP +
            "' -DestinationPath '%PORTABLE_DIR%' -Force\"",
          'del "%PORTABLE_DIR%\\' + NODE_ZIP + '" >nul 2>nul',
          'set "NODE_EXE=%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe"',
          'set "NPM_EXE=%PORTABLE_DIR%\\' + NODE_DIR + '\\npm.cmd"',
          'echo   Node.js ready.',
          'echo.',
          '',
          ':have_node',
          '',
          ':: Ensure node directory is in PATH (needed for portable node; no-op for system node)',
          'for %%F in ("%NODE_EXE%") do set "NODE_BIN_DIR=%%~dpF"',
          'echo "%PATH%" | find /i "%NODE_BIN_DIR%" >nul 2>nul || set "PATH=%NODE_BIN_DIR%;%PATH%"',
          '',
          ':: ---- Download rig-listener.js ----',
          'echo   Downloading rig listener...',
          'powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \'' +
            serverURL +
            "/api/rig/listener.js' -OutFile '%RIG_DIR%\\rig-listener.js' } catch { Write-Host $_.Exception.Message; exit 1 }\"",
          'if errorlevel 1 (',
          '    echo   Failed to download rig listener!',
          '    pause',
          '    exit /b 1',
          ')',
          '',
          ':: ---- package.json (always refresh) ----',
          'powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \'' +
            serverURL +
            "/api/rig/package.json' -OutFile '%RIG_DIR%\\package.json' } catch { Write-Host $_.Exception.Message; exit 1 }\"",
          '',
          ':: ---- npm install (one-time) ----',
          'if not exist "%RIG_DIR%\\node_modules\\serialport" (',
          '    echo.',
          '    echo   Installing serial port driver... (one-time, ~30 seconds)',
          '    echo.',
          '    pushd "%RIG_DIR%"',
          '    call "%NPM_EXE%" install --loglevel=error 2>&1',
          '    popd',
          '    if not exist "%RIG_DIR%\\node_modules\\serialport" (',
          '        echo.',
          '        echo   Failed to install serialport!',
          '        echo.',
          '        pause',
          '        exit /b 1',
          '    )',
          '    echo   Serial port driver installed.',
          ')',
          '',
          'echo.',
          'echo   Starting rig listener...',
          'echo   (Close this window to stop)',
          'echo.',
          '',
          '"%NODE_EXE%" "%RIG_DIR%\\rig-listener.js"',
          '',
          'echo.',
          'echo   Rig listener stopped.',
          'echo.',
          'pause',
        ].join('\r\n') + '\r\n';

      res.setHeader('Content-Type', 'application/x-msdos-program');
      res.setHeader('Content-Disposition', 'attachment; filename="OpenHamClock-Rig-Listener.bat"');
      return res.send(bat);
    } else {
      // Linux / Mac
      const filename = platform === 'mac' ? 'OpenHamClock-Rig-Listener.command' : 'OpenHamClock-Rig-Listener.sh';
      const rigDir = '$HOME/openhamclock-rig';

      const sh =
        [
          '#!/bin/bash',
          '# OpenHamClock Rig Listener — Download and Run',
          '# Double-click (Mac) or: bash ' + filename,
          '',
          'set -e',
          '',
          'echo ""',
          'echo "  ========================================="',
          'echo "   OpenHamClock Rig Listener v1.0"',
          'echo "  ========================================="',
          'echo ""',
          '',
          '# Check for Node.js',
          'if ! command -v node &> /dev/null; then',
          '    echo "  Node.js is not installed."',
          '    echo ""',
          '    echo "  Install it:"',
          platform === 'mac'
            ? '    echo "    brew install node    (if you have Homebrew)"'
            : '    echo "    sudo apt install nodejs npm    (Debian/Ubuntu)"',
          '    echo "    Or download from https://nodejs.org"',
          '    echo ""',
          '    exit 1',
          'fi',
          '',
          'echo "  Found Node.js $(node -v)"',
          '',
          '# Create persistent folder',
          'RIG_DIR="' + rigDir + '"',
          'mkdir -p "$RIG_DIR"',
          '',
          '# Download latest rig-listener.js',
          'echo "  Downloading rig listener..."',
          'curl -sL "' + serverURL + '/api/rig/listener.js" -o "$RIG_DIR/rig-listener.js"',
          '',
          '# package.json (always refresh)',
          'curl -sL "' + serverURL + '/api/rig/package.json" -o "$RIG_DIR/package.json"',
          '',
          '# npm install (one-time)',
          'if [ ! -d "$RIG_DIR/node_modules/serialport" ]; then',
          '  echo ""',
          '  echo "  Installing serial port driver... (one-time, ~30 seconds)"',
          '  cd "$RIG_DIR" && npm install --loglevel=error',
          '  echo "  Done."',
          'fi',
          '',
          'echo ""',
          'echo "  Starting rig listener..."',
          'echo "  Press Ctrl+C to stop."',
          'echo ""',
          '',
          'cd "$RIG_DIR"',
          'exec node rig-listener.js',
        ].join('\n') + '\n';

      res.setHeader('Content-Type', 'application/x-sh');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      return res.send(sh);
    }
  });
};
