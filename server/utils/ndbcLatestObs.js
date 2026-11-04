'use strict';
/**
 * NDBC "latest observations" parser.
 *
 * https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt is a
 * whitespace-aligned table: two header lines (#STN … / #text …) then one row
 * per station. Missing values are "MM". Units: wind m/s, waves m, periods s,
 * pressure hPa, temperatures °C, visibility nmi, tide ft.
 */

const COLUMNS = [
  'id',
  'lat',
  'lon',
  'yyyy',
  'mm',
  'dd',
  'hh',
  'mn',
  'wdir',
  'wspd',
  'gst',
  'wvht',
  'dpd',
  'apd',
  'mwd',
  'pres',
  'ptdy',
  'atmp',
  'wtmp',
  'dewp',
  'vis',
  'tide',
];

const NUMERIC = new Set(COLUMNS.slice(1));

const val = (s) => {
  if (s == null || s === 'MM') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** → [{ id, lat, lon, time (ISO), wdir, wspd, gst, wvht, dpd, apd, mwd, pres, ptdy, atmp, wtmp, dewp, vis, tide }] */
function parseLatestObs(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 8) continue;
    const row = {};
    COLUMNS.forEach((c, i) => {
      row[c] = NUMERIC.has(c) ? val(parts[i]) : parts[i];
    });
    if (row.lat == null || row.lon == null) continue;
    const time =
      row.yyyy != null && row.mm != null && row.dd != null
        ? new Date(Date.UTC(row.yyyy, row.mm - 1, row.dd, row.hh ?? 0, row.mn ?? 0)).toISOString()
        : null;
    out.push({
      id: row.id,
      lat: row.lat,
      lon: row.lon,
      time,
      wdir: row.wdir,
      wspd: row.wspd,
      gst: row.gst,
      wvht: row.wvht,
      dpd: row.dpd,
      apd: row.apd,
      mwd: row.mwd,
      pres: row.pres,
      ptdy: row.ptdy,
      atmp: row.atmp,
      wtmp: row.wtmp,
      dewp: row.dewp,
      vis: row.vis,
      tide: row.tide,
    });
  }
  return out;
}

/**
 * NDBC station_table.txt → Map(id → { name, owner, type }).
 * Format: "ID | OWNER | TTYPE | HULL | NAME | PAYLOAD | LOCATION | …" with
 * two comment lines on top.
 */
function parseStationTable(text) {
  const map = new Map();
  if (typeof text !== 'string') return map;
  for (const raw of text.split('\n')) {
    if (!raw || raw.startsWith('#')) continue;
    const cols = raw.split('|').map((c) => c.trim());
    if (cols.length < 5 || !cols[0]) continue;
    map.set(cols[0].toUpperCase(), {
      name: cols[4] || '',
      owner: cols[1] || '',
      type: cols[2] || '',
    });
  }
  return map;
}

const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
}

/**
 * Nearest N stations to (lat, lon), each annotated with km + bearing.
 * `requireMarine` keeps only rows with at least one marine value (wave
 * height, water temp) OR wind — drops land-only stations without data.
 */
function nearestStations(stations, lat, lon, limit = 25) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return stations
    .map((s) => ({
      ...s,
      km: haversineKm(lat, lon, s.lat, s.lon),
      bearing: Math.round(bearingDeg(lat, lon, s.lat, s.lon)),
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, Math.max(0, limit))
    .map((s) => ({ ...s, km: Math.round(s.km * 10) / 10 }));
}

module.exports = { parseLatestObs, parseStationTable, nearestStations, haversineKm, bearingDeg, COLUMNS };
