'use strict';
/**
 * kiwi-connection.js — one KiwiSDR audio-channel WebSocket, kept alive.
 *
 * Wraps the handshake kiwiclient performs:
 *   open ws://host:port/kiwi/<ts>/SND
 *   → "SET auth t=kiwi p=<pw>"
 *   ← MSG badp=0 … MSG audio_rate=12000      → "SET AR OK in=12000 out=44100"
 *   ← MSG sample_rate=12001.xx               → setup commands (mode/freq/agc/…)
 *   ← SND frames (flags, seq, S-meter, audio) → 'smeter' events
 *   every keepaliveMs                        → "SET keepalive"
 *
 * One socket at a time — a KiwiSDR counts each socket as a user, and most
 * public receivers allow a handful. close() before connect() is enforced.
 *
 * Reconnects with exponential backoff (minMs … maxMs, ×2) after any drop,
 * and with the maximum backoff after a definitive rejection (bad password,
 * user limit, receiver down) so a misconfigured monitor does not hammer a
 * stranger's receiver.
 *
 * Events: 'open', 'ready' ({sampleRate}), 'smeter' ({dbm, t, seq}),
 *         'audio' ({pcm: Buffer s16be, seq, sampleRate, dbm}) — only when listened to,
 *         'msg' (params), 'rejected' ({event, reason}), 'close' ({code, reason}),
 *         'error' (err), 'reconnect' ({inMs, attempt}).
 */

const EventEmitter = require('events');
const proto = require('./kiwi-protocol');

function loadWebSocket() {
  try {
    return require('ws');
  } catch (e) {
    return null;
  }
}

class KiwiConnection extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.host = String(opts.host || '').trim();
    this.port = Number(opts.port) || 8073;
    this.password = opts.password == null ? '' : String(opts.password);
    this.ident = opts.ident || 'OpenHamClock';
    this.secure = !!opts.secure;
    this.keepaliveMs = opts.keepaliveMs || 5000;
    this.connectTimeoutMs = opts.connectTimeoutMs || 10000;
    this.reconnect = { enabled: true, minMs: 2000, maxMs: 120000, ...(opts.reconnect || {}) };
    this.WebSocketImpl = opts.WebSocketImpl || loadWebSocket();
    this.log = opts.log || (() => {});

    this.ws = null;
    this.state = 'idle'; // idle | connecting | auth | ready | closed
    this.sampleRate = null;
    this.tuning = opts.tuning || { freqKHz: 14100, mode: 'cw', lowCut: 300, highCut: 700 };
    this.lastError = null;
    this.lastRejection = null;
    this.attempt = 0;
    this.framesRx = 0;
    this.lastFrameAt = 0;

    this._keepaliveTimer = null;
    this._reconnectTimer = null;
    this._connectTimer = null;
    this._closedByUser = false;
  }

  get connected() {
    return this.state === 'ready';
  }

  get url() {
    return proto.audioSocketUrl(this.host, this.port, { secure: this.secure });
  }

  connect() {
    if (!this.WebSocketImpl) {
      this.lastError = 'ws module not available';
      this.emit('error', new Error(this.lastError));
      return false;
    }
    if (!this.host) {
      this.lastError = 'no Kiwi host configured';
      this.emit('error', new Error(this.lastError));
      return false;
    }
    this._closedByUser = false;
    this._clearReconnect();
    this._teardownSocket();

    let url;
    try {
      url = this.url;
    } catch (e) {
      this.lastError = e.message;
      this.emit('error', e);
      return false;
    }

    this.state = 'connecting';
    this.attempt += 1;
    this.log(`connecting to ${url} (attempt ${this.attempt})`);

    let ws;
    try {
      ws = new this.WebSocketImpl(url, { handshakeTimeout: this.connectTimeoutMs });
    } catch (e) {
      this.lastError = e.message;
      this.emit('error', e);
      this._scheduleReconnect();
      return false;
    }
    this.ws = ws;
    if (typeof ws.binaryType !== 'undefined') ws.binaryType = 'nodebuffer';

    this._connectTimer = setTimeout(() => {
      if (this.state === 'connecting' || this.state === 'auth') {
        this.lastError = 'connect timeout';
        this.log('timed out waiting for the Kiwi handshake');
        this._dropAndReconnect();
      }
    }, this.connectTimeoutMs + 5000);

    ws.on('open', () => {
      this.state = 'auth';
      this.emit('open');
      this._send(proto.cmd.auth(this.password));
    });
    ws.on('message', (data, isBinary) => this._onMessage(data, isBinary));
    ws.on('error', (err) => {
      this.lastError = err && err.message ? err.message : String(err);
      this.emit('error', err);
    });
    ws.on('close', (code, reason) => {
      const wasReady = this.state === 'ready';
      this._stopKeepalive();
      if (this._connectTimer) clearTimeout(this._connectTimer);
      this._connectTimer = null;
      this.ws = null;
      if (this.state !== 'closed') this.state = 'idle';
      this.emit('close', { code, reason: reason ? reason.toString() : '', wasReady });
      if (!this._closedByUser) this._scheduleReconnect(this.lastRejection ? this.reconnect.maxMs : null);
    });
    return true;
  }

  /** Change the receiver's mode/passband/frequency. Remembered across reconnects. */
  tune(freqKHz, { mode, lowCut, highCut } = {}) {
    this.tuning = {
      freqKHz,
      mode: mode || this.tuning.mode || 'cw',
      lowCut: lowCut != null ? lowCut : this.tuning.lowCut,
      highCut: highCut != null ? highCut : this.tuning.highCut,
    };
    if (this.state !== 'ready') return false;
    return this._send(proto.cmd.tune(this.tuning));
  }

  /** Intentional shutdown — no reconnect. */
  close() {
    this._closedByUser = true;
    this.state = 'closed';
    this._clearReconnect();
    this._teardownSocket();
  }

  // ─── internals ──────────────────────────────────────────────────────────

  _send(text) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    try {
      ws.send(text);
      return true;
    } catch (e) {
      this.lastError = e.message;
      return false;
    }
  }

  _onMessage(data, isBinary) {
    const frame = proto.parseFrame(isBinary === false && typeof data === 'string' ? data : data);
    if (!frame) return;
    this.framesRx++;
    this.lastFrameAt = Date.now();

    if (frame.type === 'SND') {
      if (frame.rssiDbm == null) return;
      this.emit('smeter', { dbm: frame.rssiDbm, t: this.lastFrameAt, seq: frame.seq, flags: frame.flags });
      // Raw audio — only built when someone listens (the beacon monitor
      // doesn't). setupCommands() sends compression=0, so the payload is
      // 16-bit big-endian mono PCM at this.sampleRate (≈ 12 kHz).
      if (frame.audio && frame.audio.length >= 2 && this.listenerCount('audio') > 0) {
        this.emit('audio', { pcm: frame.audio, seq: frame.seq, sampleRate: this.sampleRate, dbm: frame.rssiDbm });
      }
      return;
    }
    if (frame.type !== 'MSG') return;

    this.emit('msg', frame.params);
    const ev = proto.classifyMsg(frame.params);
    if (!ev) return;

    switch (ev.event) {
      case 'badp':
      case 'too_busy':
      case 'down':
        this.lastRejection = { event: ev.event, reason: ev.reason, at: Date.now() };
        this.lastError = ev.reason;
        this.log(`rejected by Kiwi: ${ev.reason}`);
        this.emit('rejected', ev);
        this._teardownSocket();
        if (!this._closedByUser) this._scheduleReconnect(this.reconnect.maxMs);
        break;
      case 'redirect':
        this.lastError = `Kiwi redirects to ${ev.url}`;
        this.emit('rejected', { event: 'redirect', reason: this.lastError });
        this._teardownSocket();
        if (!this._closedByUser) this._scheduleReconnect(this.reconnect.maxMs);
        break;
      case 'audio_rate':
        this._send(proto.cmd.arOk(ev.rate || 12000, 44100));
        break;
      case 'sample_rate':
        this.sampleRate = ev.rate;
        this.lastRejection = null;
        this.attempt = 0;
        for (const c of proto.setupCommands({ ...this.tuning, ident: this.ident })) this._send(c);
        this.state = 'ready';
        if (this._connectTimer) clearTimeout(this._connectTimer);
        this._connectTimer = null;
        this._startKeepalive();
        this.log(`ready (sample rate ${ev.rate})`);
        this.emit('ready', { sampleRate: ev.rate });
        break;
      case 'inactivity':
        this.log(`Kiwi inactivity timeout notice: ${ev.seconds}s`);
        break;
      default:
        break;
    }
  }

  _startKeepalive() {
    this._stopKeepalive();
    this._keepaliveTimer = setInterval(() => this._send(proto.cmd.keepalive()), this.keepaliveMs);
    if (this._keepaliveTimer.unref) this._keepaliveTimer.unref();
  }

  _stopKeepalive() {
    if (this._keepaliveTimer) clearInterval(this._keepaliveTimer);
    this._keepaliveTimer = null;
  }

  _teardownSocket() {
    this._stopKeepalive();
    if (this._connectTimer) clearTimeout(this._connectTimer);
    this._connectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.removeAllListeners('close');
        ws.on('error', () => {});
        ws.close();
      } catch (e) {
        try {
          ws.terminate();
        } catch (e2) {}
      }
      // A socket whose close handler we removed never reaches 'close'; keep
      // state coherent so connect() can be scheduled again.
      if (this.state !== 'closed') this.state = 'idle';
    }
  }

  _dropAndReconnect() {
    this._teardownSocket();
    if (!this._closedByUser) this._scheduleReconnect();
  }

  _clearReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  _scheduleReconnect(fixedMs = null) {
    if (!this.reconnect.enabled || this._closedByUser || this._reconnectTimer) return;
    const { minMs, maxMs } = this.reconnect;
    const backoff = fixedMs != null ? fixedMs : Math.min(maxMs, minMs * Math.pow(2, Math.max(0, this.attempt - 1)));
    const jitter = Math.round(backoff * 0.1 * Math.random());
    const inMs = backoff + jitter;
    this.emit('reconnect', { inMs, attempt: this.attempt });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._closedByUser) this.connect();
    }, inMs);
    if (this._reconnectTimer.unref) this._reconnectTimer.unref();
  }
}

module.exports = { KiwiConnection };
