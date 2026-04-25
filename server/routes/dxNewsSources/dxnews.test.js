import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import dxnews from './dxnews.js';

const { parseDxnewsHtml } = dxnews;

const fixture = readFileSync(
  join(__dirname, '../../utils/__fixtures__/dx-news/dxnews-homepage.html'),
  'latin1', // dxnews.com uses windows-1251; latin1 is safe for ASCII content
);

describe('parseDxnewsHtml', () => {
  it('returns at least one normalized item from the recorded homepage', () => {
    const items = parseDxnewsHtml(fixture);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('normalizes every item to the merged-feed shape', () => {
    const items = parseDxnewsHtml(fixture);
    const requiredKeys = ['id', 'title', 'description', 'url', 'publishDate', 'callsign', 'source', 'sourceUrl'];
    for (const item of items) {
      for (const key of requiredKeys) {
        expect(item).toHaveProperty(key);
      }
    }
  });

  it('sets source to "DXNEWS" and sourceUrl to https://dxnews.com/', () => {
    const items = parseDxnewsHtml(fixture);
    for (const item of items) {
      expect(item.source).toBe('DXNEWS');
      expect(item.sourceUrl).toBe('https://dxnews.com/');
    }
  });

  it('returns absolute URLs (starting with https://dxnews.com/)', () => {
    const items = parseDxnewsHtml(fixture);
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/dxnews\.com\//);
    }
  });

  it('returns publishDate as a parseable ISO 8601 string', () => {
    const items = parseDxnewsHtml(fixture);
    for (const item of items) {
      const d = new Date(item.publishDate);
      expect(isNaN(d.getTime())).toBe(false);
    }
  });

  it('id is dxnews:<url> for stable dedup', () => {
    const items = parseDxnewsHtml(fixture);
    for (const item of items) {
      expect(item.id).toBe(`dxnews:${item.url}`);
    }
  });

  it('returns [] for empty html', () => {
    expect(parseDxnewsHtml('')).toEqual([]);
  });

  it('returns [] for null html', () => {
    expect(parseDxnewsHtml(null)).toEqual([]);
  });
});
