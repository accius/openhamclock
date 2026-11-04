/**
 * Parity guard: the rig-bridge CommonJS copy of the HamAlert parser must
 * agree with src/utils/hamalertParser.js on every fixture line.
 */
import { describe, it, expect } from 'vitest';
import * as esm from '../../src/utils/hamalertParser.js';
import cjs from './hamalert-parser.js';

const NOW = Date.UTC(2026, 9, 14, 12, 40, 0);
const LINES = [
  'DX de HAMALERT: 14074.0  DL1ABC   FT8 -12 dB [pskreporter]    1234Z',
  'DX de HAMALERT: 7032.0 OE5XYZ CW SOTA OE/OO-123 (sotawatch) 0915Z JN68',
  'DX de HAMALERT: 21025.5 5Z4/OZ6ABL 1100Z',
  'DX de K1TTT:     14025.0  DL1ABC       CW 599 up 2               1234Z FN32',
  'DX de HAMALERT: 14074.0 DL1ABC FT8 2359Z',
  'Hello N0CALL, this is HamAlert',
  'login:',
  '',
];

describe('rig-bridge hamalert-parser parity', () => {
  it('parses every fixture identically to the browser copy', () => {
    for (const line of LINES) {
      expect(cjs.parseHamAlertLine(line, NOW)).toEqual(esm.parseHamAlertLine(line, NOW));
    }
  });

  it('exports the same helper surface', () => {
    for (const name of Object.keys(esm)) {
      expect(typeof cjs[name]).toBe('function');
    }
    expect(cjs.isLoginPrompt('login:')).toBe(true);
    expect(cjs.isPasswordPrompt('password:')).toBe(true);
    expect(cjs.isWelcomeLine('Hello N0CALL, this is HamAlert')).toBe(true);
    expect(cjs.hamAlertKey(cjs.parseHamAlertLine(LINES[0], NOW))).toBe(
      esm.hamAlertKey(esm.parseHamAlertLine(LINES[0], NOW)),
    );
  });
});
