'use strict';
/**
 * protocol-yaesu.js — Yaesu CAT ASCII protocol
 *
 * Covers: FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, FT-5000, etc.
 * Commands are ASCII, semicolon-terminated.
 *
 * Pure functions — all I/O is injected via serialWrite / updateState.
 */

const MODES = {
  1: 'LSB',
  2: 'USB',
  3: 'CW',
  4: 'FM',
  5: 'AM',
  6: 'RTTY-LSB',
  7: 'CW-R',
  8: 'DATA-LSB',
  9: 'RTTY-USB',
  A: 'DATA-FM',
  B: 'FM-N',
  C: 'DATA-USB',
  D: 'AM-N',
  E: 'C4FM',
};

const MODE_REVERSE = {};
Object.entries(MODES).forEach(([k, v]) => {
  MODE_REVERSE[v] = k;
});

const MODE_ALIASES = {
  USB: '2',
  LSB: '1',
  CW: '3',
  'CW-R': '7',
  FM: '4',
  AM: '5',
  'DATA-USB': 'C',
  'DATA-LSB': '8',
  RTTY: '6',
  'RTTY-R': '9',
  FT8: 'C',
  FT4: 'C',
  DIGI: 'C',
  SSB: '2',
  PSK: 'C',
  JT65: 'C',
};

function poll(serialWrite) {
  // IF; returns frequency + mode + PTT + VFO state in a single response,
  // universally supported across all FT-series radios (FT-991A, FT-891, FT-710,
  // FT-DX10, etc.). Using a single command avoids the timing issues of sending
  // FA; and MD0; separately and gives us PTT state for free too.
  serialWrite('IF;');
}

function parse(resp, updateState, getState) {
  if (!resp || resp.length < 2) return;
  const cmd = resp.substring(0, 2);

  switch (cmd) {
    case 'IF': {
      // IF response format (FT-991A):
      // IFaaaaaaaaabbbbcccccddeefffggg...
      // Positions: IF + 9 digit freq (3-11) + ...mode at pos 21
      if (resp.length >= 27) {
        const freqStr = resp.substring(2, 11);
        const freq = parseInt(freqStr, 10);
        if (freq > 0) updateState('freq', freq);

        const modeDigit = resp.charAt(21);
        const mode = MODES[modeDigit] || getState('mode');
        updateState('mode', mode);

        // PTT status at position 28 (TX state)
        if (resp.length >= 29) {
          const txState = resp.charAt(28);
          updateState('ptt', txState !== '0');
        }
      }
      break;
    }
    case 'FA': {
      const freq = parseInt(resp.substring(2), 10);
      if (freq > 0) updateState('freq', freq);
      break;
    }
    case 'MD': {
      // MD0X; format (FT-991A, FT-710, etc.) or MDX; (older models)
      const modeStr = resp.substring(2);
      const modeDigit = modeStr.length >= 2 ? modeStr.charAt(1) : modeStr.charAt(0);
      const mode = MODES[modeDigit] || getState('mode');
      updateState('mode', mode);
      break;
    }
    case 'TX':
    case 'RX': {
      updateState('ptt', cmd === 'TX');
      break;
    }
    default: {
      // Log unrecognised responses — e.g. '?' means the radio rejected the command
      // (wrong baud rate, CAT not enabled, or unsupported command for this model)
      if (resp.trim()) console.log(`[Yaesu] Unrecognised response: "${resp.trim()}"`);
      break;
    }
  }
}

function setFreq(hz, serialWrite) {
  const padded = String(Math.round(hz)).padStart(9, '0');
  serialWrite(`FA${padded};`);
}

function setMode(mode, serialWrite) {
  let digit = MODE_REVERSE[mode];
  if (!digit) digit = MODE_ALIASES[mode.toUpperCase()];
  if (digit) serialWrite(`MD0${digit};`);
}

function setPTT(on, serialWrite) {
  serialWrite(on ? 'TX1;' : 'TX0;');
}

module.exports = { poll, parse, setFreq, setMode, setPTT };
