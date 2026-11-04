import { describe, it, expect } from 'vitest';
import {
  DAY_MS,
  utcDayStart,
  sunEvents,
  stationGraylineWindows,
  intersectWindows,
  computeGraylinePlan,
  nextMutualWindow,
  formatSpan,
} from './graylinePlanner.js';

const BOULDER = { lat: 40.015, lon: -105.2705 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };
const TASHKENT = { lat: 41.3, lon: 69.3 };
const LONDON = { lat: 51.5, lon: -0.12 };
const START = Date.UTC(2026, 9, 14, 0, 0, 0); // 2026-10-14T00:00Z

describe('sunEvents', () => {
  it('produces one sunrise and one sunset per day, alternating and sorted', () => {
    const ev = sunEvents(BOULDER.lat, BOULDER.lon, START, 7);
    // scan covers days −1 … +8 → 10 days → 20 events
    expect(ev.length).toBe(20);
    for (let i = 1; i < ev.length; i++) {
      expect(ev[i].t).toBeGreaterThan(ev[i - 1].t);
      expect(ev[i].kind).not.toBe(ev[i - 1].kind);
    }
  });
  it('places Boulder sunrise/sunset at plausible UTC hours in October', () => {
    const ev = sunEvents(BOULDER.lat, BOULDER.lon, START, 1).filter((e) => e.t >= START && e.t < START + DAY_MS);
    const rise = ev.find((e) => e.kind === 'sunrise');
    const set = ev.find((e) => e.kind === 'sunset');
    // ~07:05 MDT = 13:05Z, ~18:20 MDT = 00:20Z (next day) — set wraps past midnight
    expect(new Date(rise.t).getUTCHours()).toBe(13);
    expect(new Date(set.t).getUTCHours()).toBe(0);
  });
  it('handles a station whose sunset falls past UTC midnight without duplicates or gaps', () => {
    const ev = sunEvents(BOULDER.lat, BOULDER.lon, START, 3);
    const sets = ev.filter((e) => e.kind === 'sunset');
    for (let i = 1; i < sets.length; i++) {
      const gap = sets[i].t - sets[i - 1].t;
      expect(gap).toBeGreaterThan(23 * 3_600_000);
      expect(gap).toBeLessThan(25 * 3_600_000);
    }
  });
  it('returns nothing for polar night / invalid input', () => {
    expect(sunEvents(89, 0, Date.UTC(2026, 11, 21), 2)).toEqual([]);
    expect(sunEvents(NaN, 0, START)).toEqual([]);
  });
});

describe('stationGraylineWindows', () => {
  it('builds ±margin windows clipped to the range', () => {
    const w = stationGraylineWindows(BOULDER, START, { days: 1, marginMin: 30 });
    expect(w.length).toBeGreaterThanOrEqual(2);
    for (const x of w) {
      expect(x.end - x.start).toBeLessThanOrEqual(60 * 60_000);
      expect(x.start).toBeGreaterThanOrEqual(START);
      expect(x.end).toBeLessThanOrEqual(START + DAY_MS);
      expect(['sunrise', 'sunset']).toContain(x.kind);
    }
  });
  it('is empty without a location', () => {
    expect(stationGraylineWindows(null, START)).toEqual([]);
  });
});

describe('intersectWindows', () => {
  it('overlaps sorted lists pairwise', () => {
    const a = [
      { start: 0, end: 10, kind: 'sunrise' },
      { start: 20, end: 30, kind: 'sunset' },
    ];
    const b = [
      { start: 5, end: 25, kind: 'sunset' },
      { start: 28, end: 40, kind: 'sunrise' },
    ];
    expect(intersectWindows(a, b)).toEqual([
      { start: 5, end: 10, aKind: 'sunrise', bKind: 'sunset' },
      { start: 20, end: 25, aKind: 'sunset', bKind: 'sunset' },
      { start: 28, end: 30, aKind: 'sunset', bKind: 'sunrise' },
    ]);
  });
  it('ignores touching-but-not-overlapping windows', () => {
    expect(intersectWindows([{ start: 0, end: 10 }], [{ start: 10, end: 20 }])).toEqual([]);
  });
});

describe('computeGraylinePlan', () => {
  it('finds two mutual windows a day Boulder↔Tashkent (sunset↔sunrise and sunrise↔sunset)', () => {
    const plan = computeGraylinePlan(BOULDER, TASHKENT, START, { days: 7, marginMin: 60 });
    expect(plan.mutual.length).toBeGreaterThanOrEqual(13);
    const kinds = new Set(plan.mutual.map((w) => `${w.deKind}/${w.dxKind}`));
    expect(kinds.has('sunset/sunrise')).toBe(true);
    expect(kinds.has('sunrise/sunset')).toBe(true);
    for (const w of plan.mutual) {
      expect(w.end).toBeGreaterThan(w.start);
      expect(w.durationMin).toBeGreaterThan(0);
      expect(w.durationMin).toBeLessThanOrEqual(120);
      expect(w.start).toBeGreaterThanOrEqual(START);
      expect(w.end).toBeLessThanOrEqual(plan.endMs);
    }
  });
  it('Boulder↔Tokyo never share the gray line in October (events ~3.5 h apart)', () => {
    const plan = computeGraylinePlan(BOULDER, TOKYO, START, { days: 7, marginMin: 60 });
    expect(plan.mutual).toEqual([]);
  });
  it('Boulder↔London with a tight margin has few or no overlaps (sunrises 6–7 h apart)', () => {
    const plan = computeGraylinePlan(BOULDER, LONDON, START, { days: 7, marginMin: 15 });
    expect(plan.mutual.length).toBe(0);
  });
  it('is empty without a DX location, keeps DE windows', () => {
    const plan = computeGraylinePlan(BOULDER, null, START);
    expect(plan.mutual).toEqual([]);
    expect(plan.de.length).toBeGreaterThan(0);
    expect(plan.dx).toEqual([]);
    expect(plan.days).toBe(7);
    expect(plan.marginMin).toBe(30);
  });
});

describe('nextMutualWindow / formatSpan / utcDayStart', () => {
  const mutual = [
    { start: 100, end: 200 },
    { start: 300, end: 400 },
  ];
  it('returns the open or next window', () => {
    expect(nextMutualWindow(mutual, 50)).toMatchObject({ start: 100, open: false });
    expect(nextMutualWindow(mutual, 150)).toMatchObject({ start: 100, open: true });
    expect(nextMutualWindow(mutual, 250)).toMatchObject({ start: 300, open: false });
    expect(nextMutualWindow(mutual, 500)).toBeNull();
    expect(nextMutualWindow(null, 0)).toBeNull();
  });
  it('formats spans', () => {
    expect(formatSpan(90 * 60_000)).toBe('1h 30m');
    expect(formatSpan(5 * 60_000)).toBe('5m');
    expect(formatSpan(30 * 3_600_000)).toBe('1d 6h');
  });
  it('utcDayStart floors to UTC midnight', () => {
    expect(utcDayStart(START + 5 * 3_600_000)).toBe(START);
  });
});
