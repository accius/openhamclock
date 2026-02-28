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
 *   udpPort       number   UDP port to listen on (default: 2237)
 *   batchInterval number   Batch send interval in ms (default: 2000)
 *   verbose       boolean  Log all decoded messages (default: false)
 */

const dgram = require('dgram');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const RELAY_VERSION = require('../package.json').version;

// ──────────────────────────────────────────────────────────────────────────────
// WSJT-X binary protocol parser
// ──────────────────────────────────────────────────────────────────────────────

const WSJTX_MAGIC = 0xadbccbda;

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
};

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
    return this.buf.readUInt8(this.offset++);
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
    const hi = this.buf.readUInt32BE(this.offset);
    const lo = this.buf.readUInt32BE(this.offset + 4);
    this.offset += 8;
    return hi * 0x100000000 + lo;
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
  readUtf8() {
    const len = this.readUInt32();
    if (len === null || len === 0xffffffff) return null;
    if (len === 0) return '';
    if (this.remaining() < len) return null;
    const str = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return str;
  }
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
  readQDateTime() {
    const julianDay = this.readUInt64();
    const time = this.readQTime();
    const timeSpec = this.readUInt8();
    if (timeSpec === 2) this.readInt32();
    return { julianDay, time, timeSpec };
  }
}

function parseWSJTXMessage(buffer) {
  const reader = new WSJTXReader(buffer);
  const magic = reader.readUInt32();
  if (magic !== WSJTX_MAGIC) return null;

  const schema = reader.readUInt32();
  const type = reader.readUInt32();
  const id = reader.readUtf8();
  if (type === null || id === null) return null;

  const msg = { type, id, schema, timestamp: Date.now() };

  try {
    switch (type) {
      case WSJTX_MSG.HEARTBEAT:
        msg.maxSchema = reader.readUInt32();
        msg.version = reader.readUtf8();
        msg.revision = reader.readUtf8();
        break;
      case WSJTX_MSG.STATUS:
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
      case WSJTX_MSG.DECODE:
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
      case WSJTX_MSG.CLEAR:
        msg.window = reader.readUInt8();
        break;
      case WSJTX_MSG.QSO_LOGGED:
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
      case WSJTX_MSG.WSPR_DECODE:
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
      case WSJTX_MSG.LOGGED_ADIF:
        msg.adif = reader.readUtf8();
        break;
      case WSJTX_MSG.CLOSE:
        break;
      default:
        return null;
    }
  } catch (e) {
    return null;
  }

  return msg;
}

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
  },

  create(config) {
    const cfg = config.wsjtxRelay || {};
    const serverUrl = (cfg.url || '').replace(/\/$/, '');
    const relayEndpoint = `${serverUrl}/api/wsjtx/relay`;

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

      const udpPort = cfg.udpPort || 2237;
      socket = dgram.createSocket('udp4');

      socket.on('message', (buf) => {
        const msg = parseWSJTXMessage(buf);
        if (!msg) return;
        if (msg.type === WSJTX_MSG.DECODE && msg.isNew) totalDecodes++;
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

      socket.bind(udpPort, '0.0.0.0');
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
      };
    }

    const instance = { connect, disconnect, getStatus };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
