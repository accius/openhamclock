'use strict';
/**
 * protocol-kenwood.js — Kenwood CAT ASCII protocol
 *
 * Covers: TS-890, TS-590, TS-2000, TS-480, Elecraft K3/K4/KX3/KX2, etc.
 * Very similar to Yaesu — ASCII semicolon-terminated.
 *
 * Pure functions — all I/O is injected via serialWrite / updateState.
 */

const MODES = {
  1: 'LSB',
  2: 'USB',
  3: 'CW',
  4: 'FM',
  5: 'AM',
  6: 'FSK',
  7: 'CW-R',
  8: 'DATA-LSB',
  9: 'FSK-R',
  A: 'DATA-USB',
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
  'DATA-USB': 'A',
  'DATA-LSB': '8',
  FT8: 'A',
  FT4: 'A',
  DIGI: 'A',
  PSK: 'A',
};

function poll(serialWrite) {
  serialWrite('IF;');
}

function parse(resp, updateState, getState) {
  if (!resp || resp.length < 2) return;
  const cmd = resp.substring(0, 2);

  switch (cmd) {
    case 'IF': {
      // Kenwood IF format:
      // IF00014074000     +000000000040000000;
      // Freq is 11 digits starting at position 2
      if (resp.length >= 37) {
        const freqStr = resp.substring(2, 13);
        const freq = parseInt(freqStr, 10);
        if (freq > 0) updateState('freq', freq);

        // Mode at position 29
        const modeDigit = resp.charAt(29);
        const mode = MODES[modeDigit] || getState('mode');
        updateState('mode', mode);

        // TX state at position 28
        const txState = resp.charAt(28);
        updateState('ptt', txState !== '0');
      }
      break;
    }
    case 'FA': {
      const freq = parseInt(resp.substring(2), 10);
      if (freq > 0) updateState('freq', freq);
      break;
    }
    case 'MD': {
      const modeDigit = resp.charAt(2);
      const mode = MODES[modeDigit] || getState('mode');
      updateState('mode', mode);
      break;
    }
  }
}

function setFreq(hz, serialWrite) {
  const padded = String(Math.round(hz)).padStart(11, '0');
  serialWrite(`FA${padded};`);
}

function setMode(mode, serialWrite) {
  let digit = MODE_REVERSE[mode];
  if (!digit) digit = MODE_ALIASES[mode.toUpperCase()];
  if (digit) serialWrite(`MD${digit};`);
}

function setPTT(on, serialWrite) {
  serialWrite(on ? 'TX;' : 'RX;');
}

module.exports = { poll, parse, setFreq, setMode, setPTT };
