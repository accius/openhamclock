/**
 * Station benchmark — how is YOUR signal heard versus nearby stations?
 *
 * GET /api/benchmark?callsign=K1ME&lat=42.0&lon=-71.0&radius=300
 *   → { call, radiusKm, windowDays, neighbours, mySpots, bands: [...], explanation,
 *       source: 'rbn', pskreporter: false, generatedAt, store: { stations, located, buckets } }
 *
 * Data: the RBN telnet stream rbn.js already consumes (ctx.onRbnSpot tap —
 * every spot of every station, not just yours), aggregated per (skimmer,
 * band, UTC hour) over 7 days in utils/benchmark.js (pure, tested).
 *
 * Locating the spotted stations never calls a callbook per spot: the sync
 * resolver reads caches the server already fills (cluster spots with grids,
 * the 24 h QRZ/HamQTH cache, RBN's own cache). Stations that only resolve
 * to a prefix centroid are kept but excluded from neighbour sets; a slow
 * background resolver (2 lookups / 20 s, via the same /api/callsign chain the
 * RBN panel uses) upgrades the most recently heard unlocated stations near
 * places someone actually asked about.
 *
 * Bounded: 6000 stations × 240 buckets, 200 cached comparisons (10 min).
 */
const { BenchmarkStore } = require('../utils/benchmark');
const { haversineDistance } = require('../utils/grid');

const DEFAULT_RADIUS_KM = 300;
const MAX_RADIUS_KM = 1500;
const RESULT_TTL_MS = 10 * 60 * 1000;
const RESULT_CACHE_MAX = 200;
const INTEREST_TTL_MS = 60 * 60 * 1000;
const INTEREST_MAX = 50;
const RESOLVE_INTERVAL_MS = 20 * 1000;
const RESOLVE_PER_TICK = 2;
const RESOLVE_NEAR_KM = 1500;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const PRECISE_SOURCES = new Set(['qrz', 'hamqth-xml']);

module.exports = function (app, ctx) {
  const { fetch, PORT, logDebug, logErrorOnce } = ctx;
  const maxStations = parseInt(process.env.BENCHMARK_MAX_STATIONS || '6000', 10) || 6000;
  const store = new BenchmarkStore({ maxStations, haversine: haversineDistance });

  // ── Ingest from the RBN stream ─────────────────────────────────────────
  ctx.onRbnSpot = (spot) => {
    if (!spot || !Number.isFinite(spot.snr)) return;
    const known = store.hasLocation(spot.dx);
    const loc = known ? null : ctx.rbnLocateStationSync?.(spot.dx, spot.band) || null;
    store.ingest(spot, loc);
  };

  // ── Slow resolver for unlocated stations near requested places ────────
  const interest = []; // [{ lat, lon, at }]
  const triedRecently = new Map(); // CALL → ts (negative cache, 6 h)
  const noteInterest = (lat, lon) => {
    const now = Date.now();
    for (let i = interest.length - 1; i >= 0; i--) if (now - interest[i].at > INTEREST_TTL_MS) interest.splice(i, 1);
    const hit = interest.find((p) => haversineDistance(lat, lon, p.lat, p.lon) < 50);
    if (hit) hit.at = now;
    else {
      interest.push({ lat, lon, at: now });
      while (interest.length > INTEREST_MAX) interest.shift();
    }
  };

  async function resolveOne(call) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/callsign/${encodeURIComponent(call)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!Number.isFinite(data?.lat) || !Number.isFinite(data?.lon)) return;
      const precise = PRECISE_SOURCES.has(data.source) || (!data.source && !!data.grid && data.grid.length >= 6);
      store.setLocation(call, { lat: data.lat, lon: data.lon, precise });
    } catch (err) {
      logErrorOnce?.('Benchmark-Resolve', err.message);
    }
  }

  const resolver = setInterval(() => {
    if (!interest.length) return;
    const now = Date.now();
    for (const [c, t] of triedRecently) if (now - t > 6 * 60 * 60 * 1000) triedRecently.delete(c);
    const candidates = store
      .unlocated(200)
      .filter((u) => !triedRecently.has(u.call))
      // Only stations whose coarse (prefix) position is near somewhere someone asked about.
      .filter(
        (u) => u.lat == null || interest.some((p) => haversineDistance(u.lat, u.lon, p.lat, p.lon) <= RESOLVE_NEAR_KM),
      )
      .slice(0, RESOLVE_PER_TICK);
    for (const u of candidates) {
      triedRecently.set(u.call, now);
      resolveOne(u.call);
    }
  }, RESOLVE_INTERVAL_MS);
  resolver.unref?.();

  const pruner = setInterval(() => {
    const removed = store.prune();
    if (removed) logDebug?.(`[Benchmark] pruned ${removed} buckets; ${JSON.stringify(store.stats())}`);
  }, PRUNE_INTERVAL_MS);
  pruner.unref?.();

  // ── API ────────────────────────────────────────────────────────────────
  const results = new Map(); // key → { data, at }

  app.get('/api/benchmark', (req, res) => {
    const callsign = String(req.query.callsign || '')
      .trim()
      .toUpperCase();
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    let radius = parseFloat(req.query.radius);
    if (!/^[A-Z0-9/]{3,12}$/.test(callsign)) return res.status(400).json({ error: 'callsign required' });
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ error: 'lat/lon required' });
    }
    if (!Number.isFinite(radius) || radius <= 0) radius = DEFAULT_RADIUS_KM;
    radius = Math.min(MAX_RADIUS_KM, Math.round(radius));

    const key = `${callsign}|${lat.toFixed(1)}|${lon.toFixed(1)}|${radius}`;
    const now = Date.now();
    const hit = results.get(key);
    res.set('Cache-Control', 'no-store');
    if (hit && now - hit.at < RESULT_TTL_MS) return res.json(hit.data);

    noteInterest(lat, lon);
    // The requester's own station is precisely located by definition.
    if (store.stations.has(callsign)) store.setLocation(callsign, { lat, lon, precise: true });

    const data = {
      ...store.compare({ call: callsign, lat, lon, radiusKm: radius, now }),
      source: 'rbn',
      pskreporter: false,
      generatedAt: new Date(now).toISOString(),
      store: store.stats(),
    };
    if (results.size >= RESULT_CACHE_MAX) {
      const oldest = results.keys().next().value;
      results.delete(oldest);
    }
    results.set(key, { data, at: now });
    res.json(data);
  });

  return { benchmarkStore: store };
};
