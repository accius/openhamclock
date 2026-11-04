'use strict';
/**
 * ServerLightningFeed — the server's own view of the Blitzortung.org strike
 * stream, used to VERIFY lightning reports before pushing them to anyone but
 * the sender (server/routes/push.js).
 *
 * One WebSocket, opened only while at least one push subscription has opted in
 * to lightning (setActive), closed otherwise. Reconnects with exponential
 * backoff (5 s → 5 min), rotating through the Blitzortung servers.
 *
 * Bounded memory: strikes are kept only when they fall in a 1°×1° cell near an
 * opted-in subscriber (setWatchAreas), only for RETENTION_MS, and at most
 * MAX_STRIKES in total (oldest dropped first).
 *
 * Parsing comes from the shared guard core (lightning-guard-logic.js, generated
 * from src/utils/lightningGuard.js).
 */

const core = require('./lightning-guard-logic');

const RETENTION_MS = 15 * 60 * 1000;
const MAX_STRIKES = 20000;
const BACKOFF_MIN_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
/** A report matches a strike seen here within these tolerances. */
const MATCH_KM = 5;
const MATCH_MS = 30 * 1000;
/** How long verify() waits for a strike the server has not seen yet. */
const VERIFY_WAIT_MS = 8000;

const cellKey = (lat, lon) => `${Math.floor(lat)},${(((Math.floor(lon) + 180) % 360) + 360) % 360}`;

/**
 * 1°×1° cell keys covering a circle of `radiusKm` around (lat, lon), plus one
 * cell of margin.
 */
function cellsAround(lat, lon, radiusKm) {
  const out = new Set();
  const dLat = radiusKm / 111 + 1;
  const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const dLon = Math.min(180, radiusKm / (111 * cos) + 1);
  for (let la = Math.floor(lat - dLat); la <= Math.floor(lat + dLat); la++) {
    if (la < -90 || la > 89) continue;
    for (let lo = Math.floor(lon - dLon); lo <= Math.floor(lon + dLon); lo++) out.add(cellKey(la, lo));
  }
  return out;
}

function loadWebSocket() {
  try {
    return require('ws');
  } catch (e) {
    return null;
  }
}

class ServerLightningFeed {
  constructor({ WebSocketImpl, now = () => Date.now(), log = () => {} } = {}) {
    this.WebSocketImpl = WebSocketImpl === undefined ? loadWebSocket() : WebSocketImpl;
    this.now = now;
    this.log = log;
    this.active = false;
    this.ws = null;
    this.connected = false;
    this.serverIndex = 0;
    this.backoffMs = BACKOFF_MIN_MS;
    this.reconnectTimer = null;
    this.cells = new Set(); // watched cell keys
    this.byCell = new Map(); // cell → strikes (oldest first)
    this.count = 0;
    this.waiters = new Set(); // pending verify() calls
    this.received = 0;
    this.lastPrune = 0;
  }

  /** Watch areas: [{ lat, lon, radiusKm }] — strikes elsewhere are ignored. */
  setWatchAreas(areas) {
    const cells = new Set();
    for (const a of areas || []) {
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
      for (const c of cellsAround(a.lat, a.lon, (a.radiusKm || 50) + MATCH_KM)) cells.add(c);
    }
    this.cells = cells;
    for (const key of [...this.byCell.keys()]) {
      if (!cells.has(key)) {
        this.count -= this.byCell.get(key).length;
        this.byCell.delete(key);
      }
    }
  }

  /** Open the socket while there is something to watch; close it otherwise. */
  setActive(on) {
    if (on && !this.active) {
      this.active = true;
      this.backoffMs = BACKOFF_MIN_MS;
      this.connect();
    } else if (!on && this.active) {
      this.active = false;
      this.disconnect();
      this.byCell.clear();
      this.count = 0;
    }
  }

  connect() {
    if (!this.active || this.ws || !this.WebSocketImpl) return;
    const url = core.BLITZORTUNG_SERVERS[this.serverIndex];
    let ws;
    try {
      ws = new this.WebSocketImpl(url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.backoffMs = BACKOFF_MIN_MS;
      this.log(`[LightningFeed] connected to ${url}`);
      try {
        ws.send(JSON.stringify({ a: core.BLITZORTUNG_KEY }));
      } catch (e) {}
    };
    ws.onmessage = (event) => {
      try {
        const strike = core.parseStrikeMessage(JSON.parse(core.lzwDecode(String(event.data))));
        if (strike) this.add(strike);
      } catch (e) {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.connected = false;
      this.serverIndex = (this.serverIndex + 1) % core.BLITZORTUNG_SERVERS.length;
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (!this.active || this.reconnectTimer) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch (e) {}
    }
  }

  /** Store one strike (from the socket, or injected by tests). */
  add(strike) {
    this.received++;
    const key = cellKey(strike.lat, strike.lon);
    if (!this.cells.has(key)) return false;
    let list = this.byCell.get(key);
    if (!list) this.byCell.set(key, (list = []));
    list.push({ lat: strike.lat, lon: strike.lon, timestamp: strike.timestamp });
    this.count++;
    // Expiry sweeps at most once a second; the cap is enforced every time
    const now = this.now();
    if (now - this.lastPrune >= 1000 || this.count > MAX_STRIKES) {
      this.lastPrune = now;
      this.prune();
    }
    for (const w of this.waiters) w(strike);
    return true;
  }

  prune() {
    const cutoff = this.now() - RETENTION_MS;
    for (const [key, list] of this.byCell) {
      let drop = 0;
      while (drop < list.length && list[drop].timestamp < cutoff) drop++;
      if (drop) {
        list.splice(0, drop);
        this.count -= drop;
      }
      if (!list.length) this.byCell.delete(key);
    }
    while (this.count > MAX_STRIKES) {
      // drop the oldest strike overall
      let oldestKey = null;
      let oldest = Infinity;
      for (const [key, list] of this.byCell) {
        if (list[0].timestamp < oldest) {
          oldest = list[0].timestamp;
          oldestKey = key;
        }
      }
      const list = this.byCell.get(oldestKey);
      list.shift();
      this.count--;
      if (!list.length) this.byCell.delete(oldestKey);
    }
  }

  /** A strike this server saw matching `report` ({ lat, lon, timestamp }), or null. */
  match(report) {
    const near = (s) =>
      Math.abs(s.timestamp - report.timestamp) <= MATCH_MS &&
      core.haversineKm(s.lat, s.lon, report.lat, report.lon) <= MATCH_KM;
    for (const key of cellsAround(report.lat, report.lon, MATCH_KM)) {
      const list = this.byCell.get(key);
      if (!list) continue;
      for (const s of list) if (near(s)) return s;
    }
    return null;
  }

  /**
   * Resolve with the matching strike, waiting up to `waitMs` for it to arrive
   * (the reporting browser and this server receive the same strike at about
   * the same time). Resolves null when unverifiable (no match, or the feed is
   * not running).
   */
  verify(report, waitMs = VERIFY_WAIT_MS) {
    const hit = this.match(report);
    if (hit) return Promise.resolve(hit);
    if (!this.active || !this.WebSocketImpl) return Promise.resolve(null);
    return new Promise((resolve) => {
      const done = (value) => {
        this.waiters.delete(onStrike);
        clearTimeout(timer);
        resolve(value);
      };
      const onStrike = () => {
        const m = this.match(report);
        if (m) done(m);
      };
      const timer = setTimeout(() => done(null), waitMs);
      if (timer.unref) timer.unref();
      this.waiters.add(onStrike);
    });
  }

  getStatus() {
    return {
      active: this.active,
      connected: this.connected,
      server: core.BLITZORTUNG_SERVERS[this.serverIndex],
      watchedCells: this.cells.size,
      stored: this.count,
      received: this.received,
    };
  }
}

module.exports = { ServerLightningFeed, cellsAround, cellKey, MATCH_KM, MATCH_MS, RETENTION_MS, MAX_STRIKES };
