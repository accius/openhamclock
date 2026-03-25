'use strict';
/**
 * config.js — Config load/save and CLI arg parsing
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Config path resolution — prefer external user directory so updates never overwrite config.
// Fallback: alongside the executable (pkg) or in the rig-bridge directory (node).
function resolveConfigPath() {
  // 1. External platform-appropriate directory (survives updates)
  let externalDir;
  if (process.platform === 'win32') {
    externalDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'openhamclock');
  } else {
    externalDir = path.join(os.homedir(), '.config', 'openhamclock');
  }
  const externalPath = path.join(externalDir, 'rig-bridge-config.json');

  // If external config exists, use it
  if (fs.existsSync(externalPath)) return { dir: externalDir, path: externalPath };

  // 2. Legacy location (alongside executable or in rig-bridge dir)
  const legacyDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
  const legacyPath = path.join(legacyDir, 'rig-bridge-config.json');

  // If legacy config exists, migrate it to external dir
  if (fs.existsSync(legacyPath)) {
    try {
      if (!fs.existsSync(externalDir)) fs.mkdirSync(externalDir, { recursive: true });
      fs.copyFileSync(legacyPath, externalPath);
      console.log(`[Config] Migrated config from ${legacyPath} → ${externalPath}`);
      // Rename legacy file so it's not loaded again on downgrade
      fs.renameSync(legacyPath, legacyPath + '.migrated');
      return { dir: externalDir, path: externalPath };
    } catch (e) {
      console.warn(`[Config] Migration failed (${e.message}), using legacy path`);
      return { dir: legacyDir, path: legacyPath };
    }
  }

  // 3. Fresh install — create in external dir
  try {
    if (!fs.existsSync(externalDir)) fs.mkdirSync(externalDir, { recursive: true });
  } catch (e) {
    console.warn(`[Config] Cannot create ${externalDir} (${e.message}), using legacy path`);
    return { dir: legacyDir, path: legacyPath };
  }
  return { dir: externalDir, path: externalPath };
}

const { dir: CONFIG_DIR, path: CONFIG_PATH } = resolveConfigPath();

// Increment when DEFAULT_CONFIG structure changes (new keys, renamed keys, etc.)
const CONFIG_VERSION = 6;

const DEFAULT_CONFIG = {
  configVersion: CONFIG_VERSION,
  port: 5555,
  bindAddress: '127.0.0.1', // Bind to localhost only; set to '0.0.0.0' for LAN access
  corsOrigins: '', // Extra allowed CORS origins (comma-separated); OHC origins always allowed
  // SECURITY: API token protecting write endpoints (/freq, /mode, /ptt, POST /api/config, etc.)
  // Auto-generated on first run. Copy from http://localhost:5555 and paste into OHC → Settings →
  // Rig Control → API Token. Empty string disables enforcement (backwards-compatible).
  apiToken: '',
  debug: false, // Verbose CAT logging — also settable via --debug CLI flag
  logging: true, // Enable/disable console log capture & broadcast to UI
  // Tracks whether the auto-generated token has been shown in the setup UI.
  // false → first-run banner shown; true → normal login gate shown.
  tokenDisplayed: false,
  radio: {
    type: 'none', // none | yaesu | kenwood | icom | flrig | rigctld | tci
    serialPort: '', // COM3, /dev/ttyUSB0, /dev/cu.usbserial-*, etc.
    // ── Serial line parameters (USB CAT: yaesu / kenwood / icom) ──────────
    baudRate: 38400,
    dataBits: 8,
    stopBits: 2, // FT-991A and many Yaesu rigs require 2; others work fine with it
    parity: 'none', // none | even | odd | mark | space
    // ── Hardware signal control ────────────────────────────────────────────
    dtr: true, // Assert DTR — powers the CAT level-converter; disable if it causes issues
    rtscts: false, // Hardware flow control — off by default; use dtr for level-converter power
    // ── Icom CI-V ─────────────────────────────────────────────────────────
    icomAddress: '0x94', // IC-7300: 0x94 · IC-7610: 0x98 · IC-9700: 0xA2 · IC-705: 0xA4
    // ── rigctld / Hamlib ──────────────────────────────────────────────────
    rigctldHost: '127.0.0.1',
    rigctldPort: 4532,
    fixSplit: false, // Send "S 0 VFOA" after each freq change to prevent Hamlib split-mode glitch
    // ── flrig ─────────────────────────────────────────────────────────────
    flrigHost: '127.0.0.1',
    flrigPort: 12345,
    // ── Common ────────────────────────────────────────────────────────────
    pollInterval: 500, // State poll interval in ms (rigctld / flrig / Kenwood / Icom)
    pttEnabled: false, // Allow rig-bridge to send PTT commands
  },
  tci: {
    host: 'localhost',
    port: 40001,
    trx: 0, // transceiver index (0 = primary)
    vfo: 0, // VFO index (0 = A, 1 = B)
  },
  wsjtxRelay: {
    enabled: false,
    url: '', // OpenHamClock server URL (e.g. https://openhamclock.com)
    key: '', // Relay authentication key
    session: '', // Browser session ID for per-user isolation
    udpPort: 2237, // UDP port to listen on for WSJT-X packets
    batchInterval: 2000, // Batch send interval in ms
    verbose: false, // Log all decoded messages
    multicast: false, // Join a multicast group instead of unicast
    multicastGroup: '224.0.0.1', // WSJT-X conventional multicast group
    multicastInterface: '', // Local NIC IP for multi-homed systems; '' = let OS choose
    // SECURITY: UDP bind address. Default '127.0.0.1' (localhost-only).
    // Set to '0.0.0.0' only if WSJT-X runs on a separate machine and multicast is not used.
    udpBindAddress: '', // '' = use secure default (127.0.0.1, or 0.0.0.0 when multicast enabled)
  },
  // Digital mode software plugins — bidirectional UDP control
  mshv: {
    enabled: false,
    udpPort: 2239,
    bindAddress: '127.0.0.1',
    verbose: false,
  },
  jtdx: {
    enabled: false,
    udpPort: 2238,
    bindAddress: '127.0.0.1',
    verbose: false,
  },
  js8call: {
    enabled: false,
    udpPort: 2242,
    bindAddress: '127.0.0.1',
    verbose: false,
  },
  // APRS local TNC — connect to Direwolf or hardware TNC via KISS
  aprs: {
    enabled: false,
    protocol: 'kiss-tcp', // kiss-tcp | kiss-serial
    host: '127.0.0.1', // Direwolf KISS TCP host
    port: 8001, // Direwolf KISS TCP port
    serialPort: '', // Serial port for hardware TNC (e.g. /dev/ttyUSB0)
    baudRate: 9600,
    callsign: '', // Your callsign (required for TX)
    ssid: 0,
    path: ['WIDE1-1', 'WIDE2-1'],
    destination: 'APOHC1', // APRS tocall
    beaconInterval: 600, // Seconds between position beacons (0 = disabled)
    symbol: '/-', // APRS symbol (/-  = house)
    verbose: false,
  },
  // Rotator control via rotctld (Hamlib)
  rotator: {
    enabled: false,
    host: '127.0.0.1',
    port: 4533,
    pollInterval: 1000,
    verbose: false,
  },
  // Cloud Relay — proxy all rig-bridge features to a cloud-hosted OHC
  cloudRelay: {
    enabled: false,
    url: '', // Cloud OHC URL (e.g. https://openhamclock.com)
    apiKey: '', // Relay authentication key
    session: '', // Browser session ID for per-user isolation
    pushInterval: 2000, // State push interval in ms
    pollInterval: 1000, // Command poll interval in ms
    verbose: false,
  },
  // Winlink gateway discovery + Pat client integration
  winlink: {
    enabled: false,
    apiKey: '', // Winlink API key from winlink.org admin
    refreshInterval: 3600, // Gateway list refresh in seconds
    pat: {
      enabled: false,
      host: '127.0.0.1',
      port: 8080,
    },
  },
};

let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

function loadConfig() {
  try {
    // If config doesn't exist, try to copy from the example (located in the rig-bridge dir)
    const legacyDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
    const examplePath = path.join(legacyDir, 'rig-bridge-config.example.json');
    if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, CONFIG_PATH);
      console.log(`[Config] Created ${CONFIG_PATH} from example`);
    }

    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const savedVersion = raw.configVersion || 1;

      // Update the existing config object in place so references in other modules remain valid
      Object.assign(config, {
        ...DEFAULT_CONFIG,
        ...raw,
        configVersion: CONFIG_VERSION, // Always use current version
        radio: { ...DEFAULT_CONFIG.radio, ...(raw.radio || {}) },
        tci: { ...DEFAULT_CONFIG.tci, ...(raw.tci || {}) },
        wsjtxRelay: { ...DEFAULT_CONFIG.wsjtxRelay, ...(raw.wsjtxRelay || {}) },
        smartsdr: { ...(raw.smartsdr || {}) },
        rtltcp: { ...(raw.rtltcp || {}) },
        mshv: { ...DEFAULT_CONFIG.mshv, ...(raw.mshv || {}) },
        jtdx: { ...DEFAULT_CONFIG.jtdx, ...(raw.jtdx || {}) },
        js8call: { ...DEFAULT_CONFIG.js8call, ...(raw.js8call || {}) },
        aprs: { ...DEFAULT_CONFIG.aprs, ...(raw.aprs || {}) },
        rotator: { ...DEFAULT_CONFIG.rotator, ...(raw.rotator || {}) },
        cloudRelay: { ...DEFAULT_CONFIG.cloudRelay, ...(raw.cloudRelay || {}) },
        winlink: {
          ...DEFAULT_CONFIG.winlink,
          ...(raw.winlink || {}),
          pat: { ...DEFAULT_CONFIG.winlink.pat, ...((raw.winlink || {}).pat || {}) },
        },
        // Coerce logging to boolean in case the stored value is a string
        logging: raw.logging !== undefined ? !!raw.logging : DEFAULT_CONFIG.logging,
      });

      // Log new keys added by the merge so users can see what changed
      if (savedVersion < CONFIG_VERSION) {
        const newKeys = [];
        for (const key of Object.keys(DEFAULT_CONFIG)) {
          if (!(key in raw)) newKeys.push(key);
        }
        for (const section of [
          'radio',
          'tci',
          'wsjtxRelay',
          'mshv',
          'jtdx',
          'js8call',
          'aprs',
          'rotator',
          'cloudRelay',
          'winlink',
        ]) {
          if (DEFAULT_CONFIG[section] && raw[section]) {
            for (const key of Object.keys(DEFAULT_CONFIG[section])) {
              if (!(key in raw[section])) newKeys.push(`${section}.${key}`);
            }
          }
        }
        if (newKeys.length > 0) {
          console.log(`[Config] Schema migrated v${savedVersion} → v${CONFIG_VERSION}: added ${newKeys.join(', ')}`);
        } else {
          console.log(`[Config] Schema upgraded v${savedVersion} → v${CONFIG_VERSION}`);
        }
        saveConfig(); // Persist the upgraded config
      }

      console.log(`[Config] Loaded from ${CONFIG_PATH}`);
    }
  } catch (e) {
    console.error('[Config] Failed to load:', e.message);
  }

  // SECURITY: Auto-generate an API token on first run if none is present.
  // The token is persisted immediately so it survives restarts.
  // Enforcement is active as soon as the token is non-empty (i.e. right now for
  // all new installs). Existing installs with no token in their config file
  // remain unenforced until they explicitly copy the token to OpenHamClock.
  if (!config.apiToken) {
    config.apiToken = crypto.randomBytes(16).toString('hex');
    config.tokenDisplayed = false; // always show first-run banner for a new token
    saveConfig();
    console.log('[Config] Generated new API token — copy it from http://localhost:5555');
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
    if (args[i] === '--bind') config.bindAddress = args[++i];
    if (args[i] === '--debug') config.debug = true;
  }
}

module.exports = { config, loadConfig, saveConfig, applyCliArgs, CONFIG_PATH };
