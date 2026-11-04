/**
 * Ephemeris checks against JPL Horizons (apparent geocentric RA/Dec of
 * date, 2024-04-08 18:18 UT) and against well-known events whose geometry
 * is independent of anyone's memory of coordinates: conjunctions, transits,
 * oppositions and eclipses.
 */
import { describe, expect, it } from 'vitest';
import {
  BODY_NAMES,
  PLANET_NAMES,
  julianDay,
  heliocentric,
  bodyGeocentric,
  bodyTopocentric,
  angularSeparation,
  riseSet,
  planetTable,
  precessFromJ2000,
  solveKepler,
} from './planets.js';

const arcmin = (deg) => deg * 60;
const J2000 = new Date(Date.UTC(2000, 0, 1, 12));
const T2024 = new Date(Date.UTC(2024, 3, 8, 18, 18));

// JPL Horizons, observer table, center 500@399, apparent RA/Dec (deg), delta (AU)
const HORIZONS_2024 = {
  Sun: [17.90413, 7.59167, 1.00150715],
  Venus: [4.67106, 0.3919, 1.64680347],
  Mars: [344.85863, -7.80881, 2.06077112],
  Jupiter: [46.81967, 16.71071, 5.85175983],
  Moon: [17.74568, 7.90195, 0.00240514],
};

describe('basics', () => {
  it('solves Kepler for circular and eccentric orbits', () => {
    expect(solveKepler(90, 0)).toBeCloseTo(90, 6);
    const E = solveKepler(30, 0.2);
    expect(E - ((0.2 * 180) / Math.PI) * Math.sin((E * Math.PI) / 180)).toBeCloseTo(30, 6);
  });

  it('Julian Day of J2000.0 is 2451545.0', () => {
    expect(julianDay(J2000)).toBeCloseTo(2451545.0, 6);
  });

  it('precession is identity at J2000 and ~0.33° in RA by 2024', () => {
    expect(precessFromJ2000(100, 20, julianDay(J2000)).ra).toBeCloseTo(100, 8);
    const p = precessFromJ2000(0, 0, julianDay(T2024));
    expect(p.ra).toBeGreaterThan(0.3);
    expect(p.ra).toBeLessThan(0.36);
  });

  it('Earth is near perihelion (0.983 AU) at J2000', () => {
    const e = heliocentric('Earth', julianDay(J2000));
    expect(Math.hypot(e.x, e.y, e.z)).toBeCloseTo(0.9833, 3);
  });
});

describe('geocentric positions vs JPL Horizons (2024-04-08 18:18 UT)', () => {
  for (const [name, [ra, dec, dist]] of Object.entries(HORIZONS_2024)) {
    it(`${name} within a few arcminutes`, () => {
      const b = bodyGeocentric(name, T2024);
      const tol = name === 'Jupiter' ? 4 : 3; // outer-planet elements are the loosest
      expect(Math.abs(arcmin(b.ra - ra) * Math.cos((dec * Math.PI) / 180))).toBeLessThan(tol);
      expect(Math.abs(arcmin(b.dec - dec))).toBeLessThan(tol);
      expect(Math.abs(b.distanceAU - dist) / dist).toBeLessThan(0.005);
    });
  }

  it('Sun at J2000 is at RA 281.29°, Dec −23.03°', () => {
    const s = bodyGeocentric('Sun', J2000);
    expect(s.ra).toBeCloseTo(281.29, 0);
    expect(s.dec).toBeCloseTo(-23.03, 1);
  });
});

describe('known events', () => {
  it('2020-12-21 great conjunction: Jupiter–Saturn 0.1° apart', () => {
    const t = new Date(Date.UTC(2020, 11, 21, 18));
    const j = bodyGeocentric('Jupiter', t);
    const s = bodyGeocentric('Saturn', t);
    expect(angularSeparation(j.ra, j.dec, s.ra, s.dec)).toBeLessThan(0.3);
  });

  it('2012-06-06 Venus transit: Venus on the solar disk', () => {
    const t = new Date(Date.UTC(2012, 5, 6, 1, 30));
    const v = bodyGeocentric('Venus', t);
    const s = bodyGeocentric('Sun', t);
    expect(angularSeparation(v.ra, v.dec, s.ra, s.dec)).toBeLessThan(0.25);
  });

  it('2019-11-11 Mercury transit: Mercury on the solar disk', () => {
    const t = new Date(Date.UTC(2019, 10, 11, 15, 20));
    const m = bodyGeocentric('Mercury', t);
    const s = bodyGeocentric('Sun', t);
    expect(angularSeparation(m.ra, m.dec, s.ra, s.dec)).toBeLessThan(0.2);
  });

  it('2003-08-28 Mars opposition: 0.373 AU, opposite the Sun', () => {
    const m = bodyTopocentric('Mars', new Date(Date.UTC(2003, 7, 28, 18)), 0, 0);
    expect(m.distanceAU).toBeCloseTo(0.3727, 2);
    expect(m.elongation).toBeGreaterThan(172); // Mars sat ~5° south of the ecliptic
  });

  it('2024-04-08 total eclipse: Moon covers the Sun from Dallas at 18:42 UT', () => {
    let best = { sep: 99, min: null };
    for (let min = 0; min <= 50; min += 2) {
      const t = new Date(T2024.getTime() + min * 60000);
      const m = bodyTopocentric('Moon', t, 32.78, -96.8);
      const s = bodyTopocentric('Sun', t, 32.78, -96.8);
      const sep = angularSeparation(m.ra, m.dec, s.ra, s.dec);
      if (sep < best.sep) best = { sep, min };
    }
    expect(best.sep).toBeLessThan(0.05); // sun radius is 0.27°
    expect(Math.abs(best.min - 24)).toBeLessThanOrEqual(6);
  });

  it('2026-03-03 total lunar eclipse: Moon opposite the Sun', () => {
    const m = bodyTopocentric('Moon', new Date(Date.UTC(2026, 2, 3, 11, 34)), 0, 0);
    expect(m.elongation).toBeGreaterThan(179);
  });

  it('elongation direction: Venus was an evening star in March 2025', () => {
    const v = bodyTopocentric('Venus', new Date(Date.UTC(2025, 2, 1, 0)), 0, 0);
    expect(v.elongationDir).toBe('E');
    expect(v.elongation).toBeLessThan(48);
  });
});

describe('observer / rise-set (Boulder, CO)', () => {
  const lat = 40.015;
  const lon = -105.2705;

  it('Sun transits due south at ~27° on 2000-01-01 19:04 UT', () => {
    const s = bodyTopocentric('Sun', new Date(Date.UTC(2000, 0, 1, 19, 4)), lat, lon);
    expect(Math.abs(s.az - 180)).toBeLessThan(1.5);
    expect(s.el).toBeCloseTo(27, 0);
  });

  it('sunrise 14:21 UT and sunset 23:46 UT on 2000-01-01', () => {
    const r = riseSet('Sun', new Date(Date.UTC(2000, 0, 1, 7)), lat, lon);
    expect(Math.abs(r.rise.getTime() - Date.UTC(2000, 0, 1, 14, 21)) / 60000).toBeLessThan(5);
    expect(Math.abs(r.set.getTime() - Date.UTC(2000, 0, 1, 23, 46)) / 60000).toBeLessThan(5);
    expect(r.alwaysUp).toBe(false);
    expect(r.alwaysDown).toBe(false);
  });

  it('flags the midnight sun / polar night', () => {
    const summer = riseSet('Sun', new Date(Date.UTC(2025, 5, 21)), 80, 0);
    expect(summer.alwaysUp).toBe(true);
    const winter = riseSet('Sun', new Date(Date.UTC(2025, 11, 21)), 80, 0);
    expect(winter.alwaysDown).toBe(true);
  });

  it('planetTable returns one complete row per body', () => {
    const rows = planetTable(new Date(Date.UTC(2026, 9, 14, 12)), lat, lon);
    expect(rows.map((r) => r.name)).toEqual(BODY_NAMES);
    expect(PLANET_NAMES).toHaveLength(7);
    for (const r of rows) {
      expect(r.az).toBeGreaterThanOrEqual(0);
      expect(r.az).toBeLessThan(360);
      expect(Math.abs(r.el)).toBeLessThanOrEqual(90);
      expect(r.distanceKm).toBeGreaterThan(0);
      expect(r.rise instanceof Date || r.rise === null).toBe(true);
    }
    // Moon distance in the physical range
    const moon = rows.find((r) => r.name === 'Moon');
    expect(moon.distanceKm).toBeGreaterThan(356000);
    expect(moon.distanceKm).toBeLessThan(407000);
  });
});
