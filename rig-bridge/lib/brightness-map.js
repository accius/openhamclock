'use strict';
/**
 * brightness-map.js — ambient light → display brightness.
 *
 * Two-point calibration like HamClock's "bright" and "dim" settings: the
 * user records the lux reading (HamClock calls it "phot") in a bright room
 * and in a dark room, and the display brightness wanted at each. Readings in
 * between interpolate linearly; readings outside clamp.
 */

const DEFAULT_CAL = {
  dimLux: 5,
  dimPct: 15,
  brightLux: 400,
  brightPct: 100,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {number} lux measured ambient light
 * @param {object} [cal] { dimLux, dimPct, brightLux, brightPct }
 * @param {number} [minPct=0] hard floor so the screen never goes fully black
 * @returns {number|null} brightness 0..100 (rounded) or null for bad input
 */
function luxToBrightness(lux, cal = DEFAULT_CAL, minPct = 0) {
  if (!Number.isFinite(lux) || lux < 0) return null;
  const c = { ...DEFAULT_CAL, ...(cal || {}) };
  const lo = Math.min(c.dimLux, c.brightLux);
  const hi = Math.max(c.dimLux, c.brightLux);
  const loPct = c.dimLux <= c.brightLux ? c.dimPct : c.brightPct;
  const hiPct = c.dimLux <= c.brightLux ? c.brightPct : c.dimPct;
  let pct;
  if (hi === lo) pct = hiPct;
  else if (lux <= lo) pct = loPct;
  else if (lux >= hi) pct = hiPct;
  else pct = loPct + ((lux - lo) / (hi - lo)) * (hiPct - loPct);
  return Math.round(clamp(pct, clamp(minPct, 0, 100), 100));
}

/** Move `current` toward `target` by at most `maxStep` (smooth transitions). */
function stepToward(current, target, maxStep = 5) {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(target)) return current;
  const d = target - current;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** Scale 0..100 to a backlight's integer range 0..max (never below 0). */
function scaleToHardware(pct, max) {
  if (!Number.isFinite(pct) || !Number.isFinite(max) || max <= 0) return 0;
  return clamp(Math.round((clamp(pct, 0, 100) / 100) * max), 0, max);
}

module.exports = { DEFAULT_CAL, luxToBrightness, stepToward, scaleToHardware };
