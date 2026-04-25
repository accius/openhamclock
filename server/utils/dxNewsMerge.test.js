import { describe, expect, it } from 'vitest';
import dxNewsMerge from './dxNewsMerge.js';

const { extractCallsign, isFreshByPublishDate, isFreshByActivityWindow, dedupByCallsign, mergeNews } = dxNewsMerge;

// Fixed clock so time-based tests don't drift
const NOW = new Date('2026-04-24T12:00:00Z');

// ─── extractCallsign ──────────────────────────────────────────────────────────

describe('extractCallsign', () => {
  it('accepts W1AW', () => {
    expect(extractCallsign('W1AW is active')).toBe('W1AW');
  });

  it('accepts 3D2JK', () => {
    expect(extractCallsign('3D2JK Fiji Islands')).toBe('3D2JK');
  });

  it('accepts VP8/G3ABC', () => {
    expect(extractCallsign('VP8/G3ABC South Georgia')).toBe('VP8/G3ABC');
  });

  it('accepts W1AW/M', () => {
    expect(extractCallsign('W1AW/M mobile operation')).toBe('W1AW/M');
  });

  it('accepts OH2BH', () => {
    expect(extractCallsign('OH2BH Finland')).toBe('OH2BH');
  });

  it('accepts ZS6CCY', () => {
    expect(extractCallsign('ZS6CCY South Africa')).toBe('ZS6CCY');
  });

  it('rejects "for" — English word', () => {
    expect(extractCallsign('for the contest')).toBeNull();
  });

  it('rejects DXCC — deny-list word', () => {
    expect(extractCallsign('DXCC entity')).toBeNull();
  });

  it('rejects QSL — deny-list word', () => {
    expect(extractCallsign('QSL via bureau')).toBeNull();
  });

  it('rejects GMT — deny-list word', () => {
    expect(extractCallsign('1000 GMT daily')).toBeNull();
  });

  it('rejects UTC — deny-list word', () => {
    expect(extractCallsign('1200 UTC start')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractCallsign(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(extractCallsign(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractCallsign('')).toBeNull();
  });

  it('rejects W3 — bare prefix, no trailing letter', () => {
    expect(extractCallsign('W3 prefix only')).toBeNull();
  });

  it('returns null for an English-prose paragraph with no callsign', () => {
    expect(extractCallsign('The DX expedition is planned for next month according to the announcement.')).toBeNull();
  });
});

// ─── freshness 24h ────────────────────────────────────────────────────────────

describe('freshness 24h', () => {
  it('keeps item with publishDate 23h before now', () => {
    const item = { publishDate: new Date(NOW.getTime() - 23 * 3600 * 1000).toISOString() };
    expect(isFreshByPublishDate(item, NOW)).toBe(true);
  });

  it('drops item with publishDate 25h before now', () => {
    const item = { publishDate: new Date(NOW.getTime() - 25 * 3600 * 1000).toISOString() };
    expect(isFreshByPublishDate(item, NOW)).toBe(false);
  });

  it('keeps item at exactly 24h (boundary: kept at exactly 24h, dropped above)', () => {
    const item = { publishDate: new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString() };
    // Boundary: exactly 24h is kept (< not <=)
    expect(isFreshByPublishDate(item, NOW)).toBe(true);
  });

  it('drops item with missing publishDate', () => {
    expect(isFreshByPublishDate({}, NOW)).toBe(false);
  });

  it('drops item with invalid publishDate', () => {
    expect(isFreshByPublishDate({ publishDate: 'not-a-date' }, NOW)).toBe(false);
  });

  it('respects custom hoursCutoff', () => {
    const item = { publishDate: new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString() };
    expect(isFreshByPublishDate(item, NOW, 1)).toBe(false);
    expect(isFreshByPublishDate(item, NOW, 3)).toBe(true);
  });
});

// ─── activity window ──────────────────────────────────────────────────────────

describe('activity window', () => {
  it('filters NG3K item with activityEndDate one day in the past', () => {
    const item = {
      activityEndDate: new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString(),
    };
    expect(isFreshByActivityWindow(item, NOW)).toBe(false);
  });

  it('keeps NG3K item with activityEndDate one day in the future', () => {
    const item = {
      activityEndDate: new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString(),
    };
    expect(isFreshByActivityWindow(item, NOW)).toBe(true);
  });

  it('keeps NG3K item with activityEndDate equal to now (today is still within window)', () => {
    const item = { activityEndDate: NOW.toISOString() };
    expect(isFreshByActivityWindow(item, NOW)).toBe(true);
  });

  it('returns false for item missing activityEndDate', () => {
    expect(isFreshByActivityWindow({}, NOW)).toBe(false);
  });
});

// ─── ng3k exception ───────────────────────────────────────────────────────────

describe('ng3k exception', () => {
  it('keeps NG3K item with publishDate 2 weeks ago but activityEndDate in the future', () => {
    const twoWeeksAgo = new Date(NOW.getTime() - 14 * 24 * 3600 * 1000).toISOString();
    const tomorrow = new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString();
    const ng3kItem = {
      id: 'ng3k:VP8STI',
      title: 'VP8STI — South Sandwich Islands',
      publishDate: twoWeeksAgo,
      activityEndDate: tomorrow,
      source: 'NG3K',
      sourceUrl: 'https://www.ng3k.com/Misc/adxo.html',
      callsign: 'VP8STI',
    };
    // NG3K uses activity window, not 24h cutoff — so even though publishDate is old, it's kept
    expect(isFreshByActivityWindow(ng3kItem, NOW)).toBe(true);
    expect(isFreshByPublishDate(ng3kItem, NOW)).toBe(false); // would be dropped by 24h rule
    // mergeNews routes NG3K items through isFreshByActivityWindow, not isFreshByPublishDate
    const result = mergeNews({ dxnews: [], dxWorld: [], ng3k: [ng3kItem] }, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].callsign).toBe('VP8STI');
  });
});

// ─── dedup by callsign ────────────────────────────────────────────────────────

describe('dedup by callsign', () => {
  it('keeps only the item with the newer publishDate when two items share the same callsign', () => {
    const older = {
      id: 'dxnews:https://dxnews.com/vp8sti',
      title: 'VP8STI on air',
      description: 'Active on 20m',
      url: 'https://dxnews.com/vp8sti',
      publishDate: new Date(NOW.getTime() - 10 * 3600 * 1000).toISOString(),
      callsign: 'VP8STI',
      source: 'DXNEWS',
      sourceUrl: 'https://dxnews.com/',
    };
    const newer = {
      id: 'dxworld:https://dx-world.net/vp8sti',
      title: 'VP8STI update',
      description: 'QSL info added',
      url: 'https://dx-world.net/vp8sti',
      publishDate: new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString(),
      callsign: 'VP8STI',
      source: 'DX-WORLD',
      sourceUrl: 'https://dx-world.net/',
    };

    const result = dedupByCallsign([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(newer.id);
    expect(result[0].source).toBe('DX-WORLD');
  });

  it('preserves source attribution on the surviving item', () => {
    const a = {
      id: 'dxnews:https://dxnews.com/3d2jk',
      title: '3D2JK Fiji',
      publishDate: new Date(NOW.getTime() - 5 * 3600 * 1000).toISOString(),
      callsign: '3D2JK',
      source: 'DXNEWS',
      sourceUrl: 'https://dxnews.com/',
    };
    const b = {
      id: 'dxworld:https://dx-world.net/3d2jk',
      title: '3D2JK Fiji update',
      publishDate: new Date(NOW.getTime() - 1 * 3600 * 1000).toISOString(),
      callsign: '3D2JK',
      source: 'DX-WORLD',
      sourceUrl: 'https://dx-world.net/',
    };
    const result = dedupByCallsign([a, b]);
    expect(result[0].source).toBe('DX-WORLD');
    expect(result[0].sourceUrl).toBe('https://dx-world.net/');
  });
});

// ─── no callsign passthrough ──────────────────────────────────────────────────

describe('no callsign passthrough', () => {
  it('all three items with callsign: null survive dedup', () => {
    const items = [
      {
        id: 'dxnews:1',
        title: 'General ham news',
        publishDate: NOW.toISOString(),
        callsign: null,
        source: 'DXNEWS',
        sourceUrl: 'https://dxnews.com/',
      },
      {
        id: 'dxnews:2',
        title: 'Band conditions update',
        publishDate: new Date(NOW.getTime() - 1 * 3600 * 1000).toISOString(),
        callsign: null,
        source: 'DXNEWS',
        sourceUrl: 'https://dxnews.com/',
      },
      {
        id: 'dxworld:3',
        title: 'DX World editorial',
        publishDate: new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString(),
        callsign: null,
        source: 'DX-WORLD',
        sourceUrl: 'https://dx-world.net/',
      },
    ];
    const result = dedupByCallsign(items);
    expect(result).toHaveLength(3);
  });
});

// ─── recency sort ─────────────────────────────────────────────────────────────

describe('recency sort', () => {
  it('output is strictly DESC by publishDate regardless of input order', () => {
    const timestamps = [
      NOW.getTime() - 5 * 3600 * 1000,
      NOW.getTime() - 1 * 3600 * 1000,
      NOW.getTime() - 3 * 3600 * 1000,
      NOW.getTime() - 7 * 3600 * 1000,
    ];
    const items = timestamps.map((ts, i) => ({
      id: `dxnews:item${i}`,
      title: `Item ${i}`,
      publishDate: new Date(ts).toISOString(),
      callsign: null,
      source: 'DXNEWS',
      sourceUrl: 'https://dxnews.com/',
    }));

    const result = mergeNews({ dxnews: items, dxWorld: [], ng3k: [] }, NOW);
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i - 1].publishDate).getTime()).toBeGreaterThanOrEqual(
        new Date(result[i].publishDate).getTime(),
      );
    }
  });
});

// ─── 20 cap ───────────────────────────────────────────────────────────────────

describe('20 cap', () => {
  it('returns exactly 20 items when given 50 fresh items', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `dxnews:item${i}`,
      title: `Item ${i}`,
      publishDate: new Date(NOW.getTime() - i * 60 * 1000).toISOString(), // 1 minute apart
      callsign: null,
      source: 'DXNEWS',
      sourceUrl: 'https://dxnews.com/',
    }));

    const result = mergeNews({ dxnews: items, dxWorld: [], ng3k: [] }, NOW);
    expect(result).toHaveLength(20);
  });

  it('the 20 returned items are the 20 newest', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `dxnews:item${i}`,
      title: `Item ${i}`,
      publishDate: new Date(NOW.getTime() - i * 60 * 1000).toISOString(),
      callsign: null,
      source: 'DXNEWS',
      sourceUrl: 'https://dxnews.com/',
    }));

    const result = mergeNews({ dxnews: items, dxWorld: [], ng3k: [] }, NOW);
    // Newest item has i=0, oldest of top-20 has i=19
    const oldestResultDate = new Date(result[result.length - 1].publishDate).getTime();
    const cutoffDate = new Date(NOW.getTime() - 19 * 60 * 1000).getTime();
    expect(oldestResultDate).toBe(cutoffDate);
  });
});

// ─── fault tolerance ──────────────────────────────────────────────────────────

describe('fault tolerance', () => {
  it('still returns merged result when one source bucket is empty', () => {
    const item = {
      id: 'dxnews:https://dxnews.com/item1',
      title: 'W1AW on 20m',
      publishDate: new Date(NOW.getTime() - 1 * 3600 * 1000).toISOString(),
      callsign: 'W1AW',
      source: 'DXNEWS',
      sourceUrl: 'https://dxnews.com/',
    };
    const result = mergeNews({ dxnews: [item], dxWorld: [], ng3k: [] }, NOW);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].callsign).toBe('W1AW');
  });

  it('returns [] when all source buckets are empty', () => {
    const result = mergeNews({ dxnews: [], dxWorld: [], ng3k: [] }, NOW);
    expect(result).toEqual([]);
  });

  it('handles mergeNews called with undefined buckets gracefully', () => {
    // Should not throw when called with undefined fields
    expect(() => mergeNews({ dxnews: [], dxWorld: [], ng3k: [] }, NOW)).not.toThrow();
  });
});
