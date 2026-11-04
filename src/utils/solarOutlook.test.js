import { describe, expect, it } from 'vitest';
import { describeOutlook, kpCategory, outlookForRange, utcDay } from './solarOutlook.js';

const days = [
  { date: '2026-10-12', sfi: 120, ap: 16, kp: 4 },
  { date: '2026-10-13', sfi: 115, ap: 28, kp: 5 },
  { date: '2026-10-14', sfi: 110, ap: 14, kp: 3 },
  { date: '2026-10-15', sfi: 105, ap: 8, kp: 3 },
  { date: '2026-10-16', sfi: 100, ap: 5, kp: 2 },
  { date: '2026-10-17', sfi: 95, ap: 5, kp: 2 },
];

describe('kpCategory', () => {
  it('maps Kp to NOAA-style categories', () => {
    expect(kpCategory(0)).toBe('quiet');
    expect(kpCategory(2)).toBe('quiet');
    expect(kpCategory(3)).toBe('unsettled');
    expect(kpCategory(4)).toBe('active');
    expect(kpCategory(5)).toBe('storm');
    expect(kpCategory(9)).toBe('storm');
    expect(kpCategory('x')).toBeNull();
  });
});

describe('outlookForRange', () => {
  it('uses UTC calendar days and reports the worst Kp of the range', () => {
    const r = outlookForRange(days, '2026-10-16T23:30:00Z', '2026-10-17T23:59:00Z');
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-16', '2026-10-17']);
    expect(r.maxKp).toBe(2);
    expect(r.category).toBe('quiet');
    expect(r.minSfi).toBe(95);
    expect(r.maxSfi).toBe(100);
  });

  it('flags a storm when any day in a weekend contest is Kp 5', () => {
    const r = outlookForRange(days, '2026-10-12T00:00:00Z', '2026-10-13T23:59:59Z');
    expect(r.category).toBe('storm');
    expect(r.maxAp).toBe(28);
  });

  it('returns null outside the outlook window or without data', () => {
    expect(outlookForRange(days, '2026-12-01T00:00:00Z')).toBeNull();
    expect(outlookForRange([], '2026-10-12T00:00:00Z')).toBeNull();
    expect(outlookForRange(days, 'not a date')).toBeNull();
  });

  it('defaults end to start', () => {
    expect(outlookForRange(days, '2026-10-14T12:00:00Z').days).toHaveLength(1);
  });
});

describe('describeOutlook / utcDay', () => {
  it('builds a compact tooltip', () => {
    const r = outlookForRange(days, '2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z');
    expect(describeOutlook(r, '2026-10-12T03:45:00Z')).toBe(
      'SWPC 27-day outlook: max Kp 5 (Storm) · SFI 115–120 · issued 2026-10-12',
    );
    expect(describeOutlook(null)).toBe('');
  });
  it('utcDay tolerates bad input', () => {
    expect(utcDay('2026-10-12T23:59:59Z')).toBe('2026-10-12');
    expect(utcDay('nope')).toBeNull();
  });
});
