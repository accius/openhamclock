/**
 * Optional `month` query parameter for /api/propagation (1–12).
 *
 * Lets a client ask for another month's model — the browser's time-shift
 * ("display time") can move the dashboard up to ±30 days, which crosses a
 * month boundary. Strictly bounded: only an integer 1–12 is honoured;
 * anything else (missing, "13", "1.5", "jan", arrays) falls back to the
 * server's current month. The month is already part of the hourly
 * ITURHFProp cache key, so each month is cached like the current one and
 * at most 12 variants can exist per path.
 */
function parseMonthParam(value, fallbackMonth) {
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value.trim())) return fallbackMonth;
  const m = Number(value.trim());
  return m >= 1 && m <= 12 ? m : fallbackMonth;
}

module.exports = { parseMonthParam };
