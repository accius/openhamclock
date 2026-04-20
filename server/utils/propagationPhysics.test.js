/**
 * Regression tests for the built-in HF propagation model.
 *
 * These tests encode physically-motivated expectations that a fallback
 * model must satisfy — primarily the kind of "this is green when the band
 * is actually dead" mis-predictions that issue #887 was about. Tests check
 * status buckets (CLOSED / POOR / FAIR / GOOD / EXCELLENT) rather than exact
 * reliability numbers so that calibration tweaks don't thrash the suite.
 */

import { describe, expect, it } from 'vitest';

import {
  calculateDLayerAbsorption,
  calculateMUF,
  calculateSignalMargin,
  calculateEnhancedReliability,
  getStatus,
  solarDeclinationDeg,
  cosSolarZenith,
} from './propagationPhysics.js';

// Scenario path midpoints — representative paths we care about
const US_EU = { distance: 7000, midLat: 42, midLon: -42 }; // Atlanta → London
const US_CONUS = { distance: 4000, midLat: 40, midLon: -98 }; // Atlanta → San Francisco
const NVIS = { distance: 500, midLat: 40, midLon: -84 }; // Atlanta regional
const PACIFIC_DX = { distance: 12000, midLat: 25, midLon: -170 }; // US → Australia

// US noon in UTC ≈ 17-18 depending on latitude
const US_NOON_UTC = 17;
const US_NIGHT_UTC = 5;

describe('solarDeclinationDeg', () => {
  // The approximation uses integer months; exact equinoxes fall on the 21st
  // so months 3 and 9 sit ~3 weeks before equinox (declination ≈ -9° / +9°).
  it('crosses zero between March and April and between September and October', () => {
    expect(solarDeclinationDeg(3)).toBeLessThan(0);
    expect(solarDeclinationDeg(4)).toBeGreaterThan(0);
    expect(solarDeclinationDeg(9)).toBeGreaterThan(0);
    expect(solarDeclinationDeg(10)).toBeLessThan(0);
  });

  it('returns positive maximum in June', () => {
    expect(solarDeclinationDeg(6)).toBeGreaterThan(20);
  });

  it('returns negative minimum in December', () => {
    expect(solarDeclinationDeg(12)).toBeLessThan(-20);
  });

  it('returns 0 for invalid input', () => {
    expect(solarDeclinationDeg(0)).toBe(0);
    expect(solarDeclinationDeg(undefined)).toBe(0);
  });
});

describe('cosSolarZenith', () => {
  it('is 0 at midnight local', () => {
    // Midnight local at midLon 0: UTC midnight
    expect(cosSolarZenith(0, 0, 0, 3)).toBe(0);
  });

  it('is near 1 at equator noon on the equinox', () => {
    expect(cosSolarZenith(0, 0, 12, 3)).toBeGreaterThan(0.95);
  });

  it('is lower at high latitudes at noon', () => {
    const equator = cosSolarZenith(0, 0, 12, 3);
    const highLat = cosSolarZenith(60, 0, 12, 3);
    expect(highLat).toBeLessThan(equator);
  });
});

describe('calculateDLayerAbsorption', () => {
  it('returns 0 at night', () => {
    const abs = calculateDLayerAbsorption(3.65, 3500, 45, 0, 0, 150);
    expect(abs).toBe(0);
  });

  it('heavily absorbs 160m at midday', () => {
    const abs = calculateDLayerAbsorption(1.85, 3500, 45, 0, 12, 150);
    expect(abs).toBeGreaterThan(40);
  });

  it('lightly absorbs 20m at midday', () => {
    const abs = calculateDLayerAbsorption(14.2, 3500, 45, 0, 12, 150);
    expect(abs).toBeLessThan(8);
  });

  it('applies roughly inverse-square dependence on frequency', () => {
    const abs80 = calculateDLayerAbsorption(3.65, 3500, 45, 0, 12, 150);
    const abs40 = calculateDLayerAbsorption(7.1, 3500, 45, 0, 12, 150);
    // Freq doubled — absorption should be ~4× lower (actually (7.7/4.25)² = 3.3×
    // because of the gyrofrequency offset, so we check for a 2-5x ratio)
    const ratio = abs80 / abs40;
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(6);
  });

  it('compounds with hops', () => {
    const single = calculateDLayerAbsorption(7.1, 3000, 45, 0, 12, 150);
    const double = calculateDLayerAbsorption(7.1, 6000, 45, 0, 12, 150);
    // 6000 km is 2 hops; absorption roughly doubles (exact secφ differs slightly)
    expect(double / single).toBeGreaterThan(1.5);
    expect(double / single).toBeLessThan(3);
  });
});

describe('calculateMUF', () => {
  it('rises during the day and drops at night', () => {
    const dayMuf = calculateMUF(3500, 40, 0, 12, 150, 100);
    const nightMuf = calculateMUF(3500, 40, 0, 0, 150, 100);
    expect(dayMuf).toBeGreaterThan(nightMuf);
  });

  it('rises with solar flux', () => {
    const lowSfi = calculateMUF(3500, 40, 0, 12, 70, 100);
    const highSfi = calculateMUF(3500, 40, 0, 12, 200, 100);
    expect(highSfi).toBeGreaterThan(lowSfi);
  });

  it('produces reasonable values for mid-latitude daytime paths', () => {
    const muf = calculateMUF(3500, 40, 0, 12, 150, 100);
    // Realistic: SFI 150 midday 3500km should yield 20-28 MHz MUF
    expect(muf).toBeGreaterThan(15);
    expect(muf).toBeLessThan(35);
  });
});

describe('calculateSignalMargin', () => {
  it('is 0 for SSB / 100W / isotropic (the reference)', () => {
    expect(calculateSignalMargin('SSB', 100, 0)).toBe(0);
  });

  it('adds ~10 dB for each 10x power increase', () => {
    expect(calculateSignalMargin('SSB', 1000, 0)).toBeCloseTo(10, 1);
    expect(calculateSignalMargin('SSB', 10, 0)).toBeCloseTo(-10, 1);
  });

  it('gives FT8 a 34 dB advantage over SSB', () => {
    expect(calculateSignalMargin('FT8', 100, 0) - calculateSignalMargin('SSB', 100, 0)).toBe(34);
  });

  it('adds antenna gain linearly in dB', () => {
    expect(calculateSignalMargin('SSB', 100, 8)).toBe(8);
  });

  it('combines mode + power + antenna', () => {
    // FT8 + 1kW + 8 dBi Yagi = 34 + 10 + 8 = 52
    expect(calculateSignalMargin('FT8', 1000, 8)).toBeCloseTo(52, 1);
  });
});

// Shared helpers for reliability assertions
const rel = (freq, path, hour, sfi, kIndex, margin, month = 4) =>
  calculateEnhancedReliability(
    freq,
    path.distance,
    path.midLat,
    path.midLon,
    hour,
    sfi,
    100,
    kIndex,
    null,
    null,
    hour,
    margin,
    month,
  );

describe('calculateEnhancedReliability — issue #887 regressions', () => {
  it('40m US→EU midday with 100W SSB dipole is NOT green (#887 primary bug)', () => {
    const r = rel(7.1, US_EU, US_NOON_UTC, 120, 1, 2);
    // Old model: ~68% GOOD (false positive). Must be POOR or worse.
    expect(r).toBeLessThan(30);
  });

  it('40m US→EU midday with FT8 + 1kW + Yagi IS green (big station can punch through)', () => {
    const r = rel(7.1, US_EU, US_NOON_UTC, 120, 1, 52);
    expect(r).toBeGreaterThanOrEqual(50);
  });

  it('80m US→EU midday is CLOSED for typical stations (#887 secondary)', () => {
    const r = rel(3.65, US_EU, US_NOON_UTC, 120, 1, 2);
    expect(r).toBeLessThan(15);
  });

  it('80m US→EU midday is still bad even with FT8 + 1kW + Yagi (D-layer physics wins)', () => {
    const r = rel(3.65, US_EU, US_NOON_UTC, 120, 1, 52);
    expect(r).toBeLessThan(30);
  });

  it('40m transcontinental US midday SSB is not green (another #887 pattern)', () => {
    const r = rel(7.1, US_CONUS, 19, 120, 1, 2);
    expect(r).toBeLessThan(40);
  });
});

describe('calculateEnhancedReliability — positive scenarios (model must still work)', () => {
  it('40m NVIS noon 500km with 100W SSB dipole is usable', () => {
    const r = rel(7.1, NVIS, 18, 120, 1, 2);
    expect(getStatus(r)).toMatch(/FAIR|GOOD|EXCELLENT/);
  });

  it('20m US→EU midday with 100W SSB is green', () => {
    const r = rel(14.2, US_EU, US_NOON_UTC, 120, 1, 2);
    expect(r).toBeGreaterThanOrEqual(50);
  });

  it('80m at night gives good DX', () => {
    const r = rel(3.65, US_EU, US_NIGHT_UTC, 120, 1, 2);
    expect(r).toBeGreaterThanOrEqual(40);
  });

  it('160m at night on a 5000 km path is at least marginal', () => {
    const r = rel(1.85, { distance: 5000, midLat: 45, midLon: -30 }, 3, 120, 1, 2);
    expect(r).toBeGreaterThan(15); // not CLOSED
  });

  it('10m at solar min midday is essentially closed', () => {
    const r = rel(28.4, US_EU, US_NOON_UTC, 70, 1, 2);
    expect(r).toBeLessThan(15);
  });
});

describe('calculateEnhancedReliability — geomagnetic and polar effects', () => {
  it('severe K=7 storm kills reliability on a normally-open band', () => {
    const quiet = rel(14.2, US_EU, US_NOON_UTC, 120, 1, 2);
    const stormy = rel(14.2, US_EU, US_NOON_UTC, 120, 7, 2);
    expect(stormy).toBeLessThan(quiet * 0.3);
  });

  it('polar path gets an extra penalty', () => {
    const polarPath = { distance: 7000, midLat: 80, midLon: 0 };
    const normalPath = { distance: 7000, midLat: 40, midLon: 0 };
    const polarRel = rel(14.2, polarPath, 12, 120, 1, 2);
    const normalRel = rel(14.2, normalPath, 12, 120, 1, 2);
    expect(polarRel).toBeLessThan(normalRel);
  });

  it('polar path + storm compounds more harshly than either alone', () => {
    const polarPath = { distance: 7000, midLat: 80, midLon: 0 };
    const quiet = rel(14.2, polarPath, 12, 120, 1, 2);
    const stormy = rel(14.2, polarPath, 12, 120, 5, 2);
    expect(stormy).toBeLessThanOrEqual(quiet * 0.6);
  });
});

describe('calculateEnhancedReliability — signal margin no longer "breaks physics"', () => {
  it('extreme signal margin cannot make 160m daylight DX look green', () => {
    // Previously a Yagi + FT8 + 1 kW would stretch effective LUF to 10% of real
    // and push 160m into the usable window. Physics says: no.
    const r = rel(1.85, US_EU, US_NOON_UTC, 120, 1, 52);
    expect(r).toBeLessThan(20);
  });

  it('antenna gain improves marginal paths but cannot overcome heavy absorption', () => {
    const dipole = rel(3.65, US_EU, US_NOON_UTC, 120, 1, 2);
    const yagi = rel(3.65, US_EU, US_NOON_UTC, 120, 1, 10); // +8 dB gain
    // Yagi helps, but both should remain non-green on 80m midday US→EU
    expect(yagi).toBeGreaterThanOrEqual(dipole);
    expect(yagi).toBeLessThan(40);
  });
});

describe('calculateEnhancedReliability — no edge-case crashes', () => {
  it('handles zero distance gracefully', () => {
    const r = rel(14.2, { distance: 0, midLat: 40, midLon: 0 }, 12, 120, 1, 0);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(99);
  });

  it('handles zero / missing signal margin', () => {
    const r = rel(14.2, US_EU, US_NOON_UTC, 120, 1, 0);
    expect(Number.isFinite(r)).toBe(true);
  });

  it('handles very low SFI (solar minimum)', () => {
    const r = rel(14.2, US_EU, US_NOON_UTC, 65, 1, 0);
    expect(Number.isFinite(r)).toBe(true);
  });

  it('handles very high SFI (solar maximum)', () => {
    const r = rel(28.4, US_EU, US_NOON_UTC, 250, 1, 2);
    expect(Number.isFinite(r)).toBe(true);
  });

  it('handles very long paths (antipodal)', () => {
    const r = rel(14.2, { distance: 19000, midLat: 0, midLon: 90 }, 12, 120, 1, 2);
    expect(Number.isFinite(r)).toBe(true);
  });

  it('handles frequency above MUF gracefully', () => {
    // 50 MHz — way above MUF
    const r = rel(50, US_EU, US_NOON_UTC, 120, 1, 2);
    expect(r).toBeLessThan(15);
  });
});
