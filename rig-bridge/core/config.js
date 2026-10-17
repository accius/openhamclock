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
const CONFIG_VERSION = 10;

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
    // ── Mode overrides (issue #882) ───────────────────────────────────────
    // Per-rig remapping applied to every incoming mode command before it is
    // handed to the active radio plugin. Keys are the modes OpenHamClock
    // sends (matched case-insensitively: CW, CW-R, USB, LSB, DATA-USB,
    // DATA-LSB, FM, AM, ...); values are what your rig actually needs.
    //   e.g. { "DATA-USB": "DIG" }      FT-817/818 via flrig
    //        { "DATA-USB": "PKTUSB" }   rigs whose Hamlib backend uses PKT names
    //        { "CW": "CW-R" }           prefer reverse CW
    // Empty object = no overrides (behavior unchanged).
    modeOverrides: {},
  },
  tci: {
    host: 'localhost',
    port: 40001,
    trx: 0, // transceiver index (0 = primary)
    vfo: 0, // VFO index (0 = A, 1 = B)
  },
  wsjtxRelay: {
    enabled: false,
    relayToServer: false, // false = SSE-only (local/LAN); true = also POST decodes to OHC server (cloud relay)
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
    // Forward received frames to the OpenHamClock server so its station
    // cache (and every browser) sees RF stations without a browser being
    // attached to this rig-bridge (#1221).
    serverForward: true,
    ohcUrl: 'http://localhost:3000',
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
    relayAudio: false, // Opt-in: carry KiwiSDR audio (µ-law, ~12 kB/s) to the Decoder panel while it listens
    verbose: false,
    // Key shared with the browser that pressed Connect Cloud Relay; commands
    // must be signed with it (lib/relay-sign.js). Never sent to the server.
    commandKey: '',
    allowUnsigned: false, // true = accept unsigned commands of every kind (old, unsafe behaviour)
    unsignedGraceUntil: '2027-01-31', // without a key: unsigned tuning accepted until this date, never PTT/TX
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
  // Wavelog QSO forwarder — post QSOs a logger broadcasts as N1MM-style ADIF
  // packets (e.g. RUMlogNG "Contact info ADIF") to Wavelog's API
  wavelogForward: {
    enabled: false,
    url: '', // Wavelog base URL, e.g. https://log.example.com
    apiKey: '', // Wavelog API key with read/write rights
    stationProfileId: '', // Wavelog station profile id the QSOs belong to
    udpPort: 12060, // N1MM-compatible broadcast port
    udpBindAddress: '', // '' = all interfaces
    verbose: false,
  },
  // Winlink Express CSV ingest — watch a form-export CSV and forward new rows
  // to the OHC server's EmComm Field Reports panel
  winlinkExpressCsv: {
    enabled: false,
    csvPath: '', // Absolute path to the Winlink Express CSV export file
    pollInterval: 30, // Seconds between polls (fs.watch also fires immediately on change)
    ohcUrl: 'http://localhost:8080', // URL of the OpenHamClock server
    verbose: false,
  },
  // ── Hardware plugins (Raspberry Pi and friends) ──────────────────────
  // GPS receiver → DE location / rover mode in the browser
  gps: {
    enabled: false,
    source: 'serial', // serial | gpsd | file | mock
    serialPort: '', // /dev/ttyACM0, /dev/ttyUSB0, COM5 …
    baudRate: 9600,
    gpsdHost: '127.0.0.1',
    gpsdPort: 2947,
    filePath: '', // UNIX fifo or file something pipes NMEA into
    publishInterval: 1000, // ms between SSE fix updates
    verbose: false,
  },
  // BME280 / BMP280 over I2C and/or an HTTP JSON sensor (ESPHome, Tasmota …)
  envSensors: {
    enabled: false,
    pollInterval: 10, // seconds
    i2cBus: 1,
    mock: false, // simulated readings — no hardware needed
    sensorA: { enabled: true, address: '0x76', name: 'Indoor', dTemp: 0, dPres: 0, dHum: 0 },
    sensorB: { enabled: false, address: '0x77', name: 'Outdoor', dTemp: 0, dPres: 0, dHum: 0 },
    http: {
      enabled: false,
      url: '',
      interval: 60, // seconds
      name: 'Remote',
      tempPath: 'temperature',
      humPath: 'humidity',
      presPath: 'pressure',
      tempUnit: 'C', // C | F
      presUnit: 'hPa', // hPa | Pa | kPa | inHg | mmHg
    },
    verbose: false,
  },
  // Raspberry Pi GPIO — ON-AIR / alarm / countdown / satellite lines (HamClock pinout)
  gpio: {
    enabled: false,
    backend: 'auto', // auto | gpiod | sysfs | mock
    chip: 'gpiochip0',
    activeLow: true, // inputs: switch to ground with pull-up
    outputActiveLow: false,
    pollInterval: 250, // ms, input polling when no edge monitor
    debounceMs: 50,
    // BCM numbers (or "P37" header pins); -1 disables a line. Defaults = HamClock header map.
    pins: {
      pttIn: 16,
      countdownResetIn: 26,
      alarmSilenceIn: 5,
      onAirOut: 21,
      alarmOut: 6,
      countdownGreenOut: 13,
      countdownRedOut: 19,
      satOut: 20,
      lightningOut: -1, // lightning antenna-protection relay — off until assigned (suggested BCM 25 / header 22)
    },
    // Lightning relay: invert lightningOut so the relay is energised to keep
    // the antenna connected (power loss / crash / bridge stop → disconnected)
    lightningFailSafe: false,
    // A display that asked for the relay and then went quiet keeps its claim
    // for its all-clear time (sent with each report)
    lightningHoldWhenStale: true,
    // The guard running inside the bridge — protects with no browser open
    lightningHeadless: {
      enabled: false,
      lat: '',
      lon: '',
      warnKm: 50,
      alarmKm: 25,
      allClearMin: 30,
      minStrikes: 1,
      hysteresisPct: 20,
      relayOn: 'alarm',
    },
    verbose: false,
  },
  // Ambient light → display brightness (LTR-329 / HTTP lux / mock) + backlight control
  brightness: {
    enabled: false,
    source: 'none', // none | ltr329 | http | mock
    i2cBus: 1,
    address: '0x29',
    http: { url: '', luxPath: 'lux' },
    interval: 5, // seconds between lux reads
    auto: true, // follow the light sensor; false = use `manual`
    manual: 100,
    min: 5, // never dim below this %
    calDimLux: 5, // two-point calibration (HamClock bright/dim)
    calDimPct: 15,
    calBrightLux: 400,
    calBrightPct: 100,
    backlightPath: '', // '' = auto-detect /sys/class/backlight/*
    powerMethod: 'auto', // auto | backlight | vcgencmd | xset | none
  },
  // HamAlert spot feed — persistent telnet session to hamalert.org:7300
  hamalert: {
    enabled: false,
    username: '', // HamAlert username
    password: '', // HamAlert password
    host: 'hamalert.org',
    port: 7300,
    verbose: false,
  },
  // NBEMS — fldigi over XML-RPC (status, RX text, send text, mode) plus
  // flmsg form folders → the OHC server's EmComm Field Reports panel
  fldigi: {
    enabled: false,
    url: 'http://127.0.0.1:7362', // fldigi XML-RPC server
    pollInterval: 1000, // ms between status/RX polls
    rxBufferChars: 4000, // receive text kept for browsers that connect later
    maxTxSeconds: 600, // transmit watchdog — abort and return to RX after this
    callsign: '', // station call written into the flmsg header of sent forms
    flmsgEnabled: true, // watch the flmsg folders for received forms
    flmsgDirs: '', // '' = ~/NBEMS.files/WRAP/recv and ~/NBEMS.files/ICS/messages; ';'-separated list otherwise
    flmsgPollInterval: 15, // seconds between folder scans (fs.watch also reacts immediately)
    flmsgMaxAgeHours: 72, // on start-up, forms older than this are not reported
    flmsgIncludeLocal: false, // also forward this station's drafts and sent forms (ICS/messages)
    flmsgDateFormat: 'auto', // ambiguous form dates: auto (flmsg's setting, else locale) | mdy | dmy | ymd | ydm
    serverForward: true, // POST forms to the OpenHamClock server
    ohcUrl: 'http://localhost:3000', // OpenHamClock server URL
    verbose: false,
  },
  // TLS/HTTPS — enables HTTPS to avoid mixed-content errors when OHC is served over HTTPS
  tls: {
    enabled: false, // false = plain HTTP (backward-compatible default)
    certGenerated: false, // tracks whether a cert has been generated at least once
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
        hamalert: { ...DEFAULT_CONFIG.hamalert, ...(raw.hamalert || {}) },
        fldigi: { ...DEFAULT_CONFIG.fldigi, ...(raw.fldigi || {}) },
        tls: { ...DEFAULT_CONFIG.tls, ...(raw.tls || {}) },
        gps: { ...DEFAULT_CONFIG.gps, ...(raw.gps || {}) },
        envSensors: {
          ...DEFAULT_CONFIG.envSensors,
          ...(raw.envSensors || {}),
          sensorA: { ...DEFAULT_CONFIG.envSensors.sensorA, ...((raw.envSensors || {}).sensorA || {}) },
          sensorB: { ...DEFAULT_CONFIG.envSensors.sensorB, ...((raw.envSensors || {}).sensorB || {}) },
          http: { ...DEFAULT_CONFIG.envSensors.http, ...((raw.envSensors || {}).http || {}) },
        },
        gpio: {
          ...DEFAULT_CONFIG.gpio,
          ...(raw.gpio || {}),
          pins: { ...DEFAULT_CONFIG.gpio.pins, ...((raw.gpio || {}).pins || {}) },
          lightningHeadless: {
            ...DEFAULT_CONFIG.gpio.lightningHeadless,
            ...((raw.gpio || {}).lightningHeadless || {}),
          },
        },
        brightness: {
          ...DEFAULT_CONFIG.brightness,
          ...(raw.brightness || {}),
          http: { ...DEFAULT_CONFIG.brightness.http, ...((raw.brightness || {}).http || {}) },
        },
        wavelogForward: { ...DEFAULT_CONFIG.wavelogForward, ...(raw.wavelogForward || {}) },
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
          'hamalert',
          'fldigi',
          'tls',
          'gps',
          'envSensors',
          'gpio',
          'brightness',
          'wavelogForward',
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

module.exports = { config, loadConfig, saveConfig, applyCliArgs, CONFIG_PATH, CONFIG_DIR };
