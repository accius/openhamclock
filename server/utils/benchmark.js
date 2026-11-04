/**
 * Station benchmark store — "how am I heard versus my neighbours?"
 *
 * Fed from the RBN telnet stream the server already consumes. For every
 * spotted station we keep per (skimmer, band, UTC hour) SNR aggregates
 * (sum / count / max) over a 7-day window, plus the station's location when
 * one is known. A comparison for callsign X at (lat, lon) then takes every
 * bucket X has, finds the same (skimmer, band, hour) bucket at the stations
 * within R km, and reports X's mean minus the neighbours' median — the same
 * skimmer, the same hour, the same band, so propagation cancels out and
 * what is left is antenna + power + QTH.
 *
 * Bounded: MAX_STATIONS stations × MAX_KEYS_PER_STATION buckets, oldest
 * evicted first; prune() drops anything older than the window.
 *
 * Pure: no I/O. Distance function and clock are injected.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const defaultHaversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const bucketKey = (skimmer, band, hourSlot) => `${skimmer}|${band}|${hourSlot}`;

class BenchmarkStore {
  constructor({
    maxStations = 6000,
    maxKeysPerStation = 240,
    windowMs = 7 * DAY_MS,
    haversine = defaultHaversine,
    now = () => Date.now(),
  } = {}) {
    this.maxStations = maxStations;
    this.maxKeysPerStation = maxKeysPerStation;
    this.windowMs = windowMs;
    this.haversine = haversine;
    this.now = now;
    this.stations = new Map(); // CALL → { call, lat, lon, precise, buckets: Map, lastSeen }
    this.ingested = 0;
  }

  _station(call) {
    const key = String(call || '')
      .toUpperCase()
      .trim();
    if (!key) return null;
    let s = this.stations.get(key);
    if (!s) {
      if (this.stations.size >= this.maxStations) {
        // Map preserves insertion order → the first key is the oldest station.
        const oldest = this.stations.keys().next().value;
        this.stations.delete(oldest);
      }
      s = { call: key, lat: null, lon: null, precise: false, buckets: new Map(), lastSeen: 0 };
      this.stations.set(key, s);
    }
    return s;
  }

  /**
   * @param {{ dx:string, callsign?:string, skimmer?:string, band:string, snr:number, timestampMs?:number }} spot
   *        `callsign` is the RBN spot's skimmer field (rbn.js naming); `skimmer` is accepted too.
   * @param {{ lat:number, lon:number, precise?:boolean }|null} [loc] location of the spotted station if known
   */
  ingest(spot, loc = null) {
    if (!spot || !Number.isFinite(spot.snr) || !spot.band || spot.band === 'Other') return false;
    const skimmer = String(spot.skimmer || spot.callsign || '')
      .toUpperCase()
      .replace(/-#.*$/, '');
    if (!skimmer) return false;
    const s = this._station(spot.dx);
    if (!s) return false;
    const ts = Number.isFinite(spot.timestampMs) ? spot.timestampMs : this.now();
    const hourSlot = Math.floor(ts / HOUR_MS);
    const key = bucketKey(skimmer, spot.band, hourSlot);
    let b = s.buckets.get(key);
    if (!b) {
      if (s.buckets.size >= this.maxKeysPerStation) {
        const oldest = s.buckets.keys().next().value;
        s.buckets.delete(oldest);
      }
      b = { sum: 0, count: 0, max: -Infinity, hourSlot, band: spot.band, skimmer };
      s.buckets.set(key, b);
    }
    b.sum += spot.snr;
    b.count += 1;
    if (spot.snr > b.max) b.max = spot.snr;
    s.lastSeen = Math.max(s.lastSeen, ts);
    if (loc) this.setLocation(s.call, loc);
    this.ingested += 1;
    return true;
  }

  setLocation(call, loc) {
    const s = this.stations.get(String(call || '').toUpperCase());
    if (!s || !loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return false;
    // Never downgrade a precise location to a coarse (prefix-centroid) one.
    if (s.precise && loc.precise === false) return false;
    s.lat = loc.lat;
    s.lon = loc.lon;
    s.precise = loc.precise !== false;
    return true;
  }

  hasLocation(call) {
    const s = this.stations.get(String(call || '').toUpperCase());
    return !!(s && Number.isFinite(s.lat));
  }

  /** Stations without a precise location, most recently heard first (for the lazy resolver). */
  unlocated(limit = 50) {
    const out = [];
    for (const s of this.stations.values()) if (!s.precise) out.push(s);
    out.sort((a, b) => b.lastSeen - a.lastSeen);
    return out.slice(0, limit).map((s) => ({ call: s.call, lat: s.lat, lon: s.lon, lastSeen: s.lastSeen }));
  }

  /** Drop buckets (and stations) older than the window. */
  prune(now = this.now()) {
    const cutoffSlot = Math.floor((now - this.windowMs) / HOUR_MS);
    let removed = 0;
    for (const [call, s] of this.stations) {
      for (const [k, b] of s.buckets) {
        if (b.hourSlot < cutoffSlot) {
          s.buckets.delete(k);
          removed += 1;
        }
      }
      if (s.buckets.size === 0) this.stations.delete(call);
    }
    return removed;
  }

  /** Precisely-located stations within radiusKm of (lat, lon), excluding `exclude`. */
  stationsNear(lat, lon, radiusKm, exclude = null) {
    const ex = String(exclude || '').toUpperCase();
    const out = [];
    for (const s of this.stations.values()) {
      if (!s.precise || !Number.isFinite(s.lat) || s.call === ex) continue;
      if (this.haversine(lat, lon, s.lat, s.lon) <= radiusKm) out.push(s);
    }
    return out;
  }

  /**
   * Compare `call` with its neighbours.
   * @returns {{ call, radiusKm, windowDays, neighbours, mySpots, bands:Array, explanation:string }}
   *   bands[] = { band, diffDb, samples, neighbourSamples, bestDiffDb, days: [{ day, diffDb, samples }] }
   */
  compare({ call, lat, lon, radiusKm = 300, now = this.now() }) {
    const me = this.stations.get(String(call || '').toUpperCase());
    const neighbours = Number.isFinite(lat) && Number.isFinite(lon) ? this.stationsNear(lat, lon, radiusKm, call) : [];
    const cutoffSlot = Math.floor((now - this.windowMs) / HOUR_MS);
    const result = {
      call: String(call || '').toUpperCase(),
      radiusKm,
      windowDays: Math.round(this.windowMs / DAY_MS),
      neighbours: neighbours.length,
      mySpots: 0,
      bands: [],
      explanation: '',
    };
    if (!me) {
      result.explanation = `No RBN skimmer reports of ${result.call} in the last ${result.windowDays} days. Call CQ on CW, RTTY or FT modes and check back.`;
      return result;
    }
    // Index neighbour buckets by key → [mean, ...] once.
    const neighbourMeans = new Map();
    for (const n of neighbours) {
      for (const [k, b] of n.buckets) {
        if (b.hourSlot < cutoffSlot || !b.count) continue;
        let arr = neighbourMeans.get(k);
        if (!arr) {
          arr = [];
          neighbourMeans.set(k, arr);
        }
        arr.push(b.sum / b.count);
      }
    }
    const perBand = new Map(); // band → { diffs: [], days: Map<day, diffs[]>, nSamples, best }
    for (const b of me.buckets.values()) {
      if (b.hourSlot < cutoffSlot || !b.count) continue;
      result.mySpots += b.count;
      const key = bucketKey(b.skimmer, b.band, b.hourSlot);
      const others = neighbourMeans.get(key);
      if (!others || !others.length) continue;
      const med = median(others);
      const diff = b.sum / b.count - med;
      let pb = perBand.get(b.band);
      if (!pb) {
        pb = { diffs: [], days: new Map(), nSamples: 0, best: -Infinity };
        perBand.set(b.band, pb);
      }
      pb.diffs.push(diff);
      pb.nSamples += others.length;
      if (diff > pb.best) pb.best = diff;
      const day = new Date(b.hourSlot * HOUR_MS).toISOString().slice(0, 10);
      if (!pb.days.has(day)) pb.days.set(day, []);
      pb.days.get(day).push(diff);
    }
    const round1 = (x) => Math.round(x * 10) / 10;
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    for (const [band, pb] of perBand) {
      result.bands.push({
        band,
        diffDb: round1(mean(pb.diffs)),
        medianDiffDb: round1(median(pb.diffs)),
        samples: pb.diffs.length,
        neighbourSamples: pb.nSamples,
        bestDiffDb: round1(pb.best),
        days: [...pb.days.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([day, diffs]) => ({ day, diffDb: round1(mean(diffs)), samples: diffs.length })),
      });
    }
    result.bands.sort((a, b) => b.samples - a.samples);
    if (!neighbours.length) {
      result.explanation = `${result.call} was heard ${result.mySpots} times, but no other located station within ${radiusKm} km was skimmed in the same hours — widen the radius or check back later.`;
    } else if (!result.bands.length) {
      result.explanation = `${result.mySpots} reports of ${result.call} and ${neighbours.length} neighbours within ${radiusKm} km, but never the same skimmer, band and hour yet.`;
    } else {
      const overall = round1(mean(result.bands.map((b) => b.diffDb)));
      const sign = overall > 0 ? '+' : '';
      result.explanation = `Versus the median of ${neighbours.length} stations within ${radiusKm} km, heard by the same skimmers in the same hours: ${sign}${overall} dB overall (${result.bands.length} band${result.bands.length === 1 ? '' : 's'}).`;
    }
    return result;
  }

  stats() {
    let buckets = 0;
    let located = 0;
    for (const s of this.stations.values()) {
      buckets += s.buckets.size;
      if (s.precise) located += 1;
    }
    return { stations: this.stations.size, located, buckets, ingested: this.ingested };
  }
}

module.exports = { BenchmarkStore, median, bucketKey, HOUR_MS, DAY_MS };
