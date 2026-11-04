import { describe, it, expect } from 'vitest';
import {
  MAX_MERCATOR_LAT,
  wrapLon,
  lonToTileX,
  latToTileY,
  tileToLonLat,
  normalizeBbox,
  bboxAroundPoint,
  bboxContains,
  bboxCenter,
  tileRangesForBbox,
  countTiles,
  countTilesPerZoom,
  enumerateTiles,
  tileInBbox,
  estimatePackBytes,
  formatBytes,
  subdomainFor,
  buildTileUrl,
  isOfflinePackStyle,
  offlinePackStyleIds,
  DEFAULT_AVG_TILE_BYTES,
} from './offlineTiles.js';

describe('tile coordinates', () => {
  it('maps the world corners and centre at zoom 0..2', () => {
    expect(lonToTileX(-180, 0)).toBe(0);
    expect(latToTileY(MAX_MERCATOR_LAT, 0)).toBe(0);
    expect(lonToTileX(0, 1)).toBe(1);
    expect(lonToTileX(-0.0001, 1)).toBe(0);
    expect(latToTileY(0.0001, 1)).toBe(0);
    expect(latToTileY(-0.0001, 1)).toBe(1);
    expect(lonToTileX(180, 2)).toBe(3); // clamped into the last column
    expect(latToTileY(-90, 2)).toBe(3); // poles clamp to the Mercator limit
  });

  it('matches known OSM tile numbers (Boulder, CO)', () => {
    // Verified against the USGS Topo service: z9 x106 y193 is Boulder.
    expect(lonToTileX(-105.2705, 9)).toBe(106);
    expect(latToTileY(40.015, 9)).toBe(193);
    expect(lonToTileX(-105.2705, 12)).toBe(850);
    expect(latToTileY(40.015, 12)).toBe(1550);
  });

  it('tileToLonLat is the inverse at tile corners', () => {
    const { lon, lat } = tileToLonLat(850, 1550, 12);
    expect(lonToTileX(lon + 1e-9, 12)).toBe(850);
    expect(latToTileY(lat - 1e-9, 12)).toBe(1550);
  });

  it('wraps longitudes', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(180);
    expect(wrapLon(-180)).toBe(-180);
    expect(wrapLon(360 + 10)).toBe(10);
  });
});

describe('normalizeBbox', () => {
  it('rejects junk', () => {
    expect(normalizeBbox(null)).toBeNull();
    expect(normalizeBbox({ west: 0, south: 0, east: NaN, north: 1 })).toBeNull();
    expect(normalizeBbox({ west: 1, south: 0, east: 1, north: 1 })).toBeNull();
    expect(normalizeBbox({ west: 0, south: 5, east: 1, north: 5 })).toBeNull();
  });

  it('orders and clamps latitudes', () => {
    expect(normalizeBbox({ west: 0, south: 89, east: 1, north: -89 })).toEqual({
      west: 0,
      south: -MAX_MERCATOR_LAT,
      east: 1,
      north: MAX_MERCATOR_LAT,
    });
  });

  it('turns a 360°+ map view into the whole world', () => {
    expect(normalizeBbox({ west: -400, south: -10, east: 300, north: 10 })).toEqual({
      west: -180,
      south: -10,
      east: 180,
      north: 10,
    });
  });

  it('wraps a Leaflet view panned past the antimeridian', () => {
    const b = normalizeBbox({ west: -200, south: 0, east: -170, north: 10 });
    expect(b.west).toBe(160);
    expect(b.east).toBe(-170);
  });
});

describe('bboxAroundPoint / contains / center', () => {
  it('covers the requested radius', () => {
    const b = bboxAroundPoint(40, -105, 50);
    expect(b.north - b.south).toBeCloseTo((2 * 50) / 111.19, 2);
    // Longitude span widens with latitude
    expect(b.east - b.west).toBeGreaterThan(b.north - b.south);
    expect(bboxContains(b, 40, -105)).toBe(true);
    expect(bboxContains(b, 41, -105)).toBe(false);
  });

  it('rejects bad input', () => {
    expect(bboxAroundPoint(NaN, 0, 10)).toBeNull();
    expect(bboxAroundPoint(0, 0, 0)).toBeNull();
  });

  it('handles the antimeridian', () => {
    const b = bboxAroundPoint(-17, 179.9, 50); // Fiji
    expect(b.west).toBeGreaterThan(b.east);
    expect(bboxContains(b, -17, -179.9)).toBe(true);
    expect(bboxContains(b, -17, 0)).toBe(false);
    expect(bboxCenter(b).lon).toBeCloseTo(179.9, 5);
  });
});

describe('tile ranges and counts', () => {
  it('one tile at zoom 0 for any area', () => {
    expect(countTiles({ west: -10, south: -10, east: 10, north: 10 }, 0, 0)).toBe(1);
  });

  it('counts the whole world correctly', () => {
    const world = { west: -180, south: -85, east: 180, north: 85 };
    expect(countTiles(world, 0, 2)).toBe(1 + 4 + 16);
    expect(countTilesPerZoom(world, 1, 2)).toEqual([
      { z: 1, count: 4 },
      { z: 2, count: 16 },
    ]);
  });

  it('splits an antimeridian box into two ranges', () => {
    const ranges = tileRangesForBbox({ west: 170, south: -20, east: -170, north: -10 }, 6);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].maxX).toBe(63);
    expect(ranges[1].minX).toBe(0);
  });

  it('merges halves that overlap at low zoom', () => {
    const ranges = tileRangesForBbox({ west: 10, south: -20, east: 5, north: -10 }, 1);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ minX: 0, maxX: 1 });
  });

  it('enumerates exactly countTiles tiles, low zoom first, no duplicates', () => {
    const b = bboxAroundPoint(40.015, -105.27, 25);
    const tiles = [...enumerateTiles(b, 6, 11)];
    expect(tiles.length).toBe(countTiles(b, 6, 11));
    expect(tiles[0].z).toBe(6);
    expect(tiles[tiles.length - 1].z).toBe(11);
    expect(new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(tiles.length);
    expect(tiles.every((t) => tileInBbox(b, t))).toBe(true);
  });

  it('a 50 km pack at z6–z12 is a few hundred tiles', () => {
    const n = countTiles(bboxAroundPoint(40.015, -105.27, 50), 6, 12);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(600);
  });

  it('tileInBbox rejects tiles outside', () => {
    const b = bboxAroundPoint(40, -105, 10);
    expect(tileInBbox(b, { z: 10, x: 0, y: 0 })).toBe(false);
    expect(tileInBbox(b, null)).toBe(false);
  });

  it('guards bad zoom input', () => {
    expect(countTiles({ west: 0, south: 0, east: 1, north: 1 }, 5, 4)).toBe(0);
    expect([...enumerateTiles({ west: 0, south: 0, east: 1, north: 1 }, 1.5, 3)]).toEqual([]);
  });
});

describe('size estimates', () => {
  it('multiplies by the average tile size', () => {
    expect(estimatePackBytes(100, 1000)).toBe(100000);
    expect(estimatePackBytes(10)).toBe(10 * DEFAULT_AVG_TILE_BYTES);
    expect(estimatePackBytes(10, 0)).toBe(10 * DEFAULT_AVG_TILE_BYTES);
    expect(estimatePackBytes(undefined)).toBe(0);
  });

  it('formats bytes', () => {
    expect(formatBytes(950)).toBe('950 B');
    expect(formatBytes(12.3 * 1024)).toBe('12.3 KB');
    expect(formatBytes(4.6 * 1024 * 1024)).toBe('4.6 MB');
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.20 GB');
  });
});

describe('tile URLs', () => {
  it('uses the same subdomain formula as Leaflet', () => {
    expect(subdomainFor(0, 0, 'abc')).toBe('a');
    expect(subdomainFor(1, 0, 'abc')).toBe('b');
    expect(subdomainFor(1, 1, 'abc')).toBe('c');
    expect(subdomainFor(2, 2, ['x', 'y'])).toBe('x');
    expect(subdomainFor(2, 2, '')).toBe('');
  });

  it('fills z/x/y in the order the template asks for', () => {
    expect(
      buildTileUrl('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
        z: 9,
        x: 106,
        y: 193,
      }),
    ).toBe('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/9/193/106');
  });

  it('fills {s}, {r} and {lang}, and leaves unknown placeholders visible', () => {
    expect(
      buildTileUrl(
        'https://{s}.example/{z}/{x}/{y}{r}.png?l={lang}&k={key}',
        { z: 1, x: 1, y: 0 },
        { lang: 'de', retina: true },
      ),
    ).toBe('https://b.example/1/1/0@2x.png?l=de&k={key}');
  });
});

describe('style eligibility', () => {
  it('needs an explicit offlinePack flag and a URL', () => {
    expect(isOfflinePackStyle({ url: 'https://x/{z}/{x}/{y}', offlinePack: true })).toBe(true);
    expect(isOfflinePackStyle({ url: 'https://x/{z}/{x}/{y}' })).toBe(false);
    expect(isOfflinePackStyle({ url: '', offlinePack: true })).toBe(false);
    expect(isOfflinePackStyle({ url: 'x', offlinePack: true, isCanvas: true })).toBe(false);
    expect(offlinePackStyleIds({ a: { url: 'u', offlinePack: true }, b: { url: 'u' } })).toEqual(['a']);
  });
});
