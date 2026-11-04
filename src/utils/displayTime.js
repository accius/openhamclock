/**
 * displayTime — the app-wide "display time" offset (HamClock-style time shift).
 *
 * The dashboard normally shows the present; shifting the display time lets
 * the operator look at the terminator, gray line, sun/moon, satellites and
 * the VOACAP hour at any moment within ±30 days. Live spot feeds are never
 * shifted — only astronomy and anything derived from "now" for display.
 *
 * One module-level store (session only, never persisted): React code reads
 * it through useTimeState / useDisplayTime, non-React code (Leaflet layers,
 * the globe) calls displayNow() and subscribes to changes. A window event
 * `ohc:set-time` lets a remote-control API drive it:
 *
 *   window.dispatchEvent(new CustomEvent('ohc:set-time', { detail: { offsetMs: 3600000 } }))
 *   window.dispatchEvent(new CustomEvent('ohc:set-time', { detail: { iso: '2026-12-21T12:00:00Z' } }))
 *   window.dispatchEvent(new CustomEvent('ohc:set-time', { detail: 'now' }))
 *
 * Playback runs the display time forward on its own (startPlayback) at a
 * preset speed. Any explicit set (slider, nudge, Now, a planner's "jump to",
 * the set-time event) stops it. Expensive consumers (pass predictions, …)
 * subscribe with subscribeDisplayTimeSettled so they recompute once playback
 * pauses instead of several times a second.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;
/** Slider / clamp range: ±30 days. */
export const MAX_OFFSET_MS = 30 * DAY_MS;

/** Fired on window after every change; detail = { offsetMs }. */
export const DISPLAY_TIME_EVENT = 'ohc:display-time';
/** Listened for on window; detail = { offsetMs } | { iso } | 'now' | { now: true }. */
export const SET_TIME_EVENT = 'ohc:set-time';

/** Display seconds per real second: 6 s/s, 1 min/s, 10 min/s, 1 h/s. */
export const PLAYBACK_SPEEDS = [6, 60, 600, 3600];
export const DEFAULT_PLAYBACK_SPEED = 60;
/** Ticker period: 5 updates a second is smooth enough and keeps SGP4 load sane. */
export const PLAYBACK_TICK_MS = 200;

let offsetMs = 0;
let playing = false;
let playbackSpeed = DEFAULT_PLAYBACK_SPEED;
let playbackTimer = null;
let lastTickRealMs = 0;
const listeners = new Set();
const settledListeners = new Set();
const playbackListeners = new Set();

/** Clamp any offset to the supported ±30 day range; invalid input → 0. */
export function clampOffset(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, Math.round(n)));
}

export function getDisplayOffsetMs() {
  return offsetMs;
}

export function isTimeShifted() {
  return offsetMs !== 0;
}

/** Current display time in ms since epoch. */
export function displayNowMs(realNowMs = Date.now()) {
  return realNowMs + offsetMs;
}

/** Current display time as a Date (what `new Date()` would be if shifted). */
export function displayNow() {
  return new Date(displayNowMs());
}

// Apply an offset without touching playback (the playback ticker uses this).
// Returns whether it changed.
function applyOffset(ms) {
  const next = clampOffset(ms);
  if (next === offsetMs) return false;
  offsetMs = next;
  for (const fn of listeners) {
    try {
      fn(offsetMs);
    } catch {
      /* one bad listener must not break the others */
    }
  }
  if (!playing) notifySettled();
  try {
    window.dispatchEvent(new CustomEvent(DISPLAY_TIME_EVENT, { detail: { offsetMs } }));
  } catch {
    /* no window (tests, SSR) */
  }
  return true;
}

/**
 * Set the offset (clamped). Notifies subscribers and fires DISPLAY_TIME_EVENT.
 * An explicit set stops playback.
 */
export function setDisplayOffsetMs(ms) {
  const wasPlaying = playing;
  if (wasPlaying) stopPlayback({ silent: true });
  const changed = applyOffset(ms);
  // Stopped on the same instant: settled consumers still need their catch-up.
  if (wasPlaying && !changed) notifySettled();
  return offsetMs;
}

/** Nudge by a delta (e.g. ±HOUR_MS). */
export function shiftDisplayTime(deltaMs) {
  return setDisplayOffsetMs(offsetMs + Number(deltaMs || 0));
}

/** Make the display time equal to the given absolute instant. */
export function setDisplayTime(target, realNowMs = Date.now()) {
  const t = target instanceof Date ? target.getTime() : Date.parse(String(target));
  if (!Number.isFinite(t)) return offsetMs;
  return setDisplayOffsetMs(t - realNowMs);
}

export function resetDisplayTime() {
  return setDisplayOffsetMs(0);
}

/** Subscribe to offset changes; returns an unsubscribe function. */
export function subscribeDisplayTime(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Like subscribeDisplayTime, but quiet while playback runs: fn fires for
 * changes made while paused, plus once when playback stops. For consumers
 * whose recompute is too heavy to run several times a second (pass
 * predictions, reach maps). Returns an unsubscribe function.
 */
export function subscribeDisplayTimeSettled(fn) {
  settledListeners.add(fn);
  return () => settledListeners.delete(fn);
}

function notifySettled() {
  for (const fn of settledListeners) {
    try {
      fn(offsetMs);
    } catch {
      /* one bad listener must not break the others */
    }
  }
}

// ── Playback ────────────────────────────────────────────────────────────────

function notifyPlayback() {
  const state = { playing, speed: playbackSpeed };
  for (const fn of playbackListeners) {
    try {
      fn(state);
    } catch {
      /* one bad listener must not break the others */
    }
  }
}

export function isPlaying() {
  return playing;
}

export function getPlaybackSpeed() {
  return playbackSpeed;
}

/** Subscribe to { playing, speed } changes; returns an unsubscribe function. */
export function subscribePlayback(fn) {
  playbackListeners.add(fn);
  return () => playbackListeners.delete(fn);
}

/** Pick a speed (one of PLAYBACK_SPEEDS); takes effect on the next tick. */
export function setPlaybackSpeed(speed) {
  if (!PLAYBACK_SPEEDS.includes(speed) || speed === playbackSpeed) return;
  playbackSpeed = speed;
  notifyPlayback();
}

/**
 * Run the display time forward at `speed` (default: the current speed).
 * Advances by real elapsed time × speed, so a throttled background tab does
 * not fall behind; stops by itself at +MAX_OFFSET_MS.
 */
export function startPlayback(speed = playbackSpeed) {
  if (PLAYBACK_SPEEDS.includes(speed)) playbackSpeed = speed;
  if (playing) {
    notifyPlayback();
    return;
  }
  if (offsetMs >= MAX_OFFSET_MS) return; // already at the end of the range
  playing = true;
  lastTickRealMs = Date.now();
  playbackTimer = setInterval(() => {
    const realNow = Date.now();
    const elapsed = realNow - lastTickRealMs;
    lastTickRealMs = realNow;
    const next = offsetMs + elapsed * playbackSpeed;
    if (next >= MAX_OFFSET_MS) {
      applyOffset(MAX_OFFSET_MS);
      stopPlayback();
    } else {
      applyOffset(next);
    }
  }, PLAYBACK_TICK_MS);
  notifyPlayback();
}

/** Pause playback. Settled subscribers get their catch-up unless `silent`. */
export function stopPlayback({ silent = false } = {}) {
  if (!playing) return;
  playing = false;
  clearInterval(playbackTimer);
  playbackTimer = null;
  notifyPlayback();
  if (!silent) notifySettled();
}

/**
 * Translate an `ohc:set-time` event detail into an offset (ms), or null
 * when the detail is not understood. Pure — used by the window listener
 * and by tests.
 *   'now' | { now: true }      → 0
 *   { offsetMs: n }            → n (clamped)
 *   { iso: '2026-…Z' } | { time } → that instant minus realNow (clamped)
 */
export function resolveSetTimeDetail(detail, realNowMs = Date.now()) {
  if (detail === 'now' || detail === 0) return 0;
  if (detail == null) return null;
  if (typeof detail === 'number') return clampOffset(detail);
  if (typeof detail === 'string') {
    const t = Date.parse(detail);
    return Number.isFinite(t) ? clampOffset(t - realNowMs) : null;
  }
  if (typeof detail !== 'object') return null;
  if (detail.now === true) return 0;
  if (detail.offsetMs != null) {
    const n = Number(detail.offsetMs);
    return Number.isFinite(n) ? clampOffset(n) : null;
  }
  const iso = detail.iso ?? detail.time ?? detail.at;
  if (iso != null) {
    const t = iso instanceof Date ? iso.getTime() : Date.parse(String(iso));
    return Number.isFinite(t) ? clampOffset(t - realNowMs) : null;
  }
  return null;
}

/**
 * Human label for an offset: "+1d 02:30", "−45m", "+2w 1d", "now".
 * Rounded to the minute.
 */
export function formatOffset(ms) {
  const n = Math.round(Number(ms || 0) / 60_000); // minutes
  if (n === 0) return 'now';
  const sign = n < 0 ? '−' : '+';
  let mins = Math.abs(n);
  const days = Math.floor(mins / 1440);
  mins -= days * 1440;
  const hours = Math.floor(mins / 60);
  mins -= hours * 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || (days && mins)) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  return sign + parts.join(' ');
}

/** Install the window listener for `ohc:set-time`; returns a disposer. */
export function installSetTimeListener(target = typeof window !== 'undefined' ? window : null) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const handler = (e) => {
    const next = resolveSetTimeDetail(e?.detail);
    if (next != null) setDisplayOffsetMs(next);
  };
  target.addEventListener(SET_TIME_EVENT, handler);
  return () => target.removeEventListener(SET_TIME_EVENT, handler);
}
