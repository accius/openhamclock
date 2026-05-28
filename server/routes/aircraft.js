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
 * Wire format to the client deliberately uses adsb.lol's natural aviation
 * units (feet, knots) rather than OpenSky's metric (meters, m/s) so the
 * client doesn't have to round-trip-convert for display.
 */

module.exports = function (app, ctx) {
  const { fetch, logDebug, logInfo, logWarn, logErrorOnce, APP_VERSION } = ctx;

  // 60 s cache balances freshness against being a good neighbour to a free
  // community feed. Stale-on-error up to 5 min so a transient outage doesn't
  // blank the map for everyone.
  const AIRCRAFT_CACHE_TTL = 60 * 1000;
  const AIRCRAFT_STALE_TTL = 5 * 60 * 1000;
  const AIRCRAFT_FETCH_TIMEOUT_MS = 25000;
  // 10000 nm radius from (0,0) covers the entire globe (great-circle 5400 nm
  // pole-to-pole), with margin for transpolar flights at higher latitudes.
  const UPSTREAM_URL = 'https://api.adsb.lol/v2/lat/0/lon/0/dist/10000';

  let aircraftCache = { data: null, timestamp: 0 };
  let inFlight = null;
  let lastError = null;

  async function fetchAircraft() {
    const res = await fetch(UPSTREAM_URL, {
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

    // Fresh cache hit
    if (aircraftCache.data && now - aircraftCache.timestamp < AIRCRAFT_CACHE_TTL) {
      return res.json({ aircraft: aircraftCache.data, cached: true, age: now - aircraftCache.timestamp });
    }

    // Stale-but-recent + in-flight refresh: serve stale, let background refresh complete
    if (aircraftCache.data && inFlight) {
      return res.json({
        aircraft: aircraftCache.data,
        cached: true,
        stale: true,
        age: now - aircraftCache.timestamp,
      });
    }

    // Need a refresh. Dedupe so concurrent /api/aircraft requests share one upstream call.
    if (!inFlight) {
      inFlight = fetchAircraft()
        .then((aircraft) => {
          aircraftCache = { data: aircraft, timestamp: Date.now() };
          lastError = null;
          logDebug(`[Aircraft] adsb.lol returned ${aircraft.length} aircraft with position`);
          return aircraft;
        })
        .catch((e) => {
          lastError = e.message;
          logErrorOnce('Aircraft', e.message);
          // Don't poison cache on failure
          return null;
        })
        .finally(() => {
          inFlight = null;
        });
    }

    try {
      const data = await inFlight;
      if (data) {
        return res.json({ aircraft: data, cached: false, age: 0 });
      }
      // Refresh failed — serve stale if we have it and it's not too old, else empty
      if (aircraftCache.data && now - aircraftCache.timestamp < AIRCRAFT_STALE_TTL) {
        res.set('X-Aircraft-Stale', 'true');
        return res.json({ aircraft: aircraftCache.data, cached: true, stale: true });
      }
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({
        error: 'Aircraft feed unavailable',
        reason: lastError || 'unknown',
        aircraft: [],
      });
    } catch (e) {
      logErrorOnce('Aircraft', e.message);
      return res.status(500).json({ error: 'Aircraft feed error', reason: e.message, aircraft: [] });
    }
  });
};
