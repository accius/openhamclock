/**
 * alarmClock — a daily alarm and a once-only alarm for the shack clock.
 *
 * Pure scheduling helpers (exported, tested) plus a tiny store that keeps
 * the alarm settings in config (`config.alarm`, persisted through
 * saveConfig so it survives reloads and rides the settings sync). Alarms
 * fire on REAL wall-clock time — the display-time shift never moves them.
 *
 * Shape (config.alarm):
 *   {
 *     daily: { time: 'HH:MM', utc: false, armed: false },
 *     once:  { time: 'HH:MM', utc: true,  armed: false, at: null, label: '' },
 *   }
 * `once.at` is an absolute ISO instant; when set it wins over `once.time`
 * (that is how "set alarm for contest start" works). When only `time` is
 * given, the once-alarm rings at the next occurrence of that wall-clock time
 * and then disarms itself.
 *
 * Remote control: window event `ohc:set-alarm` with detail
 *   { kind: 'daily'|'once', time?: 'HH:MM', utc?: bool, armed?: bool, at?: ISO, label?: string }
 */
import { loadConfig, saveConfig } from './config.js';

export const ALARM_CHANGED_EVENT = 'ohc:alarm-changed';
export const SET_ALARM_EVENT = 'ohc:set-alarm';
export const ALARM_KINDS = ['daily', 'once'];

export const DEFAULT_ALARM = Object.freeze({
  daily: Object.freeze({ time: '07:00', utc: false, armed: false }),
  once: Object.freeze({ time: '', utc: true, armed: false, at: null, label: '' }),
});

const DAY_MS = 86_400_000;

/** 'HH:MM' (24 h) → { h, m } or null. Accepts 'H:MM' and 'HHMM' too. */
export function parseHHMM(str) {
  if (str == null) return null;
  const s = String(str).trim();
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) m = /^(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h > 23 || mi > 59) return null;
  return { h, m: mi };
}

export function formatHHMM(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Is `tz` a zone Intl accepts? ('' / null / 'auto' → false → browser zone). */
function validZone(tz) {
  if (!tz || tz === 'auto') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `ms` in the given zone (or the browser's zone). */
export function wallClock(ms, tz) {
  const opts = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false };
  if (validZone(tz)) opts.timeZone = tz;
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const hour = get('hour') % 24; // "24" at midnight in some engines
  return { y: get('year'), mo: get('month'), d: get('day'), h: hour, mi: get('minute') };
}

/**
 * UTC instant (ms) for a wall-clock time in `tz`. Two-pass offset
 * correction handles DST (good to the minute, which is all an alarm needs).
 */
export function zonedToMs({ y, mo, d, h, mi }, tz) {
  if (!validZone(tz)) {
    // Browser-local zone (also the fallback for an invalid zone string)
    return new Date(y, mo - 1, d, h, mi).getTime();
  }
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(ms, tz);
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
    ms += guess - asUtc;
  }
  return ms;
}

/**
 * Next time (ms) strictly after `nowMs` at which the wall clock reads
 * `time` ('HH:MM'). `utc` → UTC wall clock; otherwise `tz` (or browser zone).
 * Returns null for an unparseable time.
 */
export function nextOccurrence(time, { utc = false, tz = '', nowMs = Date.now() } = {}) {
  const hm = parseHHMM(time);
  if (!hm) return null;
  if (utc) {
    const d = new Date(nowMs);
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hm.h, hm.m);
    if (t <= nowMs) t += DAY_MS;
    return t;
  }
  const w = wallClock(nowMs, tz);
  let t = zonedToMs({ y: w.y, mo: w.mo, d: w.d, h: hm.h, mi: hm.m }, tz);
  if (t <= nowMs) {
    // Tomorrow, same wall-clock time (recomputed through the zone so a DST
    // change overnight still lands on the right wall-clock minute).
    const tomorrow = wallClock(nowMs + DAY_MS, tz);
    t = zonedToMs({ y: tomorrow.y, mo: tomorrow.mo, d: tomorrow.d, h: hm.h, mi: hm.m }, tz);
    if (t <= nowMs) t += DAY_MS;
  }
  return t;
}

/** Deep-merge raw config.alarm over the defaults; never throws. */
export function normalizeAlarmState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const daily = { ...DEFAULT_ALARM.daily, ...(r.daily || {}) };
  const once = { ...DEFAULT_ALARM.once, ...(r.once || {}) };
  daily.armed = !!daily.armed && !!parseHHMM(daily.time);
  daily.utc = !!daily.utc;
  once.utc = !!once.utc;
  const atMs = once.at ? Date.parse(once.at) : NaN;
  once.at = Number.isFinite(atMs) ? new Date(atMs).toISOString() : null;
  once.armed = !!once.armed && (!!once.at || !!parseHHMM(once.time));
  once.label = typeof once.label === 'string' ? once.label.slice(0, 80) : '';
  return { daily, once };
}

/**
 * When does each armed alarm next ring?
 * @returns {{ daily: number|null, once: number|null, next: {kind, at}|null }}
 */
export function nextAlarmTimes(state, { tz = '', nowMs = Date.now() } = {}) {
  const s = normalizeAlarmState(state);
  const daily = s.daily.armed ? nextOccurrence(s.daily.time, { utc: s.daily.utc, tz, nowMs }) : null;
  let once = null;
  if (s.once.armed) {
    once = s.once.at ? Date.parse(s.once.at) : nextOccurrence(s.once.time, { utc: s.once.utc, tz, nowMs });
  }
  let next = null;
  for (const [kind, at] of [
    ['daily', daily],
    ['once', once],
  ]) {
    if (at != null && Number.isFinite(at) && (!next || at < next.at)) next = { kind, at };
  }
  return { daily, once, next };
}

/**
 * Which armed alarms fall inside (prevMs, nowMs]? The scheduler calls this
 * once a second with the previous tick's timestamp, so a tab that slept
 * through the minute still rings (once) on waking — unless more than
 * `maxLateMs` has passed, in which case the alarm is considered missed.
 * Pure: evaluates the armed times against the interval.
 */
export function dueAlarms(state, prevMs, nowMs, { tz = '', maxLateMs = 10 * 60_000 } = {}) {
  const s = normalizeAlarmState(state);
  const due = [];
  if (!(nowMs > prevMs)) return due;
  const windowStart = Math.max(prevMs, nowMs - maxLateMs);
  const check = (kind, at) => {
    if (at == null || !Number.isFinite(at)) return;
    if (at > windowStart && at <= nowMs) due.push(kind);
  };
  if (s.daily.armed) {
    // The occurrence that was "next" as of windowStart is the one that may have fired.
    check('daily', nextOccurrence(s.daily.time, { utc: s.daily.utc, tz, nowMs: windowStart }));
  }
  if (s.once.armed) {
    const at = s.once.at
      ? Date.parse(s.once.at)
      : nextOccurrence(s.once.time, { utc: s.once.utc, tz, nowMs: windowStart });
    check('once', at);
  }
  return due;
}

/**
 * Apply an `ohc:set-alarm` detail to the current state. Unknown kinds and
 * bad times are ignored (state returned unchanged). Pure.
 */
export function applySetAlarmDetail(state, detail) {
  const s = normalizeAlarmState(state);
  if (!detail || typeof detail !== 'object') return s;
  const kind = detail.kind === 'once' ? 'once' : detail.kind === 'daily' ? 'daily' : null;
  if (!kind) return s;
  const cur = { ...s[kind] };
  if (detail.time != null) {
    const hm = parseHHMM(detail.time);
    if (!hm) return s;
    cur.time = formatHHMM(hm.h, hm.m);
    if (kind === 'once') cur.at = null; // a wall-clock time replaces an absolute instant
  }
  if (detail.utc != null) cur.utc = !!detail.utc;
  if (kind === 'once' && detail.at != null) {
    const ms = detail.at instanceof Date ? detail.at.getTime() : Date.parse(String(detail.at));
    if (!Number.isFinite(ms)) return s;
    cur.at = new Date(ms).toISOString();
    cur.time = formatHHMM(new Date(ms).getUTCHours(), new Date(ms).getUTCMinutes());
    cur.utc = true;
  }
  if (kind === 'once' && detail.label != null) cur.label = String(detail.label).slice(0, 80);
  if (detail.armed != null) cur.armed = !!detail.armed;
  else if (detail.time != null || detail.at != null) cur.armed = true; // setting a time arms it
  return normalizeAlarmState({ ...s, [kind]: cur });
}

/** Once-alarm convenience: arm at an absolute instant (contest start, pass AOS…). */
export function onceAlarmAt(state, instant, label = '') {
  return applySetAlarmDetail(state, { kind: 'once', at: instant, armed: true, label });
}

/** 'in 2h 05m' style countdown to an alarm. */
export function formatCountdown(ms) {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

// ───────────────────────── store (config.alarm) ─────────────────────────

const listeners = new Set();
let ringing = null; // { kind, at } while an alarm is sounding

export function getAlarmState() {
  try {
    return normalizeAlarmState(loadConfig()?.alarm);
  } catch {
    return normalizeAlarmState(null);
  }
}

function notify() {
  const snap = { alarm: getAlarmState(), ringing };
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* keep going */
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(ALARM_CHANGED_EVENT, { detail: snap }));
  } catch {
    /* no window */
  }
}

/** Persist a new alarm state into config and notify subscribers. */
export function saveAlarmState(next) {
  const normalized = normalizeAlarmState(next);
  try {
    const cfg = loadConfig();
    saveConfig({ ...cfg, alarm: normalized });
  } catch {
    /* storage unavailable — still notify so the UI reflects the choice this session */
  }
  notify();
  return normalized;
}

export function updateAlarm(kind, patch) {
  const s = getAlarmState();
  if (!ALARM_KINDS.includes(kind)) return s;
  return saveAlarmState({ ...s, [kind]: { ...s[kind], ...patch } });
}

export function getRinging() {
  return ringing;
}

/** Scheduler → store: an alarm started/stopped sounding. */
export function setRinging(value) {
  ringing = value || null;
  notify();
}

export function subscribeAlarm(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Install the `ohc:set-alarm` window listener; returns a disposer. */
export function installSetAlarmListener(target = typeof window !== 'undefined' ? window : null) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const handler = (e) => {
    const next = applySetAlarmDetail(getAlarmState(), e?.detail);
    saveAlarmState(next);
  };
  target.addEventListener(SET_ALARM_EVENT, handler);
  return () => target.removeEventListener(SET_ALARM_EVENT, handler);
}
