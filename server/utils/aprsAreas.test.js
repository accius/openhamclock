/**
 * Tests for server/utils/aprsAreas.js — viewer areas and the union
 * APRS-IS filter (one connection, filter = union of viewers' circles).
 */
import { describe, expect, it } from 'vitest';

const {
  normalizeArea,
  roundArea,
  buildUnionFilter,
  inArea,
  AreaRegistry,
  AREA_TTL_MS,
  MAX_FILTER_TERMS,
  MAX_FILTER_CHARS,
} = require('./aprsAreas.js');
const { haversineDistance } = require('./grid.js');

describe('normalizeArea', () => {
  it('accepts numbers and numeric strings, clamps the radius', () => {
    expect(normalizeArea({ lat: '41.5', lon: '-81.7', radius: '250' })).toEqual({ lat: 41.5, lon: -81.7, radius: 250 });
    expect(normalizeArea({ lat: 0, lon: 0, radius: 1 }).radius).toBe(10);
    expect(normalizeArea({ lat: 0, lon: 0, radius: 99999 }).radius).toBe(1000);
    expect(normalizeArea({ lat: 0, lon: 0 }).radius).toBe(250); // default
    expect(normalizeArea({ lat: 0, lon: 0, radius: 'abc' }).radius).toBe(250);
  });

  it('rejects missing, non-numeric and out-of-range positions', () => {
    expect(normalizeArea({})).toBeNull();
    expect(normalizeArea({ lat: '', lon: '' })).toBeNull();
    expect(normalizeArea({ lat: 'x', lon: 1 })).toBeNull();
    expect(normalizeArea({ lat: 91, lon: 0 })).toBeNull();
    expect(normalizeArea({ lat: 0, lon: -181 })).toBeNull();
    expect(normalizeArea({ lat: 'Infinity', lon: 0 })).toBeNull();
  });
});

describe('roundArea', () => {
  it('rounds to 0.5° and buckets the radius up, so it still covers the real circle', () => {
    const real = { lat: 41.37, lon: -81.62, radius: 250 };
    const r = roundArea(real);
    expect(r).toEqual({ lat: 41.5, lon: -81.5, radius: 300 });
    // Every point of the real circle is inside the rounded one
    expect(haversineDistance(real.lat, real.lon, r.lat, r.lon) + real.radius).toBeLessThanOrEqual(r.radius);
  });

  it('stays in range at the poles and the antimeridian', () => {
    expect(roundArea({ lat: 89.9, lon: 179.9, radius: 50 })).toMatchObject({ lat: 90, lon: 180 });
  });
});

describe('buildUnionFilter', () => {
  const now = 1_000_000;
  const at = (lat, lon, radius = 250, lastSeen = now) => ({ lat, lon, radius, lastSeen });

  it('builds sorted r/ terms and dedupes nearby viewers', () => {
    const f = buildUnionFilter([at(41.37, -81.62), at(41.4, -81.7), at(51.5, -0.12)]);
    expect(f).toBe('r/41.5/-81.5/300 r/51.5/0/300');
  });

  it('drops a circle that lies inside another', () => {
    const f = buildUnionFilter([at(41.5, -81.5, 1000), at(41.5, -81.5, 50), at(42, -82, 100)]);
    expect(f).toBe('r/41.5/-81.5/1100');
  });

  it('puts the .env filter first and counts it against the cap', () => {
    const f = buildUnionFilter([at(10, 10)], { baseFilter: ' b/K0CJH* ' });
    expect(f).toBe('b/K0CJH* r/10/10/300');
    expect(buildUnionFilter([], { baseFilter: 'r/40/-75/500' })).toBe('r/40/-75/500');
    expect(buildUnionFilter([])).toBe('');
  });

  it('merges onto a coarser grid when there are too many terms', () => {
    // 60 viewers along one parallel, 0.7° apart: 60 terms at 0.5°, fewer at 2°
    const areas = Array.from({ length: 60 }, (_, i) => at(45, -120 + i * 0.7, 50));
    const filter = buildUnionFilter(areas);
    const terms = filter.split(' ');
    expect(terms.length).toBeLessThanOrEqual(MAX_FILTER_TERMS);
    expect(filter.length).toBeLessThanOrEqual(MAX_FILTER_CHARS);
    // ...and every viewer is still covered by some term
    for (const a of areas) {
      const covered = terms.some((t) => {
        const [, la, lo, r] = t.split('/').map(Number);
        return haversineDistance(a.lat, a.lon, la, lo) + a.radius <= r;
      });
      expect(covered).toBe(true);
    }
  });

  it('keeps the most recently requested terms when even the coarsest grid is too many', () => {
    // 80 viewers spread over the globe, 15° apart: no grid merges them
    const areas = [];
    for (let i = 0; i < 80; i++) areas.push(at(-60 + (i % 8) * 15, -170 + Math.floor(i / 8) * 34, 50, now + i));
    const terms = buildUnionFilter(areas, { maxTerms: 20, maxChars: 10000 }).split(' ');
    expect(terms).toHaveLength(20);
    // The newest viewer (i = 79: lat 45, lon 136) is in, the oldest (i = 0) is not
    expect(terms.some((t) => t.startsWith('r/50/140/') || t.startsWith('r/40/140/'))).toBe(true);
    expect(terms.some((t) => t.startsWith('r/-60/-170/'))).toBe(false);
  });

  it('never builds a line aprsc would ignore (length, not just term count)', () => {
    // 80 far-apart viewers: the default caps must cut by length first
    const areas = [];
    for (let i = 0; i < 80; i++) areas.push(at(-60.25 + (i % 8) * 15, -170.25 + Math.floor(i / 8) * 34, 1000, now + i));
    const filter = buildUnionFilter(areas, { baseFilter: 'b/K0CJH*' });
    expect(filter.length).toBeLessThanOrEqual(MAX_FILTER_CHARS);
    expect(filter.startsWith('b/K0CJH* r/')).toBe(true);
    expect(filter.split(' ').length).toBeGreaterThan(10);
  });
});

describe('inArea', () => {
  const area = { lat: 41.5, lon: -81.7, radius: 100 };
  it('uses great-circle distance', () => {
    expect(inArea({ lat: 41.5, lon: -81.0 }, area)).toBe(true); // ~58 km
    expect(inArea({ lat: 41.5, lon: -79.5 }, area)).toBe(false); // ~183 km
    expect(inArea({ lat: null, lon: null }, area)).toBe(false);
  });
});

describe('AreaRegistry', () => {
  it('reports only new areas and treats nearby requests as one', () => {
    const reg = new AreaRegistry();
    expect(reg.touch({ lat: 41.37, lon: -81.62, radius: 250 }, 0)).toBe(true);
    expect(reg.touch({ lat: 41.4, lon: -81.7, radius: 250 }, 1000)).toBe(false);
    expect(reg.touch({ lat: 41.4, lon: -81.7, radius: 50 }, 1000)).toBe(true); // other radius bucket
    expect(reg.size).toBe(2);
  });

  it('expires areas nobody polled within the TTL', () => {
    const reg = new AreaRegistry();
    reg.touch({ lat: 10, lon: 10, radius: 100 }, 0);
    reg.touch({ lat: 20, lon: 20, radius: 100 }, 0);
    reg.touch({ lat: 10, lon: 10, radius: 100 }, AREA_TTL_MS - 1000); // still polled
    expect(reg.expire(AREA_TTL_MS + 1)).toBe(1);
    expect(reg.list().map((a) => a.lat)).toEqual([10]);
  });

  it('bounds memory by dropping the least recently seen area', () => {
    const reg = new AreaRegistry({ maxAreas: 2 });
    reg.touch({ lat: 1, lon: 1, radius: 100 }, 1);
    reg.touch({ lat: 2, lon: 2, radius: 100 }, 2);
    reg.touch({ lat: 1, lon: 1, radius: 100 }, 3); // refresh 1
    reg.touch({ lat: 3, lon: 3, radius: 100 }, 4);
    expect(reg.list().map((a) => a.lat)).toEqual([1, 3]);
  });
});
