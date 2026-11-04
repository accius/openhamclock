/**
 * Minimal TopoJSON decoder — the `feature` / `mesh` subset of topojson-client,
 * implemented here (≈120 lines) instead of adding a dependency.
 *
 * Handles quantized topologies (`transform` with scale/translate and
 * delta-encoded arcs) and unquantized ones, negative (reversed) arc indices,
 * and the usual geometry types. Coordinates come back in GeoJSON order
 * ([lon, lat]) exactly like topojson-client; callers flip for Leaflet.
 *
 *   feature(topology, object)        → GeoJSON Feature | FeatureCollection
 *   mesh(topology, object, filter?)  → GeoJSON MultiLineString of the arcs
 *                                       used by `object`; `filter(a, b)`
 *                                       receives the two geometries sharing an
 *                                       arc (a === b on an exterior arc), e.g.
 *                                       (a, b) => a !== b for interior borders.
 */

/** Decode one arc index into absolute [lon, lat] points (handles ~index reversal). */
export function decodeArc(topology, index) {
  const reversed = index < 0;
  const arc = topology.arcs[reversed ? ~index : index];
  if (!arc) return [];
  const t = topology.transform;
  let x = 0;
  let y = 0;
  const points = arc.map((p) => {
    if (t) {
      x += p[0];
      y += p[1];
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    }
    return [p[0], p[1]];
  });
  return reversed ? points.reverse() : points;
}

/** Decode a quantized point ([x, y] in topology space) to [lon, lat]. */
function decodePoint(topology, p) {
  const t = topology.transform;
  return t ? [p[0] * t.scale[0] + t.translate[0], p[1] * t.scale[1] + t.translate[1]] : [p[0], p[1]];
}

/** Stitch a list of arc indices into one line (dropping duplicated joints). */
function decodeLine(topology, arcIndices) {
  const line = [];
  for (const idx of arcIndices) {
    const pts = decodeArc(topology, idx);
    for (let i = 0; i < pts.length; i++) {
      if (i === 0 && line.length) continue; // joint shared with previous arc
      line.push(pts[i]);
    }
  }
  return line;
}

function decodeRing(topology, arcIndices) {
  const ring = decodeLine(topology, arcIndices);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push(ring[0]);
  }
  return ring;
}

function geometryToGeoJson(topology, g) {
  if (!g) return null;
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: decodePoint(topology, g.coordinates) };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: g.coordinates.map((p) => decodePoint(topology, p)) };
    case 'LineString':
      return { type: 'LineString', coordinates: decodeLine(topology, g.arcs) };
    case 'MultiLineString':
      return { type: 'MultiLineString', coordinates: g.arcs.map((a) => decodeLine(topology, a)) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.arcs.map((a) => decodeRing(topology, a)) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.arcs.map((poly) => poly.map((a) => decodeRing(topology, a))) };
    case 'GeometryCollection':
      return { type: 'GeometryCollection', geometries: g.geometries.map((x) => geometryToGeoJson(topology, x)) };
    default:
      return null;
  }
}

function toFeature(topology, g) {
  const f = { type: 'Feature', properties: g.properties || {}, geometry: geometryToGeoJson(topology, g) };
  if (g.id != null) f.id = g.id;
  return f;
}

/** topology + object (or object name) → Feature / FeatureCollection. */
export function feature(topology, object) {
  const o = typeof object === 'string' ? topology.objects[object] : object;
  if (!o) throw new Error('topojson: unknown object');
  if (o.type === 'GeometryCollection') {
    return { type: 'FeatureCollection', features: o.geometries.map((g) => toFeature(topology, g)) };
  }
  return toFeature(topology, o);
}

/** Visit every arc index of a geometry, with the geometry that owns it. */
function eachArc(g, fn) {
  if (!g) return;
  switch (g.type) {
    case 'LineString':
      g.arcs.forEach((i) => fn(i, g));
      break;
    case 'MultiLineString':
    case 'Polygon':
      g.arcs.forEach((line) => line.forEach((i) => fn(i, g)));
      break;
    case 'MultiPolygon':
      g.arcs.forEach((poly) => poly.forEach((ring) => ring.forEach((i) => fn(i, g))));
      break;
    case 'GeometryCollection':
      g.geometries.forEach((x) => eachArc(x, fn));
      break;
    default:
      break;
  }
}

/**
 * Arc indices used by `object`, optionally filtered by the two geometries
 * that share each arc. Exported for painters that want raw arcs.
 */
export function meshArcs(topology, object, filter) {
  const o = typeof object === 'string' ? topology.objects[object] : object;
  if (!o) throw new Error('topojson: unknown object');
  const owners = new Map(); // arc index → [geomA, geomB]
  eachArc(o, (i, g) => {
    const key = i < 0 ? ~i : i;
    const list = owners.get(key);
    if (!list) owners.set(key, [g, g]);
    else if (list[0] === g)
      return; // same ring touching the arc twice
    else list[1] = g;
  });
  const out = [];
  for (const [i, [a, b]] of owners) {
    if (!filter || filter(a, b)) out.push(i);
  }
  return out;
}

/** GeoJSON MultiLineString of the (filtered) arcs of `object`. */
export function mesh(topology, object, filter) {
  return {
    type: 'MultiLineString',
    coordinates: meshArcs(topology, object, filter).map((i) => decodeArc(topology, i)),
  };
}

export default { feature, mesh, meshArcs, decodeArc };
