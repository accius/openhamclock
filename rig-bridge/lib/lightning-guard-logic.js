'use strict';
/**
 * lightning-guard-logic.js — GENERATED from src/utils/lightningGuard.js by
 * scripts/lightning-guard-cjs.mjs. Do not edit: change the source and run
 * `npm run lightning:sync`. The parity test next to this file fails when
 * the two drift.
 */

/**
 * lightningGuard — pure logic behind lightning antenna protection.
 *
 * Strikes from the shared Blitzortung feed are measured from DE (distance +
 * bearing) and kept while they are inside the warning exit radius. The
 * state machine has three levels:
 *
 *   clear → warn   at least `minStrikes` strikes inside the WARNING radius
 *                  within the last TRIGGER_WINDOW_MS (10 min)
 *   any   → alarm  at least `minStrikes` strikes inside the ALARM radius
 *                  within the trigger window
 *   alarm → warn/clear  only after `allClearMin` minutes without a strike
 *                  inside the alarm EXIT radius (alarm radius + hysteresis);
 *                  drops to warn while strikes inside the warning exit radius
 *                  are still younger than the all-clear time, else to clear
 *   warn  → clear  after `allClearMin` minutes without a strike inside the
 *                  warning exit radius
 *
 * Hysteresis: a level is entered at its radius but held by strikes out to
 * radius × (1 + hysteresisPct/100), so a storm sitting on the boundary does
 * not flap the relay. Everything here is deterministic — `now` is passed in.
 *
 * SHARED WITH RIG BRIDGE: this file is the single source of the guard logic.
 * `npm run lightning:sync` generates rig-bridge/lib/lightning-guard-logic.js
 * (CommonJS) from it for the bridge's headless guard; a parity test fails
 * when the generated copy is stale. Keep this file free of imports and of
 * browser/Node-only APIs.
 */

const LEVELS = ['clear', 'warn', 'alarm'];
const RANK = { off: -1, clear: 0, warn: 1, alarm: 2 };

/** Escalation needs the strikes to be this recent. */
const TRIGGER_WINDOW_MS = 10 * 60 * 1000;
/** Upper bound on remembered nearby strikes. */
const MAX_KEPT_STRIKES = 2000;

const GUARD_DEFAULTS = {
  enabled: false,
  warnKm: 50,
  alarmKm: 25,
  allClearMin: 30,
  minStrikes: 1,
  hysteresisPct: 20,
  // Re-alert during an alarm when the nearest strike halves its distance or
  // comes inside CLOSER_KM (throttled to one per REALERT_MIN_GAP_MS)
  repeatCloser: true,
  tone: 'two-tone',
  channels: { tone: true, speech: true, notify: true, push: false },
  // relay.on: 'alarm' engages at the alarm radius, 'warn' already at the warning radius
  relay: { enabled: false, on: 'alarm' },
};

const clampNum = (v, lo, hi, dflt) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};

/** Fill defaults and clamp a stored settings object; alarm radius never exceeds the warning radius. */
function normalizeGuardSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const warnKm = clampNum(r.warnKm, 2, 500, GUARD_DEFAULTS.warnKm);
  const alarmKm = Math.min(warnKm, clampNum(r.alarmKm, 1, 500, GUARD_DEFAULTS.alarmKm));
  const ch = r.channels && typeof r.channels === 'object' ? r.channels : {};
  const relay = r.relay && typeof r.relay === 'object' ? r.relay : {};
  return {
    enabled: r.enabled === true,
    warnKm,
    alarmKm,
    allClearMin: Math.round(clampNum(r.allClearMin, 1, 240, GUARD_DEFAULTS.allClearMin)),
    minStrikes: Math.round(clampNum(r.minStrikes, 1, 50, GUARD_DEFAULTS.minStrikes)),
    hysteresisPct: Math.round(clampNum(r.hysteresisPct, 0, 100, GUARD_DEFAULTS.hysteresisPct)),
    repeatCloser: r.repeatCloser !== false,
    tone: typeof r.tone === 'string' && r.tone ? r.tone : GUARD_DEFAULTS.tone,
    channels: {
      tone: ch.tone !== false,
      speech: ch.speech !== false,
      notify: ch.notify !== false,
      push: ch.push === true,
    },
    relay: { enabled: relay.enabled === true, on: relay.on === 'warn' ? 'warn' : 'alarm' },
  };
}

/** Radii a level is held by (entry radius + hysteresis). */
function exitRadii(settings) {
  const f = 1 + (settings.hysteresisPct ?? GUARD_DEFAULTS.hysteresisPct) / 100;
  return { warnExitKm: settings.warnKm * f, alarmExitKm: settings.alarmKm * f };
}

// ── Geometry ────────────────────────────────────────────────────────────────
const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in km (haversine). */
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial great-circle bearing from point 1 to point 2, 0–360° true. */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `distanceKm` from (lat, lon) along `bearing` — used to place test strikes. */
function destinationPoint(lat, lon, distanceKm, bearing) {
  const d = distanceKm / R_KM;
  const b = rad(bearing);
  const p1 = rad(lat);
  const l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: ((deg(l2) + 540) % 360) - 180 };
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const CARDINAL_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** 8-point compass abbreviation ('NE'), or the spoken form with { words: true }. */
function cardinal(bearing, { words = false } = {}) {
  if (!Number.isFinite(bearing)) return '';
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return words ? CARDINAL_WORDS[i] : CARDINALS[i];
}

// ── Strike bookkeeping ──────────────────────────────────────────────────────

/**
 * Merge a batch of feed strikes into the guard's list: measure each from DE,
 * keep only those inside the warning exit radius and young enough to matter,
 * drop duplicates, return a new list sorted oldest first.
 *
 * @param {object[]} list   current list (already annotated)
 * @param {object[]} batch  raw strikes { id, lat, lon, timestamp }
 * @param {{lat:number, lon:number}} de
 * @param {object} settings normalized guard settings
 * @param {number} now
 */
function addStrikes(list, batch, de, settings, now) {
  const { warnExitKm } = exitRadii(settings);
  const keepMs = Math.max(settings.allClearMin * 60000, TRIGGER_WINDOW_MS);
  const seen = new Set();
  const out = [];
  for (const s of list || []) {
    if (now - s.timestamp > keepMs) continue;
    seen.add(s.id);
    out.push(s);
  }
  if (de && Number.isFinite(de.lat) && Number.isFinite(de.lon)) {
    for (const s of batch || []) {
      if (!s || seen.has(s.id) || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      if (!Number.isFinite(s.timestamp) || now - s.timestamp > keepMs) continue;
      const distanceKm = haversineKm(de.lat, de.lon, s.lat, s.lon);
      if (distanceKm > warnExitKm) continue;
      seen.add(s.id);
      out.push({ ...s, distanceKm, bearingDeg: bearingDeg(de.lat, de.lon, s.lat, s.lon) });
    }
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out.length > MAX_KEPT_STRIKES ? out.slice(-MAX_KEPT_STRIKES) : out;
}

/**
 * Evaluate the guard. `prevLevel` carries the hysteresis memory; the rest is
 * derived from the strike list.
 *
 * @returns {{
 *   level: 'clear'|'warn'|'alarm',
 *   nearest: object|null,      closest strike inside the warning exit radius within the all-clear window
 *   last: object|null,         most recent such strike
 *   warnCount: number, alarmCount: number,   strikes inside each radius in the trigger window
 *                              (10 min, or the all-clear time when shorter — windowMin)
 *   warnRate: number, alarmRate: number,     the same per minute
 *   clearAt: number|null       when the current level lapses if nothing else strikes
 * }}
 */
function evaluateGuard(prevLevel, strikes, settings, now) {
  const { warnExitKm, alarmExitKm } = exitRadii(settings);
  const allClearMs = settings.allClearMin * 60000;
  // Escalation looks back at most the all-clear time: with a 5-minute
  // all-clear a 7-minute-old strike must not raise the alarm again.
  const triggerMs = Math.min(TRIGGER_WINDOW_MS, allClearMs);
  let warnCount = 0;
  let alarmCount = 0;
  let lastInWarnExit = null;
  let lastInAlarmExit = null;
  let nearest = null;
  let last = null;
  for (const s of strikes || []) {
    const age = now - s.timestamp;
    if (age < -60000) continue; // ignore strikes from a clock far in the future
    if (age <= triggerMs) {
      if (s.distanceKm <= settings.warnKm) warnCount++;
      if (s.distanceKm <= settings.alarmKm) alarmCount++;
    }
    if (age <= allClearMs && s.distanceKm <= warnExitKm) {
      if (lastInWarnExit == null || s.timestamp > lastInWarnExit) lastInWarnExit = s.timestamp;
      if (s.distanceKm <= alarmExitKm && (lastInAlarmExit == null || s.timestamp > lastInAlarmExit)) {
        lastInAlarmExit = s.timestamp;
      }
      if (!nearest || s.distanceKm < nearest.distanceKm) nearest = s;
      if (!last || s.timestamp >= last.timestamp) last = s;
    }
  }

  const prev = RANK[prevLevel] != null && prevLevel !== 'off' ? prevLevel : 'clear';
  const warnHeld = lastInWarnExit != null;
  const alarmHeld = lastInAlarmExit != null;
  let level;
  if (alarmCount >= settings.minStrikes) level = 'alarm';
  else if (prev === 'alarm' && alarmHeld) level = 'alarm';
  else if (warnCount >= settings.minStrikes) level = 'warn';
  else if ((prev === 'alarm' || prev === 'warn') && warnHeld) level = 'warn';
  else level = 'clear';

  let clearAt = null;
  if (level === 'alarm' && lastInAlarmExit != null) clearAt = lastInAlarmExit + allClearMs;
  else if (level === 'warn' && lastInWarnExit != null) clearAt = lastInWarnExit + allClearMs;

  const windowMin = triggerMs / 60000;
  return {
    level,
    nearest,
    last,
    warnCount,
    alarmCount,
    warnRate: warnCount / windowMin,
    alarmRate: alarmCount / windowMin,
    windowMin,
    clearAt,
  };
}

/** 'escalate' | 'deescalate' | null for a level change. */
function transitionKind(prevLevel, nextLevel) {
  const a = RANK[prevLevel] ?? 0;
  const b = RANK[nextLevel] ?? 0;
  if (b > a) return 'escalate';
  if (b < a) return 'deescalate';
  return null;
}

// ── Relay ───────────────────────────────────────────────────────────────────
const OVERRIDES = ['auto', 'on', 'off'];

/**
 * What the relay should do, or null when this browser does not drive it.
 * override 'on' forces protection, 'off' holds the antenna connected.
 */
function relayDemand({ settings, level, override = 'auto' }) {
  if (!settings?.enabled || !settings.relay?.enabled) return null;
  if (override === 'on') return true;
  if (override === 'off') return false;
  return level === 'alarm' || (settings.relay.on === 'warn' && level === 'warn');
}

/**
 * A forced-off override must not outlive the storm it was set for: it lapses
 * back to auto once the guard reaches all-clear. Forced-on (the safe
 * direction) stays until the operator changes it.
 */
function nextOverride(override, level) {
  return override === 'off' && level === 'clear' ? 'auto' : override;
}

// ── Repeat alerts ───────────────────────────────────────────────────────────
/** Crossing inside this distance during an alarm always counts as "closer". */
const CLOSER_KM = 10;
/** At most one "closer" re-alert per this interval. */
const REALERT_MIN_GAP_MS = 2 * 60 * 1000;

/**
 * Should an ongoing alarm alert again because lightning came closer?
 * True when the nearest strike is at most half the distance last alerted,
 * or has just come inside CLOSER_KM — and the last alert is at least
 * REALERT_MIN_GAP_MS old.
 */
function shouldRealert({ lastKm, lastAt, nearestKm, now, minGapMs = REALERT_MIN_GAP_MS }) {
  if (!Number.isFinite(lastKm) || !Number.isFinite(nearestKm)) return false;
  if (Number.isFinite(lastAt) && now - lastAt < minGapMs) return false;
  if (nearestKm <= lastKm / 2) return true;
  return lastKm > CLOSER_KM && nearestKm <= CLOSER_KM;
}

// ── Stateful runner (browser hook and Rig Bridge headless guard) ────────────

/**
 * Small stateful wrapper: strike list + level memory + repeat-alert memory.
 * `step(batch, de, now)` returns { status, prev, transition, closer }:
 *   transition — 'escalate' | 'deescalate' | null
 *   closer     — true when an alarm should re-alert (see shouldRealert)
 */
class GuardRunner {
  constructor(settings) {
    this.settings = normalizeGuardSettings(settings);
    this.strikes = [];
    this.level = 'clear';
    this.since = null;
    this.lastAlertKm = null;
    this.lastAlertAt = null;
  }

  setSettings(settings) {
    this.settings = normalizeGuardSettings(settings);
  }

  reset() {
    this.strikes = [];
    this.level = 'clear';
    this.since = null;
    this.lastAlertKm = null;
    this.lastAlertAt = null;
  }

  step(batch, de, now) {
    const s = this.settings;
    this.strikes = addStrikes(this.strikes, batch || [], de, s, now);
    const prev = this.level;
    const status = evaluateGuard(prev, this.strikes, s, now);
    if (status.level !== prev || this.since == null) this.since = now;
    this.level = status.level;
    const transition = transitionKind(prev, status.level);
    const nearestKm = status.nearest ? status.nearest.distanceKm : null;
    let closer = false;
    if (transition) {
      this.lastAlertKm = status.level === 'clear' ? null : nearestKm;
      this.lastAlertAt = now;
    } else if (
      status.level === 'alarm' &&
      s.repeatCloser &&
      shouldRealert({ lastKm: this.lastAlertKm, lastAt: this.lastAlertAt, nearestKm, now })
    ) {
      closer = true;
      this.lastAlertKm = nearestKm;
      this.lastAlertAt = now;
    }
    return { status: { ...status, since: this.since }, prev, transition, closer };
  }
}

// ── Blitzortung message parsing (browser feed and Rig Bridge) ───────────────

// Blitzortung WebSocket servers (ws3–6/9/10 had certificate problems, 2026-02)
const BLITZORTUNG_SERVERS = [
  'wss://ws8.blitzortung.org',
  'wss://ws7.blitzortung.org',
  'wss://ws2.blitzortung.org',
  'wss://ws1.blitzortung.org',
];
/** Key every client sends after connecting. */
const BLITZORTUNG_KEY = 111;

/** LZW decompression — Blitzortung compresses every WebSocket message. */
function lzwDecode(compressed) {
  const dict = {};
  const data = compressed.split('');
  let currChar = data[0];
  let oldPhrase = currChar;
  const out = [currChar];
  let code = 256;
  let phrase;

  for (let i = 1; i < data.length; i++) {
    const currCode = data[i].charCodeAt(0);
    if (currCode < 256) {
      phrase = data[i];
    } else {
      phrase = dict[currCode] ? dict[currCode] : oldPhrase + currChar;
    }
    out.push(phrase);
    currChar = phrase.charAt(0);
    dict[code] = oldPhrase + currChar;
    code++;
    oldPhrase = phrase;
  }

  return out.join('');
}

/**
 * Parse one decoded Blitzortung message
 * ({ time (ns), lat, lon, alt, pol, mds }) into a strike, or null.
 */
function parseStrikeMessage(data) {
  if (!data || !data.time || data.lat == null || data.lon == null) return null;
  const lat = parseFloat(data.lat);
  const lon = parseFloat(data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: `strike_${data.time}_${data.lat}_${data.lon}`,
    lat,
    lon,
    timestamp: parseInt(data.time / 1000000, 10),
    intensity: Math.abs(data.pol || 0),
    polarity: (data.pol || 0) >= 0 ? 'positive' : 'negative',
    altitude: data.alt || 0,
    signal: data.mds || 0,
  };
}

// ── Presentation helpers ────────────────────────────────────────────────────

/** Distance in the station's units: { value, unit } ('km' or 'mi'). */
function formatDistance(km, imperial = false) {
  if (!Number.isFinite(km)) return { value: '', unit: imperial ? 'mi' : 'km' };
  const v = imperial ? km * 0.621371 : km;
  return { value: v < 10 ? v.toFixed(1) : String(Math.round(v)), unit: imperial ? 'mi' : 'km' };
}

/** "12 km NE" style one-liner for a strike (empty when none). */
function describeStrike(strike, imperial = false) {
  if (!strike || !Number.isFinite(strike.distanceKm)) return '';
  const d = formatDistance(strike.distanceKm, imperial);
  return `${d.value} ${d.unit} ${cardinal(strike.bearingDeg)}`;
}

module.exports = {
  LEVELS,
  TRIGGER_WINDOW_MS,
  MAX_KEPT_STRIKES,
  GUARD_DEFAULTS,
  normalizeGuardSettings,
  exitRadii,
  haversineKm,
  bearingDeg,
  destinationPoint,
  cardinal,
  addStrikes,
  evaluateGuard,
  transitionKind,
  OVERRIDES,
  relayDemand,
  nextOverride,
  CLOSER_KM,
  REALERT_MIN_GAP_MS,
  shouldRealert,
  GuardRunner,
  BLITZORTUNG_SERVERS,
  BLITZORTUNG_KEY,
  lzwDecode,
  parseStrikeMessage,
  formatDistance,
  describeStrike,
};
