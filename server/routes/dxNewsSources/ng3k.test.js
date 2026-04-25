import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ng3k from './ng3k.js';

const { fetchNg3k, reshapeDxpeditionCache } = ng3k;

const cacheData = JSON.parse(
  readFileSync(join(__dirname, '../../utils/__fixtures__/dx-news/ng3k-cache.json'), 'utf-8'),
);

describe('reshapeDxpeditionCache', () => {
  it('returns active and upcoming entries only (drops past)', () => {
    const items = reshapeDxpeditionCache(cacheData);
    expect(items.length).toBe(2); // 3D2JK + TX9W; K4OLD past is dropped
    expect(items.find((i) => i.callsign === 'K4OLD')).toBeUndefined();
  });

  it('formats title as "CALLSIGN — entity"', () => {
    const items = reshapeDxpeditionCache(cacheData);
    expect(items.find((i) => i.callsign === '3D2JK').title).toBe('3D2JK — Yasawa Is.');
  });

  it('includes activityEndDate for D-02 freshness check', () => {
    const items = reshapeDxpeditionCache(cacheData);
    for (const item of items) {
      expect(item.activityEndDate).toBeTruthy();
      expect(isNaN(new Date(item.activityEndDate).getTime())).toBe(false);
    }
  });

  it('sets publishDate to startDate so recency-sort orders correctly (D-09)', () => {
    const items = reshapeDxpeditionCache(cacheData);
    const tx9w = items.find((i) => i.callsign === 'TX9W');
    expect(tx9w.publishDate).toBe('2026-04-20T00:00:00.000Z');
  });

  it('builds description with dates · bands · modes', () => {
    const items = reshapeDxpeditionCache(cacheData);
    const item = items.find((i) => i.callsign === '3D2JK');
    expect(item.description).toBe('May 5-15, 2026 · 160-10m · CW SSB FT8');
  });

  it('sets source to "NG3K"', () => {
    const items = reshapeDxpeditionCache(cacheData);
    for (const item of items) {
      expect(item.source).toBe('NG3K');
    }
  });

  it('sets id to "ng3k:<callsign>"', () => {
    const items = reshapeDxpeditionCache(cacheData);
    for (const item of items) {
      expect(item.id).toBe(`ng3k:${item.callsign}`);
    }
  });

  it('returns [] for null cache (cold start)', () => {
    expect(reshapeDxpeditionCache(null)).toEqual([]);
  });

  it('returns [] for undefined cache', () => {
    expect(reshapeDxpeditionCache(undefined)).toEqual([]);
  });

  it('returns [] for cache with no dxpeditions array', () => {
    expect(reshapeDxpeditionCache({})).toEqual([]);
  });
});

describe('fetchNg3k', () => {
  it('reads ctx.dxpeditionCache.data without making HTTP calls', async () => {
    const ctx = { dxpeditionCache: { data: cacheData } };
    const { items } = await fetchNg3k(ctx);
    expect(items.length).toBe(2);
  });

  it('returns empty items for cold-start ctx (no cache yet)', async () => {
    const ctx = { dxpeditionCache: { data: null } };
    const { items } = await fetchNg3k(ctx);
    expect(items).toEqual([]);
  });

  it('returns empty items when ctx has no dxpeditionCache at all', async () => {
    const { items } = await fetchNg3k({});
    expect(items).toEqual([]);
  });
});
