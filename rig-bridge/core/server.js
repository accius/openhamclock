'use strict';
/**
 * server.js — Express HTTP server, all API routes, SSE endpoint, and live log
 *
 * Exposes the openhamclock-compatible API:
 *   GET  /             Setup UI (HTML) or JSON health check
 *   GET  /health       Diagnostic endpoint (auth, plugin, ptt status)
 *   GET  /status       Current rig state snapshot
 *   GET  /stream       SSE stream for real-time state updates
 *   POST /freq         Set frequency  { freq: Hz }
 *   POST /mode         Set mode       { mode: string }
 *   POST /ptt          Set PTT        { ptt: boolean }
 *   GET  /api/ports    List available serial ports
 *   GET  /api/config   Get current config
 *   POST /api/config   Update config and reconnect
 *   POST /api/test     Test a serial port connection
 *   GET  /api/log/stream  SSE stream of live console log output
 *   GET  /api/logging     Get console logging enabled state
 *   POST /api/logging     Enable or disable console log capture { logging: bool }
 */

const express = require('express');
const cors = require('cors');
const { getSerialPort, listPorts } = require('./serial-utils');
const { state, addSseClient, removeSseClient, getDecodeRingBuffer, getSseClientCount } = require('./state');
const { config, saveConfig, CONFIG_PATH } = require('./config');
const tlsModule = require('./tls');

// ─── Security helpers ─────────────────────────────────────────────────────

/**
 * isValidRemoteHost — reject URL schemes, path separators, and anything that
 * could be used for SSRF or injection. Allows localhost, IPv4, bracketed IPv6,
 * and plain hostnames / FQDNs.
 */
function isValidRemoteHost(h) {
  if (!h || typeof h !== 'string') return false;
  if (/[/:]{2}|[/\\]/.test(h)) return false; // reject URLs and paths
  return /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[\da-fA-F:]+\]|[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*)$/.test(
    h,
  );
}

function isValidPort(p) {
  return Number.isInteger(p) && p >= 1 && p <= 65535;
}

/** Sliding-window in-memory rate limiter. Returns a middleware factory. */
function makeRateLimiter(maxRequests, windowMs) {
  const hits = new Map(); // IP → [timestamps]
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const window = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    window.push(now);
    hits.set(ip, window);
    if (window.length > maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

// ─── Console log interceptor ───────────────────────────────────────────────
// Wraps console.log/warn/error so every line is buffered and broadcast
// to connected SSE log clients in addition to the normal stdout output.

const LOG_BUFFER_MAX = 200; // lines kept in memory for late-joining clients
const logBuffer = []; // { ts, level, text }
let logSseClients = []; // { id, res }

function broadcastLog(entry) {
  // Named SSE event "line" so the browser can use addEventListener('line', ...)
  const msg = `event: line\ndata: ${JSON.stringify(entry)}\n\n`;
  logSseClients.forEach((c) => c.res.write(msg));
}

function pushLog(level, args) {
  if (!config.logging) return; // logging disabled — skip capture & broadcast
  const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const entry = { ts: Date.now(), level, text };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  broadcastLog(entry);
}

// Patch console — keep originals for actual stdout output
const _log = console.log.bind(console);
const _warn = console.warn.bind(console);
const _error = console.error.bind(console);

console.log = (...args) => {
  _log(...args);
  pushLog('log', args);
};
console.warn = (...args) => {
  _warn(...args);
  pushLog('warn', args);
};
console.error = (...args) => {
  _error(...args);
  pushLog('error', args);
};

// ──────────────────────────────────────────────────────────────────────────

function buildSetupHtml(version, firstRunToken = null) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenHamClock Rig Bridge v${version}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0a0e14;
      color: #c4c9d4;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px 15px;
    }
    .container { max-width: 600px; width: 100%; }
    .header {
      text-align: center;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 24px;
      color: #00ffcc;
      margin-bottom: 6px;
    }
    .header .subtitle {
      font-size: 13px;
      color: #6b7280;
    }
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 12px;
      background: #111620;
      border: 1px solid #1e2530;
      border-radius: 8px;
      margin-bottom: 20px;
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      font-size: 13px;
    }
    .status-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      background: #ef4444;
    }
    .status-dot.connected { background: #22c55e; }
    .status-freq { color: #00ffcc; font-size: 16px; font-weight: 700; }
    .status-mode { color: #f59e0b; }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      border-bottom: 1px solid #1e2530;
      padding-bottom: 0;
    }
    .tab-btn {
      padding: 8px 18px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #6b7280;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: -1px;
      transition: color 0.15s, border-color 0.15s;
    }
    .tab-btn:hover { color: #c4c9d4; }
    .tab-btn.active { color: #00ffcc; border-bottom-color: #00ffcc; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ── Config tab ── */
    .card {
      background: #111620;
      border: 1px solid #1e2530;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 700;
      color: #f59e0b;
      margin-bottom: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    label {
      display: block;
      font-size: 12px;
      color: #8b95a5;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    select, input[type="number"], input[type="text"] {
      width: 100%;
      padding: 10px 12px;
      background: #0a0e14;
      border: 1px solid #2a3040;
      border-radius: 6px;
      color: #e2e8f0;
      font-size: 14px;
      font-family: inherit;
      margin-bottom: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    select:focus, input:focus { border-color: #00ffcc; }
    .row { display: flex; gap: 12px; }
    .row > div { flex: 1; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    }
    .btn-primary { background: #00ffcc; color: #0a0e14; }
    .btn-primary:hover { background: #00e6b8; }
    .btn-secondary {
      background: #1e2530;
      color: #c4c9d4;
      border: 1px solid #2a3040;
    }
    .btn-secondary:hover { background: #2a3040; }
    .btn-row { display: flex; gap: 10px; margin-top: 8px; }
    .btn-row .btn { flex: 1; }
    .toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      padding: 10px 20px; border-radius: 6px; font-size: 13px;
      opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 1000;
    }
    .toast.show { opacity: 1; }
    .toast.success { background: #166534; color: #bbf7d0; }
    .toast.error { background: #991b1b; color: #fecaca; }
    .help-text {
      font-size: 11px;
      color: #4b5563;
      margin-top: -8px;
      margin-bottom: 14px;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }
    .checkbox-row input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
    .checkbox-row span { font-size: 13px; color: #c4c9d4; }
    .serial-opts { display: none; }
    .serial-opts.show { display: block; }
    .legacy-opts { display: none; }
    .legacy-opts.show { display: block; }
    .section-divider {
      border-top: 1px solid #1e2530;
      margin: 16px 0;
      padding-top: 16px;
    }
    .icom-addr { display: none; }
    .icom-addr.show { display: block; }
    .tci-opts { display: none; }
    .tci-opts.show { display: block; }
    .smartsdr-opts { display: none; }
    .smartsdr-opts.show { display: block; }
    .rtltcp-opts { display: none; }
    .rtltcp-opts.show { display: block; }
    .ohc-instructions {
      background: #0f1923;
      border: 1px dashed #2a3040;
      border-radius: 8px;
      padding: 16px;
      margin-top: 20px;
      font-size: 13px;
      line-height: 1.6;
    }
    .ohc-instructions strong { color: #00ffcc; }
    .ohc-instructions code {
      background: #1a1f2a;
      padding: 2px 6px;
      border-radius: 3px;
      color: #f59e0b;
      font-family: monospace;
    }

    /* ── Console Log tab ── */
    .log-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .log-toolbar .log-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: opacity 0.15s;
    }
    .log-badge.active { opacity: 1; }
    .log-badge.inactive { opacity: 0.35; }
    .log-badge.lvl-log { background: #1e2d1e; color: #86efac; border-color: #166534; }
    .log-badge.lvl-warn { background: #2d2210; color: #fcd34d; border-color: #92400e; }
    .log-badge.lvl-error { background: #2d1010; color: #fca5a5; border-color: #991b1b; }
    .log-scroll-wrap {
      background: #060a0f;
      border: 1px solid #1e2530;
      border-radius: 8px;
      height: 420px;
      overflow-y: auto;
      padding: 10px 12px;
      font-family: 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.6;
    }
    .log-line {
      display: flex;
      gap: 10px;
      padding: 1px 0;
      border-bottom: 1px solid #0d1117;
    }
    .log-line:last-child { border-bottom: none; }
    .log-ts {
      color: #374151;
      white-space: nowrap;
      flex-shrink: 0;
      user-select: none;
    }
    .log-text { color: #9ca3af; word-break: break-all; flex: 1; }
    .log-line.lvl-log .log-text { color: #9ca3af; }
    .log-line.lvl-warn .log-text { color: #fcd34d; }
    .log-line.lvl-error .log-text { color: #fca5a5; }
    .log-empty {
      color: #374151;
      text-align: center;
      padding: 40px 0;
      font-style: italic;
    }
    .log-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 11px;
      color: #374151;
    }
    .log-footer .log-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .log-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #374151;
    }
    .log-dot.live { background: #22c55e; animation: pulse 1.5s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    @media (max-width: 500px) {
      .row { flex-direction: column; gap: 0; }
    }
    .page-footer {
      margin-top: 28px;
      text-align: center;
      font-size: 11px;
      color: #374151;
    }
    .page-footer a { color: #374151; text-decoration: none; }
    .page-footer a:hover { color: #6b7280; }

    /* ── Security / Auth ── */
    .login-overlay {
      position: fixed; inset: 0;
      background: rgba(10,14,20,0.97);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999;
    }
    .login-box {
      background: #111620;
      border: 1px solid #1e2530;
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 380px;
      text-align: center;
    }
    .login-box h2 { color: #00ffcc; margin-bottom: 8px; font-size: 20px; }
    .login-box p { color: #6b7280; font-size: 13px; margin-bottom: 20px; line-height: 1.5; }
    .token-input-row { display: flex; gap: 8px; margin-bottom: 12px; }
    .token-input-row input {
      flex: 1; padding: 10px 12px;
      background: #0a0e14; border: 1px solid #2a3040;
      border-radius: 6px; color: #e2e8f0; font-size: 14px;
      font-family: monospace; outline: none;
    }
    .token-input-row input:focus { border-color: #00ffcc; }
    @keyframes shake {
      0%,100% { transform: translateX(0); }
      20%,60% { transform: translateX(-8px); }
      40%,80% { transform: translateX(8px); }
    }
    .shake { animation: shake 0.4s ease; }
    .welcome-banner {
      position: fixed; inset: 0;
      background: rgba(10,14,20,0.97);
      display: flex; align-items: center; justify-content: center;
      z-index: 9998;
    }
    .welcome-box {
      background: #111620;
      border: 1px solid #00ffcc44;
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 460px;
      text-align: center;
    }
    .welcome-box h2 { color: #00ffcc; font-size: 22px; margin-bottom: 12px; }
    .welcome-box p { color: #9ca3af; font-size: 13px; margin-bottom: 16px; line-height: 1.6; }
    .token-display {
      display: flex; gap: 8px; align-items: center;
      background: #0a0e14; border: 1px solid #2a3040;
      border-radius: 6px; padding: 10px 12px; margin-bottom: 16px;
    }
    .token-display input {
      flex: 1; background: none; border: none; color: #00ffcc;
      font-family: monospace; font-size: 13px; outline: none;
    }
    .copy-btn {
      padding: 4px 10px; background: #1e2530; border: 1px solid #2a3040;
      border-radius: 4px; color: #9ca3af; font-size: 11px; cursor: pointer;
    }
    .copy-btn:hover { background: #2a3040; }
    .security-hint {
      font-size: 11px; color: #4b5563; margin-bottom: 20px; line-height: 1.5;
    }
    .logout-link {
      font-size: 11px; color: #374151; text-decoration: none; cursor: pointer;
    }
    .logout-link:hover { color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Login overlay (shown when token is set and user is not authenticated) -->
    <div class="login-overlay" id="loginOverlay" style="display:none;">
      <div class="login-box">
        <h2>🔒 Rig Bridge</h2>
        <p>Enter your API token to access the setup UI.</p>
        <div class="token-input-row" id="loginRow">
          <input type="password" id="loginToken" placeholder="Paste API token…" onkeydown="if(event.key==='Enter')doLogin()">
          <button class="btn btn-secondary" onclick="toggleLoginVisible()" style="width:auto;padding:8px 12px;" title="Show/hide">👁</button>
        </div>
        <button class="btn btn-primary" onclick="doLogin()" style="margin-top:4px;">Unlock Setup</button>
      </div>
    </div>

    <!-- First-run welcome banner (shown once to reveal the generated token) -->
    <div class="welcome-banner" id="welcomeBanner" style="display:none;">
      <div class="welcome-box">
        <h2>🎉 Welcome to Rig Bridge!</h2>
        <p>A unique API token has been generated to protect your setup. Copy it now and paste it into <strong>OpenHamClock → Settings → Rig Control → API Token</strong>.</p>
        <div class="token-display">
          <input type="text" id="welcomeToken" readonly>
          <button class="copy-btn" onclick="copyToken()">Copy</button>
        </div>
        <div class="security-hint">This token will not be shown again. Store it somewhere safe (e.g. your password manager).</div>
        <button class="btn btn-primary" onclick="dismissBanner()">I've copied it — Continue</button>
      </div>
    </div>

    <div class="header">
      <h1>📻 OpenHamClock Rig Bridge</h1>
      <div class="subtitle">Direct USB connection to your radio — no flrig or rigctld needed</div>
      <div id="logoutArea" style="display:none;margin-top:8px;">
        <div id="headerTokenArea" style="display:none;justify-content:center;margin-bottom:6px;">
          <div style="display:inline-flex;align-items:center;gap:6px;background:#111620;border:1px solid #1e2530;border-radius:6px;padding:5px 10px;white-space:nowrap;">
            <span style="font-size:11px;color:#4b5563;">API Token:</span>
            <input type="password" id="headerToken" readonly style="background:none;border:none;color:#00ffcc;font-family:'Courier New',Courier,monospace;font-size:11px;outline:none;width:260px;letter-spacing:0.5px;">
            <button class="copy-btn" onclick="copyHeaderToken()" style="font-size:10px;padding:2px 7px;">Copy</button>
            <button class="copy-btn" id="headerTokenToggle" onclick="toggleHeaderToken()" style="font-size:10px;padding:2px 7px;">Show</button>
          </div>
        </div>
        <span class="logout-link" onclick="doLogout()">🔓 Lock setup</span>
      </div>
    </div>

    <!-- Live Status -->
    <div class="status-bar" id="statusBar">
      <div class="status-dot" id="statusDot"></div>
      <span id="statusLabel">Disconnected</span>
      <span class="status-freq" id="statusFreq">—</span>
      <span class="status-mode" id="statusMode"></span>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('radio', this)">📻 Radio</button>
      <button class="tab-btn" onclick="switchTab('plugins', this)">🧩 Plugins</button>
      <button class="tab-btn" onclick="switchTab('integrations', this)">🔌 WSJT-X <span style="font-size:9px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#06b6d4;border:1px solid #06b6d4;border-radius:3px;padding:1px 4px;line-height:1.4;opacity:0.85;margin-left:4px;vertical-align:middle;">Beta</span></button>
      <button class="tab-btn" onclick="switchTab('log', this)">🖥️ Log</button>
      <button class="tab-btn" onclick="switchTab('security', this); loadTlsStatus();">🔒 Security</button>
    </div>

    <!-- ══ Tab: Radio ══ -->
    <div class="tab-panel active" id="tab-radio">
      <div class="card">
        <div class="card-title">⚡ Radio Connection</div>

        <label>Radio Type</label>
        <select id="radioType" onchange="onTypeChange()">
          <option value="none">— Select your radio —</option>
          <optgroup label="Direct USB (Recommended)">
            <option value="yaesu">Yaesu (FT-991A, FT-891, FT-710, FT-DX10, etc.)</option>
            <option value="kenwood">Kenwood (TS-890, TS-590, TS-2000, etc.)</option>
            <option value="icom">Icom (IC-7300, IC-7610, IC-9700, IC-705, etc.)</option>
          </optgroup>
          <optgroup label="SDR Radios">
            <option value="tci">TCI/SDR (Thetis, ExpertSDR, SunSDR2)</option>
            <option value="smartsdr">FlexRadio SmartSDR (Flex 6000/8000)</option>
            <option value="rtl-tcp">RTL-SDR (via rtl_tcp)</option>
          </optgroup>
          <optgroup label="Via Control Software (Legacy)">
            <option value="flrig">flrig (XML-RPC)</option>
            <option value="rigctld">rigctld / Hamlib (TCP)</option>
          </optgroup>
          <optgroup label="Development">
            <option value="mock">Simulated Radio (Mock)</option>
          </optgroup>
        </select>

        <!-- Serial options (Yaesu/Kenwood/Icom) -->
        <div class="serial-opts" id="serialOpts">
          <label>Serial Port</label>
          <div style="display: flex; gap: 8px; margin-bottom: 14px;">
            <select id="serialPort" style="flex: 1; margin-bottom: 0;"></select>
            <button class="btn btn-secondary" onclick="refreshPorts()" style="width: auto; padding: 8px 14px;">🔄 Scan</button>
          </div>

          <div class="row">
            <div>
              <label>Baud Rate</label>
              <select id="baudRate">
                <option value="4800">4800</option>
                <option value="9600">9600</option>
                <option value="19200">19200</option>
                <option value="38400" selected>38400</option>
                <option value="57600">57600</option>
                <option value="115200">115200</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div>
              <label>Stop Bits</label>
              <select id="stopBits">
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </div>
            <div style="display: flex; align-items: flex-end; padding-bottom: 14px;">
              <div class="checkbox-row" style="margin-bottom: 0;">
                <input type="checkbox" id="rtscts">
                <span>Hardware Flow (RTS/CTS)</span>
              </div>
            </div>
          </div>
          <div class="help-text">Yaesu default: 38400 baud, 2 stop bits. Match your radio's CAT Rate setting.</div>

          <div class="icom-addr" id="icomAddr">
            <label>CI-V Address</label>
            <input type="text" id="icomAddress" value="0x94" placeholder="0x94">
            <div class="help-text">IC-7300: 0x94 · IC-7610: 0x98 · IC-9700: 0xA2 · IC-705: 0xA4</div>
          </div>
        </div>

        <!-- Legacy options (flrig/rigctld) -->
        <div class="legacy-opts" id="legacyOpts">
          <div class="row">
            <div>
              <label>Host</label>
              <input type="text" id="legacyHost" value="127.0.0.1">
            </div>
            <div>
              <label>Port</label>
              <input type="number" id="legacyPort" value="12345">
            </div>
          </div>
        </div>

        <!-- TCI/SDR options -->
        <div class="tci-opts" id="tciOpts">
          <div class="row">
            <div>
              <label>TCI Host</label>
              <input type="text" id="tciHost" value="localhost" placeholder="localhost">
            </div>
            <div>
              <label>TCI Port</label>
              <input type="number" id="tciPort" value="40001" placeholder="40001" min="1" max="65535">
            </div>
          </div>
          <div class="row">
            <div>
              <label>Transceiver (TRX)</label>
              <input type="number" id="tciTrx" value="0" min="0" max="7" placeholder="0">
            </div>
            <div>
              <label>VFO (0 = A, 1 = B)</label>
              <input type="number" id="tciVfo" value="0" min="0" max="1" placeholder="0">
            </div>
          </div>
          <div class="help-text">Enable TCI in your SDR app: Thetis → Setup → CAT Control → Enable TCI Server (port 40001)</div>
        </div>

        <!-- SmartSDR options (FlexRadio) -->
        <div class="smartsdr-opts" id="smartsdrOpts">
          <div class="row">
            <div>
              <label>FlexRadio IP</label>
              <input type="text" id="smartsdrHost" value="192.168.1.100" placeholder="192.168.1.100">
            </div>
            <div>
              <label>API Port</label>
              <input type="number" id="smartsdrPort" value="4992" placeholder="4992" min="1" max="65535">
            </div>
          </div>
          <div class="row">
            <div>
              <label>Slice Index</label>
              <input type="number" id="smartsdrSlice" value="0" min="0" max="7" placeholder="0">
            </div>
            <div></div>
          </div>
          <div class="help-text">Connect directly to your FlexRadio via the SmartSDR TCP API (port 4992). No rigctld or SmartSDR CAT needed.</div>
        </div>

        <!-- RTL-TCP options (RTL-SDR) -->
        <div class="rtltcp-opts" id="rtltcpOpts">
          <div class="row">
            <div>
              <label>rtl_tcp Host</label>
              <input type="text" id="rtltcpHost" value="127.0.0.1" placeholder="127.0.0.1">
            </div>
            <div>
              <label>rtl_tcp Port</label>
              <input type="number" id="rtltcpPort" value="1234" placeholder="1234" min="1" max="65535">
            </div>
          </div>
          <div class="row">
            <div>
              <label>Sample Rate (Hz)</label>
              <input type="number" id="rtltcpSampleRate" value="2400000" min="225001" max="3200000" placeholder="2400000">
            </div>
            <div>
              <label>Gain</label>
              <select id="rtltcpGain">
                <option value="auto" selected>Auto</option>
                <option value="0">0 dB</option>
                <option value="0.9">0.9 dB</option>
                <option value="1.4">1.4 dB</option>
                <option value="2.7">2.7 dB</option>
                <option value="3.7">3.7 dB</option>
                <option value="7.7">7.7 dB</option>
                <option value="8.7">8.7 dB</option>
                <option value="12.5">12.5 dB</option>
                <option value="14.4">14.4 dB</option>
                <option value="15.7">15.7 dB</option>
                <option value="16.6">16.6 dB</option>
                <option value="19.7">19.7 dB</option>
                <option value="20.7">20.7 dB</option>
                <option value="22.9">22.9 dB</option>
                <option value="25.4">25.4 dB</option>
                <option value="28.0">28.0 dB</option>
                <option value="29.7">29.7 dB</option>
                <option value="32.8">32.8 dB</option>
                <option value="33.8">33.8 dB</option>
                <option value="36.4">36.4 dB</option>
                <option value="37.2">37.2 dB</option>
                <option value="38.6">38.6 dB</option>
                <option value="40.2">40.2 dB</option>
                <option value="42.1">42.1 dB</option>
                <option value="43.4">43.4 dB</option>
                <option value="43.9">43.9 dB</option>
                <option value="44.5">44.5 dB</option>
                <option value="48.0">48.0 dB</option>
                <option value="49.6">49.6 dB</option>
              </select>
            </div>
          </div>
          <div class="help-text">Start rtl_tcp first: <code>rtl_tcp -a 127.0.0.1 -p 1234</code> — Receive-only (no PTT or mode control).</div>
        </div>

        <div class="section-divider"></div>

        <div class="row">
          <div>
            <label>Poll Interval (ms)</label>
            <input type="number" id="pollInterval" value="500" min="100" max="5000">
          </div>
          <div style="display: flex; align-items: flex-end; padding-bottom: 14px;">
            <div class="checkbox-row" style="margin-bottom: 0;">
              <input type="checkbox" id="pttEnabled">
              <span>Enable PTT</span>
            </div>
          </div>
        </div>

        <div class="btn-row">
          <button class="btn btn-secondary" onclick="testConnection()">🔍 Test Port</button>
          <button class="btn btn-primary" onclick="saveAndConnect()">💾 Save & Connect</button>
        </div>
      </div>

      <!-- Instructions -->
      <div class="ohc-instructions">
        <strong>New to Rig Bridge?</strong><br>
        Follow <a href="https://github.com/accius/openhamclock/blob/main/rig-bridge/README.md#option-a----installer-from-the-openhamclock-settings-tab-recommended" target="_blank" rel="noopener noreferrer" style="color:#00ffcc;">Quick Start Option A</a> for step-by-step setup instructions.
      </div>
    </div>

    <!-- ══ Tab: Integrations ══ -->
    <!-- ══ Tab: Plugins ══ -->
    <div class="tab-panel" id="tab-plugins">
      <div class="card">
        <div class="card-title">🧩 Plugin Manager</div>
        <p class="help-text" style="margin-bottom:14px; color:#6b7280;">
          Enable or disable plugins and configure their settings. Changes are saved immediately.
        </p>
        <div id="pluginList" style="display:flex; flex-direction:column; gap:12px;">
          <div style="color:#6b7280; font-size:12px;">Loading plugins...</div>
        </div>
      </div>
    </div>

    <div class="tab-panel" id="tab-integrations">
      <div class="card">
        <div class="card-title">📡 WSJT-X Relay</div>
        <p class="help-text" style="margin-bottom:14px; color:#6b7280;">
          Captures WSJT-X UDP packets on your machine and delivers decoded messages
          to OpenHamClock. In WSJT-X: Settings → Reporting → UDP Server: 127.0.0.1 port 2237.
        </p>

        <div class="checkbox-row">
          <input type="checkbox" id="wsjtxEnabled" onchange="toggleWsjtxOpts()">
          <span>Enable WSJT-X</span>
        </div>

        <div id="wsjtxOpts" style="display:none;">

          <!-- Mode selector -->
          <div style="margin:12px 0; padding:10px 12px; background:#1a1f2e; border:1px solid #2d3548; border-radius:6px;">
            <div style="font-size:12px; font-weight:600; color:#c4c9d4; margin-bottom:8px;">Delivery mode</div>
            <div class="checkbox-row" style="margin-bottom:6px;">
              <input type="radio" id="wsjtxModeSSE" name="wsjtxMode" value="sse" onchange="toggleWsjtxMode()" checked>
              <span style="font-size:13px;">📶 SSE only <span style="color:#6b7280; font-size:11px;">— decodes flow via the local /stream connection (local &amp; LAN use)</span></span>
            </div>
            <div class="checkbox-row">
              <input type="radio" id="wsjtxModeRelay" name="wsjtxMode" value="relay" onchange="toggleWsjtxMode()">
              <span style="font-size:13px;">☁️ Relay to OHC server <span style="color:#6b7280; font-size:11px;">— also POST batches to an OpenHamClock server (cloud relay / remote access)</span></span>
            </div>
          </div>

          <!-- UDP port (always visible when enabled) -->
          <div class="row" style="margin-bottom:0;">
            <div>
              <label>UDP Port</label>
              <input type="number" id="wsjtxPort" value="2237" min="1024" max="65535">
            </div>
          </div>

          <!-- Multicast (always visible when enabled) -->
          <div class="checkbox-row" style="margin-top:10px;">
            <input type="checkbox" id="wsjtxMulticast" onchange="toggleWsjtxMulticastOpts()">
            <span>Enable Multicast</span>
          </div>
          <div class="help-text" style="margin-top:-8px; margin-bottom:10px;">
            Join a UDP multicast group so multiple apps can receive WSJT-X packets simultaneously.
            In WSJT-X set UDP Server to <code>224.0.0.1</code> instead of <code>127.0.0.1</code>.
          </div>

          <div id="wsjtxMulticastOpts" style="display:none;">
            <div class="row">
              <div>
                <label>Multicast Group</label>
                <input type="text" id="wsjtxMulticastGroup" placeholder="224.0.0.1">
              </div>
              <div>
                <label>Multicast Interface</label>
                <input type="text" id="wsjtxMulticastInterface" placeholder="Leave blank for OS default">
              </div>
            </div>
          </div>

          <!-- HamQTH callsign lookup (always visible when enabled) -->
          <div class="checkbox-row" style="margin-top:10px;">
            <input type="checkbox" id="wsjtxHamqth">
            <span>HamQTH callsign lookup</span>
          </div>
          <div class="help-text" style="margin-top:-8px; margin-bottom:10px;">
            Resolve unknown callsigns to country-level coordinates via the HamQTH DXCC database.
            Results are cached for 24 h. Requires outbound internet access from this machine.
          </div>

          <!-- Server relay fields — only shown in relay mode -->
          <div id="wsjtxServerOpts" style="display:none; margin-top:4px; padding:10px 12px; background:#1a1f2e; border:1px solid #2d3548; border-radius:6px;">
            <label>OpenHamClock Server URL</label>
            <div style="display:flex; gap:6px; align-items:center; margin-bottom:4px;">
              <input type="text" id="wsjtxUrl" placeholder="https://openhamclock.com" style="flex:1; margin-bottom:0;">
              <button class="btn btn-secondary" onclick="fetchWsjtxCredentials()" id="fetchCredsBtn" style="width:auto; padding:6px 12px; font-size:12px; white-space:nowrap;">🔗 Fetch credentials</button>
            </div>
            <div id="fetchCredsStatus" class="help-text" style="margin-bottom:10px;"></div>

            <label>Relay Key</label>
            <input type="text" id="wsjtxKey" placeholder="Your relay authentication key">

            <label>Session ID</label>
            <input type="text" id="wsjtxSession" placeholder="Your browser session ID">
            <div class="help-text">
              The session ID links your relayed decodes to your OpenHamClock dashboard.
              Find it in OpenHamClock → Settings → Station → Rig Control → WSJT-X Relay,
              or click <strong>Fetch credentials</strong> above to fill both fields automatically.
            </div>

            <label>Batch Interval (ms)</label>
            <input type="number" id="wsjtxInterval" value="2000" min="500" max="30000">
          </div>

          <div style="font-size:12px; color:#6b7280; margin-top:10px; margin-bottom:4px;">
            Status: <span id="wsjtxStatusText" style="color:#c4c9d4;">—</span>
          </div>
        </div>

        <div class="btn-row">
          <button class="btn btn-primary" onclick="saveIntegrations()">💾 Save Integrations</button>
        </div>
      </div>
    </div>

    <!-- ══ Tab: Console Log ══ -->
    <div class="tab-panel" id="tab-log">
      <div class="log-toolbar">
        <span style="font-size:12px; color:#6b7280; margin-right:4px;">Filter:</span>
        <span class="log-badge lvl-log active" data-level="log" onclick="toggleFilter('log', this)">INFO</span>
        <span class="log-badge lvl-warn active" data-level="warn" onclick="toggleFilter('warn', this)">WARN</span>
        <span class="log-badge lvl-error active" data-level="error" onclick="toggleFilter('error', this)">ERROR</span>
        <span style="flex:1"></span>
        <button id="logToggleBtn" class="btn btn-secondary" onclick="toggleLogging()" style="width:auto; padding:5px 14px; font-size:12px;">⏸ Pause</button>
        <button class="btn btn-secondary" onclick="clearLog()" style="width:auto; padding:5px 14px; font-size:12px;">🗑 Clear</button>
      </div>

      <div class="log-scroll-wrap" id="logScroll">
        <div class="log-empty" id="logEmpty">Waiting for log output…</div>
      </div>

      <div class="log-footer">
        <div class="log-indicator">
          <div class="log-dot" id="logDot"></div>
          <span id="logStatus">Connecting…</span>
        </div>
        <div>
          <label style="display:inline; text-transform:none; font-size:11px; color:#374151;">
            <input type="checkbox" id="logAutoScroll" checked style="width:auto; margin:0 4px 0 0; vertical-align:middle;">
            Auto-scroll
          </label>
        </div>
      </div>
    </div>
    <!-- ══ Tab: Security ══ -->
    <div class="tab-panel" id="tab-security">
      <div class="card">
        <div class="card-title">🔒 HTTPS / TLS</div>
        <p style="font-size:13px; color:#6b7280; margin-bottom:16px; line-height:1.5;">
          Enable HTTPS so OpenHamClock (served over HTTPS) can connect to rig-bridge
          without mixed-content browser errors. A self-signed certificate is generated
          automatically. <strong style="color:#f59e0b;">Restart required after toggling.</strong>
        </p>

        <div class="checkbox-row">
          <input type="checkbox" id="tlsEnabled" onchange="onTlsToggle(this.checked)">
          <span>Enable HTTPS</span>
        </div>
        <p class="help-text" style="margin-top:6px;">
          When enabled, open
          <strong id="tlsUrl" style="color:#00ffcc;">https://localhost:${config.port}</strong>
          instead of the HTTP URL.
        </p>
      </div>

      <div id="tlsCertCard" class="card" style="display:none;">
        <div class="card-title">Certificate</div>

        <div id="tlsCertInfo" style="background:#0a0e14; border:1px solid #1e2530; border-radius:6px; padding:12px; font-family:'JetBrains Mono','Consolas',monospace; font-size:12px; color:#9ca3af; margin-bottom:14px;">
          Loading…
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-secondary" onclick="downloadCert()" style="flex:none; width:auto; padding:8px 16px;">⬇ Download Certificate</button>
          <button class="btn btn-secondary" onclick="regenCert()" style="flex:none; width:auto; padding:8px 16px;">🔄 Regenerate</button>
        </div>
      </div>

      <div id="tlsInstallCard" class="card" style="display:none;">
        <div class="card-title">Install Certificate</div>
        <p style="font-size:13px; color:#6b7280; margin-bottom:12px; line-height:1.5;">
          Browsers block connections to servers with untrusted certificates. Install the
          certificate below so your browser trusts rig-bridge's HTTPS connection.
          After installing, restart your browser and open the HTTPS URL above.
        </p>

        <div id="tlsInstallInstructions" style="margin-bottom:12px;"></div>

        <button class="btn btn-primary" onclick="installCert()" id="tlsInstallBtn" style="width:auto; padding:8px 20px;">
          Install Certificate
        </button>
        <div id="tlsInstallResult" style="margin-top:10px; font-size:13px;"></div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <footer class="page-footer">
    OpenHamClock Rig Bridge v${version} &nbsp;·&nbsp;
    <a href="https://openhamclock.com" target="_blank" rel="noopener">openhamclock.com</a>
  </footer>

  <script>
    // Server-injected on first run — used by doAutoLogin() for seamless first-run auth
    var __FIRST_RUN_TOKEN__ = ${firstRunToken ? JSON.stringify(firstRunToken) : 'null'};

    // ── Tab switching ──────────────────────────────────────────────────────
    function switchTab(name, btn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
    }

    // ── Plugin Manager ────────────────────────────────────────────────────

    const PLUGIN_DEFS = [
      { key: 'mshv', name: 'MSHV', maturity: 'alpha', desc: 'Multi-stream digital mode software (MSK144, Q65, etc.)', fields: [
        { id: 'udpPort', label: 'UDP Port', type: 'number', default: 2239 },
        { id: 'verbose', label: 'Verbose logging', type: 'checkbox', default: false },
      ]},
      { key: 'jtdx', name: 'JTDX', maturity: 'alpha', desc: 'Enhanced JT65/JT9/FT8 decoding (WSJT-X fork)', fields: [
        { id: 'udpPort', label: 'UDP Port', type: 'number', default: 2238 },
        { id: 'verbose', label: 'Verbose logging', type: 'checkbox', default: false },
      ]},
      { key: 'js8call', name: 'JS8Call', maturity: 'alpha', desc: 'JS8 messaging protocol for keyboard-to-keyboard QSOs', fields: [
        { id: 'udpPort', label: 'UDP Port', type: 'number', default: 2242 },
        { id: 'verbose', label: 'Verbose logging', type: 'checkbox', default: false },
      ]},
      { key: 'aprs', name: 'APRS TNC', maturity: 'beta', desc: 'Local APRS via Direwolf or hardware TNC (KISS protocol)', fields: [
        { id: 'protocol', label: 'Protocol', type: 'select', options: ['kiss-tcp', 'kiss-serial'], default: 'kiss-tcp' },
        { id: 'host', label: 'TNC Host', type: 'text', default: '127.0.0.1' },
        { id: 'port', label: 'TNC Port', type: 'number', default: 8001 },
        { id: 'callsign', label: 'Your Callsign', type: 'text', default: '' },
        { id: 'ssid', label: 'SSID', type: 'number', default: 0 },
        { id: 'beaconInterval', label: 'Beacon Interval (sec)', type: 'number', default: 600 },
        { id: 'verbose', label: 'Verbose logging', type: 'checkbox', default: false },
      ]},
      { key: 'rotator', name: 'Rotator (rotctld)', maturity: 'alpha', desc: 'Antenna rotator control via Hamlib rotctld', fields: [
        { id: 'host', label: 'rotctld Host', type: 'text', default: '127.0.0.1' },
        { id: 'port', label: 'rotctld Port', type: 'number', default: 4533 },
        { id: 'pollInterval', label: 'Poll Interval (ms)', type: 'number', default: 1000 },
      ]},
      { key: 'winlink', name: 'Winlink', maturity: 'alpha', desc: 'Gateway discovery + Pat client for Winlink messaging', fields: [
        { id: 'apiKey', label: 'Winlink API Key', type: 'text', default: '' },
        { id: 'pat.enabled', label: 'Enable Pat Client', type: 'checkbox', default: false },
        { id: 'pat.host', label: 'Pat Host', type: 'text', default: '127.0.0.1' },
        { id: 'pat.port', label: 'Pat Port', type: 'number', default: 8080 },
      ]},
      { key: 'cloudRelay', name: 'Cloud Relay', maturity: 'alpha', desc: 'Proxy rig features to cloud-hosted OpenHamClock', fields: [
        { id: 'url', label: 'OHC Server URL', type: 'text', default: '' },
        { id: 'apiKey', label: 'Relay API Key', type: 'text', default: '' },
        { id: 'session', label: 'Session ID', type: 'text', default: '' },
        { id: 'pushInterval', label: 'Push Interval (ms)', type: 'number', default: 2000 },
        { id: 'pollInterval', label: 'Poll Interval (ms)', type: 'number', default: 1000 },
      ]},
      { key: 'meshcom', name: 'MeshCom UDP', maturity: 'beta', desc: 'Receive MeshCom LoRa mesh node positions, messages and telemetry via UDP JSON (port 1799)', fields: [
        { id: 'bindPort', label: 'UDP Listen Port', type: 'number', default: 1799 },
        { id: 'bindHost', label: 'Bind Address', type: 'text', default: '0.0.0.0' },
        { id: 'verbose', label: 'Verbose logging', type: 'checkbox', default: false },
      ]},
    ];

    function maturityBadge(level) {
      if (!level) return '';
      const color = level === 'alpha' ? '#f59e0b' : '#06b6d4';
      const label = level === 'alpha' ? 'Alpha' : 'Beta';
      return '<span style="font-size:9px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;' +
             'color:' + color + ';border:1px solid ' + color + ';border-radius:3px;' +
             'padding:1px 4px;line-height:1.4;opacity:0.85;margin-left:6px;vertical-align:middle;">' +
             label + '</span>';
    }

    function renderPlugins(cfg) {
      const container = document.getElementById('pluginList');
      container.innerHTML = '';

      PLUGIN_DEFS.forEach(plugin => {
        const pcfg = cfg[plugin.key] || {};
        const enabled = !!pcfg.enabled;

        const card = document.createElement('div');
        card.style.cssText = 'background:#0d1117; border:1px solid #1e2530; border-radius:8px; padding:14px;';
        card.innerHTML =
          '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">' +
            '<div>' +
              '<strong style="color:#c4c9d4; font-size:13px;">' + plugin.name + maturityBadge(plugin.maturity) + '</strong>' +
              '<div style="font-size:11px; color:#6b7280; margin-top:2px;">' + plugin.desc + '</div>' +
            '</div>' +
            '<label style="position:relative; display:inline-block; width:44px; height:24px; margin:0;">' +
              '<input type="checkbox" ' + (enabled ? 'checked' : '') +
              ' onchange="togglePlugin(\\''+plugin.key+'\\', this.checked)"' +
              ' style="opacity:0; width:0; height:0;">' +
              '<span style="position:absolute; cursor:pointer; inset:0; background:' + (enabled ? '#22c55e' : '#374151') +
              '; border-radius:24px; transition:0.2s;"></span>' +
              '<span style="position:absolute; left:' + (enabled ? '22px' : '3px') +
              '; top:3px; width:18px; height:18px; background:#fff; border-radius:50%; transition:0.2s;"></span>' +
            '</label>' +
          '</div>';

        // Settings fields (shown when enabled)
        if (enabled && plugin.fields.length > 0) {
          const fields = document.createElement('div');
          fields.style.cssText = 'border-top:1px solid #1e2530; padding-top:10px; margin-top:8px; display:grid; grid-template-columns:1fr 1fr; gap:8px;';

          plugin.fields.forEach(f => {
            const val = f.id.includes('.') ? (pcfg[f.id.split('.')[0]] || {})[f.id.split('.')[1]] : pcfg[f.id];
            const div = document.createElement('div');

            if (f.type === 'checkbox') {
              div.innerHTML =
                '<label style="display:flex; align-items:center; gap:6px; font-size:11px; color:#8b95a5; margin:0;">' +
                  '<input type="checkbox" ' + (val ? 'checked' : '') +
                  ' onchange="setPluginField(\\''+plugin.key+'\\', \\''+f.id+'\\', this.checked)">' +
                  f.label +
                '</label>';
              div.style.gridColumn = 'span 2';
            } else if (f.type === 'select') {
              div.innerHTML =
                '<label style="font-size:10px; color:#6b7280; margin-bottom:3px; display:block;">' + f.label + '</label>' +
                '<select onchange="setPluginField(\\''+plugin.key+'\\', \\''+f.id+'\\', this.value)"' +
                ' style="width:100%; padding:6px; background:#0a0e14; border:1px solid #1e2530; border-radius:4px; color:#c4c9d4; font-size:12px;">' +
                f.options.map(o => '<option value="'+o+'" '+(val===o?'selected':'')+'>'+o+'</option>').join('') +
                '</select>';
            } else {
              div.innerHTML =
                '<label style="font-size:10px; color:#6b7280; margin-bottom:3px; display:block;">' + f.label + '</label>' +
                '<input type="' + f.type + '" value="' + (val != null ? val : f.default) + '"' +
                ' onchange="setPluginField(\\''+plugin.key+'\\', \\''+f.id+'\\', this.value)"' +
                ' style="width:100%; padding:6px; background:#0a0e14; border:1px solid #1e2530; border-radius:4px; color:#c4c9d4; font-size:12px; box-sizing:border-box;">';
            }
            fields.appendChild(div);
          });

          card.appendChild(fields);
        }

        container.appendChild(card);
      });
    }

    async function togglePlugin(key, enabled) {
      const update = {};
      update[key] = { enabled };
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-RigBridge-Token': _sessionToken },
          body: JSON.stringify(update),
        });
        if (res.ok) {
          showToast(enabled ? 'Plugin enabled — restart rig-bridge to activate' : 'Plugin disabled');
          loadApp(); // Refresh UI
        } else {
          showToast('Failed to save', true);
        }
      } catch (e) {
        showToast('Error: ' + e.message, true);
      }
    }

    async function setPluginField(key, field, value) {
      const update = {};
      if (field.includes('.')) {
        const [section, subkey] = field.split('.');
        update[key] = {};
        update[key][section] = {};
        update[key][section][subkey] = value;
      } else {
        update[key] = {};
        update[key][field] = typeof value === 'string' && /^\\d+$/.test(value) ? parseInt(value) : value;
      }
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-RigBridge-Token': _sessionToken },
          body: JSON.stringify(update),
        });
      } catch (e) {}
    }

    // ── Integrations tab ───────────────────────────────────────────────────

    function populateIntegrations(cfg) {
      const w = cfg.wsjtxRelay || {};
      document.getElementById('wsjtxEnabled').checked = !!w.enabled;
      document.getElementById('wsjtxUrl').value = w.url || '';
      document.getElementById('wsjtxKey').value = w.key || '';
      document.getElementById('wsjtxSession').value = w.session || '';
      document.getElementById('wsjtxPort').value = w.udpPort || 2237;
      document.getElementById('wsjtxInterval').value = w.batchInterval || 2000;
      document.getElementById('wsjtxMulticast').checked = !!w.multicast;
      document.getElementById('wsjtxMulticastGroup').value = w.multicastGroup || '224.0.0.1';
      document.getElementById('wsjtxMulticastInterface').value = w.multicastInterface || '';
      document.getElementById('wsjtxHamqth').checked = !!w.hamqthLookup;
      // Set delivery mode radio
      const relayMode = !!w.relayToServer;
      document.getElementById('wsjtxModeSSE').checked = !relayMode;
      document.getElementById('wsjtxModeRelay').checked = relayMode;
      toggleWsjtxOpts();
      toggleWsjtxMode();
      toggleWsjtxMulticastOpts();
    }

    function toggleWsjtxOpts() {
      const enabled = document.getElementById('wsjtxEnabled').checked;
      document.getElementById('wsjtxOpts').style.display = enabled ? 'block' : 'none';
    }

    function toggleWsjtxMode() {
      const relay = document.getElementById('wsjtxModeRelay').checked;
      document.getElementById('wsjtxServerOpts').style.display = relay ? 'block' : 'none';
    }

    async function fetchWsjtxCredentials() {
      const url = document.getElementById('wsjtxUrl').value.trim();
      const statusEl = document.getElementById('fetchCredsStatus');
      const btn = document.getElementById('fetchCredsBtn');
      if (!url) {
        statusEl.style.color = '#f87171';
        statusEl.textContent = '❌ Enter the OpenHamClock Server URL first.';
        return;
      }
      btn.disabled = true;
      statusEl.style.color = '#9ca3af';
      statusEl.textContent = 'Fetching credentials…';
      try {
        const res = await fetch(url.replace(/[/]$/, '') + '/api/wsjtx/relay-credentials');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          statusEl.style.color = '#f87171';
          statusEl.textContent = '❌ ' + (body.error || 'Server returned ' + res.status);
          return;
        }
        const { relayKey } = await res.json();
        document.getElementById('wsjtxKey').value = relayKey;
        statusEl.style.color = '#4ade80';
        statusEl.textContent =
          '✅ Relay key fetched. Now copy your Session ID from OpenHamClock → Settings → Station → Rig Control → WSJT-X Relay and paste it below.';
      } catch (e) {
        statusEl.style.color = '#f87171';
        statusEl.textContent = '❌ Could not reach ' + url + ' — is OpenHamClock running?';
      } finally {
        btn.disabled = false;
      }
    }

    function toggleWsjtxMulticastOpts() {
      const on = document.getElementById('wsjtxMulticast').checked;
      document.getElementById('wsjtxMulticastOpts').style.display = on ? 'block' : 'none';
    }

    async function saveIntegrations() {
      const relayMode = document.getElementById('wsjtxModeRelay').checked;
      const wsjtxRelay = {
        enabled: document.getElementById('wsjtxEnabled').checked,
        relayToServer: relayMode,
        url: document.getElementById('wsjtxUrl').value.trim(),
        key: document.getElementById('wsjtxKey').value.trim(),
        session: document.getElementById('wsjtxSession').value.trim(),
        udpPort: parseInt(document.getElementById('wsjtxPort').value) || 2237,
        batchInterval: parseInt(document.getElementById('wsjtxInterval').value) || 2000,
        multicast: document.getElementById('wsjtxMulticast').checked,
        multicastGroup: document.getElementById('wsjtxMulticastGroup').value.trim() || '224.0.0.1',
        multicastInterface: document.getElementById('wsjtxMulticastInterface').value.trim(),
        hamqthLookup: document.getElementById('wsjtxHamqth').checked,
      };
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ wsjtxRelay }),
        });
        const data = await res.json();
        if (data.success) {
          currentConfig = data.config;
          showToast('✅ Integrations saved!', 'success');
        }
      } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
      }
    }

    let wsjtxStatusInterval = null;

    function startWsjtxStatusPoll() {
      if (wsjtxStatusInterval) clearInterval(wsjtxStatusInterval);
      wsjtxStatusInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/wsjtxrelay/status');
          if (!res.ok) return;
          const data = await res.json();
          const el = document.getElementById('wsjtxStatusText');
          if (!el) return;
          if (!data.running) {
            el.textContent = 'Not running';
            el.style.color = '#6b7280';
          } else if (data.relayToServer && !data.serverReachable) {
            el.textContent = 'Running — connecting to server...';
            el.style.color = '#f59e0b';
          } else {
            let status = 'Running — ' + data.decodeCount + ' decodes';
            if (data.relayToServer) status += ', ' + data.relayCount + ' relayed';
            if (data.hamqthLookup) status += ', ' + data.callsignCacheSize + ' callsigns cached';
            el.textContent = status;
            el.style.color = '#22c55e';
          }
        } catch (e) {}
      }, 5000);
    }

    // ── Radio tab ──────────────────────────────────────────────────────────
    let currentConfig = null;
    let statusInterval = null;

    // ── Auth helpers ───────────────────────────────────────────────────────

    let _sessionToken = null; // token for this browser session

    function authHeaders() {
      return _sessionToken
        ? { 'Content-Type': 'application/json', 'X-RigBridge-Token': _sessionToken }
        : { 'Content-Type': 'application/json' };
    }

    function setLoggedIn(token) {
      _sessionToken = token;
      if (token) {
        try { localStorage.setItem('rb_token', token); } catch (e) {}
      }
      const overlay = document.getElementById('loginOverlay');
      const logoutArea = document.getElementById('logoutArea');
      const headerTokenArea = document.getElementById('headerTokenArea');
      const headerToken = document.getElementById('headerToken');
      if (overlay) overlay.style.display = 'none';
      if (logoutArea) logoutArea.style.display = 'block';
      if (token && headerToken) {
        headerToken.value = token;
        headerToken.type = 'password';
        const toggle = document.getElementById('headerTokenToggle');
        if (toggle) toggle.textContent = 'Show';
      }
      if (headerTokenArea) headerTokenArea.style.display = token ? 'flex' : 'none';
      loadApp();
    }

    function showLoginForm() {
      const overlay = document.getElementById('loginOverlay');
      if (overlay) overlay.style.display = 'flex';
    }

    function doLogout() {
      _sessionToken = null;
      try { localStorage.removeItem('rb_token'); } catch (e) {}
      const logoutArea = document.getElementById('logoutArea');
      if (logoutArea) logoutArea.style.display = 'none';
      showLoginForm();
    }

    function toggleLoginVisible() {
      const inp = document.getElementById('loginToken');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    }

    async function doLogin() {
      const inp = document.getElementById('loginToken');
      const token = inp ? inp.value.trim() : '';
      if (!token) return;
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          setLoggedIn(token);
        } else {
          const row = document.getElementById('loginRow');
          if (row) { row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake'); }
        }
      } catch (e) {
        showToast('Login failed: ' + e.message, 'error');
      }
    }

    async function doAutoLogin() {
      // 1. Try stored token
      let stored = null;
      try { stored = localStorage.getItem('rb_token'); } catch (e) {}
      if (stored) {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: stored }),
        }).catch(() => null);
        if (res && res.ok) { setLoggedIn(stored); return; }
        try { localStorage.removeItem('rb_token'); } catch (e) {}
      }

      // 2. First-run: token injected server-side — auto-login and show welcome banner
      if (typeof __FIRST_RUN_TOKEN__ !== 'undefined' && __FIRST_RUN_TOKEN__) {
        setLoggedIn(__FIRST_RUN_TOKEN__);
        const banner = document.getElementById('welcomeBanner');
        const tokenInp = document.getElementById('welcomeToken');
        if (tokenInp) tokenInp.value = __FIRST_RUN_TOKEN__;
        if (banner) banner.style.display = 'flex';
        return;
      }

      // 3. No token configured — auth disabled, just load
      const probeRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '' }),
      }).catch(() => null);
      if (probeRes && probeRes.ok) { setLoggedIn(''); return; }

      // 4. Show login form
      showLoginForm();
    }

    function copyToken() {
      const inp = document.getElementById('welcomeToken');
      if (!inp) return;
      inp.select();
      try { document.execCommand('copy'); } catch (e) {}
      showToast('✅ Token copied!', 'success');
    }

    function copyHeaderToken() {
      const inp = document.getElementById('headerToken');
      if (!inp) return;
      const prev = inp.type;
      inp.type = 'text';
      inp.select();
      try { document.execCommand('copy'); } catch (e) {}
      inp.type = prev;
      showToast('✅ Token copied!', 'success');
    }

    function toggleHeaderToken() {
      const inp = document.getElementById('headerToken');
      const btn = document.getElementById('headerTokenToggle');
      if (!inp) return;
      const showing = inp.type === 'text';
      inp.type = showing ? 'password' : 'text';
      if (btn) btn.textContent = showing ? 'Show' : 'Hide';
    }

    async function dismissBanner() {
      await fetch('/api/setup/token-seen', { method: 'POST', headers: authHeaders() }).catch(() => {});
      const banner = document.getElementById('welcomeBanner');
      if (banner) banner.style.display = 'none';
    }

    async function loadApp() {
      try {
        const [cfgRes, logRes] = await Promise.all([
          fetch('/api/config', { headers: authHeaders() }),
          fetch('/api/logging', { headers: authHeaders() }),
        ]);
        currentConfig = await cfgRes.json();
        const logData = await logRes.json();
        populateForm(currentConfig);
        populateIntegrations(currentConfig);
        renderPlugins(currentConfig);
        setLoggingBtn(logData.logging !== false); // default true
        refreshPorts();
        startStatusPoll();
        startLogStream();
        startWsjtxStatusPoll();
      } catch (e) {
        showToast('Failed to load config', 'error');
      }
    }

    function populateForm(cfg) {
      const r = cfg.radio || {};
      document.getElementById('radioType').value = r.type || 'none';
      document.getElementById('baudRate').value = r.baudRate || 38400;
      document.getElementById('stopBits').value = r.stopBits || 2;
      document.getElementById('rtscts').checked = !!r.rtscts;
      document.getElementById('icomAddress').value = r.icomAddress || '0x94';
      document.getElementById('pollInterval').value = r.pollInterval || 500;
      document.getElementById('pttEnabled').checked = !!r.pttEnabled;
      document.getElementById('legacyHost').value =
        r.type === 'rigctld' ? (r.rigctldHost || '127.0.0.1') : (r.flrigHost || '127.0.0.1');
      document.getElementById('legacyPort').value =
        r.type === 'rigctld' ? (r.rigctldPort || 4532) : (r.flrigPort || 12345);
      const tci = cfg.tci || {};
      document.getElementById('tciHost').value = tci.host || 'localhost';
      document.getElementById('tciPort').value = tci.port || 40001;
      document.getElementById('tciTrx').value = tci.trx ?? 0;
      document.getElementById('tciVfo').value = tci.vfo ?? 0;
      const sdr = cfg.smartsdr || {};
      document.getElementById('smartsdrHost').value = sdr.host || '192.168.1.100';
      document.getElementById('smartsdrPort').value = sdr.port || 4992;
      document.getElementById('smartsdrSlice').value = sdr.sliceIndex ?? 0;
      const rtl = cfg.rtltcp || {};
      document.getElementById('rtltcpHost').value = rtl.host || '127.0.0.1';
      document.getElementById('rtltcpPort').value = rtl.port || 1234;
      document.getElementById('rtltcpSampleRate').value = rtl.sampleRate || 2400000;
      document.getElementById('rtltcpGain').value = rtl.gain ?? 'auto';
      onTypeChange(true); // Don't overwrite loaded values with model defaults
    }

    function onTypeChange(skipDefaults) {
      const type = document.getElementById('radioType').value;
      const isDirect = ['yaesu', 'kenwood', 'icom'].includes(type);
      const isLegacy = ['flrig', 'rigctld'].includes(type);
      const isTci = type === 'tci';
      const isSmartSDR = type === 'smartsdr';
      const isRtlTcp = type === 'rtl-tcp';

      document.getElementById('serialOpts').className = 'serial-opts' + (isDirect ? ' show' : '');
      document.getElementById('legacyOpts').className = 'legacy-opts' + (isLegacy ? ' show' : '');
      document.getElementById('icomAddr').className = 'icom-addr' + (type === 'icom' ? ' show' : '');
      document.getElementById('tciOpts').className = 'tci-opts' + (isTci ? ' show' : '');
      document.getElementById('smartsdrOpts').className = 'smartsdr-opts' + (isSmartSDR ? ' show' : '');
      document.getElementById('rtltcpOpts').className = 'rtltcp-opts' + (isRtlTcp ? ' show' : '');

      if (!skipDefaults) {
        if (type === 'yaesu') {
          document.getElementById('baudRate').value = '38400';
          document.getElementById('stopBits').value = '2';
          document.getElementById('rtscts').checked = false;
        } else if (type === 'kenwood' || type === 'icom') {
          document.getElementById('stopBits').value = '1';
          document.getElementById('rtscts').checked = false;
        }
        if (type === 'rigctld') {
          document.getElementById('legacyPort').value = '4532';
        } else if (type === 'flrig') {
          document.getElementById('legacyPort').value = '12345';
        }
      }
    }

    async function refreshPorts() {
      const sel = document.getElementById('serialPort');
      sel.innerHTML = '<option value="">Scanning...</option>';
      try {
        const res = await fetch('/api/ports', { headers: authHeaders() });
        const ports = await res.json();
        sel.innerHTML = '<option value="">— Select port —</option>';
        if (ports.length === 0) {
          sel.innerHTML += '<option value="" disabled>No ports found — is your radio plugged in via USB?</option>';
        }
        ports.forEach((p) => {
          const label = p.manufacturer ? p.path + ' (' + p.manufacturer + ')' : p.path;
          const opt = document.createElement('option');
          opt.value = p.path;
          opt.textContent = label;
          if (currentConfig && currentConfig.radio && currentConfig.radio.serialPort === p.path) {
            opt.selected = true;
          }
          sel.appendChild(opt);
        });
      } catch (e) {
        sel.innerHTML = '<option value="" disabled>Error scanning ports</option>';
      }
    }

    async function testConnection() {
      const stopBits = parseInt(document.getElementById('stopBits').value);
      const rtscts = document.getElementById('rtscts').checked;
      const type = document.getElementById('radioType').value;

      if (['yaesu', 'kenwood', 'icom'].includes(type)) {
        const serialPort = document.getElementById('serialPort').value;
        const baudRate = parseInt(document.getElementById('baudRate').value);
        if (!serialPort) return showToast('Select a serial port first', 'error');
        try {
          const res = await fetch('/api/test', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ serialPort, baudRate, stopBits, rtscts }),
          });
          const data = await res.json();
          showToast(
            data.success ? '✅ ' + data.message : '❌ ' + data.error,
            data.success ? 'success' : 'error',
          );
        } catch (e) {
          showToast('Test failed: ' + e.message, 'error');
        }
      } else {
        showToast('Test is for direct serial connections only', 'error');
      }
    }

    async function saveAndConnect() {
      const type = document.getElementById('radioType').value;
      const radio = {
        type,
        serialPort: document.getElementById('serialPort').value,
        baudRate: parseInt(document.getElementById('baudRate').value),
        stopBits: parseInt(document.getElementById('stopBits').value),
        rtscts: document.getElementById('rtscts').checked,
        icomAddress: document.getElementById('icomAddress').value,
        pollInterval: parseInt(document.getElementById('pollInterval').value),
        pttEnabled: document.getElementById('pttEnabled').checked,
      };

      if (type === 'rigctld') {
        radio.rigctldHost = document.getElementById('legacyHost').value;
        radio.rigctldPort = parseInt(document.getElementById('legacyPort').value);
      } else if (type === 'flrig') {
        radio.flrigHost = document.getElementById('legacyHost').value;
        radio.flrigPort = parseInt(document.getElementById('legacyPort').value);
      }

      const tci = {
        host: document.getElementById('tciHost').value.trim() || 'localhost',
        port: parseInt(document.getElementById('tciPort').value) || 40001,
        trx: Math.max(0, parseInt(document.getElementById('tciTrx').value) || 0),
        vfo: Math.max(0, parseInt(document.getElementById('tciVfo').value) || 0),
      };

      const smartsdr = {
        host: document.getElementById('smartsdrHost').value.trim() || '192.168.1.100',
        port: parseInt(document.getElementById('smartsdrPort').value) || 4992,
        sliceIndex: Math.max(0, parseInt(document.getElementById('smartsdrSlice').value) || 0),
      };

      const rtltcp = {
        host: document.getElementById('rtltcpHost').value.trim() || '127.0.0.1',
        port: parseInt(document.getElementById('rtltcpPort').value) || 1234,
        sampleRate: parseInt(document.getElementById('rtltcpSampleRate').value) || 2400000,
        gain: document.getElementById('rtltcpGain').value,
      };

      if (type === 'tci') {
        if (!tci.host) return showToast('TCI host cannot be empty', 'error');
        if (tci.port < 1 || tci.port > 65535) return showToast('TCI port must be 1–65535', 'error');
      }
      if (type === 'smartsdr') {
        if (!smartsdr.host) return showToast('FlexRadio IP cannot be empty', 'error');
        if (smartsdr.port < 1 || smartsdr.port > 65535) return showToast('SmartSDR port must be 1–65535', 'error');
      }
      if (type === 'rtl-tcp') {
        if (!rtltcp.host) return showToast('rtl_tcp host cannot be empty', 'error');
        if (rtltcp.port < 1 || rtltcp.port > 65535) return showToast('rtl_tcp port must be 1–65535', 'error');
      }

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ radio, tci, smartsdr, rtltcp }),
        });
        const data = await res.json();
        if (data.success) {
          currentConfig = data.config;
          showToast('✅ Saved! Connecting to radio...', 'success');
        }
      } catch (e) {
        showToast('Save failed: ' + e.message, 'error');
      }
    }

    function startStatusPoll() {
      if (statusInterval) clearInterval(statusInterval);
      statusInterval = setInterval(async () => {
        try {
          const res = await fetch('/status');
          const s = await res.json();

          const dot = document.getElementById('statusDot');
          const label = document.getElementById('statusLabel');
          const freq = document.getElementById('statusFreq');
          const mode = document.getElementById('statusMode');

          dot.className = 'status-dot' + (s.connected ? ' connected' : '');
          label.textContent = s.connected ? 'Connected' : 'Disconnected';

          if (s.freq > 0) {
            const mhz = (s.freq / 1000000).toFixed(s.freq >= 100000000 ? 4 : 6);
            freq.textContent = mhz + ' MHz';
          } else {
            freq.textContent = '—';
          }
          mode.textContent = s.mode || '';
        } catch (e) {}
      }, 1000);
    }

    function showToast(msg, type) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast show ' + type;
      setTimeout(() => { t.className = 'toast'; }, 3000);
    }

    // ── Console Log tab ────────────────────────────────────────────────────
    const activeFilters = { log: true, warn: true, error: true };
    let logLines = []; // all received lines (unfiltered)

    function toggleFilter(level, el) {
      activeFilters[level] = !activeFilters[level];
      el.classList.toggle('active', activeFilters[level]);
      el.classList.toggle('inactive', !activeFilters[level]);
      renderLog();
    }

    function clearLog() {
      logLines = [];
      renderLog();
    }

    let loggingEnabled = true;

    function setLoggingBtn(enabled) {
      loggingEnabled = enabled;
      const btn = document.getElementById('logToggleBtn');
      if (btn) {
        btn.textContent = enabled ? '⏸ Pause' : '▶ Resume';
        btn.title = enabled ? 'Pause console log capture' : 'Resume console log capture';
      }
    }

    async function toggleLogging() {
      try {
        const res = await fetch('/api/logging', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ logging: !loggingEnabled }),
        });
        const data = await res.json();
        if (data.success) setLoggingBtn(data.logging);
      } catch (e) {
        showToast('Failed to toggle logging: ' + e.message, 'error');
      }
    }

    function fmtTime(ts) {
      const d = new Date(ts);
      return d.toTimeString().substring(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    function renderLog() {
      const wrap = document.getElementById('logScroll');
      const empty = document.getElementById('logEmpty');
      const autoScroll = document.getElementById('logAutoScroll').checked;
      const wasAtBottom = wrap.scrollHeight - wrap.scrollTop <= wrap.clientHeight + 40;

      const visible = logLines.filter((l) => activeFilters[l.level]);

      if (visible.length === 0) {
        empty.style.display = 'block';
        // Remove all line elements
        [...wrap.querySelectorAll('.log-line')].forEach((el) => el.remove());
        return;
      }
      empty.style.display = 'none';

      // Full re-render (simple; log volume is low)
      [...wrap.querySelectorAll('.log-line')].forEach((el) => el.remove());
      const frag = document.createDocumentFragment();
      visible.forEach((line) => {
        const row = document.createElement('div');
        row.className = 'log-line lvl-' + line.level;
        row.innerHTML =
          '<span class="log-ts">' + fmtTime(line.ts) + '</span>' +
          '<span class="log-text">' + escHtml(line.text) + '</span>';
        frag.appendChild(row);
      });
      wrap.appendChild(frag);

      if (autoScroll && wasAtBottom) {
        wrap.scrollTop = wrap.scrollHeight;
      }
    }

    function appendLogLine(entry) {
      logLines.push(entry);
      if (!activeFilters[entry.level]) return; // filtered out — skip DOM update

      const wrap = document.getElementById('logScroll');
      const empty = document.getElementById('logEmpty');
      const autoScroll = document.getElementById('logAutoScroll').checked;
      const wasAtBottom = wrap.scrollHeight - wrap.scrollTop <= wrap.clientHeight + 40;

      empty.style.display = 'none';

      const row = document.createElement('div');
      row.className = 'log-line lvl-' + entry.level;
      row.innerHTML =
        '<span class="log-ts">' + fmtTime(entry.ts) + '</span>' +
        '<span class="log-text">' + escHtml(entry.text) + '</span>';
      wrap.appendChild(row);

      if (autoScroll && wasAtBottom) {
        wrap.scrollTop = wrap.scrollHeight;
      }
    }

    function escHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function setLogStatus(live) {
      document.getElementById('logDot').className = 'log-dot' + (live ? ' live' : '');
      document.getElementById('logStatus').textContent = live ? 'Live' : 'Reconnecting…';
    }

    function startLogStream() {
      let es;

      function connect() {
        const tokenParam = _sessionToken ? '?token=' + encodeURIComponent(_sessionToken) : '';
        es = new EventSource('/api/log/stream' + tokenParam);

        es.onopen = () => setLogStatus(true);

        es.addEventListener('history', (e) => {
          const lines = JSON.parse(e.data);
          lines.forEach((l) => logLines.push(l));
          renderLog();
        });

        es.addEventListener('line', (e) => {
          const entry = JSON.parse(e.data);
          appendLogLine(entry);
        });

        es.onerror = () => {
          setLogStatus(false);
          es.close();
          setTimeout(connect, 3000);
        };
      }

      connect();
    }

    // ── TLS / Security tab ────────────────────────────────────────────────

    async function loadTlsStatus() {
      try {
        const r = await fetch('/api/tls/status');
        const d = await r.json();

        const enabledCb = document.getElementById('tlsEnabled');
        const certCard = document.getElementById('tlsCertCard');
        const installCard = document.getElementById('tlsInstallCard');

        if (enabledCb) enabledCb.checked = !!d.enabled;

        if (d.exists) {
          if (certCard) certCard.style.display = 'block';
          if (installCard) installCard.style.display = 'block';
          const infoEl = document.getElementById('tlsCertInfo');
          if (infoEl) {
            const expires = d.notAfter ? new Date(d.notAfter).toLocaleDateString() : '—';
            infoEl.innerHTML =
              '<div style="margin-bottom:4px;"><span style="color:#6b7280;display:inline-block;width:90px;">Fingerprint</span>' +
              '<span style="color:#f59e0b;word-break:break-all;">' + (d.fingerprint || '—') + '</span></div>' +
              '<div><span style="color:#6b7280;display:inline-block;width:90px;">Expires</span>' +
              '<span style="color:#c4c9d4;">' + expires + ' (' + (d.daysLeft ?? '?') + ' days)</span></div>';
          }
          renderTlsInstallInstructions();
        } else {
          if (certCard) certCard.style.display = 'none';
          if (installCard) installCard.style.display = 'none';
        }
      } catch (e) {
        console.error('Failed to load TLS status:', e.message);
      }
    }

    function renderTlsInstallInstructions() {
      const el = document.getElementById('tlsInstallInstructions');
      const btn = document.getElementById('tlsInstallBtn');
      if (!el) return;
      const ua = navigator.userAgent;
      let html = '';
      if (/Windows/i.test(ua)) {
        html = '<p style="font-size:13px;color:#9ca3af;line-height:1.5;">' +
          'Click <em>Install Certificate</em> to run <code style="color:#f59e0b;">certutil -addstore -f ROOT</code>. ' +
          'If it fails, download the certificate and double-click it, then choose ' +
          '<strong>Install Certificate → Local Machine → Trusted Root Certification Authorities</strong>.</p>';
      } else if (/Macintosh|Mac OS/i.test(ua)) {
        html = '<p style="font-size:13px;color:#9ca3af;line-height:1.5;">' +
          'Click <em>Install Certificate</em> to run <code style="color:#f59e0b;">security add-trusted-cert</code>. ' +
          'If it asks for your password, enter your macOS login password. ' +
          'If it fails, open <strong>Keychain Access</strong>, drag the downloaded .crt file into ' +
          '<strong>System</strong>, then double-click it and set <em>SSL → Always Trust</em>.</p>';
      } else {
        // Linux — no auto-install
        if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
        html = '<p style="font-size:13px;color:#9ca3af;line-height:1.5;">' +
          'Download the certificate and run the following commands:</p>' +
          '<code style="display:block;background:#0a0e14;border:1px solid #1e2530;border-radius:6px;' +
          'padding:10px;font-size:12px;color:#f59e0b;margin:8px 0;line-height:1.7;">' +
          'sudo cp ~/Downloads/rig-bridge.crt /usr/local/share/ca-certificates/<br>' +
          'sudo update-ca-certificates</code>' +
          '<p style="font-size:12px;color:#6b7280;">Then import the certificate into your browser certificate store ' +
          '(Settings → Privacy &amp; Security → Manage Certificates).</p>';
      }
      el.innerHTML = html;
    }

    async function onTlsToggle(enabled) {
      try {
        const r = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ tls: { enabled } }),
        });
        const d = await r.json();
        if (d.success) {
          showToast(enabled
            ? 'HTTPS enabled — restart rig-bridge to apply'
            : 'HTTP mode — restart rig-bridge to apply', 'success');
          await loadTlsStatus();
        } else {
          showToast(d.error || 'Failed to update TLS setting', 'error');
          const cb = document.getElementById('tlsEnabled');
          if (cb) cb.checked = !enabled;
        }
      } catch (e) {
        showToast('Failed to save TLS setting: ' + e.message, 'error');
        const cb = document.getElementById('tlsEnabled');
        if (cb) cb.checked = !enabled;
      }
    }

    function downloadCert() {
      const a = document.createElement('a');
      a.href = '/api/tls/cert';
      a.download = 'rig-bridge.crt';
      // Add token as a query param isn't supported by this endpoint — it uses the header.
      // Instead trigger via fetch+blob so the auth header is sent.
      fetch('/api/tls/cert', { headers: authHeaders() })
        .then((r) => {
          if (!r.ok) throw new Error('Cert not available');
          return r.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          a.href = url;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        })
        .catch((e) => showToast('Download failed: ' + e.message, 'error'));
    }

    async function regenCert() {
      if (!confirm('Regenerate the self-signed certificate?\\n\\nAny existing browser trust for the old certificate will be lost and you will need to install the new one.')) return;
      try {
        const r = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ tls: { enabled: true, forceRegen: true } }),
        });
        const d = await r.json();
        if (d.success) {
          showToast('Certificate regenerated — restart rig-bridge to use the new cert', 'success');
          await loadTlsStatus();
        } else {
          showToast(d.error || 'Failed to regenerate certificate', 'error');
        }
      } catch (e) {
        showToast('Failed to regenerate certificate: ' + e.message, 'error');
      }
    }

    async function installCert() {
      const btn = document.getElementById('tlsInstallBtn');
      const resultEl = document.getElementById('tlsInstallResult');
      if (btn) btn.disabled = true;
      if (resultEl) { resultEl.textContent = 'Running installer…'; resultEl.style.color = '#9ca3af'; }

      try {
        const r = await fetch('/api/tls/install', { method: 'POST', headers: authHeaders() });
        const d = await r.json();
        if (d.success) {
          if (resultEl) { resultEl.textContent = 'Certificate installed successfully. Restart your browser.'; resultEl.style.color = '#22c55e'; }
        } else if (d.manual) {
          if (resultEl) { resultEl.textContent = 'Auto-install not available on Linux. Use the commands above.'; resultEl.style.color = '#f59e0b'; }
        } else {
          const msg = d.command
            ? 'Install failed (needs admin). Run manually:\\n' + d.command
            : (d.error || 'Install failed');
          if (resultEl) {
            resultEl.innerHTML = 'Install failed (needs admin access). Run this command manually:<br>' +
              '<code style="font-size:11px;color:#f59e0b;word-break:break-all;">' + escHtml(d.command || '') + '</code>';
            resultEl.style.color = '#ef4444';
          }
        }
      } catch (e) {
        if (resultEl) { resultEl.textContent = 'Install request failed: ' + e.message; resultEl.style.color = '#ef4444'; }
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    doAutoLogin();
  </script>
</body>
</html>`;
}

function createServer(registry, version) {
  const app = express();

  // SECURITY: Restrict CORS to OpenHamClock origins instead of wildcard.
  // Wildcard CORS allows any website the user visits to silently call localhost:5555
  // endpoints (including PTT) via the browser's fetch API.
  const allowedOrigins = (config.corsOrigins || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Always allow the local setup UI and common OHC origins
  const tlsEnabled = !!(config.tls && config.tls.enabled);
  const defaultOrigins = [
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8443',
    'http://127.0.0.1:8443',
    'https://openhamclock.com',
    'https://www.openhamclock.com',
  ];
  // When TLS is enabled the setup UI is served over https://, so add HTTPS variants
  if (tlsEnabled) {
    defaultOrigins.push(
      `https://localhost:${config.port}`,
      `https://127.0.0.1:${config.port}`,
      'https://localhost:3000',
      'https://localhost:3001',
      'https://127.0.0.1:3000',
      'https://127.0.0.1:3001',
      'https://localhost:8080',
      'https://127.0.0.1:8080',
      'https://localhost:8443',
      'https://127.0.0.1:8443',
    );
  }
  const origins = [...new Set([...defaultOrigins, ...allowedOrigins])];

  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        // Allow requests with no origin (curl, Postman, server-to-server)
        if (!requestOrigin) return callback(null, true);
        if (origins.includes(requestOrigin)) return callback(null, true);
        console.warn(
          `[CORS] Blocked request from origin: ${requestOrigin} — add it to corsOrigins in rig-bridge-config.json`,
        );
        callback(null, false);
      },
      methods: ['GET', 'POST'],
    }),
  );
  app.use(express.json());

  // ─── Auth middleware ───────────────────────────────────────────────────
  // When apiToken is set (non-empty), all write endpoints require the token
  // in the X-RigBridge-Token header. Reads and SSE streams are not gated so
  // that the setup UI status bar and log stream keep working on the login screen.
  function requireAuth(req, res, next) {
    if (!config.apiToken) return next(); // auth disabled — backwards-compatible
    const provided = req.headers['x-rigbridge-token'] || '';
    if (provided === config.apiToken) return next();
    console.warn(`[Auth] Rejected ${req.method} ${req.path} — invalid or missing token`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Rate limiters — per IP, sliding window
  const freqLimiter = makeRateLimiter(20, 1000); // 20/s
  const modeLimiter = makeRateLimiter(10, 1000); // 10/s
  const pttLimiter = makeRateLimiter(5, 1000); // 5/s
  const cfgLimiter = makeRateLimiter(10, 60000); // 10/min
  const tokenLimiter = makeRateLimiter(3, 60000); // 3/min

  // Allow plugins to register their own routes
  registry.registerRoutes(app);

  // ─── Setup Web UI ───
  app.get('/', (req, res) => {
    if (!req.headers.accept || !req.headers.accept.includes('text/html')) {
      return res.json({ status: 'ok', connected: state.connected, version });
    }
    // SECURITY: On first run (token not yet displayed), embed the token once so
    // doAutoLogin() can authenticate without the user needing to type it.
    // Flip tokenDisplayed immediately so subsequent page loads show the login gate.
    const isFirstRun = config.apiToken && !config.tokenDisplayed;
    if (isFirstRun) {
      config.tokenDisplayed = true;
      saveConfig();
    }
    res.send(buildSetupHtml(version, isFirstRun ? config.apiToken : null));
  });

  // ─── API: Live console log stream (SSE) ───
  app.get('/api/log/stream', (req, res) => {
    // Auth via query param — EventSource cannot set custom headers
    if (config.apiToken) {
      const token = req.query.token || '';
      if (token !== config.apiToken) {
        res.status(401).end();
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send buffered history so a freshly opened tab sees recent output
    res.write(`event: history\ndata: ${JSON.stringify(logBuffer)}\n\n`);

    const clientId = Date.now() + Math.random();
    logSseClients.push({ id: clientId, res });

    req.on('close', () => {
      logSseClients = logSseClients.filter((c) => c.id !== clientId);
    });
  });

  // ─── API: Console logging toggle ───
  app.get('/api/logging', (req, res) => {
    res.json({ logging: config.logging });
  });

  app.post('/api/logging', requireAuth, (req, res) => {
    const { logging } = req.body;
    if (typeof logging !== 'boolean') return res.status(400).json({ error: 'logging must be a boolean' });
    config.logging = logging;
    saveConfig();
    console.log(`[Server] Console logging ${logging ? 'enabled' : 'disabled'}`);
    res.json({ success: true, logging: config.logging });
  });

  // ─── API: List serial ports ───
  app.get('/api/ports', requireAuth, async (req, res) => {
    const ports = await listPorts();
    res.json(ports);
  });

  // ─── API: Get/Set config ───

  // Validate serial port paths to prevent arbitrary file access
  const isValidSerialPort = (p) => {
    if (!p || typeof p !== 'string') return false;
    // Windows: COM1-COM256
    if (/^COM\d{1,3}$/i.test(p)) return true;
    // Linux: /dev/ttyUSB*, /dev/ttyACM*, /dev/ttyS*, /dev/ttyAMA*
    if (/^\/dev\/tty(USB|ACM|S|AMA)\d+$/.test(p)) return true;
    // macOS: /dev/cu.* or /dev/tty.*
    if (/^\/dev\/(cu|tty)\.[A-Za-z0-9._-]+$/.test(p)) return true;
    return false;
  };

  app.get('/api/config', (req, res) => {
    // Strip the API token from the response — it must not be readable via GET
    const { apiToken: _omit, ...safeConfig } = config;
    res.json(safeConfig);
  });

  app.post('/api/config', requireAuth, cfgLimiter, async (req, res) => {
    const newConfig = req.body;
    if (newConfig.port) config.port = newConfig.port;
    if (newConfig.radio) {
      // Validate serial port path if provided
      if (newConfig.radio.serialPort && !isValidSerialPort(newConfig.radio.serialPort)) {
        return res.status(400).json({ success: false, error: 'Invalid serial port path' });
      }
      // SECURITY: Validate remote host fields to prevent SSRF
      const hostFields = [
        ['flrigHost', newConfig.radio.flrigHost],
        ['rigctldHost', newConfig.radio.rigctldHost],
      ];
      for (const [field, val] of hostFields) {
        if (val !== undefined && !isValidRemoteHost(val)) {
          return res.status(400).json({ success: false, error: `Invalid host value for ${field}` });
        }
      }
      // Validate port fields
      const portFields = [
        ['flrigPort', newConfig.radio.flrigPort],
        ['rigctldPort', newConfig.radio.rigctldPort],
      ];
      for (const [field, val] of portFields) {
        if (val !== undefined && !isValidPort(val)) {
          return res.status(400).json({ success: false, error: `Invalid port value for ${field}` });
        }
      }
      config.radio = { ...config.radio, ...newConfig.radio };
    }
    if (typeof newConfig.logging === 'boolean') {
      config.logging = newConfig.logging;
    }
    if (newConfig.wsjtxRelay) {
      config.wsjtxRelay = { ...config.wsjtxRelay, ...newConfig.wsjtxRelay };
    }
    if (newConfig.tci) {
      if (newConfig.tci.host !== undefined && !isValidRemoteHost(newConfig.tci.host)) {
        return res.status(400).json({ success: false, error: 'Invalid host value for tci.host' });
      }
      if (newConfig.tci.port !== undefined && !isValidPort(newConfig.tci.port)) {
        return res.status(400).json({ success: false, error: 'Invalid port value for tci.port' });
      }
      config.tci = { ...config.tci, ...newConfig.tci };
    }
    if (newConfig.smartsdr) {
      if (newConfig.smartsdr.host !== undefined && !isValidRemoteHost(newConfig.smartsdr.host)) {
        return res.status(400).json({ success: false, error: 'Invalid host value for smartsdr.host' });
      }
      if (newConfig.smartsdr.port !== undefined && !isValidPort(newConfig.smartsdr.port)) {
        return res.status(400).json({ success: false, error: 'Invalid port value for smartsdr.port' });
      }
      config.smartsdr = { ...config.smartsdr, ...newConfig.smartsdr };
    }
    if (newConfig.rtltcp) {
      if (newConfig.rtltcp.host !== undefined && !isValidRemoteHost(newConfig.rtltcp.host)) {
        return res.status(400).json({ success: false, error: 'Invalid host value for rtltcp.host' });
      }
      if (newConfig.rtltcp.port !== undefined && !isValidPort(newConfig.rtltcp.port)) {
        return res.status(400).json({ success: false, error: 'Invalid port value for rtltcp.port' });
      }
      config.rtltcp = { ...config.rtltcp, ...newConfig.rtltcp };
    }
    // Deep-merge plugin config sections
    for (const key of ['mshv', 'jtdx', 'js8call', 'aprs', 'rotator', 'cloudRelay', 'winlink', 'meshcom']) {
      if (newConfig[key]) {
        config[key] = { ...(config[key] || {}), ...newConfig[key] };
        // Handle nested objects (e.g. winlink.pat)
        if (newConfig[key].pat && config[key].pat) {
          config[key].pat = { ...config[key].pat, ...newConfig[key].pat };
        }
      }
    }

    // TLS config — handle enable/disable and optional cert regeneration
    if (newConfig.tls) {
      const forceRegen = !!newConfig.tls.forceRegen;
      const tlsPayload = { ...newConfig.tls };
      delete tlsPayload.forceRegen; // transient flag — never persisted
      config.tls = { ...(config.tls || {}), ...tlsPayload };

      if (config.tls.enabled) {
        try {
          await tlsModule.ensureCerts(forceRegen);
          config.tls.certGenerated = true;
        } catch (e) {
          console.error('[TLS] Certificate generation failed:', e.message);
          config.tls.enabled = false;
          saveConfig();
          return res.json({ success: false, error: `TLS cert generation failed: ${e.message}` });
        }
      }
    }

    // macOS: tty.* (dial-in) blocks open() — silently upgrade to cu.* (call-out)
    if (process.platform === 'darwin' && config.radio.serialPort?.startsWith('/dev/tty.')) {
      config.radio.serialPort = config.radio.serialPort.replace('/dev/tty.', '/dev/cu.');
    }
    saveConfig();

    // Restart radio connection if radio config changed
    if (newConfig.radio) {
      registry.switchPlugin(config.radio.type);
    }

    // Restart WSJT-X relay if its config changed
    if (newConfig.wsjtxRelay) {
      registry.restartIntegration('wsjtx-relay');
    }

    res.json({ success: true, config });
  });

  // ─── API: Test serial port connection ───
  app.post('/api/test', requireAuth, async (req, res) => {
    const testPort = req.body.serialPort || config.radio.serialPort;
    if (!isValidSerialPort(testPort)) {
      return res.json({ success: false, error: 'Invalid serial port path' });
    }
    const testBaud = req.body.baudRate || config.radio.baudRate;
    const testStopBits = req.body.stopBits || config.radio.stopBits || 1;
    const testRtscts = req.body.rtscts !== undefined ? !!req.body.rtscts : !!config.radio.rtscts;

    const SP = getSerialPort();
    if (!SP) return res.json({ success: false, error: 'serialport module not available' });

    try {
      const testConn = new SP({
        path: testPort,
        baudRate: testBaud,
        stopBits: testStopBits,
        rtscts: testRtscts,
        autoOpen: false,
      });

      testConn.open((err) => {
        if (err) {
          return res.json({ success: false, error: err.message });
        }
        // Even for test, set DTR/RTS if not using hardware flow
        if (!testRtscts) {
          testConn.set({ dtr: true, rts: true }, (setErr) => {
            if (setErr) console.warn(`[Server] Could not set DTR/RTS during test: ${setErr.message}`);
          });
        }
        testConn.close(() => {
          res.json({ success: true, message: `Successfully opened ${testPort} at ${testBaud} baud` });
        });
      });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // ─── API: Auth & token management ─────────────────────────────────────

  // Verify a token — used by the setup UI login form (not protected by requireAuth)
  app.post('/api/auth/verify', (req, res) => {
    const { token } = req.body || {};
    if (!config.apiToken) return res.json({ success: true }); // auth disabled
    if (token === config.apiToken) return res.json({ success: true });
    return res.status(401).json({ success: false, error: 'Invalid token' });
  });

  // Return current token (requireAuth — only already-authenticated callers)
  app.get('/api/token', requireAuth, (req, res) => {
    res.json({ tokenSet: !!config.apiToken, apiToken: config.apiToken });
  });

  // Regenerate the API token
  app.post('/api/token/regenerate', requireAuth, tokenLimiter, (req, res) => {
    const crypto = require('crypto');
    config.apiToken = crypto.randomBytes(16).toString('hex');
    config.tokenDisplayed = false;
    saveConfig();
    console.log('[Server] API token regenerated');
    res.json({ success: true, apiToken: config.apiToken });
  });

  // Mark that the setup UI has shown the first-run token banner
  app.post('/api/setup/token-seen', (req, res) => {
    config.tokenDisplayed = true;
    saveConfig();
    res.json({ success: true });
  });

  // ─── API: TLS / HTTPS certificate management ─────────────────────────
  // No auth on /status — the Security tab needs this before login succeeds.
  app.get('/api/tls/status', (req, res) => {
    const info = tlsModule.getCertInfo();
    res.json({ enabled: !!(config.tls && config.tls.enabled), ...info });
  });

  // Download the PEM certificate — used by the "Download Certificate" button in the UI.
  // Token-gated: downloading the cert allows a user to install it as trusted, which
  // only makes sense for someone who already has access to the setup UI.
  app.get('/api/tls/cert', requireAuth, (req, res) => {
    const fs = require('fs');
    if (!fs.existsSync(tlsModule.CERT_PATH)) {
      return res.status(404).json({ error: 'No certificate found. Enable HTTPS first.' });
    }
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="rig-bridge.crt"');
    res.sendFile(tlsModule.CERT_PATH);
  });

  // Attempt OS-level certificate installation. On permission failure the command
  // is returned for the user to run manually.
  // Uses execFile (not exec) with an explicit args array — CERT_PATH is never
  // interpolated into a shell string, so unusual home directory characters cannot
  // affect command parsing.
  app.post('/api/tls/install', requireAuth, (req, res) => {
    const fs = require('fs');
    const { execFile } = require('child_process');
    const certPath = tlsModule.CERT_PATH;
    if (!fs.existsSync(certPath)) {
      return res.status(404).json({ error: 'No certificate found. Enable HTTPS first.' });
    }
    let bin, args, humanCmd;
    if (process.platform === 'darwin') {
      bin = 'security';
      args = ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', certPath];
      humanCmd = `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`;
    } else if (process.platform === 'win32') {
      bin = 'certutil';
      args = ['-addstore', '-f', 'ROOT', certPath];
      humanCmd = `certutil -addstore -f ROOT "${certPath}"`;
    } else {
      // Linux: many distros, provide manual instructions only
      return res.json({
        success: false,
        manual: true,
        platform: 'linux',
        certPath,
      });
    }
    execFile(bin, args, (err) => {
      if (err) {
        // Likely a permission error — return a human-readable command for manual use
        return res.json({ success: false, error: err.message, command: humanCmd, certPath });
      }
      res.json({ success: true });
    });
  });

  // ─── OHC-compatible API ───
  // ─── Message Log API ─────────────────────────────────────────────────
  app.get('/api/messages', (req, res) => {
    const log = registry.services?.messageLog;
    if (!log) return res.json({ entries: [] });
    const { callsign, type, since, until, limit } = req.query;
    const entries = log.query({
      callsign,
      type,
      since: since ? parseInt(since) : undefined,
      until: until ? parseInt(until) : undefined,
      limit: limit ? parseInt(limit) : 200,
    });
    res.json({ count: entries.length, entries });
  });

  app.get('/api/messages/export', (req, res) => {
    const log = registry.services?.messageLog;
    if (!log) return res.status(503).json({ error: 'Message log not available' });
    const format = req.query.format || 'csv';
    const filters = {
      callsign: req.query.callsign,
      type: req.query.type,
      since: req.query.since ? parseInt(req.query.since) : undefined,
    };
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="messages.csv"');
      res.send(log.exportCSV(filters));
    } else {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="messages.txt"');
      res.send(log.exportText(filters));
    }
  });

  app.get('/api/messages/stats', (req, res) => {
    const log = registry.services?.messageLog;
    if (!log) return res.json({ total: 0 });
    res.json(log.stats());
  });

  // Diagnostic endpoint — no auth required, designed for troubleshooting
  app.get('/api/status', (req, res) => {
    res.json({
      sseClients: getSseClientCount(),
      uptime: Math.floor(process.uptime()),
    });
  });

  app.get('/health', (req, res) => {
    // Collect integration plugin status
    const integrations = {};
    for (const [id, instance] of registry.getIntegrations()) {
      if (typeof instance.getStatus === 'function') {
        integrations[id] = instance.getStatus();
      }
    }

    res.json({
      auth: config.apiToken ? 'enabled' : 'disabled',
      plugin: registry.activeId || 'none',
      connected: state.connected,
      freq: state.freq,
      mode: state.mode,
      ptt: state.ptt,
      pttEnabled: !!(config.radio && config.radio.pttEnabled),
      integrations,
      configPath: CONFIG_PATH,
      uptime: Math.floor(process.uptime()),
    });
  });

  app.get('/status', (req, res) => {
    res.json({
      connected: state.connected,
      freq: state.freq,
      mode: state.mode,
      width: state.width,
      ptt: state.ptt,
      timestamp: state.lastUpdate,
    });
  });

  app.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const initialData = {
      type: 'init',
      connected: state.connected,
      freq: state.freq,
      mode: state.mode,
      width: state.width,
      ptt: state.ptt,
    };
    res.write(`data: ${JSON.stringify(initialData)}\n\n`);

    // Send plugin-init so the browser immediately sees which integrations are
    // running and gets a replay of recent decodes (no waiting for next FT8 cycle).
    const recentDecodes = getDecodeRingBuffer();
    const runningPlugins = Array.from(registry.getIntegrations().keys());
    res.write(
      `data: ${JSON.stringify({
        type: 'plugin-init',
        plugins: runningPlugins,
        decodes: recentDecodes,
      })}\n\n`,
    );

    const clientId = Date.now() + Math.random();
    addSseClient(clientId, res);

    req.on('close', () => {
      removeSseClient(clientId);
    });
  });

  app.post('/freq', requireAuth, freqLimiter, (req, res) => {
    const { freq } = req.body;
    if (!freq) return res.status(400).json({ error: 'Missing freq' });
    const hz = Number(freq);
    if (!Number.isFinite(hz) || hz < 1000 || hz > 75e9) {
      return res.status(400).json({ error: 'Frequency out of range (1 kHz–75 GHz)' });
    }
    if (!registry.dispatch('setFreq', hz)) {
      return res.status(503).json({ error: 'No radio plugin active' });
    }
    res.json({ success: true });
  });

  app.post('/mode', requireAuth, modeLimiter, (req, res) => {
    const { mode } = req.body;
    if (!mode) return res.status(400).json({ error: 'Missing mode' });
    if (typeof mode !== 'string' || !/^[A-Za-z0-9-]{1,20}$/.test(mode)) {
      return res.status(400).json({ error: 'Invalid mode value' });
    }
    if (!registry.dispatch('setMode', mode)) {
      return res.status(503).json({ error: 'No radio plugin active' });
    }
    res.json({ success: true });
  });

  app.post('/ptt', requireAuth, pttLimiter, (req, res) => {
    const { ptt } = req.body;
    if (ptt && !config.radio.pttEnabled) {
      return res.status(403).json({ error: 'PTT disabled in configuration' });
    }
    if (!registry.dispatch('setPTT', !!ptt)) {
      return res.status(503).json({ error: 'No radio plugin active' });
    }
    res.json({ success: true });
  });

  return app;
}

async function startServer(port, registry, version) {
  const app = createServer(registry, version);

  // SECURITY: Bind to localhost by default. Set bindAddress to '0.0.0.0' in
  // rig-bridge-config.json only if you need LAN access (e.g. bridge on a Pi,
  // browser on a desktop).
  const bindAddress = config.bindAddress || '127.0.0.1';

  let server;
  let protocol = 'http';

  if (config.tls && config.tls.enabled) {
    try {
      await tlsModule.ensureCerts();
      const { key, cert } = tlsModule.loadCreds();
      const https = require('https');
      server = https.createServer({ key, cert }, app);
      protocol = 'https';
      console.log('[TLS] Starting HTTPS server with self-signed certificate');
    } catch (e) {
      console.error(`[TLS] Failed to start HTTPS (${e.message}) — falling back to HTTP`);
      server = require('http').createServer(app);
    }
  } else {
    server = require('http').createServer(app);
  }

  return new Promise((resolve, reject) => {
    server.listen(port, bindAddress, () => {
      const versionLabel = `v${version}`.padEnd(8);
      const uiUrl = `${protocol}://localhost:${port}`;
      console.log('');
      console.log('  ╔══════════════════════════════════════════════╗');
      console.log(`  ║   📻  OpenHamClock Rig Bridge  ${versionLabel}      ║`);
      console.log('  ╠══════════════════════════════════════════════╣');
      console.log(`  ║   Setup UI:  ${uiUrl.padEnd(32)}║`);
      if (protocol === 'https') {
        console.log('  ║   🔒 HTTPS enabled — install certificate     ║');
      }
      console.log(`  ║   Radio:     ${(config.radio.type || 'none').padEnd(30)}║`);
      if (bindAddress !== '127.0.0.1') {
        console.log(`  ║   ⚠ Bound to ${bindAddress.padEnd(33)}║`);
      }
      console.log('  ╚══════════════════════════════════════════════╝');
      console.log(`  Config: ${CONFIG_PATH}`);
      console.log('');
      resolve();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n[Server] ERROR: Port ${port} is already in use.`);
        console.error(`         Another instance of Rig Bridge might be running.`);
        console.error(`         Please close it or use --port <new_port> to start another one.\n`);
        process.exit(1);
      } else {
        console.error(`\n[Server] Unexpected error: ${err.message}\n`);
        reject(err);
      }
    });
  });
}

module.exports = { startServer };
