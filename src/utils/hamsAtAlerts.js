/**
 * hams.at pass alerts — normalisation and co-visibility, kept pure so the
 * panel, the audio-alert feed and the tests share one reading of the data.
 *
 * Upstream shape (GET https://hams.at/api/alerts/upcoming):
 *   { data: [{ id, callsign, comment, mode, mhz, mhz_direction, grids: [],
 *              aos_at, los_at, max_elevation, is_workable,
 *              workable_start_at, workable_end_at, url,
 *              satellite: { name, number } }] }
 */

export const SAT_ALERT_LEAD_MS = 15 * 60 * 1000;

const parseMs = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
};

const numOrNull = (v) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : null;
};

/** Canonical satellite name for matching: "AO-07" → "AO7", "ISS (ZARYA)" → "ISSZARYA". */
export function canonicalSatName(name) {
  const s = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  // Strip leading zeros in trailing numeric runs (AO-07 vs AO-7)
  return s.replace(/([A-Z])0+(\d)/g, '$1$2');
}

/** Normalise the upstream payload (object with `data`, or a bare array). */
export function normalizeHamsAtAlerts(json) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const aosMs = parseMs(r.aos_at ?? r.aos);
    const losMs = parseMs(r.los_at ?? r.los);
    if (aosMs == null) continue;
    const satName = String(r.satellite?.name ?? r.satellite_name ?? r.satellite ?? '').trim();
    out.push({
      id: String(r.id ?? `${satName}-${aosMs}`),
      satName,
      norad: numOrNull(r.satellite?.number ?? r.satellite?.norad_id ?? r.norad),
      callsign: String(r.callsign ?? '')
        .trim()
        .toUpperCase(),
      comment: String(r.comment ?? '').trim(),
      mode: String(r.mode ?? '').trim(),
      mhz: numOrNull(r.mhz),
      mhzDirection: String(r.mhz_direction ?? '').trim(),
      grids: (Array.isArray(r.grids) ? r.grids : []).map((g) => String(g).toUpperCase()).filter(Boolean),
      aosMs,
      losMs,
      maxElevation: numOrNull(r.max_elevation),
      isWorkable: r.is_workable === true,
      workableStartMs: parseMs(r.workable_start_at),
      workableEndMs: parseMs(r.workable_end_at),
      likes: numOrNull(r.likes) ?? 0,
      url: typeof r.url === 'string' ? r.url : '',
    });
  }
  return out.sort((a, b) => a.aosMs - b.aosMs);
}

/** Stable key for de-duplication / audio-alert baselines. */
export const alertKey = (a) => (a ? String(a.id || `${a.satName}-${a.aosMs}`) : '');

/** Does this alert refer to this tracked satellite (by NORAD, then name)? */
export function alertMatchesSatellite(alert, sat) {
  if (!alert || !sat) return false;
  if (alert.norad != null && sat.norad != null && Number(alert.norad) === Number(sat.norad)) return true;
  const a = canonicalSatName(alert.satName);
  const b = canonicalSatName(sat.name);
  if (!a || !b) return false;
  if (a === b) return true;
  // "ISS" vs "ISSZARYA": a prefix match is only a match when the remainder
  // starts with a letter — "AO7" must never match "AO73".
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.startsWith(short) && /[A-Z]/.test(long[short.length]);
}

/** Overlap in ms of two [start, end] windows (0 when disjoint or unknown). */
export function overlapMs(aStart, aEnd, bStart, bEnd) {
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return 0;
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Co-visibility with the DE station: the local pass of the same satellite
 * that overlaps the alerted window, if any.
 * @param {object} alert normalised alert
 * @param {Array<{start:number,end:number,maxElevation?:number}>} localPasses passes of that satellite over DE
 * @returns {null|{start:number,end:number,overlapMs:number,maxElevation:number|null}}
 */
export function findCoVisibility(alert, localPasses) {
  if (!alert || !Array.isArray(localPasses)) return null;
  const aEnd = alert.losMs ?? alert.aosMs + 20 * 60 * 1000;
  let best = null;
  for (const p of localPasses) {
    const ov = overlapMs(alert.aosMs, aEnd, p?.start, p?.end);
    if (ov > 0 && (!best || ov > best.overlapMs)) {
      best = { start: p.start, end: p.end, overlapMs: ov, maxElevation: numOrNull(p.maxElevation) };
    }
  }
  return best;
}

/**
 * Attach co-visibility to every alert using the tracked satellites' local
 * pass windows (the parallel arrays useSatellites emits).
 */
export function annotateCoVisibility(alerts, satellites) {
  const sats = Array.isArray(satellites) ? satellites : [];
  return (alerts || []).map((alert) => {
    const sat = sats.find((s) => alertMatchesSatellite(alert, s));
    if (!sat) return { ...alert, tracked: false, coVisible: null };
    const starts = sat.nextPassStartTimes || [];
    const ends = sat.nextPassEndTimes || [];
    const maxEls = sat.nextPassMaxElevations || [];
    const passes = starts.map((s, i) => ({
      start: parseMs(s),
      end: parseMs(ends[i]),
      maxElevation: maxEls[i] ?? null,
    }));
    return { ...alert, tracked: true, coVisible: findCoVisibility(alert, passes) };
  });
}

/**
 * Items for the `sat-alerts` audio feed: alerted passes whose AOS is within
 * `leadMs` from now (and not yet over).
 */
export function upcomingAlertFeedItems(alerts, now = Date.now(), leadMs = SAT_ALERT_LEAD_MS) {
  return (alerts || [])
    .filter((a) => a.aosMs - now <= leadMs && (a.losMs ?? a.aosMs) >= now)
    .map((a) => ({
      id: alertKey(a),
      name: a.satName,
      callsign: a.callsign,
      aos: a.aosMs,
      grids: a.grids,
      maxElevation: a.maxElevation,
      coVisible: !!a.coVisible,
    }));
}

export default {
  normalizeHamsAtAlerts,
  alertKey,
  alertMatchesSatellite,
  overlapMs,
  findCoVisibility,
  annotateCoVisibility,
  upcomingAlertFeedItems,
};
