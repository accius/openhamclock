/**
 * Element-set age helpers. An OMM's EPOCH is the moment the elements were
 * valid; predictions degrade as that recedes, so Settings → Satellites lets
 * the operator pick how old is too old.
 */

export const DEFAULT_MAX_TLE_AGE_DAYS = 7;
export const MIN_MAX_TLE_AGE_DAYS = 1;
export const MAX_MAX_TLE_AGE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch of an OMM as epoch-ms, treating a zone-less timestamp as UTC. */
export function tleEpochMs(omm) {
  const raw = omm?.EPOCH;
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Age of the element set in days (fractional), or null when unknown. */
export function tleAgeDays(omm, now = Date.now()) {
  const epoch = tleEpochMs(omm);
  if (epoch == null) return null;
  return (now - epoch) / DAY_MS;
}

export function clampMaxTleAge(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_TLE_AGE_DAYS;
  return Math.min(MAX_MAX_TLE_AGE_DAYS, Math.max(MIN_MAX_TLE_AGE_DAYS, n));
}

/** True when the elements are older than the allowed age (unknown epoch counts as stale). */
export function isTleStale(omm, maxDays = DEFAULT_MAX_TLE_AGE_DAYS, now = Date.now()) {
  const age = tleAgeDays(omm, now);
  if (age == null) return true;
  return age > clampMaxTleAge(maxDays);
}

/** "3.2d" / "14h" style label for the UI. */
export function formatTleAge(days) {
  if (!Number.isFinite(days)) return '?';
  if (days < 0) return '0h';
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

export default { tleEpochMs, tleAgeDays, clampMaxTleAge, isTleStale, formatTleAge };
