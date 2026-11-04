/**
 * SondeHub Amateur telemetry → compact balloon list (pure).
 *
 * GET https://api.v2.sondehub.org/amateur/telemetry?duration=6h returns
 *   { "<payload_callsign>": { "<ISO time>": { lat, lon, alt, datetime,
 *       vel_h?, speed?, ascent_rate?, heading?, batt?, temp?, comment?,
 *       modulation?, model?, uploader_callsign?, aprs_tocall?, … }, … }, … }
 *
 * ~750 KB for six hours; browsers only need the latest fix plus a thin
 * trail per balloon. slimBalloons() keeps the newest `maxBalloons`
 * payloads (by last-heard), decimates each trail to `maxTrail` points, and
 * projects a stable wire format. APRS-gated pico balloons arrive in the
 * same feed (modulation "APRS", path/aprs_tocall present) and are flagged.
 */

const MAX_BALLOONS = 500;
const MAX_TRAIL = 60;

const num = (v) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : null;

function parseTime(point, key) {
  const t = Date.parse(point?.datetime || point?.time_received || key || '');
  return Number.isFinite(t) ? t : null;
}

/** Evenly thin a time-sorted array to at most `max` entries, always keeping the last. */
function decimate(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max - 1; i++) out.push(points[Math.round(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/** Speed in km/h from whichever field the tracker reported (vel_h m/s preferred). */
function speedKmh(point) {
  const velH = num(point.vel_h);
  if (velH != null) return Math.round(velH * 3.6 * 10) / 10;
  const speed = num(point.speed);
  return speed != null ? Math.round(speed * 10) / 10 : null;
}

function isAprs(point) {
  return (
    String(point.modulation || '').toUpperCase() === 'APRS' ||
    !!point.aprs_tocall ||
    /APRS/i.test(String(point.software_name || ''))
  );
}

/**
 * @param {object} raw  SondeHub amateur telemetry response
 * @param {{ maxBalloons?: number, maxTrail?: number, now?: number }} opts
 * @returns {Array<object>} balloons, newest last-heard first
 */
function slimBalloons(raw, { maxBalloons = MAX_BALLOONS, maxTrail = MAX_TRAIL } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out = [];
  for (const [callsign, series] of Object.entries(raw)) {
    if (!series || typeof series !== 'object') continue;
    const points = [];
    for (const [key, p] of Object.entries(series)) {
      if (!p || typeof p !== 'object') continue;
      const lat = num(p.lat);
      const lon = num(p.lon);
      const t = parseTime(p, key);
      if (lat == null || lon == null || t == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      points.push({ t, lat, lon, alt: num(p.alt), p });
    }
    if (!points.length) continue;
    points.sort((a, b) => a.t - b.t);
    const last = points[points.length - 1];
    const lp = last.p;
    const uploaders = Array.isArray(lp.uploaders) ? lp.uploaders.map((u) => u?.uploader_callsign).filter(Boolean) : [];
    const trail = decimate(points, maxTrail).map((pt) => [
      Math.round(pt.lat * 1e4) / 1e4,
      Math.round(pt.lon * 1e4) / 1e4,
      pt.alt != null ? Math.round(pt.alt) : null,
      pt.t,
    ]);
    out.push({
      id: String(lp.payload_callsign || callsign),
      call: String(lp.payload_callsign || callsign),
      lat: Math.round(last.lat * 1e4) / 1e4,
      lon: Math.round(last.lon * 1e4) / 1e4,
      alt: last.alt != null ? Math.round(last.alt) : null, // metres
      speedKmh: speedKmh(lp),
      ascentRate: num(lp.ascent_rate), // m/s
      heading: num(lp.heading),
      lastHeard: new Date(last.t).toISOString(),
      firstHeard: new Date(points[0].t).toISOString(),
      frames: points.length,
      model: lp.model || lp.type || null,
      modulation: lp.modulation || null,
      frequency: num(lp.frequency), // MHz, when the tracker reports it
      comment: typeof lp.comment === 'string' ? lp.comment.slice(0, 120) : null,
      uploader: lp.uploader_callsign || uploaders[0] || null,
      uploaders: uploaders.length
        ? [...new Set(uploaders)].slice(0, 10)
        : lp.uploader_callsign
          ? [lp.uploader_callsign]
          : [],
      aprs: isAprs(lp),
      batt: num(lp.batt),
      temp: num(lp.temp),
      sats: num(lp.sats),
      trail,
    });
  }
  out.sort((a, b) => Date.parse(b.lastHeard) - Date.parse(a.lastHeard));
  return out.slice(0, maxBalloons);
}

/**
 * SondeHub amateur listeners/telemetry → [{ call, lat, lon, alt, lastSeen, radio, antenna, mobile }]
 * Same keyed-by-callsign-then-time shape; one entry per station (latest).
 */
function slimListeners(raw, { maxListeners = 1000 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out = [];
  for (const [callsign, series] of Object.entries(raw)) {
    if (!series || typeof series !== 'object') continue;
    let best = null;
    for (const [key, p] of Object.entries(series)) {
      const t = Date.parse(p?.ts || key || '');
      if (!Number.isFinite(t)) continue;
      if (!best || t > best.t) best = { t, p };
    }
    if (!best) continue;
    const pos = Array.isArray(best.p.uploader_position)
      ? best.p.uploader_position
      : typeof best.p.uploader_position === 'string'
        ? best.p.uploader_position.split(',').map(Number)
        : [];
    const lat = num(pos[0]);
    const lon = num(pos[1]);
    if (lat == null || lon == null || (lat === 0 && lon === 0)) continue;
    out.push({
      call: String(best.p.uploader_callsign || callsign),
      lat: Math.round(lat * 1e3) / 1e3,
      lon: Math.round(lon * 1e3) / 1e3,
      alt: num(pos[2] ?? best.p.uploader_alt),
      lastSeen: new Date(best.t).toISOString(),
      radio: best.p.uploader_radio ? String(best.p.uploader_radio).slice(0, 80) : null,
      antenna: best.p.uploader_antenna ? String(best.p.uploader_antenna).slice(0, 80) : null,
      mobile: !!best.p.mobile,
    });
  }
  out.sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  return out.slice(0, maxListeners);
}

module.exports = { slimBalloons, slimListeners, decimate, MAX_BALLOONS, MAX_TRAIL };
