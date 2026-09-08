import { describe, it, expect } from 'vitest';
import { stationAgeMinutes, formatStationAge } from './aprsStationAge.js';

const NOW = 1_800_000_000_000;

describe('stationAgeMinutes', () => {
  it('derives age from timestamp when present (rig-bridge RF stations have no age field)', () => {
    expect(stationAgeMinutes({ timestamp: NOW - 5 * 60000 }, NOW)).toBe(5);
    expect(stationAgeMinutes({ timestamp: NOW - 90 * 60000 }, NOW)).toBe(90);
    expect(stationAgeMinutes({ timestamp: NOW - 30000 }, NOW)).toBe(0);
  });

  it('prefers a live timestamp over a frozen server age', () => {
    expect(stationAgeMinutes({ timestamp: NOW - 10 * 60000, age: 2 }, NOW)).toBe(10);
  });

  it('falls back to the server-computed age when there is no timestamp', () => {
    expect(stationAgeMinutes({ age: 7 }, NOW)).toBe(7);
    expect(stationAgeMinutes({ age: '7' }, NOW)).toBe(7);
  });

  it('never goes negative on clock skew', () => {
    expect(stationAgeMinutes({ timestamp: NOW + 60000 }, NOW)).toBe(0);
    expect(stationAgeMinutes({ age: -3 }, NOW)).toBe(0);
  });

  it('returns null when neither field is usable', () => {
    expect(stationAgeMinutes({}, NOW)).toBeNull();
    expect(stationAgeMinutes({ timestamp: 'bogus', age: undefined }, NOW)).toBeNull();
    expect(stationAgeMinutes(null, NOW)).toBeNull();
  });
});

describe('formatStationAge', () => {
  it('formats now / minutes / hours', () => {
    expect(formatStationAge(0)).toBe('now');
    expect(formatStationAge(12)).toBe('12m');
    expect(formatStationAge(59)).toBe('59m');
    expect(formatStationAge(60)).toBe('1h');
    expect(formatStationAge(150)).toBe('2h');
  });

  it('applies the suffix to m/h forms but not to "now"', () => {
    expect(formatStationAge(0, { suffix: ' ago' })).toBe('now');
    expect(formatStationAge(12, { suffix: ' ago' })).toBe('12m ago');
    expect(formatStationAge(120, { suffix: ' ago' })).toBe('2h ago');
  });

  it('never renders NaN for unknown ages (#1180)', () => {
    expect(formatStationAge(null, { suffix: ' ago' })).toBe('?');
    expect(formatStationAge(undefined)).toBe('?');
    expect(formatStationAge(NaN)).toBe('?');
  });
});
