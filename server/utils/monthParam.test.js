import { describe, it, expect } from 'vitest';
import { parseMonthParam } from './monthParam.js';

describe('parseMonthParam', () => {
  it('accepts integers 1–12', () => {
    expect(parseMonthParam('1', 10)).toBe(1);
    expect(parseMonthParam('12', 10)).toBe(12);
    expect(parseMonthParam(' 7 ', 10)).toBe(7);
    expect(parseMonthParam('03', 10)).toBe(3);
  });

  it('falls back to the current month for anything else', () => {
    for (const v of [undefined, null, '', '0', '13', '1.5', '-1', 'jan', '100', ['5'], 5]) {
      expect(parseMonthParam(v, 10)).toBe(10);
    }
  });
});
