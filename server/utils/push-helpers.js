'use strict';
/**
 * Pure helpers for the Web Push feature (server/routes/push.js).
 *
 * Everything here is side-effect free and unit-tested in
 * server/utils/pushHelpers.test.js — the route module owns I/O (persistence,
 * webpush delivery, timers) and delegates the decisions to these functions.
 *
 * Store shape (persisted as JSON, see push.js):
 *   {
 *     subscriptions: { [endpoint]: { subscription, addedAt } },
 *     pushedAlerts:  { [productId:serial]: pushedAtMs }
 *   }
 */

/** Same threshold as the in-app severe-alert feed (App.jsx severeSwpcAlerts). */
const MIN_PUSH_SCALE_LEVEL = 2;

/** Never push alerts older than this — keeps a cold-start (empty dedupe file)
 *  from spamming every subscriber with hours-old products. */
const MAX_PUSH_ALERT_AGE_MS = 60 * 60 * 1000; // 1 hour

/** How long pushed-alert dedupe keys are kept before pruning. */
const PUSHED_KEY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Hard cap on stored subscriptions. */
const MAX_SUBSCRIPTIONS = 10000;

/** Minimal structural validation of a PushSubscription.toJSON() payload. */
function isValidSubscription(sub) {
  return !!(
    sub &&
    typeof sub === 'object' &&
    typeof sub.endpoint === 'string' &&
    /^https:\/\//.test(sub.endpoint) &&
    sub.endpoint.length <= 2048 &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  );
}

/**
 * Add (or refresh) a subscription in the store, deduped by endpoint.
 * Returns { ok: true } or { ok: false, reason: 'invalid' | 'full' }.
 */
function addSubscription(store, sub, max = MAX_SUBSCRIPTIONS, now = Date.now()) {
  if (!isValidSubscription(sub)) return { ok: false, reason: 'invalid' };
  const exists = Object.prototype.hasOwnProperty.call(store.subscriptions, sub.endpoint);
  if (!exists && Object.keys(store.subscriptions).length >= max) return { ok: false, reason: 'full' };
  const prev = exists ? store.subscriptions[sub.endpoint] : null;
  store.subscriptions[sub.endpoint] = {
    subscription: { endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: sub.keys },
    addedAt: prev ? prev.addedAt : now,
    // Re-subscribing keeps the lightning opt-in
    ...(prev && prev.lightning ? { lightning: prev.lightning } : {}),
  };
  return { ok: true };
}

/** Remove a subscription by endpoint. Returns true when one was removed. */
function removeSubscription(store, endpoint) {
  if (typeof endpoint !== 'string' || !Object.prototype.hasOwnProperty.call(store.subscriptions, endpoint)) {
    return false;
  }
  delete store.subscriptions[endpoint];
  return true;
}

/** Stable dedupe key for a parsed SWPC alert (product code + serial). */
function alertDedupeKey(alert) {
  return `${alert?.productId ?? 'unknown'}:${alert?.serial ?? 'unknown'}`;
}

/**
 * Filter a parsed SWPC alert array down to the alerts that should be pushed
 * now: NOAA scale level >= MIN_PUSH_SCALE_LEVEL, recent (MAX_PUSH_ALERT_AGE_MS)
 * and not already recorded in pushedKeys. Does NOT mutate pushedKeys.
 */
function selectNewSevereAlerts(alerts, pushedKeys, now = Date.now()) {
  if (!Array.isArray(alerts)) return [];
  return alerts.filter((a) => {
    if ((a?.scale?.level ?? 0) < MIN_PUSH_SCALE_LEVEL) return false;
    const issued = a.issueTime ? Date.parse(a.issueTime) : NaN;
    if (!Number.isFinite(issued) || now - issued > MAX_PUSH_ALERT_AGE_MS) return false;
    return !Object.prototype.hasOwnProperty.call(pushedKeys, alertDedupeKey(a));
  });
}

/**
 * Drop dedupe keys older than PUSHED_KEY_RETENTION_MS.
 * Mutates pushedKeys; returns the number of keys removed.
 */
function prunePushedKeys(pushedKeys, now = Date.now()) {
  let removed = 0;
  for (const [key, ts] of Object.entries(pushedKeys)) {
    if (!Number.isFinite(ts) || now - ts > PUSHED_KEY_RETENTION_MS) {
      delete pushedKeys[key];
      removed += 1;
    }
  }
  return removed;
}

/**
 * Build the JSON payload the service worker `push` handler displays for a
 * severe SWPC alert. Shape mirrors showAlertNotification options.
 */
function buildSwpcPushPayload(alert) {
  const scaleText = alert?.scale?.text || '';
  const title = scaleText ? `Space Weather: ${scaleText}` : 'Space Weather Alert';
  const parts = [];
  if (alert?.type && alert.type !== 'MESSAGE') parts.push(alert.type);
  if (alert?.title) parts.push(alert.title);
  let body = parts.join(': ');
  if (body.length > 140) body = `${body.slice(0, 137)}…`;
  return { title, body, tag: 'ohc-push-swpc' };
}

// ── Lightning guard (station-broadcast push) ────────────────────────────────
const LIGHTNING_PUSH_LEVELS = ['warn', 'alarm', 'clear'];
const LIGHTNING_PUSH_MIN_GAP_MS = 20 * 1000; // any two lightning pushes
const LIGHTNING_PUSH_REPEAT_MS = 10 * 60 * 1000; // the same level again
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const { haversineDistance } = require('./grid');

const LEVEL_RANK = { clear: 0, warn: 1, alarm: 2 };
const LIGHTNING_PUSH_CLOSER_GAP_MS = 2 * 60 * 1000;
/** A posted strike must be this recent (and not from the future). */
const LIGHTNING_STRIKE_MAX_AGE_MS = 15 * 60 * 1000;
/** Most targeted pushes one strike report may cause. */
const LIGHTNING_MAX_TARGETS_PER_REPORT = 200;

/**
 * Validate a subscription's lightning opt-in: where the station is and the
 * radii it cares about. The location is rounded to 0.01° (~1 km) — enough
 * for lightning distances, and less precise than the station's grid square.
 * Returns the stored shape or null.
 */
function sanitizeLightningPrefs(p) {
  if (!p || typeof p !== 'object') return null;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const warnKm = clamp(p.warnKm, 2, 500, 50);
  const alarmKm = Math.min(warnKm, clamp(p.alarmKm, 1, 500, 25));
  return {
    lat: Math.round(lat * 100) / 100,
    lon: Math.round(lon * 100) / 100,
    warnKm,
    alarmKm,
    imperial: p.imperial === true,
  };
}

/** Set or clear (prefs null) the lightning opt-in of a stored subscription. */
function setLightningPrefs(store, endpoint, prefs) {
  const entry =
    typeof endpoint === 'string' && Object.hasOwn(store.subscriptions, endpoint) ? store.subscriptions[endpoint] : null;
  if (!entry) return { ok: false, reason: 'unknown-subscription' };
  if (prefs === null) {
    delete entry.lightning;
    return { ok: true, lightning: null };
  }
  const clean = sanitizeLightningPrefs(prefs);
  if (!clean) return { ok: false, reason: 'invalid' };
  entry.lightning = clean;
  return { ok: true, lightning: clean };
}

/** Validate a posted strike { lat, lon, timestamp (ms) }. */
function sanitizeStrike(s, now = Date.now()) {
  if (!s || typeof s !== 'object') return null;
  const lat = Number(s.lat);
  const lon = Number(s.lon);
  const ts = Number(s.timestamp);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(ts) || ts < now - LIGHTNING_STRIKE_MAX_AGE_MS || ts > now + 2 * 60 * 1000) return null;
  return { lat, lon, timestamp: ts };
}

function bearingFrom(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x =
    Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Distance, bearing and level of a strike for one opted-in subscription (level null = outside). */
function lightningForPrefs(prefs, strike) {
  const distanceKm = haversineDistance(prefs.lat, prefs.lon, strike.lat, strike.lon);
  const level = distanceKm <= prefs.alarmKm ? 'alarm' : distanceKm <= prefs.warnKm ? 'warn' : null;
  return { level, distanceKm, bearingDeg: bearingFrom(prefs.lat, prefs.lon, strike.lat, strike.lon) };
}

/**
 * Opted-in subscriptions a strike is close enough to, nearest first, at most
 * `max`. Each target: { endpoint, level, distanceKm, bearingDeg, imperial }.
 */
function lightningTargets(store, strike, max = LIGHTNING_MAX_TARGETS_PER_REPORT) {
  const out = [];
  for (const [endpoint, entry] of Object.entries(store.subscriptions)) {
    if (!entry.lightning) continue;
    const hit = lightningForPrefs(entry.lightning, strike);
    if (hit.level) out.push({ endpoint, ...hit, imperial: !!entry.lightning.imperial });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out.slice(0, max);
}

/**
 * Per-subscription throttle for targeted lightning pushes. `last` is
 * { at, level, km } of the last push to that subscription. Sends when there
 * was none for LIGHTNING_PUSH_REPEAT_MS, when the level rises, or when the
 * strike is at most half as far as last time (≥ 2 min apart) — never two
 * within LIGHTNING_PUSH_MIN_GAP_MS.
 */
function shouldPushLightningTo(last, level, km, now = Date.now()) {
  if (!last || !last.at) return true;
  const age = now - last.at;
  if (age < LIGHTNING_PUSH_MIN_GAP_MS) return false;
  if (age >= LIGHTNING_PUSH_REPEAT_MS) return true;
  if ((LEVEL_RANK[level] ?? 0) > (LEVEL_RANK[last.level] ?? 0)) return true;
  return Number.isFinite(km) && Number.isFinite(last.km) && km <= last.km / 2 && age >= LIGHTNING_PUSH_CLOSER_GAP_MS;
}

/**
 * Fixed-window rate limiter keyed by e.g. client IP. Bounded: at most
 * `maxKeys` keys are tracked (oldest window dropped first).
 */
function makeKeyedLimiter(max, windowMs, maxKeys = 5000) {
  const hits = new Map(); // key → { start, count }
  return function allow(key, now = Date.now()) {
    const k = String(key || 'unknown');
    let h = hits.get(k);
    if (!h || now - h.start >= windowMs) {
      hits.delete(k);
      h = { start: now, count: 0 };
      hits.set(k, h);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    }
    h.count += 1;
    return h.count <= max;
  };
}

/**
 * Build the push payload for a lightning guard transition from the
 * browser's report. Only validated numbers and a fixed level vocabulary
 * reach the text — nothing free-form from the request is echoed.
 * Returns null for an invalid report.
 */
function buildLightningPushPayload(report) {
  const r = report && typeof report === 'object' ? report : {};
  if (!LIGHTNING_PUSH_LEVELS.includes(r.level)) return null;
  const title =
    r.closer === true && r.level === 'alarm'
      ? 'Lightning closer'
      : r.level === 'alarm'
        ? 'Lightning ALARM'
        : r.level === 'warn'
          ? 'Lightning warning'
          : 'Lightning all clear';
  const parts = [];
  const km = Number(r.distanceKm);
  if (
    r.level !== 'clear' &&
    r.distanceKm !== null &&
    r.distanceKm !== '' &&
    Number.isFinite(km) &&
    km >= 0 &&
    km <= 2000
  ) {
    const imperial = r.imperial === true;
    const v = imperial ? km * 0.621371 : km;
    const brg = Number(r.bearingDeg);
    const dir =
      r.bearingDeg != null && Number.isFinite(brg)
        ? ` ${CARDINALS[Math.round((((brg % 360) + 360) % 360) / 45) % 8]}`
        : '';
    parts.push(`Nearest strike ${v < 10 ? v.toFixed(1) : Math.round(v)} ${imperial ? 'mi' : 'km'}${dir}`);
  }
  if (r.level === 'clear') parts.push('No strikes nearby for the all-clear time');
  if (r.simulated === true) parts.push('test strike');
  if (r.relay === true) parts.push('antenna relay engaged');
  else if (r.relay === false && r.level === 'clear') parts.push('antenna relay released');
  return { title, body: parts.join(' · '), tag: 'ohc-lightning' };
}

/**
 * Throttle for lightning pushes: never two within LIGHTNING_PUSH_MIN_GAP_MS,
 * and the same level is not repeated within LIGHTNING_PUSH_REPEAT_MS (a
 * flapping browser or several displays reporting the same storm).
 */
function shouldPushLightning(last, level, now = Date.now()) {
  if (!last || !last.at) return true;
  if (now - last.at < LIGHTNING_PUSH_MIN_GAP_MS) return false;
  if (last.level === level && now - last.at < LIGHTNING_PUSH_REPEAT_MS) return false;
  return true;
}

module.exports = {
  MIN_PUSH_SCALE_LEVEL,
  MAX_PUSH_ALERT_AGE_MS,
  PUSHED_KEY_RETENTION_MS,
  MAX_SUBSCRIPTIONS,
  isValidSubscription,
  addSubscription,
  removeSubscription,
  alertDedupeKey,
  selectNewSevereAlerts,
  prunePushedKeys,
  buildSwpcPushPayload,
  LIGHTNING_PUSH_MIN_GAP_MS,
  LIGHTNING_PUSH_REPEAT_MS,
  buildLightningPushPayload,
  shouldPushLightning,
  LIGHTNING_STRIKE_MAX_AGE_MS,
  LIGHTNING_MAX_TARGETS_PER_REPORT,
  sanitizeLightningPrefs,
  setLightningPrefs,
  sanitizeStrike,
  lightningForPrefs,
  lightningTargets,
  shouldPushLightningTo,
  makeKeyedLimiter,
};
