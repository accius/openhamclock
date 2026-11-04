'use strict';
/**
 * gpio-logic.js — pure state machine behind the GPIO plugin.
 *
 * Everything here is deterministic and hardware-free so it can be unit
 * tested: the pin map (HamClock-compatible defaults), the output logic that
 * turns indicator state into pin levels (including the satellite pulse
 * patterns), input debouncing, and parsers for the libgpiod CLI tools.
 *
 * Pin numbers are BCM GPIO numbers (what libgpiod and sysfs use), not
 * header positions. HEADER_TO_BCM documents the 40-pin header for the
 * manual and lets users type a header pin as "P37".
 */

/** Raspberry Pi 40-pin header → BCM GPIO number (power/ground pins omitted). */
const HEADER_TO_BCM = {
  3: 2,
  5: 3,
  7: 4,
  8: 14,
  10: 15,
  11: 17,
  12: 18,
  13: 27,
  15: 22,
  16: 23,
  18: 24,
  19: 10,
  21: 9,
  22: 25,
  23: 11,
  24: 8,
  26: 7,
  27: 0,
  28: 1,
  29: 5,
  31: 6,
  32: 12,
  33: 13,
  35: 19,
  36: 16,
  37: 26,
  38: 20,
  40: 21,
};

/**
 * Default pin map — matches HamClock's header assignments (manual p.24):
 *   countdown: switch pin 37 (BCM 26), green LED pin 33 (BCM 13), red LED
 *              pin 35 (BCM 19); pin 17 is the 3V3 feed for the switch
 *   satellite alarm: pin 38 (BCM 20)
 *   on-air: pin 40 (BCM 21)
 *   alarm clock: output pin 31 (BCM 6), reset switch pin 29 (BCM 5)
 * HamClock has no PTT *input*; we add one on pin 36 (BCM 16).
 */
const DEFAULT_PINS = {
  pttIn: 16, // header 36 — PTT / ON-AIR sense, active low
  countdownResetIn: 26, // header 37 — countdown restart button, active low
  alarmSilenceIn: 5, // header 29 — alarm silence button, active low
  onAirOut: 21, // header 40 — ON-AIR LED
  alarmOut: 6, // header 31 — alarm ringing
  countdownGreenOut: 13, // header 33 — countdown running
  countdownRedOut: 19, // header 35 — countdown expired
  satOut: 20, // header 38 — satellite visible / AOS warning
  // Lightning antenna-protection relay. Off by default: a new output must
  // never start driving a pin someone already uses. Suggested: BCM 25
  // (header 22), free on a bare Pi and on the common HATs.
  lightningOut: null,
};

/** Suggested BCM line for lightningOut (shown in the setup UIs). */
const SUGGESTED_LIGHTNING_PIN = 25;

const INPUT_NAMES = ['pttIn', 'countdownResetIn', 'alarmSilenceIn'];
const OUTPUT_NAMES = ['onAirOut', 'alarmOut', 'countdownGreenOut', 'countdownRedOut', 'satOut', 'lightningOut'];

/**
 * Parse one pin value: BCM number, "P37" header reference, or -1/''/null to
 * disable the function. Returns null for disabled.
 */
function parsePin(v) {
  if (v == null || v === '' || v === false) return null;
  if (typeof v === 'string') {
    const m = /^\s*[Pp](?:in)?\s*(\d{1,2})\s*$/.exec(v);
    if (m) {
      const bcm = HEADER_TO_BCM[parseInt(m[1], 10)];
      return bcm == null ? null : bcm;
    }
    v = parseInt(v, 10);
  }
  if (!Number.isInteger(v) || v < 0 || v > 57) return null;
  return v;
}

/**
 * Merge user config over the defaults; returns { inputs: {name: bcm}, outputs:
 * {name: bcm}, conflicts: [name...] }. A BCM number used twice disables the
 * later one and reports it.
 */
function resolvePinMap(userPins = {}) {
  const inputs = {};
  const outputs = {};
  const used = new Map();
  const conflicts = [];
  for (const name of [...INPUT_NAMES, ...OUTPUT_NAMES]) {
    const raw = Object.prototype.hasOwnProperty.call(userPins, name) ? userPins[name] : DEFAULT_PINS[name];
    const bcm = parsePin(raw);
    if (bcm == null) continue;
    if (used.has(bcm)) {
      conflicts.push(name);
      continue;
    }
    used.set(bcm, name);
    (INPUT_NAMES.includes(name) ? inputs : outputs)[name] = bcm;
  }
  return { inputs, outputs, conflicts };
}

/** Square wave: true during the high half-period of an `hz` pulse train. */
function pulse(nowMs, hz) {
  const half = 1000 / hz / 2;
  return Math.floor(nowMs / half) % 2 === 0;
}

const COUNTDOWN_STATES = new Set(['off', 'running', 'expired']);
const LIGHTNING_LEVELS = new Set(['clear', 'warn', 'alarm']);

/**
 * Normalise the indicator payload the browser POSTs to /api/indicators.
 * Unknown keys are dropped; wrong types fall back to "off".
 *
 * Lightning fields are tri-state: `lightningRelay` true/false when that
 * display's lightning guard drives the relay, null when the display does not
 * report it at all (guard or relay off there). Reports go to the
 * LightningRelayArbiter keyed by `displayId`.
 */
function sanitizeIndicators(body) {
  const b = body && typeof body === 'object' ? body : {};
  const n = (v) =>
    Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null;
  const allClear = n(b.lightningAllClearMin);
  return {
    satVisible: b.satVisible === true,
    satAosInSec: n(b.satAosInSec),
    satLosInSec: n(b.satLosInSec),
    alarm: b.alarm === true,
    countdown: COUNTDOWN_STATES.has(b.countdown) ? b.countdown : 'off',
    lightning: LIGHTNING_LEVELS.has(b.lightning) ? b.lightning : null,
    lightningRelay: b.lightningRelay === true ? true : b.lightningRelay === false ? false : null,
    lightningAllClearMin: allClear == null ? null : Math.min(240, Math.max(1, Math.round(allClear))),
    lightningOverride: LIGHTNING_OVERRIDES.has(b.lightningOverride) ? b.lightningOverride : 'auto',
    displayId: typeof b.displayId === 'string' && DISPLAY_ID_RE.test(b.displayId) ? b.displayId : null,
    lightningGuard: sanitizeGuardSettings(b.lightningGuard),
  };
}

/**
 * The lightning guard settings a display sends with its indicators, for the
 * headless guard: { lat, lon, warnKm, alarmKm, allClearMin, minStrikes,
 * hysteresisPct, repeatCloser, relayOn }. Numbers are clamped like the guard
 * core does; null when absent or without a valid location.
 */
function sanitizeGuardSettings(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const num = (v, lo, hi) => {
    const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null;
  };
  const lat = num(g.lat, -Infinity, Infinity);
  const lon = num(g.lon, -Infinity, Infinity);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const warnKm = num(g.warnKm, 2, 500) ?? 50;
  return {
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    warnKm,
    alarmKm: Math.min(warnKm, num(g.alarmKm, 1, 500) ?? 25),
    allClearMin: Math.round(num(g.allClearMin, 1, 240) ?? 30),
    minStrikes: Math.round(num(g.minStrikes, 1, 50) ?? 1),
    hysteresisPct: Math.round(num(g.hysteresisPct, 0, 100) ?? 20),
    repeatCloser: g.repeatCloser !== false,
    relayOn: g.relayOn === 'warn' ? 'warn' : 'alarm',
  };
}

/** Fields of config.gpio.lightningHeadless a display may set (not `enabled`). */
const HEADLESS_SETTING_KEYS = [
  'lat',
  'lon',
  'warnKm',
  'alarmKm',
  'allClearMin',
  'minStrikes',
  'hysteresisPct',
  'repeatCloser',
  'relayOn',
];

/** Copy of `current` with the reported settings applied, or null when nothing changed. */
function applyGuardSettings(current, reported) {
  if (!reported) return null;
  const cur = current && typeof current === 'object' ? current : {};
  let changed = false;
  const next = { ...cur };
  for (const k of HEADLESS_SETTING_KEYS) {
    const a = cur[k];
    const b = reported[k];
    const same = a === b || (a !== '' && a != null && Number(a) === b);
    if (!same) {
      next[k] = b;
      changed = true;
    }
  }
  return changed ? next : null;
}

/** Capabilities reported by /api/gpio/status, for the app's update notice. */
const GPIO_FEATURES = ['lightning-relay', 'lightning-arbiter', 'lightning-headless', 'lightning-guard-settings'];

const LIGHTNING_OVERRIDES = new Set(['auto', 'on', 'off']);
const DISPLAY_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DEFAULT_ALL_CLEAR_MIN = 30;

/**
 * Decides the lightning relay from every display (and the bridge's own
 * headless guard) that reports it.
 *
 *  • Engaged while ANY reporter wants protection: a live reporter (report
 *    younger than `staleMs`) whose latest report asked for the relay, or a
 *    reporter that asked for it and then went quiet — that one keeps its claim
 *    until its own all-clear time (`allClearMin` from its report) has passed
 *    since its last request. With `holdWhenStale` off a quiet reporter's claim
 *    ends at `staleMs`.
 *  • Released only when no reporter wants it.
 *  • A manual override from a live display wins: the most recent live
 *    'on' (force protect) or 'off' (hold connected) decides.
 *
 * Reporters whose claim has lapsed are forgotten; at most `maxReporters`
 * are kept (oldest report evicted first).
 */
class LightningRelayArbiter {
  constructor({ staleMs = 90000, holdWhenStale = true, maxReporters = 16 } = {}) {
    this.staleMs = staleMs;
    this.holdWhenStale = holdWhenStale;
    this.maxReporters = maxReporters;
    this.reporters = new Map(); // id → { relay, level, allClearMin, override, at }
  }

  /** Record a report. `relay` must be a boolean (null reports are not sent here). */
  report(id, { relay, level = null, allClearMin = null, override = 'auto' }, now) {
    if (typeof relay !== 'boolean') return;
    const key = id || 'default';
    this.reporters.delete(key); // re-insert so Map order = report age
    this.reporters.set(key, {
      relay,
      level,
      allClearMin: Number.isFinite(allClearMin) ? allClearMin : DEFAULT_ALL_CLEAR_MIN,
      override: LIGHTNING_OVERRIDES.has(override) ? override : 'auto',
      at: now,
    });
    while (this.reporters.size > this.maxReporters) {
      this.reporters.delete(this.reporters.keys().next().value);
    }
  }

  remove(id) {
    this.reporters.delete(id);
  }

  /** @returns {{ engaged: boolean, reason: string, holdUntil: number|null, reporters: object[] }} */
  decide(now) {
    const list = [];
    let overrideBy = null;
    let wants = false;
    let holdUntil = null;
    for (const [id, r] of this.reporters) {
      const live = now - r.at <= this.staleMs;
      let claim = false;
      let until = null;
      if (r.relay) {
        if (live) claim = true;
        else if (this.holdWhenStale) {
          until = r.at + r.allClearMin * 60000;
          claim = now < until;
        }
      }
      if (!live && !claim) {
        this.reporters.delete(id);
        continue;
      }
      if (live && r.override !== 'auto' && (!overrideBy || r.at >= overrideBy.at)) overrideBy = { id, ...r };
      if (claim) {
        wants = true;
        if (until != null) holdUntil = Math.max(holdUntil ?? 0, until);
      }
      list.push({
        id,
        relay: r.relay,
        level: r.level,
        live,
        claim,
        override: r.override,
        ageMs: now - r.at,
        holdUntil: until,
      });
    }
    if (overrideBy) {
      return {
        engaged: overrideBy.override === 'on',
        reason: `override-${overrideBy.override}`,
        holdUntil: null,
        reporters: list,
      };
    }
    return {
      engaged: wants,
      reason: wants ? (holdUntil != null && !list.some((r) => r.live && r.claim) ? 'hold' : 'requested') : 'clear',
      holdUntil: wants ? holdUntil : null,
      reporters: list,
    };
  }
}

/**
 * Compute desired output levels (true = asserted) from the current state.
 *
 * @param {object} s
 * @param {boolean} s.ptt        rig PTT from the radio plugin
 * @param {boolean} s.pttIn      PTT sense input active
 * @param {object}  s.indicators sanitized indicators from the browser
 * @param {boolean} s.indicatorsStale  browser hasn't refreshed in a while
 * @param {boolean} s.alarmSilenced    silence button pressed since alarm began
 * @param {boolean} [s.lightningEngaged]  the LightningRelayArbiter's decision
 * @param {number}  nowMs
 */
function computeOutputs(s, nowMs) {
  const ind = s.indicators || sanitizeIndicators(null);
  const live = !s.indicatorsStale;
  const onAir = !!(s.ptt || s.pttIn);
  const alarm = live && ind.alarm && !s.alarmSilenced;
  const countdownGreen = live && ind.countdown === 'running';
  const countdownRed = live && ind.countdown === 'expired';

  // Satellite: 1 Hz the minute before AOS, steady during the pass, 2 Hz for
  // the last minute before LOS.
  let sat = false;
  if (live) {
    if (ind.satVisible) {
      sat = ind.satLosInSec != null && ind.satLosInSec <= 60 ? pulse(nowMs, 2) : true;
    } else if (ind.satAosInSec != null && ind.satAosInSec >= 0 && ind.satAosInSec <= 60) {
      sat = pulse(nowMs, 1);
    }
  }

  return {
    onAirOut: onAir,
    alarmOut: alarm,
    countdownGreenOut: countdownGreen,
    countdownRedOut: countdownRed,
    satOut: sat,
    lightningOut: !!s.lightningEngaged,
  };
}

/**
 * Physical level (0/1) for an output line. `outputActiveLow` inverts every
 * line; `lightningFailSafe` additionally inverts lightningOut so the relay is
 * energised while the antenna may stay connected — power loss, a crash or a
 * stopped bridge then releases it and the antenna is disconnected.
 */
function physicalLevel(name, asserted, { outputActiveLow = false, lightningFailSafe = false } = {}) {
  let level = asserted ? 1 : 0;
  if (outputActiveLow) level ^= 1;
  if (name === 'lightningOut' && lightningFailSafe) level ^= 1;
  return level;
}

/**
 * Debounced edge detector for a switch input.
 * `sample(rawLevel, nowMs)` → 'press' | 'release' | null. Active-low by
 * default (switch to ground with a pull-up).
 */
class InputDebouncer {
  constructor({ activeLow = true, debounceMs = 50 } = {}) {
    this.activeLow = activeLow;
    this.debounceMs = debounceMs;
    this.active = false; // debounced logical state
    this._candidate = null;
    this._candidateSince = 0;
  }

  _logical(raw) {
    const high = raw === 1 || raw === true || raw === '1';
    return this.activeLow ? !high : high;
  }

  sample(raw, nowMs) {
    const logical = this._logical(raw);
    if (logical === this.active) {
      this._candidate = null;
      return null;
    }
    if (this._candidate !== logical) {
      this._candidate = logical;
      this._candidateSince = nowMs;
      if (this.debounceMs <= 0) return this._commit(logical);
      return null;
    }
    if (nowMs - this._candidateSince >= this.debounceMs) return this._commit(logical);
    return null;
  }

  _commit(logical) {
    this.active = logical;
    this._candidate = null;
    return logical ? 'press' : 'release';
  }
}

/** libgpiod major version from `gpioset --version` output, or null. */
function parseGpiodVersion(text) {
  const m = /\bv?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Parse one `gpiomon` line into { offset, rising }.
 * Formats seen in the wild:
 *   v1 default : "event: FALLING EDGE offset: 26 timestamp: [1234.567]"
 *   v1 --format="%e %o": "0 26"  (0 = falling, 1 = rising)
 *   v2 default : "1697000000.123 falling gpiochip0 26" (tab or space separated)
 *   v2 --format="%e %o": "falling 26" or "0 26"
 */
function parseGpiomonLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  let m = /^event:\s+(RISING|FALLING)\s+EDGE\s+offset:\s+(\d+)/i.exec(s);
  if (m) return { offset: parseInt(m[2], 10), rising: m[1].toUpperCase() === 'RISING' };
  m = /^(?:\S+\s+)?(rising|falling|[01])\s+(?:\S*gpiochip\d+\s+)?(\d+)\b/i.exec(s);
  if (m) {
    const e = m[1].toLowerCase();
    return { offset: parseInt(m[2], 10), rising: e === 'rising' || e === '1' };
  }
  return null;
}

/** Parse `gpioget` output ("1 0 1" or "active inactive active") into 0/1 values. */
function parseGpiogetOutput(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const t = tok
        .toLowerCase()
        .replace(/^"?\d+"?=/, '')
        .replace(/"/g, '');
      if (t === '1' || t === 'active') return 1;
      if (t === '0' || t === 'inactive') return 0;
      return null;
    })
    .filter((v) => v !== null);
}

module.exports = {
  HEADER_TO_BCM,
  DEFAULT_PINS,
  SUGGESTED_LIGHTNING_PIN,
  INPUT_NAMES,
  OUTPUT_NAMES,
  parsePin,
  resolvePinMap,
  pulse,
  sanitizeIndicators,
  LightningRelayArbiter,
  sanitizeGuardSettings,
  applyGuardSettings,
  GPIO_FEATURES,
  computeOutputs,
  physicalLevel,
  InputDebouncer,
  parseGpiodVersion,
  parseGpiomonLine,
  parseGpiogetOutput,
};
