#!/usr/bin/env node
/**
 * OpenHamClock Rig Bridge v1.0.0
 * 
 * Standalone bridge that talks DIRECTLY to your radio via USB serial.
 * No flrig, no rigctld, no Node.js install needed (when compiled with pkg).
 * 
 * Supports: Yaesu (FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, etc.)
 *           Kenwood (TS-890, TS-590, TS-2000, etc.)
 *           Icom (IC-7300, IC-7610, IC-9700, IC-705, etc.)
 *           + Legacy flrig/rigctld backends
 * 
 * Usage:  node rig-bridge.js          (then open http://localhost:5555 to configure)
 *         ohc-rig-bridge-win.exe      (compiled standalone)
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const net = require('net');

// ─── Portable config path (works in pkg snapshots too) ───
const CONFIG_DIR = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;
const CONFIG_PATH = path.join(CONFIG_DIR, 'rig-bridge-config.json');

// ─── Defaults ───
const DEFAULT_CONFIG = {
  port: 5555,
  radio: {
    type: 'none',          // none | yaesu | kenwood | icom | flrig | rigctld
    serialPort: '',        // COM3, /dev/ttyUSB0, etc.
    baudRate: 38400,
    dataBits: 8,
    stopBits: 2,           // Yaesu default; Icom/Kenwood typically 1
    parity: 'none',
    icomAddress: '0x94',   // Default CI-V address for IC-7300
    pollInterval: 500,
    pttEnabled: false,
    // Legacy backend settings
    rigctldHost: '127.0.0.1',
    rigctldPort: 4532,
    flrigHost: '127.0.0.1',
    flrigPort: 12345,
  }
};

// ─── Load / save config ───
let config = { ...DEFAULT_CONFIG };
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      config = {
        ...DEFAULT_CONFIG,
        ...raw,
        radio: { ...DEFAULT_CONFIG.radio, ...(raw.radio || {}) }
      };
      console.log(`[Config] Loaded from ${CONFIG_PATH}`);
    }
  } catch (e) {
    console.error('[Config] Failed to load:', e.message);
  }
}
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`[Config] Saved to ${CONFIG_PATH}`);
  } catch (e) {
    console.error('[Config] Failed to save:', e.message);
  }
}
loadConfig();

// CLI overrides
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') config.port = parseInt(args[++i]);
}

// ─── Rig state ───
const state = {
  connected: false,
  freq: 0,
  mode: '',
  width: 0,
  ptt: false,
  lastUpdate: 0,
};

// ─── SSE clients ───
let sseClients = [];
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => c.res.write(msg));
}
function updateState(prop, value) {
  if (state[prop] !== value) {
    state[prop] = value;
    state.lastUpdate = Date.now();
    broadcast({ type: 'update', prop, value });
  }
}

// ═══════════════════════════════════════════════════════
// SERIAL PROTOCOL ADAPTERS
// ═══════════════════════════════════════════════════════

let serialConnection = null;
let pollTimer = null;
let rxBuffer = '';
let rxBinaryBuffer = Buffer.alloc(0);

// ─── Lazy-load serialport (may not be available in all envs) ───
let SerialPort = null;
function getSerialPort() {
  if (!SerialPort) {
    try {
      SerialPort = require('serialport').SerialPort;
    } catch (e) {
      console.error('[Serial] serialport module not available:', e.message);
    }
  }
  return SerialPort;
}

// ─── List available serial ports ───
async function listPorts() {
  try {
    const { SerialPort: SP } = require('serialport');
    const ports = await SP.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      serialNumber: p.serialNumber || '',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      friendlyName: p.friendlyName || p.path,
    }));
  } catch (e) {
    console.error('[Serial] Cannot list ports:', e.message);
    return [];
  }
}

// ─── Connect serial ───
function connectSerial() {
  const SP = getSerialPort();
  if (!SP || !config.radio.serialPort) return;

  disconnectSerial();

  console.log(`[Serial] Opening ${config.radio.serialPort} at ${config.radio.baudRate} baud...`);
  
  serialConnection = new SP({
    path: config.radio.serialPort,
    baudRate: config.radio.baudRate,
    dataBits: config.radio.dataBits || 8,
    stopBits: config.radio.stopBits || 2,
    parity: config.radio.parity || 'none',
    autoOpen: false,
  });

  serialConnection.open((err) => {
    if (err) {
      console.error(`[Serial] Failed to open: ${err.message}`);
      updateState('connected', false);
      // Retry in 5s
      setTimeout(connectSerial, 5000);
      return;
    }
    console.log('[Serial] Port opened successfully');
    updateState('connected', true);
    rxBuffer = '';
    rxBinaryBuffer = Buffer.alloc(0);

    // Start polling
    startPolling();
  });

  serialConnection.on('data', (data) => {
    if (config.radio.type === 'icom') {
      handleIcomData(data);
    } else {
      // Yaesu & Kenwood use ASCII semicolon-delimited
      rxBuffer += data.toString('ascii');
      processAsciiBuffer();
    }
  });

  serialConnection.on('error', (err) => {
    console.error(`[Serial] Error: ${err.message}`);
  });

  serialConnection.on('close', () => {
    console.log('[Serial] Port closed');
    updateState('connected', false);
    stopPolling();
    serialConnection = null;
    // Retry
    setTimeout(connectSerial, 5000);
  });
}

function disconnectSerial() {
  stopPolling();
  if (serialConnection && serialConnection.isOpen) {
    try { serialConnection.close(); } catch (e) {}
  }
  serialConnection = null;
}

function serialWrite(data) {
  if (!serialConnection || !serialConnection.isOpen) return false;
  serialConnection.write(data);
  return true;
}

// ─── Polling ───
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!serialConnection || !serialConnection.isOpen) return;
    
    switch (config.radio.type) {
      case 'yaesu':   pollYaesu(); break;
      case 'kenwood':  pollKenwood(); break;
      case 'icom':     pollIcom(); break;
    }
  }, config.radio.pollInterval || 500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ═══════════════════════════════════════════════════════
// YAESU CAT PROTOCOL
// Covers: FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, FT-5000, etc.
// Commands are ASCII, semicolon-terminated
// ═══════════════════════════════════════════════════════

function pollYaesu() {
  // FA = read VFO-A freq, MD0 = read main mode  
  // More reliable across models than IF which varies in format
  serialWrite('FA;');
  // Stagger mode query slightly to avoid buffer collisions
  setTimeout(() => serialWrite('MD0;'), 50);
}

function processAsciiBuffer() {
  let idx;
  while ((idx = rxBuffer.indexOf(';')) !== -1) {
    const response = rxBuffer.substring(0, idx);
    rxBuffer = rxBuffer.substring(idx + 1);
    
    if (config.radio.type === 'yaesu') {
      parseYaesuResponse(response);
    } else if (config.radio.type === 'kenwood') {
      parseKenwoodResponse(response);
    }
  }
  // Keep buffer from growing unbounded
  if (rxBuffer.length > 1000) rxBuffer = rxBuffer.slice(-200);
}

function parseYaesuResponse(resp) {
  if (!resp || resp.length < 2) return;
  const cmd = resp.substring(0, 2);

  switch (cmd) {
    case 'IF': {
      // IF response format (FT-991A):
      // IFaaaaaaaaabbbbcccccddeefffggg...
      // Positions: IF + 9 digit freq (3-11) + ...mode at pos 21
      if (resp.length >= 27) {
        const freqStr = resp.substring(2, 11);
        const freq = parseInt(freqStr, 10);
        if (freq > 0) updateState('freq', freq);

        // Mode digit at position 21 (0-indexed from after IF)
        const modeDigit = resp.charAt(21);
        const mode = YAESU_MODES[modeDigit] || state.mode;
        updateState('mode', mode);

        // PTT status at position 28 (TX state)
        if (resp.length >= 29) {
          const txState = resp.charAt(28);
          updateState('ptt', txState !== '0');
        }
      }
      break;
    }
    case 'FA': {
      const freq = parseInt(resp.substring(2), 10);
      if (freq > 0) updateState('freq', freq);
      break;
    }
    case 'MD': {
      // MD0X; format (FT-991A, FT-710, etc.) or MDX; (older models)
      // Extract last meaningful digit
      const modeStr = resp.substring(2);
      const modeDigit = modeStr.length >= 2 ? modeStr.charAt(1) : modeStr.charAt(0);
      const mode = YAESU_MODES[modeDigit] || state.mode;
      updateState('mode', mode);
      break;
    }
    case 'TX':
    case 'RX': {
      updateState('ptt', cmd === 'TX');
      break;
    }
  }
}

const YAESU_MODES = {
  '1': 'LSB', '2': 'USB', '3': 'CW', '4': 'FM',
  '5': 'AM', '6': 'RTTY-LSB', '7': 'CW-R', '8': 'DATA-LSB',
  '9': 'RTTY-USB', 'A': 'DATA-FM', 'B': 'FM-N', 'C': 'DATA-USB',
  'D': 'AM-N', 'E': 'C4FM'
};

const YAESU_MODE_REVERSE = {};
Object.entries(YAESU_MODES).forEach(([k, v]) => { YAESU_MODE_REVERSE[v] = k; });

function yaesuSetFreq(hz) {
  const padded = String(Math.round(hz)).padStart(9, '0');
  serialWrite(`FA${padded};`);
}

function yaesuSetMode(mode) {
  // Try direct match first
  let digit = YAESU_MODE_REVERSE[mode];
  // Try common aliases
  if (!digit) {
    const aliases = {
      'USB': '2', 'LSB': '1', 'CW': '3', 'CW-R': '7',
      'FM': '4', 'AM': '5', 'DATA-USB': 'C', 'DATA-LSB': '8',
      'RTTY': '6', 'RTTY-R': '9', 'FT8': 'C', 'FT4': 'C',
      'DIGI': 'C', 'SSB': '2', 'PSK': 'C', 'JT65': 'C',
    };
    digit = aliases[mode.toUpperCase()];
  }
  if (digit) {
    serialWrite(`MD0${digit};`);
  }
}

function yaesuSetPTT(on) {
  serialWrite(on ? 'TX1;' : 'TX0;');
}

// ═══════════════════════════════════════════════════════
// KENWOOD PROTOCOL
// Covers: TS-890, TS-590, TS-2000, TS-480, etc.
// Very similar to Yaesu — ASCII semicolon-terminated
// ═══════════════════════════════════════════════════════

function pollKenwood() {
  serialWrite('IF;');
}

function parseKenwoodResponse(resp) {
  if (!resp || resp.length < 2) return;
  const cmd = resp.substring(0, 2);

  switch (cmd) {
    case 'IF': {
      // Kenwood IF format:
      // IF00014074000     +000000000040000000;
      // Freq is 11 digits starting at position 2
      if (resp.length >= 37) {
        const freqStr = resp.substring(2, 13);
        const freq = parseInt(freqStr, 10);
        if (freq > 0) updateState('freq', freq);

        // Mode at position 29
        const modeDigit = resp.charAt(29);
        const mode = KENWOOD_MODES[modeDigit] || state.mode;
        updateState('mode', mode);

        // TX state at position 28
        const txState = resp.charAt(28);
        updateState('ptt', txState !== '0');
      }
      break;
    }
    case 'FA': {
      const freq = parseInt(resp.substring(2), 10);
      if (freq > 0) updateState('freq', freq);
      break;
    }
    case 'MD': {
      const modeDigit = resp.charAt(2);
      const mode = KENWOOD_MODES[modeDigit] || state.mode;
      updateState('mode', mode);
      break;
    }
  }
}

const KENWOOD_MODES = {
  '1': 'LSB', '2': 'USB', '3': 'CW', '4': 'FM',
  '5': 'AM', '6': 'FSK', '7': 'CW-R', '8': 'DATA-LSB',
  '9': 'FSK-R', 'A': 'DATA-USB'
};

const KENWOOD_MODE_REVERSE = {};
Object.entries(KENWOOD_MODES).forEach(([k, v]) => { KENWOOD_MODE_REVERSE[v] = k; });

function kenwoodSetFreq(hz) {
  const padded = String(Math.round(hz)).padStart(11, '0');
  serialWrite(`FA${padded};`);
}

function kenwoodSetMode(mode) {
  let digit = KENWOOD_MODE_REVERSE[mode];
  if (!digit) {
    const aliases = {
      'USB': '2', 'LSB': '1', 'CW': '3', 'CW-R': '7',
      'FM': '4', 'AM': '5', 'DATA-USB': 'A', 'DATA-LSB': '8',
      'FT8': 'A', 'FT4': 'A', 'DIGI': 'A', 'PSK': 'A',
    };
    digit = aliases[mode.toUpperCase()];
  }
  if (digit) serialWrite(`MD${digit};`);
}

function kenwoodSetPTT(on) {
  serialWrite(on ? 'TX;' : 'RX;');
}

// ═══════════════════════════════════════════════════════
// ICOM CI-V PROTOCOL
// Covers: IC-7300, IC-7610, IC-9700, IC-705, IC-7851, etc.
// Binary protocol: FE FE [to] [from] [cmd] [sub] [data...] FD
// ═══════════════════════════════════════════════════════

const ICOM_CONTROLLER = 0xE0; // Our address (controller)

function getIcomAddress() {
  const addr = config.radio.icomAddress || '0x94';
  return parseInt(addr, 16);
}

function icomBuildCmd(cmd, sub, data = []) {
  const to = getIcomAddress();
  const packet = [0xFE, 0xFE, to, ICOM_CONTROLLER, cmd];
  if (sub !== undefined && sub !== null) packet.push(sub);
  packet.push(...data);
  packet.push(0xFD);
  return Buffer.from(packet);
}

function pollIcom() {
  // Read frequency (cmd 0x03)
  serialWrite(icomBuildCmd(0x03));
  // Read mode (cmd 0x04)
  setTimeout(() => serialWrite(icomBuildCmd(0x04)), 50);
}

function handleIcomData(data) {
  rxBinaryBuffer = Buffer.concat([rxBinaryBuffer, data]);

  while (true) {
    // Find start of frame
    const start = rxBinaryBuffer.indexOf(0xFE);
    if (start === -1) { rxBinaryBuffer = Buffer.alloc(0); return; }
    if (start > 0) rxBinaryBuffer = rxBinaryBuffer.slice(start);

    // Need at least FE FE ... FD
    const end = rxBinaryBuffer.indexOf(0xFD, 2);
    if (end === -1) return; // Wait for more data

    const frame = rxBinaryBuffer.slice(0, end + 1);
    rxBinaryBuffer = rxBinaryBuffer.slice(end + 1);

    // Skip preamble FE FE
    if (frame.length < 6) continue;
    if (frame[0] !== 0xFE || frame[1] !== 0xFE) continue;

    const to = frame[2];
    const from = frame[3];
    const cmd = frame[4];

    // Only process frames addressed to us
    if (to !== ICOM_CONTROLLER) continue;

    switch (cmd) {
      case 0x03: // Frequency response
      case 0x00: { // Freq update (unsolicited)
        if (frame.length >= 10) {
          const freq = icomBCDToFreq(frame.slice(5, 10));
          if (freq > 0) updateState('freq', freq);
        }
        break;
      }
      case 0x04: // Mode response
      case 0x01: { // Mode update
        if (frame.length >= 7) {
          const mode = ICOM_MODES[frame[5]] || state.mode;
          updateState('mode', mode);
          if (frame.length >= 8) {
            updateState('width', frame[6]); // Filter width index
          }
        }
        break;
      }
      case 0xFB: { // OK acknowledgment
        break;
      }
      case 0xFA: { // NG (error)
        console.warn('[Icom] Command rejected (NG)');
        break;
      }
    }
  }
}

// Icom uses BCD encoding for frequency, LSB first (5 bytes = 10 digits)
function icomBCDToFreq(bytes) {
  let freq = 0;
  let mult = 1;
  for (let i = 0; i < bytes.length; i++) {
    const lo = bytes[i] & 0x0F;
    const hi = (bytes[i] >> 4) & 0x0F;
    freq += lo * mult;
    mult *= 10;
    freq += hi * mult;
    mult *= 10;
  }
  return freq;
}

function icomFreqToBCD(freq) {
  const bytes = [];
  let f = Math.round(freq);
  for (let i = 0; i < 5; i++) {
    const lo = f % 10; f = Math.floor(f / 10);
    const hi = f % 10; f = Math.floor(f / 10);
    bytes.push((hi << 4) | lo);
  }
  return bytes;
}

const ICOM_MODES = {
  0x00: 'LSB', 0x01: 'USB', 0x02: 'AM', 0x03: 'CW',
  0x04: 'RTTY', 0x05: 'FM', 0x06: 'WFM', 0x07: 'CW-R',
  0x08: 'RTTY-R', 0x11: 'DATA-LSB', 0x12: 'DATA-USB',
  0x17: 'DATA-FM',
};

const ICOM_MODE_REVERSE = {};
Object.entries(ICOM_MODES).forEach(([k, v]) => { ICOM_MODE_REVERSE[v] = parseInt(k); });

function icomSetFreq(hz) {
  const bcd = icomFreqToBCD(hz);
  serialWrite(icomBuildCmd(0x05, null, bcd));
}

function icomSetMode(mode) {
  let code = ICOM_MODE_REVERSE[mode];
  if (code === undefined) {
    const aliases = {
      'USB': 0x01, 'LSB': 0x00, 'CW': 0x03, 'CW-R': 0x07,
      'FM': 0x05, 'AM': 0x02, 'DATA-USB': 0x12, 'DATA-LSB': 0x11,
      'FT8': 0x12, 'FT4': 0x12, 'DIGI': 0x12, 'PSK': 0x12,
      'RTTY': 0x04, 'RTTY-R': 0x08,
    };
    code = aliases[mode.toUpperCase()];
  }
  if (code !== undefined) {
    // cmd 0x06, mode byte, filter 0x01 (wide)
    serialWrite(icomBuildCmd(0x06, null, [code, 0x01]));
  }
}

function icomSetPTT(on) {
  serialWrite(icomBuildCmd(0x1C, 0x00, [on ? 0x01 : 0x00]));
}

// ═══════════════════════════════════════════════════════
// LEGACY BACKENDS (flrig / rigctld) — kept for compatibility
// ═══════════════════════════════════════════════════════

// ── rigctld (TCP) ──
let rigctldSocket = null;
let rigctldQueue = [];
let rigctldPending = null;

function connectRigctld() {
  if (rigctldSocket) return;
  const host = config.radio.rigctldHost || '127.0.0.1';
  const port = config.radio.rigctldPort || 4532;
  console.log(`[Rigctld] Connecting to ${host}:${port}...`);

  const s = new net.Socket();
  s.connect(port, host, () => {
    console.log('[Rigctld] Connected');
    updateState('connected', true);
    rigctldSocket = s;
    startRigctldPoll();
  });
  s.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      handleRigctldResponse(line.trim());
    }
  });
  s.on('close', () => {
    updateState('connected', false);
    rigctldSocket = null;
    stopPolling();
    setTimeout(connectRigctld, 5000);
  });
  s.on('error', (err) => {
    console.error(`[Rigctld] Error: ${err.message}`);
    s.destroy();
  });
}

function startRigctldPoll() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!rigctldSocket) return;
    rigctldSend('f');
    rigctldSend('m');
    rigctldSend('t');
  }, config.radio.pollInterval || 1000);
}

function rigctldSend(cmd, cb) {
  if (!rigctldSocket) { if (cb) cb(new Error('Not connected')); return; }
  rigctldQueue.push({ cmd, cb });
  rigctldProcess();
}

function rigctldProcess() {
  if (rigctldPending || rigctldQueue.length === 0 || !rigctldSocket) return;
  const req = rigctldQueue.shift();
  rigctldPending = req;
  rigctldSocket.write(req.cmd + '\n');
}

function handleRigctldResponse(line) {
  if (!rigctldPending) return;
  const req = rigctldPending;
  rigctldPending = null;

  if (req.cmd === 'f') {
    const freq = parseInt(line);
    if (freq > 0) updateState('freq', freq);
  } else if (req.cmd === 'm') {
    const parts = line.split(' ');
    updateState('mode', parts[0]);
    if (parts[1]) updateState('width', parseInt(parts[1]));
  } else if (req.cmd === 't') {
    updateState('ptt', line === '1');
  }
  if (req.cb) req.cb(null, line);
  state.lastUpdate = Date.now();
  rigctldProcess();
}

// ── flrig (XML-RPC) ──
let flrigClient = null;

function connectFlrig() {
  try {
    const xmlrpc = require('xmlrpc');
    flrigClient = xmlrpc.createClient({
      host: config.radio.flrigHost || '127.0.0.1',
      port: config.radio.flrigPort || 12345,
      path: '/',
    });
    updateState('connected', true);
    console.log('[Flrig] Client initialized');
    startFlrigPoll();
  } catch (e) {
    console.error('[Flrig] xmlrpc module not available. Install with: npm install xmlrpc');
  }
}

function startFlrigPoll() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!flrigClient) return;
    flrigClient.methodCall('rig.get_vfo', [], (err, val) => {
      if (err) {
        if (state.connected) updateState('connected', false);
      } else {
        if (!state.connected) updateState('connected', true);
        const freq = parseFloat(val);
        if (freq > 0) updateState('freq', freq);
        state.lastUpdate = Date.now();
      }
    });
    flrigClient.methodCall('rig.get_mode', [], (err, val) => {
      if (!err && val) updateState('mode', val);
    });
    flrigClient.methodCall('rig.get_ptt', [], (err, val) => {
      if (!err) updateState('ptt', !!val);
    });
  }, config.radio.pollInterval || 1000);
}

// ═══════════════════════════════════════════════════════
// UNIFIED SET COMMANDS
// ═══════════════════════════════════════════════════════

function setFreq(hz) {
  switch (config.radio.type) {
    case 'yaesu':   yaesuSetFreq(hz); break;
    case 'kenwood':  kenwoodSetFreq(hz); break;
    case 'icom':     icomSetFreq(hz); break;
    case 'rigctld':  rigctldSend(`F ${hz}`); break;
    case 'flrig':
      if (flrigClient) flrigClient.methodCall('rig.set_frequency', [parseFloat(hz) + 0.1], () => {});
      break;
  }
}

function setModeCmd(mode) {
  switch (config.radio.type) {
    case 'yaesu':   yaesuSetMode(mode); break;
    case 'kenwood':  kenwoodSetMode(mode); break;
    case 'icom':     icomSetMode(mode); break;
    case 'rigctld':  rigctldSend(`M ${mode} 0`); break;
    case 'flrig':
      if (flrigClient) flrigClient.methodCall('rig.set_mode', [mode], () => {});
      break;
  }
}

function setPTTCmd(on) {
  if (on && !config.radio.pttEnabled) {
    console.warn('[API] PTT blocked (disabled in config)');
    return false;
  }
  switch (config.radio.type) {
    case 'yaesu':   yaesuSetPTT(on); break;
    case 'kenwood':  kenwoodSetPTT(on); break;
    case 'icom':     icomSetPTT(on); break;
    case 'rigctld':  rigctldSend(on ? 'T 1' : 'T 0'); break;
    case 'flrig':
      if (flrigClient) flrigClient.methodCall('rig.set_ptt', [on ? 1 : 0], () => {});
      break;
  }
  return true;
}

// ═══════════════════════════════════════════════════════
// START / STOP CONNECTION
// ═══════════════════════════════════════════════════════

function startConnection() {
  stopConnection();
  console.log(`[Bridge] Starting connection, type: ${config.radio.type}`);
  
  switch (config.radio.type) {
    case 'yaesu':
    case 'kenwood':
    case 'icom':
      connectSerial();
      break;
    case 'rigctld':
      connectRigctld();
      break;
    case 'flrig':
      connectFlrig();
      break;
    case 'none':
    default:
      console.log('[Bridge] No radio type configured. Open http://localhost:' + config.port + ' to set up.');
      break;
  }
}

function stopConnection() {
  stopPolling();
  disconnectSerial();
  if (rigctldSocket) { try { rigctldSocket.destroy(); } catch(e) {} rigctldSocket = null; }
  flrigClient = null;
  rigctldQueue = [];
  rigctldPending = null;
  updateState('connected', false);
}

// ═══════════════════════════════════════════════════════
// HTTP SERVER + SETUP UI
// ═══════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(express.json());

// ─── Setup Web UI ───
app.get('/', (req, res) => {
  // Only serve setup UI if request is from a browser (Accept: text/html)
  // Otherwise return JSON status (for API consumers)
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
  startConnection();
  
  res.json({ success: true, config });
});

// ─── API: Test connection ───
app.post('/api/test', async (req, res) => {
  // Quick serial port test
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

// ─── OHC-compatible API (same as rig-daemon) ───
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
    'Connection': 'keep-alive',
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
  sseClients.push({ id: clientId, res });

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

app.post('/freq', (req, res) => {
  const { freq } = req.body;
  if (!freq) return res.status(400).json({ error: 'Missing freq' });
  setFreq(freq);
  res.json({ success: true });
});

app.post('/mode', (req, res) => {
  const { mode } = req.body;
  if (!mode) return res.status(400).json({ error: 'Missing mode' });
  setModeCmd(mode);
  res.json({ success: true });
});

app.post('/ptt', (req, res) => {
  const { ptt } = req.body;
  const ok = setPTTCmd(!!ptt);
  if (!ok) return res.status(403).json({ error: 'PTT disabled in configuration' });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
// SETUP HTML — served from root when accessed via browser
// ═══════════════════════════════════════════════════════

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

    // Load config on startup
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

      // Adjust defaults based on type
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

// ═══════════════════════════════════════════════════════
// LAUNCH
// ═══════════════════════════════════════════════════════

app.listen(config.port, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   📻  OpenHamClock Rig Bridge  v1.0.0       ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║   Setup UI:  http://localhost:${config.port}          ║`);
  console.log(`  ║   Radio:     ${(config.radio.type || 'none').padEnd(30)}║`);
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // Auto-connect if configured
  if (config.radio.type !== 'none') {
    startConnection();
  }
});
