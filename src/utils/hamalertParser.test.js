import { describe, it, expect } from 'vitest';
import {
  parseHamAlertLine,
  isHamAlertLine,
  isLoginPrompt,
  isPasswordPrompt,
  isWelcomeLine,
  extractMode,
  extractSource,
  hhmmToTimestamp,
  hamAlertKey,
} from './hamalertParser.js';

const NOW = Date.UTC(2026, 9, 14, 12, 40, 0); // 12:40z

describe('hamalertParser', () => {
  it('parses a typical pskreporter-sourced FT8 alert', () => {
    const a = parseHamAlertLine('DX de HAMALERT: 14074.0  DL1ABC   FT8 -12 dB [pskreporter]    1234Z', NOW);
    expect(a).toMatchObject({
      spotter: 'HAMALERT',
      call: 'DL1ABC',
      freqKhz: 14074,
      freq: '14.074',
      mode: 'FT8',
      source: 'pskreporter',
      comment: 'FT8 -12 dB [pskreporter]',
      time: '12:34z',
      grid: null,
    });
    expect(a.timestamp).toBe(Date.UTC(2026, 9, 14, 12, 34, 0));
  });

  it('parses a SOTA alert with parenthesised source and trailing grid', () => {
    const a = parseHamAlertLine('DX de HAMALERT: 7032.0 OE5XYZ CW SOTA OE/OO-123 (sotawatch) 0915Z JN68', NOW);
    expect(a.call).toBe('OE5XYZ');
    expect(a.freq).toBe('7.032');
    expect(a.mode).toBe('CW');
    expect(a.source).toBe('sota');
    expect(a.grid).toBe('JN68');
    expect(a.comment).toBe('CW SOTA OE/OO-123 (sotawatch)');
  });

  it('handles portable calls, decimal kHz, and no comment', () => {
    const a = parseHamAlertLine('DX de HAMALERT: 21025.5 5Z4/OZ6ABL 1100Z', NOW);
    expect(a.call).toBe('5Z4/OZ6ABL');
    expect(a.freqKhz).toBe(21025.5);
    expect(a.freq).toBe('21.026');
    expect(a.comment).toBe('');
    expect(a.mode).toBeNull();
    expect(a.source).toBeNull();
  });

  it('accepts generic DX-cluster lines from other spotters', () => {
    const a = parseHamAlertLine('DX de K1TTT:     14025.0  DL1ABC       CW 599 up 2               1234Z FN32', NOW);
    expect(a.spotter).toBe('K1TTT');
    expect(a.mode).toBe('CW');
    expect(a.grid).toBe('FN32');
  });

  it('rejects non-spot lines', () => {
    expect(parseHamAlertLine('Hello N0CALL, this is HamAlert')).toBeNull();
    expect(parseHamAlertLine('login: ')).toBeNull();
    expect(parseHamAlertLine('')).toBeNull();
    expect(parseHamAlertLine(null)).toBeNull();
    expect(parseHamAlertLine('DX de HAMALERT: abc DL1ABC 1234Z')).toBeNull();
  });

  it('yesterday rollover: a time later than now is yesterday', () => {
    const a = parseHamAlertLine('DX de HAMALERT: 14074.0 DL1ABC FT8 2359Z', NOW);
    expect(a.timestamp).toBe(Date.UTC(2026, 9, 13, 23, 59, 0));
    expect(hhmmToTimestamp('9999', NOW)).toBe(NOW);
  });

  it('handshake helpers', () => {
    expect(isLoginPrompt('login:')).toBe(true);
    expect(isLoginPrompt('Please enter your login: ')).toBe(true);
    expect(isPasswordPrompt('password:')).toBe(true);
    expect(isWelcomeLine('Hello N0CALL, this is HamAlert')).toBe(true);
    expect(isHamAlertLine('DX de HAMALERT: 1 X 0000Z')).toBe(true);
    expect(isHamAlertLine('WWV de W0MU')).toBe(false);
  });

  it('mode and source extraction edge cases', () => {
    expect(extractMode('CQ FT4 -3 dB')).toBe('FT4');
    expect(extractMode('PSK31 strong')).toBe('PSK31');
    expect(extractMode('MSFT8X')).toBeNull(); // embedded, not a token
    expect(extractMode('')).toBeNull();
    expect(extractSource('[RBN] CW 22 WPM')).toBe('rbn');
    expect(extractSource('POTA K-1234')).toBe('pota');
    expect(extractSource('(custom source)')).toBe('custom source');
    expect(extractSource('just a comment')).toBeNull();
  });

  it('hamAlertKey identifies the same spot across re-sends', () => {
    const a = parseHamAlertLine('DX de HAMALERT: 14074.0 DL1ABC FT8 1234Z', NOW);
    const b = parseHamAlertLine('DX de HAMALERT: 14074.0 DL1ABC FT8 -5 dB 1234Z', NOW);
    const c = parseHamAlertLine('DX de HAMALERT: 14074.5 DL1ABC FT8 1234Z', NOW);
    expect(hamAlertKey(a)).toBe(hamAlertKey(b));
    expect(hamAlertKey(a)).not.toBe(hamAlertKey(c));
    expect(hamAlertKey(null)).toBe('');
  });
});
