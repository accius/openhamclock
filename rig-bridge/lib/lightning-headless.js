'use strict';
/**
 * lightning-headless.js — the lightning guard running inside Rig Bridge, so
 * the antenna relay is protected with no browser open.
 *
 * Subscribes to the Blitzortung.org WebSocket itself (the `ws` package), feeds
 * the strikes to the same guard logic the browser uses
 * (lightning-guard-logic.js, generated from src/utils/lightningGuard.js) and
 * reports { level, relay } to the GPIO plugin, which treats it as one more
 * reporter in its LightningRelayArbiter.
 *
 * Settings (config.gpio.lightningHeadless):
 *   enabled, lat, lon, warnKm, alarmKm, allClearMin, minStrikes, hysteresisPct,
 *   repeatCloser, relayOn: 'alarm' | 'warn'
 * Everything but `enabled` follows the displays: each one that drives the relay
 * sends its guard settings and location with its indicators, and the GPIO
 * plugin applies changes (setSettings) and saves them.
 */

const core = require('./lightning-guard-logic');

const FLUSH_MS = 1000;
const TICK_MS = 15000;
const RECONNECT_MS = 5000;
const ATTEMPTS_PER_SERVER = 3;

function loadWebSocket() {
  try {
    return require('ws');
  } catch (e) {
    return null;
  }
}

class HeadlessLightningGuard {
  /**
   * @param {object} opts
   * @param {object} opts.settings           config.gpio.lightningHeadless
   * @param {(status: object) => void} opts.onStatus   called after every evaluation
   * @param {Function} [opts.log]
   * @param {Function} [opts.WebSocketImpl]  injectable for tests (default: ws)
   * @param {() => number} [opts.now]
   */
  constructor({ settings, onStatus, log = () => {}, WebSocketImpl, now = () => Date.now() } = {}) {
    this.onStatus = onStatus || (() => {});
    this.log = log;
    this.WebSocketImpl = WebSocketImpl === undefined ? loadWebSocket() : WebSocketImpl;
    this.now = now;
    this.ws = null;
    this.connected = false;
    this.serverIndex = 0;
    this.attempts = 0;
    this.pending = [];
    this.flushTimer = null;
    this.tickTimer = null;
    this.reconnectTimer = null;
    this.running = false;
    this.lastStatus = null;
    this.simCounter = 0;
    this.setSettings(settings);
  }

  setSettings(raw) {
    const h = raw && typeof raw === 'object' ? raw : {};
    const lat = Number(h.lat);
    const lon = Number(h.lon);
    this.de =
      h.lat !== '' && h.lat != null && h.lon !== '' && h.lon != null && Number.isFinite(lat) && Number.isFinite(lon)
        ? { lat, lon }
        : null;
    this.relayOn = h.relayOn === 'warn' ? 'warn' : 'alarm';
    this.settings = core.normalizeGuardSettings({ ...h, enabled: true, relay: { enabled: true, on: this.relayOn } });
    if (this.runner) this.runner.setSettings(this.settings);
    else this.runner = new core.GuardRunner(this.settings);
    // A location arriving later (from a display's report) starts the watch
    if (this.running && this.de && !this.ws) this.connect();
    if (this.running && !this.de && this.ws) {
      const ws = this.ws;
      this.ws = null;
      this.connected = false;
      ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch (e) {}
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (!this.de) this.log('Headless lightning guard: no location (lat/lon) configured — not watching');
    else this.log(`Headless lightning guard watching ${this.settings.warnKm}/${this.settings.alarmKm} km`);
    this.evaluate([]);
    this.tickTimer = setInterval(() => this.evaluate([]), TICK_MS);
    if (this.de) this.connect();
  }

  stop() {
    this.running = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.tickTimer = this.flushTimer = this.reconnectTimer = null;
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

  connect() {
    if (!this.running || this.ws || !this.WebSocketImpl) {
      if (!this.WebSocketImpl && this.running) this.log('Headless lightning guard: `ws` module missing');
      return;
    }
    const url = core.BLITZORTUNG_SERVERS[this.serverIndex];
    let ws;
    try {
      ws = new this.WebSocketImpl(url);
    } catch (e) {
      this.failure();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.attempts = 0;
      try {
        ws.send(JSON.stringify({ a: core.BLITZORTUNG_KEY }));
      } catch (e) {}
    };
    ws.onmessage = (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : String(event.data);
        const strike = core.parseStrikeMessage(JSON.parse(core.lzwDecode(raw)));
        if (strike) this.queue(strike);
      } catch (e) {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.connected = false;
      this.failure();
    };
  }

  failure() {
    this.attempts++;
    if (this.attempts >= ATTEMPTS_PER_SERVER) {
      this.serverIndex = (this.serverIndex + 1) % core.BLITZORTUNG_SERVERS.length;
      this.attempts = 0;
    }
    if (this.running && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, RECONNECT_MS);
    }
  }

  queue(strike) {
    this.pending.push(strike);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const batch = this.pending;
        this.pending = [];
        this.evaluate(batch);
      }, FLUSH_MS);
    }
  }

  evaluate(batch) {
    const now = this.now();
    const { status, transition, closer } = this.de
      ? this.runner.step(batch, this.de, now)
      : { status: { level: 'clear', nearest: null, last: null }, transition: null, closer: false };
    const relay = core.relayDemand({ settings: this.settings, level: status.level });
    this.lastStatus = { ...status, relay: !!relay, settings: this.settings, at: now };
    if (transition) {
      const where = core.describeStrike(status.nearest);
      this.log(`Headless lightning guard: ${status.level}${where ? ` (nearest ${where})` : ''}`);
    } else if (closer) {
      this.log(`Headless lightning guard: closer — ${core.describeStrike(status.nearest)}`);
    }
    this.onStatus(this.lastStatus, { transition, closer });
    return this.lastStatus;
  }

  /** Synthetic strike relative to the configured location (or at lat/lon). */
  injectStrike({ distanceKm, bearingDeg, lat, lon } = {}) {
    let point = null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) point = { lat, lon };
    else if (this.de) {
      point = core.destinationPoint(
        this.de.lat,
        this.de.lon,
        Number.isFinite(distanceKm) ? distanceKm : 10,
        Number.isFinite(bearingDeg) ? bearingDeg : 45,
      );
    }
    if (!point) return null;
    const now = this.now();
    const strike = {
      id: `sim_${now}_${++this.simCounter}`,
      lat: point.lat,
      lon: point.lon,
      timestamp: now,
      simulated: true,
    };
    this.evaluate([strike]);
    return strike;
  }

  getStatus() {
    const st = this.lastStatus;
    return {
      running: this.running,
      watching: !!this.de,
      connected: this.connected,
      server: core.BLITZORTUNG_SERVERS[this.serverIndex],
      level: st ? st.level : 'clear',
      relay: st ? st.relay : false,
      nearest: st && st.nearest ? core.describeStrike(st.nearest) : null,
      lastStrikeAt: st && st.last ? st.last.timestamp : null,
      clearAt: st ? st.clearAt : null,
      warnKm: this.settings.warnKm,
      alarmKm: this.settings.alarmKm,
      allClearMin: this.settings.allClearMin,
      minStrikes: this.settings.minStrikes,
      hysteresisPct: this.settings.hysteresisPct,
      repeatCloser: this.settings.repeatCloser,
      relayOn: this.relayOn,
    };
  }
}

module.exports = { HeadlessLightningGuard };
