import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ng3k from './ng3k.js';

const { fetchNg3k, reshapeDxpeditionCache, cleanDateString } = ng3k;

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

describe('cleanDateString', () => {
  it('passes through clean date strings unchanged', () => {
    expect(cleanDateString('Jan 5, 2026')).toBe('Jan 5, 2026');
    expect(cleanDateString('Jan 5-15, 2026')).toBe('Jan 5-15, 2026');
    expect(cleanDateString('Jan 5-Feb 16, 2026')).toBe('Jan 5-Feb 16, 2026');
    expect(cleanDateString('Apr 20 - May 4, 2026')).toBe('Apr 20 - May 4, 2026');
  });

  it('strips trailing parenthetical reminder noise from NG3K page', () => {
    expect(
      cleanDateString('Nov 28-29, 2026) Check here for pericontest activity too. 2027 February Feb 1-28, 2027'),
    ).toBe('Nov 28-29, 2026');
    expect(cleanDateString('Oct 24-25, 2026) Check here for pericontest activity too. November Nov 9-20, 2026')).toBe(
      'Oct 24-25, 2026',
    );
  });

  it('strips trailing Info: blocks that the legacy parser swept in', () => {
    expect(cleanDateString('Apr 21, 2026) Info: By EA2TA as 4W/EA2TA, EA3NT IZ7ATN; 80-6m; CW SSB FT8')).toBe(
      'Apr 21, 2026',
    );
  });

  it('returns "" for empty / null / undefined inputs', () => {
    expect(cleanDateString('')).toBe('');
    expect(cleanDateString(null)).toBe('');
    expect(cleanDateString(undefined)).toBe('');
  });

  it('falls back to trimmed input if leading text is not a date pattern', () => {
    expect(cleanDateString('  unrecognized  ')).toBe('unrecognized');
  });
});

describe('reshapeDxpeditionCache (description sanitization)', () => {
  it('strips contest reminder noise from the description before joining with bands/modes', () => {
    const items = reshapeDxpeditionCache({
      dxpeditions: [
        {
          callsign: '3Y0L',
          entity: 'St Peter I',
          dates: 'Nov 28-29, 2026) Check here for pericontest activity too.',
          startDate: '2026-11-28T00:00:00.000Z',
          endDate: '2026-11-29T00:00:00.000Z',
          isUpcoming: true,
          isActive: false,
          bands: '20m',
          modes: 'CW SSB',
        },
      ],
    });
    expect(items[0].description).toBe('Nov 28-29, 2026 · 20m · CW SSB');
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
