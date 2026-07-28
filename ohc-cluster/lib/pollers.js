/**
 * HTTP JSON spot pollers — human-spot sources beyond HamQTH.
 *
 * RBN can't decode phone, so SSB exists only where humans type spots. One
 * 50-row HamQTH poll per minute was our whole phone supply; these pollers
 * widen it:
 *   POTA        api.pota.app        activator spots, explicit mode, kHz
 *   SOTA        api2.sota.org.uk    summit spots, explicit mode, MHz
 *   DXSummit    dxsummit.fi         classic cluster spots, no mode field
 *   DXSpider    our own dxspider-proxy node feed
 *   WWFF        spots.wwff.co       park spots, explicit mode, kHz, lat/lon
 *   ParksNPeaks parksnpeaks.org     VK/ZL park+summit spots, explicit mode, MHz
 *
 * Each source gets a seen-key dedupe (spot ids where the API provides them,
 * composite keys otherwise) because re-polling returns mostly the same rows —
 * and the proxy feed carries no date at all, so store-level timestamp dedupe
 * can't catch its repeats. Cross-source duplicates of the same real spot are
 * handled by the store's spotter+call+freq window.
 */

const POLL_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
const SEEN_TTL_MS = 2 * 60 * 60 * 1000; // outlives store retention

// "2026-07-09T23:12:58" — these APIs emit UTC without the Z
const parseUtcNoZ = (s) => {
  const ts = Date.parse(
    String(s || '')
      .trim()
      .replace(/Z?$/, 'Z'),
  );
  return Number.isFinite(ts) ? ts : Date.now();
};

const clean = (s) =>
  String(s || '')
    .trim()
    .toUpperCase();

// Maidenhead grid (6-char) from lat/lon — WWFF publishes park coordinates,
// and a real grid places the spot at the park instead of a country centroid.
function latLonToGrid6(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const adjLon = lon + 180;
  const adjLat = lat + 90;
  return (
    String.fromCharCode(65 + Math.floor(adjLon / 20)) +
    String.fromCharCode(65 + Math.floor(adjLat / 10)) +
    Math.floor((adjLon % 20) / 2) +
    Math.floor(adjLat % 10) +
    String.fromCharCode(97 + Math.floor((adjLon % 2) * 12)) +
    String.fromCharCode(97 + Math.floor((adjLat % 1) * 24))
  );
}

/** api.pota.app/spot/activator */
function parsePotaSpots(json) {
  const out = [];
  for (const row of Array.isArray(json) ? json : []) {
    const spotter = clean(row.spotter);
    // RBN reposts (spotter "XX0XX-#") — we ingest RBN directly; skip
    if (!spotter || spotter.endsWith('-#') || row.invalid) continue;
    const freqKhz = parseFloat(row.frequency); // already kHz
    if (!Number.isFinite(freqKhz) || freqKhz <= 0) continue;
    const comment = ['POTA', row.reference, String(row.comments || '').trim()].filter(Boolean).join(' ').slice(0, 72);
    out.push({
      key: `pota|${row.spotId}`,
      spot: {
        spotter,
        call: clean(row.activator),
        freqKhz,
        mode: clean(row.mode) || null,
        comment,
        dxGrid: row.grid6 || row.grid4 || null,
        timestamp: parseUtcNoZ(row.spotTime),
        source: 'POTA',
        isSkimmer: false,
      },
    });
  }
  return out;
}

/** api2.sota.org.uk/api/spots/<n>/all */
function parseSotaSpots(json) {
  const out = [];
  for (const row of Array.isArray(json) ? json : []) {
    const call = clean(row.activatorCallsign || row.callsign);
    if (!call) continue;
    const mhz = parseFloat(row.frequency);
    if (!Number.isFinite(mhz) || mhz <= 0) continue;
    const freqKhz = mhz > 1000 ? mhz : mhz * 1000; // API emits MHz
    const summit = [row.associationCode, row.summitCode].filter(Boolean).join('/');
    const comment = ['SOTA', summit, String(row.comments || '').trim()].filter(Boolean).join(' ').slice(0, 72);
    out.push({
      key: `sota|${row.id}`,
      spot: {
        spotter: clean(row.callsign) || call,
        call,
        freqKhz,
        mode: clean(row.mode) || null,
        comment,
        timestamp: parseUtcNoZ(row.timeStamp),
        source: 'SOTA',
        isSkimmer: false,
      },
    });
  }
  return out;
}

/** dxsummit.fi/api/v1/spots — no mode field; consumers infer from freq/comment */
function parseDxSummitSpots(json) {
  const out = [];
  for (const row of Array.isArray(json) ? json : []) {
    const spotter = clean(row.de_call);
    const call = clean(row.dx_call);
    const freqKhz = parseFloat(row.frequency);
    if (!spotter || !call || !Number.isFinite(freqKhz) || freqKhz <= 0) continue;
    out.push({
      key: `dxsummit|${row.id}`,
      spot: {
        spotter,
        call,
        freqKhz,
        mode: null,
        comment: String(row.info || '')
          .trim()
          .slice(0, 72),
        timestamp: parseUtcNoZ(row.time),
        source: 'DXSummit',
        isSkimmer: false,
      },
    });
  }
  return out;
}

/** our dxspider-proxy /api/dxcluster/spots — freq in MHz, no date (HH:MMz only) */
function parseDxSpiderSpots(json) {
  const out = [];
  for (const row of Array.isArray(json) ? json : []) {
    const spotter = clean(row.spotter);
    const call = clean(row.call);
    const mhz = parseFloat(row.freq);
    if (!spotter || !call || !Number.isFinite(mhz) || mhz <= 0) continue;
    const freqKhz = mhz > 1000 ? mhz : mhz * 1000;
    out.push({
      // No date in the feed — the composite key is the only repeat guard
      key: `spider|${spotter}|${call}|${freqKhz}|${row.time || ''}`,
      spot: {
        spotter,
        call,
        freqKhz,
        mode: clean(row.mode) || null,
        comment: String(row.comment || '')
          .trim()
          .slice(0, 72),
        timestamp: Date.now(), // feed is near-live; HH:MMz adds nothing safe
        source: 'DXSpider',
        isSkimmer: false,
      },
    });
  }
  return out;
}

/** spots.wwff.co/static/spots.json — kHz, explicit mode, park lat/lon, epoch-seconds time */
function parseWwffSpots(json) {
  const out = [];
  for (const row of Array.isArray(json) ? json : []) {
    const call = clean(row.activator);
    const freqKhz = parseFloat(row.frequency_khz);
    if (!call || !Number.isFinite(freqKhz) || freqKhz <= 0) continue;
    const comment = ['WWFF', row.reference, String(row.remarks || '').trim()].filter(Boolean).join(' ').slice(0, 72);
    const epochSec = parseFloat(row.spot_time);
    out.push({
      key: `wwff|${row.id}`,
      spot: {
        spotter: clean(row.spotter) || call,
        call,
        freqKhz,
        mode: clean(row.mode) || null,
        comment,
        dxGrid: latLonToGrid6(parseFloat(row.latitude), parseFloat(row.longitude)),
        timestamp: Number.isFinite(epochSec) && epochSec > 0 ? epochSec * 1000 : Date.now(),
        source: 'WWFF',
        isSkimmer: false,
      },
    });
  }
  return out;
}

/** parksnpeaks.org/api/ALL — VK/ZL spots, MHz, explicit mode ("actSpoter" is the API's own spelling) */
function parsePnpSpots(json) {
  const out = [];
  for (const row of Array.isArray(json) ? json : []) {
    const call = clean(row.actCallsign);
    const mhz = parseFloat(row.actFreq);
    if (!call || !Number.isFinite(mhz) || mhz <= 0) continue;
    const freqKhz = mhz > 1000 ? mhz : mhz * 1000;
    const comment = [String(row.actClass || '').trim(), row.actSiteID, String(row.actComments || '').trim()]
      .filter(Boolean)
      .join(' ')
      .slice(0, 72);
    out.push({
      key: `pnp|${row.actID}`,
      spot: {
        spotter: clean(row.actSpoter) || call,
        call,
        freqKhz,
        mode: clean(row.actMode) || null,
        comment,
        timestamp: parseUtcNoZ(String(row.actTime || '').replace(' ', 'T')),
        source: 'ParksNPeaks',
        isSkimmer: false,
      },
    });
  }
  return out;
}

class JsonPoller {
  constructor({ name, url, parse, store, log, appVersion, intervalMs = POLL_INTERVAL_MS }) {
    this.name = name;
    this.url = url;
    this.parse = parse;
    this.store = store;
    this.log = log;
    this.userAgent = `OpenHamClock-Cluster/${appVersion || '0.1.0'}`;
    this.intervalMs = intervalMs;

    this.timer = null;
    this.seen = new Map(); // key -> first-seen ts
    this.lastPollAt = 0;
    this.lastSuccessAt = 0;
    this.pollCount = 0;
    this.errorCount = 0;
    this.spotCount = 0; // spots actually stored (past seen-set and store dedupe)
  }

  start() {
    this._poll();
    this.timer = setInterval(() => this._poll(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return {
      name: this.name,
      lastPollAgeMs: this.lastPollAt ? Date.now() - this.lastPollAt : null,
      lastSuccessAgeMs: this.lastSuccessAt ? Date.now() - this.lastSuccessAt : null,
      pollCount: this.pollCount,
      errorCount: this.errorCount,
      spotCount: this.spotCount,
    };
  }

  /** Feed parsed rows through the seen-set into the store. Exposed for tests. */
  ingest(rows) {
    const now = Date.now();
    let stored = 0;
    for (const { key, spot } of rows) {
      if (this.seen.has(key)) continue;
      this.seen.set(key, now);
      if (this.store.add(spot)) {
        stored++;
        this.spotCount++;
      }
    }
    // Sweep expired keys so the set can't grow forever
    if (this.seen.size > 5000) {
      const cutoff = now - SEEN_TTL_MS;
      for (const [key, ts] of this.seen) {
        if (ts < cutoff) this.seen.delete(key);
      }
    }
    return stored;
  }

  async _poll() {
    this.lastPollAt = Date.now();
    this.pollCount++;
    try {
      const response = await fetch(this.url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const stored = this.ingest(this.parse(await response.json()));
      if (stored > 0) this.log('SPOT', `[${this.name}] +${stored} spots`);
      this.lastSuccessAt = Date.now();
    } catch (err) {
      this.errorCount++;
      this.log('ERROR', `[${this.name}] poll failed: ${err.message}`);
    }
  }
}

module.exports = {
  JsonPoller,
  parsePotaSpots,
  parseSotaSpots,
  parseDxSummitSpots,
  parseDxSpiderSpots,
  parseWwffSpots,
  parsePnpSpots,
  latLonToGrid6,
};
