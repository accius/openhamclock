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

// Generic SSB is deliberately absent: it has no fixed sideband, so setMode()
// resolves it from the frequency instead.
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

/**
 * parse()
 * Incremental parser for Yaesu responses.
 * Called with semicolon-terminated strings (e.g. "IF...;")
 */
function parse(data, updateState, getState, debug) {
  if (debug) console.log(`[Yaesu/Proto] parse: ${data}`);
  if (!data || data.length < 2) return;
  const cmd = data.substring(0, 2);

  switch (cmd) {
    case 'IF': {
      // IF response format verified against live FT-991A:
      // Cross-checked: FA; returned 438700000 Hz, found at IF positions 5-13.
      // Cross-checked: MD0; returned mode 4 (FM), found '4' at IF position 21.
      //
      // IF [2-char sub-band] [3-char ??] [9-char freq Hz] [1 RIT sign] [4 RIT val]
      //    [1 RIT on] [1 XIT on] [1 mode] [1 TX/RX] [rest...]
      //
      // pos  2-3 (2): sub-band / display prefix → "00"
      // pos  4   (1): unknown → "2"
      // pos  5-13(9): VFO A frequency in Hz     → "438700000" ← FA; confirmed
      // pos 14   (1): RIT/XIT sign              → "+"
      // pos 15-18(4): RIT/XIT offset            → "0000"
      // pos 19   (1): RIT on/off                → "0"
      // pos 20   (1): XIT on/off                → "0"
      // pos 21   (1): mode                      → "4" = FM ← MD0; confirmed
      // pos 22   (1): TX/RX (0=RX, 1=TX)        → "0"
      // pos 23-25(3): memory channel            → "100"
      // pos 26   (1): VFO (0=A, 1=B)            → "0"
      if (data.length >= 22) {
        const freqStr = data.substring(5, 14); // 9-digit frequency (confirmed by FA; cross-check)
        const freq = parseInt(freqStr, 10);
        if (freq > 0) updateState('freq', freq);

        const modeDigit = data.charAt(21); // mode confirmed by MD0; cross-check
        const mode = MODES[modeDigit] || getState('mode');
        updateState('mode', mode);

        // PTT is intentionally NOT parsed from IF; here.
        //
        // The IF; TX/RX flag is at position 22, but that position is only confirmed
        // on the FT-991A. On other models (FT-891, FT-710, FT-DX10, etc.) the
        // "unknown" byte at position 4 may be absent, shifting all subsequent fields
        // left by one — causing the memory channel digit ('1' for ch 100-199) to land
        // at position 22 and trigger a false PTT=TX.
        //
        // PTT state is instead read exclusively from TX;/RX; auto-info responses
        // (which use unambiguous 3-character format) and from explicit TX; queries
        // sent at startup and in the 30-second keepalive.
      }
      break;
    }
    case 'FA': {
      const freq = parseInt(data.substring(2), 10);
      if (freq > 0) updateState('freq', freq);
      break;
    }
    case 'MD': {
      const modeStr = data.substring(2);
      const modeDigit = modeStr.length >= 2 ? modeStr.charAt(1) : modeStr.charAt(0);
      const mode = MODES[modeDigit] || getState('mode');
      updateState('mode', mode);
      break;
    }
    case 'TX':
    case 'RX': {
      // Handles both TX;/RX; (unsolicited) and TXn; (auto-info)
      // TX0 = RX, TX1 = PTT TX, TX2 = CAT/linear TX
      // A bare TX; (no digit) is ignored — don't infer TX state from absence of '0'.
      if (cmd === 'RX') {
        updateState('ptt', false);
      } else {
        const txDigit = data.length >= 3 ? data.charAt(2) : '';
        if (txDigit === '0') updateState('ptt', false);
        else if (txDigit === '1' || txDigit === '2') updateState('ptt', true);
        // else: no digit or unrecognised — leave PTT state unchanged
      }
      break;
    }
    default: {
      // Log unrecognised responses — e.g. '?' means the radio rejected the command
      // (wrong baud rate, CAT not enabled, or unsupported command for this model)
      if (data.trim() && debug) console.log(`[Yaesu] Unrecognised response: "${data.trim()}"`);
      break;
    }
  }
}

// Ham band edges (Hz) and the Yaesu BS band-select code for each.
//
// Ranges, not upper edges: with upper edges alone every out-of-band frequency
// fell into the next band up, so 15 MHz WWV selected 17m and 12 MHz selected
// 20m before FA; landed. A frequency outside every band now selects no band at
// all and is sent as a plain FA;, which is what general-coverage receive wants —
// the radio keeps whatever band it is on rather than being dragged to a ham band
// whose stored settings have nothing to do with the frequency being tuned.
//
// Edges span the widest regional allocation for each band (for example 7.0–7.3
// covers both IARU R1 and the US) so no legitimate in-band frequency is refused
// a band change; a frequency legal in one region and not another still tunes,
// it simply keeps the current band's settings.
const BAND_MAP = [
  { min: 1_800_000, max: 2_000_000, code: '00' }, // 160m
  { min: 3_500_000, max: 4_000_000, code: '01' }, // 80m
  { min: 5_250_000, max: 5_450_000, code: '02' }, // 60m
  { min: 7_000_000, max: 7_300_000, code: '03' }, // 40m
  { min: 10_100_000, max: 10_150_000, code: '04' }, // 30m
  { min: 14_000_000, max: 14_350_000, code: '05' }, // 20m
  { min: 18_068_000, max: 18_168_000, code: '06' }, // 17m
  { min: 21_000_000, max: 21_450_000, code: '07' }, // 15m
  { min: 24_890_000, max: 24_990_000, code: '08' }, // 12m
  { min: 28_000_000, max: 29_700_000, code: '09' }, // 10m
  { min: 50_000_000, max: 54_000_000, code: '10' }, // 6m
  { min: 144_000_000, max: 148_000_000, code: '14' }, // 2m
  { min: 420_000_000, max: 450_000_000, code: '15' }, // 70cm
];

/** BS code for a frequency, or null when it falls outside every ham band. */
function freqToBandCode(hz) {
  if (!Number.isFinite(hz)) return null;
  for (const { min, max, code } of BAND_MAP) {
    if (hz >= min && hz <= max) return code;
  }
  return null;
}

/**
 * setFreq()
 *
 * BS; switches band, which makes the radio recall that band's stored VFO and
 * settings — so it is only sent when the target is on a different band than the
 * radio is on now. Sending it for an in-band retune would bounce the VFO to the
 * stored frequency and back, with the ATU and band relays following along.
 *
 * currentHz is the radio's live frequency from the IF; poll rather than a
 * remembered "band we last selected". A remembered value goes stale as soon as
 * the operator turns the band knob, and we would then skip the BS; that the
 * band change actually needed.
 *
 * A mode requested alongside the tune is sent after the band change, because
 * BS; restores the band's stored settings, mode included — a MD; issued before
 * the band finished switching is simply overwritten. getMode is called when the
 * deferred write fires, not now: the caller sets frequency and mode as two
 * near-simultaneous commands, so at fire time it can report the mode that was
 * just requested — or, when none was, the mode the radio was in before the band
 * change, which BS; would otherwise silently replace with that band's stored
 * mode.
 *
 * @param {number} hz          - target frequency
 * @param {Function} serialWrite
 * @param {number} [currentHz] - radio's present frequency; omit if unknown
 * @param {Function} [getMode] - called after a band change; returns the mode
 *                               requested with this tune, or falsy to leave the
 *                               band's recalled mode alone
 */
function setFreq(hz, serialWrite, currentHz, getMode) {
  const padded = String(Math.round(hz)).padStart(9, '0');
  const bandCode = freqToBandCode(hz);
  // Unknown current frequency (not yet polled) counts as a band change: better a
  // redundant BS; than leaving band settings on the wrong band.
  const currentBand = Number.isFinite(currentHz) && currentHz > 0 ? freqToBandCode(currentHz) : null;

  if (bandCode !== null && bandCode !== currentBand) {
    serialWrite(`BS${bandCode};`);
    setTimeout(() => {
      // Mode before frequency: switching to CW can shift the displayed
      // frequency by the CW pitch offset, so FA; goes last and wins.
      const mode = typeof getMode === 'function' ? getMode() : null;
      // Resolve the sideband against the target frequency, not the band we came
      // from — the radio has not reported the new frequency yet.
      if (mode) setMode(mode, serialWrite, hz);
      serialWrite(`FA${padded};`);
    }, 100);
  } else {
    serialWrite(`FA${padded};`);
  }
}

// 60m is worked USB by convention, unlike every other band below 10 MHz. These
// bounds span both the IARU R1 band and the US channels, and match the app's
// getSideband() so the two agree on what a generic 'SSB' means.
const SIXTY_M_MIN_HZ = 5_300_000;
const SIXTY_M_MAX_HZ = 5_405_000;

/**
 * Sideband for a generic 'SSB': LSB below 10 MHz, USB at and above it, with 60m
 * as the exception. An unknown frequency falls back to USB, which is what this
 * module did before the rule became frequency-aware.
 */
function ssbSidebandDigit(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return '2';
  if (hz >= SIXTY_M_MIN_HZ && hz <= SIXTY_M_MAX_HZ) return '2';
  return hz < 10_000_000 ? '1' : '2';
}

/**
 * setMode()
 *
 * @param {string} mode
 * @param {Function} serialWrite
 * @param {number} [currentHz] - frequency the mode applies to; only needed to
 *                               resolve the sideband for a generic 'SSB'
 */
function setMode(mode, serialWrite, currentHz) {
  const m = String(mode || '').toUpperCase();

  // Generic SSB carries no sideband of its own — resolve it from the frequency
  // so a caller sending 'SSB' lands on the same sideband the app would pick.
  if (m === 'SSB') {
    serialWrite(`MD0${ssbSidebandDigit(currentHz)};`);
    return;
  }

  let digit = MODE_REVERSE[mode];
  if (!digit) digit = MODE_ALIASES[m];
  if (digit) serialWrite(`MD0${digit};`);
}

function setPTT(on, serialWrite) {
  serialWrite(on ? 'TX1;' : 'TX0;');
}

module.exports = { poll, parse, setFreq, setMode, setPTT };
