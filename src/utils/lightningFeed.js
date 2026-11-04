/**
 * lightningFeed — one shared Blitzortung.org strike stream for the page.
 *
 * The Lightning map layer, the 3D globe overlay and the lightning guard all
 * need the same real-time strikes. Each used to open its own WebSocket; now
 * they subscribe here and the socket is reference-counted: it opens with the
 * first subscriber and closes with the last, so the guard keeps the feed
 * running while the map layer is off (and vice versa).
 *
 * Subscribers get batches of new strikes (flushed once a second) shaped
 *   { id, lat, lon, timestamp (ms), intensity (kA), polarity, altitude, signal }
 * and keep whatever history they need themselves — the global feed is far
 * too busy to buffer here.
 *
 * injectStrike() feeds a synthetic strike to every subscriber (Settings →
 * Alerts → Lightning guard "Test", or the `ohc:inject-lightning` window
 * event) so the whole chain can be verified without a storm.
 */

import { BLITZORTUNG_KEY, BLITZORTUNG_SERVERS, lzwDecode, parseStrikeMessage } from './lightningGuard.js';

// Parsing and the server list live in the shared guard core (also used by
// Rig Bridge's headless guard); re-exported here for existing imports.
export { BLITZORTUNG_SERVERS, lzwDecode, parseStrikeMessage };
const WS_KEY = BLITZORTUNG_KEY;
const FLUSH_MS = 1000;
const RECONNECT_MS = 5000;
const ATTEMPTS_PER_SERVER = 3;

// ── Shared socket ───────────────────────────────────────────────────────────
const subscribers = new Set();
let ws = null;
let pending = [];
let flushTimer = null;
let reconnectTimer = null;
let serverIndex = 0;
let attempts = 0;
let connected = false;
let simCounter = 0;

function deliver(batch) {
  for (const fn of subscribers) {
    try {
      fn(batch);
    } catch (err) {
      console.error('[LightningFeed] subscriber failed:', err);
    }
  }
}

function flush() {
  flushTimer = null;
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  deliver(batch);
}

function queue(strike) {
  pending.push(strike);
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

function noteFailure() {
  attempts++;
  if (attempts >= ATTEMPTS_PER_SERVER) {
    serverIndex = (serverIndex + 1) % BLITZORTUNG_SERVERS.length;
    attempts = 0;
  }
}

function scheduleReconnect() {
  if (reconnectTimer || subscribers.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

function connect() {
  if (ws || subscribers.size === 0 || typeof WebSocket === 'undefined') return;
  const url = BLITZORTUNG_SERVERS[serverIndex];
  let socket;
  try {
    socket = new WebSocket(url);
  } catch (err) {
    console.error(`[LightningFeed] cannot open ${url}:`, err);
    noteFailure();
    scheduleReconnect();
    return;
  }
  ws = socket;
  socket.onopen = () => {
    connected = true;
    attempts = 0;
    try {
      socket.send(JSON.stringify({ a: WS_KEY }));
    } catch {}
  };
  socket.onmessage = (event) => {
    try {
      const strike = parseStrikeMessage(JSON.parse(lzwDecode(event.data)));
      if (strike) queue(strike);
    } catch (err) {
      console.error('[LightningFeed] bad message:', err);
    }
  };
  socket.onerror = () => {
    noteFailure();
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    connected = false;
    noteFailure();
    scheduleReconnect();
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const socket = ws;
  ws = null;
  connected = false;
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {}
  }
}

/**
 * Receive batches of new strikes. Opens the shared socket on the first
 * subscription and closes it after the last unsubscribe.
 * @param {(strikes: object[]) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeStrikes(fn) {
  subscribers.add(fn);
  if (subscribers.size === 1) connect();
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) disconnect();
  };
}

/**
 * Deliver a synthetic strike to every subscriber right away (no socket
 * needed). Marked `simulated: true` so consumers can label it.
 * @returns {object} the strike
 */
export function injectStrike({ lat, lon, timestamp = Date.now(), intensity = 25, polarity = 'negative' } = {}) {
  const strike = {
    id: `sim_${timestamp}_${++simCounter}`,
    lat: Number(lat),
    lon: Number(lon),
    timestamp,
    intensity,
    polarity,
    altitude: 0,
    signal: 0,
    simulated: true,
  };
  if (!Number.isFinite(strike.lat) || !Number.isFinite(strike.lon)) return null;
  deliver([strike]);
  return strike;
}

/** Debug/status snapshot. */
export function getFeedStatus() {
  return { connected, subscribers: subscribers.size, server: BLITZORTUNG_SERVERS[serverIndex] };
}

/** Test helper: drop the socket, timers and subscribers. */
export function _resetFeedForTests() {
  subscribers.clear();
  disconnect();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pending = [];
  serverIndex = 0;
  attempts = 0;
}
