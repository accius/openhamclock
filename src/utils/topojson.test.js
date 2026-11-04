import { describe, it, expect } from 'vitest';
import { feature, mesh, meshArcs, decodeArc } from './topojson.js';
import canada from '../assets/geodata/canada-provinces.json';

// Two squares sharing an edge, quantized. Arc 0 = shared edge (0,0)→(0,1)
// in topology space; arc 1 = left square's outer path; arc 2 = right square's.
const topo = {
  type: 'Topology',
  transform: { scale: [0.5, 0.5], translate: [10, 20] },
  objects: {
    squares: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', id: 'L', properties: { name: 'left' }, arcs: [[0, 1]] },
        { type: 'Polygon', id: 'R', properties: { name: 'right' }, arcs: [[~0, 2]] },
      ],
    },
    one: { type: 'Polygon', arcs: [[0, 1]] },
    pt: { type: 'Point', coordinates: [2, 2] },
  },
  arcs: [
    [
      [0, 0],
      [0, 2],
    ], // (0,0) → (0,2)   shared edge, delta-encoded
    [
      [0, 2],
      [-2, 0],
      [0, -2],
      [2, 0],
    ], // (0,2) → (-2,2) → (-2,0) → (0,0)
    [
      [0, 0],
      [2, 0],
      [0, 2],
      [-2, 0],
    ], // (0,0) → (2,0) → (2,2) → (0,2)
  ],
};

describe('decodeArc', () => {
  it('applies the transform and delta decoding', () => {
    expect(decodeArc(topo, 0)).toEqual([
      [10, 20],
      [10, 21],
    ]);
  });
  it('reverses arcs addressed with ~index', () => {
    expect(decodeArc(topo, ~0)).toEqual([
      [10, 21],
      [10, 20],
    ]);
  });
  it('decodes unquantized arcs verbatim', () => {
    expect(
      decodeArc(
        {
          arcs: [
            [
              [1, 2],
              [3, 4],
            ],
          ],
        },
        0,
      ),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe('feature', () => {
  it('builds closed polygon rings from arcs (joint points de-duplicated)', () => {
    const fc = feature(topo, 'squares');
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBe(2);
    const left = fc.features[0];
    expect(left.id).toBe('L');
    expect(left.properties.name).toBe('left');
    expect(left.geometry.type).toBe('Polygon');
    expect(left.geometry.coordinates[0]).toEqual([
      [10, 20],
      [10, 21],
      [9, 21],
      [9, 20],
      [10, 20],
    ]);
    const right = fc.features[1].geometry.coordinates[0];
    expect(right[0]).toEqual([10, 21]);
    expect(right[right.length - 1]).toEqual([10, 21]);
    expect(right.length).toBe(5);
  });
  it('decodes points and single geometries', () => {
    expect(feature(topo, 'pt').geometry).toEqual({ type: 'Point', coordinates: [11, 21] });
    expect(feature(topo, 'one').type).toBe('Feature');
  });
  it('throws on an unknown object', () => {
    expect(() => feature(topo, 'nope')).toThrow();
  });
});

describe('mesh', () => {
  it('returns every arc once without a filter', () => {
    const m = mesh(topo, 'squares');
    expect(m.type).toBe('MultiLineString');
    expect(m.coordinates.length).toBe(3);
  });
  it('keeps only interior borders with (a, b) => a !== b', () => {
    expect(meshArcs(topo, 'squares', (a, b) => a !== b)).toEqual([0]);
    const m = mesh(topo, 'squares', (a, b) => a !== b);
    expect(m.coordinates).toEqual([
      [
        [10, 20],
        [10, 21],
      ],
    ]);
  });
  it('keeps only exterior arcs with (a, b) => a === b', () => {
    expect(meshArcs(topo, 'squares', (a, b) => a === b).sort()).toEqual([1, 2]);
  });
});

describe('bundled Canada provinces topology', () => {
  it('decodes to 17 boundary lines inside Canada', () => {
    const m = mesh(canada, 'provinces');
    expect(m.coordinates.length).toBe(17);
    for (const line of m.coordinates) {
      expect(line.length).toBeGreaterThan(1);
      for (const [lon, lat] of line) {
        expect(lon).toBeGreaterThan(-142);
        expect(lon).toBeLessThan(-52);
        expect(lat).toBeGreaterThan(41);
        expect(lat).toBeLessThan(84);
      }
    }
  });
  it('contains the 49th-parallel-free AB/SK border near 110°W', () => {
    const m = mesh(canada, 'provinces');
    const near110 = m.coordinates.some((line) => line.every(([lon]) => Math.abs(lon + 110) < 0.2) && line.length >= 2);
    expect(near110).toBe(true);
  });
});
