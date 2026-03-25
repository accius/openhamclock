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

const VERSION = '1.2.0';

const { config, loadConfig, applyCliArgs } = require('./core/config');
const { updateState, state } = require('./core/state');
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

// 4. Initialize message log
const { MessageLog } = require('./lib/message-log');
const messageLog = new MessageLog({ maxAgeDays: config.messageLogRetentionDays || 7 });

// 5. Create plugin registry, wire shared services, register all built-in plugins
const registry = new PluginRegistry(config, { updateState, state, messageLog });
registry.registerBuiltins();

// 6. Start HTTP server (passes registry for route dispatch and plugin route registration)
startServer(config.port, registry, VERSION);

// 7. Auto-connect to configured radio (if any)
registry.connectActive();

// 8. Start all enabled integration plugins (e.g. WSJT-X relay)
registry.connectIntegrations();
