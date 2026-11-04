/**
 * heatmapTime — which moment and which solar values the propagation heatmap
 * (/api/propagation/heatmap) is computed for.
 *
 * The client's Time Shift sends `at` (ISO time); without it the map is "now".
 * The model needs the UTC hour (day/night, local time at the path midpoint)
 * and the month (solar declination → D-layer absorption), both exactly
 * predictable. Solar flux and K are not: for a future date covered by NOAA's
 * 27-day outlook the forecast values are used, otherwise the live ones.
 *
 * Pure — the route supplies "now", the live values and the outlook.
 */

/** How far `at` may be from now; matches Time Shift's ±30 days (+1 slack). */
const MAX_SHIFT_MS = 31 * 24 * 60 * 60 * 1000;

const dateKeyOf = (d) => d.toISOString().slice(0, 10);

/**
 * @param {string|undefined} at  ISO time from the query string
 * @param {number} nowMs
 * @returns {{ hour: number, month: number, dateKey: string, shifted: boolean }}
 */
function resolveHeatmapTime(at, nowMs = Date.now()) {
  const now = new Date(nowMs);
  let t = now;
  let shifted = false;
  if (typeof at === 'string' && at) {
    const ms = Date.parse(at);
    if (Number.isFinite(ms) && Math.abs(ms - nowMs) <= MAX_SHIFT_MS) {
      t = new Date(ms);
      shifted = true;
    }
  }
  return { hour: t.getUTCHours(), month: t.getUTCMonth() + 1, dateKey: dateKeyOf(t), shifted };
}

/** Sunspot number from 10.7 cm flux — the same approximation getSolarData uses. */
const ssnFromSfi = (sfi) => Math.max(0, Math.round((sfi - 67) / 0.97));

/**
 * Solar values for the map's date: the outlook's forecast SFI and Kp for a
 * future day it covers, else the live values.
 * @param {{ sfi: number, ssn: number, kIndex: number }} live
 * @param {{ days?: Array<{ date: string, sfi: number, kp: number }> } | null} outlook
 * @param {string} dateKey  'YYYY-MM-DD' of the map's time
 * @param {string} todayKey 'YYYY-MM-DD' of now
 * @returns {{ sfi: number, ssn: number, kIndex: number, source: 'live'|'forecast' }}
 */
function solarForDate(live, outlook, dateKey, todayKey) {
  if (dateKey > todayKey && Array.isArray(outlook?.days)) {
    const day = outlook.days.find((d) => d?.date === dateKey);
    if (day && Number.isFinite(day.sfi) && Number.isFinite(day.kp)) {
      return { sfi: day.sfi, ssn: ssnFromSfi(day.sfi), kIndex: day.kp, source: 'forecast' };
    }
  }
  return { sfi: live.sfi, ssn: live.ssn, kIndex: live.kIndex, source: 'live' };
}

module.exports = { resolveHeatmapTime, solarForDate, ssnFromSfi, MAX_SHIFT_MS, dateKeyOf };
