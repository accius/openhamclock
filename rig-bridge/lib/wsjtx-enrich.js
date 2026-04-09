'use strict';
/**
 * wsjtx-enrich.js — WSJT-X message enrichment utilities for rig-bridge plugins
 *
 * Provides the intelligence layer that the OHC server applies to raw WSJT-X
 * messages, now available locally so SSE consumers get enriched events without
 * needing a server connection.
 *
 * Features
 * ────────
 *  • FT8/FT4/JT65 message text parsing  — CQ / QSO classification, callsign
 *    and grid extraction, modifier detection (DX, POTA, NA, …)
 *  • Maidenhead grid → lat/lon           — pure math, no external dependency
 *  • Frequency (Hz) → band name          — 160 m … 70 cm + fallback
 *  • In-message grid cache               — remembers callsign → grid from CQ
 *    and exchange messages; entries expire after 2 h
 *  • HamQTH callsign lookup (opt-in)     — resolves unknown callsigns to
 *    country-level lat/lon; results cached 24 h, max 5 concurrent requests
 *
 * Exported helpers
 * ────────────────
 *  gridToLatLon(grid)                         → { lat, lon } | null
 *  getBandFromHz(freqHz)                      → string  (e.g. '20m')
 *  createGridCache()                          → { get, set, prune, size }
 *  createCallsignCache()                      → { get, set, prune, size }
 *  parseDecodeMessage(text, cache, myCall)    → parsed object
 *  enrichDecode(msg, clientState, gridCache,
 *               myCall, callsignCache)        → enriched decode object
 *  enrichStatus(msg, prevState, cache)        → enriched status fields
 *  enrichQso(msg)                             → enriched QSO object
 *  enrichWspr(msg)                            → enriched WSPR object
 *  triggerHamqthLookup(callsign,
 *    callsignCache, inflightSet, onResult)    → void  (fire-and-forget)
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ──────────────────────────────────────────────────────────────────────────────
// FT8 token blacklist — look like Maidenhead grids but are QSO protocol tokens
// ──────────────────────────────────────────────────────────────────────────────

const FT8_TOKENS = new Set(['RR73', 'RR53', 'RR13', 'RR23', 'RR33', 'RR43', 'RR63', 'RR83', 'RR93']);

const GRID_REGEX = /\b([A-R]{2}\d{2}(?:[a-x]{2})?)\b/i;

/**
 * Return true if `s` is a syntactically valid Maidenhead grid AND not an FT8
 * protocol token that happens to match the grid pattern (e.g. RR73).
 */
function isGrid(s) {
  if (!s || s.length < 4) return false;
  const g = s.toUpperCase();
  if (FT8_TOKENS.has(g)) return false;
  return /^[A-R]{2}\d{2}(?:[A-Xa-x]{2})?$/.test(s);
}

// ──────────────────────────────────────────────────────────────────────────────
// Grid → lat/lon
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Convert a Maidenhead grid locator to the centre lat/lon of that square.
 * Supports 4-char field+square and 6-char +subsquare locators. Case-insensitive.
 *
 * Returns null for any invalid input so callers can use `== null` guards without
 * accidentally treating the equator/prime-meridian (0,0) as absent.
 *
 * @param {string} grid
 * @returns {{ lat: number, lon: number } | null}
 */
function gridToLatLon(grid) {
  if (!grid) return null;
  const g = String(grid).trim().toUpperCase();
  if (g.length < 4) return null;

  const A = 'A'.charCodeAt(0);
  const lonField = g.charCodeAt(0) - A;
  const latField = g.charCodeAt(1) - A;
  // Field letters must be A–R (0–17)
  if (lonField < 0 || lonField > 17 || latField < 0 || latField > 17) return null;

  const lonSquare = parseInt(g[2], 10);
  const latSquare = parseInt(g[3], 10);
  if (!Number.isFinite(lonSquare) || !Number.isFinite(latSquare)) return null;

  let lon = -180 + lonField * 20 + lonSquare * 2;
  let lat = -90 + latField * 10 + latSquare;

  if (g.length >= 6) {
    const lonSub = g.charCodeAt(4) - A;
    const latSub = g.charCodeAt(5) - A;
    if (lonSub < 0 || lonSub > 23 || latSub < 0 || latSub > 23) {
      // Invalid subsquare — centre the 4-char square instead
      lon += 1.0;
      lat += 0.5;
    } else {
      lon += lonSub * (2 / 24) + 1 / 24;
      lat += latSub * (1 / 24) + 0.5 / 24;
    }
  } else {
    lon += 1.0;
    lat += 0.5;
  }

  return { lat, lon };
}

// ──────────────────────────────────────────────────────────────────────────────
// Hz → band name
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Return the amateur radio band name for a dial frequency in Hz.
 * Returns an empty string for frequencies that do not fall in a known band.
 *
 * @param {number} freqHz
 * @returns {string}
 */
function getBandFromHz(freqHz) {
  if (!freqHz) return '';
  const mhz = freqHz / 1_000_000;
  if (mhz >= 1.8 && mhz < 2.0) return '160m';
  if (mhz >= 3.5 && mhz < 4.0) return '80m';
  if (mhz >= 5.3 && mhz < 5.4) return '60m';
  if (mhz >= 7.0 && mhz < 7.3) return '40m';
  if (mhz >= 10.1 && mhz < 10.15) return '30m';
  if (mhz >= 14.0 && mhz < 14.35) return '20m';
  if (mhz >= 18.068 && mhz < 18.168) return '17m';
  if (mhz >= 21.0 && mhz < 21.45) return '15m';
  if (mhz >= 24.89 && mhz < 24.99) return '12m';
  if (mhz >= 28.0 && mhz < 29.7) return '10m';
  if (mhz >= 40.0 && mhz < 42.0) return '8m';
  if (mhz >= 50.0 && mhz < 54.0) return '6m';
  if (mhz >= 70.0 && mhz < 70.5) return '4m';
  if (mhz >= 144.0 && mhz < 148.0) return '2m';
  if (mhz >= 420.0 && mhz < 450.0) return '70cm';
  return '';
}

// ──────────────────────────────────────────────────────────────────────────────
// In-message grid cache
// ──────────────────────────────────────────────────────────────────────────────

const GRID_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Create a per-plugin-instance grid cache.
 *
 * Maps callsign (uppercase) → { grid, lat, lon, timestamp }.
 * Populated from CQ and exchange messages observed on the air; entries expire
 * after 2 hours of not being refreshed.
 *
 * @returns {{ get(call): entry|null, set(call, grid, lat, lon): void, prune(): void, size: number }}
 */
function createGridCache() {
  const _map = new Map();

  function set(callsign, grid, lat, lon) {
    if (!callsign || !grid) return;
    _map.set(callsign.toUpperCase(), { grid, lat, lon, timestamp: Date.now() });
  }

  function get(callsign) {
    if (!callsign) return null;
    const entry = _map.get(callsign.toUpperCase());
    if (!entry) return null;
    if (Date.now() - entry.timestamp > GRID_CACHE_TTL) {
      _map.delete(callsign.toUpperCase());
      return null;
    }
    return entry;
  }

  function prune() {
    const cutoff = Date.now() - GRID_CACHE_TTL;
    for (const [key, entry] of _map) {
      if (entry.timestamp < cutoff) _map.delete(key);
    }
  }

  return {
    get,
    set,
    prune,
    get size() {
      return _map.size;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HamQTH callsign → lat/lon cache
// ──────────────────────────────────────────────────────────────────────────────

const CALLSIGN_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Create a per-plugin-instance callsign lookup cache.
 *
 * Stores the results of HamQTH DXCC lookups: callsign → { lat, lon, timestamp }.
 * Separate from the grid cache because it comes from a different source (remote
 * DXCC database) and has a longer TTL (24 h vs 2 h).
 *
 * @returns {{ get(call): entry|null, set(call, lat, lon): void, prune(): void, size: number }}
 */
function createCallsignCache() {
  const _map = new Map();

  function set(callsign, lat, lon) {
    if (!callsign || lat == null || lon == null) return;
    _map.set(callsign.toUpperCase(), { lat, lon, timestamp: Date.now() });
  }

  function get(callsign) {
    if (!callsign) return null;
    const entry = _map.get(callsign.toUpperCase());
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CALLSIGN_CACHE_TTL) {
      _map.delete(callsign.toUpperCase());
      return null;
    }
    return entry;
  }

  function prune() {
    const cutoff = Date.now() - CALLSIGN_CACHE_TTL;
    for (const [key, entry] of _map) {
      if (entry.timestamp < cutoff) _map.delete(key);
    }
  }

  return {
    get,
    set,
    prune,
    get size() {
      return _map.size;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HamQTH lookup (fire-and-forget)
// ──────────────────────────────────────────────────────────────────────────────

const HAMQTH_MAX_CONCURRENT = 5;
const HAMQTH_TIMEOUT_MS = 5000;

/**
 * Fire-and-forget background callsign → lat/lon lookup via HamQTH DXCC API.
 *
 * Writes the result into `callsignCache` so future decodes from the same
 * callsign resolve without another network request.  Calls `onResult` with
 * `{ callsign, lat, lon }` when the lookup succeeds, allowing the caller to
 * emit a `decode-update` event for already-displayed decodes.
 *
 * Concurrency is capped at HAMQTH_MAX_CONCURRENT (5) via `inflightSet`.
 * All errors are silently swallowed — this is purely a best-effort enrichment.
 *
 * @param {string}   callsign      Uppercase base callsign (no portable suffixes)
 * @param {object}   callsignCache Cache from createCallsignCache()
 * @param {Set}      inflightSet   Shared Set of in-flight callsigns
 * @param {function} onResult      Called with { callsign, lat, lon } on success
 */
function triggerHamqthLookup(callsign, callsignCache, inflightSet, onResult) {
  if (!callsign || callsign.length < 3) return;
  if (inflightSet.has(callsign)) return;
  if (inflightSet.size >= HAMQTH_MAX_CONCURRENT) return;
  // Already cached — nothing to do
  if (callsignCache.get(callsign)) return;

  inflightSet.add(callsign);

  const reqUrl = `https://www.hamqth.com/dxcc.php?callsign=${encodeURIComponent(callsign)}`;
  let parsed;
  try {
    parsed = new URL(reqUrl);
  } catch {
    inflightSet.delete(callsign);
    return;
  }

  const transport = parsed.protocol === 'https:' ? https : http;
  const req = transport.request(
    {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'rig-bridge/wsjtx-enrich' },
      timeout: HAMQTH_TIMEOUT_MS,
    },
    (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        inflightSet.delete(callsign);
        if (res.statusCode !== 200) return;
        const latMatch = body.match(/<lat>([^<]+)<\/lat>/);
        const lonMatch = body.match(/<lng>([^<]+)<\/lng>/);
        if (!latMatch || !lonMatch) return;
        const lat = parseFloat(latMatch[1]);
        const lon = parseFloat(lonMatch[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        callsignCache.set(callsign, lat, lon);
        if (onResult) onResult({ callsign, lat, lon });
      });
    },
  );

  req.on('error', () => inflightSet.delete(callsign));
  req.on('timeout', () => {
    req.destroy();
    inflightSet.delete(callsign);
  });
  req.end();
}

// ──────────────────────────────────────────────────────────────────────────────
// FT8 message text parser
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parse FT8/FT4/JT65 decoded message text into structured fields.
 *
 * As a side-effect, callsign→grid mappings discovered in CQ and exchange
 * messages are written into `gridCache` for later resolve-by-callsign lookups.
 *
 * @param {string}      text       Raw decoded message (e.g. "CQ DX W1AW FN31")
 * @param {object}      gridCache  Cache from createGridCache()
 * @param {string|null} myCall     Operator callsign (for QSO direction detection)
 * @returns {{ type?: string, caller?: string, modifier?: string,
 *             dxCall?: string, deCall?: string, exchange?: string,
 *             grid?: string }}
 */
function parseDecodeMessage(text, gridCache, myCall) {
  if (!text) return {};
  const result = {};

  // ── CQ messages ──────────────────────────────────────────────────────────
  // Formats: "CQ CALLSIGN"
  //          "CQ CALLSIGN GRID"
  //          "CQ DX CALLSIGN GRID"
  //          "CQ POTA N0VIG EM28"
  if (/^CQ\s/i.test(text)) {
    result.type = 'CQ';
    const tokens = text.split(/\s+/).slice(1); // drop leading "CQ"

    // Last token may be a grid square
    let grid = null;
    if (tokens.length >= 2 && isGrid(tokens[tokens.length - 1])) {
      grid = tokens.pop();
    }

    // What remains is: [modifier…] CALLSIGN
    if (tokens.length >= 1) {
      result.caller = tokens[tokens.length - 1];
      result.modifier = tokens.length >= 2 ? tokens.slice(0, -1).join(' ') : null;
    }
    result.grid = grid ?? null;

    // Populate the grid cache so later QSO exchanges can resolve this station
    if (result.caller && result.grid) {
      const coords = gridToLatLon(result.grid);
      if (coords) gridCache.set(result.caller, result.grid, coords.lat, coords.lon);
    }
    return result;
  }

  // ── Standard QSO exchange ─────────────────────────────────────────────────
  // Format: "DXCALL DECALL EXCHANGE"
  // Exchange examples: grid (EN82), report (+05, -12, R+05, R-12), 73, RR73
  const qsoMatch = text.match(/^([A-Z0-9/<>.]+)\s+([A-Z0-9/<>.]+)\s+(.*)/i);
  if (qsoMatch) {
    result.type = 'QSO';
    result.dxCall = qsoMatch[1];
    result.deCall = qsoMatch[2];
    result.exchange = qsoMatch[3].trim();

    const gridMatch = result.exchange.match(GRID_REGEX);
    if (gridMatch && isGrid(gridMatch[1])) {
      result.grid = gridMatch[1];
      const coords = gridToLatLon(result.grid);
      if (coords) {
        // The grid belongs to whichever station is NOT the operator
        const mc = (myCall || '').toUpperCase();
        const cacheCall = mc && result.deCall.toUpperCase() === mc ? result.dxCall : result.deCall;
        gridCache.set(cacheCall, result.grid, coords.lat, coords.lon);
      }
    }
    return result;
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// Enrichment helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build an enriched decode object from a raw WSJT-X DECODE message.
 *
 * Enrichments over the raw message:
 *  • content-based `id` for deduplication
 *  • parsed message fields (type, caller, grid, modifier, dxCall, deCall, …)
 *  • lat/lon from in-message grid, then grid cache fallback
 *  • band name from current client status
 *
 * @param {object}      msg            Raw DECODE from parseMessage()
 * @param {object|null} clientState    Current client state { band, dialFrequency, mode }
 * @param {object}      gridCache      Cache from createGridCache()
 * @param {string|null} myCall         Operator callsign
 * @param {object|null} callsignCache  Optional cache from createCallsignCache() for
 *                                     HamQTH-resolved coordinates (Phase 5)
 * @returns {object}
 */
function enrichDecode(msg, clientState, gridCache, myCall, callsignCache) {
  const parsed = parseDecodeMessage(msg.message, gridCache, myCall);
  const state = clientState ?? {};

  const decode = {
    // Stable content-based ID for deduplication at SSE consumer level
    id: `${msg.id}-${(msg.time?.formatted ?? '').replace(/[^0-9]/g, '')}-${msg.deltaFreq ?? 0}-${(msg.message ?? '').replace(/\s+/g, '')}`,
    clientId: msg.id,
    isNew: msg.isNew,
    time: msg.time?.formatted ?? '',
    timeMs: msg.time?.ms ?? 0,
    snr: msg.snr,
    dt: msg.deltaTime != null ? msg.deltaTime.toFixed(1) : '0.0',
    freq: msg.deltaFreq,
    mode: msg.mode || state.mode || '',
    message: msg.message,
    lowConfidence: msg.lowConfidence,
    offAir: msg.offAir,
    dialFrequency: state.dialFrequency ?? 0,
    band: state.band ?? '',
    // Spread parsed fields (type, caller, modifier, dxCall, deCall, exchange, grid)
    ...parsed,
    timestamp: msg.timestamp,
  };

  // ── Resolve grid → lat/lon ──────────────────────────────────────────────
  let lat = null;
  let lon = null;
  let gridSource = null;

  if (parsed.grid) {
    const coords = gridToLatLon(parsed.grid);
    if (coords) {
      lat = coords.lat;
      lon = coords.lon;
      gridSource = 'message';
    }
  }

  // Fall back to grid cache (from a prior CQ/exchange that included this callsign's grid)
  if (lat == null) {
    const targetCall = (parsed.caller ?? parsed.deCall ?? parsed.dxCall ?? '').toUpperCase();
    if (targetCall) {
      const cached = gridCache.get(targetCall);
      if (cached) {
        lat = cached.lat;
        lon = cached.lon;
        if (!decode.grid) decode.grid = cached.grid;
        gridSource = 'cache';
      }
    }
  }

  // Fall back to HamQTH callsign cache (country-level, populated asynchronously)
  if (lat == null && callsignCache) {
    const targetCall = (parsed.caller ?? parsed.deCall ?? parsed.dxCall ?? '').toUpperCase();
    if (targetCall) {
      const cached = callsignCache.get(targetCall);
      if (cached) {
        lat = cached.lat;
        lon = cached.lon;
        gridSource = 'hamqth';
      }
    }
  }

  if (lat != null) decode.lat = lat;
  if (lon != null) decode.lon = lon;
  if (gridSource) decode.gridSource = gridSource;

  return decode;
}

/**
 * Compute the enriched fields for a STATUS message.
 *
 * Derives band name, detects band changes, resolves DX and DE grids to lat/lon.
 * Does NOT modify `msg` — returns a plain object to spread into the bus event.
 *
 * @param {object}      msg        Raw STATUS from parseMessage()
 * @param {object|null} prevState  Previous enriched state for this client, or null
 * @param {object}      gridCache  Cache from createGridCache()
 * @returns {{ band, bandChanged, dxCall, dxGrid, dxLat, dxLon, deLat, deLon }}
 */
function enrichStatus(msg, prevState, gridCache) {
  const band = msg.dialFrequency ? getBandFromHz(msg.dialFrequency) : '';
  const prevBand = prevState?.band ?? null;
  const bandChanged = !!(prevBand && band && prevBand !== band);

  const dxCall = (msg.dxCall ?? '').replace(/[<>]/g, '').trim() || null;
  let dxLat = null;
  let dxLon = null;
  let dxGrid = msg.dxGrid ?? null;

  if (dxCall) {
    // 1. Use dxGrid supplied by WSJT-X in this message
    if (dxGrid) {
      const coords = gridToLatLon(dxGrid);
      if (coords) {
        dxLat = coords.lat;
        dxLon = coords.lon;
      }
    }
    // 2. Fall back to what we have heard on air (grid cache)
    if (dxLat == null) {
      const cached = gridCache.get(dxCall);
      if (cached) {
        dxLat = cached.lat;
        dxLon = cached.lon;
        dxGrid = dxGrid ?? cached.grid;
      }
    }
  }

  // Resolve operator grid (deGrid) if present
  let deLat = null;
  let deLon = null;
  if (msg.deGrid) {
    const coords = gridToLatLon(msg.deGrid);
    if (coords) {
      deLat = coords.lat;
      deLon = coords.lon;
    }
  }

  return { band, bandChanged, dxCall, dxGrid, dxLat, dxLon, deLat, deLon };
}

/**
 * Build an enriched QSO_LOGGED object.
 *
 * Adds band name and resolves dxGrid → lat/lon.
 *
 * @param {object} msg  Raw QSO_LOGGED from parseMessage()
 * @returns {object}
 */
function enrichQso(msg) {
  const band = msg.txFrequency ? getBandFromHz(msg.txFrequency) : '';

  const qso = {
    clientId: msg.id,
    dxCall: msg.dxCall,
    dxGrid: msg.dxGrid,
    frequency: msg.txFrequency,
    band,
    mode: msg.mode,
    reportSent: msg.reportSent,
    reportRecv: msg.reportRecv,
    myCall: msg.myCall,
    myGrid: msg.myGrid,
    timestamp: msg.timestamp,
  };

  if (msg.dxGrid) {
    const coords = gridToLatLon(msg.dxGrid);
    if (coords) {
      qso.lat = coords.lat;
      qso.lon = coords.lon;
    }
  }

  return qso;
}

/**
 * Build an enriched WSPR_DECODE object.
 *
 * Resolves the WSPR station's grid → lat/lon for map plotting.
 *
 * @param {object} msg  Raw WSPR_DECODE from parseMessage()
 * @returns {object}
 */
function enrichWspr(msg) {
  const wspr = {
    clientId: msg.id,
    isNew: msg.isNew,
    time: msg.time?.formatted ?? '',
    timeMs: msg.time?.ms ?? 0,
    snr: msg.snr,
    dt: msg.deltaTime != null ? msg.deltaTime.toFixed(1) : '0.0',
    frequency: msg.frequency,
    band: msg.frequency ? getBandFromHz(msg.frequency) : '',
    drift: msg.drift,
    callsign: msg.callsign,
    grid: msg.grid,
    power: msg.power,
    offAir: msg.offAir,
    timestamp: msg.timestamp,
  };

  if (msg.grid) {
    const coords = gridToLatLon(msg.grid);
    if (coords) {
      wspr.lat = coords.lat;
      wspr.lon = coords.lon;
    }
  }

  return wspr;
}

// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  isGrid,
  gridToLatLon,
  getBandFromHz,
  createGridCache,
  createCallsignCache,
  parseDecodeMessage,
  enrichDecode,
  enrichStatus,
  enrichQso,
  enrichWspr,
  triggerHamqthLookup,
};
