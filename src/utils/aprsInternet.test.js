/**
 * aprsInternet — per-viewer internet APRS settings, the area each viewer
 * asks the server for, and which retained internet stations stay visible.
 */
import { describe, it, expect } from 'vitest';
import {
  INTERNET_KEY,
  DEFAULT_INTERNET,
  readInternetSettings,
  writeInternetSettings,
  viewerArea,
  stationsUrl,
  showInternetStation,
} from './aprsInternet.js';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const CLE = { lat: 41.4993, lon: -81.6944 };

describe('internet APRS settings storage', () => {
  it('defaults to on, 250 km', () => {
    expect(readInternetSettings(memStorage())).toEqual({ enabled: true, radiusKm: 250 });
    expect(DEFAULT_INTERNET).toEqual({ enabled: true, radiusKm: 250 });
  });

  it('round-trips, and falls back on junk or an unknown radius', () => {
    const s = memStorage();
    writeInternetSettings({ enabled: false, radiusKm: 500 }, s);
    expect(readInternetSettings(s)).toEqual({ enabled: false, radiusKm: 500 });
    expect(readInternetSettings(memStorage({ [INTERNET_KEY]: '{"radiusKm":123}' }))).toEqual({
      enabled: true,
      radiusKm: 250,
    });
    expect(readInternetSettings(memStorage({ [INTERNET_KEY]: 'not json' }))).toEqual(DEFAULT_INTERNET);
  });

  it('survives storage that throws', () => {
    const bad = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    expect(readInternetSettings(bad)).toEqual(DEFAULT_INTERNET);
    expect(() => writeInternetSettings(DEFAULT_INTERNET, bad)).not.toThrow();
  });
});

describe('viewerArea / stationsUrl', () => {
  it('centres on the station location, rounded to 0.01°', () => {
    expect(viewerArea({ enabled: true, radiusKm: 100 }, CLE)).toEqual({ lat: 41.5, lon: -81.69, radius: 100 });
    expect(stationsUrl({ enabled: true, radiusKm: 100 }, CLE)).toBe(
      '/api/aprs/stations?lat=41.5&lon=-81.69&radius=100',
    );
  });

  it('asks for RF only when internet APRS is off', () => {
    expect(viewerArea({ enabled: false, radiusKm: 100 }, CLE)).toBeNull();
    expect(stationsUrl({ enabled: false, radiusKm: 100 }, CLE)).toBe('/api/aprs/stations?internet=0');
  });

  it('sends no area without a usable location: unset, 0,0 or the Boulder default (old behaviour)', () => {
    for (const loc of [
      null,
      {},
      { lat: 0, lon: 0 },
      { lat: 40.015, lon: -105.2705 },
      { lat: 'x', lon: 1 },
      { lat: 95, lon: 0 },
    ]) {
      expect(stationsUrl({ enabled: true, radiusKm: 250 }, loc)).toBe('/api/aprs/stations');
    }
    expect(viewerArea({ enabled: true, radiusKm: 250 }, { lat: '41.5', lon: '-81.7' })).toMatchObject({ lat: 41.5 });
  });
});

describe('showInternetStation', () => {
  const on = { enabled: true, radiusKm: 100 };
  it('hides stations outside the radius and everything when off', () => {
    expect(showInternetStation({ lat: 41.6, lon: -81.5 }, on, CLE)).toBe(true);
    expect(showInternetStation({ lat: 51.5, lon: -0.1 }, on, CLE)).toBe(false);
    expect(showInternetStation({ lat: 41.6, lon: -81.5 }, { ...on, enabled: false }, CLE)).toBe(false);
    expect(showInternetStation({ lat: 51.5, lon: -0.1 }, on, null)).toBe(true); // no area: unfiltered
  });
});
