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
  logging: true, // Enable/disable console log capture & broadcast to UI
  radio: {
    type: 'none', // none | yaesu | kenwood | icom | flrig | rigctld
    serialPort: '', // COM3, /dev/ttyUSB0, etc.
    baudRate: 38400,
    dataBits: 8,
    stopBits: 2, // FT-991A and many Yaesu rigs require 2; others work fine with it.
    parity: 'none',
    dtr: true, // Assert DTR for level converter power
    rts: true, // Assert RTS for level converter power
    rtscts: false, // Hardware flow control — off by default; use manual DTR/RTS instead
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

const CONFIG_EXAMPLE_PATH = path.join(CONFIG_DIR, 'rig-bridge-config.example.json');

function loadConfig() {
  try {
    // If config doesn't exist, try to copy it from the example
    if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(CONFIG_EXAMPLE_PATH)) {
      fs.copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
      console.log(`[Config] Created ${CONFIG_PATH} from example`);
    }

    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // Update the existing config object in place so references in other modules remain valid
      Object.assign(config, {
        ...DEFAULT_CONFIG,
        ...raw,
        radio: { ...DEFAULT_CONFIG.radio, ...(raw.radio || {}) },
        // Coerce logging to boolean in case the stored value is a string
        logging: raw.logging !== undefined ? !!raw.logging : DEFAULT_CONFIG.logging,
      });
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
