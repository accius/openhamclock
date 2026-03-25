/**
 * Configuration module — loads .env, config.json, and builds the CONFIG object.
 * Single source of truth for all server configuration.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

// Read version from package.json as single source of truth
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// Auto-create .env from .env.example on first run
const envPath = path.join(ROOT_DIR, '.env');
const envExamplePath = path.join(ROOT_DIR, '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('[Config] Created .env from .env.example');
  console.log('[Config] ⚠️  Please edit .env with your callsign and locator, then restart');
}

// Load .env file if it exists
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value !== undefined) {
        process.env[key] = value.trim();
      }
    }
  });
  console.log('[Config] Loaded configuration from .env file');
}

// Convert Maidenhead grid locator to lat/lon (used only during config init)
function gridToLatLon(grid) {
  if (!grid || grid.length < 4) return null;

  grid = grid.toUpperCase();
  const lon = (grid.charCodeAt(0) - 65) * 20 - 180;
  const lat = (grid.charCodeAt(1) - 65) * 10 - 90;
  const lon2 = parseInt(grid[2]) * 2;
  const lat2 = parseInt(grid[3]);

  let longitude = lon + lon2 + 1; // Center of grid
  let latitude = lat + lat2 + 0.5;

  // 6-character grid for more precision
  if (grid.length >= 6) {
    const lon3 = (grid.charCodeAt(4) - 65) * (2 / 24);
    const lat3 = (grid.charCodeAt(5) - 65) * (1 / 24);
    longitude = lon + lon2 + lon3 + 1 / 24;
    latitude = lat + lat2 + lat3 + 0.5 / 24;
  }

  return { latitude, longitude };
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Trust proxy setting
const TRUST_PROXY =
  process.env.TRUST_PROXY !== undefined
    ? process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1'
      ? 1
      : false
    : process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID
      ? 1
      : false;

// Security: API key for write operations
const API_WRITE_KEY = process.env.API_WRITE_KEY || '';

// Get locator from env (support both LOCATOR and GRID_SQUARE)
const locator = process.env.LOCATOR || process.env.GRID_SQUARE || '';

// Also load config.json if it exists (for user preferences)
let jsonConfig = {};
const configJsonPath = path.join(ROOT_DIR, 'config.json');
if (fs.existsSync(configJsonPath)) {
  try {
    jsonConfig = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
    console.log('[Config] Loaded user preferences from config.json');
  } catch (e) {
    console.error('[Config] Error parsing config.json:', e.message);
  }
}

// Calculate lat/lon from locator if not explicitly set
let stationLat = parseFloat(process.env.LATITUDE);
let stationLon = parseFloat(process.env.LONGITUDE);

if ((!stationLat || !stationLon) && locator) {
  const coords = gridToLatLon(locator);
  if (coords) {
    stationLat = stationLat || coords.latitude;
    stationLon = stationLon || coords.longitude;
  }
}

// Fallback to config.json location if no env
if (!stationLat && jsonConfig.location?.lat) stationLat = jsonConfig.location.lat;
if (!stationLon && jsonConfig.location?.lon) stationLon = jsonConfig.location.lon;

const CONFIG = {
  // Station info (env takes precedence over config.json)
  callsign: process.env.CALLSIGN || jsonConfig.callsign || 'N0CALL',
  gridSquare: locator || jsonConfig.locator || '',
  latitude: stationLat || 40.7128,
  longitude: stationLon || -74.006,

  // Display preferences
  units: process.env.UNITS || jsonConfig.units || 'imperial',
  allUnits: {
    dist: process.env.DISTUNITS || jsonConfig.allUnits?.dist || 'imperial',
    temp: process.env.TEMPUNITS || jsonConfig.allUnits?.temp || 'imperial',
    press: process.env.PRESSUNITS || jsonConfig.allUnits?.press || 'imperial',
  },
  timeFormat: process.env.TIME_FORMAT || jsonConfig.timeFormat || '12',
  theme: process.env.THEME || jsonConfig.theme || 'dark',
  layout: process.env.LAYOUT || jsonConfig.layout || 'modern',

  // DX target
  dxLatitude: parseFloat(process.env.DX_LATITUDE) || jsonConfig.defaultDX?.lat || 51.5074,
  dxLongitude: parseFloat(process.env.DX_LONGITUDE) || jsonConfig.defaultDX?.lon || -0.1278,

  // Feature toggles
  showSatellites: process.env.SHOW_SATELLITES !== 'false' && jsonConfig.features?.showSatellites !== false,
  showPota: process.env.SHOW_POTA !== 'false' && jsonConfig.features?.showPOTA !== false,
  showDxPaths: process.env.SHOW_DX_PATHS !== 'false' && jsonConfig.features?.showDXPaths !== false,
  showDxWeather: process.env.SHOW_DX_WEATHER !== 'false' && jsonConfig.features?.showDXWeather !== false,
  classicAnalogClock: process.env.CLASSIC_ANALOG_CLOCK === 'true' || jsonConfig.features?.classicAnalogClock === true,
  showContests: jsonConfig.features?.showContests !== false,
  showDXpeditions: jsonConfig.features?.showDXpeditions !== false,

  // DX Cluster settings
  spotRetentionMinutes:
    parseInt(process.env.SPOT_RETENTION_MINUTES) || jsonConfig.dxCluster?.spotRetentionMinutes || 30,
  dxClusterSource: process.env.DX_CLUSTER_SOURCE || jsonConfig.dxCluster?.source || 'auto',
  dxClusterHost: process.env.DX_CLUSTER_HOST || jsonConfig.dxCluster?.host || '',
  dxClusterPort: parseInt(process.env.DX_CLUSTER_PORT) || jsonConfig.dxCluster?.port || 7300,
  dxUdpHost: process.env.DX_UDP_HOST || jsonConfig.dxCluster?.udpHost || '',
  dxUdpPort: parseInt(process.env.DX_UDP_PORT) || jsonConfig.dxCluster?.udpPort || 12060,
  dxClusterCallsign: process.env.DX_CLUSTER_CALLSIGN || jsonConfig.dxCluster?.callsign || '',
  dxClusterSpotterLat: Number.isFinite(parseFloat(process.env.DX_CLUSTER_SPOTTER_LAT))
    ? parseFloat(process.env.DX_CLUSTER_SPOTTER_LAT)
    : null,
  dxClusterSpotterLon: Number.isFinite(parseFloat(process.env.DX_CLUSTER_SPOTTER_LON))
    ? parseFloat(process.env.DX_CLUSTER_SPOTTER_LON)
    : null,

  // API keys (don't expose to frontend)
  _openWeatherApiKey: process.env.OPENWEATHER_API_KEY || '',
  _qrzUsername: process.env.QRZ_USERNAME || '',
  _qrzPassword: process.env.QRZ_PASSWORD || '',
};

// Check if required config is missing
const configMissing = CONFIG.callsign === 'N0CALL' || !CONFIG.gridSquare;
if (configMissing) {
  console.log('[Config] ⚠️  Station configuration incomplete!');
  console.log('[Config] Copy .env.example to .env OR config.example.json to config.json');
  console.log('[Config] Set your CALLSIGN and LOCATOR/grid square');
  console.log('[Config] Settings popup will appear in browser');
}

// ITURHFProp service URL — only enabled when explicitly configured.
// Self-hosted users get the built-in model by default (no external dependency).
// The hosted deployment (openhamclock.com) sets this in its .env.
// Users can set ITURHFPROP_URL in their .env to use a custom P.533 service.
const ITURHFPROP_URL =
  process.env.ITURHFPROP_URL && process.env.ITURHFPROP_URL.trim().startsWith('http')
    ? process.env.ITURHFPROP_URL.trim()
    : null;

// Log configuration
console.log(`[Config] Station: ${CONFIG.callsign} @ ${CONFIG.gridSquare || 'No grid'}`);
console.log(`[Config] Location: ${CONFIG.latitude.toFixed(4)}, ${CONFIG.longitude.toFixed(4)}`);
console.log(`[Config] Units: ${CONFIG.units}, Time: ${CONFIG.timeFormat}h`);
if (ITURHFPROP_URL) {
  console.log(`[Propagation] ITU-R P.533-14 enabled: ${ITURHFPROP_URL}`);
} else {
  console.log('[Propagation] Standalone mode - using built-in calculations');
}

// WSJT-X settings
const WSJTX_ENABLED = process.env.WSJTX_UDP_ENABLED === 'true';
const WSJTX_UDP_PORT = parseInt(process.env.WSJTX_UDP_PORT || '2237');
const WSJTX_MULTICAST_ADDRESS = process.env.WSJTX_MULTICAST_ADDRESS || '';
const WSJTX_RELAY_KEY = process.env.WSJTX_RELAY_KEY || '';

// N1MM settings
const N1MM_UDP_PORT = parseInt(process.env.N1MM_UDP_PORT || '12060');
const N1MM_ENABLED = process.env.N1MM_UDP_ENABLED === 'true';
const N1MM_MAX_QSOS = parseInt(process.env.N1MM_MAX_QSOS || '200');
const N1MM_QSO_MAX_AGE = parseInt(process.env.N1MM_QSO_MAX_AGE_MINUTES || '360') * 60 * 1000;

// Auto-update settings
const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE === 'true';
const AUTO_UPDATE_INTERVAL_MINUTES = parseInt(process.env.AUTO_UPDATE_INTERVAL || '60');

// APRS settings
const APRS_ENABLED = process.env.APRS_ENABLED === 'true';
const APRS_CALLSIGN_FILTER = process.env.APRS_CALLSIGN_FILTER || '';

// N3FJP settings
const N3FJP_QSO_RETENTION_MINUTES = parseInt(process.env.N3FJP_QSO_RETENTION_MINUTES || '720');

// Rotator settings
const ROTATOR_PROVIDER = process.env.ROTATOR_PROVIDER || 'none';
const ROTATOR_HOST = process.env.ROTATOR_HOST || '127.0.0.1';
const ROTATOR_PORT = parseInt(process.env.ROTATOR_PORT || '12000', 10);

// DX Spider Proxy URL
const DXSPIDER_PROXY_URL = process.env.DXSPIDER_PROXY_URL || 'https://spider-production-1ec7.up.railway.app';

// CORS origins
const CORS_ORIGINS = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()) : null;

// Settings sync
const SETTINGS_SYNC = process.env.SETTINGS_SYNC === 'true';

module.exports = {
  CONFIG,
  APP_VERSION,
  ROOT_DIR,
  PORT,
  HOST,
  TRUST_PROXY,
  API_WRITE_KEY,
  ITURHFPROP_URL,
  WSJTX_ENABLED,
  WSJTX_UDP_PORT,
  WSJTX_MULTICAST_ADDRESS,
  WSJTX_RELAY_KEY,
  N1MM_UDP_PORT,
  N1MM_ENABLED,
  N1MM_MAX_QSOS,
  N1MM_QSO_MAX_AGE,
  AUTO_UPDATE_ENABLED,
  AUTO_UPDATE_INTERVAL_MINUTES,
  APRS_ENABLED,
  APRS_CALLSIGN_FILTER,
  N3FJP_QSO_RETENTION_MINUTES,
  ROTATOR_PROVIDER,
  ROTATOR_HOST,
  ROTATOR_PORT,
  DXSPIDER_PROXY_URL,
  CORS_ORIGINS,
  SETTINGS_SYNC,
  configJsonPath,
  jsonConfig,
};
