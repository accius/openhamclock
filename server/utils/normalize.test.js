import { describe, expect, it } from 'vitest';
import { normalizeNumber, normalizeJsonTree } from './normalize.js';

describe('normalizeNumber', () => {
  it('should return a number if input is a valid number string', () => {
    expect(normalizeNumber('1')).toBe(1);
    expect(normalizeNumber('2.5')).toBe(2.5);
    expect(normalizeNumber('-1.2E-7')).toBe(-1.2e-7);
    expect(normalizeNumber('.00000001')).toBe(1e-8);
    expect(normalizeNumber('hello')).toBe('hello');
    expect(normalizeNumber(1)).toBe(1);
  });
});

describe('normalizeJsonTree', () => {
  it('should normalize a JSON tree', () => {
    const input = { a: '1', b: '2.5', c: '-1e-7', d: '.00000001', e: 'hello' };
    const expected = { a: 1, b: 2.5, c: -1e-7, d: 1e-8, e: 'hello' };
    expect(normalizeJsonTree(input)).toEqual(expected);
  });
});
