import { describe, expect, it } from 'vitest';

const { BenchmarkStore, median, HOUR_MS, DAY_MS } = require('./benchmark.js');

const T0 = Date.parse('2026-10-14T12:10:00Z');
const spot = (dx, skimmer, snr, { band = '20m', t = T0 } = {}) => ({
  dx,
  callsign: skimmer,
  band,
  snr,
  timestampMs: t,
});

describe('median', () => {
  it('handles odd/even/empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([NaN, 5])).toBe(5);
  });
});

describe('BenchmarkStore.ingest', () => {
  it('aggregates SNR per skimmer/band/hour and ignores junk', () => {
    const s = new BenchmarkStore({ now: () => T0 });
    expect(s.ingest(spot('K1ME', 'W3LPL', 20))).toBe(true);
    expect(s.ingest(spot('K1ME', 'W3LPL-#', 30))).toBe(true); // -# suffix stripped
    expect(s.ingest(spot('K1ME', 'W3LPL', 10, { t: T0 + 2 * HOUR_MS }))).toBe(true); // other hour
    expect(s.ingest(spot('K1ME', 'W3LPL', NaN))).toBe(false);
    expect(s.ingest(spot('K1ME', 'W3LPL', 10, { band: 'Other' }))).toBe(false);
    const st = s.stations.get('K1ME');
    expect(st.buckets.size).toBe(2);
    const first = [...st.buckets.values()][0];
    expect(first).toMatchObject({ sum: 50, count: 2, max: 30, skimmer: 'W3LPL', band: '20m' });
    expect(s.stats()).toEqual({ stations: 1, located: 0, buckets: 2, ingested: 3 });
  });

  it('bounds stations and buckets per station (oldest evicted first)', () => {
    const s = new BenchmarkStore({ maxStations: 2, maxKeysPerStation: 2, now: () => T0 });
    s.ingest(spot('A1A', 'X', 1));
    s.ingest(spot('B1B', 'X', 1));
    s.ingest(spot('C1C', 'X', 1));
    expect([...s.stations.keys()]).toEqual(['B1B', 'C1C']);
    s.ingest(spot('C1C', 'Y', 1));
    s.ingest(spot('C1C', 'Z', 1));
    expect([...s.stations.get('C1C').buckets.values()].map((b) => b.skimmer)).toEqual(['Y', 'Z']);
  });

  it('never downgrades a precise location to a coarse one', () => {
    const s = new BenchmarkStore({ now: () => T0 });
    s.ingest(spot('K1ME', 'W3LPL', 20), { lat: 42, lon: -71, precise: true });
    expect(s.setLocation('K1ME', { lat: 39, lon: -98, precise: false })).toBe(false);
    expect(s.stations.get('K1ME').lat).toBe(42);
    expect(s.unlocated()).toEqual([]);
    s.ingest(spot('N0XYZ', 'W3LPL', 20), { lat: 39, lon: -98, precise: false });
    expect(s.unlocated().map((u) => u.call)).toEqual(['N0XYZ']);
  });

  it('prunes buckets older than the window', () => {
    const s = new BenchmarkStore({ now: () => T0 });
    s.ingest(spot('K1ME', 'W3LPL', 20, { t: T0 - 8 * DAY_MS }));
    s.ingest(spot('K1ME', 'W3LPL', 20, { t: T0 }));
    s.ingest(spot('OLD1', 'W3LPL', 20, { t: T0 - 8 * DAY_MS }));
    expect(s.prune(T0)).toBe(2);
    expect(s.stations.has('OLD1')).toBe(false);
    expect(s.stations.get('K1ME').buckets.size).toBe(1);
  });
});

describe('BenchmarkStore.compare', () => {
  const build = () => {
    const s = new BenchmarkStore({ now: () => T0 });
    const me = { lat: 42.0, lon: -71.0, precise: true };
    const near1 = { lat: 42.5, lon: -71.5, precise: true }; // ~70 km
    const near2 = { lat: 41.5, lon: -70.5, precise: true };
    const far = { lat: 35.0, lon: -100.0, precise: true };
    // Same skimmer, same hour: me 20 dB, neighbours 10 and 14 (median 12) → +8
    s.ingest(spot('ME1ME', 'W3LPL', 20), me);
    s.ingest(spot('N1AAA', 'W3LPL', 10), near1);
    s.ingest(spot('N1BBB', 'W3LPL', 14), near2);
    s.ingest(spot('FAR1', 'W3LPL', 40), far); // out of radius → ignored
    // Different skimmer, 40m, next day: me 5, neighbour 11 → −6
    s.ingest(spot('ME1ME', 'K3LR', 5, { band: '40m', t: T0 + DAY_MS }), me);
    s.ingest(spot('N1AAA', 'K3LR', 11, { band: '40m', t: T0 + DAY_MS }), near1);
    // A bucket only I have → no comparison, but counted as a spot
    s.ingest(spot('ME1ME', 'DL8LAS', 3), me);
    return s;
  };

  it('reports me-minus-neighbour-median per band with sample counts and per-day trend', () => {
    const r = build().compare({ call: 'ME1ME', lat: 42, lon: -71, radiusKm: 300, now: T0 + DAY_MS });
    expect(r.neighbours).toBe(2);
    expect(r.mySpots).toBe(3);
    const b20 = r.bands.find((b) => b.band === '20m');
    const b40 = r.bands.find((b) => b.band === '40m');
    expect(b20).toMatchObject({ diffDb: 8, samples: 1, neighbourSamples: 2, bestDiffDb: 8 });
    expect(b20.days).toEqual([{ day: '2026-10-14', diffDb: 8, samples: 1 }]);
    expect(b40).toMatchObject({ diffDb: -6, samples: 1, neighbourSamples: 1 });
    expect(b40.days[0].day).toBe('2026-10-15');
    expect(r.explanation).toMatch(/\+1 dB overall \(2 bands\)/);
  });

  it('explains the empty cases', () => {
    const s = build();
    expect(s.compare({ call: 'NOBODY', lat: 42, lon: -71 }).explanation).toMatch(/No RBN skimmer reports/);
    const lonely = s.compare({ call: 'FAR1', lat: 35, lon: -100, radiusKm: 100 });
    expect(lonely.neighbours).toBe(0);
    expect(lonely.explanation).toMatch(/no other located station within 100 km/);
    const noOverlap = s.compare({ call: 'ME1ME', lat: 42, lon: -71, radiusKm: 300, now: T0 + 3 * DAY_MS });
    // My 20m bucket is now outside... no: window is 7 days, so still inside. Use a tiny window store instead.
    expect(noOverlap.bands.length).toBeGreaterThan(0);
    const tiny = new BenchmarkStore({ now: () => T0 });
    tiny.ingest(spot('ME1ME', 'W3LPL', 20), { lat: 42, lon: -71 });
    tiny.ingest(spot('N1AAA', 'K3LR', 20), { lat: 42.2, lon: -71.2 });
    expect(tiny.compare({ call: 'ME1ME', lat: 42, lon: -71 }).explanation).toMatch(
      /never the same skimmer, band and hour/,
    );
  });

  it('excludes the station itself and coarse-located stations from the neighbour set', () => {
    const s = new BenchmarkStore({ now: () => T0 });
    s.ingest(spot('ME1ME', 'W3LPL', 20), { lat: 42, lon: -71 });
    s.ingest(spot('COARSE', 'W3LPL', 50), { lat: 42.1, lon: -71.1, precise: false });
    const r = s.compare({ call: 'ME1ME', lat: 42, lon: -71 });
    expect(r.neighbours).toBe(0);
    expect(s.stationsNear(42, -71, 300).map((x) => x.call)).toEqual(['ME1ME']);
  });
});
