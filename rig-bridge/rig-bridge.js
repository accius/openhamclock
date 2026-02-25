#!/usr/bin/env node
/**
 * OpenHamClock Rig Bridge v1.1.0
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

const { config, loadConfig, applyCliArgs } = require('./core/config');
const { updateState, state } = require('./core/state');
const PluginRegistry = require('./core/plugin-registry');
const { startServer } = require('./core/server');

// 1. Load persisted config and apply CLI overrides
loadConfig();
applyCliArgs();

// 2. Create plugin registry, wire shared services, register all built-in plugins
const registry = new PluginRegistry(config, { updateState, state });
registry.registerBuiltins();

// 3. Start HTTP server (passes registry for route dispatch and plugin route registration)
startServer(config.port, registry);

// 4. Auto-connect to configured radio (if any)
registry.connectActive();
