/**
 * useGps — current GPS fix from the Rig Bridge `gps` plugin.
 *
 * Fix shape (see rig-bridge/plugins/gps.js): { fix, lat, lon, alt (m),
 * speed (km/h), course (°), time (ISO, receiver UTC), sats, hdop, grid6,
 * timeOffsetMs (GPS clock − this computer's clock), source, receivedAt }.
 *
 * @returns {{
 *   gps: object|null,      last payload, fix or not
 *   fix: object|null,      the payload only when it is a live, valid fix
 *   hasFix: boolean,
 *   stale: boolean,        nothing from the bridge for 20 s
 *   timeOffsetMs: number|null,
 *   clockWarning: boolean  |offset| > 2 s (warning only — nothing is changed)
 * }}
 */
import { useBridgeEvent } from './useBridgeEvent.js';

export const GPS_STALE_MS = 20000;
export const CLOCK_WARN_MS = 2000;

export function useGps() {
  const { data, stale, at } = useBridgeEvent('gps', { staleMs: GPS_STALE_MS });
  const fix = data && data.fix && !stale && Number.isFinite(data.lat) && Number.isFinite(data.lon) ? data : null;
  const timeOffsetMs = data && Number.isFinite(data.timeOffsetMs) ? data.timeOffsetMs : null;
  return {
    gps: data,
    fix,
    hasFix: !!fix,
    stale,
    at,
    timeOffsetMs,
    clockWarning: timeOffsetMs != null && Math.abs(timeOffsetMs) > CLOCK_WARN_MS,
  };
}

export default useGps;
