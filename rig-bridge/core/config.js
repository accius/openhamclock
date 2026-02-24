'use strict';
/**
 * config.js — Config load/save and CLI arg parsing
 */

const fs = require('fs');
const path = require('path');

// Portable config path (works in pkg snapshots too)
const CONFIG_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const CONFIG_PATH = path.join(CONFIG_DIR, 'rig-bridge-config.json');

const DEFAULT_CONFIG = {
  port: 5555,
  radio: {
    type: 'none', // none | yaesu | kenwood | icom | flrig | rigctld
    serialPort: '', // COM3, /dev/ttyUSB0, etc.
    baudRate: 38400,
    dataBits: 8,
    stopBits: 2, // Yaesu default; Icom/Kenwood typically 1
    parity: 'none',
    icomAddress: '0x94', // Default CI-V address for IC-7300
    pollInterval: 500,
    pttEnabled: false,
    // Legacy backend settings
    rigctldHost: '127.0.0.1',
    rigctldPort: 4532,
    flrigHost: '127.0.0.1',
    flrigPort: 12345,
  },
};

let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      config = {
        ...DEFAULT_CONFIG,
        ...raw,
        radio: { ...DEFAULT_CONFIG.radio, ...(raw.radio || {}) },
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

function applyCliArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') config.port = parseInt(args[++i]);
  }
}

module.exports = { config, loadConfig, saveConfig, applyCliArgs };
