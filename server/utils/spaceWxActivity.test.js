import { describe, expect, it } from 'vitest';
import { auroraPeak, drapMaxFreq } from './spaceWxActivity.js';

describe('auroraPeak', () => {
  it('finds the peak probability and its grid cell', () => {
    const out = auroraPeak([
      [0, 60, 5],
      [10, 65, 72],
      [20, 70, 40],
    ]);
    expect(out).toEqual({ max: 72, lat: 65, lon: 10 });
  });

  it('handles empty or malformed input', () => {
    expect(auroraPeak([]).max).toBe(0);
    expect(auroraPeak(null).max).toBe(0);
    expect(auroraPeak([[1, 2, 'x'], [3]]).max).toBe(0);
  });
});

describe('drapMaxFreq', () => {
  const text = [
    '# Product Valid At : 2026-10-14 22:55 UTC',
    '# some header',
    '   -180.0 -175.0 -170.0',
    '---------------------------',
    ' 89 |  0.4  0.4  0.5',
    ' 85 |  1.2  27.6  3.0',
    '-89 |  0.0  0.1  0.0',
  ].join('\n');

  it('returns the highest affected frequency and the valid-at stamp', () => {
    expect(drapMaxFreq(text)).toEqual({ maxFreq: 27.6, validAt: '2026-10-14 22:55 UTC' });
  });

  it('is zero for text without data rows', () => {
    expect(drapMaxFreq('# nothing\n').maxFreq).toBe(0);
    expect(drapMaxFreq(undefined).maxFreq).toBe(0);
  });
});
