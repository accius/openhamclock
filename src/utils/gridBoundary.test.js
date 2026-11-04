import { describe, it, expect } from 'vitest';
import {
  cellSizeDeg,
  gridBoundsAt,
  distanceToGridEdges,
  etaMinutes,
  nextGridCrossing,
  adjacentGrid,
  formatSpeed,
} from './gridBoundary.js';
import { maidenheadToBoundingBox, latLonToMaidenhead } from './geo.js';

const BOULDER = { lat: 40.015, lon: -105.2705 }; // DN70ia

describe('gridBoundsAt', () => {
  it('matches the bounding box of the locator for the point', () => {
    for (const p of [
      BOULDER,
      { lat: 48.1173, lon: 11.5167 },
      { lat: -33.8688, lon: 151.2093 },
      { lat: 0.001, lon: 0.001 },
    ]) {
      const grid = latLonToMaidenhead(p, 6);
      const [[s, w], [n, e]] = maidenheadToBoundingBox(grid);
      const b = gridBoundsAt(p.lat, p.lon, 6);
      expect(b.south).toBeCloseTo(s, 9);
      expect(b.north).toBeCloseTo(n, 9);
      expect(b.west).toBeCloseTo(w, 9);
      expect(b.east).toBeCloseTo(e, 9);
    }
  });
  it('handles exact cell edges and 4-char precision', () => {
    const b = gridBoundsAt(40.0, -106.0, 6);
    expect(b.south).toBeCloseTo(40.0, 9);
    expect(b.west).toBeCloseTo(-106.0, 9);
    const b4 = gridBoundsAt(BOULDER.lat, BOULDER.lon, 4);
    expect(b4).toEqual({ south: 40, north: 41, west: -106, east: -104 });
    expect(cellSizeDeg(4)).toEqual({ lat: 1, lon: 2 });
  });
  it('rejects garbage', () => {
    expect(gridBoundsAt(NaN, 0)).toBeNull();
    expect(gridBoundsAt(95, 0)).toBeNull();
  });
});

describe('distanceToGridEdges', () => {
  it('Boulder: known distances to the DN70ia edges', () => {
    const d = distanceToGridEdges(BOULDER.lat, BOULDER.lon);
    expect(d.north).toBeCloseTo(2.965, 2);
    expect(d.south).toBeCloseTo(1.668, 2);
    expect(d.east).toBeCloseTo(1.746, 2);
    expect(d.west).toBeCloseTo(5.35, 1);
    // N+S spans the 2.5' cell height; E+W the 5' width at this latitude
    expect(d.north + d.south).toBeCloseTo((2.5 / 60) * 111.195, 3);
    expect(d.east + d.west).toBeCloseTo((5 / 60) * 111.195 * Math.cos((BOULDER.lat * Math.PI) / 180), 3);
  });
});

describe('etaMinutes', () => {
  it('converts distance and speed', () => {
    expect(etaMinutes(10, 60)).toBeCloseTo(10);
    expect(etaMinutes(10, 0.5)).toBeNull();
    expect(etaMinutes(NaN, 60)).toBeNull();
  });
});

describe('nextGridCrossing', () => {
  it('heading north crosses the north edge into the grid above', () => {
    const x = nextGridCrossing(BOULDER.lat, BOULDER.lon, 0, 60);
    expect(x.edge).toBe('N');
    expect(x.distanceKm).toBeCloseTo(2.965, 2);
    expect(x.etaMin).toBeCloseTo(2.965, 2);
    expect(x.nextGrid).toBe('DN70ib');
  });
  it('heading east crosses the east edge', () => {
    const x = nextGridCrossing(BOULDER.lat, BOULDER.lon, 90, 100);
    expect(x.edge).toBe('E');
    expect(x.nextGrid).toBe('DN70ja');
  });
  it('heading south-west picks whichever edge comes first', () => {
    const x = nextGridCrossing(BOULDER.lat, BOULDER.lon, 225, 50);
    expect(x.edge).toBe('S'); // 1.67 km south vs 5.35 km west, at 45° south wins
    expect(x.nextGrid).toBe('DM79ix');
    expect(x.distanceKm).toBeCloseTo(1.668 * Math.SQRT2, 2);
  });
  it('stationary gives a distance but no ETA; unknown course gives null', () => {
    expect(nextGridCrossing(BOULDER.lat, BOULDER.lon, 0, 0).etaMin).toBeNull();
    expect(nextGridCrossing(BOULDER.lat, BOULDER.lon, null, 50)).toBeNull();
  });
  it('wraps across the dateline', () => {
    const x = nextGridCrossing(0.01, 179.99, 90, 50);
    expect(x.edge).toBe('E');
    expect(x.nextGrid).toBe(latLonToMaidenhead({ lat: 0.01, lon: -179.99 }, 6));
  });
});

describe('adjacentGrid', () => {
  it('names the four neighbours', () => {
    expect(adjacentGrid(BOULDER.lat, BOULDER.lon, 'N')).toBe('DN70ib');
    expect(adjacentGrid(BOULDER.lat, BOULDER.lon, 'S')).toBe('DM79ix');
    expect(adjacentGrid(BOULDER.lat, BOULDER.lon, 'E')).toBe('DN70ja');
    expect(adjacentGrid(BOULDER.lat, BOULDER.lon, 'W')).toBe('DN70ha');
    expect(adjacentGrid(BOULDER.lat, BOULDER.lon, 'X')).toBeNull();
    expect(adjacentGrid(89.99, 0, 'N')).toBeNull();
  });
});

describe('formatSpeed', () => {
  it('formats both unit systems', () => {
    expect(formatSpeed(100, 'metric')).toBe('100 km/h');
    expect(formatSpeed(100, 'imperial')).toBe('62 mph');
    expect(formatSpeed(null)).toBe('—');
  });
});
