import { describe, it, expect } from 'vitest';
import {
  calculateSignalMargin,
  adjustReliability,
  calculateSNR,
  getStatus,
  MODE_ADVANTAGE_DB,
  ANTENNA_PROFILES,
} from './propagationAdjust.js';

// Golden values captured from server/utils/propagationPhysics.js on 2026-04-24.
// If these diverge, the browser WASM engine and the REST endpoint will produce
// visibly different numbers in the same UI — regenerate from the server and
// update both sides together.
describe('propagationAdjust — parity with server', () => {
  it('calculateSignalMargin matches server', () => {
    expect(calculateSignalMargin('SSB', 100, 0)).toBe(0);
    expect(calculateSignalMargin('FT8', 100, 0)).toBe(34);
    expect(calculateSignalMargin('FT8', 1500, 5.5)).toBeCloseTo(51.26091259055681, 10);
    expect(calculateSignalMargin('CW', 10, -3)).toBe(-3);
    expect(calculateSignalMargin('SSB', 0.5, 0)).toBeCloseTo(-23.010299956639813, 10);
  });

  it('adjustReliability matches server', () => {
    expect(adjustReliability(50, 0)).toBe(50);
    expect(adjustReliability(50, 15)).toBe(84);
    expect(adjustReliability(50, -10)).toBe(22);
    expect(adjustReliability(99, 20)).toBe(99);
    expect(adjustReliability(0, 50)).toBe(0);
    expect(adjustReliability(20, 34)).toBe(94);
    expect(adjustReliability(80, -20)).toBe(16);
  });

  it('calculateSNR buckets match server', () => {
    expect(calculateSNR(0)).toBe('-20dB');
    expect(calculateSNR(15)).toBe('-20dB');
    expect(calculateSNR(25)).toBe('-10dB');
    expect(calculateSNR(45)).toBe('0dB');
    expect(calculateSNR(65)).toBe('+10dB');
    expect(calculateSNR(85)).toBe('+20dB');
    expect(calculateSNR(99)).toBe('+20dB');
  });

  it('getStatus buckets match server', () => {
    expect(getStatus(0)).toBe('CLOSED');
    expect(getStatus(10)).toBe('CLOSED');
    expect(getStatus(20)).toBe('POOR');
    expect(getStatus(35)).toBe('FAIR');
    expect(getStatus(55)).toBe('GOOD');
    expect(getStatus(75)).toBe('EXCELLENT');
    expect(getStatus(90)).toBe('EXCELLENT');
  });
});

describe('propagationAdjust — table exports', () => {
  it('MODE_ADVANTAGE_DB covers the common digital modes', () => {
    expect(MODE_ADVANTAGE_DB.SSB).toBe(0);
    expect(MODE_ADVANTAGE_DB.FT8).toBe(34);
    expect(MODE_ADVANTAGE_DB.WSPR).toBe(41);
  });

  it('ANTENNA_PROFILES keys match /api/propagation/antennas expectations', () => {
    expect(ANTENNA_PROFILES.isotropic).toEqual({ name: 'Isotropic', gain: 0 });
    expect(ANTENNA_PROFILES.yagi5.gain).toBe(10.5);
    expect(ANTENNA_PROFILES.loop.gain).toBe(-1.0);
  });

  it('handles unknown mode/zero-ish power the same way the server does', () => {
    expect(calculateSignalMargin('UNKNOWN_MODE', 100, 0)).toBe(0);
    // `powerWatts || 100` defaults 0 → 100W for parity with the server. The
    // 0.01W floor only kicks in when callers pass a truthy small value.
    expect(calculateSignalMargin('SSB', 0, 0)).toBe(0);
    expect(calculateSignalMargin('SSB', 0.01, 0)).toBeCloseTo(-40, 5);
  });
});
