import { describe, it, expect } from 'vitest';
import { cursorReadoutText } from './MapCursorReadout.jsx';

describe('cursorReadoutText', () => {
  it('shows coordinates, grid, DE distance/bearing and the nearest city', () => {
    const s = cursorReadoutText({ lat: 42.36, lon: -71.06, deLat: 40.71, deLon: -74.0 });
    expect(s).toMatch(/^42\.4°, -71\.1° · FN42/);
    expect(s).toMatch(/km \d{3}°/);
    expect(s).toContain('Boston (');
  });
  it('omits DE parts without a DE location and city when none is near', () => {
    const s = cursorReadoutText({ lat: -60, lon: -120 });
    expect(s).toBe('-60.0°, -120.0° · DD00');
  });
  it('normalizes wrapped longitudes', () => {
    expect(cursorReadoutText({ lat: 51.5, lon: 359.88 })).toMatch(/^51\.5°, -0\.1°/);
  });
  it('uses miles for imperial units', () => {
    const s = cursorReadoutText({ lat: 42.36, lon: -71.06, deLat: 40.71, deLon: -74.0, units: 'imperial' });
    expect(s).toMatch(/ mi \d{3}°/);
  });
  it('returns empty for bad input', () => {
    expect(cursorReadoutText({ lat: NaN, lon: 1 })).toBe('');
  });
});
