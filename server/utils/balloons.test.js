import { describe, it, expect } from 'vitest';
import { slimBalloons, slimListeners, decimate } from './balloons.js';

const point = (t, lat, lon, extra = {}) => ({
  payload_callsign: 'TEST-11',
  datetime: new Date(t).toISOString(),
  lat,
  lon,
  alt: 10000,
  ...extra,
});

const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);

describe('slimBalloons', () => {
  it('keeps the latest fix, a trail, and flags APRS-gated payloads', () => {
    const raw = {
      'TEST-11': {
        [new Date(T0).toISOString()]: point(T0, 41.0, -93.0, { vel_h: 10, ascent_rate: 1.5 }),
        [new Date(T0 + 60000).toISOString()]: point(T0 + 60000, 41.1, -93.1, {
          vel_h: 20,
          ascent_rate: 2.5,
          uploader_callsign: 'W0JW',
          uploaders: [{ uploader_callsign: 'W0JW' }, { uploader_callsign: 'K0ABC' }, { uploader_callsign: 'W0JW' }],
          modulation: 'APRS',
          aprs_tocall: 'APZ41N',
          comment: 'https://amateur.sondehub.org/ 432.500MHz',
          batt: 5.1,
        }),
      },
      'HORUS-1': {
        [new Date(T0 + 30000).toISOString()]: {
          payload_callsign: 'HORUS-1',
          datetime: new Date(T0 + 30000).toISOString(),
          lat: -35.0,
          lon: 138.5,
          alt: 25000.6,
          speed: 55.55,
          modulation: 'Horus Binary v3',
          frequency: 434.2,
        },
      },
    };
    const out = slimBalloons(raw);
    expect(out.map((b) => b.call)).toEqual(['TEST-11', 'HORUS-1']); // newest last-heard first
    const t = out[0];
    expect(t).toMatchObject({
      lat: 41.1,
      lon: -93.1,
      alt: 10000,
      speedKmh: 72,
      ascentRate: 2.5,
      frames: 2,
      aprs: true,
      uploader: 'W0JW',
      uploaders: ['W0JW', 'K0ABC'],
      lastHeard: new Date(T0 + 60000).toISOString(),
      firstHeard: new Date(T0).toISOString(),
    });
    expect(t.trail).toEqual([
      [41.0, -93.0, 10000, T0],
      [41.1, -93.1, 10000, T0 + 60000],
    ]);
    const h = out[1];
    expect(h.aprs).toBe(false);
    expect(h.speedKmh).toBe(55.6);
    expect(h.alt).toBe(25001);
    expect(h.frequency).toBe(434.2);
  });

  it('drops points without a usable position and payloads with none', () => {
    const raw = {
      BAD: { x: { lat: null, lon: 1 }, y: { lat: 95, lon: 0, datetime: new Date(T0).toISOString() } },
      OK: { [new Date(T0).toISOString()]: point(T0, 1, 2) },
    };
    const out = slimBalloons(raw);
    expect(out).toHaveLength(1);
    expect(out[0].call).toBe('TEST-11'); // payload_callsign wins over the key
  });

  it('caps balloons and trail length', () => {
    const raw = {};
    for (let i = 0; i < 20; i++) {
      const series = {};
      for (let j = 0; j < 200; j++) {
        const t = T0 + i * 1000 + j * 10;
        series[new Date(t).toISOString()] = { lat: j * 0.01, lon: 0, datetime: new Date(t).toISOString() };
      }
      raw[`B${i}`] = series;
    }
    const out = slimBalloons(raw, { maxBalloons: 5, maxTrail: 10 });
    expect(out).toHaveLength(5);
    expect(out[0].call).toBe('B19');
    expect(out[0].trail).toHaveLength(10);
    expect(out[0].trail[9][0]).toBeCloseTo(1.99, 2); // last point kept
  });

  it('ignores garbage input', () => {
    expect(slimBalloons(null)).toEqual([]);
    expect(slimBalloons([])).toEqual([]);
    expect(slimBalloons({ X: 'nope' })).toEqual([]);
  });
});

describe('decimate', () => {
  it('keeps first and last, evenly thins the middle', () => {
    const arr = Array.from({ length: 11 }, (_, i) => i);
    expect(decimate(arr, 3)).toEqual([0, 5, 10]);
    expect(decimate(arr, 20)).toEqual(arr);
  });
});

describe('slimListeners', () => {
  it('takes the newest report per station and parses both position shapes', () => {
    const raw = {
      WB6TOU: {
        [new Date(T0).toISOString()]: {
          uploader_callsign: 'WB6TOU',
          uploader_position: [38.1, -121.3, 0],
          ts: new Date(T0).toISOString(),
          uploader_radio: 'RTL-SDR',
          mobile: false,
        },
        [new Date(T0 + 1000).toISOString()]: {
          uploader_callsign: 'WB6TOU',
          uploader_position: '38.2,-121.4',
          ts: new Date(T0 + 1000).toISOString(),
        },
      },
      NOPOS: { [new Date(T0).toISOString()]: { uploader_position: [0, 0, 0] } },
    };
    const out = slimListeners(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      call: 'WB6TOU',
      lat: 38.2,
      lon: -121.4,
      lastSeen: new Date(T0 + 1000).toISOString(),
    });
  });
});
