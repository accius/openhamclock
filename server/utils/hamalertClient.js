'use strict';
/**
 * hamalert-client.js — persistent telnet client for HamAlert
 * (hamalert.org:7300). Shared verbatim with rig-bridge/lib/hamalert-client.js.
 *
 * Lifecycle: connect → answer "login:" / "password:" → stream "DX de
 * HAMALERT:" lines → parse → onAlert(alert). Reconnects with exponential
 * backoff (5 s … 5 min, jittered) on close/error, and writes a bare
 * newline every few minutes so idle sessions aren't dropped. One
 * connection per process, never poll-and-disconnect.
 *
 * Credentials are only ever written to the socket; log lines never carry
 * them.
 */

const net = require('net');
const { parseHamAlertLine, isLoginPrompt, isPasswordPrompt, isWelcomeLine } = require('./hamalertParser');

const DEFAULT_HOST = 'hamalert.org';
const DEFAULT_PORT = 7300;
const BACKOFF_MIN_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const KEEPALIVE_MS = 4 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 20000;

function createHamAlertClient(opts) {
  const host = opts.host || DEFAULT_HOST;
  const port = Number(opts.port) || DEFAULT_PORT;
  const username = String(opts.username || '').trim();
  const password = String(opts.password || '');
  const onAlert = typeof opts.onAlert === 'function' ? opts.onAlert : () => {};
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
  const log = typeof opts.log === 'function' ? opts.log : () => {};

  let socket = null;
  let buffer = '';
  let stopped = true;
  let connected = false;
  let loggedIn = false;
  let reconnectTimer = null;
  let keepaliveTimer = null;
  let attempts = 0;
  let lastError = null;
  let lastAlertAt = null;
  let lastLineAt = null;
  let alertsTotal = 0;
  let connectedAt = null;

  function status() {
    return {
      enabled: !!username,
      connected,
      loggedIn,
      host,
      port,
      username,
      attempts,
      lastError,
      lastAlertAt,
      lastLineAt,
      alertsTotal,
      connectedAt,
    };
  }

  function emitStatus() {
    try {
      onStatus(status());
    } catch {}
  }

  function clearTimers() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  function scheduleReconnect(reason) {
    if (stopped) return;
    attempts += 1;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * Math.pow(2, Math.min(attempts - 1, 6)));
    const delay = base + Math.round(Math.random() * 3000);
    log(`[HamAlert] ${reason} — reconnecting in ${Math.round(delay / 1000)} s (attempt ${attempts})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function handleLine(line) {
    lastLineAt = Date.now();
    if (!line.trim()) return;
    if (!loggedIn) {
      if (isLoginPrompt(line)) {
        socket.write(`${username}\r\n`);
        return;
      }
      if (isPasswordPrompt(line)) {
        socket.write(`${password}\r\n`);
        return;
      }
      if (isWelcomeLine(line)) {
        loggedIn = true;
        attempts = 0;
        lastError = null;
        log(`[HamAlert] Logged in as ${username}`);
        emitStatus();
        return;
      }
      if (/invalid|incorrect|unknown user|denied|failed/i.test(line)) {
        lastError = 'Login rejected — check HamAlert username/password';
        log(`[HamAlert] ${lastError}`);
        emitStatus();
        return;
      }
    }
    const alert = parseHamAlertLine(line);
    if (alert) {
      // A spot line proves the session is live even without a greeting.
      if (!loggedIn) {
        loggedIn = true;
        attempts = 0;
        emitStatus();
      }
      alertsTotal += 1;
      lastAlertAt = Date.now();
      try {
        onAlert(alert);
      } catch (e) {
        log(`[HamAlert] onAlert handler error: ${e.message}`);
      }
    }
  }

  function onData(chunk) {
    buffer += chunk.toString('utf8');
    // Prompts arrive without a newline — treat a trailing "login:"/"password:" as a line.
    let idx;
    while ((idx = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n/, '');
      handleLine(line);
    }
    if (buffer.length && (isLoginPrompt(buffer) || isPasswordPrompt(buffer))) {
      const prompt = buffer;
      buffer = '';
      handleLine(prompt);
    }
    if (buffer.length > 4096) buffer = buffer.slice(-1024);
  }

  function open() {
    if (stopped || socket) return;
    buffer = '';
    loggedIn = false;
    log(`[HamAlert] Connecting to ${host}:${port}…`);
    const s = net.createConnection({ host, port });
    socket = s;
    s.setTimeout(CONNECT_TIMEOUT_MS);
    s.setKeepAlive(true, 60000);
    s.setEncoding('utf8');
    s.once('connect', () => {
      connected = true;
      connectedAt = Date.now();
      s.setTimeout(0);
      emitStatus();
      keepaliveTimer = setInterval(() => {
        try {
          if (connected) s.write('\r\n');
        } catch {}
      }, KEEPALIVE_MS);
    });
    s.on('data', onData);
    s.once('timeout', () => {
      lastError = 'Connection timed out';
      s.destroy();
    });
    s.once('error', (err) => {
      lastError = err.message;
      log(`[HamAlert] Socket error: ${err.message}`);
    });
    s.once('close', () => {
      const wasConnected = connected;
      connected = false;
      loggedIn = false;
      socket = null;
      clearTimers();
      emitStatus();
      scheduleReconnect(wasConnected ? 'Connection closed' : 'Connect failed');
    });
  }

  return {
    connect() {
      if (!username) {
        lastError = 'No HamAlert username configured';
        emitStatus();
        return false;
      }
      stopped = false;
      attempts = 0;
      open();
      return true;
    },
    disconnect() {
      stopped = true;
      clearTimers();
      if (socket) {
        try {
          socket.destroy();
        } catch {}
        socket = null;
      }
      connected = false;
      loggedIn = false;
      emitStatus();
    },
    getStatus: status,
  };
}

module.exports = { createHamAlertClient, DEFAULT_HOST, DEFAULT_PORT };
