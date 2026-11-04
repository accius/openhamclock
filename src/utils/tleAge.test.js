import { describe, it, expect } from 'vitest';
import { tleEpochMs, tleAgeDays, clampMaxTleAge, isTleStale, formatTleAge } from './tleAge.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');

describe('tleEpochMs', () => {
  it('parses CelesTrak-style zone-less epochs as UTC', () => {
    expect(tleEpochMs({ EPOCH: '2026-10-14T00:00:00.000000' })).toBe(Date.parse('2026-10-14T00:00:00Z'));
    expect(tleEpochMs({ EPOCH: '2026-10-14T00:00:00Z' })).toBe(Date.parse('2026-10-14T00:00:00Z'));
    expect(tleEpochMs({ EPOCH: '2026-10-14T02:00:00+02:00' })).toBe(Date.parse('2026-10-14T00:00:00Z'));
  });
  it('returns null for missing or junk', () => {
    expect(tleEpochMs(null)).toBeNull();
    expect(tleEpochMs({})).toBeNull();
    expect(tleEpochMs({ EPOCH: 'yesterday' })).toBeNull();
  });
});

describe('age and staleness', () => {
  it('computes fractional days', () => {
    expect(tleAgeDays({ EPOCH: '2026-10-11T12:00:00' }, NOW)).toBeCloseTo(3, 6);
    expect(tleAgeDays({}, NOW)).toBeNull();
  });
  it('clamps the limit', () => {
    expect(clampMaxTleAge(undefined)).toBe(7);
    expect(clampMaxTleAge(0)).toBe(7);
    expect(clampMaxTleAge(0.2)).toBe(1);
    expect(clampMaxTleAge(500)).toBe(60);
    expect(clampMaxTleAge(14)).toBe(14);
  });
  it('flags stale elements and unknown epochs', () => {
    expect(isTleStale({ EPOCH: '2026-10-11T12:00:00' }, 7, NOW)).toBe(false);
    expect(isTleStale({ EPOCH: '2026-10-01T12:00:00' }, 7, NOW)).toBe(true);
    expect(isTleStale({ EPOCH: '2026-10-01T12:00:00' }, 30, NOW)).toBe(false);
    expect(isTleStale({}, 7, NOW)).toBe(true);
  });
  it('formats ages', () => {
    expect(formatTleAge(0.5)).toBe('12h');
    expect(formatTleAge(3.26)).toBe('3.3d');
    expect(formatTleAge(-1)).toBe('0h');
    expect(formatTleAge(NaN)).toBe('?');
  });
});
