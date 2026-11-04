/**
 * Bearing display helper — true vs magnetic north (Settings → Station).
 *
 * Every place that shows a bearing from the station (DX panel SP/LP, map
 * tooltips, spot popups, rotator readout, repeater/aircraft/IBP lists…)
 * formats it through formatBearing(). In "magnetic" mode the true bearing
 * is corrected by the WMM2025 declination at the *origin* of the bearing
 * (your QTH) and suffixed with "M", the way HamClock labels it.
 *
 * The mode lives in the main config object (config.bearings) so it syncs
 * and profiles with everything else; getBearingMode() reads it straight
 * from localStorage so pure helpers and non-React code can use it too.
 */
import { useEffect, useState } from 'react';
import { declination } from './wmm.js';

export const BEARING_MODES = ['true', 'magnetic'];
export const BEARING_MODE_EVENT = 'openhamclock-config-change';

// Parse the stored config only when its string changes — list views call
// formatBearing per row, and the config blob is a few KB.
let lastRaw = null;
let lastMode = 'true';

/** Current mode: 'true' (default) or 'magnetic'. */
export function getBearingMode() {
  try {
    const raw = localStorage.getItem('openhamclock_config');
    if (raw === lastRaw) return lastMode;
    lastRaw = raw;
    lastMode = 'true';
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg?.bearings === 'magnetic') lastMode = 'magnetic';
    }
  } catch {
    lastMode = 'true';
  }
  return lastMode;
}

// Declination is smooth over tens of km and drifts ~0.1°/yr; cache per
// 0.1° cell per UTC day so list views don't re-run the harmonic sum per row.
const declCache = new Map();
const DECL_CACHE_MAX = 500;

/** Declination (°E) at a point, memoised. Null when coordinates are unusable. */
export function cachedDeclination(lat, lon, date = new Date()) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const day = Math.floor(date.getTime() / 86400000);
  const key = `${lat.toFixed(1)},${lon.toFixed(1)},${day}`;
  if (declCache.has(key)) return declCache.get(key);
  const d = declination(lat, lon, 0, date);
  if (declCache.size >= DECL_CACHE_MAX) declCache.clear();
  declCache.set(key, d);
  return d;
}

/**
 * Convert a true bearing for display.
 * @returns {{ deg: number, magnetic: boolean, suffix: string }|null}
 *   deg is rounded 0–359; suffix is 'M' in magnetic mode, '' otherwise.
 */
export function displayBearing(trueDeg, lat, lon, mode = getBearingMode(), date = new Date()) {
  if (!Number.isFinite(trueDeg)) return null;
  let deg = trueDeg;
  let magnetic = false;
  if (mode === 'magnetic') {
    const d = cachedDeclination(lat, lon, date);
    if (d != null) {
      deg = trueDeg - d;
      magnetic = true;
    }
  }
  deg = Math.round(((deg % 360) + 360) % 360) % 360;
  return { deg, magnetic, suffix: magnetic ? 'M' : '' };
}

/** "123°" or "116°M" — null for non-finite input. */
export function formatBearing(trueDeg, lat, lon, mode = getBearingMode(), date = new Date()) {
  const b = displayBearing(trueDeg, lat, lon, mode, date);
  return b ? `${b.deg}°${b.suffix}` : null;
}

/** React hook: current bearing mode, re-rendering when Settings saves. */
export function useBearingMode() {
  const [mode, setMode] = useState(getBearingMode);
  useEffect(() => {
    const onChange = () => setMode(getBearingMode());
    window.addEventListener(BEARING_MODE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(BEARING_MODE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return mode;
}
