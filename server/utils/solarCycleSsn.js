/**
 * Server (CommonJS) copy of src/utils/solarCycleSsn.js — sunspot number for
 * a month other than the current one, from the /api/solar-cycle payload
 * (NOAA SWPC observed smoothed SSN, else the midpoint of the cycle-25
 * predicted range). Keep the two in step; src/utils/solarCycleSsn.test.js
 * runs both on the same inputs.
 */

function ymOf(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ymForMonth(month, now = new Date()) {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  const y = now.getUTCFullYear();
  const cur = now.getUTCMonth() + 1;
  let year = y;
  if (m - cur > 6) year = y - 1;
  else if (cur - m > 6) year = y + 1;
  return `${year}-${String(m).padStart(2, '0')}`;
}

function ssnForMonth(cycle, ym) {
  if (!cycle || typeof ym !== 'string') return null;
  const obs = (cycle.observed || []).find((o) => o && o.t === ym);
  if (obs && Number.isFinite(obs.smoothed)) return Math.round(obs.smoothed);
  const pred = (cycle.predicted || []).find((p) => p && p.t === ym);
  if (pred && Number.isFinite(pred.min) && Number.isFinite(pred.max)) return Math.round((pred.min + pred.max) / 2);
  return null;
}

/**
 * SSN for /api/propagation: when the requested month is not the current
 * one, the smoothed SSN for that month from the solar-cycle feed;
 * otherwise (or when the feed has nothing) the current SSN unchanged.
 * Never throws — a failed feed just keeps the current SSN.
 * @returns {Promise<{ssn:number, source:'current'|'solar-cycle'}>}
 */
async function resolveMonthSsn({ month, realMonth, currentSsn, getSolarCycle, now = new Date() }) {
  if (month === realMonth || typeof getSolarCycle !== 'function') return { ssn: currentSsn, source: 'current' };
  try {
    const s = ssnForMonth(await getSolarCycle(), ymForMonth(month, now));
    if (Number.isFinite(s)) return { ssn: s, source: 'solar-cycle' };
  } catch {
    /* keep the current SSN */
  }
  return { ssn: currentSsn, source: 'current' };
}

module.exports = { ymOf, ymForMonth, ssnForMonth, resolveMonthSsn };
