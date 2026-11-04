/**
 * graylinePlanner — when are DE and DX both on the gray line?
 *
 * Gray-line (twilight) enhancement happens around local sunrise and sunset
 * at each end. A station's "gray-line window" is sunrise ± margin and
 * sunset ± margin; a mutual window is where a DE window overlaps a DX
 * window. Everything here is pure: times are ms since epoch, locations are
 * { lat, lon }. Sunrise/sunset come from utils/geo.js (NOAA algorithm).
 */
import { calculateSunTimes } from './geo.js';

export const DAY_MS = 86_400_000;
export const DEFAULT_MARGIN_MIN = 30;
export const DEFAULT_DAYS = 7;

const hasPos = (loc) => loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon);

const hhmmToMs = (dayStartMs, hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  return dayStartMs + (Number(m[1]) * 60 + Number(m[2])) * 60_000;
};

/** UTC midnight (ms) of the day containing `ms`. */
export const utcDayStart = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * Sunrise/sunset instants for one station over [startMs − 1 day, startMs + days + 1 day],
 * each tagged 'sunrise' | 'sunset'. calculateSunTimes folds times past
 * midnight back into the same UTC day, so the scan runs a day either side
 * and de-duplicates events closer than 10 minutes — every real crossing in
 * range is produced exactly once. Polar day/night produce no events.
 * @returns {Array<{t:number, kind:'sunrise'|'sunset'}>} sorted by t
 */
export function sunEvents(lat, lon, startMs, days = DEFAULT_DAYS) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const first = utcDayStart(startMs) - DAY_MS;
  const last = utcDayStart(startMs) + (days + 1) * DAY_MS;
  const events = [];
  for (let day = first; day <= last; day += DAY_MS) {
    const times = calculateSunTimes(lat, lon, new Date(day + 12 * 3_600_000));
    if (!times || times.sunset === '') continue; // polar day/night
    const rise = hhmmToMs(day, times.sunrise);
    const set = hhmmToMs(day, times.sunset);
    if (rise != null) events.push({ t: rise, kind: 'sunrise' });
    if (set != null) events.push({ t: set, kind: 'sunset' });
  }
  events.sort((a, b) => a.t - b.t);
  const out = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === e.kind && Math.abs(prev.t - e.t) < 10 * 60_000) continue;
    out.push(e);
  }
  return out;
}

/**
 * A station's gray-line windows (event ± margin) clipped to [startMs, endMs].
 * @returns {Array<{start:number,end:number,kind:'sunrise'|'sunset'}>}
 */
export function stationGraylineWindows(loc, startMs, { days = DEFAULT_DAYS, marginMin = DEFAULT_MARGIN_MIN } = {}) {
  if (!hasPos(loc)) return [];
  const endMs = startMs + days * DAY_MS;
  const margin = Math.max(1, Number(marginMin) || DEFAULT_MARGIN_MIN) * 60_000;
  return sunEvents(loc.lat, loc.lon, startMs, days)
    .map((e) => ({ start: e.t - margin, end: e.t + margin, kind: e.kind, at: e.t }))
    .filter((w) => w.end > startMs && w.start < endMs)
    .map((w) => ({ ...w, start: Math.max(w.start, startMs), end: Math.min(w.end, endMs) }));
}

/** Pairwise overlap of two sorted window lists. */
export function intersectWindows(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end, aKind: a[i].kind, bKind: b[j].kind });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

/**
 * Full plan for the panel.
 * @returns {{ de: Array, dx: Array, mutual: Array<{start,end,deKind,dxKind,durationMin}>, startMs, endMs, days, marginMin }}
 */
export function computeGraylinePlan(de, dx, startMs = Date.now(), opts = {}) {
  const days = opts.days ?? DEFAULT_DAYS;
  const marginMin = opts.marginMin ?? DEFAULT_MARGIN_MIN;
  const deWin = stationGraylineWindows(de, startMs, { days, marginMin });
  const dxWin = stationGraylineWindows(dx, startMs, { days, marginMin });
  const mutual = intersectWindows(deWin, dxWin).map((w) => ({
    start: w.start,
    end: w.end,
    deKind: w.aKind,
    dxKind: w.bKind,
    durationMin: Math.round((w.end - w.start) / 60_000),
  }));
  return { de: deWin, dx: dxWin, mutual, startMs, endMs: startMs + days * DAY_MS, days, marginMin };
}

/** The first mutual window still open or ahead of `nowMs` (null if none). */
export function nextMutualWindow(mutual, nowMs) {
  for (const w of mutual || []) {
    if (w.end > nowMs) return { ...w, open: w.start <= nowMs };
  }
  return null;
}

/** 'Xh YYm' / 'Ym' / 'Xd Yh' for a countdown. */
export function formatSpan(ms) {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}
