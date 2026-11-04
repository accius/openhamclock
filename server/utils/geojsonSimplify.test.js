import { describe, it, expect } from 'vitest';
import { simplifyRing, simplifyGeometry, mergePolygons, pointCount, centroid } from './geojsonSimplify.js';

const square = (n) => {
  // n points per side, closed ring around a unit square
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([i / n, 0]);
  for (let i = 0; i < n; i++) pts.push([1, i / n]);
  for (let i = 0; i < n; i++) pts.push([1 - i / n, 1]);
  for (let i = 0; i < n; i++) pts.push([0, 1 - i / n]);
  pts.push([0, 0]);
  return pts;
};

describe('simplifyRing', () => {
  it('collapses collinear points down to the corners', () => {
    const out = simplifyRing(square(50), 0.001);
    expect(out.length).toBe(5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([0, 0]);
  });
  it('keeps a bump larger than the tolerance', () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 0.5],
      [1.2, 0.6],
      [1, 0.7],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    expect(simplifyRing(ring, 0.05).some(([x]) => x === 1.2)).toBe(true);
    expect(simplifyRing(ring, 0.5).some(([x]) => x === 1.2)).toBe(false);
  });
  it('passes short rings through', () => {
    expect(simplifyRing([[0, 0]], 1)).toEqual([[0, 0]]);
    expect(simplifyRing(null, 1)).toEqual([]);
  });
});

describe('geometry helpers', () => {
  it('simplifyGeometry handles Polygon and MultiPolygon', () => {
    const poly = { type: 'Polygon', coordinates: [square(20)] };
    expect(pointCount(simplifyGeometry(poly, 0.001))).toBe(5);
    const multi = { type: 'MultiPolygon', coordinates: [[square(20)], [square(10)]] };
    expect(pointCount(simplifyGeometry(multi, 0.001))).toBe(10);
    expect(simplifyGeometry({ type: 'Point', coordinates: [1, 2] })).toEqual({ type: 'Point', coordinates: [1, 2] });
  });
  it('mergePolygons concatenates into a MultiPolygon', () => {
    const m = mergePolygons([
      { type: 'Polygon', coordinates: [square(4)] },
      { type: 'MultiPolygon', coordinates: [[square(4)], [square(4)]] },
      null,
    ]);
    expect(m.type).toBe('MultiPolygon');
    expect(m.coordinates.length).toBe(3);
    expect(mergePolygons([null])).toBeNull();
  });
  it('centroid averages outer-ring vertices', () => {
    const c = centroid({ type: 'Polygon', coordinates: [square(10)] });
    expect(c.lat).toBeCloseTo(0.5, 1);
    expect(c.lon).toBeCloseTo(0.5, 1);
    expect(centroid(null)).toBeNull();
  });
});
