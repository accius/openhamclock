import { describe, it, expect } from 'vitest';
import { lufFromBands } from './luf.js';

// W3AAX's panel (FT8, 25 W, Pennsylvania → Russian Far East, 23:45 UTC in
// November): the server estimate said LUF 2.4 MHz while P.533 had 160m at 75%.
const W3AAX = [
  { band: '80m', freq: 3.5, reliability: 99 },
  { band: '40m', freq: 7.0, reliability: 99 },
  { band: '30m', freq: 10.0, reliability: 91 },
  { band: '160m', freq: 1.8, reliability: 75 },
  { band: '20m', freq: 14.0, reliability: 19 },
  { band: '17m', freq: 18.0, reliability: 0 },
];

describe('lufFromBands', () => {
  it('is the lowest band at or above 50%, so it agrees with the bars', () => {
    expect(lufFromBands(W3AAX)).toBe(1.8);
  });

  it('skips low bands below the line', () => {
    const day = W3AAX.map((b) => (b.band === '160m' ? { ...b, reliability: 10 } : b));
    expect(lufFromBands(day)).toBe(3.5);
    expect(lufFromBands(day, 95)).toBe(3.5);
    expect(lufFromBands(day, 100)).toBeNull();
  });

  it('is null when no band is usable, or with no data', () => {
    expect(lufFromBands(W3AAX.map((b) => ({ ...b, reliability: 20 })))).toBeNull();
    expect(lufFromBands([])).toBeNull();
    expect(lufFromBands(undefined)).toBeNull();
    expect(
      lufFromBands([
        { freq: 'x', reliability: 90 },
        { freq: 7, reliability: null },
      ]),
    ).toBeNull();
  });
});
