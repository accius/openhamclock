import { describe, expect, it } from 'vitest';

const { resolveHeatmapTime, solarForDate, ssnFromSfi } = require('./heatmapTime.js');

const NOW = Date.parse('2026-10-29T18:47:00Z');

describe('resolveHeatmapTime', () => {
  it('uses now without `at`', () => {
    expect(resolveHeatmapTime(undefined, NOW)).toEqual({ hour: 18, month: 10, dateKey: '2026-10-29', shifted: false });
  });

  it('uses the UTC hour, month and date of a valid `at`', () => {
    expect(resolveHeatmapTime('2026-10-30T03:00:00.000Z', NOW)).toEqual({
      hour: 3,
      month: 10,
      dateKey: '2026-10-30',
      shifted: true,
    });
  });

  it('crosses into the next month', () => {
    expect(resolveHeatmapTime('2026-11-04T14:00:00Z', NOW)).toMatchObject({
      hour: 14,
      month: 11,
      dateKey: '2026-11-04',
    });
  });

  it('falls back to now for invalid or out-of-range times', () => {
    for (const at of ['nonsense', '', '2026-12-31T00:00:00Z', '2026-09-01T00:00:00Z']) {
      expect(resolveHeatmapTime(at, NOW)).toMatchObject({ hour: 18, month: 10, shifted: false });
    }
  });
});

describe('solarForDate', () => {
  const live = { sfi: 93, ssn: 27, kIndex: 1.33 };
  const outlook = {
    days: [
      { date: '2026-10-29', sfi: 95, ap: 5, kp: 2 },
      { date: '2026-11-03', sfi: 120, ap: 16, kp: 4 },
    ],
  };

  it('uses the forecast for a future day the outlook covers', () => {
    expect(solarForDate(live, outlook, '2026-11-03', '2026-10-29')).toEqual({
      sfi: 120,
      ssn: ssnFromSfi(120),
      kIndex: 4,
      source: 'forecast',
    });
  });

  it('keeps the live values for today, the past and uncovered days', () => {
    for (const dateKey of ['2026-10-29', '2026-10-20', '2026-11-20']) {
      expect(solarForDate(live, outlook, dateKey, '2026-10-29')).toEqual({ ...live, source: 'live' });
    }
  });

  it('keeps the live values without an outlook', () => {
    expect(solarForDate(live, null, '2026-11-03', '2026-10-29').source).toBe('live');
    expect(solarForDate(live, { days: [] }, '2026-11-03', '2026-10-29').source).toBe('live');
  });

  it('derives SSN from SFI like the live path', () => {
    expect(ssnFromSfi(67)).toBe(0);
    expect(ssnFromSfi(164)).toBe(100);
  });
});
