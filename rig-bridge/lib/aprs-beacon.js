'use strict';
/**
 * APRS position beacons through the local TNC (#1262).
 *
 * Off until switched on (aprs.beaconEnabled): the settings page showed a
 * beacon interval for years while nothing was ever sent, so turning the
 * timer on by default would have started transmitting on every bridge.
 *
 * Position, in order: the override on the settings page (beaconLat /
 * beaconLon), a fresh fix from the GPS plugin, then the station location
 * OpenHamClock pushes (stationLat / stationLon). No position → no beacon.
 *
 * "Sent" means the frame was written to the TNC. Dire Wolf may still hold
 * it while the channel is busy, and KISS reports nothing back, so a beacon
 * also counts as "heard" when a digipeated copy of it comes back (an AX.25
 * via address with the has-been-repeated bit set).
 *
 * Settings are read on every tick, so the settings page and the EmComm
 * switch apply without a restart. The clock is injectable for tests.
 */

const MIN_INTERVAL_SEC = 60;
const DEFAULT_INTERVAL_SEC = 600;
const COMMENT_MAX = 43; // APRS position comment limit (no data extension)
const GPS_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_COMMENT = 'OpenHamClock';

const finiteIn = (v, lo, hi) => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** A lat/lon pair, or null when either half is missing or out of range. */
function validPosition(lat, lon) {
  const la = finiteIn(lat, -90, 90);
  const lo = finiteIn(lon, -180, 180);
  return la === null || lo === null ? null : { lat: la, lon: lo };
}

/**
 * Printable ASCII only, without the characters APRS reserves (| ~) and the
 * ones that break the settings page's HTML (" < > &); capped at 43.
 */
function cleanComment(text) {
  return String(text ?? '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[|~"<>&]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, COMMENT_MAX);
}

const DEFAULT_PATH = ['WIDE1-1', 'WIDE2-1'];
const PATH_HOP_RE = /^[A-Z0-9]{1,6}(-([0-9]|1[0-5]))?$/;

/**
 * Digipeater path from config: an array, or the settings page's text
 * ("WIDE1-1,WIDE2-1", commas or spaces). At most 8 hops (AX.25). Anything
 * that is not a valid address, or a blank field → the default path;
 * "DIRECT" → no path.
 */
function parsePath(value) {
  if (value == null) return DEFAULT_PATH.slice();
  const hops = (Array.isArray(value) ? value : String(value).split(/[\s,]+/))
    .map((h) =>
      String(h || '')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  if (!hops.length) return DEFAULT_PATH.slice();
  if (hops.length === 1 && hops[0] === 'DIRECT') return [];
  if (hops.length > 8 || !hops.every((h) => PATH_HOP_RE.test(h))) return DEFAULT_PATH.slice();
  return hops;
}

/** Beacon interval in seconds, never below a minute. */
function intervalSec(settings) {
  const n = parseInt(settings?.beaconInterval, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INTERVAL_SEC;
  return Math.max(MIN_INTERVAL_SEC, n);
}

/**
 * @param {object} deps
 * @param {() => object} deps.settings   live config.aprs
 * @param {(lat, lon, comment) => string|null} deps.transmit  send a beacon; returns its info field, or null
 * @param {() => boolean} deps.isConnected
 * @param {() => string} deps.myCall     this station's callsign-SSID, live
 * @param {() => number} [deps.now]
 */
function createBeaconer({ settings, transmit, isConnected, myCall, now = Date.now }) {
  let gpsFix = null; // { lat, lon, at }
  let lastSent = null; // { at, info, lat, lon, source, manual }
  let lastHeard = null; // { at, via }
  let lastError = null;

  function position() {
    const s = settings() || {};
    const override = validPosition(s.beaconLat, s.beaconLon);
    if (override) return { ...override, source: 'override' };
    if (gpsFix && now() - gpsFix.at <= GPS_MAX_AGE_MS) return { lat: gpsFix.lat, lon: gpsFix.lon, source: 'gps' };
    const station = validPosition(s.stationLat, s.stationLon);
    if (station) return { ...station, source: 'station' };
    return null;
  }

  function comment() {
    const s = settings() || {};
    return cleanComment(s.beaconComment) || DEFAULT_COMMENT;
  }

  /** Send one beacon now. @returns {{ ok: boolean, error?: string }} */
  function send({ manual = false } = {}) {
    if (!isConnected()) {
      lastError = 'TNC not connected';
      return { ok: false, error: lastError };
    }
    const pos = position();
    if (!pos) {
      lastError = 'No position: set a beacon location, or open OpenHamClock with your station location set';
      return { ok: false, error: lastError };
    }
    const info = transmit(pos.lat, pos.lon, comment());
    if (!info) {
      lastError = 'TNC write failed';
      return { ok: false, error: lastError };
    }
    lastError = null;
    lastSent = { at: now(), info, lat: pos.lat, lon: pos.lon, source: pos.source, manual };
    lastHeard = null;
    return { ok: true };
  }

  /** Called on a timer; sends when beaconing is on and the interval has passed. */
  function tick() {
    const s = settings() || {};
    if (!s.beaconEnabled || !isConnected()) return false;
    if (lastSent && now() - lastSent.at < intervalSec(s) * 1000) return false;
    return send().ok;
  }

  /** A received frame: a digipeated copy of our last beacon marks it heard. */
  function noteFrame({ source, info, repeatedBy }) {
    if (!lastSent || !Array.isArray(repeatedBy) || !repeatedBy.length) return false;
    if (String(source || '').toUpperCase() !== String(myCall() || '').toUpperCase()) return false;
    if (info !== lastSent.info) return false;
    lastHeard = { at: now(), via: repeatedBy[repeatedBy.length - 1] };
    return true;
  }

  function noteGps(fix) {
    const pos = fix && fix.fix !== false ? validPosition(fix.lat, fix.lon) : null;
    if (pos) gpsFix = { ...pos, at: now() };
  }

  function status() {
    const s = settings() || {};
    const pos = position();
    const enabled = !!s.beaconEnabled;
    const iv = intervalSec(s);
    return {
      enabled,
      intervalSec: iv,
      comment: comment(),
      position: pos,
      lastSent: lastSent ? { at: lastSent.at, lat: lastSent.lat, lon: lastSent.lon, source: lastSent.source } : null,
      lastHeard,
      nextDue: enabled ? (lastSent ? lastSent.at + iv * 1000 : now()) : null,
      error: lastError,
    };
  }

  return { tick, send, noteFrame, noteGps, status, position };
}

module.exports = {
  createBeaconer,
  cleanComment,
  validPosition,
  parsePath,
  intervalSec,
  COMMENT_MAX,
  MIN_INTERVAL_SEC,
  GPS_MAX_AGE_MS,
};
