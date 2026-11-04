import { describe, it, expect } from 'vitest';
import { IbpMeasurementStore, sanitizeMeasurement, cleanStationId } from './ibpMeasurements.js';

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const H = 3600 * 1000;
const m = (over = {}) => ({
  beacon: '4U1UN',
  band: '20m',
  t: NOW - 60_000,
  snrDb: 12.34,
  levelDbm: -88,
  noiseDbm: -100.3,
  n: 180,
  ...over,
});

describe('sanitizeMeasurement', () => {
  it('normalizes a good measurement and rounds to 0.1 dB / 10 s', () => {
    expect(sanitizeMeasurement(m({ beacon: ' 4u1un ', band: '20M', t: NOW - 61_234 }), NOW)).toEqual({
      beacon: '4U1UN',
      band: '20m',
      t: Math.floor((NOW - 61_234) / 10000) * 10000,
      snrDb: 12.3,
      levelDbm: -88,
      noiseDbm: -100.3,
      n: 180,
    });
  });

  it('rejects unknown beacons/bands, bad numbers, and timestamps outside the window', () => {
    expect(sanitizeMeasurement(m({ beacon: 'W1AW' }), NOW)).toBeNull();
    expect(sanitizeMeasurement(m({ band: '40m' }), NOW)).toBeNull();
    expect(sanitizeMeasurement(m({ snrDb: 'x' }), NOW)).toBeNull();
    expect(sanitizeMeasurement(m({ t: NOW - 73 * H }), NOW)).toBeNull();
    expect(sanitizeMeasurement(m({ t: NOW + 10 * 60_000 }), NOW)).toBeNull();
    expect(sanitizeMeasurement(null, NOW)).toBeNull();
  });

  it('cleanStationId uppercases and validates callsigns', () => {
    expect(cleanStationId(' ke8plm ')).toBe('KE8PLM');
    expect(cleanStationId('bad call!')).toBeNull();
    expect(cleanStationId(42)).toBeNull();
  });
});

describe('IbpMeasurementStore', () => {
  const make = (opts = {}) => {
    let now = NOW;
    const store = new IbpMeasurementStore({ now: () => now, ...opts });
    return { store, tick: (ms) => (now += ms) };
  };

  it('ingests under the callsign, de-duplicates re-sent batches, and answers queries', () => {
    const { store } = make();
    const body = {
      station: { callsign: 'ke8plm', grid: 'EN82', lat: 42.1, lon: -83.5 },
      kiwi: { id: 'kiwi.local:8073', name: 'Home Kiwi' },
      measurements: [m(), m({ beacon: 'VE8AT', band: '17m', t: NOW - 50_000, snrDb: -3 }), m({ beacon: 'NOPE' })],
    };
    expect(store.ingest(body)).toEqual({ accepted: 2, rejected: 1, station: 'KE8PLM' });
    // Same batch again (bridge retry after a failed POST) — nothing new.
    expect(store.ingest(body)).toEqual({ accepted: 0, rejected: 1, station: 'KE8PLM' });

    const q = store.query({ station: 'ke8plm' });
    expect(q.callsign).toBe('KE8PLM');
    expect(q.grid).toBe('EN82');
    expect(q.kiwiName).toBe('Home Kiwi');
    expect(q.measurements).toHaveLength(2);
    expect(q.measurements[0].t).toBeLessThan(q.measurements[1].t);
    expect(store.query({ station: 'KE8PLM', band: '17m' }).measurements.map((x) => x.beacon)).toEqual(['VE8AT']);
    expect(store.query({ station: 'nobody' })).toBeNull();
    expect(store.listStations()[0]).toMatchObject({ station: 'KE8PLM', count: 2, kiwi: 'kiwi.local:8073' });
  });

  it('falls back to the Kiwi id when no callsign is configured', () => {
    const { store } = make();
    expect(store.ingest({ kiwi: { id: 'sdr.example.org:8073' }, measurements: [m()] }).station).toBe(
      'KIWI:sdr.example.org:8073',
    );
    expect(store.query({ station: 'sdr.example.org:8073' }).measurements).toHaveLength(1);
    expect(store.ingest({ measurements: [m()] })).toEqual({ error: 'station.callsign or kiwi.id required' });
    expect(store.ingest({ station: { callsign: 'K1A' } })).toEqual({ error: 'measurements array required' });
  });

  it('enforces the 72 h window, per-station cap and station cap', () => {
    const { store, tick } = make({ maxPerStation: 5, maxStations: 2 });
    const many = Array.from({ length: 8 }, (_, i) => m({ t: NOW - (8 - i) * 10_000, beacon: 'W6WX' }));
    store.ingest({ station: { callsign: 'K1A' }, measurements: many });
    expect(store.query({ station: 'K1A' }).measurements).toHaveLength(5);

    tick(1000);
    store.ingest({ station: { callsign: 'K2B' }, measurements: [m()] });
    tick(1000);
    store.ingest({ station: { callsign: 'K3C' }, measurements: [m()] }); // evicts K1A (least recently updated)
    expect(
      store
        .listStations()
        .map((s) => s.station)
        .sort(),
    ).toEqual(['K2B', 'K3C']);

    tick(73 * H);
    expect(store.query({ station: 'K2B' }).measurements).toHaveLength(0);
    store.sweep();
    expect(store.listStations()).toHaveLength(0);
  });

  it('query honours hours (capped at 72) and since', () => {
    const { store } = make();
    store.ingest({
      station: { callsign: 'K1A' },
      measurements: [
        m({ t: NOW - 30 * H }),
        m({ t: NOW - 2 * H, beacon: 'ZL6B' }),
        m({ t: NOW - 60_000, beacon: 'OH2B' }),
      ],
    });
    expect(store.query({ station: 'K1A', hours: 1 }).measurements.map((x) => x.beacon)).toEqual(['OH2B']);
    expect(store.query({ station: 'K1A', hours: 24 }).measurements).toHaveLength(2);
    expect(store.query({ station: 'K1A', hours: 999 }).measurements).toHaveLength(3);
    expect(store.query({ station: 'K1A', since: NOW - 3 * H }).measurements).toHaveLength(2);
  });
});
