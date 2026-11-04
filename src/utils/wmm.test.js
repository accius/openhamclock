/**
 * WMM2025 against the published NCEI test values (WMM2025_TEST_VALUES.txt,
 * Feb 2025). Columns used: date, height (km), lat, lon, D, I, F.
 * Published values are rounded to 0.01° / 0.1 nT; the tolerances below
 * leave room for that rounding and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { magneticField, declination, trueToMagnetic, decimalYear } from './wmm.js';

// [year, altKm, lat, lon, D, I, F]
const TEST_VALUES = [
  [2025.0, 0, 80, 0, 1.28, 83.21, 55178.5],
  [2025.0, 0, 0, 120, -0.16, -14.93, 41064.3],
  [2025.0, 0, -80, 240, 68.78, -72.0, 54698.2],
  [2025.0, 100, 80, 0, 0.85, 83.26, 52964.9],
  [2025.0, 100, 0, 120, -0.15, -15.08, 39032.1],
  [2025.0, 100, -80, 240, 68.21, -72.19, 52035.0],
  [2027.5, 0, 80, 0, 2.59, 83.24, 55253.9],
  [2027.5, 0, 0, 120, -0.24, -14.65, 41036.9],
  [2027.5, 0, -80, 240, 68.49, -71.92, 54474.2],
  [2027.5, 100, 80, 0, 2.16, 83.29, 53034.3],
  [2027.5, 100, 0, 120, -0.23, -14.81, 39007.4],
  [2027.5, 100, -80, 240, 67.93, -72.1, 51825.7],
];

describe('wmm — WMM2025 published test values', () => {
  for (const [year, alt, lat, lon, D, I, F] of TEST_VALUES) {
    it(`matches ${year} h=${alt}km lat=${lat} lon=${lon}`, () => {
      const f = magneticField(lat, lon, alt, year);
      expect(f.declination).toBeCloseTo(D, 1);
      expect(Math.abs(f.declination - D)).toBeLessThan(0.011);
      expect(Math.abs(f.inclination - I)).toBeLessThan(0.011);
      expect(Math.abs(f.f - F)).toBeLessThan(1.0);
    });
  }
});

describe('declination helpers', () => {
  it('returns null for invalid coordinates', () => {
    expect(declination(NaN, 0)).toBeNull();
    expect(declination(95, 0)).toBeNull();
    expect(declination(0, undefined)).toBeNull();
  });

  it('accepts a Date and gives a sensible mid-latitude value', () => {
    // Boulder, CO is ~7.5°E in 2025–2027
    const d = declination(40.0, -105.3, 1.6, new Date(Date.UTC(2026, 6, 1)));
    expect(d).toBeGreaterThan(6);
    expect(d).toBeLessThan(9);
  });

  it('trueToMagnetic subtracts east declination and wraps 0–360', () => {
    // 80N 0E at 2025.0: D = +1.28 → magnetic = true − 1.28
    expect(trueToMagnetic(0, 80, 0, 0, 2025.0)).toBeCloseTo(358.72, 1);
    expect(trueToMagnetic(90, 80, 0, 0, 2025.0)).toBeCloseTo(88.72, 1);
    // -80N 240E at 2025.0: D = +68.78
    expect(trueToMagnetic(10, -80, 240, 0, 2025.0)).toBeCloseTo(301.22, 1);
  });

  it('trueToMagnetic passes non-finite bearings through', () => {
    expect(trueToMagnetic(NaN, 40, -105)).toBeNaN();
  });

  it('decimalYear is linear within a year', () => {
    expect(decimalYear(new Date(Date.UTC(2026, 0, 1)))).toBeCloseTo(2026.0, 6);
    expect(decimalYear(new Date(Date.UTC(2026, 6, 2)))).toBeCloseTo(2026.5, 2);
  });

  it('stays finite at the poles', () => {
    const f = magneticField(90, 0, 0, 2026.0);
    expect(Number.isFinite(f.declination)).toBe(true);
    expect(Number.isFinite(f.f)).toBe(true);
  });
});
