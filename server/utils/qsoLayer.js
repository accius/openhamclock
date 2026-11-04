/**
 * QSO Layer open API — validation + normalization (issue #1015).
 *
 * Pure functions, no Express/ctx dependencies, so the ingest contract can be
 * unit-tested directly (see qsoLayer.test.js). Used by server/routes/openapi.js.
 *
 * Accepted input QSO shape (all extra fields are dropped):
 *   call       string   required — callsign of the worked station
 *   freq       number   optional — frequency in MHz (also accepts freq_mhz / freq_khz)
 *   band       string   optional — e.g. "20m"; derived from freq when omitted
 *   mode       string   optional — e.g. "SSB", "FT8"
 *   grid       string   optional — Maidenhead locator (2/4/6/8 chars)
 *   lat, lon   number   optional — decimal degrees; used as-is when provided
 *   timestamp  string|number optional — ISO 8601 or epoch ms; defaults to "now"
 *   label      string   optional — free-text shown in the marker popup
 *   color      string   optional — CSS color (#hex or named) for marker/path
 *
 * At least one of `grid` or `lat`+`lon` is required — this API exists to put
 * QSOs on the map, so a QSO we cannot place is rejected.
 */

const { maidenheadToLatLon, validateGridLocator, getBandFromHz } = require('./grid');

const MAX_BATCH = 100;
const MAX_TIMESTAMP_SKEW_MS = 24 * 60 * 60 * 1000; // reject timestamps >24h in the future

// Callsign: letters/digits with optional portable prefixes/suffixes (EA8/K0CJH/P).
const CALL_RE = /^[A-Z0-9]{1,12}(\/[A-Z0-9]{1,12}){0,2}$/;
// CSS color: #rgb..#rrggbbaa or a simple named color — same rule the N3FJP layer uses.
const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;

function cleanString(value, maxLen) {
  if (typeof value !== 'string') return '';
  // Strip control characters; trim; cap length.
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Validate and normalize a single QSO object.
 * @param {object} input - raw QSO from the request body
 * @param {number} [now] - injectable clock for tests (epoch ms)
 * @returns {{ok: true, qso: object} | {ok: false, error: string}}
 */
function validateQso(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'QSO must be an object' };
  }

  // --- call (required) ---
  const call = cleanString(input.call || input.dx_call || '', 24).toUpperCase();
  if (!call) return { ok: false, error: 'call is required' };
  if (!CALL_RE.test(call)) return { ok: false, error: `invalid call: ${call}` };

  // --- frequency (MHz) / band ---
  let freq = null;
  if (input.freq != null || input.freq_mhz != null) {
    const f = Number(input.freq != null ? input.freq : input.freq_mhz);
    if (!Number.isFinite(f) || f <= 0 || f > 300000) {
      return { ok: false, error: 'freq must be a positive number in MHz' };
    }
    freq = f;
  } else if (input.freq_khz != null) {
    const f = Number(input.freq_khz);
    if (!Number.isFinite(f) || f <= 0) {
      return { ok: false, error: 'freq_khz must be a positive number' };
    }
    freq = f / 1000;
  }

  let band = cleanString(input.band || '', 8);
  if (!band && freq != null) {
    const derived = getBandFromHz(freq * 1e6);
    if (derived && derived !== 'Unknown') band = derived;
  }

  // --- location: grid and/or lat+lon (at least one required) ---
  let lat = null;
  let lon = null;
  let grid = cleanString(input.grid || '', 8).toUpperCase();
  if (grid && !validateGridLocator(grid)) {
    return { ok: false, error: `invalid grid: ${grid}` };
  }

  if (input.lat != null || input.lon != null) {
    const la = Number(input.lat);
    const lo = Number(input.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      return { ok: false, error: 'lat/lon must be finite numbers within range' };
    }
    lat = la;
    lon = lo;
  } else if (grid) {
    const loc = maidenheadToLatLon(grid);
    if (!loc) return { ok: false, error: `could not resolve grid: ${grid}` };
    lat = loc.lat;
    lon = loc.lon;
  }

  if (lat == null || lon == null) {
    return { ok: false, error: 'grid or lat/lon is required' };
  }

  // --- timestamp ---
  let ts = now;
  if (input.timestamp != null && input.timestamp !== '') {
    ts = typeof input.timestamp === 'number' ? input.timestamp : Date.parse(input.timestamp);
    if (!Number.isFinite(ts) || Number.isNaN(ts)) {
      return { ok: false, error: 'timestamp must be ISO 8601 or epoch milliseconds' };
    }
    if (ts > now + MAX_TIMESTAMP_SKEW_MS) {
      return { ok: false, error: 'timestamp is too far in the future' };
    }
  }

  // --- optional presentation fields ---
  const mode = cleanString(input.mode || '', 16).toUpperCase();
  const label = cleanString(input.label || '', 120);
  let color = cleanString(input.color || '', 24);
  if (color && !COLOR_RE.test(color)) color = '';

  const qso = {
    call,
    lat,
    lon,
    ts_utc: new Date(ts).toISOString(),
    source: 'api',
  };
  if (freq != null) qso.freq = freq;
  if (band) qso.band = band;
  if (mode) qso.mode = mode;
  if (grid) qso.grid = grid;
  if (label) qso.label = label;
  if (color) qso.color = color;

  return { ok: true, qso };
}

/**
 * Normalize a request body into a validated QSO batch.
 * Accepts a single QSO object, a bare array of QSOs, or { qsos: [...] }.
 * Batches are capped at MAX_BATCH entries; excess entries are rejected.
 * @returns {{ qsos: object[], errors: string[] }}
 */
function normalizeQsoBatch(body, now = Date.now()) {
  let items;
  if (Array.isArray(body)) {
    items = body;
  } else if (body && typeof body === 'object' && Array.isArray(body.qsos)) {
    items = body.qsos;
  } else if (body && typeof body === 'object') {
    items = [body];
  } else {
    return { qsos: [], errors: ['body must be a QSO object, an array, or { qsos: [...] }'] };
  }

  const qsos = [];
  const errors = [];
  if (items.length > MAX_BATCH) {
    errors.push(`batch capped at ${MAX_BATCH} QSOs — ${items.length - MAX_BATCH} entries ignored`);
    items = items.slice(0, MAX_BATCH);
  }

  items.forEach((item, i) => {
    const result = validateQso(item, now);
    if (result.ok) qsos.push(result.qso);
    else errors.push(`qso[${i}]: ${result.error}`);
  });

  return { qsos, errors };
}

module.exports = { validateQso, normalizeQsoBatch, MAX_BATCH };
