/**
 * Configuration module — loads .env, config.json, and builds the CONFIG object.
 * Single source of truth for all server configuration.
 */

const fs = require('fs');
const path = require('path');
const { maidenheadToLatLon } = require('../server/utils/grid');
const { resolveAppDirs } = require('./utils/appPaths');

// ROOT_DIR is where the server writes (.env, config.json, data/). ASSET_DIR is
// where bundled files live (dist/, public/, package.json). They are the same
// directory in a checkout and differ only inside a packaged single-file
// executable — see server/utils/appPaths.js.
const { ASSET_DIR, ROOT_DIR, IS_PACKAGED } = resolveAppDirs({
  moduleDir: __dirname,
  packaged: Boolean(process.pkg),
  execPath: process.execPath,
  env: process.env,
});

// Read version from package.json as single source of truth
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ASSET_DIR, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// Auto-create .env from .env.example on first run
const envPath = path.join(ROOT_DIR, '.env');
const envExamplePath = path.join(ASSET_DIR, '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  // read+write rather than copyFileSync so the template can come from a
  // packaged executable's read-only snapshot
  fs.writeFileSync(envPath, fs.readFileSync(envExamplePath));
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

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// Interface the HTTP and LAN HTTPS listeners bind to. HOST only names the
// address shown in the startup banner; binding has always been every
// interface, and many installs reach their dashboard from phones that way, so
// that stays the default. BIND_HOST=127.0.0.1 keeps the server on this machine.
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

// Trust proxy setting
const TRUST_PROXY =
  process.env.TRUST_PROXY !== undefined
    ? process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1'
      ? 1
      : false
    : process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID
      ? 1
      : false;

// Take the client IP from Cloudflare's CF-Connecting-IP header. Only safe when
// the origin is reachable exclusively through Cloudflare (anyone reaching it
// directly can forge the header), so it is off unless explicitly enabled.
const TRUST_CLOUDFLARE = process.env.TRUST_CLOUDFLARE === 'true' || process.env.TRUST_CLOUDFLARE === '1';

// Security: API key for write operations
const API_WRITE_KEY = process.env.API_WRITE_KEY || '';

// Security: API key for the Prometheus metrics endpoint. When set, requires
// a matching ?key= or Authorization: Bearer= header to access /metrics.
// Leave unset for public metrics (default, safe for local/private installs).
const METRICS_AUTH_KEY = process.env.METRICS_AUTH_KEY || '';

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

if ((!Number.isFinite(stationLat) || !Number.isFinite(stationLon)) && locator) {
  const coords = maidenheadToLatLon(locator);
  if (coords) {
    stationLat = Number.isFinite(stationLat) ? stationLat : coords.lat;
    stationLon = Number.isFinite(stationLon) ? stationLon : coords.lon;
  }
}

// Fallback to config.json location if no env
if (!Number.isFinite(stationLat) && jsonConfig.location?.lat != null) stationLat = jsonConfig.location.lat;
if (!Number.isFinite(stationLon) && jsonConfig.location?.lon != null) stationLon = jsonConfig.location.lon;

const CONFIG = {
  // Station info (env takes precedence over config.json)
  callsign: process.env.CALLSIGN || jsonConfig.callsign || 'N0CALL',
  gridSquare: locator || jsonConfig.locator || '',
  latitude: Number.isFinite(stationLat) ? stationLat : 40.7128,
  longitude: Number.isFinite(stationLon) ? stationLon : -74.006,
  serverLocal: process.env.SERVERLOCAL === 'true' || jsonConfig.serverLocal === true,

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
  dxLatitude: Number.isFinite(parseFloat(process.env.DX_LATITUDE))
    ? parseFloat(process.env.DX_LATITUDE)
    : (jsonConfig.defaultDX?.lat ?? 51.5074),
  dxLongitude: Number.isFinite(parseFloat(process.env.DX_LONGITUDE))
    ? parseFloat(process.env.DX_LONGITUDE)
    : (jsonConfig.defaultDX?.lon ?? -0.1278),

  // Satellites configuration
  satellites: {
    // Optional internal proxy for upstream element-set fetches. When set
    // (e.g. http://fletcher.railway.internal:3000) the CelesTrak / AMSAT /
    // SatNOGS fetches in routes/satellites.js are rewritten to traverse the
    // proxy service so they use its egress IP instead of OpenHamClock's.
    // Empty string = direct upstream (default). TLE_FETCHER_URL is the
    // service's pre-rename env name — health.js already honors it, and a
    // deploy whose Railway env still uses it must keep routing through the
    // relay rather than silently going direct (CelesTrak drops requests
    // from the production egress IP).
    fletcherUrl: (process.env.FLETCHER_URL || process.env.TLE_FETCHER_URL || '').trim().replace(/\/+$/, ''),
    celestrak: {
      get enabled() {
        return !(process.env.CELESTRAK_ENABLED && process.env.CELESTRAK_ENABLED === 'false');
      },
    },
    amsat_tle: {
      get enabled() {
        return !(process.env.AMSAT_TLE_ENABLED && process.env.AMSAT_TLE_ENABLED === 'false');
      },
    },
    satnogs_tle: {
      get enabled() {
        return !(process.env.SATNOGS_TLE_ENABLED && process.env.SATNOGS_TLE_ENABLED === 'false');
      },
    },
    spaceTrack: {
      // (do not expose usernames/passwords to frontend)
      _username: process.env.SPACE_TRACK_USERNAME || '',
      _password: process.env.SPACE_TRACK_PASSWORD || '',
      get enabled() {
        return this._username.length > 0 && this._password.length > 0;
      },
    },
  },

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
  _hamqthUsername: process.env.HAMQTH_USERNAME || '',
  _hamqthPassword: process.env.HAMQTH_PASSWORD || '',
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
// WSJTX_ENABLED is the documented name; WSJTX_UDP_ENABLED kept as a fallback
// so existing .env files keep working.
const WSJTX_ENABLED = (process.env.WSJTX_ENABLED ?? process.env.WSJTX_UDP_ENABLED) === 'true';
const WSJTX_UDP_PORT = parseInt(process.env.WSJTX_UDP_PORT || '2237');
const WSJTX_MULTICAST_ADDRESS = process.env.WSJTX_MULTICAST_ADDRESS || '';
const WSJTX_RELAY_KEY = process.env.WSJTX_RELAY_KEY || '';

// N1MM settings
const N1MM_UDP_PORT = parseInt(process.env.N1MM_UDP_PORT || '12060');
const N1MM_ENABLED = process.env.N1MM_UDP_ENABLED === 'true';
const N1MM_MAX_QSOS = parseInt(process.env.N1MM_MAX_QSOS || '200');
const N1MM_QSO_MAX_AGE = parseInt(process.env.N1MM_QSO_MAX_AGE_MINUTES || '360') * 60 * 1000;

// Auto-update settings
// AUTO_UPDATE_ENABLED / AUTO_UPDATE_INTERVAL_MINUTES are the documented names;
// AUTO_UPDATE / AUTO_UPDATE_INTERVAL kept as fallbacks so existing .env files keep working.
const AUTO_UPDATE_ENABLED = (process.env.AUTO_UPDATE_ENABLED ?? process.env.AUTO_UPDATE) === 'true';
const AUTO_UPDATE_INTERVAL_MINUTES = parseInt(
  process.env.AUTO_UPDATE_INTERVAL_MINUTES || process.env.AUTO_UPDATE_INTERVAL || '60',
);

// APRS settings
const APRS_ENABLED = process.env.APRS_ENABLED === 'true';
const APRS_CALLSIGN_FILTER = process.env.APRS_CALLSIGN_FILTER || '';

// N3FJP settings
const N3FJP_QSO_RETENTION_MINUTES = parseInt(process.env.N3FJP_QSO_RETENTION_MINUTES || '720');

// Rotator settings
// Note: PSTROTATOR_HOST and PSTROTATOR_UDP_PORT are read directly from
// process.env inside server/routes/rotator.js — they're not surfaced here.
const ROTATOR_PROVIDER = process.env.ROTATOR_PROVIDER || 'none';

// Rig Bridge Cloud Relay
const RIG_BRIDGE_RELAY_KEY = process.env.RIG_BRIDGE_RELAY_KEY || process.env.WSJTX_RELAY_KEY || '';

// DX Spider Proxy URL
const DXSPIDER_PROXY_URL = process.env.DXSPIDER_PROXY_URL || 'https://spider-production-1ec7.up.railway.app';

// Winlink API key — used by server/routes/winlink.js to proxy gateway lookups
// to api.winlink.org without exposing the key to the browser. Acquired from
// the Winlink team per issue #297. When unset, /api/winlink/gateways returns
// 503 and the browser hook falls back to the rig-bridge plugin at /winlink/*.
const WINLINK_API_KEY = process.env.WINLINK_API_KEY || '';

// CORS origins
const CORS_ORIGINS = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()) : null;

// Settings sync
const SETTINGS_SYNC = process.env.SETTINGS_SYNC === 'true';

module.exports = {
  CONFIG,
  APP_VERSION,
  ROOT_DIR,
  ASSET_DIR,
  IS_PACKAGED,
  PORT,
  HOST,
  BIND_HOST,
  TRUST_PROXY,
  TRUST_CLOUDFLARE,
  API_WRITE_KEY,
  METRICS_AUTH_KEY,
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
  RIG_BRIDGE_RELAY_KEY,
  DXSPIDER_PROXY_URL,
  CORS_ORIGINS,
  SETTINGS_SYNC,
  WINLINK_API_KEY,
  configJsonPath,
  jsonConfig,
};
