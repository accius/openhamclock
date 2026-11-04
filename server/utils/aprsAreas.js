/**
 * aprsAreas — viewer areas and the union APRS-IS filter.
 *
 * The server keeps one APRS-IS connection (cluster etiquette: never one per
 * viewer, never poll-and-disconnect). Each viewer with internet APRS on asks
 * for the stations around its own location; the feed's filter is the union
 * of those areas, as space-separated `r/lat/lon/km` terms, and each request
 * is then cut back to that viewer's own circle (haversine).
 *
 * Areas are keyed by their rounded term rather than by viewer, so two
 * viewers in the same town share one entry and nothing about who asked is
 * kept. An area expires when no viewer has asked for it in AREA_TTL_MS.
 *
 * Pure module: no timers, no sockets. The route (server/routes/aprs.js)
 * owns the connection and decides when to send `#filter`.
 */

const { haversineDistance } = require('./grid');

const RADIUS_MIN_KM = 10;
const RADIUS_MAX_KM = 1000;
const AREA_TTL_MS = 10 * 60 * 1000; // no request for 10 min → area gone
const MAX_FILTER_TERMS = 50;
// aprsc silently ignores a filter line longer than ~510 bytes (checked live,
// Oct 2026: 35 terms / 500 bytes applied, 30 long terms / 663 bytes did not —
// no error, no "# filter ... active" echo). The login line carries the filter
// after ~55 bytes of `user ... vers ...`, so keep the filter itself under 440.
const MAX_FILTER_CHARS = 440;
const MAX_AREAS = 2000; // distinct rounded areas tracked (memory bound)

// Radius buckets (km). A term's radius is rounded UP to one of these after
// adding the slack its rounded centre needs, so the term always covers the
// viewer's real circle and nearby viewers land on the same term.
const RADIUS_BUCKETS_KM = [50, 100, 150, 200, 300, 400, 600, 800, 1100, 1500, 2000, 2500, 3000];

// Grid steps (degrees) tried in turn when the union does not fit
// (MAX_FILTER_TERMS / MAX_FILTER_CHARS): coarser centres merge more viewers
// into one term.
const GRID_STEPS_DEG = [0.5, 1, 2, 5, 10];

const num = (v) => (v === '' || v == null ? NaN : Number(v));

/**
 * Validate a viewer area from query params. Returns { lat, lon, radius } or
 * null when lat/lon are missing or out of range. Radius is clamped to
 * RADIUS_MIN_KM–RADIUS_MAX_KM (a missing radius gets the panel default).
 */
function normalizeArea({ lat, lon, radius } = {}) {
  const la = num(lat);
  const lo = num(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  let r = num(radius);
  if (!Number.isFinite(r)) r = 250;
  r = Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, Math.round(r)));
  return { lat: la, lon: lo, radius: r };
}

const roundTo = (v, step) => Math.round(v / step) * step;
// Trim float noise for the wire: 40.5, not 40.50000000001
const fmt = (v) => String(Number(v.toFixed(2)));

function bucketRadius(km) {
  for (const b of RADIUS_BUCKETS_KM) if (km <= b) return b;
  return RADIUS_BUCKETS_KM[RADIUS_BUCKETS_KM.length - 1];
}

/**
 * Round an area onto a grid of `step` degrees. Rounding moves the centre
 * by at most half a step in each axis, so the radius grows by that
 * half-diagonal (~78.6 km per degree of step) before bucketing.
 */
function roundArea(area, step = GRID_STEPS_DEG[0]) {
  // Every grid step divides 90 and 180, so rounded values stay in range
  const lat = roundTo(area.lat, step);
  const lon = roundTo(area.lon, step);
  const slack = Math.ceil(((step / 2) * Math.SQRT2 * Math.PI * 6371) / 180);
  return { lat, lon, radius: bucketRadius(area.radius + slack) };
}

const termOf = (a) => `r/${fmt(a.lat)}/${fmt(a.lon)}/${a.radius}`;

/** Drop terms whose circle lies inside another term's circle. */
function dropContained(areas) {
  // Largest first, so a small circle is tested against the big ones
  const sorted = [...areas].sort((a, b) => b.radius - a.radius);
  const kept = [];
  for (const a of sorted) {
    const inside = kept.some((k) => haversineDistance(a.lat, a.lon, k.lat, k.lon) + a.radius <= k.radius);
    if (!inside) kept.push(a);
  }
  return kept;
}

function unionAt(areas, step) {
  const byTerm = new Map();
  for (const a of areas) {
    const r = roundArea(a, step);
    const term = termOf(r);
    const prev = byTerm.get(term);
    // Newest request wins the sort key, so capping drops the stalest
    if (!prev || a.lastSeen > prev.lastSeen) byTerm.set(term, { ...r, lastSeen: a.lastSeen });
  }
  return dropContained([...byTerm.values()]);
}

/**
 * Build the union filter string from active areas plus the .env filter.
 * Tries ever coarser grids until the terms fit in `maxTerms` and
 * `maxChars`; if even the coarsest grid is too big, the most recently
 * requested terms are kept. The .env filter always goes first and is never
 * cut. Output is sorted so the same set of areas always gives the same
 * string (an unchanged filter is never re-sent).
 */
function buildUnionFilter(areas, { baseFilter = '', maxTerms = MAX_FILTER_TERMS, maxChars = MAX_FILTER_CHARS } = {}) {
  const base = String(baseFilter || '').trim();
  const roomTerms = maxTerms - (base ? base.split(/\s+/).length : 0);
  const roomChars = maxChars - (base ? base.length + 1 : 0);
  // Joined length of a term list, with the separating spaces
  const length = (list) => list.reduce((n, t) => n + termOf(t).length + 1, 0) - 1;
  const fits = (list) => list.length <= roomTerms && length(list) <= roomChars;
  let terms = [];
  if (areas.length && roomTerms > 0 && roomChars > 0) {
    for (const step of GRID_STEPS_DEG) {
      terms = unionAt(areas, step);
      if (fits(terms)) break;
    }
    if (!fits(terms)) {
      const kept = [];
      for (const t of terms.sort((a, b) => b.lastSeen - a.lastSeen)) {
        if (!fits([...kept, t])) break;
        kept.push(t);
      }
      terms = kept;
    }
  }
  const parts = terms.map(termOf).sort();
  if (base) parts.unshift(base);
  return parts.join(' ');
}

/** Is a station inside a viewer's circle? */
function inArea(station, area) {
  if (station?.lat == null || station?.lon == null) return false;
  return haversineDistance(area.lat, area.lon, station.lat, station.lon) <= area.radius;
}

/**
 * Registry of requested areas. Keyed by the area rounded onto the finest
 * grid; each entry keeps the latest unrounded request so coarser merges
 * (see buildUnionFilter) start from real centres.
 */
class AreaRegistry {
  constructor({ ttlMs = AREA_TTL_MS, maxAreas = MAX_AREAS } = {}) {
    this.ttlMs = ttlMs;
    this.maxAreas = maxAreas;
    this.areas = new Map(); // fine term → { lat, lon, radius, lastSeen }
  }

  static keyOf(area) {
    return termOf(roundArea(area));
  }

  has(area) {
    return this.areas.has(AreaRegistry.keyOf(area));
  }

  /** Record a request. Returns true when this is a new area (filter must change). */
  touch(area, now = Date.now()) {
    const key = AreaRegistry.keyOf(area);
    const isNew = !this.areas.has(key);
    // Delete + set keeps Map order = least recently seen first
    this.areas.delete(key);
    this.areas.set(key, { lat: area.lat, lon: area.lon, radius: area.radius, lastSeen: now });
    if (this.areas.size > this.maxAreas) {
      this.areas.delete(this.areas.keys().next().value);
    }
    return isNew;
  }

  /** Remove areas nobody asked for within the TTL. Returns how many went. */
  expire(now = Date.now()) {
    let removed = 0;
    for (const [k, v] of this.areas) {
      if (now - v.lastSeen > this.ttlMs) {
        this.areas.delete(k);
        removed++;
      }
    }
    return removed;
  }

  list() {
    return [...this.areas.values()];
  }

  get size() {
    return this.areas.size;
  }
}

module.exports = {
  RADIUS_MIN_KM,
  RADIUS_MAX_KM,
  AREA_TTL_MS,
  MAX_FILTER_TERMS,
  MAX_FILTER_CHARS,
  RADIUS_BUCKETS_KM,
  normalizeArea,
  roundArea,
  buildUnionFilter,
  inArea,
  AreaRegistry,
};
