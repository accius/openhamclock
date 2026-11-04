'use strict';
/**
 * gpsd.js — map gpsd JSON (TPV / SKY) messages onto the same fix object the
 * NMEA parser produces, so the GPS plugin publishes one shape regardless of
 * source.
 *
 * gpsd protocol: after connecting to port 2947 send
 *   ?WATCH={"enable":true,"json":true};
 * and gpsd streams one JSON object per line. TPV = time/position/velocity,
 * SKY = satellite constellation (used count lives here, not in TPV).
 */

const { latLonToGrid } = require('./maidenhead');

const MS_TO_KMH = 3.6;

/**
 * Apply a TPV message to a fix object (mutates and returns `fix`).
 * TPV.mode: 0 = unknown, 1 = no fix, 2 = 2D, 3 = 3D.
 */
function applyTpv(fix, tpv, now = Date.now()) {
  if (!tpv || tpv.class !== 'TPV') return null;
  const mode = Number.isFinite(tpv.mode) ? tpv.mode : 0;
  fix.fix = mode >= 2 && Number.isFinite(tpv.lat) && Number.isFinite(tpv.lon);
  fix.mode = mode >= 2 ? mode : null;
  if (Number.isFinite(tpv.lat)) fix.lat = tpv.lat;
  if (Number.isFinite(tpv.lon)) fix.lon = tpv.lon;
  const alt = Number.isFinite(tpv.altMSL) ? tpv.altMSL : Number.isFinite(tpv.alt) ? tpv.alt : tpv.altHAE;
  if (Number.isFinite(alt)) fix.alt = alt;
  if (Number.isFinite(tpv.speed)) fix.speed = tpv.speed * MS_TO_KMH;
  if (Number.isFinite(tpv.track)) fix.course = tpv.track;
  if (typeof tpv.time === 'string' && !Number.isNaN(Date.parse(tpv.time))) fix.time = new Date(tpv.time).toISOString();
  if (Number.isFinite(tpv.eph)) fix.eph = tpv.eph;
  fix.grid6 = fix.fix ? latLonToGrid(fix.lat, fix.lon, 6) : null;
  fix.updatedAt = now;
  return fix;
}

/** Apply a SKY message: satellites used + HDOP (mutates and returns `fix`). */
function applySky(fix, sky, now = Date.now()) {
  if (!sky || sky.class !== 'SKY') return null;
  if (Number.isFinite(sky.uSat)) fix.sats = sky.uSat;
  else if (Array.isArray(sky.satellites)) fix.sats = sky.satellites.filter((s) => s && s.used).length;
  if (Number.isFinite(sky.hdop)) fix.hdop = sky.hdop;
  fix.updatedAt = now;
  return fix;
}

/** Parse one gpsd line; returns the object or null when it isn't JSON. */
function parseGpsdLine(line) {
  const s = String(line || '').trim();
  if (!s.startsWith('{')) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const WATCH_COMMAND = '?WATCH={"enable":true,"json":true};\n';

module.exports = { applyTpv, applySky, parseGpsdLine, WATCH_COMMAND, MS_TO_KMH };
