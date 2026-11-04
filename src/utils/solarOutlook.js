/**
 * solarOutlook — turn the SWPC 27-day outlook (served by /api/swpc/outlook)
 * into per-contest verdicts for the Contests panel and the Solar Outlook
 * panel. Pure; the parser lives server-side in server/utils/swpcOutlook.js.
 *
 * Kp → geomagnetic category (NOAA convention, largest predicted Kp of the day):
 *   0–2 quiet · 3 unsettled · 4 active · 5+ storm (G1 and up)
 */

export const KP_CATEGORIES = {
  quiet: { label: 'Quiet', color: 'var(--accent-green)' },
  unsettled: { label: 'Unsettled', color: 'var(--accent-amber)' },
  active: { label: 'Active', color: '#f97316' },
  storm: { label: 'Storm', color: '#ef4444' },
};

export function kpCategory(kp) {
  const k = Number(kp);
  if (!Number.isFinite(k)) return null;
  if (k >= 5) return 'storm';
  if (k >= 4) return 'active';
  if (k >= 3) return 'unsettled';
  return 'quiet';
}

/** 'YYYY-MM-DD' of an ISO timestamp / Date / epoch, in UTC. */
export const utcDay = (when) => {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

/**
 * Outlook for a UTC date range (inclusive, by calendar day).
 * @param {Array<{date,sfi,ap,kp}>} days  outlook rows
 * @param {string|number|Date} start
 * @param {string|number|Date} [end]      defaults to start
 * @returns {null|{ days, maxKp, maxAp, minSfi, maxSfi, category }} null when
 *          no outlook day overlaps the range (outside the 27-day window)
 */
export function outlookForRange(days, start, end = start) {
  if (!Array.isArray(days) || !days.length) return null;
  const from = utcDay(start);
  const to = utcDay(end) || from;
  if (!from) return null;
  const hit = days.filter((d) => d && d.date >= from && d.date <= to);
  if (!hit.length) return null;
  const kps = hit.map((d) => d.kp).filter(Number.isFinite);
  const aps = hit.map((d) => d.ap).filter(Number.isFinite);
  const sfis = hit.map((d) => d.sfi).filter(Number.isFinite);
  const maxKp = kps.length ? Math.max(...kps) : null;
  return {
    days: hit,
    maxKp,
    maxAp: aps.length ? Math.max(...aps) : null,
    minSfi: sfis.length ? Math.min(...sfis) : null,
    maxSfi: sfis.length ? Math.max(...sfis) : null,
    category: kpCategory(maxKp),
  };
}

/** Short tooltip text for a contest pill. */
export function describeOutlook(range, issued) {
  if (!range) return '';
  const sfi =
    range.minSfi == null
      ? ''
      : range.minSfi === range.maxSfi
        ? `SFI ${range.minSfi}`
        : `SFI ${range.minSfi}–${range.maxSfi}`;
  const kp = range.maxKp == null ? '' : `max Kp ${range.maxKp} (${KP_CATEGORIES[range.category]?.label || ''})`;
  const when = issued ? `issued ${new Date(issued).toISOString().slice(0, 10)}` : '';
  return ['SWPC 27-day outlook:', kp, sfi, when].filter(Boolean).join(' · ').replace(': ·', ':');
}

export default { KP_CATEGORIES, kpCategory, utcDay, outlookForRange, describeOutlook };
