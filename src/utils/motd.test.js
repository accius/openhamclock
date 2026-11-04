import { describe, it, expect, beforeEach } from 'vitest';
import { linkifyMotd, shouldShowMotd, getDismissedMotdId, setDismissedMotdId } from './motd.js';

describe('motd', () => {
  beforeEach(() => localStorage.clear());

  it('linkifies bare URLs and keeps trailing punctuation as text', () => {
    expect(linkifyMotd('Down 0200z, see https://example.com/status. 73!')).toEqual([
      { text: 'Down 0200z, see ' },
      { url: 'https://example.com/status' },
      { text: '. 73!' },
    ]);
  });

  it('returns a single text segment when there are no links', () => {
    expect(linkifyMotd('Plain message')).toEqual([{ text: 'Plain message' }]);
    expect(linkifyMotd('')).toEqual([]);
    expect(linkifyMotd(null)).toEqual([]);
  });

  it('handles multiple links and non-http schemes', () => {
    const segs = linkifyMotd('a http://x.io b https://y.io/c ftp://z');
    expect(segs.filter((s) => s.url).map((s) => s.url)).toEqual(['http://x.io', 'https://y.io/c']);
  });

  it('shouldShowMotd respects text, id, and the dismissed id', () => {
    expect(shouldShowMotd({ text: 'hi', id: 'a1' })).toBe(true);
    expect(shouldShowMotd({ text: '', id: 'a1' })).toBe(false);
    expect(shouldShowMotd({ text: 'hi', id: null })).toBe(false);
    expect(shouldShowMotd(null)).toBe(false);
    setDismissedMotdId('a1');
    expect(getDismissedMotdId()).toBe('a1');
    expect(shouldShowMotd({ text: 'hi', id: 'a1' })).toBe(false);
    expect(shouldShowMotd({ text: 'hi', id: 'b2' })).toBe(true);
  });
});
