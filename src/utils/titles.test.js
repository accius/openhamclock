import { describe, it, expect } from 'vitest';
import { parseTitles, titlesError, pickTitle, resolveCallsignBox, ROTATE_MS } from './titles.js';

describe('parseTitles', () => {
  it('splits on ; and trims', () => {
    expect(parseTitles(' Field Day ; W1AW ;; 73 ')).toEqual(['Field Day', 'W1AW', '73']);
  });
  it('caps at six and 60 chars', () => {
    expect(parseTitles('1;2;3;4;5;6;7;8')).toHaveLength(6);
    expect(parseTitles('x'.repeat(100))[0]).toHaveLength(60);
  });
  it('handles empty / non-string', () => {
    expect(parseTitles('')).toEqual([]);
    expect(parseTitles(null)).toEqual([]);
  });
});

describe('titlesError', () => {
  it('flags too many or too long', () => {
    expect(titlesError('a;b;c;d;e;f')).toBe(null);
    expect(titlesError('a;b;c;d;e;f;g')).toBe('tooMany');
    expect(titlesError('y'.repeat(61))).toBe('tooLong');
    expect(titlesError('')).toBe(null);
  });
});

describe('pickTitle', () => {
  it('rotates every 10 s on a shared clock', () => {
    const titles = ['A', 'B', 'C'];
    expect(pickTitle(titles, 0)).toBe('A');
    expect(pickTitle(titles, ROTATE_MS - 1)).toBe('A');
    expect(pickTitle(titles, ROTATE_MS)).toBe('B');
    expect(pickTitle(titles, 2 * ROTATE_MS)).toBe('C');
    expect(pickTitle(titles, 3 * ROTATE_MS)).toBe('A');
  });
  it('returns null for no titles', () => {
    expect(pickTitle([], 0)).toBe(null);
  });
});

describe('resolveCallsignBox', () => {
  it('shows the callsign when nothing is configured', () => {
    expect(resolveCallsignBox('K0CJH', '', null, 0)).toEqual({ text: 'K0CJH', fg: null, bg: null, isTitle: false });
  });
  it('shows configured titles', () => {
    expect(resolveCallsignBox('K0CJH', 'Hello;World', null, ROTATE_MS).text).toBe('World');
  });
  it('override text wins and carries colours', () => {
    const r = resolveCallsignBox('K0CJH', 'Hello', { text: 'Remote', fg: '#fff', bg: 'red' }, 0);
    expect(r).toEqual({ text: 'Remote', fg: '#fff', bg: 'red', isTitle: true });
  });
  it('override with null text falls back to configured titles but keeps colours', () => {
    const r = resolveCallsignBox('K0CJH', 'Hello', { text: null, fg: '#0f0' }, 0);
    expect(r.text).toBe('Hello');
    expect(r.fg).toBe('#0f0');
  });
});
