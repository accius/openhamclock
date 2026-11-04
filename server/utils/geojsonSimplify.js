'use strict';
/**
 * Tiny GeoJSON helpers for server-side slimming of alert polygons:
 * Douglas–Peucker ring simplification, geometry walking, centroids.
 * Coordinates are GeoJSON order ([lon, lat]).
 */

function perpDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker; `tolerance` in degrees. Iterative to avoid deep recursion. */
function simplifyRing(ring, tolerance = 0.01) {
  if (!Array.isArray(ring) || ring.length < 4 || !(tolerance > 0)) return ring || [];
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(ring[i], ring[s], ring[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  // A closed ring needs at least 4 points
  if (out.length < 4)
    return ring.length >= 4
      ? [ring[0], ring[Math.floor(ring.length / 3)], ring[Math.floor((2 * ring.length) / 3)], ring[ring.length - 1]]
      : ring;
  return out;
}

/** Simplify every ring of a Polygon / MultiPolygon; other types pass through. */
function simplifyGeometry(geometry, tolerance = 0.01) {
  if (!geometry || !geometry.coordinates) return geometry;
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map((r) => simplifyRing(r, tolerance)) };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map((poly) => poly.map((r) => simplifyRing(r, tolerance))),
    };
  }
  return geometry;
}

/** Merge several Polygon/MultiPolygon geometries into one MultiPolygon (no union — just concatenation). */
function mergePolygons(geometries) {
  const polys = [];
  for (const g of geometries) {
    if (!g || !g.coordinates) continue;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  if (!polys.length) return null;
  return { type: 'MultiPolygon', coordinates: polys };
}

/** Count points in a geometry. */
function pointCount(geometry) {
  if (!geometry || !geometry.coordinates) return 0;
  const walk = (c) => (typeof c[0] === 'number' ? 1 : c.reduce((n, x) => n + walk(x), 0));
  return walk(geometry.coordinates);
}

/** Mean of outer-ring vertices → { lat, lon }, or null. */
function centroid(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  const rings =
    geometry.type === 'Polygon'
      ? [geometry.coordinates[0]]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates.map((p) => p[0])
        : [];
  for (const ring of rings) {
    for (const [lon, lat] of ring || []) {
      sx += lon;
      sy += lat;
      n++;
    }
  }
  if (!n) return null;
  return { lat: Math.round((sy / n) * 1000) / 1000, lon: Math.round((sx / n) * 1000) / 1000 };
}

module.exports = { simplifyRing, simplifyGeometry, mergePolygons, pointCount, centroid, perpDistance };
