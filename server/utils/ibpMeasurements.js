/**
 * ibpMeasurements.js — bounded in-memory store for NCDXF/IBP beacon SNR
 * measurements posted by Rig Bridge KiwiSDR beacon monitors.
 *
 * One ring buffer per listening station (callsign, or the Kiwi id when the
 * bridge has no callsign configured). Bounded three ways so a hosted
 * instance can never grow without limit:
 *   • MAX_STATIONS stations (least recently updated evicted first)
 *   • MAX_PER_STATION measurements per station (oldest dropped)
 *   • RETENTION_MS age (72 h) pruned on every write and read
 *
 * Pure JS, no I/O — colocated tests in ibpMeasurements.test.js.
 */

const IBP_BEACON_CALLS = new Set([
  '4U1UN',
  'VE8AT',
  'W6WX',
  'KH6RS',
  'ZL6B',
  'VK6RBP',
  'JA2IGY',
  'RR9O',
  'VR2B',
  '4S7B',
  'ZS6DN',
  '5Z4B',
  '4X6TU',
  'OH2B',
  'CS3B',
  'LU4AA',
  'OA4B',
  'YV5B',
]);
const IBP_BAND_LABELS = new Set(['20m', '17m', '15m', '12m', '10m']);

const RETENTION_MS = 72 * 60 * 60 * 1000;
const MAX_PER_STATION = 20000;
const MAX_STATIONS = 50;
const MAX_BATCH = 500;

const CALLSIGN_RE = /^[A-Z0-9/-]{3,16}$/;
const GRID_RE = /^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2})?)?$/i;

function cleanStationId(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  return CALLSIGN_RE.test(s) ? s : null;
}

function cleanKiwiId(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, 80);
  return /^[A-Za-z0-9.:\-_[\]]+$/.test(s) ? s : null;
}

/**
 * Validate and normalize one measurement. Returns null when it is not a
 * plausible IBP measurement (unknown beacon/band, non-finite numbers,
 * timestamp outside the retention window or in the future).
 */
function sanitizeMeasurement(m, now = Date.now()) {
  if (!m || typeof m !== 'object') return null;
  const beacon = typeof m.beacon === 'string' ? m.beacon.trim().toUpperCase() : '';
  const band = typeof m.band === 'string' ? m.band.trim().toLowerCase() : '';
  if (!IBP_BEACON_CALLS.has(beacon) || !IBP_BAND_LABELS.has(band)) return null;
  const t = Number(m.t);
  if (!Number.isFinite(t) || t < now - RETENTION_MS || t > now + 5 * 60 * 1000) return null;
  const snrDb = Number(m.snrDb);
  if (!Number.isFinite(snrDb) || snrDb < -60 || snrDb > 120) return null;
  const out = { beacon, band, t: Math.floor(t / 10000) * 10000, snrDb: Math.round(snrDb * 10) / 10 };
  for (const k of ['levelDbm', 'noiseDbm', 'medianDbm']) {
    const v = Number(m[k]);
    if (Number.isFinite(v) && v > -200 && v < 50) out[k] = Math.round(v * 10) / 10;
  }
  const n = Number(m.n);
  if (Number.isFinite(n) && n > 0) out.n = Math.min(100000, Math.floor(n));
  return out;
}

class IbpMeasurementStore {
  constructor({
    retentionMs = RETENTION_MS,
    maxPerStation = MAX_PER_STATION,
    maxStations = MAX_STATIONS,
    now = () => Date.now(),
  } = {}) {
    this.retentionMs = retentionMs;
    this.maxPerStation = maxPerStation;
    this.maxStations = maxStations;
    this.now = now;
    this.stations = new Map(); // id → { id, callsign, grid, lat, lon, kiwi, updatedAt, items: [] }
  }

  /**
   * Resolve the station id for a POST body: callsign first, else the Kiwi id.
   */
  static stationIdFor(body) {
    const call = cleanStationId(body?.station?.callsign);
    if (call) return call;
    const kiwi = cleanKiwiId(body?.kiwi?.id);
    return kiwi ? `KIWI:${kiwi}` : null;
  }

  /**
   * Ingest a batch. Returns { accepted, rejected, station } or an { error }.
   */
  ingest(body) {
    const now = this.now();
    const id = IbpMeasurementStore.stationIdFor(body);
    if (!id) return { error: 'station.callsign or kiwi.id required' };
    const list = Array.isArray(body.measurements) ? body.measurements.slice(0, MAX_BATCH) : null;
    if (!list) return { error: 'measurements array required' };

    let rec = this.stations.get(id);
    if (!rec) {
      if (this.stations.size >= this.maxStations) this._evictOldest();
      rec = { id, items: [], updatedAt: now, byKey: new Map() };
      this.stations.set(id, rec);
    }
    // Station metadata: last writer wins, each field validated.
    const st = body.station || {};
    const grid = typeof st.grid === 'string' && GRID_RE.test(st.grid.trim()) ? st.grid.trim() : rec.grid;
    const lat = Number(st.lat);
    const lon = Number(st.lon);
    rec.callsign = cleanStationId(st.callsign) || rec.callsign || null;
    rec.grid = grid || null;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      rec.lat = lat;
      rec.lon = lon;
    }
    const kiwiId = cleanKiwiId(body?.kiwi?.id);
    if (kiwiId) rec.kiwi = kiwiId;
    const kiwiName = typeof body?.kiwi?.name === 'string' ? body.kiwi.name.trim().slice(0, 80) : '';
    if (kiwiName) rec.kiwiName = kiwiName;

    let accepted = 0;
    let rejected = 0;
    for (const raw of list) {
      const m = sanitizeMeasurement(raw, now);
      if (!m) {
        rejected++;
        continue;
      }
      const key = `${m.beacon}|${m.band}|${m.t}`;
      if (rec.byKey.has(key)) {
        // Re-sent after a failed POST — replace, don't duplicate.
        Object.assign(rec.byKey.get(key), m);
        continue;
      }
      rec.items.push(m);
      rec.byKey.set(key, m);
      accepted++;
    }
    if (accepted) {
      rec.items.sort((a, b) => a.t - b.t);
      rec.updatedAt = now;
    }
    this._prune(rec, now);
    return { accepted, rejected, station: id };
  }

  _prune(rec, now) {
    const cutoff = now - this.retentionMs;
    let drop = 0;
    while (drop < rec.items.length && rec.items[drop].t < cutoff) drop++;
    const overflow = rec.items.length - drop - this.maxPerStation;
    if (overflow > 0) drop += overflow;
    if (drop > 0) {
      for (const m of rec.items.slice(0, drop)) rec.byKey.delete(`${m.beacon}|${m.band}|${m.t}`);
      rec.items.splice(0, drop);
    }
  }

  _evictOldest() {
    let oldest = null;
    for (const rec of this.stations.values()) {
      if (!oldest || rec.updatedAt < oldest.updatedAt) oldest = rec;
    }
    if (oldest) this.stations.delete(oldest.id);
  }

  /** Drop expired items and stations that have gone completely silent. */
  sweep() {
    const now = this.now();
    for (const rec of this.stations.values()) {
      this._prune(rec, now);
      if (!rec.items.length && now - rec.updatedAt > this.retentionMs) this.stations.delete(rec.id);
    }
  }

  /** Public station summaries, most recently updated first. */
  listStations() {
    return [...this.stations.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((rec) => ({
        station: rec.id,
        callsign: rec.callsign || null,
        grid: rec.grid || null,
        lat: rec.lat ?? null,
        lon: rec.lon ?? null,
        kiwi: rec.kiwi || null,
        kiwiName: rec.kiwiName || null,
        count: rec.items.length,
        updatedAt: rec.updatedAt,
        latest: rec.items.length ? rec.items[rec.items.length - 1].t : null,
      }));
  }

  /**
   * Query one station's measurements.
   * @param {Object} q  { station, band?, hours? (≤72), since? (ms) }
   */
  query({ station, band = null, hours = 24, since = null } = {}) {
    const id = typeof station === 'string' ? station.trim().toUpperCase() : '';
    const rec = this.stations.get(id) || this.stations.get(`KIWI:${(station || '').trim()}`);
    if (!rec) return null;
    const now = this.now();
    this._prune(rec, now);
    const h = Number.isFinite(Number(hours)) && Number(hours) > 0 ? Math.min(72, Number(hours)) : 24;
    const sinceMs = Number.isFinite(Number(since)) && Number(since) > 0 ? Number(since) : now - h * 3600 * 1000;
    const b = typeof band === 'string' && band ? band.toLowerCase() : null;
    const measurements = rec.items.filter((m) => m.t >= sinceMs && (!b || m.band === b));
    return {
      station: rec.id,
      callsign: rec.callsign || null,
      grid: rec.grid || null,
      lat: rec.lat ?? null,
      lon: rec.lon ?? null,
      kiwi: rec.kiwi || null,
      kiwiName: rec.kiwiName || null,
      updatedAt: rec.updatedAt,
      measurements,
    };
  }
}

module.exports = {
  IbpMeasurementStore,
  sanitizeMeasurement,
  cleanStationId,
  cleanKiwiId,
  RETENTION_MS,
  MAX_PER_STATION,
  MAX_STATIONS,
  MAX_BATCH,
};
