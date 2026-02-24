'use strict';
/**
 * server.js — Express HTTP server, all API routes, and SSE endpoint
 *
 * Exposes the openhamclock-compatible API:
 *   GET  /             Setup UI (HTML) or JSON health check
 *   GET  /status       Current rig state snapshot
 *   GET  /stream       SSE stream for real-time state updates
 *   POST /freq         Set frequency  { freq: Hz }
 *   POST /mode         Set mode       { mode: string }
 *   POST /ptt          Set PTT        { ptt: boolean }
 *   GET  /api/ports    List available serial ports
 *   GET  /api/config   Get current config
 *   POST /api/config   Update config and reconnect
 *   POST /api/test     Test a serial port connection
 */

const express = require('express');
const cors = require('cors');
const { getSerialPort, listPorts } = require('./serial-utils');
const { state, addSseClient, removeSseClient } = require('./state');
const { config, saveConfig } = require('./config');

const SETUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenHamClock Rig Bridge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0a0e14;
      color: #c4c9d4;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 30px 15px;
    }
    .container { max-width: 600px; width: 100%; }
    .header {
      text-align: center;
      margin-bottom: 30px;
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
      margin-bottom: 24px;
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
    .btn-primary {
      background: #00ffcc;
      color: #0a0e14;
    }
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
    .checkbox-row input[type="checkbox"] {
      width: 18px; height: 18px;
      cursor: pointer;
    }
    .checkbox-row span {
      font-size: 13px;
      color: #c4c9d4;
    }
    .port-info {
      font-size: 11px;
      color: #6b7280;
      padding: 2px 6px;
      background: #1a1f2a;
      border-radius: 3px;
    }
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
    @media (max-width: 500px) {
      .row { flex-direction: column; gap: 0; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📻 OpenHamClock Rig Bridge</h1>
      <div class="subtitle">Direct USB connection to your radio — no flrig or rigctld needed</div>
    </div>

    <!-- Live Status -->
    <div class="status-bar" id="statusBar">
      <div class="status-dot" id="statusDot"></div>
      <span id="statusLabel">Disconnected</span>
      <span class="status-freq" id="statusFreq">—</span>
      <span class="status-mode" id="statusMode"></span>
    </div>

    <!-- Radio Type -->
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
        <optgroup label="Via Control Software (Legacy)">
          <option value="flrig">flrig (XML-RPC)</option>
          <option value="rigctld">rigctld / Hamlib (TCP)</option>
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
          <div>
            <label>Stop Bits</label>
            <select id="stopBits">
              <option value="1">1</option>
              <option value="2" selected>2</option>
            </select>
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
      <strong>Setup in OpenHamClock:</strong><br>
      1. Open <strong>Settings</strong> → <strong>Station Settings</strong> → <strong>Rig Control</strong><br>
      2. Check <strong>Enable Rig Control</strong><br>
      3. Set Host URL to: <code>http://localhost:5555</code><br>
      4. Click any DX spot, POTA, or SOTA to tune your radio! 🎉
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let currentConfig = null;
    let statusInterval = null;

    async function init() {
      try {
        const res = await fetch('/api/config');
        currentConfig = await res.json();
        populateForm(currentConfig);
        refreshPorts();
        startStatusPoll();
      } catch (e) {
        showToast('Failed to load config', 'error');
      }
    }

    function populateForm(cfg) {
      const r = cfg.radio || {};
      document.getElementById('radioType').value = r.type || 'none';
      document.getElementById('baudRate').value = r.baudRate || 38400;
      document.getElementById('stopBits').value = r.stopBits || 2;
      document.getElementById('icomAddress').value = r.icomAddress || '0x94';
      document.getElementById('pollInterval').value = r.pollInterval || 500;
      document.getElementById('pttEnabled').checked = !!r.pttEnabled;
      document.getElementById('legacyHost').value = r.type === 'rigctld' ? (r.rigctldHost || '127.0.0.1') : (r.flrigHost || '127.0.0.1');
      document.getElementById('legacyPort').value = r.type === 'rigctld' ? (r.rigctldPort || 4532) : (r.flrigPort || 12345);
      onTypeChange();
    }

    function onTypeChange() {
      const type = document.getElementById('radioType').value;
      const isDirect = ['yaesu', 'kenwood', 'icom'].includes(type);
      const isLegacy = ['flrig', 'rigctld'].includes(type);

      document.getElementById('serialOpts').className = 'serial-opts' + (isDirect ? ' show' : '');
      document.getElementById('legacyOpts').className = 'legacy-opts' + (isLegacy ? ' show' : '');
      document.getElementById('icomAddr').className = 'icom-addr' + (type === 'icom' ? ' show' : '');

      if (type === 'yaesu') {
        document.getElementById('stopBits').value = '2';
      } else if (type === 'kenwood' || type === 'icom') {
        document.getElementById('stopBits').value = '1';
      }
      if (type === 'rigctld') {
        document.getElementById('legacyPort').value = '4532';
      } else if (type === 'flrig') {
        document.getElementById('legacyPort').value = '12345';
      }
    }

    async function refreshPorts() {
      const sel = document.getElementById('serialPort');
      sel.innerHTML = '<option value="">Scanning...</option>';
      try {
        const res = await fetch('/api/ports');
        const ports = await res.json();
        sel.innerHTML = '<option value="">— Select port —</option>';
        if (ports.length === 0) {
          sel.innerHTML += '<option value="" disabled>No ports found — is your radio plugged in via USB?</option>';
        }
        ports.forEach(p => {
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
      const serialPort = document.getElementById('serialPort').value;
      const baudRate = parseInt(document.getElementById('baudRate').value);
      const type = document.getElementById('radioType').value;

      if (['yaesu', 'kenwood', 'icom'].includes(type)) {
        if (!serialPort) return showToast('Select a serial port first', 'error');
        try {
          const res = await fetch('/api/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serialPort, baudRate }),
          });
          const data = await res.json();
          showToast(data.success ? '✅ ' + data.message : '❌ ' + data.error, data.success ? 'success' : 'error');
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

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ radio }),
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

    init();
  </script>
</body>
</html>`;

function createServer(registry) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Allow plugins to register their own routes
  registry.registerRoutes(app);

  // ─── Setup Web UI ───
  app.get('/', (req, res) => {
    if (!req.headers.accept || !req.headers.accept.includes('text/html')) {
      return res.json({ status: 'ok', connected: state.connected, version: '1.0.0' });
    }
    res.send(SETUP_HTML);
  });

  // ─── API: List serial ports ───
  app.get('/api/ports', async (req, res) => {
    const ports = await listPorts();
    res.json(ports);
  });

  // ─── API: Get/Set config ───
  app.get('/api/config', (req, res) => {
    res.json(config);
  });

  app.post('/api/config', (req, res) => {
    const newConfig = req.body;
    if (newConfig.port) config.port = newConfig.port;
    if (newConfig.radio) {
      config.radio = { ...config.radio, ...newConfig.radio };
    }
    saveConfig();

    // Restart connection with new config
    registry.switchPlugin(config.radio.type);

    res.json({ success: true, config });
  });

  // ─── API: Test serial port connection ───
  app.post('/api/test', async (req, res) => {
    const testPort = req.body.serialPort || config.radio.serialPort;
    const testBaud = req.body.baudRate || config.radio.baudRate;

    const SP = getSerialPort();
    if (!SP) return res.json({ success: false, error: 'serialport module not available' });

    try {
      const testConn = new SP({
        path: testPort,
        baudRate: testBaud,
        autoOpen: false,
      });

      testConn.open((err) => {
        if (err) {
          return res.json({ success: false, error: err.message });
        }
        testConn.close(() => {
          res.json({ success: true, message: `Successfully opened ${testPort} at ${testBaud} baud` });
        });
      });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // ─── OHC-compatible API ───
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

    const clientId = Date.now() + Math.random();
    addSseClient(clientId, res);

    req.on('close', () => {
      removeSseClient(clientId);
    });
  });

  app.post('/freq', (req, res) => {
    const { freq } = req.body;
    if (!freq) return res.status(400).json({ error: 'Missing freq' });
    registry.dispatch('setFreq', freq);
    res.json({ success: true });
  });

  app.post('/mode', (req, res) => {
    const { mode } = req.body;
    if (!mode) return res.status(400).json({ error: 'Missing mode' });
    registry.dispatch('setMode', mode);
    res.json({ success: true });
  });

  app.post('/ptt', (req, res) => {
    const { ptt } = req.body;
    if (ptt && !config.radio.pttEnabled) {
      return res.status(403).json({ error: 'PTT disabled in configuration' });
    }
    registry.dispatch('setPTT', !!ptt);
    res.json({ success: true });
  });

  return app;
}

function startServer(port, registry) {
  const app = createServer(registry);
  app.listen(port, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   📻  OpenHamClock Rig Bridge  v1.1.0       ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log(`  ║   Setup UI:  http://localhost:${port}          ║`);
    console.log(`  ║   Radio:     ${(config.radio.type || 'none').padEnd(30)}║`);
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
  });
}

module.exports = { startServer };
