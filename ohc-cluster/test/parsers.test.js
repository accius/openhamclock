const { test } = require('node:test');
const assert = require('node:assert');

const { parseRbnLine } = require('../lib/rbn.js');
const { parseHamqthCsv, parseHamqthTimestamp } = require('../lib/hamqth.js');
const { isValidCallsign, isPlausibleDxCall, baseCallsign, sanitizeLine } = require('../lib/callsign.js');
const { bandForKhz, formatSpotLine } = require('../lib/format.js');

test('parseRbnLine: CW spot with WPM', () => {
  const spot = parseRbnLine('DX de KM3T-#:    14025.1  W1AW           CW    23 dB  22 WPM  CQ      1234Z');
  assert.ok(spot);
  assert.equal(spot.spotter, 'KM3T-#');
  assert.equal(spot.call, 'W1AW');
  assert.equal(spot.freqKhz, 14025.1);
  assert.equal(spot.mode, 'CW');
  assert.equal(spot.snr, 23);
  assert.equal(spot.wpm, 22);
  assert.ok(spot.isSkimmer);
});

test('parseRbnLine: FT8 spot without WPM, negative SNR', () => {
  const spot = parseRbnLine('DX de S50ARX-#:  14074.0  DL1ABC         FT8   -13 dB           CQ      0007Z');
  assert.ok(spot);
  assert.equal(spot.mode, 'FT8');
  assert.equal(spot.snr, -13);
  assert.equal(spot.wpm, null);
});

test('parseRbnLine: RTTY spot with BPS', () => {
  const spot = parseRbnLine('DX de DL8LAS-#:   7045.0  DK0TTY         RTTY  45 dB  45 BPS  CQ      2359Z');
  assert.ok(spot);
  assert.equal(spot.mode, 'RTTY');
  assert.equal(spot.wpm, 45);
});

test('parseRbnLine: rejects non-spot lines', () => {
  assert.equal(parseRbnLine('Please enter your call:'), null);
  assert.equal(parseRbnLine(''), null);
  assert.equal(parseRbnLine('DX de garbage'), null);
});

test('parseHamqthCsv: parses caret-separated rows', () => {
  const csv = 'KF0NYM^18070.0^TX5U^Correction, Good Sig MO, 73^2149 2025-05-27^^^EU^17M^France^227\n';
  const spots = parseHamqthCsv(csv);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].spotter, 'KF0NYM');
  assert.equal(spots[0].call, 'TX5U');
  assert.equal(spots[0].freqKhz, 18070);
  assert.equal(spots[0].isSkimmer, false);
});

test('parseHamqthTimestamp: HHMM YYYY-MM-DD to UTC epoch', () => {
  const ts = parseHamqthTimestamp('2149 2025-05-27');
  assert.equal(new Date(ts).toISOString(), '2025-05-27T21:49:00.000Z');
});

test('isPlausibleDxCall: accepts real spotted-call shapes, incl. special events', () => {
  for (const call of [
    'W1AW',
    'K0C', // 1x1 special event
    'YR50NADIA', // long special-event suffix
    'GB100RSGB',
    'DL2026T', // year-marker body
    'TM113TDF',
    'PJ2/W9WI',
    'N2BTD/VE3',
    'JK1XOQ/1',
    'VP2EA/QRP',
    '9A1A',
    '3DA0RU',
  ]) {
    assert.ok(isPlausibleDxCall(call), `${call} should be plausible`);
  }
});

test('isPlausibleDxCall: rejects busted calls and junk', () => {
  for (const call of [
    'NATZR', // dropped digit (live bust)
    'TM113TDFBK', // CW BK prosign decoded into the call (live bust)
    'CQ', // literal junk from an aggregated feed (live)
    'QRZ',
    'TEST',
    '12345',
    'W1AW-5', // SSIDs belong to nodes
    'A/B/C/D',
    'DX',
    'FT8',
    '',
    null,
  ]) {
    assert.ok(!isPlausibleDxCall(call), `${call} should be rejected`);
  }
});

test('isValidCallsign: accepts real shapes', () => {
  for (const call of ['W1AW', 'K0CJH', 'k0cjh', 'EA8/DL1ABC', 'DL1ABC/P', 'VK2XYZ-2', '9A1A', 'TX5U']) {
    assert.ok(isValidCallsign(call), `${call} should be valid`);
  }
});

test('isValidCallsign: rejects junk', () => {
  for (const call of ['OPENHAMCLOCK-56', 'GUEST', 'HELLO', '', '12345', 'A-1', 'N0CALL-999', 'A'.repeat(20)]) {
    assert.ok(!isValidCallsign(call), `${call} should be invalid`);
  }
});

test('baseCallsign: strips SSID and portable decorations', () => {
  assert.equal(baseCallsign('K0CJH-2'), 'K0CJH');
  assert.equal(baseCallsign('EA8/DL1ABC'), 'DL1ABC');
  assert.equal(baseCallsign('DL1ABC/P'), 'DL1ABC');
});

test('sanitizeLine: strips control characters', () => {
  assert.equal(sanitizeLine('K0CJH\x00\x1b[2J\r'), 'K0CJH[2J');
});

test('bandForKhz: maps frequencies to bands', () => {
  assert.equal(bandForKhz(14025.1), '20m');
  assert.equal(bandForKhz(7074), '40m');
  assert.equal(bandForKhz(50313), '6m');
  assert.equal(bandForKhz(99999), null);
});

test('formatSpotLine: emits classic cluster column layout', () => {
  const line = formatSpotLine({
    spotter: 'KM3T-#',
    freqKhz: 14025.1,
    call: 'W1AW',
    comment: 'CW 23 dB 22 WPM CQ',
    timestamp: Date.UTC(2026, 5, 10, 12, 34),
  });
  assert.match(line, /^DX de KM3T-#:\s+14025\.1\s+W1AW\s+CW 23 dB 22 WPM CQ\s+1234Z$/);
});
