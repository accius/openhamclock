'use strict';
/**
 * kiwi-protocol.js — KiwiSDR WebSocket protocol framing (pure, no I/O)
 *
 * The KiwiSDR audio ("SND") WebSocket speaks a tiny text/binary protocol,
 * documented by example in kiwiclient/kiwirecorder:
 *
 *   client → server  text frames:   "SET auth t=kiwi p=<password>"
 *                                    "SET mod=cw low_cut=300 high_cut=700 freq=14100.000"
 *                                    "SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50"
 *                                    "SET keepalive" ...
 *   server → client  binary frames:  3-byte ASCII tag + body
 *       "MSG"  body = " key=value key2=value" (values URL-encoded)
 *       "SND"  body = flags(1) seq(uint32 LE) smeter(uint16 BE) audio…
 *       "W/F"  waterfall (never requested on an SND socket)
 *       "EXT"  extension data
 *
 * S-meter: smeter/10 − 127 dBm (the Kiwi's own RSSI in the passband).
 *
 * Everything here is synchronous and buffer-in/object-out so it can be unit
 * tested without a receiver; the connection loop lives in kiwi-connection.js.
 */

const SMETER_OFFSET_DBM = -127;

/** Decode the raw 16-bit S-meter field to dBm. */
function decodeSmeter(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw / 10 + SMETER_OFFSET_DBM;
}

/** Inverse of decodeSmeter — used by the mock server and tests. */
function encodeSmeter(dbm) {
  const raw = Math.round((dbm - SMETER_OFFSET_DBM) * 10);
  return Math.max(0, Math.min(0xffff, raw));
}

/** Decode a URL-encoded MSG value; tolerate malformed escapes. */
function decodeValue(v) {
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '));
  } catch (e) {
    return v;
  }
}

/**
 * Parse "key=value key2=value" MSG text into an object. Keys without '=' get
 * the value true. Values are URL-decoded as kiwiclient does.
 */
function parseMsgParams(text) {
  const params = {};
  for (const tok of String(text).trim().split(/\s+/)) {
    if (!tok) continue;
    const eq = tok.indexOf('=');
    if (eq < 0) params[tok] = true;
    else params[tok.slice(0, eq)] = decodeValue(tok.slice(eq + 1));
  }
  return params;
}

/**
 * Parse one WebSocket frame from the Kiwi.
 *
 * @param {Buffer|ArrayBuffer|Uint8Array|string} data
 * @returns {{type:'SND',flags:number,seq:number,smeter:number,rssiDbm:number,audio:Buffer}
 *         | {type:'MSG',text:string,params:Object}
 *         | {type:string,body:Buffer}
 *         | null}  null when the frame is too short to carry a tag
 */
function parseFrame(data) {
  let buf;
  if (Buffer.isBuffer(data)) buf = data;
  else if (typeof data === 'string') buf = Buffer.from(data, 'latin1');
  else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
  else if (ArrayBuffer.isView(data)) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  else return null;
  if (buf.length < 3) return null;

  const tag = buf.toString('latin1', 0, 3);
  if (tag === 'SND') {
    if (buf.length < 10) return { type: 'SND', flags: 0, seq: 0, smeter: null, rssiDbm: null, audio: Buffer.alloc(0) };
    const flags = buf.readUInt8(3);
    const seq = buf.readUInt32LE(4);
    const smeter = buf.readUInt16BE(8);
    return { type: 'SND', flags, seq, smeter, rssiDbm: decodeSmeter(smeter), audio: buf.subarray(10) };
  }
  if (tag === 'MSG') {
    const text = buf.toString('utf8', 3).trim();
    return { type: 'MSG', text, params: parseMsgParams(text) };
  }
  return { type: tag, body: buf.subarray(3) };
}

/** Build a binary SND frame (mock server / tests). */
function encodeSndFrame({ flags = 0, seq = 0, smeter = 0, rssiDbm = null, audio = Buffer.alloc(0) } = {}) {
  const raw = rssiDbm != null ? encodeSmeter(rssiDbm) : smeter;
  const head = Buffer.alloc(10);
  head.write('SND', 0, 'latin1');
  head.writeUInt8(flags & 0xff, 3);
  head.writeUInt32LE(seq >>> 0, 4);
  head.writeUInt16BE(raw & 0xffff, 8);
  return Buffer.concat([head, Buffer.isBuffer(audio) ? audio : Buffer.from(audio)]);
}

/** Build a MSG frame from key/value pairs (mock server / tests). */
function encodeMsgFrame(params) {
  const text = Object.entries(params)
    .map(([k, v]) => (v === true ? k : `${k}=${encodeURIComponent(String(v))}`))
    .join(' ');
  return Buffer.from(`MSG ${text}`, 'utf8');
}

// ─── Command builders ─────────────────────────────────────────────────────

/** Strip anything that could break out of a space-delimited SET line. */
function sanitizeToken(s, max = 64) {
  return String(s == null ? '' : s)
    .replace(/[\s\r\n]+/g, '_')
    .slice(0, max);
}

/** Format a frequency in kHz the way the Kiwi expects (3 decimals). */
function formatKHz(khz) {
  const n = Number(khz);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid frequency: ${khz}`);
  return n.toFixed(3);
}

const cmd = {
  auth: (password = '') => `SET auth t=kiwi p=${sanitizeToken(password)}`,
  arOk: (rateIn = 12000, rateOut = 44100) => `SET AR OK in=${Math.round(rateIn)} out=${Math.round(rateOut)}`,
  tune: ({ freqKHz, mode = 'cw', lowCut = 300, highCut = 700 }) =>
    `SET mod=${sanitizeToken(mode).toLowerCase()} low_cut=${Math.round(lowCut)} high_cut=${Math.round(highCut)} freq=${formatKHz(freqKHz)}`,
  agc: ({ agc = 1, hang = 0, thresh = -100, slope = 6, decay = 1000, manGain = 50 } = {}) =>
    `SET agc=${agc ? 1 : 0} hang=${hang ? 1 : 0} thresh=${Math.round(thresh)} slope=${Math.round(slope)} decay=${Math.round(decay)} manGain=${Math.round(manGain)}`,
  compression: (on = false) => `SET compression=${on ? 1 : 0}`,
  squelch: (level = 0, max = 0) => `SET squelch=${Math.round(level)} max=${Math.round(max)}`,
  genattn: (attn = 0) => `SET genattn=${Math.round(attn)}`,
  genOff: () => 'SET gen=0 mix=-1',
  autonotch: (on = false) => `SET lms_autonotch=${on ? 1 : 0}`,
  identUser: (ident = 'OpenHamClock') => `SET ident_user=${encodeURIComponent(sanitizeToken(ident, 32))}`,
  keepalive: () => 'SET keepalive',
};

/**
 * The receiver setup sequence sent once the Kiwi has reported its sample
 * rate — in the order kiwiclient sends them.
 */
function setupCommands({ freqKHz, mode = 'cw', lowCut = 300, highCut = 700, ident = 'OpenHamClock' }) {
  return [
    cmd.squelch(0, 0),
    cmd.autonotch(false),
    cmd.genattn(0),
    cmd.genOff(),
    cmd.tune({ freqKHz, mode, lowCut, highCut }),
    cmd.agc(),
    cmd.compression(false),
    cmd.identUser(ident),
  ];
}

/** WebSocket URL for the audio channel (kiwiclient: ws://host:port/kiwi/<ts>/SND). */
function audioSocketUrl(host, port, { secure = false, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const h = String(host || '').trim();
  if (!h) throw new Error('Kiwi host is required');
  const p = Number(port) || 8073;
  const hostPart = h.includes(':') && !h.startsWith('[') ? `[${h}]` : h;
  return `${secure ? 'wss' : 'ws'}://${hostPart}:${p}/kiwi/${timestamp}/SND`;
}

/**
 * Interpret a MSG frame's params as a connection-level event.
 *   { event: 'badp', reason }       bad password / user limit / no channel
 *   { event: 'too_busy', reason }   all RX channels taken
 *   { event: 'down', reason }       receiver offline for maintenance
 *   { event: 'redirect', url }
 *   { event: 'audio_rate', rate }   → reply with cmd.arOk(rate)
 *   { event: 'sample_rate', rate }  → receiver ready for setup commands
 *   { event: 'inactivity', seconds }
 *   null                            nothing of interest
 */
function classifyMsg(params) {
  if (!params || typeof params !== 'object') return null;
  if (params.badp != null && String(params.badp) !== '0') {
    const code = String(params.badp);
    const reason =
      code === '1'
        ? 'bad password'
        : code === '2'
          ? 'user limit reached'
          : code === '3'
            ? 'no RX channel available'
            : `auth rejected (badp=${code})`;
    return { event: 'badp', code, reason };
  }
  if (params.too_busy != null) return { event: 'too_busy', reason: `all ${params.too_busy} channels in use` };
  if (params.down != null) return { event: 'down', reason: 'receiver is down' };
  if (params.redirect) return { event: 'redirect', url: String(params.redirect) };
  if (params.audio_rate != null) return { event: 'audio_rate', rate: Number(params.audio_rate) };
  if (params.sample_rate != null) return { event: 'sample_rate', rate: Number(params.sample_rate) };
  if (params.inactivity_timeout != null)
    return { event: 'inactivity', seconds: Number(params.inactivity_timeout) || 0 };
  return null;
}

module.exports = {
  SMETER_OFFSET_DBM,
  decodeSmeter,
  encodeSmeter,
  parseMsgParams,
  parseFrame,
  encodeSndFrame,
  encodeMsgFrame,
  cmd,
  setupCommands,
  audioSocketUrl,
  classifyMsg,
  formatKHz,
};
