'use strict';
/**
 * http-json.js — pick values out of arbitrary JSON (ESPHome, Tasmota,
 * Home Assistant, weather station firmwares…) by a dotted path such as
 *   "StatusSNS.BME280.Temperature"   (Tasmota)
 *   "sensor.temperature.state"       (ESPHome web_server JSON)
 *   "readings[0].value"              (array index)
 */

/** Resolve a dotted / bracketed path; undefined when any hop is missing. */
function getPath(obj, path) {
  if (obj == null) return undefined;
  const p = String(path || '').trim();
  if (!p) return undefined;
  const parts = p
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = obj;
  for (const key of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Numeric value at path (numbers, numeric strings, {value|state}) or null. */
function pickNumber(obj, path) {
  let v = getPath(obj, path);
  if (v && typeof v === 'object') v = v.value ?? v.state ?? v.val;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const str = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return null; // ISO date, not a reading
    const m = /^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(str);
    v = m ? parseFloat(m[0]) : NaN;
  }
  return Number.isFinite(v) ? v : null;
}

/** Temperature to °C from the configured unit. */
function toCelsius(v, unit) {
  if (v == null) return null;
  return String(unit || 'C').toUpperCase() === 'F' ? ((v - 32) * 5) / 9 : v;
}

/** Pressure to hPa from the configured unit. */
function toHpa(v, unit) {
  if (v == null) return null;
  const u = String(unit || 'hPa').toLowerCase();
  if (u === 'pa') return v / 100;
  if (u === 'inhg') return v * 33.8639;
  if (u === 'kpa') return v * 10;
  if (u === 'mmhg') return v * 1.33322;
  return v; // hPa / mbar
}

/**
 * Fetch JSON with a timeout. Only http(s) URLs; the rig-bridge runs on the
 * user's own machine so LAN addresses are expected and allowed.
 */
async function fetchJson(url, timeoutMs = 5000) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('URL must start with http:// or https://');
  if (typeof fetch !== 'function') throw new Error('fetch() not available — Node 18+ required');
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

module.exports = { getPath, pickNumber, toCelsius, toHpa, fetchJson };
