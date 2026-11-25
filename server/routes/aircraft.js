/**
 * Aircraft tracking route — community ADS-B aggregator (#996).
 *
 * Originally proxied OpenSky's /api/states/all, but their anonymous quota is
 * 400 req/day per source IP, which is exhausted within minutes on shared-
 * egress hosting like Railway (where dozens of unrelated services hit the
 * same endpoint from the same IP). Authenticated OpenSky requires per-account
 * setup that was friction for deployers.
 *
 * Switched (2026-05-19) to adsb.lol's community feed — same data, free, no
 * auth, no quota, supports very large radius queries. A single
 * `/v2/lat/0/lon/0/dist/10000` query returns the entire flying world in
 * ~3 MB / ~1 s. We cache that response shared-server-side so all OHC users
 * share a single upstream pull.
 *
 * 2026-11 (#1284): adsb.lol now refuses any radius over 250 NM
 * ("HTTP 403: radius exceeds 250 NM"), so the whole-world query is gone.
 * Clients now pass ?lat=&lon= (the station for the Nearby panel, the map
 * centre for the layers) and we fetch 250 NM around that point, snapped to
 * a 0.5° cell so nearby viewers share one upstream pull. Each cell is cached
 * for 60 s; upstream pulls are capped per minute across all cells.
 *
 * Wire format to the client deliberately uses adsb.lol's natural aviation
 * units (feet, knots) rather than OpenSky's metric (meters, m/s) so the
 * client doesn't have to round-trip-convert for display.
 */

// adsb.lol's maximum query radius
const RADIUS_NM = 250;
// Query points snap to this grid. The worst-case offset from the user to the
// cell centre is half the cell diagonal (~21 NM at the equator, less
// elsewhere), so everything within ~229 NM (~424 km) of the user is covered.
const CELL_DEG = 0.5;
const MAX_CELLS = 300; // LRU cap on cached cells
const MAX_UPSTREAM_PER_MIN = 40; // across all cells — be a good neighbour

/** Snap a point to the centre of its CELL_DEG cell; null when not a valid position. */
function cellFor(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90) return null;
  const wrapped = ((((lo + 180) % 360) + 360) % 360) - 180;
  const snap = (v) => Math.round(v / CELL_DEG) * CELL_DEG;
  const cLat = Math.max(-90, Math.min(90, snap(la)));
  let cLon = snap(wrapped);
  if (cLon >= 180) cLon -= 360;
  return { lat: cLat, lon: cLon, key: `${cLat.toFixed(1)},${cLon.toFixed(1)}` };
}

function upstreamUrl(cell) {
  return `https://api.adsb.lol/v2/lat/${cell.lat}/lon/${cell.lon}/dist/${RADIUS_NM}`;
}

function aircraftRoute(app, ctx) {
  const { fetch, logDebug, logErrorOnce, APP_VERSION } = ctx;

  // 60 s cache balances freshness against being a good neighbour to a free
  // community feed. Stale-on-error up to 5 min so a transient outage doesn't
  // blank the map.
  const AIRCRAFT_CACHE_TTL = 60 * 1000;
  const AIRCRAFT_STALE_TTL = 5 * 60 * 1000;
  const AIRCRAFT_FETCH_TIMEOUT_MS = 25000;

  // key → { data, timestamp }; Map insertion order doubles as LRU order
  const cache = new Map();
  const inFlight = new Map(); // key → Promise
  let lastError = null;
  let upstreamTimes = [];

  function remember(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > MAX_CELLS) cache.delete(cache.keys().next().value);
  }

  function upstreamAllowed(now) {
    upstreamTimes = upstreamTimes.filter((t) => now - t < 60 * 1000);
    if (upstreamTimes.length >= MAX_UPSTREAM_PER_MIN) return false;
    upstreamTimes.push(now);
    return true;
  }

  async function fetchAircraft(cell) {
    const res = await fetch(upstreamUrl(cell), {
      headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
      signal: AbortSignal.timeout(AIRCRAFT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`adsb.lol HTTP ${res.status}${text ? ': ' + text.slice(0, 120) : ''}`);
    }
    const body = await res.json();
    if (!body || !Array.isArray(body.ac)) {
      throw new Error('adsb.lol returned unexpected payload (missing `ac` array)');
    }

    // Project to a compact wire format. Drop entries without a position fix
    // — clients can't plot them anyway.
    const aircraft = [];
    for (const a of body.ac) {
      if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
      // alt_geom (GPS) preferred; falls back to alt_baro (barometric). Some
      // entries also use the string "ground" instead of a numeric altitude;
      // treat that as on-ground with no altitude.
      let alt = a.alt_geom ?? a.alt_baro;
      const onGround = alt === 'ground' || a.alt_baro === 'ground';
      if (typeof alt !== 'number') alt = null;

      aircraft.push({
        id: a.hex || '',
        call: (a.flight || '').trim(),
        lat: a.lat,
        lon: a.lon,
        alt_ft: alt, // feet — adsb.lol's native unit
        speed_kn: typeof a.gs === 'number' ? a.gs : null, // knots
        heading: typeof a.track === 'number' ? a.track : null,
        onGround,
        squawk: a.squawk || null,
        type: a.t || null, // e.g. "B737", "A320", "C172"
        desc: a.desc || null, // e.g. "BOEING 737-700"
        operator: a.ownOp || null, // e.g. "UNITED AIRLINES INC"
        registration: a.r || null,
      });
    }
    return aircraft;
  }

  app.get('/api/aircraft', async (req, res) => {
    const now = Date.now();
    const cell = cellFor(req.query?.lat, req.query?.lon);
    if (!cell) {
      // Clients from before #1284 ask without a location. adsb.lol can't
      // serve the whole world any more, so tell them what's needed.
      res.set('Cache-Control', 'no-store');
      return res.status(400).json({
        error: 'lat and lon are required',
        reason: `adsb.lol limits queries to ${RADIUS_NM} NM around a point`,
        aircraft: [],
      });
    }
    const meta = { center: { lat: cell.lat, lon: cell.lon }, radiusNm: RADIUS_NM };
    const cached = cache.get(cell.key);

    // Fresh cache hit
    if (cached && now - cached.timestamp < AIRCRAFT_CACHE_TTL) {
      return res.json({ aircraft: cached.data, cached: true, age: now - cached.timestamp, ...meta });
    }

    // Stale + refresh already running: serve stale, let the refresh finish
    if (cached && inFlight.has(cell.key)) {
      return res.json({ aircraft: cached.data, cached: true, stale: true, age: now - cached.timestamp, ...meta });
    }

    // Need a refresh. Dedupe so concurrent requests for a cell share one upstream call.
    let pending = inFlight.get(cell.key);
    if (!pending) {
      if (!upstreamAllowed(now)) {
        if (cached && now - cached.timestamp < AIRCRAFT_STALE_TTL) {
          return res.json({ aircraft: cached.data, cached: true, stale: true, age: now - cached.timestamp, ...meta });
        }
        res.set('Cache-Control', 'no-store');
        res.set('Retry-After', '30');
        return res.status(503).json({ error: 'Aircraft feed busy', reason: 'upstream rate cap', aircraft: [] });
      }
      pending = fetchAircraft(cell)
        .then((aircraft) => {
          remember(cell.key, { data: aircraft, timestamp: Date.now() });
          lastError = null;
          logDebug(`[Aircraft] adsb.lol ${cell.key}: ${aircraft.length} aircraft with position`);
          return aircraft;
        })
        .catch((e) => {
          lastError = e.message;
          logErrorOnce('Aircraft', e.message);
          return null; // don't poison the cache on failure
        })
        .finally(() => inFlight.delete(cell.key));
      inFlight.set(cell.key, pending);
    }

    try {
      const data = await pending;
      if (data) return res.json({ aircraft: data, cached: false, age: 0, ...meta });
      // Refresh failed — serve stale if it's not too old, else an error
      if (cached && now - cached.timestamp < AIRCRAFT_STALE_TTL) {
        res.set('X-Aircraft-Stale', 'true');
        return res.json({ aircraft: cached.data, cached: true, stale: true, ...meta });
      }
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'Aircraft feed unavailable', reason: lastError || 'unknown', aircraft: [] });
    } catch (e) {
      logErrorOnce('Aircraft', e.message);
      return res.status(500).json({ error: 'Aircraft feed error', reason: e.message, aircraft: [] });
    }
  });
}

module.exports = aircraftRoute;
module.exports.cellFor = cellFor;
module.exports.RADIUS_NM = RADIUS_NM;
