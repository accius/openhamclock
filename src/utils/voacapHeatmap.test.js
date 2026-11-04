import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BANDS,
  DEFAULT_BAND_INDEX,
  VOACAP_SETTINGS_EVENT,
  deFromLocator,
  displayHourIso,
  getVoacapSettings,
  heatmapUrl,
  reliabilityColor,
  setVoacapSettings,
  smoothReliability,
  subscribeVoacapSettings,
} from './voacapHeatmap.js';

describe('reliabilityColor', () => {
  it('fades to transparent at r=0 and is solid green from 99%', () => {
    expect(reliabilityColor(0).alpha).toBe(0);
    expect(reliabilityColor(99)).toEqual({ color: 'rgb(0,220,0)', alpha: 0.85 });
    expect(reliabilityColor(50).alpha).toBeCloseTo(0.85);
  });
});

describe('smoothReliability', () => {
  it('averages each cell with its neighbours, wrapping across ±180°', () => {
    const a = { lat: 0, lon: -175, r: 0 };
    const b = { lat: 0, lon: 175, r: 90 }; // west neighbour of `a` across the antimeridian
    const smoothed = smoothReliability({ gridSize: 10, cells: [a, b] });
    expect(smoothed.get(a)).toBe(45);
    expect(smoothed.get(b)).toBe(45);
  });

  it('returns an empty map without cells', () => {
    expect(smoothReliability(null).size).toBe(0);
  });
});

describe('deFromLocator / heatmapUrl', () => {
  it('centres DE in the 4-character square', () => {
    expect(deFromLocator('JO21fd')).toEqual({ lat: 51.5, lon: 5 });
    expect(deFromLocator('JO')).toBe(null);
  });

  it('asks for a given hour with `at`', () => {
    expect(
      heatmapUrl({ deLat: 51, deLon: 5, freq: 14, grid: 5, mode: 'SSB', power: 100, at: '2026-10-30T14:00:00.000Z' }),
    ).toBe(
      '/api/propagation/heatmap?deLat=51&deLon=5&freq=14&grid=5&mode=SSB&power=100&at=2026-10-30T14%3A00%3A00.000Z',
    );
  });

  it('floors the display time to the whole UTC hour', () => {
    expect(displayHourIso(new Date('2026-10-30T14:37:12.345Z'))).toBe('2026-10-30T14:00:00.000Z');
  });

  it('rounds DE to whole degrees so flat and globe share a cached URL', () => {
    expect(heatmapUrl({ deLat: 51.5, deLon: 4.6, freq: 14, grid: 5, mode: 'CW', power: 100 })).toBe(
      '/api/propagation/heatmap?deLat=52&deLon=5&freq=14&grid=5&mode=CW&power=100',
    );
  });
});

describe('settings store', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('defaults to 20 m, 5° grid, SSB, 100 W', () => {
    expect(getVoacapSettings()).toEqual({ bandIndex: DEFAULT_BAND_INDEX, grid: 5, mode: 'SSB', power: 100 });
    expect(BANDS[DEFAULT_BAND_INDEX].label).toBe('20m');
  });

  it('persists where the flat layer always did and announces the change', () => {
    const fn = vi.fn();
    const unsub = subscribeVoacapSettings(fn);
    setVoacapSettings({ bandIndex: 2, mode: 'CW', power: 50 });
    expect(localStorage.getItem('voacap-heatmap-band')).toBe('2');
    expect(JSON.parse(localStorage.getItem('openhamclock_config')).propagation).toEqual({ mode: 'CW', power: 50 });
    expect(getVoacapSettings()).toEqual({ bandIndex: 2, grid: 5, mode: 'CW', power: 50 });
    expect(fn).toHaveBeenCalledWith({ bandIndex: 2, grid: 5, mode: 'CW', power: 50 });
    unsub();
    window.dispatchEvent(new CustomEvent(VOACAP_SETTINGS_EVENT, { detail: {} }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps other propagation config when changing mode', () => {
    localStorage.setItem('openhamclock_config', JSON.stringify({ propagation: { antenna: 'dipole', mode: 'SSB' } }));
    setVoacapSettings({ mode: 'FT8' });
    expect(JSON.parse(localStorage.getItem('openhamclock_config')).propagation).toEqual({
      antenna: 'dipole',
      mode: 'FT8',
      power: 100,
    });
  });
});
