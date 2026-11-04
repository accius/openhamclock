import { describe, expect, it } from 'vitest';
import { interpretDst, dstTrend, dstMinimum } from './dst.js';

describe('interpretDst', () => {
  it('classifies the HamClock-style bands', () => {
    expect(interpretDst(0).label).toBe('Quiet');
    expect(interpretDst(-9).label).toBe('Quiet');
    expect(interpretDst(-11).label).toBe('Unsettled');
    expect(interpretDst(-35).label).toBe('Minor storm');
    expect(interpretDst(-75).label).toBe('Moderate storm');
    expect(interpretDst(-150).label).toBe('Intense storm');
    expect(interpretDst(-400).label).toBe('Super storm');
    expect(interpretDst(25).label).toBe('Compressed');
  });

  it('handles missing values', () => {
    expect(interpretDst(null).label).toBe('—');
    expect(interpretDst(NaN).text).toMatch(/unavailable/);
  });
});

describe('dstTrend', () => {
  const h = 3600e3;
  it('reports rising / falling / steady over the window', () => {
    const t0 = Date.UTC(2026, 9, 10);
    const falling = [0, -20, -45, -70].map((dst, i) => ({ t: t0 + i * h, dst }));
    const rising = [-70, -60, -45, -30].map((dst, i) => ({ t: t0 + i * h, dst }));
    const steady = [-10, -12, -9, -11].map((dst, i) => ({ t: t0 + i * h, dst }));
    expect(dstTrend(falling)).toBe('falling');
    expect(dstTrend(rising)).toBe('rising');
    expect(dstTrend(steady)).toBe('steady');
    expect(dstTrend([])).toBeNull();
  });
});

describe('dstMinimum', () => {
  it('finds the storm minimum', () => {
    const series = [
      { t: 1, dst: -5 },
      { t: 2, dst: -95 },
      { t: 3, dst: -40 },
    ];
    expect(dstMinimum(series)).toEqual({ t: 2, dst: -95 });
    expect(dstMinimum([])).toBeNull();
  });
});
