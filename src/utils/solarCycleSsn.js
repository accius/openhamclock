/**
 * Sunspot number for a month other than the current one — used when the
 * display time is shifted into another month, so P.533 runs with that
 * month's solar activity instead of today's.
 *
 * Source: the /api/solar-cycle payload (NOAA SWPC, see
 * server/routes/space-weather.js):
 *   observed:  [{ t: 'YYYY-MM', ssn, smoothed }]   (smoothed = 13-month smoothed SSN, null when not yet published)
 *   predicted: [{ t: 'YYYY-MM', min, max }]        (SWPC cycle-25 predicted smoothed-SSN range)
 *
 * Rule: the observed smoothed SSN for that month if NOAA has published it,
 * otherwise the midpoint of SWPC's predicted range for that month,
 * otherwise null (caller keeps its current SSN). P.533 is defined on the
 * smoothed sunspot number, so smoothed values are the right input here.
 *
 * Kept byte-for-byte in step with server/utils/solarCycleSsn.js (CommonJS
 * copy for the server); solarCycleSsn.test.js runs both on the same inputs.
 */

/** 'YYYY-MM' for a Date in UTC. */
export function ymOf(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The 'YYYY-MM' a bare month number (1-12) refers to, relative to `now`:
 * the occurrence nearest to now (time shift is limited to ±30 days, so
 * December asked in January means last December).
 */
export function ymForMonth(month, now = new Date()) {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  const y = now.getUTCFullYear();
  const cur = now.getUTCMonth() + 1;
  let year = y;
  if (m - cur > 6) year = y - 1;
  else if (cur - m > 6) year = y + 1;
  return `${year}-${String(m).padStart(2, '0')}`;
}

/** Smoothed SSN for 'YYYY-MM' from a solar-cycle payload, or null. */
export function ssnForMonth(cycle, ym) {
  if (!cycle || typeof ym !== 'string') return null;
  const obs = (cycle.observed || []).find((o) => o && o.t === ym);
  if (obs && Number.isFinite(obs.smoothed)) return Math.round(obs.smoothed);
  const pred = (cycle.predicted || []).find((p) => p && p.t === ym);
  if (pred && Number.isFinite(pred.min) && Number.isFinite(pred.max)) return Math.round((pred.min + pred.max) / 2);
  return null;
}
