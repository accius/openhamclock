import { describe, it, expect } from 'vitest';
import { nearestCity, buildCityIndex, formatPopulation, CITY_COUNT } from './nearestCity.js';
import cities from '../assets/geodata/cities.json';

describe('bundled cities dataset', () => {
  it('has ~2,000 cities with population > 300k and compact rows', () => {
    expect(CITY_COUNT).toBeGreaterThan(1500);
    expect(CITY_COUNT).toBeLessThan(3000);
    for (const row of cities) {
      expect(row.length).toBe(5);
      expect(typeof row[0]).toBe('string');
      expect(row[3]).toBeGreaterThan(300000);
      expect(Math.abs(row[1])).toBeLessThanOrEqual(90);
      expect(Math.abs(row[2])).toBeLessThanOrEqual(180);
    }
  });
});

describe('nearestCity', () => {
  it('finds the obvious city', () => {
    expect(nearestCity(51.5, -0.12).name).toBe('London');
    expect(nearestCity(40.71, -74.0).name).toBe('New York City');
    expect(nearestCity(35.68, 139.69).name).toBe('Tokyo');
  });
  it('returns null when nothing is within range', () => {
    expect(nearestCity(-60, -120)).toBeNull(); // Southern Ocean
    expect(nearestCity(0, -140, 50)).toBeNull();
  });
  it('respects the maxKm radius', () => {
    const r = nearestCity(52.2, 0.12, 100); // Cambridge, ~75 km from the London boroughs
    expect(r).toBeTruthy();
    expect(r.country).toBe('GB');
    expect(r.km).toBeGreaterThan(60);
    expect(r.km).toBeLessThan(100);
    expect(nearestCity(52.2, 0.12, 30)).toBeNull();
  });
  it('works across the antimeridian and bucket edges', () => {
    const r = nearestCity(-36.85, 174.76); // Auckland
    expect(r.name).toBe('Auckland');
    expect(nearestCity(-36.85, 174.76 - 360).name).toBe('Auckland');
    expect(nearestCity(19.99, -99.99)).toBeTruthy(); // bucket boundary near Mexico City
  });
  it('rejects non-finite input', () => {
    expect(nearestCity(NaN, 0)).toBeNull();
  });
  it('accepts a custom index', () => {
    const idx = buildCityIndex([['Nowhere', 10, 10, 500000, 'XX']]);
    expect(nearestCity(10.1, 10.1, 100, idx).name).toBe('Nowhere');
    expect(nearestCity(20, 20, 100, idx)).toBeNull();
  });
});

describe('formatPopulation', () => {
  it('formats k / M', () => {
    expect(formatPopulation(850000)).toBe('850k');
    expect(formatPopulation(1234567)).toBe('1.2M');
    expect(formatPopulation(24874500)).toBe('25M');
    expect(formatPopulation(null)).toBe('');
  });
});
