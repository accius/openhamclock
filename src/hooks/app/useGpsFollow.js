/**
 * useGpsFollow — Settings → Station → "Follow GPS".
 *
 *   off     GPS is ignored for the station location
 *   once    the first good fix after start-up sets DE lat/lon + grid, then stop
 *   follow  rover mode: DE location tracks the receiver continuously (saved
 *           at most every 5 s and only after moving ≥ 25 m or changing grid)
 *
 * Also detects 6-character grid changes while following and exposes them as
 * an event-shaped alert feed (`grid-change`) for useAudioAlerts, so the
 * operator gets a tone + browser notification when entering a new grid.
 *
 * @returns {{ gps, fix, hasFix, stale, timeOffsetMs, clockWarning,
 *             following: boolean, liveGrid: string|null, gridChanges: Array }}
 */
import { useEffect, useRef, useState } from 'react';
import { useGps } from '../useGps.js';
import { calculateDistance } from '../../utils/geo.js';

const SAVE_THROTTLE_MS = 5000;
const MOVE_THRESHOLD_KM = 0.025;
const MAX_GRID_CHANGES = 20;

export default function useGpsFollow(config, saveConfig) {
  const gpsState = useGps();
  const { fix } = gpsState;
  const mode = config?.gpsFollow || 'off';
  const following = mode === 'follow';

  const configRef = useRef(config);
  configRef.current = config;
  const saveRef = useRef(saveConfig);
  saveRef.current = saveConfig;
  const appliedOnceRef = useRef(false);
  const lastSaveRef = useRef(0);
  const prevGridRef = useRef(null);
  const [gridChanges, setGridChanges] = useState([]);

  // Apply the fix to the station location
  useEffect(() => {
    if (!fix || mode === 'off') return;
    if (mode === 'once' && appliedOnceRef.current) return;
    const now = Date.now();
    if (mode === 'follow' && now - lastSaveRef.current < SAVE_THROTTLE_MS) return;
    const cfg = configRef.current || {};
    const loc = cfg.location || {};
    const movedKm =
      Number.isFinite(loc.lat) && Number.isFinite(loc.lon)
        ? calculateDistance(loc.lat, loc.lon, fix.lat, fix.lon)
        : Infinity;
    const gridChanged = fix.grid6 && fix.grid6 !== cfg.locator;
    if (movedKm < MOVE_THRESHOLD_KM && !gridChanged) {
      if (mode === 'once') appliedOnceRef.current = true;
      return;
    }
    lastSaveRef.current = now;
    if (mode === 'once') appliedOnceRef.current = true;
    const next = {
      ...cfg,
      location: {
        ...loc,
        lat: +fix.lat.toFixed(5),
        lon: +fix.lon.toFixed(5),
        ...(Number.isFinite(fix.alt) ? { stationAlt: Math.round(fix.alt) } : {}),
      },
      ...(fix.grid6 ? { locator: fix.grid6 } : {}),
    };
    if (typeof saveRef.current === 'function') saveRef.current(next);
  }, [fix, mode]);

  // Reset the "once" latch when the user switches modes
  useEffect(() => {
    appliedOnceRef.current = false;
  }, [mode]);

  // Grid-change detection (rover mode only)
  useEffect(() => {
    if (!following || !fix?.grid6) {
      if (!following) prevGridRef.current = null;
      return;
    }
    const prev = prevGridRef.current;
    if (prev && prev !== fix.grid6) {
      const change = { grid: fix.grid6, from: prev, at: Date.now() };
      setGridChanges((list) => [...list, change].slice(-MAX_GRID_CHANGES));
    }
    prevGridRef.current = fix.grid6;
  }, [following, fix?.grid6]);

  return {
    ...gpsState,
    following,
    liveGrid: following && fix?.grid6 ? fix.grid6 : null,
    gridChanges,
  };
}
