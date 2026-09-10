/**
 * aprsStationAge — one place to turn an APRS station record into a
 * human-readable "heard N minutes ago".
 *
 * Stations reach the UI from two sources with different shapes:
 *  - /api/aprs/stations (APRS-IS + server-side TNC cache) carries both a
 *    packet `timestamp` and a precomputed `age` (minutes, frozen at fetch time)
 *  - the rig-bridge SSE stream (direct local TNC) carries only `timestamp`
 *
 * Deriving from `timestamp` whenever it is present keeps the value live
 * between polls and works for both shapes; `age` is the fallback (#1180).
 */

/**
 * Minutes since the station was last heard, or null when unknown.
 * @param {object} station
 * @param {number} [now] epoch ms (injectable for tests)
 */
export function stationAgeMinutes(station, now = Date.now()) {
  if (!station) return null;
  const ts = Number(station.timestamp);
  if (Number.isFinite(ts) && ts > 0) return Math.max(0, Math.floor((now - ts) / 60000));
  const age = Number(station.age);
  if (Number.isFinite(age)) return Math.max(0, Math.floor(age));
  return null;
}

/**
 * Format an age in minutes: "now" / "12m" / "3h". Unknown → "?".
 * @param {number|null} minutes
 * @param {{ suffix?: string }} [opts] suffix appended to the m/h forms only
 *   (e.g. ' ago' → "12m ago"; "now" never takes the suffix)
 */
export function formatStationAge(minutes, { suffix = '' } = {}) {
  if (minutes == null || !Number.isFinite(minutes)) return '?';
  if (minutes < 1) return 'now';
  const base = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
  return `${base}${suffix}`;
}
