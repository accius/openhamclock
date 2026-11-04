import { describe, it, expect, beforeEach } from 'vitest';
import { getBearingMode, displayBearing, formatBearing, cachedDeclination } from './bearing.js';

const AT = new Date(Date.UTC(2025, 0, 1)); // WMM2025 epoch → matches the published test values

describe('bearing display helper', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to true north', () => {
    expect(getBearingMode()).toBe('true');
    localStorage.setItem('openhamclock_config', JSON.stringify({ bearings: 'magnetic' }));
    expect(getBearingMode()).toBe('magnetic');
    localStorage.setItem('openhamclock_config', 'not json');
    expect(getBearingMode()).toBe('true');
  });

  it('true mode passes the bearing through, rounded, no suffix', () => {
    expect(displayBearing(123.4, 40, -105, 'true', AT)).toEqual({ deg: 123, magnetic: false, suffix: '' });
    expect(formatBearing(359.6, 40, -105, 'true', AT)).toBe('0°');
    expect(formatBearing(-10, 40, -105, 'true', AT)).toBe('350°');
  });

  it('magnetic mode subtracts the local declination and adds M', () => {
    // 80N 0E: D = +1.28° at 2025.0 → 90° true ≈ 89° magnetic
    expect(formatBearing(90, 80, 0, 'magnetic', AT)).toBe('89°M');
    // 80S 120W (240E): D = +68.78° → 10° true ≈ 301° magnetic
    expect(formatBearing(10, -80, 240, 'magnetic', AT)).toBe('301°M');
  });

  it('falls back to true when the origin is unknown', () => {
    expect(displayBearing(45, null, null, 'magnetic', AT)).toEqual({ deg: 45, magnetic: false, suffix: '' });
  });

  it('returns null for non-finite bearings', () => {
    expect(displayBearing(NaN, 40, -105)).toBeNull();
    expect(formatBearing(undefined, 40, -105)).toBeNull();
  });

  it('caches declination per cell', () => {
    const a = cachedDeclination(40.01, -105.29, AT);
    const b = cachedDeclination(40.04, -105.31, AT);
    expect(a).toBe(b);
    expect(cachedDeclination(NaN, 0, AT)).toBeNull();
  });
});
