import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Parser from 'rss-parser';
import dxWorld from './dxWorld.js';

const { parseDxWorldFeed } = dxWorld;

const xml = readFileSync(join(__dirname, '../../utils/__fixtures__/dx-news/dx-world.rss'), 'utf-8');
const parser = new Parser();

describe('parseDxWorldFeed', () => {
  it('returns normalized items from the recorded RSS feed', async () => {
    const feed = await parser.parseString(xml);
    const items = parseDxWorldFeed(feed);
    expect(items.length).toBeGreaterThan(0);
  });

  it('every item has source "DX-WORLD" and sourceUrl https://dx-world.net/', async () => {
    const feed = await parser.parseString(xml);
    const items = parseDxWorldFeed(feed);
    for (const item of items) {
      expect(item.source).toBe('DX-WORLD');
      expect(item.sourceUrl).toBe('https://dx-world.net/');
    }
  });

  it('extracts callsigns from titles when present', async () => {
    const feed = await parser.parseString(xml);
    const items = parseDxWorldFeed(feed);
    // At least some items should have a callsign extracted (DX-World convention is callsign-at-start)
    expect(items.some((i) => i.callsign !== null)).toBe(true);
  });

  it('returns ISO 8601 publishDate for every item', async () => {
    const feed = await parser.parseString(xml);
    const items = parseDxWorldFeed(feed);
    for (const item of items) {
      expect(isNaN(new Date(item.publishDate).getTime())).toBe(false);
    }
  });

  it('id is dxworld:<guid or link> for stable dedup', async () => {
    const feed = await parser.parseString(xml);
    const items = parseDxWorldFeed(feed);
    for (const item of items) {
      expect(item.id).toMatch(/^dxworld:/);
    }
  });

  it('normalizes every item to the merged-feed shape', async () => {
    const feed = await parser.parseString(xml);
    const items = parseDxWorldFeed(feed);
    const requiredKeys = ['id', 'title', 'description', 'url', 'publishDate', 'callsign', 'source', 'sourceUrl'];
    for (const item of items) {
      for (const key of requiredKeys) {
        expect(item).toHaveProperty(key);
      }
    }
  });

  it('filters items with unparseable pubDate', () => {
    const badFeed = {
      items: [
        {
          title: 'W1AW – Test',
          guid: 'test-1',
          link: 'https://example.com/1',
          pubDate: 'not-a-date',
          contentSnippet: 'test',
        },
        {
          title: 'W2AW – Test2',
          guid: 'test-2',
          link: 'https://example.com/2',
          pubDate: 'Fri, 24 Apr 2026 16:17:05 +0000',
          contentSnippet: 'test2',
        },
      ],
    };
    const items = parseDxWorldFeed(badFeed);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('dxworld:test-2');
  });

  it('returns [] for null feed', () => {
    expect(parseDxWorldFeed(null)).toEqual([]);
  });

  it('returns [] for feed with no items', () => {
    expect(parseDxWorldFeed({ items: [] })).toEqual([]);
  });
});
