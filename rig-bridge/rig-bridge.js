#!/usr/bin/env node
/**
 * OpenHamClock Rig Bridge v1.2.0
 *
 * Universal bridge connecting radios and other ham radio services to OpenHamClock.
 * Uses a plugin architecture — each integration is a standalone module.
 *
 * Built-in plugins:
 *   yaesu    — Yaesu (FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, etc.) via USB
 *   kenwood  — Kenwood / Elecraft (TS-890, TS-590, K3, K4, etc.) via USB
 *   icom     — Icom (IC-7300, IC-7610, IC-9700, IC-705, etc.) via USB CI-V
 *   rigctld  — rigctld / Hamlib via TCP
 *   flrig    — flrig via XML-RPC
 *
 * Usage:  node rig-bridge.js          (then open http://localhost:5555 to configure)
 *         ohc-rig-bridge-win.exe      (compiled standalone)
 *         node rig-bridge.js --port 8080
 */

'use strict';

const VERSION = '2.0.0';

const { config, loadConfig, applyCliArgs } = require('./core/config');
const {
  updateState,
  state,
  broadcast,
  onStateChange,
  removeStateChangeListener,
  addToDecodeRingBuffer,
} = require('./core/state');
const PluginRegistry = require('./core/plugin-registry');
const { startServer } = require('./core/server');

// 1. Load persisted config and apply CLI overrides
loadConfig();
applyCliArgs();

// 2. Handle --version / -v
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

// 3. Handle --help / -h
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
OpenHamClock Rig Bridge v${VERSION}

Usage:
  node rig-bridge.js [options]

Options:
  --port <number>    HTTP port for setup UI (default: 5555)
  --bind <address>   Bind address (default: 127.0.0.1, use 0.0.0.0 for LAN)
  --debug            Enable verbose CAT protocol logging
  --version, -v      Print version and exit
  --help, -h         Show this help message

Examples:
  node rig-bridge.js
  node rig-bridge.js --port 8080 --debug
  node rig-bridge.js --bind 0.0.0.0   # Allow LAN access
  `);
  process.exit(0);
}

// 4. Initialize shared services
const { MessageLog } = require('./lib/message-log');
const EventEmitter = require('events');

const messageLog = new MessageLog({ maxAgeDays: config.messageLogRetentionDays || 7 });
const pluginBus = new EventEmitter(); // Shared event bus for inter-plugin communication

// 5. Create plugin registry, wire shared services, register all built-in plugins
const registry = new PluginRegistry(config, {
  updateState,
  state,
  messageLog,
  pluginBus,
  onStateChange,
  removeStateChangeListener,
});
registry.registerBuiltins();

// 6. Start HTTP/HTTPS server, then wire radio and integrations once it's listening.
//    startServer is async — it resolves after the server is bound to the port.
(async () => {
  await startServer(config.port, registry, VERSION);

  // 7. Auto-connect to configured radio (if any)
  registry.connectActive();

  // 8. Start all enabled integration plugins (e.g. WSJT-X relay)
  registry.connectIntegrations();
})().catch((err) => {
  console.error('[Startup] Fatal error:', err.message);
  process.exit(1);
});

// 9. Bridge plugin bus events to the SSE /stream so browsers in local/direct
//    mode receive all plugin data (decodes, status, APRS) over the same
//    connection used for freq/mode/ptt — no separate HTTP POSTs needed.
pluginBus.on('decode', (msg) => {
  // Build a trimmed decode object with the fields the UI needs.
  // id is a stable content key used for client-side deduplication.
  const d = {
    id: `${msg.source}-${msg.time?.formatted ?? Date.now()}-${msg.deltaFreq}-${(msg.message ?? '').replace(/\s/g, '')}`,
    source: msg.source,
    snr: msg.snr,
    deltaTime: msg.deltaTime,
    deltaFreq: msg.deltaFreq,
    freq: msg.deltaFreq, // alias used by useWSJTX dedup key
    time: msg.time?.formatted ?? '',
    mode: msg.mode,
    message: msg.message,
    type: msg.message.startsWith('CQ') ? 'CQ' : 'QSO',
    dialFrequency: msg.dialFrequency,
    timestamp: Date.now(),
  };
  addToDecodeRingBuffer(d);
  broadcast({ type: 'plugin', event: 'decode', source: msg.source, data: d });
});

pluginBus.on('status', (msg) => {
  broadcast({
    type: 'plugin',
    event: 'status',
    source: msg.source,
    data: {
      dialFrequency: msg.dialFrequency,
      mode: msg.mode,
      dxCall: msg.dxCall,
      dxGrid: msg.dxGrid,
      transmitting: msg.transmitting,
      decoding: msg.decoding,
      txEnabled: msg.txEnabled,
    },
  });
});

pluginBus.on('qso', (msg) => {
  broadcast({
    type: 'plugin',
    event: 'qso',
    source: msg.source,
    data: {
      dxCall: msg.dxCall,
      dxGrid: msg.dxGrid,
      mode: msg.mode,
      reportSent: msg.reportSent,
      reportReceived: msg.reportReceived,
      txFrequency: msg.txFrequency,
      timestamp: Date.now(),
    },
  });
});

pluginBus.on('aprs', (pkt) => {
  broadcast({ type: 'plugin', event: 'aprs', source: 'aprs-tnc', data: pkt });
});
