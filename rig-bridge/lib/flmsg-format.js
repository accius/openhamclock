'use strict';
/**
 * flmsg-format.js — read and write NBEMS flmsg form files and WRAP transfers.
 *
 * Everything here follows flmsg's own source (git.code.sf.net/p/fldigi/flmsg,
 * checked against commit 5111dc27, June 2025). File/function references are
 * given next to each rule.
 *
 * Form file (src/flmsg.cxx header(), lineout(); src/ics/ics213.cxx make_buffer()):
 *
 *   <flmsg>4.0.23
 *   :hdr_fm:21 \nN8TAG 20261510143200        ← value begins with a newline
 *   :hdr_ed:21 \nN8TAG 20261510143200
 *   <ics213>
 *   :inc:17 Spring Flood 2026
 *   :to:23 Logistics Section Chief
 *   ...
 *   :mg:41 Need 40 cots at Lincoln HS
 *   by 1800 local.
 *
 *   - a field is `:tag:` + byte length + one space + value + "\n"; empty
 *     values are not written (lineout()).
 *   - hdr_fm / hdr_ed hold one "\nCALL STAMP" line per station, newest last
 *     (update_header()). STAMP is szDate(4) + szTime(6) in UTC, i.e.
 *     YYYY DD MM hh mm ss — day before month ("%Y%d%m", szDate()).
 *   - hdr_fm is only rewritten when the form is sent (update_header(FROM) in
 *     cb_213_wrap_export / cb_213_wrap_autosend); saving uses CHANGED, which
 *     touches hdr_ed only. So an empty hdr_fm means "never sent".
 *
 * WRAP transfer (src/utils/wrap.cxx wrapfile(), unwrapfile(), xfr_via_socket()):
 *
 *   [WRAP:beg][WRAP:lf][WRAP:fn name.213]<flmsg>...[WRAP:chksum 1A2B][WRAP:end]
 *
 *   - the checksum covers "[WRAP:fn name]" + the text (LF line ends), NOT
 *     "[WRAP:beg][WRAP:lf]".
 *   - Ccrc16 (src/include/crc16.h): CRC-16 init 0xFFFF, reflected poly 0xA001,
 *     printed "%04X" into a 5-byte buffer. Each byte goes through a plain
 *     `char`, so on x86 and Apple Silicon (signed char) bytes ≥ 0x80 are
 *     sign-extended into a 32-bit accumulator and the printed value is the
 *     first four hex digits of a longer number; on Linux ARM (unsigned char,
 *     e.g. a Raspberry Pi) it is plain CRC-16/MODBUS. ASCII text gives the same
 *     result on both. We accept either on receive.
 *   - on a mismatch unwrapfile() strips every "\r" and tries again (fldigi
 *     transmits "\n" as "\r\n").
 *   - compression (compress_maybe() / decompress_maybe()): the field part of
 *     the form (not the header) becomes
 *     "[b64:start]" + base64("\x01LZMA" + uint32 BE length + 5 LZMA props +
 *     raw LZMA stream) + "[b64:end]", LzmaCompress level 4. flmsg never writes
 *     the [b128:...] / [b256:...] armours for forms; they are recognised and
 *     reported as unsupported.
 *
 * Strings: wrap handling works on "binary strings" (one char per byte, i.e.
 * Buffer#toString('latin1')) so checksums see the exact bytes flmsg saw; form
 * text is decoded as UTF-8 afterwards.
 */

const crypto = require('crypto');
const { gridToLatLon } = require('./wsjtx-enrich');

// ── Form catalogue ──────────────────────────────────────────────────────────

/** Display names for flmsg's form tags (header("<...>") calls across src/). */
const FORM_NAMES = {
  ics203: 'ICS-203',
  ics205: 'ICS-205',
  ics205a: 'ICS-205A',
  ics206: 'ICS-206',
  ics213: 'ICS-213',
  ics214: 'ICS-214',
  ics216: 'ICS-216',
  ics309: 'ICS-309',
  hics203: 'HICS-203',
  hics206: 'HICS-206',
  hics213: 'HICS-213',
  hics214: 'HICS-214',
  netlog: 'Net Log',
  radiogram: 'Radiogram',
  iaru: 'IARU Message',
  plaintext: 'Plain Text',
  blankform: 'Blank Form',
  csvform: 'CSV Form',
  customform: 'Custom Form',
  html_form: 'Custom Form',
  transfer: 'File Transfer',
  cap105: 'CAP-105',
  cap110: 'CAP-110',
  f126: 'F-126',
  mars_daily: 'MARS Daily',
  mars_ineei: 'MARS IN/EEI',
  mars_net: 'MARS Net',
  mars_army: 'MARS Army',
  mars_msg: 'MARS Message',
  nhc_wx: 'Hurricane Report',
  severe_wx: 'Severe Weather Report',
  storm_wx: 'Storm Report',
};

/**
 * ICS-213 General Message — friendly name → flmsg tag, in the order flmsg
 * writes them (src/ics/ics213.cxx `FIELD fields[]`).
 */
const ICS213_TAGS = {
  incident: 'inc',
  to: 'to',
  toPosition: 'p1',
  from: 'fm',
  fromPosition: 'p2',
  date: 'd1',
  time: 't1',
  subject: 'sb',
  approvedBy: 's1',
  approvedPosition: 'p3',
  repliedBy: 's2',
  repliedPosition: 'p4',
  replyDate: 'd2',
  replyTime: 't2',
  message: 'mg',
  reply: 'rp',
};

/** HICS-213 uses numbered tags (src/hics/hics213.cxx h213_tag_*). */
const HICS213_TAGS = {
  from: '1',
  to: '2',
  date: '3',
  time: '4',
  priority: '7',
  message: '8',
  action: '9',
  facility: '18',
};

/** Radiogram (src/radiogram/radiogram.cxx _rg_*). */
const RADIOGRAM_TAGS = {
  number: 'nbr',
  precedence: 'prec',
  handling: 'hx',
  dateFiled: 'd1',
  timeFiled: 't1',
  to: 'to',
  phone: 'tel',
  message: 'msg',
  signature: 'sig',
  check: 'ck',
  stationOfOrigin: 'sta',
  placeOfOrigin: 'org',
};

/** IARU message (src/iaru/iaru.cxx iaru_*). */
const IARU_TAGS = {
  number: 'nbr',
  precedence: 'prec',
  stationOfOrigin: 'sta',
  check: 'ck',
  placeOfOrigin: 'org',
  dateFiled: 'd1',
  timeFiled: 't1',
  to: 'to',
  message: 'msg',
  from: 'fm',
};

/** Plain text (src/plaintext/plaintext.cxx pt_*). */
const PLAINTEXT_TAGS = { title: 'tt', to: 'to', from: 'fm', subject: 'sb', date: 'dt', time: 'tm', message: 'mg' };

const TAG_TABLES = {
  ics213: ICS213_TAGS,
  hics213: HICS213_TAGS,
  radiogram: RADIOGRAM_TAGS,
  iaru: IARU_TAGS,
  plaintext: PLAINTEXT_TAGS,
};

// ── Bytes ↔ strings ─────────────────────────────────────────────────────────

/** Buffer or JS string → binary string (one char per byte). */
function toBinary(input) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) return Buffer.from(input).toString('latin1');
  return Buffer.from(String(input ?? ''), 'utf8').toString('latin1');
}

/** Binary string → JS string (UTF-8 decode). */
function fromBinary(bin) {
  return Buffer.from(bin, 'latin1').toString('utf8');
}

// ── Field-level encoding ────────────────────────────────────────────────────

/** One field line, flmsg style (src/flmsg.cxx lineout()). Empty values produce nothing. */
function lineout(tag, value) {
  if (value == null) return '';
  const v = String(value);
  if (v === '') return '';
  return `:${tag}:${Buffer.byteLength(v, 'utf8')} ${v}\n`;
}

const FIELD_HEAD = /^:([A-Za-z0-9_]+):(\d+) /;
const FORM_LINE = /^<([A-Za-z0-9_]+)>([^\n]*)$/;

/**
 * Parse an flmsg file body (a JS string). Values are taken by their declared
 * byte length, as flmsg's findstr() does; when a length does not land on a
 * line end (hand-edited file, truncated transfer) the value runs to the next
 * line that starts a field or form instead.
 *
 * @param {string} text
 * @returns {{ version: string|null, form: string|null, header: object, fields: object }}
 */
function parseFlmsg(text) {
  const out = { version: null, form: null, header: {}, fields: {} };
  if (typeof text !== 'string') return out;
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  s = s.replace(/\r\n/g, '\n');

  let i = 0;
  while (i < s.length) {
    if (s[i] === '\n') {
      i++;
      continue;
    }
    const nl = s.indexOf('\n', i);
    const lineEnd = nl === -1 ? s.length : nl;
    const line = s.slice(i, lineEnd);

    const form = line.match(FORM_LINE);
    if (form) {
      const tag = form[1].toLowerCase();
      if (tag === 'flmsg') out.version = form[2].trim() || null;
      else if (!out.form) out.form = tag;
      i = lineEnd + 1;
      continue;
    }

    const head = line.match(FIELD_HEAD);
    if (!head) {
      i = lineEnd + 1;
      continue;
    }
    const tag = head[1];
    const declared = parseInt(head[2], 10);
    const valueStart = i + head[0].length;

    const restBuf = Buffer.from(s.slice(valueStart), 'utf8');
    let value = restBuf.subarray(0, declared).toString('utf8');
    let next = valueStart + value.length;
    const exact = declared <= restBuf.length && (next >= s.length || s[next] === '\n');
    if (!exact) {
      const re = /\n(?=:[A-Za-z0-9_]+:\d+ |<[A-Za-z0-9_]+>)/g;
      re.lastIndex = valueStart;
      const m = re.exec(s);
      next = m ? m.index : s.length;
      value = s.slice(valueStart, next).replace(/\n+$/, '');
    }
    if (out.form) out.fields[tag] = value;
    else out.header[tag] = value;
    i = next + 1;
  }
  return out;
}

/** YYYYDDMMhhmmss in UTC — flmsg's header stamp (szDate(4) + szTime(6) in update_header()). */
function flmsgStamp(when) {
  const d = new Date(typeof when === 'number' ? when : (when?.getTime?.() ?? Date.now()));
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCDate())}${p(d.getUTCMonth() + 1)}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/**
 * Serialise a form in flmsg's file format.
 * @param {object} doc
 * @param {string} doc.form         form tag, e.g. 'ics213'
 * @param {object} doc.fields       tag → value (written in insertion order)
 * @param {string} [doc.call]       station callsign for hdr_fm / hdr_ed
 * @param {Date|number} [doc.when]  header timestamp (default now)
 * @param {string} [doc.version]    flmsg version string to claim
 */
function serializeFlmsg({ form, fields, call = '', when = Date.now(), version = '4.0.23' }) {
  // update_header() returns early without a callsign, leaving both empty.
  const hdr = call ? `\n${String(call).toUpperCase()} ${flmsgStamp(when)}` : '';
  let out = `<flmsg>${version}\n`;
  out += lineout('hdr_fm', hdr);
  out += lineout('hdr_ed', hdr);
  out += `<${form}>\n`;
  for (const [tag, value] of Object.entries(fields || {})) out += lineout(tag, value);
  return out;
}

/** Friendly ICS-213 object → flmsg tag map in flmsg's field order (non-empty only). */
function ics213ToFields(input = {}) {
  const fields = {};
  for (const [name, tag] of Object.entries(ICS213_TAGS)) {
    const v = input[name];
    if (v != null && String(v).trim() !== '') fields[tag] = String(v);
  }
  return fields;
}

/** flmsg tag map → friendly object for a known form (unknown tags kept as-is). */
function fieldsToFriendly(form, fields) {
  const table = TAG_TABLES[form];
  if (!table) return { ...fields };
  const out = {};
  const known = new Set();
  for (const [name, tag] of Object.entries(table)) {
    if (fields[tag] != null) out[name] = fields[tag];
    known.add(tag);
  }
  for (const [tag, v] of Object.entries(fields)) if (!known.has(tag)) out[tag] = v;
  return out;
}

/**
 * Build a complete ICS-213 flmsg file. Date and time default to now in UTC
 * ("2026-10-15", "1432Z" — flmsg's date format 0 and time format 2).
 * @param {object} input  { incident, to, toPosition, from, fromPosition, subject,
 *                          date, time, message, approvedBy, approvedPosition }
 * @param {object} [opts] { call, when }
 */
function buildIcs213(input, opts = {}) {
  const when = opts.when ?? Date.now();
  const d = new Date(when);
  const p = (n) => String(n).padStart(2, '0');
  const filled = {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`,
    ...input,
  };
  return serializeFlmsg({ form: 'ics213', fields: ics213ToFields(filled), call: opts.call || '', when });
}

// ── Plain-ASCII folding for outgoing forms ──────────────────────────────────

const FOLD = {
  '\u00df': 'ss',
  '\u00c6': 'AE',
  '\u00e6': 'ae',
  '\u00d8': 'O',
  '\u00f8': 'o',
  '\u0152': 'OE',
  '\u0153': 'oe',
  '\u0110': 'D',
  '\u0111': 'd',
  '\u0141': 'L',
  '\u0142': 'l',
  '\u00de': 'Th',
  '\u00fe': 'th',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2026': '...',
  '\u00a0': ' ',
  '\u20ac': 'EUR',
  '\u00a3': 'GBP',
  '\u00b0': ' deg',
  '\u00d7': 'x',
};

/**
 * Closest plain-ASCII form of a string. Outgoing forms are folded so their
 * WRAP checksum is identical whichever platform the receiving flmsg runs on
 * (see the signed-char note at the top of this file).
 */
function asciiFold(str) {
  return String(str ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7f]/g, (ch) => FOLD[ch] ?? '?');
}

// ── WRAP envelope + CRC-16 ──────────────────────────────────────────────────

const WRAP_BEG = '[WRAP:beg]';
const WRAP_LF = '[WRAP:lf]';
const WRAP_CRLF = '[WRAP:crlf]';
const WRAP_FN = '[WRAP:fn ';
const WRAP_CHKSUM = '[WRAP:chksum ';
const WRAP_END = '[WRAP:end]';

/**
 * flmsg's Ccrc16::scrc16() (src/include/crc16.h) over a binary string.
 * @param {string} bin           one char per byte
 * @param {boolean} signedChar   true = x86 / Apple behaviour, false = Linux ARM
 */
function flmsgCrc16(bin, signedChar = true) {
  let crc = 0xffff; // `unsigned int crcval` — 32 bits wide
  for (let i = 0; i < bin.length; i++) {
    const byte = bin.charCodeAt(i) & 0xff;
    const c = signedChar && byte >= 0x80 ? (byte | 0xffffff00) >>> 0 : byte;
    crc = (crc ^ c) >>> 0;
    for (let b = 0; b < 8; b++) crc = crc & 1 ? ((crc >>> 1) ^ 0xa001) >>> 0 : crc >>> 1;
  }
  // snprintf(ss, 5, "%04X", crcval): at most four characters survive
  return crc.toString(16).toUpperCase().padStart(4, '0').slice(0, 4);
}

/** CRC-16 of a JS string's UTF-8 bytes (plain CRC-16/MODBUS for ASCII). */
function crc16(str, signedChar = false) {
  return flmsgCrc16(toBinary(str), signedChar);
}

/**
 * Wrap form text for transmission, as wrapfile() / xfr_via_socket() do:
 * CRLF → LF, checksum over "[WRAP:fn name]" + text.
 * @param {string} content   form text (JS string)
 * @param {string} filename  shown to the receiving operator
 * @param {object} [opts]    { signedChar: true }
 * @returns {string} JS string ready to send
 */
function wrapFlmsg(content, filename, opts = {}) {
  const fn = String(filename || 'message.213').replace(/[\]\r\n/\\:]/g, '_');
  const text = String(content).replace(/\r\n/g, '\n');
  const payload = `${WRAP_FN}${fn}]${text}`;
  const check = flmsgCrc16(toBinary(payload), opts.signedChar !== false);
  return `${WRAP_BEG}${WRAP_LF}${payload}${WRAP_CHKSUM}${check}]${WRAP_END}`;
}

/** True when the input contains a WRAP envelope. */
function isWrapped(input) {
  const s = Buffer.isBuffer(input) ? input.toString('latin1') : String(input ?? '');
  return s.includes(WRAP_BEG) && s.includes(WRAP_END);
}

// ── Compression ─────────────────────────────────────────────────────────────

let _lzma = undefined;
/** LZMA-JS decoder, loaded on first use (null when rig-bridge deps are missing). */
function lzmaDecoder() {
  if (_lzma === undefined) {
    try {
      // Static path so @yao-pkg/pkg bundles it.
      _lzma = require('lzma/src/lzma_worker.js').LZMA_WORKER;
    } catch (e) {
      _lzma = null;
    }
  }
  return _lzma;
}

const LZMA_MAGIC = '\x01LZMA';
const MAX_DECOMPRESSED = 1 << 25; // decompress_maybe(): refuses > 32 MiB

/**
 * flmsg's decompress_maybe() on a binary string.
 * @returns {{ text: string, compressed: boolean, error: string|null }}
 *   text is a binary string; error is 'unsupported-encoding' | 'lzma-unavailable' | 'corrupt'
 */
function decompressFlmsg(bin) {
  const b64s = bin.indexOf('[b64:start]');
  if (b64s === -1) {
    if (bin.includes('[b128:start]') || bin.includes('[b256:start]')) {
      return { text: bin, compressed: true, error: 'unsupported-encoding' };
    }
    return { text: bin, compressed: false, error: null };
  }
  const p1 = b64s + '[b64:start]'.length;
  const p2 = bin.indexOf('[b64:end]', p1);
  if (p2 === -1) return { text: bin, compressed: true, error: 'corrupt' };
  const p3 = p2 + '[b64:end]'.length;
  const raw = Buffer.from(bin.slice(p1, p2).replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  const rawBin = raw.toString('latin1');
  if (!rawBin.startsWith(LZMA_MAGIC)) {
    // base64 without LZMA — flmsg substitutes the decoded text
    return { text: bin.slice(0, b64s) + rawBin + bin.slice(p3), compressed: true, error: null };
  }
  if (raw.length < LZMA_MAGIC.length + 4 + 5) return { text: bin, compressed: true, error: 'corrupt' };
  const outlen = raw.readUInt32BE(LZMA_MAGIC.length);
  if (outlen > MAX_DECOMPRESSED) return { text: bin, compressed: true, error: 'corrupt' };
  const props = raw.subarray(LZMA_MAGIC.length + 4, LZMA_MAGIC.length + 9);
  const data = raw.subarray(LZMA_MAGIC.length + 9);
  const lzma = lzmaDecoder();
  if (!lzma) return { text: bin, compressed: true, error: 'lzma-unavailable' };
  // LZMA-JS reads the ".lzma" container: 5 props bytes + 64-bit LE size + stream.
  const hdr = Buffer.alloc(13);
  props.copy(hdr, 0);
  hdr.writeUInt32LE(outlen, 5);
  let out;
  try {
    out = lzma.decompress(Buffer.concat([hdr, data]));
  } catch (e) {
    return { text: bin, compressed: true, error: 'corrupt' };
  }
  // LZMA-JS returns a JS string when the result is valid UTF-8, else signed bytes.
  const bytes = typeof out === 'string' ? Buffer.from(out, 'utf8') : Buffer.from((out || []).map((b) => b & 0xff));
  if (bytes.length !== outlen) return { text: bin, compressed: true, error: 'corrupt' };
  return { text: bin.slice(0, b64s) + bytes.toString('latin1') + bin.slice(p3), compressed: true, error: null };
}

/**
 * Strip a WRAP envelope, following unwrapfile() step by step.
 * @param {Buffer|string} input
 * @returns {null | {
 *   filename: string|null, content: string, checksum: string|null,
 *   checksumOk: boolean, compressed: boolean, error: string|null }}
 *   null when no envelope is present. content is a JS string with LF line ends.
 */
function unwrapFlmsg(input) {
  let bin = toBinary(input);
  if (!bin.includes(WRAP_BEG)) return null;

  const extract = (s) => {
    const beg = s.indexOf(WRAP_BEG);
    let p1 = s.indexOf(WRAP_CRLF);
    let iscrlf = false;
    if (p1 !== -1) {
      iscrlf = true;
      p1 += WRAP_CRLF.length;
    } else {
      p1 = s.indexOf(WRAP_LF);
      if (p1 === -1)
        p1 = beg + WRAP_BEG.length; // tolerate a missing marker
      else p1 += WRAP_LF.length;
    }
    const p2 = s.indexOf(WRAP_CHKSUM, p1);
    if (p2 === -1) return null;
    const p4 = s.indexOf(']', p2 + WRAP_CHKSUM.length);
    if (p4 === -1) return null;
    if (s.indexOf(WRAP_END, p4) === -1) return null;
    const wtext = s.slice(p1, p2);
    const inpsum = s
      .slice(p2 + WRAP_CHKSUM.length, p4)
      .trim()
      .toUpperCase();
    const ok = flmsgCrc16(wtext, true) === inpsum || flmsgCrc16(wtext, false) === inpsum;
    return { wtext, inpsum, ok, iscrlf };
  };

  let r = extract(bin);
  if (!r) return null;
  if (!r.ok) {
    // unwrapfile(): "Test for CRLF corrupted file" — drop every CR and retry
    bin = bin.replace(/\r/g, '');
    r = extract(bin) || r;
  }

  let wtext = r.wtext;
  let filename = null;
  const p5 = wtext.indexOf(WRAP_FN);
  if (p5 !== -1) {
    const close = wtext.indexOf(']', p5);
    if (close !== -1) {
      const name = wtext.slice(p5 + WRAP_FN.length, close);
      // unwrapfile()'s "protocol abuse" checks
      const bad = !name || name === '.' || name === '..' || /[/\\:]/.test(name);
      filename = bad ? null : fromBinary(name);
      wtext = wtext.slice(close + 1);
    }
  }

  const dec = decompressFlmsg(wtext);
  return {
    filename,
    content: fromBinary(dec.text).replace(/\r\n/g, '\n'),
    checksum: r.inpsum || null,
    checksumOk: r.ok,
    compressed: dec.compressed,
    error: dec.error,
  };
}

// ── Locations inside free text ──────────────────────────────────────────────

/**
 * Find a position written into a form's text. Recognised:
 *   "LAT 39.0997 LON -94.5786", "Lat: 39.1N Long: 94.6W"
 *   "GRID EM29qb", "Locator: EM29", "MH EM29qb"
 *   a bare decimal pair with 3+ decimals: "39.0997, -94.5786"
 * @returns {{ lat: number, lon: number, source: string }|null}
 */
function findLocation(text) {
  if (!text) return null;
  const s = String(text);
  const valid = (lat, lon) =>
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  let m = s.match(
    /\bLAT(?:ITUDE)?\s*[:=]?\s*(-?\d{1,2}(?:\.\d+)?)\s*([NS])?[\s,;/]+LON(?:G(?:ITUDE)?)?\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)\s*([EW])?/i,
  );
  if (m) {
    let lat = parseFloat(m[1]);
    let lon = parseFloat(m[3]);
    if (m[2] && m[2].toUpperCase() === 'S') lat = -Math.abs(lat);
    if (m[4] && m[4].toUpperCase() === 'W') lon = -Math.abs(lon);
    if (valid(lat, lon)) return { lat, lon, source: 'latlon' };
  }
  m = s.match(/\b(?:GRID|LOCATOR|LOC|MH)\s*[:=]?\s*([A-R]{2}\d{2}(?:[A-X]{2})?)\b/i);
  if (m) {
    const ll = gridToLatLon(m[1]);
    if (ll && valid(ll.lat, ll.lon)) return { lat: ll.lat, lon: ll.lon, source: 'grid' };
  }
  m = s.match(/(-?\d{1,2}\.\d{3,})\s*[,/ ]\s*(-?\d{1,3}\.\d{3,})/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (valid(lat, lon)) return { lat, lon, source: 'decimal' };
  }
  return null;
}

// ── Header and form dates ───────────────────────────────────────────────────

/** "YYYYDDMMhhmmss" → epoch ms (UTC). Falls back to YYYYMMDD when DDMM cannot be a date. */
function stampToTime(st) {
  const y = +st.slice(0, 4);
  const a = +st.slice(4, 6);
  const b = +st.slice(6, 8);
  const [hh, mi, ss] = [+st.slice(8, 10), +st.slice(10, 12), +st.slice(12, 14)];
  let day = a;
  let mon = b;
  if (mon < 1 || mon > 12) [day, mon] = [b, a];
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  return Date.UTC(y, mon - 1, day, hh, mi, ss);
}

/**
 * hdr_fm / hdr_ed value → every "CALL STAMP" entry, oldest first.
 * @returns {{ call: string, time: number|null }[]}
 */
function parseHeaderEntries(value) {
  if (!value) return [];
  const out = [];
  for (const line of String(value).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(\S+)\s+(\d{14})$/);
    if (m) out.push({ call: m[1].toUpperCase(), time: stampToTime(m[2]) });
    else if (/^\d{14}$/.test(t)) out.push({ call: '', time: stampToTime(t) });
    else out.push({ call: t.split(/\s+/)[0].toUpperCase(), time: null });
  }
  return out;
}

/** Most recent header entry ({ call, time }), or { call: '', time: null }. */
function parseHeaderStamp(value) {
  const all = parseHeaderEntries(value);
  return all.length ? all[all.length - 1] : { call: '', time: null };
}

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

/**
 * Form date + time → epoch ms.
 *
 * Dates as flmsg writes them (src/flmsg.cxx szDate(), dtformat 0–4):
 *   0 "2026-10-15"  1 "10/15/26"  2 "15/10/26"  3 "2026-15-10"  4 "20261510"
 * plus radiograms' "OCT 15" (szAbbrevDate()). A part above 12 settles the
 * order; otherwise `order` decides:
 *   order.slash  'mdy' | 'dmy'  for NN/NN/YY
 *   order.dash   'ymd' | 'ydm'  for YYYY-NN-NN and YYYYNNNN
 * Times (szTime() types 0–7): "1432L", "14:32L", "1432Z", "14:32Z",
 *   "1432 UTC", "14:32 UTC", "143200", "1432". Z / UTC = UTC, anything else local.
 *
 * @param {string} date
 * @param {string} time
 * @param {{ slash?: string, dash?: string, year?: number }} [order]
 */
function parseFormDateTime(date, time, order = {}) {
  if (!date) return null;
  const ds = String(date).trim().toUpperCase();
  const slash = order.slash === 'dmy' ? 'dmy' : 'mdy';
  const dash = order.dash === 'ydm' ? 'ydm' : 'ymd';
  let y;
  let mo;
  let d;
  let m;
  const pick = (a, b, firstIsMonth) => {
    if (a > 12 && b <= 12) return [b, a];
    if (b > 12 && a <= 12) return [a, b];
    return firstIsMonth ? [a, b] : [b, a];
  };
  if ((m = ds.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)) || (m = ds.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    y = +m[1];
    [mo, d] = pick(+m[2], +m[3], dash === 'ymd');
  } else if ((m = ds.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    [mo, d] = pick(+m[1], +m[2], slash === 'mdy');
  } else if ((m = ds.match(/^([A-Z]{3})[A-Z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)) && MONTHS[m[1]]) {
    mo = MONTHS[m[1]];
    d = +m[2];
    y = m[3] ? +m[3] : (order.year ?? new Date().getUTCFullYear());
  } else {
    const t = Date.parse(ds);
    if (!Number.isFinite(t)) return null;
    const dt = new Date(t);
    y = dt.getFullYear();
    mo = dt.getMonth() + 1;
    d = dt.getDate();
  }
  let hh = 0;
  let mm = 0;
  let utc = false;
  const tm = String(time || '')
    .trim()
    .match(/^(\d{1,2}):?(\d{2})(?::?\d{2})?\s*(Z|UTC|L)?\b/i);
  if (tm) {
    hh = +tm[1];
    mm = +tm[2];
    utc = /^(z|utc)$/i.test(tm[3] || '');
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const t = utc ? Date.UTC(y, mo - 1, d, hh, mm) : new Date(y, mo - 1, d, hh, mm).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Which way round ambiguous dates are read.
 * @param {object} opts
 * @param {string} [opts.setting='auto']  'auto' | 'mdy' | 'dmy' | 'ymd' | 'ydm'
 * @param {number|null} [opts.flmsgDtformat]  dtformat from flmsg.prefs (0–4), if found
 * @param {string} [opts.locale]  BCP 47 locale (default: the system's)
 * @returns {{ slash: 'mdy'|'dmy', dash: 'ymd'|'ydm', source: string }}
 */
function resolveDateOrder({ setting = 'auto', flmsgDtformat = null, locale } = {}) {
  const localeSlash = () => {
    try {
      const parts = new Intl.DateTimeFormat(locale || undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(2026, 0, 31));
      const di = parts.findIndex((p) => p.type === 'day');
      const mi = parts.findIndex((p) => p.type === 'month');
      return di < mi ? 'dmy' : 'mdy';
    } catch (e) {
      return 'mdy';
    }
  };
  const s = String(setting || 'auto').toLowerCase();
  if (s === 'mdy' || s === 'dmy') return { slash: s, dash: 'ymd', source: 'setting' };
  if (s === 'ymd' || s === 'ydm') return { slash: localeSlash(), dash: s, source: 'setting' };
  const f = Number(flmsgDtformat);
  if (flmsgDtformat != null && Number.isInteger(f)) {
    if (f === 1) return { slash: 'mdy', dash: 'ymd', source: 'flmsg' };
    if (f === 2) return { slash: 'dmy', dash: 'ymd', source: 'flmsg' };
    if (f === 3 || f === 4) return { slash: localeSlash(), dash: 'ydm', source: 'flmsg' };
    if (f === 0) return { slash: localeSlash(), dash: 'ymd', source: 'flmsg' };
  }
  return { slash: localeSlash(), dash: 'ymd', source: 'locale' };
}

/** Read `dtformat` and `mycall` from an flmsg.prefs file's text (FLTK preferences format). */
function parseFlmsgPrefs(text) {
  const s = String(text || '');
  const dt = s.match(/^dtformat:(\d+)\s*$/m);
  const call = s.match(/^mycall:(.*)$/m);
  return {
    dtformat: dt ? parseInt(dt[1], 10) : null,
    mycall: call ? call[1].trim().replace(/^"|"$/g, '').toUpperCase() : '',
  };
}

// ── Field-report conversion ─────────────────────────────────────────────────

const TEXT_TAGS = ['mg', 'msg', '8', 'txt'];

/**
 * Turn a file (plain flmsg form or WRAP transfer, as a Buffer or string) into
 * a field-report record for the OpenHamClock server.
 *
 * @param {Buffer|string} input
 * @param {object} [meta] { file, mtimeMs, dateOrder: { slash, dash } }
 * @returns {object|null} null when the input is not an flmsg form;
 *   { error, filename } when it is a transfer that cannot be read.
 */
function formToFieldReport(input, meta = {}) {
  const wrapped = isWrapped(input) ? unwrapFlmsg(input) : null;
  if (wrapped && wrapped.error) return { error: wrapped.error, filename: wrapped.filename };
  let body;
  if (wrapped) body = wrapped.content;
  else {
    // A saved file can itself hold a compressed field block (rare, but harmless to handle)
    const dec = decompressFlmsg(toBinary(input));
    if (dec.error) return { error: dec.error, filename: null };
    body = fromBinary(dec.text).replace(/\r\n/g, '\n');
  }
  const doc = parseFlmsg(body);
  if (!doc.form) return null;

  const f = doc.fields;
  const senders = parseHeaderEntries(doc.header.hdr_fm);
  const editors = parseHeaderEntries(doc.header.hdr_ed);
  const last = senders[senders.length - 1] || editors[editors.length - 1] || { call: '', time: null };
  const name = FORM_NAMES[doc.form] || doc.form.toUpperCase();
  const friendly = fieldsToFriendly(doc.form, f);
  const hdrTime = (senders[senders.length - 1] || {}).time ?? (editors[editors.length - 1] || {}).time ?? null;
  const order = { ...(meta.dateOrder || {}), year: hdrTime ? new Date(hdrTime).getUTCFullYear() : undefined };

  let callsign = last.call;
  let text1 = '';
  let timestamp = null;
  const extra = {};
  const keep = (keys) => {
    for (const k of keys) if (friendly[k]) extra[k] = String(friendly[k]).slice(0, 200);
  };

  if (doc.form === 'ics213') {
    text1 = [f.sb, f.mg].filter(Boolean).join(' — ');
    timestamp = parseFormDateTime(f.d1, f.t1, order);
    keep([
      'incident',
      'to',
      'toPosition',
      'from',
      'fromPosition',
      'subject',
      'approvedBy',
      'approvedPosition',
      'reply',
    ]);
  } else if (doc.form === 'hics213') {
    text1 = f['8'] || '';
    timestamp = parseFormDateTime(f['3'], f['4'], order);
    keep(['from', 'to', 'priority', 'facility', 'action']);
  } else if (doc.form === 'radiogram' || doc.form === 'iaru') {
    callsign = (f.sta || callsign).toUpperCase();
    text1 = f.msg || '';
    timestamp = parseFormDateTime(f.d1, f.t1, order);
    keep(['number', 'precedence', 'handling', 'check', 'placeOfOrigin', 'to', 'from', 'signature']);
  } else {
    const tag = TEXT_TAGS.find((t) => f[t]);
    text1 = tag ? f[tag] : '';
    if (f.sb && text1) text1 = `${f.sb} — ${text1}`;
    else if (f.sb) text1 = f.sb;
    if (doc.form === 'plaintext') timestamp = parseFormDateTime(f.dt, f.tm, order);
    let n = 0;
    for (const [k, v] of Object.entries(friendly)) {
      if (n >= 20 || v === text1) continue;
      extra[k] = String(v).slice(0, 200);
      n++;
    }
  }

  const loc = findLocation([text1, ...Object.values(f)].join('\n'));
  if (wrapped) extra.checksum = wrapped.checksumOk ? 'OK' : 'MISMATCH';
  if (wrapped && wrapped.compressed) extra.compressed = 'yes';
  if (meta.file) extra.file = String(meta.file).split(/[\\/]/).pop();

  return {
    // Identity = sender(s) + form + field values. hdr_ed is left out on purpose:
    // flmsg rewrites it whenever a received form is opened and saved, and that
    // saved copy is the same message.
    id: crypto
      .createHash('sha1')
      .update(
        `flmsg\u0000${doc.form}\u0000${doc.header.hdr_fm || ''}\u0000${Object.keys(f)
          .sort()
          .map((k) => `${k}=${f[k]}`)
          .join('\u0000')}`,
        'utf8',
      )
      .digest('hex'),
    callsign: String(callsign || '').toUpperCase(),
    formType: `${name} (NBEMS)`,
    form: doc.form,
    lat: loc ? loc.lat : null,
    lon: loc ? loc.lon : null,
    timestamp: timestamp ?? hdrTime ?? (Number.isFinite(meta.mtimeMs) ? meta.mtimeMs : null),
    text: text1,
    extra,
    fields: friendly,
    // Who sent it (hdr_fm, newest last) — empty when the form was never sent
    senders: senders.map((s) => s.call).filter(Boolean),
    wrapped: !!wrapped,
  };
}

module.exports = {
  FORM_NAMES,
  ICS213_TAGS,
  HICS213_TAGS,
  RADIOGRAM_TAGS,
  IARU_TAGS,
  PLAINTEXT_TAGS,
  toBinary,
  fromBinary,
  lineout,
  parseFlmsg,
  serializeFlmsg,
  flmsgStamp,
  ics213ToFields,
  fieldsToFriendly,
  buildIcs213,
  asciiFold,
  flmsgCrc16,
  crc16,
  wrapFlmsg,
  unwrapFlmsg,
  isWrapped,
  decompressFlmsg,
  findLocation,
  stampToTime,
  parseHeaderEntries,
  parseHeaderStamp,
  parseFormDateTime,
  resolveDateOrder,
  parseFlmsgPrefs,
  formToFieldReport,
};
