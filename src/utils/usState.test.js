import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  stateFromIso,
  resolveUsState,
  stateFromBundle,
  prepareOutlines,
  stateFromOutlines,
  _clearUsStateMemo,
} from './usState.js';

const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'src/assets/geodata/us-states.json'), 'utf8'));
const outlines = prepareOutlines(raw);

describe('bundled state outlines', () => {
  it('stays small and covers the states, DC and territories', () => {
    expect(readFileSync(resolve(process.cwd(), 'src/assets/geodata/us-states.json')).length).toBeLessThan(100 * 1024);
    expect(Object.keys(raw.states)).toHaveLength(56);
  });

  it.each([
    // ~5 km either side of a border
    [40.95, -105.5, 'CO'],
    [41.05, -105.5, 'WY'],
    [39.1, -94.7, 'KS'],
    [39.1, -94.5, 'MO'],
    [34.1, -97.0, 'OK'],
    [33.6, -97.0, 'TX'],
    [40.73, -74.07, 'NJ'],
    [40.78, -73.96, 'NY'],
    [39.0, -120.1, 'CA'],
    [39.0, -119.9, 'NV'],
    [38.9, -77.03, 'DC'],
    // Non-contiguous and territories
    [61.2, -149.9, 'AK'],
    [21.3, -157.85, 'HI'],
    [18.45, -66.1, 'PR'],
  ])('%f, %f is in %s', (lat, lon, code) => {
    expect(stateFromOutlines(outlines, lat, lon)).toBe(code);
  });

  it.each([
    [43.65, -79.38], // Toronto
    [45.42, -75.69], // Ottawa
    [32.45, -116.95], // Tijuana
    [51.5, -0.1], // London
  ])('%f, %f is outside the US', (lat, lon) => {
    expect(stateFromOutlines(outlines, lat, lon)).toBeNull();
  });

  it('rejects junk', () => {
    expect(stateFromOutlines(outlines, NaN, 1)).toBeNull();
    expect(stateFromOutlines(null, 40, -105)).toBeNull();
  });
});

describe('resolveUsState', () => {
  beforeEach(() => _clearUsStateMemo());

  it('maps ISO 3166-2 US codes to state codes', () => {
    expect(stateFromIso('US-CO')).toBe('CO');
    expect(stateFromIso('CA-ON')).toBeNull();
    expect(stateFromIso(undefined)).toBeNull();
  });

  it('answers from the bundled outlines without touching the network', async () => {
    let calls = 0;
    const net = async () => {
      calls++;
      throw new TypeError('offline');
    };
    expect(await stateFromBundle(40.015, -105.27)).toBe('CO');
    expect(await resolveUsState(40.015, -105.27, net)).toBe('CO');
    expect(calls).toBe(0);
  });

  it('falls back to Nominatim only where the outlines find nothing', async () => {
    let calls = 0;
    const ok = async () => {
      calls++;
      return new Response(JSON.stringify({ address: { 'ISO3166-2-lvl4': 'US-ME' } }));
    };
    // A point the simplified outlines miss (open sea): the network decides.
    expect(await resolveUsState(43.0, -69.0, ok)).toBe('ME');
    expect(await resolveUsState(43.0, -69.0, ok)).toBe('ME');
    expect(calls).toBe(1);
    const down = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await resolveUsState(51.5, -0.1, down)).toBeNull();
    expect(await resolveUsState(null, 1, ok)).toBeNull();
  });
});
