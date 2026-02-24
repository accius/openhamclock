'use strict';
/**
 * protocol-icom.js — Icom CI-V binary protocol
 *
 * Covers: IC-7300, IC-7610, IC-9700, IC-705, IC-7851, etc.
 * Binary protocol: FE FE [to] [from] [cmd] [sub] [data...] FD
 *
 * Pure functions — all I/O is injected via serialWrite / updateState.
 */

const CONTROLLER = 0xe0; // Our address (controller)

const MODES = {
  0x00: 'LSB',
  0x01: 'USB',
  0x02: 'AM',
  0x03: 'CW',
  0x04: 'RTTY',
  0x05: 'FM',
  0x06: 'WFM',
  0x07: 'CW-R',
  0x08: 'RTTY-R',
  0x11: 'DATA-LSB',
  0x12: 'DATA-USB',
  0x17: 'DATA-FM',
};

const MODE_REVERSE = {};
Object.entries(MODES).forEach(([k, v]) => {
  MODE_REVERSE[v] = parseInt(k);
});

const MODE_ALIASES = {
  USB: 0x01,
  LSB: 0x00,
  CW: 0x03,
  'CW-R': 0x07,
  FM: 0x05,
  AM: 0x02,
  'DATA-USB': 0x12,
  'DATA-LSB': 0x11,
  FT8: 0x12,
  FT4: 0x12,
  DIGI: 0x12,
  PSK: 0x12,
  RTTY: 0x04,
  'RTTY-R': 0x08,
};

function buildCmd(rigAddress, cmd, sub, data = []) {
  const packet = [0xfe, 0xfe, rigAddress, CONTROLLER, cmd];
  if (sub !== undefined && sub !== null) packet.push(sub);
  packet.push(...data);
  packet.push(0xfd);
  return Buffer.from(packet);
}

function bcdToFreq(bytes) {
  let freq = 0;
  let mult = 1;
  for (let i = 0; i < bytes.length; i++) {
    const lo = bytes[i] & 0x0f;
    const hi = (bytes[i] >> 4) & 0x0f;
    freq += lo * mult;
    mult *= 10;
    freq += hi * mult;
    mult *= 10;
  }
  return freq;
}

function freqToBCD(freq) {
  const bytes = [];
  let f = Math.round(freq);
  for (let i = 0; i < 5; i++) {
    const lo = f % 10;
    f = Math.floor(f / 10);
    const hi = f % 10;
    f = Math.floor(f / 10);
    bytes.push((hi << 4) | lo);
  }
  return bytes;
}

function poll(serialWrite, rigAddress) {
  // Read frequency (cmd 0x03)
  serialWrite(buildCmd(rigAddress, 0x03));
  // Read mode (cmd 0x04)
  setTimeout(() => serialWrite(buildCmd(rigAddress, 0x04)), 50);
}

/**
 * Parse incoming CI-V binary data into complete frames and update state.
 * rxBuffer is mutated in place; caller passes it by reference via { buf }.
 */
function handleData(data, rxBuf, updateState, getState) {
  let buf = Buffer.concat([rxBuf, data]);

  while (true) {
    const start = buf.indexOf(0xfe);
    if (start === -1) {
      buf = Buffer.alloc(0);
      break;
    }
    if (start > 0) buf = buf.slice(start);

    const end = buf.indexOf(0xfd, 2);
    if (end === -1) break; // Wait for more data

    const frame = buf.slice(0, end + 1);
    buf = buf.slice(end + 1);

    if (frame.length < 6) continue;
    if (frame[0] !== 0xfe || frame[1] !== 0xfe) continue;

    const to = frame[2];
    const cmd = frame[4];

    // Only process frames addressed to us
    if (to !== CONTROLLER) continue;

    switch (cmd) {
      case 0x03: // Frequency response
      case 0x00: {
        // Freq update (unsolicited)
        if (frame.length >= 10) {
          const freq = bcdToFreq(frame.slice(5, 10));
          if (freq > 0) updateState('freq', freq);
        }
        break;
      }
      case 0x04: // Mode response
      case 0x01: {
        // Mode update
        if (frame.length >= 7) {
          const mode = MODES[frame[5]] || getState('mode');
          updateState('mode', mode);
          if (frame.length >= 8) {
            updateState('width', frame[6]); // Filter width index
          }
        }
        break;
      }
      case 0xfb: {
        // OK acknowledgment — no action needed
        break;
      }
      case 0xfa: {
        // NG (error)
        console.warn('[Icom] Command rejected (NG)');
        break;
      }
    }
  }

  return buf; // Return updated buffer
}

function setFreq(hz, serialWrite, rigAddress) {
  const bcd = freqToBCD(hz);
  serialWrite(buildCmd(rigAddress, 0x05, null, bcd));
}

function setMode(mode, serialWrite, rigAddress) {
  let code = MODE_REVERSE[mode];
  if (code === undefined) code = MODE_ALIASES[mode.toUpperCase()];
  if (code !== undefined) {
    // cmd 0x06, mode byte, filter 0x01 (wide)
    serialWrite(buildCmd(rigAddress, 0x06, null, [code, 0x01]));
  }
}

function setPTT(on, serialWrite, rigAddress) {
  serialWrite(buildCmd(rigAddress, 0x1c, 0x00, [on ? 0x01 : 0x00]));
}

module.exports = { poll, handleData, setFreq, setMode, setPTT };
