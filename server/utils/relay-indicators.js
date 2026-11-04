'use strict';
/**
 * Cloud Relay helpers for display indicators (satellite / countdown / alarm /
 * lightning guard relay) sent by a browser in cloud-relay mode. The browser
 * queues an `indicators` command; the bridge's cloud-relay plugin POSTs it to
 * its local /api/indicators, exactly as a browser on the LAN would.
 */

const MAX_QUEUED_COMMANDS = 50;

/** Whitelist the indicator payload (the bridge sanitizes again). Null for a non-object. */
function sanitizeRelayIndicators(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  const out = {
    satVisible: p.satVisible === true,
    satAosInSec: num(p.satAosInSec),
    satLosInSec: num(p.satLosInSec),
    alarm: p.alarm === true,
    countdown: ['off', 'running', 'expired'].includes(p.countdown) ? p.countdown : 'off',
  };
  if (typeof p.lightningRelay === 'boolean') out.lightningRelay = p.lightningRelay;
  if (['clear', 'warn', 'alarm'].includes(p.lightning)) out.lightning = p.lightning;
  if (Number.isFinite(p.lightningAllClearMin)) {
    out.lightningAllClearMin = Math.min(240, Math.max(1, Math.round(p.lightningAllClearMin)));
  }
  if (['auto', 'on', 'off'].includes(p.lightningOverride)) out.lightningOverride = p.lightningOverride;
  if (typeof p.displayId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.displayId)) out.displayId = p.displayId;
  const g = p.lightningGuard;
  if (g && typeof g === 'object' && !Array.isArray(g)) {
    const guard = {};
    for (const k of ['lat', 'lon', 'warnKm', 'alarmKm', 'allClearMin', 'minStrikes', 'hysteresisPct']) {
      if (Number.isFinite(g[k])) guard[k] = g[k];
    }
    if (typeof g.repeatCloser === 'boolean') guard.repeatCloser = g.repeatCloser;
    if (g.relayOn === 'alarm' || g.relayOn === 'warn') guard.relayOn = g.relayOn;
    out.lightningGuard = guard;
  }
  return out;
}

/**
 * Add a command to a session queue. `indicators` replaces any queued
 * indicators command (state, not an action) with its sanitized payload;
 * everything else is appended. The queue is capped at MAX_QUEUED_COMMANDS.
 * Returns the new queue.
 */
function queueRelayCommand(commands, type, payload, now, auth = null) {
  let next = Array.isArray(commands) ? commands.slice() : [];
  if (type === 'indicators') {
    const clean = sanitizeRelayIndicators(payload);
    if (!clean) return next;
    next = next.filter((c) => c.type !== 'indicators');
    // A signed command is forwarded byte-for-byte: the bridge verifies the
    // HMAC over the browser's own payload (and sanitizes it again itself), so
    // rewriting it here would break the signature.
    next.push(auth ? { type, payload, auth, timestamp: now } : { type, payload: clean, timestamp: now });
  } else {
    next.push({ type, payload, ...(auth ? { auth } : {}), timestamp: now });
  }
  return next.length > MAX_QUEUED_COMMANDS ? next.slice(-MAX_QUEUED_COMMANDS) : next;
}

module.exports = { sanitizeRelayIndicators, queueRelayCommand, MAX_QUEUED_COMMANDS };
