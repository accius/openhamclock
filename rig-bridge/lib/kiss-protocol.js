'use strict';
/**
 * kiss-protocol.js — KISS TNC framing and AX.25 packet parsing
 *
 * Implements:
 *   - KISS frame encode/decode (FEND/FESC/TFEND/TFESC escaping)
 *   - AX.25 UI frame header parsing (source, destination, digipeaters)
 *   - AX.25 UI frame construction for TX
 *
 * Reference: http://www.ax25.net/kiss.aspx
 *            http://www.ax25.net/AX25.2.2-Jul%2098-2.pdf
 */

// KISS special bytes
const FEND = 0xc0;
const FESC = 0xdb;
const TFEND = 0xdc;
const TFESC = 0xdd;

// KISS command types
const KISS_DATA = 0x00;

/**
 * Decode a KISS frame by removing FEND framing and unescaping.
 * Returns the raw AX.25 frame bytes (without the KISS command byte) or null.
 */
function decodeKissFrame(data) {
  // Strip leading/trailing FENDs
  let start = 0;
  let end = data.length;
  while (start < end && data[start] === FEND) start++;
  while (end > start && data[end - 1] === FEND) end--;
  if (start >= end) return null;

  const frame = data.slice(start, end);

  // First byte is KISS command — we only handle data frames (0x00, or port 0 data)
  const cmd = frame[0] & 0x0f;
  if (cmd !== KISS_DATA) return null;

  // Unescape the rest
  const out = [];
  let i = 1; // skip command byte
  while (i < frame.length) {
    if (frame[i] === FESC) {
      i++;
      if (i >= frame.length) break;
      if (frame[i] === TFEND) out.push(FEND);
      else if (frame[i] === TFESC) out.push(FESC);
      else out.push(frame[i]);
    } else if (frame[i] === FEND) {
      // Embedded FEND — shouldn't happen in a properly framed packet
      break;
    } else {
      out.push(frame[i]);
    }
    i++;
  }

  return Buffer.from(out);
}

/**
 * Encode raw AX.25 frame bytes into a KISS data frame.
 */
function encodeKissFrame(ax25Data) {
  const out = [FEND, KISS_DATA]; // FEND + data command

  for (let i = 0; i < ax25Data.length; i++) {
    const b = ax25Data[i];
    if (b === FEND) {
      out.push(FESC, TFEND);
    } else if (b === FESC) {
      out.push(FESC, TFESC);
    } else {
      out.push(b);
    }
  }

  out.push(FEND);
  return Buffer.from(out);
}

/**
 * Extract complete KISS frames from a byte buffer.
 * Returns { frames: Buffer[], remainder: Buffer }
 * The remainder is the leftover bytes that don't form a complete frame yet.
 */
function extractKissFrames(buffer) {
  const frames = [];
  let start = -1;

  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === FEND) {
      if (start >= 0 && i > start + 1) {
        // We have a frame between start and i
        frames.push(buffer.slice(start, i + 1));
      }
      start = i;
    }
  }

  // Remainder: from last FEND to end (incomplete frame)
  const remainder = start >= 0 && start < buffer.length - 1 ? buffer.slice(start) : Buffer.alloc(0);
  return { frames, remainder };
}

/**
 * Parse an AX.25 address field (7 bytes) into a callsign and SSID.
 * AX.25 addresses are left-shifted by 1 bit with SSID in the last byte.
 */
function parseAx25Address(buf, offset) {
  let call = '';
  for (let i = 0; i < 6; i++) {
    const ch = buf[offset + i] >> 1;
    if (ch !== 0x20) call += String.fromCharCode(ch); // skip space padding
  }
  const ssidByte = buf[offset + 6];
  const ssid = (ssidByte >> 1) & 0x0f;
  const isLast = !!(ssidByte & 0x01); // address extension bit
  const repeated = !!(ssidByte & 0x80); // H bit: a digipeater has repeated the frame (via addresses only)
  return { call: call.trim(), ssid, full: ssid > 0 ? `${call.trim()}-${ssid}` : call.trim(), isLast, repeated };
}

/**
 * Encode a callsign + SSID into a 7-byte AX.25 address field.
 */
function encodeAx25Address(callsign, ssid, isLast) {
  const buf = Buffer.alloc(7);
  const call = callsign.toUpperCase().padEnd(6, ' ');
  for (let i = 0; i < 6; i++) {
    buf[i] = call.charCodeAt(i) << 1;
  }
  buf[6] = ((ssid & 0x0f) << 1) | 0x60; // reserved bits set
  if (isLast) buf[6] |= 0x01;
  return buf;
}

/**
 * Parse a raw AX.25 UI frame into header + info fields.
 * Returns { source, destination, digipeaters[], info } or null.
 */
function parseAx25Frame(data) {
  if (data.length < 16) return null; // minimum: 14 addr + 1 ctrl + 1 info

  const destination = parseAx25Address(data, 0);
  const source = parseAx25Address(data, 7);

  const digipeaters = [];
  let offset = 14;
  let lastAddr = source.isLast;

  while (!lastAddr && offset + 7 <= data.length) {
    const digi = parseAx25Address(data, offset);
    digipeaters.push(digi);
    lastAddr = digi.isLast;
    offset += 7;
  }

  // Control byte should be 0x03 (UI frame) and PID should be 0xF0 (no layer 3)
  if (offset + 2 > data.length) return null;
  const control = data[offset];
  const pid = data[offset + 1];
  offset += 2;

  if (control !== 0x03 || pid !== 0xf0) return null; // Only handle UI frames

  const info = data.slice(offset).toString('ascii');

  return {
    source: source.full,
    destination: destination.full,
    digipeaters: digipeaters.map((d) => d.full),
    // Via addresses that have repeated this frame, in path order (#1262: a
    // digipeated copy of our own beacon confirms it went out)
    repeatedBy: digipeaters.filter((d) => d.repeated).map((d) => d.full),
    info,
    raw: data,
  };
}

/**
 * Build an AX.25 UI frame for transmission.
 *
 * @param {string} source     Source callsign (e.g. 'N0CALL-9')
 * @param {string} dest       Destination (e.g. 'APRS' or 'APZ001')
 * @param {string[]} path     Digipeater path (e.g. ['WIDE1-1', 'WIDE2-1'])
 * @param {string} info       APRS payload string
 */
function buildAx25Frame(source, dest, path, info) {
  function splitCall(s) {
    const parts = s.split('-');
    return { call: parts[0], ssid: parseInt(parts[1]) || 0 };
  }

  const destParsed = splitCall(dest);
  const srcParsed = splitCall(source);
  const isLastSrc = path.length === 0;

  const parts = [
    encodeAx25Address(destParsed.call, destParsed.ssid, false),
    encodeAx25Address(srcParsed.call, srcParsed.ssid, isLastSrc),
  ];

  path.forEach((digi, i) => {
    const d = splitCall(digi);
    parts.push(encodeAx25Address(d.call, d.ssid, i === path.length - 1));
  });

  // Control (UI) + PID (no layer 3)
  parts.push(Buffer.from([0x03, 0xf0]));
  // Info field
  parts.push(Buffer.from(info, 'ascii'));

  return Buffer.concat(parts);
}

module.exports = {
  FEND,
  FESC,
  TFEND,
  TFESC,
  decodeKissFrame,
  encodeKissFrame,
  extractKissFrames,
  parseAx25Address,
  encodeAx25Address,
  parseAx25Frame,
  buildAx25Frame,
};
