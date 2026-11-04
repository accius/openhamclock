import { describe, it, expect } from 'vitest';
import { motdId, buildLinks, cleanText } from './motd.js';

describe('motd helpers', () => {
  it('motdId is stable and changes with the text', () => {
    expect(motdId('Hello')).toBe(motdId('Hello'));
    expect(motdId('Hello')).not.toBe(motdId('Hello!'));
    expect(motdId('')).toMatch(/^[0-9a-z]+$/);
  });

  it('cleanText strips control characters, trims, and caps length', () => {
    expect(cleanText('  hi\u0007 there\r\n')).toBe('hi there');
    expect(cleanText('x'.repeat(2000)).length).toBe(1000);
    expect(cleanText(null)).toBe('');
    expect(cleanText(42)).toBe('42');
  });

  it('buildLinks finds URLs in text and keeps explicit http(s) links only', () => {
    const links = buildLinks('Maintenance tonight, see https://example.com/status. Thanks!', [
      { label: 'Forum', url: 'https://example.org/forum' },
      { label: 'Bad', url: 'javascript:alert(1)' },
      'ftp://nope.example',
    ]);
    expect(links).toEqual([
      { label: 'Forum', url: 'https://example.org/forum' },
      { label: 'https://example.com/status', url: 'https://example.com/status' },
    ]);
  });

  it('buildLinks de-duplicates and caps at five', () => {
    const text = Array.from({ length: 8 }, (_, i) => `https://e.com/${i}`).join(' ');
    const links = buildLinks(text, [{ label: 'dup', url: 'https://e.com/0' }]);
    expect(links).toHaveLength(5);
    expect(links[0]).toEqual({ label: 'dup', url: 'https://e.com/0' });
  });
});
