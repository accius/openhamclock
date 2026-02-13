/**
 * OpenHamClock Server
 * 
 * Express server that:
 * 1. Serves the static web application
 * 2. Proxies API requests to avoid CORS issues
 * 3. Provides hybrid HF propagation predictions (ITURHFProp + real-time ionosonde)
 * 4. Provides WebSocket support for future real-time features
 * 
 * Configuration:
 * - Copy .env.example to .env and customize
 * - Environment variables override .env file
 * 
 * Usage:
 *   node server.js
 *   PORT=8080 node server.js
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fetch = require('node-fetch');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const mqttLib = require('mqtt');

// Read version from package.json as single source of truth
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

// Global safety nets — log but don't crash on stray errors (e.g. MQTT connack timeout)
process.on('uncaughtException', (err) => {
  console.error(`[FATAL] Uncaught exception: ${err.message}`);
  console.error(err.stack);
  // Exit on truly fatal errors, but give time to flush logs
  setTimeout(() => process.exit(1), 1000);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[WARN] Unhandled rejection: ${reason}`);
});

// Auto-create .env from .env.example on first run
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('[Config] Created .env from .env.example');
  console.log('[Config] ⚠️  Please edit .env with your callsign and locator, then restart');
}

// Load .env file if it exists
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value !== undefined && !process.env[key]) {
        process.env[key] = value;
      }
    }
  });
  console.log('[Config] Loaded configuration from .env file');
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Security: API key for write operations (set in .env to protect POST endpoints)
// If not set, write endpoints are open (backward-compatible for local installs)
const API_WRITE_KEY = process.env.API_WRITE_KEY || '';

// Helper: check write auth on POST endpoints that modify server state
function requireWriteAuth(req, res, next) {
  if (!API_WRITE_KEY) return next(); // No key configured = open (local installs)
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.key || '';
  if (token === API_WRITE_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized — set Authorization: Bearer <API_WRITE_KEY>' });
}

// ============================================
// UPSTREAM REQUEST MANAGER
// Prevents request stampedes on external APIs:
// 1. In-flight deduplication — only 1 fetch per cache key at a time
// 2. Stale-while-revalidate — serve stale data instantly, refresh in background
// 3. Exponential backoff with jitter per service
// ============================================
class UpstreamManager {
  constructor() {
    this.inFlight = new Map();  // cacheKey -> Promise
    this.backoffs = new Map();  // serviceName -> { until, consecutive }
  }

  /**
   * Check if a service is in backoff period
   * @returns {boolean}
   */
  isBackedOff(service) {
    const b = this.backoffs.get(service);
    return b && Date.now() < b.until;
  }

  /**
   * Get remaining backoff seconds for logging
   */
  backoffRemaining(service) {
    const b = this.backoffs.get(service);
    if (!b || Date.now() >= b.until) return 0;
    return Math.round((b.until - Date.now()) / 1000);
  }

  /**
   * Record a failure — applies exponential backoff with jitter
   * @param {string} service - Service name (e.g. 'pskreporter')
   * @param {number} statusCode - HTTP status that caused the failure
   */
  recordFailure(service, statusCode) {
    const prev = this.backoffs.get(service) || { consecutive: 0 };
    const consecutive = prev.consecutive + 1;
    
    // Base delays by status: 429=aggressive, 503=moderate, other=short
    const baseDelay = statusCode === 429 ? 60000 : statusCode === 503 ? 30000 : 15000;
    
    // Per-service max backoff caps
    const maxBackoff = 30 * 60 * 1000; // 30 minutes
    
    // Exponential: base * 2^(n-1), capped per service
    const delay = Math.min(maxBackoff, baseDelay * Math.pow(2, Math.min(consecutive - 1, 8)));
    
    // Add 0-15s jitter to prevent synchronized retries across instances
    const jitter = Math.random() * 15000;
    
    this.backoffs.set(service, { 
      until: Date.now() + delay + jitter, 
      consecutive 
    });
    
    return Math.round((delay + jitter) / 1000);
  }

  /**
   * Record a success — resets backoff for the service
   */
  recordSuccess(service) {
    this.backoffs.delete(service);
  }

  /**
   * Deduplicated fetch — if an identical request is already in-flight,
   * all callers share the same Promise instead of each hitting upstream.
   * 
   * @param {string} cacheKey - Unique key for this request
   * @param {Function} fetchFn - async function that performs the actual upstream fetch
   * @returns {Promise} - Resolves with fetch result, or rejects on error
   */
  async fetch(cacheKey, fetchFn) {
    // If this exact request is already in-flight, piggyback on it
    if (this.inFlight.has(cacheKey)) {
      return this.inFlight.get(cacheKey);
    }

    // Create the promise and store it so concurrent callers can share it
    const promise = fetchFn().finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, promise);
    return promise;
  }
}

const upstream = new UpstreamManager();

// ============================================
// CONFIGURATION FROM ENVIRONMENT
// ============================================

function maidenheadToLatLon(grid) {
  if (!grid) return null;
  const g = String(grid).trim();
  if (g.length < 4) return null;

  const A = 'A'.charCodeAt(0);
  const a = 'a'.charCodeAt(0);

  const c0 = g.charCodeAt(0);
  const c1 = g.charCodeAt(1);
  const c2 = g.charCodeAt(2);
  const c3 = g.charCodeAt(3);

  // Field (A-R)
  const lonField = (c0 >= a ? c0 - a : c0 - A);
  const latField = (c1 >= a ? c1 - a : c1 - A);

  // Square (0-9)
  const lonSquare = parseInt(g[2], 10);
  const latSquare = parseInt(g[3], 10);
  if (!Number.isFinite(lonSquare) || !Number.isFinite(latSquare)) return null;

  // Start at SW corner of the 4-char square
  let lon = -180 + lonField * 20 + lonSquare * 2;
  let lat =  -90 + latField * 10 + latSquare * 1;

  // Subsquare (a-x), optional
  if (g.length >= 6) {
    const s0 = g.charCodeAt(4);
    const s1 = g.charCodeAt(5);
    const lonSub = (s0 >= a ? s0 - a : s0 - A);
    const latSub = (s1 >= a ? s1 - a : s1 - A);
    // each subsquare: 5' lon = 1/12 deg, 2.5' lat = 1/24 deg
    lon += lonSub * (1/12);
    lat += latSub * (1/24);
    // center of subsquare
    lon += (1/12) / 2;
    lat += (1/24) / 2;
  } else {
    // center of 4-char square: 1 deg lon, 0.5 deg lat
    lon += 1.0;
    lat += 0.5;
  }

  return { lat, lon };
}

// Convert Maidenhead grid locator to lat/lon
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
    const lon3 = (grid.charCodeAt(4) - 65) * (2/24);
    const lat3 = (grid.charCodeAt(5) - 65) * (1/24);
    longitude = lon + lon2 + lon3 + (1/24);
    latitude = lat + lat2 + lat3 + (0.5/24);
  }
  
  return { latitude, longitude };
}

// Get locator from env (support both LOCATOR and GRID_SQUARE)
const locator = process.env.LOCATOR || process.env.GRID_SQUARE || '';

// Also load config.json if it exists (for user preferences)
let jsonConfig = {};
const configJsonPath = path.join(__dirname, 'config.json');
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
  longitude: stationLon || -74.0060,
  
  // Display preferences
  units: process.env.UNITS || jsonConfig.units || 'imperial',
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
  spotRetentionMinutes: parseInt(process.env.SPOT_RETENTION_MINUTES) || jsonConfig.dxCluster?.spotRetentionMinutes || 30,
  dxClusterSource: process.env.DX_CLUSTER_SOURCE || jsonConfig.dxCluster?.source || 'auto',
  
  // API keys (don't expose to frontend)
  _openWeatherApiKey: process.env.OPENWEATHER_API_KEY || '',
  _qrzUsername: process.env.QRZ_USERNAME || '',
  _qrzPassword: process.env.QRZ_PASSWORD || ''
};

// Check if required config is missing
const configMissing = CONFIG.callsign === 'N0CALL' || !CONFIG.gridSquare;
if (configMissing) {
  console.log('[Config] ⚠️  Station configuration incomplete!');
  console.log('[Config] Copy .env.example to .env OR config.example.json to config.json');
  console.log('[Config] Set your CALLSIGN and LOCATOR/grid square');
  console.log('[Config] Settings popup will appear in browser');
}

// ITURHFProp service URL (enables ITU-R P.533-14 propagation predictions)
// Defaults to the public OpenHamClock prediction service; override in .env if self-hosting
const ITURHFPROP_DEFAULT = 'https://proppy-production.up.railway.app';
const ITURHFPROP_URL = process.env.ITURHFPROP_URL && process.env.ITURHFPROP_URL.trim().startsWith('http') 
  ? process.env.ITURHFPROP_URL.trim() 
  : ITURHFPROP_DEFAULT;

// Log configuration
console.log(`[Config] Station: ${CONFIG.callsign} @ ${CONFIG.gridSquare || 'No grid'}`);
console.log(`[Config] Location: ${CONFIG.latitude.toFixed(4)}, ${CONFIG.longitude.toFixed(4)}`);
console.log(`[Config] Units: ${CONFIG.units}, Time: ${CONFIG.timeFormat}h`);
if (ITURHFPROP_URL) {
  const isDefault = ITURHFPROP_URL === ITURHFPROP_DEFAULT;
  console.log(`[Propagation] ITU-R P.533-14 enabled via ${isDefault ? 'public service' : 'custom service'}: ${ITURHFPROP_URL}`);
} else {
  console.log('[Propagation] Standalone mode - using built-in calculations');
}

// Middleware — Security
app.use(helmet({
  contentSecurityPolicy: false, // CSP breaks inline Leaflet/React scripts
  crossOriginEmbedderPolicy: false // Breaks tile loading from CDNs
}));

// CORS — restrict to same origin by default; allow override via env
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : true; // true = reflect request origin (same as before for local installs)
app.use(cors({
  origin: CORS_ORIGINS,
  methods: ['GET', 'POST'],
  maxAge: 86400
}));

// Rate limiting — protect against abuse
// NOTE: OpenHamClock is a real-time dashboard that polls many endpoints every few seconds
// per connected client, so the general limit must be generous for normal operation.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 600, // 600 requests per minute per IP (10/sec covers normal dashboard polling)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', apiLimiter);

// Stricter rate limit for write/expensive endpoints
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

app.use(express.json({ limit: '1mb' })); // Limit body size to prevent DoS

// GZIP compression - reduces response sizes by 70-90%
// This is critical for reducing bandwidth/egress costs
app.use(compression({
  level: 6, // Balanced compression level (1-9)
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Never compress SSE streams — compression buffers prevent events from flushing
    if (req.headers['accept'] === 'text/event-stream') return false;
    // Compress everything except already-compressed formats
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// API response caching middleware
// Sets Cache-Control headers based on endpoint to reduce client polling
app.use('/api', (req, res, next) => {
  // Never set cache headers on SSE streams
  if (req.path.includes('/stream/')) {
    return next();
  }
  
  // Settings must always be fresh (multi-device sync)
  if (req.path.includes('/settings')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return next();
  }
  
  // Determine cache duration based on endpoint
  let cacheDuration = 30; // Default: 30 seconds
  
  const path = req.path.toLowerCase();
  
  if (path.includes('/satellites/tle')) {
    cacheDuration = 3600; // 1 hour (TLE data is static)
  } else if (path.includes('/contests') || path.includes('/dxpeditions')) {
    cacheDuration = 1800; // 30 minutes (contests/expeditions change slowly)
  } else if (path.includes('/solar-indices') || path.includes('/noaa')) {
    cacheDuration = 300; // 5 minutes (space weather updates every 5 min)
  } else if (path.includes('/propagation')) {
    cacheDuration = 600; // 10 minutes
  } else if (path.includes('/n0nbh') || path.includes('/hamqsl')) {
    cacheDuration = 3600; // 1 hour (N0NBH updates every 3 hours)
  } else if (path.includes('/pota') || path.includes('/sota')) {
    cacheDuration = 120; // 2 minutes
  } else if (path.includes('/pskreporter')) {
    cacheDuration = 300; // 5 minutes (PSKReporter rate limits aggressively)
  } else if (path.includes('/dxcluster') || path.includes('/myspots')) {
    cacheDuration = 30; // 30 seconds (DX spots need to be relatively fresh)
  } else if (path.includes('/config')) {
    cacheDuration = 3600; // 1 hour (config rarely changes)
  }
  
  res.setHeader('Cache-Control', `public, max-age=${cacheDuration}`);
  res.setHeader('Vary', 'Accept-Encoding');
  next();
});

// ============================================
// LOGGING SYSTEM
// ============================================
// LOG_LEVEL: 'debug' = verbose, 'info' = normal, 'warn' = warnings+errors, 'error' = errors only
const LOG_LEVEL = (process.env.LOG_LEVEL || 'warn').toLowerCase();
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.warn;

function logDebug(...args) {
  if (currentLogLevel <= LOG_LEVELS.debug) console.log(...args);
}
function logInfo(...args) {
  if (currentLogLevel <= LOG_LEVELS.info) console.log(...args);
}
function logWarn(...args) {
  if (currentLogLevel <= LOG_LEVELS.warn) console.warn(...args);
}

// Rate-limited error logging - prevents log spam when services are down
const errorLogState = {};
const ERROR_LOG_INTERVAL = 5 * 60 * 1000; // Only log same error once per 5 minutes

function logErrorOnce(category, message) {
  const key = `${category}:${message}`;
  const now = Date.now();
  const lastLogged = errorLogState[key] || 0;
  
  if (now - lastLogged >= ERROR_LOG_INTERVAL) {
    errorLogState[key] = now;
    console.error(`[${category}] ${message}`);
    return true;
  }
  return false;
}

// ============================================
// ENDPOINT MONITORING SYSTEM
// ============================================
// Tracks request count, response sizes, and timing per endpoint
// Helps identify bandwidth-heavy endpoints for optimization

// Helper to format bytes for display
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const endpointStats = {
  endpoints: new Map(), // endpoint path -> stats
  startTime: Date.now(),
  
  // Reset stats (call daily or on demand)
  reset() {
    this.endpoints.clear();
    this.startTime = Date.now();
  },
  
  // Record a request
  record(path, responseSize, duration, statusCode) {
    // Normalize path (remove params like callsign values)
    const normalizedPath = path
      .replace(/\/[A-Z0-9]{3,10}(-[A-Z0-9]+)?$/i, '/:param') // callsigns
      .replace(/\/\d+$/g, '/:id'); // numeric IDs
    
    if (!this.endpoints.has(normalizedPath)) {
      this.endpoints.set(normalizedPath, {
        path: normalizedPath,
        requests: 0,
        totalBytes: 0,
        totalDuration: 0,
        errors: 0,
        lastRequest: null
      });
    }
    
    const stats = this.endpoints.get(normalizedPath);
    stats.requests++;
    stats.totalBytes += responseSize || 0;
    stats.totalDuration += duration || 0;
    stats.lastRequest = Date.now();
    if (statusCode >= 400) stats.errors++;
  },
  
  // Get sorted stats for display
  getStats() {
    const uptimeHours = (Date.now() - this.startTime) / (1000 * 60 * 60);
    const stats = Array.from(this.endpoints.values())
      .map(s => ({
        ...s,
        avgBytes: s.requests > 0 ? Math.round(s.totalBytes / s.requests) : 0,
        avgDuration: s.requests > 0 ? Math.round(s.totalDuration / s.requests) : 0,
        requestsPerHour: uptimeHours > 0 ? (s.requests / uptimeHours).toFixed(1) : s.requests,
        bytesPerHour: uptimeHours > 0 ? Math.round(s.totalBytes / uptimeHours) : s.totalBytes,
        errorRate: s.requests > 0 ? ((s.errors / s.requests) * 100).toFixed(1) : 0
      }))
      .sort((a, b) => b.totalBytes - a.totalBytes); // Sort by bandwidth usage
    
    return {
      uptimeHours: uptimeHours.toFixed(2),
      totalRequests: stats.reduce((sum, s) => sum + s.requests, 0),
      totalBytes: stats.reduce((sum, s) => sum + s.totalBytes, 0),
      endpoints: stats
    };
  }
};

// Middleware to track endpoint usage
app.use('/api', (req, res, next) => {
  // Skip health and version endpoints to avoid recursive/noisy tracking
  if (req.path === '/health' || req.path === '/version') return next();
  
  const startTime = Date.now();
  let responseSize = 0;
  
  // Intercept response to measure size
  const originalSend = res.send;
  const originalJson = res.json;
  
  res.send = function(body) {
    if (body) {
      responseSize = typeof body === 'string' ? Buffer.byteLength(body) : 
                     Buffer.isBuffer(body) ? body.length : 
                     JSON.stringify(body).length;
    }
    return originalSend.call(this, body);
  };
  
  res.json = function(body) {
    if (body) {
      responseSize = Buffer.byteLength(JSON.stringify(body));
    }
    return originalJson.call(this, body);
  };
  
  // Record stats when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    endpointStats.record(req.path, responseSize, duration, res.statusCode);
  });
  
  next();
});

// ============================================
// VISITOR TRACKING (PERSISTENT)
// ============================================
// Persistent visitor tracking that survives server restarts and deployments
// Uses file-based storage - configure STATS_FILE env var for Railway volumes
// Default: ./data/stats.json (local) or /data/stats.json (Railway volume)

// Determine best location for stats file with write permission check
function getStatsFilePath() {
  // If explicitly set via env var, use that
  if (process.env.STATS_FILE) {
    console.log(`[Stats] Using STATS_FILE env: ${process.env.STATS_FILE}`);
    return process.env.STATS_FILE;
  }
  
  // List of paths to try in order of preference
  const pathsToTry = [
    '/data/stats.json',                           // Railway volume
    path.join(__dirname, 'data', 'stats.json'),   // Local ./data subdirectory
    '/tmp/openhamclock-stats.json'                // Temp (won't survive restarts but better than nothing)
  ];
  
  for (const statsPath of pathsToTry) {
    try {
      const dir = path.dirname(statsPath);
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Test write permission
      const testFile = path.join(dir, '.write-test-' + Date.now());
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      
      console.log(`[Stats] ✓ Using: ${statsPath}`);
      return statsPath;
    } catch (err) {
      console.log(`[Stats] ✗ ${statsPath}: ${err.code || err.message}`);
    }
  }
  
  // No writable path found
  console.log('[Stats] ⚠ No writable storage - stats will be memory-only');
  return null;
}

const STATS_FILE = getStatsFilePath();
const STATS_SAVE_INTERVAL = 60000; // Save every 60 seconds

// Load persistent stats from disk
function loadVisitorStats() {
  const defaults = {
    today: new Date().toISOString().slice(0, 10),
    uniqueIPsToday: [],
    totalRequestsToday: 0,
    allTimeVisitors: 0,
    allTimeRequests: 0,
    allTimeUniqueIPs: [],
    serverFirstStarted: new Date().toISOString(),
    lastDeployment: new Date().toISOString(),
    deploymentCount: 1,
    history: [],
    lastSaved: null
  };
  
  // No stats file configured - memory only mode
  if (!STATS_FILE) {
    console.log('[Stats] Running in memory-only mode');
    return defaults;
  }
  
  try {
    if (fs.existsSync(STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      console.log(`[Stats] Loaded from ${STATS_FILE}`);
      console.log(`[Stats]   📊 All-time: ${data.allTimeVisitors || 0} unique visitors, ${data.allTimeRequests || 0} requests`);
      console.log(`[Stats]   📅 History: ${(data.history || []).length} days tracked`);
      console.log(`[Stats]   🚀 Deployment #${(data.deploymentCount || 0) + 1} (first: ${data.serverFirstStarted || 'unknown'})`);
      
      return {
        today: new Date().toISOString().slice(0, 10),
        uniqueIPsToday: data.today === new Date().toISOString().slice(0, 10) ? (data.uniqueIPsToday || []) : [],
        totalRequestsToday: data.today === new Date().toISOString().slice(0, 10) ? (data.totalRequestsToday || 0) : 0,
        allTimeVisitors: data.allTimeVisitors || 0,
        allTimeRequests: data.allTimeRequests || 0,
        allTimeUniqueIPs: data.allTimeUniqueIPs || [],
        serverFirstStarted: data.serverFirstStarted || defaults.serverFirstStarted,
        lastDeployment: new Date().toISOString(),
        deploymentCount: (data.deploymentCount || 0) + 1,
        history: data.history || [],
        lastSaved: data.lastSaved
      };
    }
  } catch (err) {
    console.error('[Stats] Failed to load:', err.message);
  }
  
  console.log('[Stats] Starting fresh (no existing stats file)');
  return defaults;
}

// Save stats to disk
let saveErrorCount = 0;
function saveVisitorStats() {
  // No stats file configured - memory only mode
  if (!STATS_FILE) {
    return;
  }
  
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const data = {
      ...visitorStats,
      lastSaved: new Date().toISOString()
    };
    
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
    visitorStats.lastSaved = data.lastSaved; // Update in-memory too
    saveErrorCount = 0; // Reset on success
    // Only log occasionally to avoid spam
    if (Math.random() < 0.1) {
      console.log(`[Stats] Saved - ${visitorStats.allTimeVisitors} all-time visitors, ${visitorStats.uniqueIPsToday.length} today`);
    }
  } catch (err) {
    saveErrorCount++;
    // Only log first error and then every 10th to avoid spam
    if (saveErrorCount === 1 || saveErrorCount % 10 === 0) {
      console.error(`[Stats] Failed to save (attempt #${saveErrorCount}):`, err.message);
      if (saveErrorCount === 1) {
        console.error('[Stats] Stats will be kept in memory but won\'t persist across restarts');
      }
    }
  }
}

// Initialize stats
const visitorStats = loadVisitorStats();

// Convert today's IPs to a Set for fast lookup
const todayIPSet = new Set(visitorStats.uniqueIPsToday);
const allTimeIPSet = new Set(visitorStats.allTimeUniqueIPs);

// ============================================
// GEO-IP COUNTRY RESOLUTION
// ============================================
// Resolves visitor IPs to country codes using ip-api.com batch endpoint.
// Free tier: 15 batch requests/minute, 100 IPs per batch. No API key needed.
// Results cached persistently in visitorStats.geoIPCache.

// Initialize country tracking in visitorStats if not present
if (!visitorStats.countryStats) visitorStats.countryStats = {};           // { US: 42, DE: 7, ... }
if (!visitorStats.countryStatsToday) visitorStats.countryStatsToday = {}; // Reset daily
if (!visitorStats.geoIPCache) visitorStats.geoIPCache = {};              // { "1.2.3.4": "US", ... }

const geoIPCache = new Map(Object.entries(visitorStats.geoIPCache));      // ip -> countryCode
const geoIPQueue = new Set();                                             // IPs pending lookup
let geoIPLastBatch = 0;
const GEOIP_BATCH_INTERVAL = 30 * 1000;  // Resolve every 30 seconds
const GEOIP_BATCH_SIZE = 100;             // ip-api.com batch limit

// Queue any existing IPs that haven't been resolved yet
for (const ip of allTimeIPSet) {
  if (!geoIPCache.has(ip) && ip !== 'unknown' && !ip.startsWith('127.') && !ip.startsWith('::')) {
    geoIPQueue.add(ip);
  }
}
if (geoIPQueue.size > 0) {
  logInfo(`[GeoIP] Queued ${geoIPQueue.size} unresolved IPs from history for batch lookup`);
}

/**
 * Queue an IP for GeoIP resolution
 */
function queueGeoIPLookup(ip) {
  if (!ip || ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('::1') || ip === '0.0.0.0') return;
  if (geoIPCache.has(ip)) return;
  geoIPQueue.add(ip);
}

/**
 * Record a resolved country for an IP
 */
function recordCountry(ip, countryCode) {
  if (!countryCode || countryCode === 'Unknown') return;
  geoIPCache.set(ip, countryCode);
  visitorStats.geoIPCache[ip] = countryCode;
  
  // All-time stats
  visitorStats.countryStats[countryCode] = (visitorStats.countryStats[countryCode] || 0) + 1;
  
  // Today stats (only if IP is in today's set)
  if (todayIPSet.has(ip)) {
    visitorStats.countryStatsToday[countryCode] = (visitorStats.countryStatsToday[countryCode] || 0) + 1;
  }
}

/**
 * Batch resolve queued IPs via ip-api.com
 * Uses the batch endpoint: POST http://ip-api.com/batch
 * Free tier: 15 requests/minute, 100 IPs per request
 */
async function resolveGeoIPBatch() {
  if (geoIPQueue.size === 0) return;
  
  const now = Date.now();
  if (now - geoIPLastBatch < GEOIP_BATCH_INTERVAL) return;
  geoIPLastBatch = now;
  
  // Take up to GEOIP_BATCH_SIZE IPs from queue
  const batch = [];
  for (const ip of geoIPQueue) {
    batch.push(ip);
    if (batch.length >= GEOIP_BATCH_SIZE) break;
  }
  
  // Remove from queue before fetching (will re-queue on failure)
  batch.forEach(ip => geoIPQueue.delete(ip));
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch('http://ip-api.com/batch?fields=query,countryCode,status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch.map(ip => ({ query: ip, fields: 'query,countryCode,status' }))),
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.status === 429) {
      // Rate limited — re-queue and back off
      batch.forEach(ip => geoIPQueue.add(ip));
      logWarn('[GeoIP] Rate limited by ip-api.com, will retry later');
      geoIPLastBatch = now + 60000; // Extra 60s backoff
      return;
    }
    
    if (!response.ok) {
      batch.forEach(ip => geoIPQueue.add(ip));
      logWarn(`[GeoIP] Batch lookup failed: HTTP ${response.status}`);
      return;
    }
    
    const results = await response.json();
    let resolved = 0;
    
    for (const entry of results) {
      if (entry.status === 'success' && entry.countryCode) {
        recordCountry(entry.query, entry.countryCode);
        resolved++;
      }
      // Don't re-queue failures (private IPs, invalid IPs) — they'll never resolve
    }
    
    if (resolved > 0) {
      logDebug(`[GeoIP] Resolved ${resolved}/${batch.length} IPs (${geoIPQueue.size} remaining)`);
    }
  } catch (err) {
    // Re-queue on network errors
    batch.forEach(ip => geoIPQueue.add(ip));
    if (err.name !== 'AbortError') {
      logErrorOnce('GeoIP', `Batch lookup error: ${err.message}`);
    }
  }
}

// Run GeoIP batch resolver every 30 seconds
setInterval(resolveGeoIPBatch, GEOIP_BATCH_INTERVAL);
// Initial batch (with 5s delay to let startup complete)
setTimeout(resolveGeoIPBatch, 5000);

// Save immediately on startup to confirm persistence is working
if (STATS_FILE) {
  saveVisitorStats();
  console.log('[Stats] Initial save complete - persistence confirmed');
}

// Periodic save
setInterval(saveVisitorStats, STATS_SAVE_INTERVAL);

// Save on shutdown
function gracefulShutdown(signal) {
  console.log(`[Stats] Received ${signal}, saving before shutdown...`);
  saveVisitorStats();
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

function rolloverVisitorStats() {
  const now = new Date().toISOString().slice(0, 10);
  if (now !== visitorStats.today) {
    // Save yesterday's stats to history
    if (visitorStats.uniqueIPsToday.length > 0 || visitorStats.totalRequestsToday > 0) {
      visitorStats.history.push({
        date: visitorStats.today,
        uniqueVisitors: visitorStats.uniqueIPsToday.length,
        totalRequests: visitorStats.totalRequestsToday,
        countries: { ...visitorStats.countryStatsToday }
      });
    }
    // Keep only last 90 days
    if (visitorStats.history.length > 90) {
      visitorStats.history = visitorStats.history.slice(-90);
    }
    const avg = visitorStats.history.length > 0
      ? Math.round(visitorStats.history.reduce((sum, d) => sum + d.uniqueVisitors, 0) / visitorStats.history.length)
      : 0;
    console.log(`[Stats] Daily rollover for ${visitorStats.today}: ${visitorStats.uniqueIPsToday.length} unique, ${visitorStats.totalRequestsToday} requests | All-time: ${visitorStats.allTimeVisitors} visitors | ${visitorStats.history.length}-day avg: ${avg}/day`);
    
    // Reset daily counters
    visitorStats.today = now;
    visitorStats.uniqueIPsToday = [];
    visitorStats.totalRequestsToday = 0;
    visitorStats.countryStatsToday = {};
    todayIPSet.clear();
    
    // Save after rollover
    saveVisitorStats();
  }
}

// ============================================
// CONCURRENT USER & SESSION TRACKING
// ============================================
// Track active sessions by IP for concurrent user count and session duration trends
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes of inactivity = session ended
const SESSION_CLEANUP_INTERVAL = 60 * 1000; // Check for stale sessions every minute

const sessionTracker = {
  activeSessions: new Map(), // ip -> { firstSeen, lastSeen, requests, userAgent }
  completedSessions: [],     // [{ duration, endedAt, requests }] — last 1000
  peakConcurrent: 0,
  peakConcurrentTime: null,
  
  // Record activity for an IP
  touch(ip, userAgent) {
    const now = Date.now();
    if (this.activeSessions.has(ip)) {
      const session = this.activeSessions.get(ip);
      session.lastSeen = now;
      session.requests++;
    } else {
      this.activeSessions.set(ip, {
        firstSeen: now,
        lastSeen: now,
        requests: 1,
        userAgent: (userAgent || '').slice(0, 100)
      });
    }
    // Update peak
    const current = this.activeSessions.size;
    if (current > this.peakConcurrent) {
      this.peakConcurrent = current;
      this.peakConcurrentTime = new Date().toISOString();
    }
  },
  
  // Expire stale sessions and record their durations
  cleanup() {
    const now = Date.now();
    const expired = [];
    for (const [ip, session] of this.activeSessions) {
      if (now - session.lastSeen > SESSION_TIMEOUT) {
        expired.push(ip);
        const duration = session.lastSeen - session.firstSeen;
        // Only record sessions that lasted at least 10 seconds (filter out bots/crawlers)
        if (duration > 10000) {
          this.completedSessions.push({
            duration,
            endedAt: new Date(session.lastSeen).toISOString(),
            requests: session.requests
          });
        }
      }
    }
    expired.forEach(ip => this.activeSessions.delete(ip));
    // Keep only last 1000 completed sessions
    if (this.completedSessions.length > 1000) {
      this.completedSessions = this.completedSessions.slice(-1000);
    }
  },
  
  // Get current concurrent count
  getConcurrent() {
    this.cleanup();
    return this.activeSessions.size;
  },
  
  // Get session duration stats
  getStats() {
    this.cleanup();
    const sessions = this.completedSessions;
    if (sessions.length === 0) {
      return {
        concurrent: this.activeSessions.size,
        peakConcurrent: this.peakConcurrent,
        peakConcurrentTime: this.peakConcurrentTime,
        completedSessions: 0,
        avgDuration: 0,
        medianDuration: 0,
        p90Duration: 0,
        maxDuration: 0,
        durationBuckets: { under1m: 0, '1to5m': 0, '5to15m': 0, '15to30m': 0, '30to60m': 0, over1h: 0 },
        recentTrend: [],
        activeSessions: []
      };
    }
    
    const durations = sessions.map(s => s.duration).sort((a, b) => a - b);
    const avg = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
    const median = durations[Math.floor(durations.length / 2)];
    const p90 = durations[Math.floor(durations.length * 0.9)];
    const max = durations[durations.length - 1];
    
    // Duration distribution buckets
    const buckets = { under1m: 0, '1to5m': 0, '5to15m': 0, '15to30m': 0, '30to60m': 0, over1h: 0 };
    for (const d of durations) {
      if (d < 60000) buckets.under1m++;
      else if (d < 300000) buckets['1to5m']++;
      else if (d < 900000) buckets['5to15m']++;
      else if (d < 1800000) buckets['15to30m']++;
      else if (d < 3600000) buckets['30to60m']++;
      else buckets.over1h++;
    }
    
    // Hourly trend (last 24 hours) — avg session duration and concurrent users per hour
    const recentTrend = [];
    const now = Date.now();
    for (let h = 23; h >= 0; h--) {
      const hourStart = now - (h + 1) * 3600000;
      const hourEnd = now - h * 3600000;
      const hourSessions = sessions.filter(s => {
        const t = new Date(s.endedAt).getTime();
        return t >= hourStart && t < hourEnd;
      });
      const hourLabel = new Date(hourStart).toISOString().slice(11, 16);
      recentTrend.push({
        hour: hourLabel,
        sessions: hourSessions.length,
        avgDuration: hourSessions.length > 0 
          ? Math.round(hourSessions.reduce((s, x) => s + x.duration, 0) / hourSessions.length)
          : 0,
        avgDurationFormatted: hourSessions.length > 0
          ? formatDuration(Math.round(hourSessions.reduce((s, x) => s + x.duration, 0) / hourSessions.length))
          : '--'
      });
    }
    
    // Active session durations (current users)
    const activeList = [];
    for (const [ip, session] of this.activeSessions) {
      activeList.push({
        duration: now - session.firstSeen,
        durationFormatted: formatDuration(now - session.firstSeen),
        requests: session.requests,
        ip: ip.replace(/\d+$/, 'x') // Anonymize last octet
      });
    }
    activeList.sort((a, b) => b.duration - a.duration);
    
    return {
      concurrent: this.activeSessions.size,
      peakConcurrent: this.peakConcurrent,
      peakConcurrentTime: this.peakConcurrentTime,
      completedSessions: sessions.length,
      avgDuration: avg,
      avgDurationFormatted: formatDuration(avg),
      medianDuration: median,
      medianDurationFormatted: formatDuration(median),
      p90Duration: p90,
      p90DurationFormatted: formatDuration(p90),
      maxDuration: max,
      maxDurationFormatted: formatDuration(max),
      durationBuckets: buckets,
      recentTrend,
      activeSessions: activeList.slice(0, 20) // Top 20 longest active
    };
  }
};

function formatDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// Periodic cleanup of stale sessions
setInterval(() => sessionTracker.cleanup(), SESSION_CLEANUP_INTERVAL);

// Visitor tracking middleware
app.use((req, res, next) => {
  rolloverVisitorStats();
  
  // Track concurrent sessions for ALL requests (not just countable routes)
  const sessionIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
  if (req.path !== '/api/health' && !req.path.startsWith('/assets/')) {
    sessionTracker.touch(sessionIp, req.headers['user-agent']);
  }
  
  // Only count meaningful "visits" — initial page load or config fetch
  const countableRoutes = ['/', '/index.html', '/api/config'];
  if (countableRoutes.includes(req.path)) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
    
    // Track today's visitors
    const isNewToday = !todayIPSet.has(ip);
    if (isNewToday) {
      todayIPSet.add(ip);
      visitorStats.uniqueIPsToday.push(ip);
    }
    visitorStats.totalRequestsToday++;
    visitorStats.allTimeRequests++;
    
    // Track all-time unique visitors
    const isNewAllTime = !allTimeIPSet.has(ip);
    if (isNewAllTime) {
      allTimeIPSet.add(ip);
      visitorStats.allTimeUniqueIPs.push(ip);
      visitorStats.allTimeVisitors++;
      queueGeoIPLookup(ip);
      logInfo(`[Stats] New visitor (#${visitorStats.uniqueIPsToday.length} today, #${visitorStats.allTimeVisitors} all-time) from ${ip.replace(/\d+$/, 'x')}`);
    } else if (isNewToday) {
      // Existing all-time visitor but new today — queue GeoIP in case cache was lost
      queueGeoIPLookup(ip);
    }
  }
  
  next();
});

// Log visitor count every hour
setInterval(() => {
  rolloverVisitorStats();
  if (visitorStats.uniqueIPsToday.length > 0 || visitorStats.allTimeVisitors > 0) {
    const avg = visitorStats.history.length > 0
      ? Math.round(visitorStats.history.reduce((sum, d) => sum + d.uniqueVisitors, 0) / visitorStats.history.length)
      : visitorStats.uniqueIPsToday.length;
    console.log(`[Stats] Hourly: ${visitorStats.uniqueIPsToday.length} unique today, ${visitorStats.totalRequestsToday} requests | All-time: ${visitorStats.allTimeVisitors} visitors | Avg: ${avg}/day`);
  }
}, 60 * 60 * 1000);

// Log memory usage every 15 minutes for leak detection
setInterval(() => {
  const mem = process.memoryUsage();
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
  const mqttStats = {
    subscribers: pskMqtt.subscribers.size,
    subscribedCalls: pskMqtt.subscribedCalls.size,
    sseClients: [...pskMqtt.subscribers.values()].reduce((n, s) => n + s.size, 0),
    recentSpotsEntries: pskMqtt.recentSpots.size,
    recentSpotsTotal: [...pskMqtt.recentSpots.values()].reduce((n, s) => n + s.length, 0),
    spotBufferEntries: pskMqtt.spotBuffer.size,
    spotBufferTotal: [...pskMqtt.spotBuffer.values()].reduce((n, b) => n + b.length, 0),
  };
  console.log(`[Memory] RSS=${mb(mem.rss)}MB Heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB External=${mb(mem.external)}MB | MQTT: ${mqttStats.sseClients} SSE clients, ${mqttStats.subscribedCalls} calls, ${mqttStats.recentSpotsTotal} recent spots (${mqttStats.recentSpotsEntries} entries), ${mqttStats.spotBufferTotal} buffered | GeoIP=${geoIPCache.size} MySpots=${mySpotsCache.size} AllTimeIPs=${allTimeIPSet.size}`);
}, 15 * 60 * 1000);

// ============================================
// AUTO UPDATE (GIT)
// ============================================
const AUTO_UPDATE_ENABLED = process.env.AUTO_UPDATE_ENABLED === 'true';
const AUTO_UPDATE_INTERVAL_MINUTES = parseInt(process.env.AUTO_UPDATE_INTERVAL_MINUTES || '60');
const AUTO_UPDATE_ON_START = process.env.AUTO_UPDATE_ON_START === 'true';
const AUTO_UPDATE_EXIT_AFTER = process.env.AUTO_UPDATE_EXIT_AFTER !== 'false';

const autoUpdateState = {
  inProgress: false,
  lastCheck: 0,
  lastResult: ''
};

function execFilePromise(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// Detect default branch (main or master) — cached after first call
let _defaultBranch = null;
async function getDefaultBranch() {
  if (_defaultBranch) return _defaultBranch;
  try {
    await execFilePromise('git', ['rev-parse', '--verify', 'origin/main'], { cwd: __dirname });
    _defaultBranch = 'main';
  } catch {
    _defaultBranch = 'master';
  }
  return _defaultBranch;
}

async function hasGitUpdates() {
  // Ensure remote URL is correct
  try {
    const { stdout: url } = await execFilePromise('git', ['remote', 'get-url', 'origin'], { cwd: __dirname });
    if (!url.trim()) {
      await execFilePromise('git', ['remote', 'add', 'origin', 'https://github.com/accius/openhamclock.git'], { cwd: __dirname });
    }
  } catch {
    try {
      await execFilePromise('git', ['remote', 'add', 'origin', 'https://github.com/accius/openhamclock.git'], { cwd: __dirname });
    } catch {} // already exists
  }
  
  // Fetch with --prune to clean stale refs
  await execFilePromise('git', ['fetch', 'origin', '--prune'], { cwd: __dirname });
  
  // Reset branch cache after fetch (refs may have changed)
  _defaultBranch = null;
  const branch = await getDefaultBranch();
  const local = (await execFilePromise('git', ['rev-parse', 'HEAD'], { cwd: __dirname })).stdout.trim();
  const remote = (await execFilePromise('git', ['rev-parse', `origin/${branch}`], { cwd: __dirname })).stdout.trim();
  return { updateAvailable: local !== remote, local, remote };
}

// Prevent chmod changes from showing as dirty (common on Pi, Mac, Windows/WSL)
if (fs.existsSync(path.join(__dirname, '.git'))) {
  try {
    execFile('git', ['config', 'core.fileMode', 'false'], { cwd: __dirname }, () => {});
  } catch {}
}

async function hasDirtyWorkingTree() {
  const status = await execFilePromise('git', ['status', '--porcelain'], { cwd: __dirname });
  return status.stdout.trim().length > 0;
}

function runUpdateScript() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'scripts', 'update.sh');
    const child = spawn('bash', [scriptPath, '--auto'], {
      cwd: __dirname,
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`update.sh exited with code ${code}`));
    });
  });
}

async function autoUpdateTick(trigger = 'interval', force = false) {
  if ((!AUTO_UPDATE_ENABLED && !force) || autoUpdateState.inProgress) return;
  autoUpdateState.inProgress = true;
  autoUpdateState.lastCheck = Date.now();

  try {
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
      autoUpdateState.lastResult = 'not-git';
      logWarn('[Auto Update] Skipped - not a git repository');
      return;
    }

    try {
      await execFilePromise('git', ['--version']);
    } catch {
      autoUpdateState.lastResult = 'no-git';
      logWarn('[Auto Update] Skipped - git not installed');
      return;
    }

    // Stash any local changes (permission changes, config edits, etc.) before pulling
    if (await hasDirtyWorkingTree()) {
      logInfo('[Auto Update] Stashing local changes before update');
      try {
        await execFilePromise('git', ['stash', '--include-untracked'], { cwd: __dirname });
      } catch (stashErr) {
        // If stash fails, try a hard reset of tracked files only
        logWarn('[Auto Update] Stash failed, resetting tracked files');
        await execFilePromise('git', ['checkout', '.'], { cwd: __dirname });
      }
    }

    const { updateAvailable } = await hasGitUpdates();
    if (!updateAvailable) {
      autoUpdateState.lastResult = 'up-to-date';
      logInfo(`[Auto Update] Up to date (${trigger})`);
      return;
    }

    autoUpdateState.lastResult = 'updating';
    logInfo('[Auto Update] Updates available - running update script');
    await runUpdateScript();
    autoUpdateState.lastResult = 'updated';
    logInfo('[Auto Update] Update complete');

    if (AUTO_UPDATE_EXIT_AFTER) {
      // Exit with code 75 (EX_TEMPFAIL) — a non-zero code that signals
      // "restart me" to systemd's Restart=on-failure AND Restart=always.
      // Previous versions used exit(0) which was clean/success, causing
      // Restart=on-failure to NOT restart the service.
      logInfo('[Auto Update] Restarting service (exit 75)...');
      process.exit(75);
    }
  } catch (err) {
    autoUpdateState.lastResult = 'error';
    logErrorOnce('Auto Update', err.message);
  } finally {
    autoUpdateState.inProgress = false;
  }
}

function startAutoUpdateScheduler() {
  if (!AUTO_UPDATE_ENABLED) return;
  const intervalMinutes = Number.isFinite(AUTO_UPDATE_INTERVAL_MINUTES) && AUTO_UPDATE_INTERVAL_MINUTES > 0
    ? AUTO_UPDATE_INTERVAL_MINUTES
    : 60;
  const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;

  logInfo(`[Auto Update] Enabled - every ${intervalMinutes} minutes`);

  if (AUTO_UPDATE_ON_START) {
    setTimeout(() => autoUpdateTick('startup'), 30000);
  }

  setInterval(() => autoUpdateTick('interval'), intervalMs);
}

// Serve static files
// dist/ contains the built React app (from npm run build)
// public/ contains the fallback page if build hasn't run
const distDir = path.join(__dirname, 'dist');
const publicDir = path.join(__dirname, 'public');

// Check if dist/ exists (has index.html from build)
const distExists = fs.existsSync(path.join(distDir, 'index.html'));

// Static file caching options
const staticOptions = {
  maxAge: '1d', // Cache static files for 1 day
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Never cache index.html - it references hashed assets, so stale copies
    // cause browsers to load old JS bundles after an update
    if (filePath.endsWith('index.html') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
};

// Long-term caching for hashed assets (Vite adds hash to filenames)
const assetOptions = {
  maxAge: '1y', // Cache hashed assets for 1 year
  immutable: true
};

if (distExists) {
  // Serve built React app from dist/
  // Hashed assets (with content hash in filename) can be cached forever
  app.use('/assets', express.static(path.join(distDir, 'assets'), assetOptions));
  app.use(express.static(distDir, staticOptions));
  console.log('[Server] Serving React app from dist/');
} else {
  // No build found - serve placeholder from public/
  console.log('[Server] ⚠️  No build found! Run: npm run build');
}

// Always serve public folder (for fallback and assets)
app.use(express.static(publicDir, staticOptions));

// ============================================
// API PROXY ENDPOINTS
// ============================================

// Centralized cache for NOAA data (5-minute cache)
const noaaCache = {
  flux: { data: null, timestamp: 0 },
  kindex: { data: null, timestamp: 0 },
  sunspots: { data: null, timestamp: 0 },
  xray: { data: null, timestamp: 0 },
  aurora: { data: null, timestamp: 0 },
  solarIndices: { data: null, timestamp: 0 }
};
const NOAA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// NOAA Space Weather - Solar Flux
app.get('/api/noaa/flux', async (req, res) => {
  try {
    if (noaaCache.flux.data && (Date.now() - noaaCache.flux.timestamp) < NOAA_CACHE_TTL) {
      return res.json(noaaCache.flux.data);
    }
    const response = await fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json');
    const data = await response.json();
    noaaCache.flux = { data, timestamp: Date.now() };
    res.json(data);
  } catch (error) {
    logErrorOnce('NOAA Flux', error.message);
    if (noaaCache.flux.data) return res.json(noaaCache.flux.data);
    res.status(500).json({ error: 'Failed to fetch solar flux data' });
  }
});

// NOAA Space Weather - K-Index
app.get('/api/noaa/kindex', async (req, res) => {
  try {
    if (noaaCache.kindex.data && (Date.now() - noaaCache.kindex.timestamp) < NOAA_CACHE_TTL) {
      return res.json(noaaCache.kindex.data);
    }
    const response = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
    const data = await response.json();
    noaaCache.kindex = { data, timestamp: Date.now() };
    res.json(data);
  } catch (error) {
    logErrorOnce('NOAA K-Index', error.message);
    if (noaaCache.kindex.data) return res.json(noaaCache.kindex.data);
    res.status(500).json({ error: 'Failed to fetch K-index data' });
  }
});

// NOAA Space Weather - Sunspots
app.get('/api/noaa/sunspots', async (req, res) => {
  try {
    if (noaaCache.sunspots.data && (Date.now() - noaaCache.sunspots.timestamp) < NOAA_CACHE_TTL) {
      return res.json(noaaCache.sunspots.data);
    }
    const response = await fetch('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json');
    const data = await response.json();
    noaaCache.sunspots = { data, timestamp: Date.now() };
    res.json(data);
  } catch (error) {
    logErrorOnce('NOAA Sunspots', error.message);
    if (noaaCache.sunspots.data) return res.json(noaaCache.sunspots.data);
    res.status(500).json({ error: 'Failed to fetch sunspot data' });
  }
});

// Solar Indices with History and Kp Forecast
// Current SFI/SSN: N0NBH (hamqsl.com) + SWPC summary (updated hourly)
// History SFI: SWPC f107_cm_flux.json (daily archive — may lag weeks behind)
// History SSN: SWPC observed-solar-cycle-indices.json (monthly archive)
// Kp: SWPC planetary k-index (3hr intervals, current) + forecast
app.get('/api/solar-indices', async (req, res) => {
  try {
    // Check cache first
    if (noaaCache.solarIndices.data && (Date.now() - noaaCache.solarIndices.timestamp) < NOAA_CACHE_TTL) {
      return res.json(noaaCache.solarIndices.data);
    }
    
    const [fluxRes, kIndexRes, kForecastRes, sunspotRes, sfiSummaryRes] = await Promise.allSettled([
      fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json'),
      fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
      fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'),
      fetch('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json'),
      fetch('https://services.swpc.noaa.gov/products/summary/10cm-flux.json')
    ]);

    const result = {
      sfi: { current: null, history: [] },
      kp: { current: null, history: [], forecast: [] },
      ssn: { current: null, history: [] },
      timestamp: new Date().toISOString()
    };

    // --- SFI current: prefer SWPC summary (updates every few hours) ---
    if (sfiSummaryRes.status === 'fulfilled' && sfiSummaryRes.value.ok) {
      try {
        const summary = await sfiSummaryRes.value.json();
        // Response: { "Flux": "158", "TimeStamp": "2026 Feb 10 2100 UTC", ... }
        const flux = parseInt(summary?.Flux);
        if (flux > 0) result.sfi.current = flux;
      } catch {}
    }

    // --- SFI current fallback: N0NBH (hamqsl.com, same as GridTracker/Log4OM) ---
    if (!result.sfi.current && n0nbhCache.data?.solarData?.solarFlux) {
      const flux = parseInt(n0nbhCache.data.solarData.solarFlux);
      if (flux > 0) result.sfi.current = flux;
    }

    // --- SFI history (daily archive — may be weeks behind, that's fine for trend) ---
    if (fluxRes.status === 'fulfilled' && fluxRes.value.ok) {
      const data = await fluxRes.value.json();
      if (data?.length) {
        const recent = data.slice(-30);
        result.sfi.history = recent.map(d => ({
          date: d.time_tag || d.date,
          value: Math.round(d.flux || d.value || 0)
        }));
        // Only use archive for current if we still don't have one
        if (!result.sfi.current) {
          result.sfi.current = result.sfi.history[result.sfi.history.length - 1]?.value || null;
        }
      }
    }

    // --- Kp history (last 3 days, 3-hour intervals) ---
    if (kIndexRes.status === 'fulfilled' && kIndexRes.value.ok) {
      const data = await kIndexRes.value.json();
      if (data?.length > 1) {
        const recent = data.slice(1).slice(-24);
        result.kp.history = recent.map(d => ({
          time: d[0],
          value: parseFloat(d[1]) || 0
        }));
        result.kp.current = result.kp.history[result.kp.history.length - 1]?.value || null;
      }
    }

    // --- Kp forecast ---
    if (kForecastRes.status === 'fulfilled' && kForecastRes.value.ok) {
      const data = await kForecastRes.value.json();
      if (data?.length > 1) {
        result.kp.forecast = data.slice(1).map(d => ({
          time: d[0],
          value: parseFloat(d[1]) || 0
        }));
      }
    }

    // --- SSN current: prefer N0NBH (daily, matches hamqsl.com/GridTracker/Log4OM) ---
    if (n0nbhCache.data?.solarData?.sunspots) {
      const ssn = parseInt(n0nbhCache.data.solarData.sunspots);
      if (ssn >= 0) result.ssn.current = ssn;
    }

    // --- SSN history (monthly archive) ---
    if (sunspotRes.status === 'fulfilled' && sunspotRes.value.ok) {
      const data = await sunspotRes.value.json();
      if (data?.length) {
        const recent = data.slice(-12);
        result.ssn.history = recent.map(d => ({
          date: `${d['time-tag'] || d.time_tag || ''}`,
          value: Math.round(d.ssn || 0)
        }));
        // Only use monthly archive for current if we still don't have one
        if (result.ssn.current == null) {
          result.ssn.current = result.ssn.history[result.ssn.history.length - 1]?.value || null;
        }
      }
    }

    // Cache the result
    noaaCache.solarIndices = { data: result, timestamp: Date.now() };
    
    res.json(result);
  } catch (error) {
    logErrorOnce('Solar Indices', error.message);
    // Return stale cache on error
    if (noaaCache.solarIndices.data) return res.json(noaaCache.solarIndices.data);
    res.status(500).json({ error: 'Failed to fetch solar indices' });
  }
});

// DXpedition Calendar - fetches from NG3K ADXO plain text version
let dxpeditionCache = { data: null, timestamp: 0, maxAge: 30 * 60 * 1000 }; // 30 min cache

app.get('/api/dxpeditions', async (req, res) => {
  try {
    const now = Date.now();
    logDebug('[DXpeditions] API called');
    
    // Return cached data if fresh
    if (dxpeditionCache.data && (now - dxpeditionCache.timestamp) < dxpeditionCache.maxAge) {
      logDebug('[DXpeditions] Returning cached data:', dxpeditionCache.data.dxpeditions?.length, 'entries');
      return res.json(dxpeditionCache.data);
    }
    
    // Fetch NG3K ADXO plain text version
    logDebug('[DXpeditions] Fetching from NG3K...');
    const response = await fetch('https://www.ng3k.com/Misc/adxoplain.html');
    if (!response.ok) {
      logDebug('[DXpeditions] NG3K fetch failed:', response.status);
      throw new Error('Failed to fetch NG3K: ' + response.status);
    }
    
    let text = await response.text();
    logDebug('[DXpeditions] Received', text.length, 'bytes raw');
    
    // Strip HTML tags and decode entities - the "plain" page is actually HTML!
    text = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles  
      .replace(/<br\s*\/?>/gi, '\n') // Convert br to newlines
      .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    logDebug('[DXpeditions] Cleaned text length:', text.length);
    logDebug('[DXpeditions] First 500 chars:', text.substring(0, 500));
    
    const dxpeditions = [];
    
    // Each entry starts with a date pattern like "Jan 1-Feb 16, 2026 DXCC:"
    // Split on date patterns that are followed by DXCC
    const entryPattern = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}[^D]*?DXCC:[^·]+?)(?=(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}|$)/gi;
    const entries = text.match(entryPattern) || [];
    
    logDebug('[DXpeditions] Found', entries.length, 'potential entries');
    
    // Log first 3 entries for debugging
    entries.slice(0, 3).forEach((e, i) => {
      logDebug(`[DXpeditions] Entry ${i}:`, e.substring(0, 150));
    });
    
    for (const entry of entries) {
      if (!entry.trim()) continue;
      
      // Skip header/footer/legend content
      if (entry.includes('ADXB=') || entry.includes('OPDX=') || entry.includes('425DX=') ||
          entry.includes('Last updated') || entry.includes('Copyright') || 
          entry.includes('Expired Announcements') || entry.includes('Table Version') ||
          entry.includes('About ADXO') || entry.includes('Search ADXO') ||
          entry.includes('GazDX=') || entry.includes('LNDX=') || entry.includes('TDDX=') ||
          entry.includes('DXW.Net=') || entry.includes('DXMB=')) continue;
      
      // Try multiple parsing strategies
      let callsign = null;
      let entity = null;
      let qsl = null;
      let info = null;
      let dateStr = null;
      
      // Strategy 1: "DXCC: xxx Callsign: xxx" format
      const dxccMatch = entry.match(/DXCC:\s*([^C\n]+?)(?=Callsign:|QSL:|Source:|Info:|$)/i);
      const callMatch = entry.match(/Callsign:\s*([A-Z0-9\/]+)/i);
      
      if (callMatch && dxccMatch) {
        callsign = callMatch[1].trim().toUpperCase();
        entity = dxccMatch[1].trim();
      }
      
      // Strategy 2: Look for callsign patterns directly (like "3Y0K" or "VP8/G3ABC")
      if (!callsign) {
        const directCallMatch = entry.match(/\b([A-Z]{1,2}\d[A-Z0-9]*[A-Z](?:\/[A-Z0-9]+)?)\b/);
        if (directCallMatch) {
          callsign = directCallMatch[1];
        }
      }
      
      // Strategy 3: Parse "Entity - Callsign" or similar patterns
      if (!callsign) {
        const altMatch = entry.match(/([A-Za-z\s&]+?)\s*[-–:]\s*([A-Z]{1,2}\d[A-Z0-9]*)/);
        if (altMatch) {
          entity = altMatch[1].trim();
          callsign = altMatch[2].trim();
        }
      }
      
      // Extract other fields
      const qslMatch = entry.match(/QSL:\s*([A-Za-z0-9]+)/i);
      const infoMatch = entry.match(/Info:\s*(.+)/i);
      // Date is at the start of entry: "Jan 1-Feb 16, 2026"
      const dateMatch = entry.match(/^([A-Za-z]{3}\s+\d{1,2}[^D]*?)(?=DXCC:)/i);
      
      qsl = qslMatch ? qslMatch[1].trim() : '';
      info = infoMatch ? infoMatch[1].trim() : '';
      dateStr = dateMatch ? dateMatch[1].trim() : '';
      
      // Skip if we couldn't find a callsign
      if (!callsign || callsign.length < 3) continue;
      
      // Skip obviously wrong matches
      if (/^(DXCC|QSL|INFO|SOURCE|THE|AND|FOR)$/i.test(callsign)) continue;
      
      // Log first few successful parses
      if (dxpeditions.length < 3) {
        logDebug(`[DXpeditions] Parsed: ${callsign} - ${entity} - ${dateStr}`);
      }
      
      // Try to extract entity from context if not found
      if (!entity && info) {
        // Look for "from Entity" or "fm Entity" patterns
        const fromMatch = info.match(/(?:from|fm)\s+([A-Za-z\s]+?)(?:;|,|$)/i);
        if (fromMatch) entity = fromMatch[1].trim();
      }
      
      // Parse dates
      let startDate = null;
      let endDate = null;
      let isActive = false;
      let isUpcoming = false;
      
      if (dateStr) {
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const datePattern = /([A-Za-z]{3})\s+(\d{1,2})(?:,?\s*(\d{4}))?(?:\s*[-–]\s*([A-Za-z]{3})?\s*(\d{1,2})(?:,?\s*(\d{4}))?)?/i;
        const dateParsed = dateStr.match(datePattern);
        
        if (dateParsed) {
          const currentYear = new Date().getFullYear();
          const startMonth = monthNames.indexOf(dateParsed[1].toLowerCase());
          const startDay = parseInt(dateParsed[2]);
          const startYear = dateParsed[3] ? parseInt(dateParsed[3]) : currentYear;
          
          const endMonthStr = dateParsed[4] || dateParsed[1];
          const endMonth = monthNames.indexOf(endMonthStr.toLowerCase());
          const endDay = parseInt(dateParsed[5]) || startDay + 14;
          const endYear = dateParsed[6] ? parseInt(dateParsed[6]) : startYear;
          
          if (startMonth >= 0) {
            startDate = new Date(startYear, startMonth, startDay);
            endDate = new Date(endYear, endMonth >= 0 ? endMonth : startMonth, endDay);
            
            if (endDate < startDate && !dateParsed[6]) {
              endDate.setFullYear(endYear + 1);
            }
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            isActive = startDate <= today && endDate >= today;
            isUpcoming = startDate > today;
          }
        }
      }
      
      // Extract bands and modes
      const bandsMatch = entry.match(/(\d+(?:-\d+)?m)/g);
      const bands = bandsMatch ? [...new Set(bandsMatch)].join(' ') : '';
      
      const modesMatch = entry.match(/\b(CW|SSB|FT8|FT4|RTTY|PSK|FM|AM|DIGI)\b/gi);
      const modes = modesMatch ? [...new Set(modesMatch.map(m => m.toUpperCase()))].join(' ') : '';
      
      dxpeditions.push({
        callsign,
        entity: entity || 'Unknown',
        dates: dateStr,
        qsl,
        info: (info || '').substring(0, 100),
        bands,
        modes,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        isActive,
        isUpcoming
      });
    }
    
    // Remove duplicates by callsign
    const seen = new Set();
    const uniqueDxpeditions = dxpeditions.filter(d => {
      if (seen.has(d.callsign)) return false;
      seen.add(d.callsign);
      return true;
    });
    
    // Sort: active first, then upcoming by start date
    uniqueDxpeditions.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      if (a.isUpcoming && !b.isUpcoming) return -1;
      if (!a.isUpcoming && b.isUpcoming) return 1;
      if (a.startDate && b.startDate) return new Date(a.startDate) - new Date(b.startDate);
      return 0;
    });
    
    logDebug('[DXpeditions] Parsed', uniqueDxpeditions.length, 'unique entries');
    if (uniqueDxpeditions.length > 0) {
      logDebug('[DXpeditions] First entry:', JSON.stringify(uniqueDxpeditions[0]));
    }
    
    const result = {
      dxpeditions: uniqueDxpeditions.slice(0, 50),
      active: uniqueDxpeditions.filter(d => d.isActive).length,
      upcoming: uniqueDxpeditions.filter(d => d.isUpcoming).length,
      source: 'NG3K ADXO',
      timestamp: new Date().toISOString()
    };
    
    logDebug('[DXpeditions] Result:', result.active, 'active,', result.upcoming, 'upcoming');
    
    dxpeditionCache.data = result;
    dxpeditionCache.timestamp = now;
    
    res.json(result);
  } catch (error) {
    logErrorOnce('DXpeditions', error.message);
    
    if (dxpeditionCache.data) {
      logDebug('[DXpeditions] Returning stale cache');
      return res.json({ ...dxpeditionCache.data, stale: true });
    }
    
    res.status(500).json({ error: 'Failed to fetch DXpedition data' });
  }
});

// NOAA Space Weather - X-Ray Flux
app.get('/api/noaa/xray', async (req, res) => {
  try {
    if (noaaCache.xray.data && (Date.now() - noaaCache.xray.timestamp) < NOAA_CACHE_TTL) {
      return res.json(noaaCache.xray.data);
    }
    const response = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json');
    const data = await response.json();
    noaaCache.xray = { data, timestamp: Date.now() };
    res.json(data);
  } catch (error) {
    logErrorOnce('NOAA X-Ray', error.message);
    if (noaaCache.xray.data) return res.json(noaaCache.xray.data);
    res.status(500).json({ error: 'Failed to fetch X-ray data' });
  }
});

// NOAA OVATION Aurora Forecast
const AURORA_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (matches NOAA update frequency)
app.get('/api/noaa/aurora', async (req, res) => {
  try {
    if (noaaCache.aurora.data && (Date.now() - noaaCache.aurora.timestamp) < AURORA_CACHE_TTL) {
      return res.json(noaaCache.aurora.data);
    }
    const response = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json');
    const data = await response.json();
    noaaCache.aurora = { data, timestamp: Date.now() };
    res.json(data);
  } catch (error) {
    logErrorOnce('NOAA Aurora', error.message);
    if (noaaCache.aurora.data) return res.json(noaaCache.aurora.data);
    res.status(500).json({ error: 'Failed to fetch aurora data' });
  }
});

// DX News from dxnews.com
let dxNewsCache = { data: null, timestamp: 0 };
const DXNEWS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

app.get('/api/dxnews', async (req, res) => {
  try {
    if (dxNewsCache.data && (Date.now() - dxNewsCache.timestamp) < DXNEWS_CACHE_TTL) {
      return res.json(dxNewsCache.data);
    }

    const response = await fetch('https://dxnews.com/', {
      headers: { 'User-Agent': 'OpenHamClock/3.13.1 (amateur radio dashboard)' }
    });
    const html = await response.text();

    // Parse news items from HTML
    const items = [];
    // Match pattern: <h3><a href="URL" title="TITLE">TITLE</a></h3> followed by date and description
    const articleRegex = /<h3[^>]*>\s*<a\s+href="([^"]+)"\s+title="([^"]+)"[^>]*>[^<]*<\/a>\s*<\/h3>\s*[\s\S]*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*[\s\S]*?<\/li>\s*<\/ul>\s*([\s\S]*?)(?:<ul|<div\s+class="more"|<\/div>)/g;

    // Simpler approach: split by article blocks
    const blocks = html.split(/<h3[^>]*>\s*<a\s+href="/);
    for (let i = 1; i < blocks.length && items.length < 20; i++) {
      try {
        const block = blocks[i];
        // Extract URL
        const urlMatch = block.match(/^([^"]+)"/);
        // Extract title
        const titleMatch = block.match(/title="([^"]+)"/);
        // Extract date
        const dateMatch = block.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
        // Extract description - text after the date, before stats
        const descParts = block.split(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
        let desc = '';
        if (descParts[1]) {
          // Get text content, strip HTML tags, then remove stats/junk
          desc = descParts[1]
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/Views\s*\d+.*/i, '')
            .replace(/Comments\s*\d+.*/i, '')
            .replace(/\d+%/, '')
            .replace(/More\.\.\..*/i, '')
            .trim()
            .substring(0, 200);
        }

        if (titleMatch && urlMatch) {
          items.push({
            title: titleMatch[1],
            url: 'https://dxnews.com/' + urlMatch[1],
            date: dateMatch ? dateMatch[1] : null,
            description: desc || titleMatch[1]
          });
        }
      } catch (e) {
        // Skip malformed entries
      }
    }

    const result = { items, fetched: new Date().toISOString() };
    dxNewsCache = { data: result, timestamp: Date.now() };
    res.json(result);
  } catch (error) {
    logErrorOnce('DX News', error.message);
    if (dxNewsCache.data) return res.json(dxNewsCache.data);
    res.status(500).json({ error: 'Failed to fetch DX news', items: [] });
  }
});

// POTA Spots
// POTA cache (1 minute)
let potaCache = { data: null, timestamp: 0 };
const POTA_CACHE_TTL = 90 * 1000; // 90 seconds (longer than 60s frontend poll to maximize cache hits)

app.get('/api/pota/spots', async (req, res) => {
  try {
    // Return cached data if fresh
    if (potaCache.data && (Date.now() - potaCache.timestamp) < POTA_CACHE_TTL) {
      return res.json(potaCache.data);
    }
    
    const response = await fetch('https://api.pota.app/spot/activator');
    const data = await response.json();
    
    // Log diagnostic info about the response
    if (Array.isArray(data) && data.length > 0) {
      const sample = data[0];
      logDebug('[POTA] API returned', data.length, 'spots. Sample fields:', Object.keys(sample).join(', '));
      
      // Count coordinate coverage
      const withLatLon = data.filter(s => s.latitude && s.longitude).length;
      const withGrid6 = data.filter(s => s.grid6).length;
      const withGrid4 = data.filter(s => s.grid4).length;
      const noCoords = data.filter(s => !s.latitude && !s.longitude && !s.grid6 && !s.grid4).length;
      logDebug(`[POTA] Coords: ${withLatLon} lat/lon, ${withGrid6} grid6, ${withGrid4} grid4, ${noCoords} no coords`);
    }
    
    // Cache the response
    potaCache = { data, timestamp: Date.now() };
    
    res.json(data);
  } catch (error) {
    logErrorOnce('POTA', error.message);
    // Return stale cache on error
    if (potaCache.data) return res.json(potaCache.data);
    res.status(500).json({ error: 'Failed to fetch POTA spots' });
  }
});

// SOTA cache (2 minutes)
let sotaCache = { data: null, timestamp: 0 };
const SOTA_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
let sotaSummits = { data: null, timestamp: 0};
const SOTASUMMITS_CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day

// SOTA Summits
// SOTA publishes a CSV of teh Summit detail every day. Save this into
// a cache so we can look it up when loading the spots.

async function checkSummitCache() {
  const now = Date.now();
  try {
    if (sotaSummits.data && (now - sotaSummits.timestamp) < SOTASUMMITS_CACHE_TTL) {
      return;
    }
    logDebug('[SOTA] Refreshing sotaSummits');
    const response = await fetch('https://storage.sota.org.uk/summitslist.csv');
    const data = await response.text();
    const rows = data.trim().split('\n');
    rows.shift(); // discard the title line
    const headers = rows.shift().split(',').map(header => header.trim());
    let summit = {};

    rows.forEach(row => {
      values = row.split(',').map(value => value.trim());
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index].replace(/"/g, '');
      });
      summit[obj['SummitCode']] = {
        latitude: obj['Latitude'],
        longitude: obj['Longitude'],
        name: obj['SummitName'],
        altM: obj['AltM'],
        points: obj['Points']
      };
    });
    sotaSummits = {
      data: summit,
      timestamp: now
    }
  } catch(error) {
    logErrorOnce('[SOTA]', error.message);
  }
}
checkSummitCache(); // Prime the sotaSummits cache

// SOTA Spots
app.get('/api/sota/spots', async (req, res) => {
  try {
    // Return cached data if fresh
    if (sotaCache.data && (Date.now() - sotaCache.timestamp) < SOTA_CACHE_TTL) {
      return res.json(sotaCache.data);
    }

    checkSummitCache(); // Updates sotaSummits if required

    const response = await fetch('https://api2.sota.org.uk/api/spots/50/all');
    const data = await response.json();

    if (sotaSummits.data) {
      // If we have data in teh sotaSummits cache, use it to populate summitDetails.
      data.map(s => {
        const summit = `${s.associationCode}/${s.summitCode}`;
        s.summitDetails = sotaSummits.data[summit];
      });
    }
    if (Array.isArray(data) && data.length > 0) {
      const sample = data[0];
      logDebug('[SOTA] API returned', data.length, 'spots. Sample fields:', Object.keys(sample).join(', '));
    }
    
    // Cache the response
    sotaCache = { data, timestamp: Date.now() };
    
    res.json(data);
  } catch (error) {
    logErrorOnce('SOTA', error.message);
    if (sotaCache.data) return res.json(sotaCache.data);
    res.status(500).json({ error: 'Failed to fetch SOTA spots' });
  }
});

// N0NBH / HamQSL cache (1 hour - N0NBH data updates every 3 hours, they ask for no more than 15-min refreshes)
let n0nbhCache = { data: null, timestamp: 0 };
const N0NBH_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Parse N0NBH solarxml.php XML into clean JSON
function parseN0NBHxml(xml) {
  const get = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m ? m[1].trim() : null;
  };
  
  // Parse HF band conditions
  const bandConditions = [];
  const bandRegex = /<band name="([^"]+)" time="([^"]+)">([^<]+)<\/band>/g;
  let match;
  while ((match = bandRegex.exec(xml)) !== null) {
    // Only grab from calculatedconditions (not VHF)
    if (match[1].includes('m-') || match[1].includes('m ')) {
      bandConditions.push({
        name: match[1],
        time: match[2],
        condition: match[3]
      });
    }
  }
  
  // Parse VHF conditions
  const vhfConditions = [];
  const vhfRegex = /<phenomenon name="([^"]+)" location="([^"]+)">([^<]+)<\/phenomenon>/g;
  while ((match = vhfRegex.exec(xml)) !== null) {
    vhfConditions.push({
      name: match[1],
      location: match[2],
      condition: match[3]
    });
  }
  
  return {
    source: 'N0NBH',
    updated: get('updated'),
    solarData: {
      solarFlux: get('solarflux'),
      aIndex: get('aindex'),
      kIndex: get('kindex'),
      kIndexNt: get('kindexnt'),
      xray: get('xray'),
      sunspots: get('sunspots'),
      heliumLine: get('heliumline'),
      protonFlux: get('protonflux'),
      electronFlux: get('electonflux'), // N0NBH has the typo in their XML
      aurora: get('aurora'),
      normalization: get('normalization'),
      latDegree: get('latdegree'),
      solarWind: get('solarwind'),
      magneticField: get('magneticfield'),
      fof2: get('fof2'),
      mufFactor: get('muffactor'),
      muf: get('muf')
    },
    geomagField: get('geomagfield'),
    signalNoise: get('signalnoise'),
    bandConditions,
    vhfConditions
  };
}

// N0NBH Parsed Band Conditions + Solar Data
app.get('/api/n0nbh', async (req, res) => {
  try {
    if (n0nbhCache.data && (Date.now() - n0nbhCache.timestamp) < N0NBH_CACHE_TTL) {
      return res.json(n0nbhCache.data);
    }
    
    const response = await fetch('https://www.hamqsl.com/solarxml.php');
    const xml = await response.text();
    const parsed = parseN0NBHxml(xml);
    
    n0nbhCache = { data: parsed, timestamp: Date.now() };
    res.json(parsed);
  } catch (error) {
    logErrorOnce('N0NBH', error.message);
    if (n0nbhCache.data) return res.json(n0nbhCache.data);
    res.status(500).json({ error: 'Failed to fetch N0NBH data' });
  }
});

// Legacy raw XML endpoint (kept for backward compat)
app.get('/api/hamqsl/conditions', async (req, res) => {
  try {
    // Use N0NBH cache if fresh, otherwise fetch
    if (n0nbhCache.data && (Date.now() - n0nbhCache.timestamp) < N0NBH_CACHE_TTL) {
      // Re-fetch raw XML from cache won't work since we only store parsed,
      // so just fetch fresh if needed
    }
    const response = await fetch('https://www.hamqsl.com/solarxml.php');
    const text = await response.text();
    res.set('Content-Type', 'application/xml');
    res.send(text);
  } catch (error) {
    logErrorOnce('HamQSL', error.message);
    res.status(500).json({ error: 'Failed to fetch band conditions' });
  }
});

// DX Cluster proxy - fetches from selectable sources
// Query param: ?source=hamqth|dxspider|proxy|auto (default: auto)
// Note: DX Spider uses telnet - works locally but may be blocked on cloud hosting
// The 'proxy' source uses our DX Spider Proxy microservice

// DX Spider Proxy URL (sibling service on Railway or external)
const DXSPIDER_PROXY_URL = process.env.DXSPIDER_PROXY_URL || 'https://dxspider-proxy-production-1ec7.up.railway.app';

// Cache for DX Spider telnet spots (to avoid excessive connections)
let dxSpiderCache = { spots: [], timestamp: 0 };
const DXSPIDER_CACHE_TTL = 90000; // 90 seconds cache - reduces reconnection frequency

// DX Spider nodes - dxspider.co.uk primary per G6NHU
// SSID -56 for OpenHamClock (HamClock uses -55)
const DXSPIDER_NODES = [
  { host: 'dxspider.co.uk', port: 7300 },
  { host: 'dxc.nc7j.com', port: 7373 },
  { host: 'dxc.ai9t.com', port: 7373 },
  { host: 'dxc.w6cua.org', port: 7300 }
];
const DXSPIDER_SSID = '-56'; // OpenHamClock SSID

// DX Spider telnet connection helper - used by both /api/dxcluster/spots and /api/dxcluster/paths
function tryDXSpiderNode(node, userCallsign = null) {
  return new Promise((resolve) => {
    const spots = [];
    let buffer = '';
    let loginSent = false;
    let commandSent = false;
    let resolved = false;
    
    // Use user's callsign with SSID if provided, otherwise GUEST
    const loginCallsign = userCallsign ? `${userCallsign.toUpperCase()}${DXSPIDER_SSID}` : 'GUEST';
    
    const client = new net.Socket();
    client.setTimeout(12000);
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try { client.destroy(); } catch(e) {}
      }
    };
    
    // Try connecting to DX Spider node
    client.connect(node.port, node.host, () => {
      logDebug(`[DX Cluster] DX Spider: connected to ${node.host}:${node.port} as ${loginCallsign}`);
    });
    
    client.on('data', (data) => {
      buffer += data.toString();
      
      // Wait for login prompt
      if (!loginSent && (buffer.includes('login:') || buffer.includes('Please enter your call') || buffer.includes('enter your callsign'))) {
        loginSent = true;
        client.write(`${loginCallsign}\r\n`);
        return;
      }
      
      // Wait for prompt after login, then send command
      if (loginSent && !commandSent && (buffer.includes('Hello') || buffer.includes('de ') || buffer.includes('>') || buffer.includes('GUEST') || buffer.includes(loginCallsign.split('-')[0]))) {
        commandSent = true;
        setTimeout(() => {
          if (!resolved) {
            client.write('sh/dx 25\r\n');
          }
        }, 1000);
        return;
      }
      
      // Parse DX spots from the output
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.includes('DX de ')) {
          const match = line.match(/DX de ([A-Z0-9\/\-]+):\s+(\d+\.?\d*)\s+([A-Z0-9\/\-]+)\s+(.+?)\s+(\d{4})Z/i);
          if (match) {
            const spotter = match[1].replace(':', '');
            const freqKhz = parseFloat(match[2]);
            const dxCall = match[3];
            const comment = match[4].trim();
            const timeStr = match[5];
            
            if (!isNaN(freqKhz) && freqKhz > 0 && dxCall) {
              const freqMhz = (freqKhz / 1000).toFixed(3);
              const time = timeStr.substring(0, 2) + ':' + timeStr.substring(2, 4) + 'z';
              
              // Avoid duplicates
              if (!spots.find(s => s.call === dxCall && s.freq === freqMhz)) {
                spots.push({
                  freq: freqMhz,
                  call: dxCall,
                  comment: comment,
                  time: time,
                  spotter: spotter,
                  source: 'DX Spider'
                });
              }
            }
          }
        }
      }
      
      // If we have enough spots, close connection
      if (spots.length >= 20) {
        client.write('bye\r\n');
        setTimeout(cleanup, 500);
      }
    });
    
    client.on('timeout', () => {
      cleanup();
    });
    
    client.on('error', (err) => {
      // Only log unexpected errors, not connection issues (they're common)
      if (!err.message.includes('ECONNRESET') && !err.message.includes('ETIMEDOUT') && !err.message.includes('ENOTFOUND') && !err.message.includes('ECONNREFUSED')) {
        logErrorOnce('DX Cluster', `DX Spider ${node.host}: ${err.message}`);
      }
      cleanup();
    });
    
    client.on('close', () => {
      if (!resolved) {
        resolved = true;
        if (spots.length > 0) {
          logDebug('[DX Cluster] DX Spider:', spots.length, 'spots from', node.host);
          dxSpiderCache = { spots: spots, timestamp: Date.now() };
          resolve(spots);
        } else {
          resolve(null);
        }
      }
    });
    
    // Fallback timeout - close after 15 seconds regardless
    setTimeout(() => {
      if (!resolved) {
        if (spots.length > 0) {
          resolved = true;
          logDebug('[DX Cluster] DX Spider:', spots.length, 'spots from', node.host);
          dxSpiderCache = { spots: spots, timestamp: Date.now() };
          resolve(spots);
        }
        cleanup();
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }
    }, 15000);
  });
}

app.get('/api/dxcluster/spots', async (req, res) => {
  const source = (req.query.source || CONFIG.dxClusterSource || 'auto').toLowerCase();
  
  // Helper function for HamQTH (HTTP-based, works everywhere)
  async function fetchHamQTH() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    try {
      const response = await fetch('https://www.hamqth.com/dxc_csv.php?limit=25', {
        headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      if (response.ok) {
        const text = await response.text();
        // HamQTH CSV format: Spotter^Frequency^DXCall^Comment^TimeDate^^^Continent^Band^Country^DXCC
        // Example: KF0NYM^18070.0^TX5U^Correction, Good Sig MO, 73^2149 2025-05-27^^^EU^17M^France^227
        const lines = text.trim().split('\n').filter(line => line.includes('^'));
        
        if (lines.length > 0) {
          const spots = lines.slice(0, 25).map(line => {
            const parts = line.split('^');
            const spotter = parts[0] || '';
            const freqKhz = parseFloat(parts[1]) || 0;
            const dxCall = parts[2] || 'UNKNOWN';
            const comment = parts[3] || '';
            const timeDate = parts[4] || '';
            
            // Frequency: convert from kHz to MHz
            const freqMhz = freqKhz > 1000 ? (freqKhz / 1000).toFixed(3) : String(freqKhz);
            
            // Time: extract HHMM from "2149 2025-05-27" format
            let time = '';
            if (timeDate && timeDate.length >= 4) {
              const timeStr = timeDate.substring(0, 4);
              time = timeStr.substring(0, 2) + ':' + timeStr.substring(2, 4) + 'z';
            }
            
            return {
              freq: freqMhz,
              call: dxCall,
              comment: comment,
              time: time,
              spotter: spotter,
              source: 'HamQTH'
            };
          });
          logDebug('[DX Cluster] HamQTH:', spots.length, 'spots');
          return spots;
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      if (error.name !== 'AbortError') {
        logErrorOnce('DX Cluster', `HamQTH: ${error.message}`);
      }
    }
    return null;
  }
  
  // Helper function for DX Spider Proxy (our microservice)
  async function fetchDXSpiderProxy() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    try {
      const response = await fetch(`${DXSPIDER_PROXY_URL}/api/dxcluster/spots?limit=50`, {
        headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      if (response.ok) {
        const spots = await response.json();
        if (Array.isArray(spots) && spots.length > 0) {
          logDebug('[DX Cluster] DX Spider Proxy:', spots.length, 'spots');
          return spots;
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      if (error.name !== 'AbortError') {
        logErrorOnce('DX Cluster', `Proxy: ${error.message}`);
      }
    }
    return null;
  }
  
  // Helper function for DX Spider (telnet-based, works locally/Pi)
  // Multiple nodes for failover - uses module-level constants and tryDXSpiderNode
  async function fetchDXSpider() {
    // Check cache first (use longer cache to reduce connection attempts)
    if (Date.now() - dxSpiderCache.timestamp < DXSPIDER_CACHE_TTL && dxSpiderCache.spots.length > 0) {
      logDebug('[DX Cluster] DX Spider: returning', dxSpiderCache.spots.length, 'cached spots');
      return dxSpiderCache.spots;
    }
    
    // Try each node until one succeeds
    for (const node of DXSPIDER_NODES) {
      const result = await tryDXSpiderNode(node);
      if (result && result.length > 0) {
        return result;
      }
    }
    
    logDebug('[DX Cluster] DX Spider: all nodes failed');
    return null;
  }
  
  // Fetch based on selected source
  let spots = null;
  
  if (source === 'hamqth') {
    spots = await fetchHamQTH();
  } else if (source === 'proxy') {
    spots = await fetchDXSpiderProxy();
    // Fallback to HamQTH if proxy fails
    if (!spots) {
      logDebug('[DX Cluster] Proxy failed, falling back to HamQTH');
      spots = await fetchHamQTH();
    }
  } else if (source === 'dxspider') {
    spots = await fetchDXSpider();
    // Fallback to HamQTH if DX Spider fails
    if (!spots) {
      logDebug('[DX Cluster] DX Spider failed, falling back to HamQTH');
      spots = await fetchHamQTH();
    }
  } else {
    // Auto mode - try Proxy first (best for Railway), then HamQTH, then DX Spider
    spots = await fetchDXSpiderProxy();
    if (!spots) {
      spots = await fetchHamQTH();
    }
    if (!spots) {
      spots = await fetchDXSpider();
    }
  }
  
  res.json(spots || []);
});

// Get available DX cluster sources
app.get('/api/dxcluster/sources', (req, res) => {
  res.json([
    { id: 'auto', name: 'Auto (Best Available)', description: 'Tries Proxy first, then HamQTH, then direct telnet' },
    { id: 'proxy', name: 'DX Spider Proxy ⭐', description: 'Our dedicated proxy service - real-time telnet feed via HTTP' },
    { id: 'hamqth', name: 'HamQTH', description: 'HamQTH.com CSV feed (HTTP, works everywhere)' },
    { id: 'dxspider', name: 'DX Spider Direct', description: 'Direct telnet to dxspider.co.uk (G6NHU) - works locally/Pi' }
  ]);
});

// ============================================
// DX SPOT PATHS API - Get spots with locations for map visualization
// Returns spots from the last 5 minutes with spotter and DX locations
// ============================================

// Cache for DX spot paths to avoid excessive lookups
let dxSpotPathsCache = { paths: [], allPaths: [], timestamp: 0 };
const DXPATHS_CACHE_TTL = 25000; // 25 seconds cache (just under 30s poll interval to maximize cache hits)
const DXPATHS_RETENTION = 30 * 60 * 1000; // 30 minute spot retention

app.get('/api/dxcluster/paths', async (req, res) => {
  // Parse query parameters for custom cluster settings
  const source = req.query.source || 'auto';
  const customHost = req.query.host;
  const customPort = parseInt(req.query.port) || 7300;
  const userCallsign = req.query.callsign;
  
  // SECURITY: Validate custom host to prevent SSRF (internal network scanning)
  if (source === 'custom' && customHost) {
    // Block private/reserved IP ranges and localhost
    const blockedPatterns = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|0:|\[::1\]|::1|fe80:|fc00:|fd00:|ff00:)/i;
    if (blockedPatterns.test(customHost)) {
      return res.status(400).json({ error: 'Custom host cannot be a private/reserved address' });
    }
    // Block numeric-only hosts (raw IPs) that could be encoded to bypass above
    // Only allow hostnames that look like legitimate DX Spider nodes
    if (/^\d+\.\d+\.\d+\.\d+$/.test(customHost)) {
      const octets = customHost.split('.').map(Number);
      if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168) ||
          (octets[0] === 169 && octets[1] === 254)) {
        return res.status(400).json({ error: 'Custom host cannot be a private/reserved address' });
      }
    }
    // Restrict port range to common DX Spider/telnet ports
    if (customPort < 1024 || customPort > 49151) {
      return res.status(400).json({ error: 'Port must be between 1024 and 49151' });
    }
  }
  
  // Generate cache key based on source (custom sources shouldn't share cache)
  const cacheKey = source === 'custom' ? `custom-${customHost}-${customPort}` : 'default';
  
  // Check cache first (but not for custom sources - they might have different data)
  if (source !== 'custom' && Date.now() - dxSpotPathsCache.timestamp < DXPATHS_CACHE_TTL && dxSpotPathsCache.paths.length > 0) {
    logDebug('[DX Paths] Returning', dxSpotPathsCache.paths.length, 'cached paths');
    return res.json(dxSpotPathsCache.paths);
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const now = Date.now();
    
    // Try proxy first for better real-time data
    let newSpots = [];
    let usedSource = 'none';
    
    // Handle custom telnet source
    if (source === 'custom' && customHost) {
      logDebug(`[DX Paths] Trying custom telnet: ${customHost}:${customPort} as ${userCallsign || 'GUEST'}`);
      const customNode = { host: customHost, port: customPort };
      const customSpots = await tryDXSpiderNode(customNode, userCallsign);
      
      if (customSpots && customSpots.length > 0) {
        usedSource = 'custom';
        newSpots = customSpots.map(s => ({
          spotter: s.spotter,
          spotterGrid: null,
          dxCall: s.call,
          dxGrid: null,
          freq: s.freq,
          comment: s.comment || '',
          time: s.time || '',
          id: `${s.call}-${s.freq}-${s.spotter}`
        }));
        logDebug('[DX Paths] Got', newSpots.length, 'spots from custom telnet');
      }
    }
    
    // Try proxy if not using custom or custom failed
    if (newSpots.length === 0 && source !== 'custom') {
      try {
        const proxyResponse = await fetch(`${DXSPIDER_PROXY_URL}/api/spots?limit=100`, {
          headers: { 'User-Agent': 'OpenHamClock/3.14.11' },
          signal: controller.signal
        });
        
        if (proxyResponse.ok) {
          const proxyData = await proxyResponse.json();
          if (proxyData.spots && proxyData.spots.length > 0) {
            usedSource = 'proxy';
            newSpots = proxyData.spots.map(s => ({
              spotter: s.spotter,
              spotterGrid: s.spotterGrid || null,
              dxCall: s.call,
              dxGrid: s.dxGrid || null,
              freq: s.freq,
              comment: s.comment || '',
              time: s.time || '',
              id: `${s.call}-${s.freqKhz || s.freq}-${s.spotter}`
            }));
            logDebug('[DX Paths] Got', newSpots.length, 'spots from proxy');
          }
        }
      } catch (proxyErr) {
        logDebug('[DX Paths] Proxy failed, trying HamQTH');
      }
    }
    
    // Fallback to HamQTH if proxy failed
    if (newSpots.length === 0) {
      try {
        const response = await fetch('https://www.hamqth.com/dxc_csv.php?limit=50', {
          headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
          signal: controller.signal
        });
        
        if (response.ok) {
          const text = await response.text();
          const lines = text.trim().split('\n').filter(line => line.includes('^'));
          usedSource = 'hamqth';
          
          for (const line of lines) {
            const parts = line.split('^');
            if (parts.length < 5) continue;
            
            const spotter = parts[0]?.trim().toUpperCase();
            const freqKhz = parseFloat(parts[1]) || 0;
            const dxCall = parts[2]?.trim().toUpperCase();
            const comment = parts[3]?.trim() || '';
            const timeDate = parts[4]?.trim() || '';
            
            if (!spotter || !dxCall || freqKhz <= 0) continue;
            
            // Extract grids from comment for HamQTH data too
            const grids = extractGridsFromComment(comment);
            
            newSpots.push({
              spotter,
              spotterGrid: grids.spotterGrid,
              dxCall,
              dxGrid: grids.dxGrid,
              freq: (freqKhz / 1000).toFixed(3),
              comment,
              time: timeDate.length >= 4 ? timeDate.substring(0, 2) + ':' + timeDate.substring(2, 4) + 'z' : '',
              id: `${dxCall}-${freqKhz}-${spotter}`
            });
          }
          logDebug('[DX Paths] Got', newSpots.length, 'spots from HamQTH');
        }
      } catch (hamqthErr) {
        logDebug('[DX Paths] HamQTH also failed');
      }
    }
    
    clearTimeout(timeout);
    
    if (newSpots.length === 0) {
      // Return existing paths if fetch failed
      const validPaths = dxSpotPathsCache.allPaths.filter(p => (now - p.timestamp) < DXPATHS_RETENTION);
      return res.json(validPaths.slice(0, 50));
    }
    
    // Get unique callsigns to look up
    const allCalls = new Set();
    newSpots.forEach(s => {
      allCalls.add(s.spotter);
      allCalls.add(s.dxCall);
    });
    
    // Look up prefix-based locations for all callsigns (includes grid squares!)
    const prefixLocations = {};
    const callsToLookup = [...allCalls].slice(0, 100);
    
    for (const call of callsToLookup) {
      const loc = estimateLocationFromPrefix(call);
      if (loc) {
        prefixLocations[call] = { 
          lat: loc.lat, 
          lon: loc.lon, 
          country: loc.country, 
          grid: loc.grid || null,  // Include grid from prefix mapping!
          source: loc.grid ? 'prefix-grid' : 'prefix' 
        };
      }
    }
    
    // Check HamQTH callsign cache for better accuracy (24h TTL, populated by /api/callsign/:call)
    // This gives DXCC-level lat/lon which is more accurate than prefix country centroids
    const hamqthLocations = {};
    const hamqthMisses = []; // Callsigns to look up in background
    for (const call of callsToLookup) {
      const cached = callsignLookupCache.get(call);
      if (cached && (now - cached.timestamp) < CALLSIGN_CACHE_TTL && cached.data?.lat != null) {
        hamqthLocations[call] = {
          lat: cached.data.lat,
          lon: cached.data.lon,
          country: cached.data.country || '',
          grid: cached.data.grid || null,
          source: 'hamqth'
        };
      } else if (!prefixLocations[call]?.grid) {
        // Only queue lookups for calls that don't already have grid-level accuracy
        hamqthMisses.push(call);
      }
    }
    
    // Fire background HamQTH lookups for cache misses (non-blocking, improves next poll)
    // Limit to 10 per cycle to avoid hammering HamQTH
    if (hamqthMisses.length > 0) {
      const batch = hamqthMisses.slice(0, 10);
      logDebug('[DX Paths] Background HamQTH lookup for', batch.length, 'callsigns');
      for (const call of batch) {
        // Fire-and-forget — results land in callsignLookupCache for next poll
        fetch(`https://www.hamqth.com/dxcc.php?callsign=${encodeURIComponent(call)}`, {
          headers: { 'User-Agent': 'OpenHamClock/' + APP_VERSION },
          signal: AbortSignal.timeout(5000)
        }).then(async (resp) => {
          if (!resp.ok) return;
          const text = await resp.text();
          const latMatch = text.match(/<lat>([^<]+)<\/lat>/);
          const lonMatch = text.match(/<lng>([^<]+)<\/lng>/);
          const countryMatch = text.match(/<n>([^<]+)<\/name>/);
          if (latMatch && lonMatch) {
            callsignLookupCache.set(call, {
              data: {
                callsign: call,
                lat: parseFloat(latMatch[1]),
                lon: parseFloat(lonMatch[1]),
                country: countryMatch ? countryMatch[1] : ''
              },
              timestamp: Date.now()
            });
          }
        }).catch(() => {}); // Silent fail for background lookups
      }
    }
    
    // Build new paths with locations - try grid first, fall back to prefix
    const newPaths = newSpots
      .map(spot => {
        // DX station location - try grid from spot data first, then comment, then prefix
        let dxLoc = null;
        let dxGridSquare = null;
        
        // Check if spot already has dxGrid from proxy
        if (spot.dxGrid) {
          const gridLoc = maidenheadToLatLon(spot.dxGrid);
          if (gridLoc) {
            dxLoc = { lat: gridLoc.lat, lon: gridLoc.lon, country: '', source: 'grid' };
            dxGridSquare = spot.dxGrid;
          }
        }
        
        // If no grid yet, try extracting from comment
        if (!dxLoc && spot.comment) {
          const extractedGrids = extractGridsFromComment(spot.comment);
          if (extractedGrids.dxGrid) {
            const gridLoc = maidenheadToLatLon(extractedGrids.dxGrid);
            if (gridLoc) {
              dxLoc = { lat: gridLoc.lat, lon: gridLoc.lon, country: '', source: 'grid' };
              dxGridSquare = extractedGrids.dxGrid;
            }
          }
        }
        
        // Fall back to HamQTH cached location (more accurate than prefix)
        if (!dxLoc && hamqthLocations[spot.dxCall]) {
          dxLoc = hamqthLocations[spot.dxCall];
        }
        
        // Fall back to prefix location (now includes grid-based coordinates!)
        if (!dxLoc) {
          dxLoc = prefixLocations[spot.dxCall];
          if (dxLoc && dxLoc.grid) {
            dxGridSquare = dxLoc.grid;
          }
        }
        
        // Spotter location - try grid first, then prefix
        let spotterLoc = null;
        let spotterGridSquare = null;
        
        // Check if spot already has spotterGrid from proxy
        if (spot.spotterGrid) {
          const gridLoc = maidenheadToLatLon(spot.spotterGrid);
          if (gridLoc) {
            spotterLoc = { lat: gridLoc.lat, lon: gridLoc.lon, country: '', source: 'grid' };
            spotterGridSquare = spot.spotterGrid;
          }
        }
        
        // If no grid yet, try extracting from comment (in case of dual grid format)
        if (!spotterLoc && spot.comment) {
          const extractedGrids = extractGridsFromComment(spot.comment);
          if (extractedGrids.spotterGrid) {
            const gridLoc = maidenheadToLatLon(extractedGrids.spotterGrid);
            if (gridLoc) {
              spotterLoc = { lat: gridLoc.lat, lon: gridLoc.lon, country: '', source: 'grid' };
              spotterGridSquare = extractedGrids.spotterGrid;
            }
          }
        }
        
        // Fall back to HamQTH cached location for spotter
        if (!spotterLoc && hamqthLocations[spot.spotter]) {
          spotterLoc = hamqthLocations[spot.spotter];
        }
        
        // Fall back to prefix location for spotter (now includes grid-based coordinates!)
        if (!spotterLoc) {
          spotterLoc = prefixLocations[spot.spotter];
          if (spotterLoc && spotterLoc.grid) {
            spotterGridSquare = spotterLoc.grid;
          }
        }
        
        if (spotterLoc && dxLoc) {
          return {
            spotter: spot.spotter,
            spotterLat: spotterLoc.lat,
            spotterLon: spotterLoc.lon,
            spotterCountry: spotterLoc.country || '',
            spotterGrid: spotterGridSquare,
            spotterLocSource: spotterLoc.source,
            dxCall: spot.dxCall,
            dxLat: dxLoc.lat,
            dxLon: dxLoc.lon,
            dxCountry: dxLoc.country || '',
            dxGrid: dxGridSquare,
            dxLocSource: dxLoc.source,
            freq: spot.freq,
            comment: spot.comment,
            time: spot.time,
            id: spot.id,
            timestamp: now
          };
        }
        return null;
      })
      .filter(p => p !== null);
    
    // Merge with existing paths, removing expired and duplicates
    const existingValidPaths = dxSpotPathsCache.allPaths.filter(p => 
      (now - p.timestamp) < DXPATHS_RETENTION
    );
    
    // Add new paths, avoiding duplicates (same dxCall+freq within 2 minutes)
    const mergedPaths = [...existingValidPaths];
    for (const newPath of newPaths) {
      const isDuplicate = mergedPaths.some(existing => 
        existing.dxCall === newPath.dxCall && 
        existing.freq === newPath.freq &&
        (now - existing.timestamp) < 120000 // 2 minute dedup window
      );
      if (!isDuplicate) {
        mergedPaths.push(newPath);
      }
    }
    
    // Sort by timestamp (newest first) and limit
    const sortedPaths = mergedPaths.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
    
    logDebug('[DX Paths]', sortedPaths.length, 'total paths (', newPaths.length, 'new from', newSpots.length, 'spots)');
    
    // Update cache
    dxSpotPathsCache = { 
      paths: sortedPaths.slice(0, 50), // Return 50 for display
      allPaths: sortedPaths, // Keep all for accumulation
      timestamp: now 
    };
    
    res.json(dxSpotPathsCache.paths);
  } catch (error) {
    logErrorOnce('DX Paths', error.message);
    // Return cached data on error
    res.json(dxSpotPathsCache.paths || []);
  }
});

// ============================================
// CALLSIGN LOOKUP API (for getting location from callsign)
// ============================================

// Cache for callsign lookups - callsigns don't change location often
const callsignLookupCache = new Map(); // key = callsign, value = { data, timestamp }
const CALLSIGN_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Simple callsign to grid/location lookup using HamQTH
app.get('/api/callsign/:call', async (req, res) => {
  const callsign = req.params.call.toUpperCase();
  const now = Date.now();
  
  // Check cache first
  const cached = callsignLookupCache.get(callsign);
  if (cached && (now - cached.timestamp) < CALLSIGN_CACHE_TTL) {
    logDebug('[Callsign Lookup] Cache hit for:', callsign);
    return res.json(cached.data);
  }
  
  logDebug('[Callsign Lookup] Looking up:', callsign);
  
  try {
    // Try HamQTH XML API (no auth needed for basic lookup)
    // SECURITY: Validate callsign format and encode for URL
    if (!/^[A-Z0-9\/\-]{1,20}$/.test(callsign)) {
      return res.status(400).json({ error: 'Invalid callsign format' });
    }
    const response = await fetch(`https://www.hamqth.com/dxcc.php?callsign=${encodeURIComponent(callsign)}`);
    if (response.ok) {
      const text = await response.text();
      
      // Parse basic info from response
      const latMatch = text.match(/<lat>([^<]+)<\/lat>/);
      const lonMatch = text.match(/<lng>([^<]+)<\/lng>/);
      const countryMatch = text.match(/<name>([^<]+)<\/name>/);
      const cqMatch = text.match(/<cq>([^<]+)<\/cq>/);
      const ituMatch = text.match(/<itu>([^<]+)<\/itu>/);
      
      if (latMatch && lonMatch) {
        const result = {
          callsign,
          lat: parseFloat(latMatch[1]),
          lon: parseFloat(lonMatch[1]),
          country: countryMatch ? countryMatch[1] : 'Unknown',
          cqZone: cqMatch ? cqMatch[1] : '',
          ituZone: ituMatch ? ituMatch[1] : ''
        };
        logDebug('[Callsign Lookup] Found:', result);
        // Cache the result
        callsignLookupCache.set(callsign, { data: result, timestamp: now });
        return res.json(result);
      }
    }
    
    // Fallback: estimate location from callsign prefix
    const estimated = estimateLocationFromPrefix(callsign);
    if (estimated) {
      logDebug('[Callsign Lookup] Estimated from prefix:', estimated);
      // Cache estimated results too
      callsignLookupCache.set(callsign, { data: estimated, timestamp: now });
      return res.json(estimated);
    }
    
    res.status(404).json({ error: 'Callsign not found' });
  } catch (error) {
    logErrorOnce('Callsign Lookup', error.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// Convert Maidenhead grid locator to lat/lon (center of grid square)
function maidenheadToLatLon(grid) {
  if (!grid || typeof grid !== 'string') return null;
  
  grid = grid.toUpperCase().trim();
  
  // Validate grid format (2, 4, 6, or 8 characters)
  if (!/^[A-R]{2}([0-9]{2}([A-X]{2}([0-9]{2})?)?)?$/.test(grid)) return null;
  
  let lon = -180;
  let lat = -90;
  
  // Field (2 chars): 20° lon x 10° lat
  lon += (grid.charCodeAt(0) - 65) * 20;
  lat += (grid.charCodeAt(1) - 65) * 10;
  
  if (grid.length >= 4) {
    // Square (2 digits): 2° lon x 1° lat
    lon += parseInt(grid[2]) * 2;
    lat += parseInt(grid[3]) * 1;
  }
  
  if (grid.length >= 6) {
    // Subsquare (2 chars): 5' lon x 2.5' lat
    lon += (grid.charCodeAt(4) - 65) * (5 / 60);
    lat += (grid.charCodeAt(5) - 65) * (2.5 / 60);
  }
  
  if (grid.length >= 8) {
    // Extended square (2 digits): 0.5' lon x 0.25' lat
    lon += parseInt(grid[6]) * (0.5 / 60);
    lat += parseInt(grid[7]) * (0.25 / 60);
  }
  
  // Add offset to center of the grid square
  if (grid.length === 2) {
    lon += 10; lat += 5;
  } else if (grid.length === 4) {
    lon += 1; lat += 0.5;
  } else if (grid.length === 6) {
    lon += 2.5 / 60; lat += 1.25 / 60;
  } else if (grid.length === 8) {
    lon += 0.25 / 60; lat += 0.125 / 60;
  }
  
  return { lat, lon, grid };
}

// Try to extract grid locators from a comment string
// Returns { spotterGrid, dxGrid } - may have one, both, or neither
function extractGridsFromComment(comment) {
  if (!comment || typeof comment !== 'string') return { spotterGrid: null, dxGrid: null };
  
  // Check for dual grid format: FN20<>EM79 or FN20->EM79 or FN20/EM79
  const dualGridMatch = comment.match(/\b([A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2})?)\s*(?:<>|->|\/|<)\s*([A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2})?)\b/);
  if (dualGridMatch) {
    const grid1 = dualGridMatch[1].toUpperCase();
    const grid2 = dualGridMatch[2].toUpperCase();
    // Validate both are real grids
    if (isValidGrid(grid1) && isValidGrid(grid2)) {
      return { spotterGrid: grid1, dxGrid: grid2 };
    }
  }
  
  // Look for all grids in the comment
  const gridPattern = /\b([A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2})?)\b/g;
  const grids = [];
  let match;
  while ((match = gridPattern.exec(comment)) !== null) {
    const grid = match[1].toUpperCase();
    if (isValidGrid(grid)) {
      grids.push(grid);
    }
  }
  
  // If we found two grids, assume first is spotter, second is DX
  if (grids.length >= 2) {
    return { spotterGrid: grids[0], dxGrid: grids[1] };
  }
  
  // If we found one grid, assume it's the DX station
  if (grids.length === 1) {
    return { spotterGrid: null, dxGrid: grids[0] };
  }
  
  return { spotterGrid: null, dxGrid: null };
}

// Validate a grid square is realistic (not "CQ00", "DE12", etc)
function isValidGrid(grid) {
  if (!grid || grid.length < 4) return false;
  const firstChar = grid.charCodeAt(0);
  const secondChar = grid.charCodeAt(1);
  // First char should be A-R, second char should be A-R
  return firstChar >= 65 && firstChar <= 82 && secondChar >= 65 && secondChar <= 82;
}

// Legacy single-grid extraction (kept for compatibility)
function extractGridFromComment(comment) {
  const grids = extractGridsFromComment(comment);
  return grids.dxGrid;
}

// Estimate location from callsign prefix using grid squares
// This gives much better precision than country centers
function estimateLocationFromPrefix(callsign) {
  if (!callsign) return null;
  
  // Comprehensive prefix to grid mapping
  // Uses typical/central grid for each prefix area
  // Comprehensive prefix to grid mapping
  // Based on ITU allocations and DXCC entity list (~340 entities)
  // Grid squares are approximate center of each entity
  const prefixGrids = {
    // ============================================
    // USA - by call district
    // ============================================
    'W1': 'FN41', 'K1': 'FN41', 'N1': 'FN41', 'AA1': 'FN41',
    'W2': 'FN20', 'K2': 'FN20', 'N2': 'FN20', 'AA2': 'FN20',
    'W3': 'FM19', 'K3': 'FM19', 'N3': 'FM19', 'AA3': 'FM19',
    'W4': 'EM73', 'K4': 'EM73', 'N4': 'EM73', 'AA4': 'EM73',
    'W5': 'EM12', 'K5': 'EM12', 'N5': 'EM12', 'AA5': 'EM12',
    'W6': 'CM97', 'K6': 'CM97', 'N6': 'CM97', 'AA6': 'CM97',
    'W7': 'DN31', 'K7': 'DN31', 'N7': 'DN31', 'AA7': 'DN31',
    'W8': 'EN81', 'K8': 'EN81', 'N8': 'EN81', 'AA8': 'EN81',
    'W9': 'EN52', 'K9': 'EN52', 'N9': 'EN52', 'AA9': 'EN52',
    'W0': 'EN31', 'K0': 'EN31', 'N0': 'EN31', 'AA0': 'EN31',
    'W': 'EM79', 'K': 'EM79', 'N': 'EM79',
    
    // ============================================
    // US Territories
    // ============================================
    'KP4': 'FK68', 'NP4': 'FK68', 'WP4': 'FK68', 'KP3': 'FK68', 'NP3': 'FK68', 'WP3': 'FK68',
    'KP2': 'FK77', 'NP2': 'FK77', 'WP2': 'FK77',
    'KP1': 'FK28', 'NP1': 'FK28', 'WP1': 'FK28',
    'KP5': 'FK68',
    'KH0': 'QK25', 'NH0': 'QK25', 'WH0': 'QK25',
    'KH1': 'BL01',
    'KH2': 'QK24', 'NH2': 'QK24', 'WH2': 'QK24',
    'KH3': 'BK29',
    'KH4': 'AL07',
    'KH5': 'BK29', 'KH5K': 'BL01',
    'KH6': 'BL10', 'NH6': 'BL10', 'WH6': 'BL10', 'KH7': 'BL10', 'NH7': 'BL10', 'WH7': 'BL10',
    'KH8': 'AH38', 'NH8': 'AH38', 'WH8': 'AH38',
    'KH9': 'AK19',
    'KL7': 'BP51', 'NL7': 'BP51', 'WL7': 'BP51', 'AL7': 'BP51',
    'KG4': 'FK29',

    // ============================================
    // Canada
    // ============================================
    'VE1': 'FN74', 'VA1': 'FN74',
    'VE2': 'FN35', 'VA2': 'FN35',
    'VE3': 'FN03', 'VA3': 'FN03',
    'VE4': 'EN19', 'VA4': 'EN19',
    'VE5': 'DO51', 'VA5': 'DO51',
    'VE6': 'DO33', 'VA6': 'DO33',
    'VE7': 'CN89', 'VA7': 'CN89',
    'VE8': 'DP31',
    'VE9': 'FN65', 'VA9': 'FN65',
    'VO1': 'GN37',
    'VO2': 'GO17',
    'VY0': 'EQ79',
    'VY1': 'CP28',
    'VY2': 'FN86',
    'CY0': 'GN76',
    'CY9': 'FN97',
    'VE': 'FN03', 'VA': 'FN03',

    // ============================================
    // Mexico & Central America
    // ============================================
    'XE': 'EK09', 'XE1': 'EK09', 'XE2': 'DL84', 'XE3': 'EK57',
    'XA': 'EK09', 'XB': 'EK09', 'XC': 'EK09', 'XD': 'EK09',
    'XF': 'DK48', '4A': 'EK09', '4B': 'EK09', '4C': 'EK09',
    '6D': 'EK09', '6E': 'EK09', '6F': 'EK09', '6G': 'EK09', '6H': 'EK09', '6I': 'EK09', '6J': 'EK09',
    'TI': 'EJ79', 'TE': 'EJ79',
    'TG': 'EK44', 'TD': 'EK44',
    'HR': 'EK55', 'HQ': 'EK55',
    'YN': 'EK62', 'HT': 'EK62', 'H6': 'EK62', 'H7': 'EK62',
    'HP': 'FJ08', 'HO': 'FJ08', 'H3': 'FJ08', 'H8': 'FJ08', 'H9': 'FJ08', '3E': 'FJ08', '3F': 'FJ08',
    'YS': 'EK53', 'HU': 'EK53',
    'V3': 'EK56',

    // ============================================
    // Caribbean
    // ============================================
    'HI': 'FK49',
    'CO': 'FL10', 'CM': 'FL10', 'CL': 'FL10', 'T4': 'FL10',
    '6Y': 'FK17',
    'VP5': 'FL31',
    'C6': 'FL06',
    'ZF': 'EK99',
    'V2': 'FK97',
    'J3': 'FK92',
    'J6': 'FK93',
    'J7': 'FK95',
    'J8': 'FK93',
    '8P': 'GK03',
    '9Y': 'FK90',
    'PJ2': 'FK52', 'PJ4': 'FK52',
    'PJ5': 'FK87', 'PJ6': 'FK87', 'PJ7': 'FK88',
    'P4': 'FK52',
    'VP2E': 'FK88',
    'VP2M': 'FK96',
    'VP2V': 'FK77',
    'V4': 'FK87',
    'FG': 'FK96',
    'FM': 'FK94', 'TO': 'FK94',
    'FS': 'FK88',
    'FJ': 'GK08',
    'HH': 'FK38',

    // ============================================
    // South America
    // ============================================
    'LU': 'GF05', 'LW': 'GF05', 'LO': 'GF05', 'LR': 'GF05', 'LT': 'GF05', 'AY': 'GF05', 'AZ': 'GF05',
    'L1': 'GF05', 'L2': 'GF05', 'L3': 'GF05', 'L4': 'GF05', 'L5': 'GF05', 'L6': 'GF05', 'L7': 'GF05', 'L8': 'GF05', 'L9': 'GF05',
    'PY': 'GG87', 'PP': 'GG87', 'PQ': 'GG87', 'PR': 'GG87', 'PS': 'GG87', 'PT': 'GG87', 'PU': 'GG87', 'PV': 'GG87', 'PW': 'GG87', 'PX': 'GG87',
    'ZV': 'GG87', 'ZW': 'GG87', 'ZX': 'GG87', 'ZY': 'GG87', 'ZZ': 'GG87',
    'CE': 'FF46', 'CA': 'FF46', 'CB': 'FF46', 'CC': 'FF46', 'CD': 'FF46', 'XQ': 'FF46', 'XR': 'FF46', '3G': 'FF46',
    'CE0Y': 'DG52',
    'CE0Z': 'FE49',
    'CE0X': 'FG14',
    'CX': 'GF15', 'CV': 'GF15',
    'HC': 'FI09', 'HD': 'FI09',
    'HC8': 'EI49',
    'OA': 'FH17', 'OB': 'FH17', 'OC': 'FH17', '4T': 'FH17',
    'HK': 'FJ35', 'HJ': 'FJ35', '5J': 'FJ35', '5K': 'FJ35',
    'HK0': 'FJ55', 'HK0M': 'EJ96',
    'YV': 'FK60', 'YW': 'FK60', 'YX': 'FK60', 'YY': 'FK60', '4M': 'FK60',
    'YV0': 'FK53',
    'CP': 'FH64',
    '8R': 'GJ24',
    'PZ': 'GJ25',
    'FY': 'GJ34',
    'VP8': 'GD18', 'VP8F': 'GD18',
    'VP8G': 'IC16',
    'VP8H': 'GC17',
    'VP8O': 'GC06',
    'VP8S': 'GC06',

    // ============================================
    // Europe - UK & Ireland
    // ============================================
    'G': 'IO91', 'M': 'IO91', '2E': 'IO91',
    'GW': 'IO81', 'MW': 'IO81', '2W': 'IO81',
    'GM': 'IO85', 'MM': 'IO85', '2M': 'IO85',
    'GI': 'IO64', 'MI': 'IO64', '2I': 'IO64',
    'GD': 'IO74', 'MD': 'IO74', '2D': 'IO74',
    'GJ': 'IN89', 'MJ': 'IN89', '2J': 'IN89',
    'GU': 'IN89', 'MU': 'IN89', '2U': 'IN89',
    'EI': 'IO63', 'EJ': 'IO63',

    // ============================================
    // Europe - Germany
    // ============================================
    'DL': 'JO51', 'DJ': 'JO51', 'DK': 'JO51', 'DA': 'JO51', 'DB': 'JO51', 'DC': 'JO51', 'DD': 'JO51',
    'DF': 'JO51', 'DG': 'JO51', 'DH': 'JO51', 'DM': 'JO51', 'DO': 'JO51', 'DP': 'JO51', 'DQ': 'JO51', 'DR': 'JO51',

    // ============================================
    // Europe - France & territories
    // ============================================
    'F': 'JN18', 'TM': 'JN18',

    // ============================================
    // Europe - Italy
    // ============================================
    'I': 'JN61', 'IK': 'JN45', 'IZ': 'JN61', 'IW': 'JN61', 'IU': 'JN61',

    // ============================================
    // Europe - Spain & Portugal
    // ============================================
    'EA': 'IN80', 'EC': 'IN80', 'EB': 'IN80', 'ED': 'IN80', 'EE': 'IN80', 'EF': 'IN80', 'EG': 'IN80', 'EH': 'IN80',
    'EA6': 'JM19', 'EC6': 'JM19',
    'EA8': 'IL18', 'EC8': 'IL18',
    'EA9': 'IM75', 'EC9': 'IM75',
    'CT': 'IM58', 'CQ': 'IM58', 'CS': 'IM58',
    'CT3': 'IM12', 'CQ3': 'IM12',
    'CU': 'HM68',

    // ============================================
    // Europe - Benelux
    // ============================================
    'PA': 'JO21', 'PD': 'JO21', 'PE': 'JO21', 'PF': 'JO21', 'PG': 'JO21', 'PH': 'JO21', 'PI': 'JO21',
    'ON': 'JO20', 'OO': 'JO20', 'OP': 'JO20', 'OQ': 'JO20', 'OR': 'JO20', 'OS': 'JO20', 'OT': 'JO20',
    'LX': 'JN39',

    // ============================================
    // Europe - Alpine
    // ============================================
    'HB': 'JN47', 'HB9': 'JN47', 'HE': 'JN47',
    'HB0': 'JN47',
    'OE': 'JN78',

    // ============================================
    // Europe - Scandinavia
    // ============================================
    'OZ': 'JO55', 'OU': 'JO55', 'OV': 'JO55', '5P': 'JO55', '5Q': 'JO55',
    'OX': 'GP47', 'XP': 'GP47',
    'SM': 'JO89', 'SA': 'JO89', 'SB': 'JO89', 'SC': 'JO89', 'SD': 'JO89', 'SE': 'JO89', 'SF': 'JO89', 'SG': 'JO89', 'SH': 'JO89', 'SI': 'JO89', 'SJ': 'JO89', 'SK': 'JO89', 'SL': 'JO89', '7S': 'JO89', '8S': 'JO89',
    'LA': 'JO59', 'LB': 'JO59', 'LC': 'JO59', 'LD': 'JO59', 'LE': 'JO59', 'LF': 'JO59', 'LG': 'JO59', 'LH': 'JO59', 'LI': 'JO59', 'LJ': 'JO59', 'LK': 'JO59', 'LL': 'JO59', 'LM': 'JO59', 'LN': 'JO59',
    'JW': 'JQ68',
    'JX': 'IQ50',
    'OH': 'KP20', 'OF': 'KP20', 'OG': 'KP20', 'OI': 'KP20',
    'OH0': 'JP90',
    'OJ0': 'KP03',
    'TF': 'HP94',

    // ============================================
    // Europe - Eastern
    // ============================================
    'SP': 'JO91', 'SQ': 'JO91', 'SO': 'JO91', 'SN': 'JO91', '3Z': 'JO91', 'HF': 'JO91',
    'OK': 'JN79', 'OL': 'JN79',
    'OM': 'JN88',
    'HA': 'JN97', 'HG': 'JN97',
    'YO': 'KN34', 'YP': 'KN34', 'YQ': 'KN34', 'YR': 'KN34',
    'LZ': 'KN22',
    'SV': 'KM17', 'SX': 'KM17', 'SY': 'KM17', 'SZ': 'KM17', 'J4': 'KM17',
    'SV5': 'KM46',
    'SV9': 'KM25',
    'SV/A': 'KN10',
    '9H': 'JM75',
    'YU': 'KN04', 'YT': 'KN04', 'YZ': 'KN04',
    '9A': 'JN75',
    'S5': 'JN76',
    'E7': 'JN84',
    'Z3': 'KN01',
    '4O': 'JN92',
    'ZA': 'JN91',
    'T7': 'JN63',
    'HV': 'JN61',
    '1A': 'JM64',

    // ============================================
    // Europe - Baltic
    // ============================================
    'LY': 'KO24',
    'ES': 'KO29',
    'YL': 'KO26',

    // ============================================
    // Russia & Ukraine & Belarus
    // ============================================
    'UA': 'KO85', 'RA': 'KO85', 'RU': 'KO85', 'RV': 'KO85', 'RW': 'KO85', 'RX': 'KO85', 'RZ': 'KO85',
    'R1': 'KO85', 'R2': 'KO85', 'R3': 'KO85', 'R4': 'KO85', 'R5': 'KO85', 'R6': 'KO85',
    'U1': 'KO85', 'U2': 'KO85', 'U3': 'KO85', 'U4': 'KO85', 'U5': 'KO85', 'U6': 'KO85',
    'UA9': 'MO06', 'RA9': 'MO06', 'R9': 'MO06', 'U9': 'MO06',
    'UA0': 'OO33', 'RA0': 'OO33', 'R0': 'OO33', 'U0': 'OO33',
    'UA2': 'KO04', 'RA2': 'KO04', 'R2F': 'KO04',
    'UR': 'KO50', 'UT': 'KO50', 'UX': 'KO50', 'US': 'KO50', 'UY': 'KO50', 'UW': 'KO50', 'UV': 'KO50', 'UU': 'KO50',
    'EU': 'KO33', 'EV': 'KO33', 'EW': 'KO33',
    'ER': 'KN47',
    'C3': 'JN02',

    // ============================================
    // Asia - Japan
    // ============================================
    'JA': 'PM95', 'JH': 'PM95', 'JR': 'PM95', 'JE': 'PM95', 'JF': 'PM95', 'JG': 'PM95', 'JI': 'PM95', 'JJ': 'PM95', 'JK': 'PM95', 'JL': 'PM95', 'JM': 'PM95', 'JN': 'PM95', 'JO': 'PM95', 'JP': 'PM95', 'JQ': 'PM95', 'JS': 'PM95',
    '7J': 'PM95', '7K': 'PM95', '7L': 'PM95', '7M': 'PM95', '7N': 'PM95', '8J': 'PM95', '8K': 'PM95', '8L': 'PM95', '8M': 'PM95', '8N': 'PM95',
    'JA1': 'PM95', 'JA2': 'PM84', 'JA3': 'PM74', 'JA4': 'PM64', 'JA5': 'PM63', 'JA6': 'PM53', 'JA7': 'QM07', 'JA8': 'QN02', 'JA9': 'PM86', 'JA0': 'PM97',
    'JD1': 'QL07',

    // ============================================
    // Asia - China & Taiwan & Hong Kong
    // ============================================
    'BY': 'OM92', 'BT': 'OM92', 'BA': 'OM92', 'BD': 'OM92', 'BG': 'OM92', 'BH': 'OM92', 'BI': 'OM92', 'BJ': 'OM92', 'BL': 'OM92', 'BM': 'OM92', 'BO': 'OM92', 'BP': 'OM92', 'BQ': 'OM92', 'BR': 'OM92', 'BS': 'OM92', 'BU': 'OM92',
    'BV': 'PL04', 'BW': 'PL04', 'BX': 'PL04', 'BN': 'PL04',
    'XX9': 'OL62', 'VR': 'OL62',

    // ============================================
    // Asia - Korea
    // ============================================
    'HL': 'PM37', 'DS': 'PM37', '6K': 'PM37', '6L': 'PM37', '6M': 'PM37', '6N': 'PM37', 'D7': 'PM37', 'D8': 'PM37', 'D9': 'PM37',
    'P5': 'PM38',

    // ============================================
    // Asia - Southeast
    // ============================================
    'HS': 'OK03', 'E2': 'OK03',
    'XV': 'OK30', '3W': 'OK30',
    'XU': 'OK10',
    'XW': 'NK97',
    'XZ': 'NL99', '1Z': 'NL99',
    '9V': 'OJ11',
    '9M': 'OJ05', '9W': 'OJ05',
    '9M6': 'OJ69', '9M8': 'OJ69', '9W6': 'OJ69', '9W8': 'OJ69',
    'DU': 'PK04', 'DV': 'PK04', 'DW': 'PK04', 'DX': 'PK04', 'DY': 'PK04', 'DZ': 'PK04',
    '4D': 'PK04', '4E': 'PK04', '4F': 'PK04', '4G': 'PK04', '4H': 'PK04', '4I': 'PK04',
    'YB': 'OI33', 'YC': 'OI33', 'YD': 'OI33', 'YE': 'OI33', 'YF': 'OI33', 'YG': 'OI33', 'YH': 'OI33',
    '7A': 'OI33', '7B': 'OI33', '7C': 'OI33', '7D': 'OI33', '7E': 'OI33', '7F': 'OI33', '7G': 'OI33', '7H': 'OI33', '7I': 'OI33',
    '8A': 'OI33', '8B': 'OI33', '8C': 'OI33', '8D': 'OI33', '8E': 'OI33', '8F': 'OI33', '8G': 'OI33', '8H': 'OI33', '8I': 'OI33',
    'V8': 'OJ84',

    // ============================================
    // Asia - South
    // ============================================
    'VU': 'MK82', 'VU2': 'MK82', 'VU3': 'MK82', 'VU4': 'MJ97', 'VU7': 'MJ58',
    '8T': 'MK82', '8U': 'MK82', '8V': 'MK82', '8W': 'MK82', '8X': 'MK82', '8Y': 'MK82',
    'AP': 'MM44',
    '4S': 'MJ96',
    'S2': 'NL93',
    '9N': 'NL27',
    'A5': 'NL49',
    '8Q': 'MJ63',

    // ============================================
    // Asia - Middle East
    // ============================================
    'A4': 'LL93', 'A41': 'LL93', 'A43': 'LL93', 'A45': 'LL93', 'A47': 'LL93',
    'A6': 'LL65', 'A61': 'LL65', 'A62': 'LL65', 'A63': 'LL65', 'A65': 'LL65',
    'A7': 'LL45', 'A71': 'LL45', 'A72': 'LL45', 'A73': 'LL45', 'A75': 'LL45',
    'A9': 'LL56', 'A91': 'LL56', 'A92': 'LL56',
    '9K': 'LL47',
    'HZ': 'LL24', '7Z': 'LL24', '8Z': 'LL24',
    '4X': 'KM72', '4Z': 'KM72',
    'OD': 'KM73',
    'JY': 'KM71',
    'YK': 'KM74',
    'YI': 'LM30',
    'EP': 'LL58', 'EQ': 'LL58',
    'EK': 'LN20',
    '4J': 'LN40', '4K': 'LN40',
    '4L': 'LN21',
    'TA': 'KN41', 'TB': 'KN41', 'TC': 'KN41', 'YM': 'KN41', 'TA1': 'KN41',
    '5B': 'KM64', 'C4': 'KM64', 'H2': 'KM64', 'P3': 'KM64',
    'ZC4': 'KM64',

    // ============================================
    // Asia - Central
    // ============================================
    'EX': 'MM78',
    'EY': 'MM49',
    'EZ': 'LN71',
    'UK': 'MN41',
    'UN': 'MN53', 'UP': 'MN53', 'UQ': 'MN53',
    'YA': 'MM24', 'T6': 'MM24',

    // ============================================
    // Oceania - Australia
    // ============================================
    'VK': 'QF56', 'VK1': 'QF44', 'VK2': 'QF56', 'VK3': 'QF22', 'VK4': 'QG62', 'VK5': 'PF95', 'VK6': 'OF86', 'VK7': 'QE38', 'VK8': 'PH57', 'VK9': 'QF56',
    'VK9C': 'OH29',
    'VK9X': 'NH93',
    'VK9L': 'QF92',
    'VK9W': 'QG14',
    'VK9M': 'QG11',
    'VK9N': 'RF73',
    'VK0H': 'MC55',
    'VK0M': 'QE37',

    // ============================================
    // Oceania - New Zealand & Pacific
    // ============================================
    'ZL': 'RF70', 'ZL1': 'RF72', 'ZL2': 'RF70', 'ZL3': 'RE66', 'ZL4': 'RE54', 'ZM': 'RF70',
    'ZL7': 'AE67',
    'ZL8': 'AH36',
    'ZL9': 'RE44',
    'E5': 'BH83', 'E51': 'BH83',
    'E52': 'AI38',
    'ZK3': 'AH89',
    'FK': 'RG37', 'TX': 'RG37',
    'FK/C': 'RH29',
    'FO': 'BH52',
    'FO/A': 'CJ07',
    'FO/C': 'CI06',
    'FO/M': 'DI79',
    'FW': 'AH44',
    'A3': 'AG28', 'A35': 'AG28',
    '5W': 'AH45',
    'YJ': 'RH31', 'YJ0': 'RH31',
    'H4': 'RI07', 'H44': 'RI07',
    'P2': 'QI24',
    'V6': 'QJ66',
    'V7': 'RJ48',
    'T8': 'PJ77',
    'T2': 'RI87',
    'T3': 'RI96',
    'T31': 'AI58',
    'T32': 'BI69',
    'T33': 'AJ25',
    'C2': 'QI32',
    '3D2': 'RH91',
    '3D2C': 'QH38',
    '3D2R': 'RG26',
    'ZK2': 'AI48',
    'E6': 'AH28',

    // ============================================
    // Africa - North
    // ============================================
    'CN': 'IM63', '5C': 'IM63', '5D': 'IM63',
    '7X': 'JM16',
    '3V': 'JM54', 'TS': 'JM54',
    '5A': 'JM73',
    'SU': 'KL30', '6A': 'KL30',

    // ============================================
    // Africa - West
    // ============================================
    '5T': 'IL30',
    '6W': 'IK14',
    'C5': 'IK13',
    'J5': 'IK52',
    '3X': 'IJ75',
    '9L': 'IJ38',
    'EL': 'IJ56',
    'TU': 'IJ95',
    '9G': 'IJ95',
    '5V': 'JJ07',
    'TY': 'JJ16',
    '5N': 'JJ55',
    '5U': 'JK16',
    'TZ': 'IK52',
    'XT': 'JJ00',
    'TJ': 'JJ55',
    'D4': 'HK76',

    // ============================================
    // Africa - Central
    // ============================================
    'TT': 'JK73',
    'TN': 'JI64',
    '9Q': 'JI76',
    'TL': 'JJ91',
    'TR': 'JI41',
    'S9': 'JJ40',
    '3C': 'JJ41',
    'D2': 'JH84',

    // ============================================
    // Africa - East
    // ============================================
    'ET': 'KJ49',
    'E3': 'KJ76',
    '6O': 'LJ07', 'T5': 'LJ07',
    'J2': 'LK03',
    '5Z': 'KI88',
    '5X': 'KI42',
    '5H': 'KI73',
    '9X': 'KI45',
    '9U': 'KI23',
    'C9': 'KH53',
    '7Q': 'KH54',
    '9J': 'KH35',
    'Z2': 'KH42',
    '7P': 'KG30',
    '3DA': 'KG53',
    'A2': 'KG52',
    'V5': 'JG87',

    // ============================================
    // Africa - South
    // ============================================
    'ZS': 'KG33', 'ZR': 'KG33', 'ZT': 'KG33', 'ZU': 'KG33',
    'ZS8': 'KG42',
    '3Y': 'JD45',

    // ============================================
    // Africa - Islands
    // ============================================
    'D6': 'LH47',
    '5R': 'LH45',
    '3B8': 'LG89',
    '3B9': 'LH14',
    '3B6': 'LH28',
    'S7': 'LI73',
    'FT5W': 'KG42',
    'FT5X': 'MC55',
    'FT5Z': 'ME47',
    'FR': 'LG79',
    'FH': 'LI15',
    'VQ9': 'MJ66',

    // ============================================
    // Antarctica
    // ============================================
    'CE9': 'FC56', 'DP0': 'IB59', 'DP1': 'IB59', 'KC4': 'FC56',
    '8J1': 'LC97', 'R1AN': 'KC29', 'ZL5': 'RB32',

    // ============================================
    // Other/Islands
    // ============================================
    'ZB': 'IM76',
    'ZD7': 'IH74',
    'ZD8': 'II22',
    'ZD9': 'JE26',
    '9M0': 'NJ07',
    'BQ9': 'PJ29',
  };
  
  const upper = callsign.toUpperCase();
  
  // Check US territories FIRST (before generic US pattern)
  // These start with K but are NOT mainland USA
  const usTerritoryPrefixes = {
    'KP1': 'FN42',  // Navassa Island
    'KP2': 'FK77',  // US Virgin Islands
    'KP3': 'FK68',  // Puerto Rico (same as KP4)
    'KP4': 'FK68',  // Puerto Rico
    'KP5': 'FK68',  // Desecheo Island
    'NP2': 'FK77',  // US Virgin Islands
    'NP3': 'FK68',  // Puerto Rico
    'NP4': 'FK68',  // Puerto Rico
    'WP2': 'FK77',  // US Virgin Islands
    'WP3': 'FK68',  // Puerto Rico
    'WP4': 'FK68',  // Puerto Rico
    'KH0': 'QK25',  // Mariana Islands
    'KH1': 'BL01',  // Baker/Howland
    'KH2': 'QK24',  // Guam
    'KH3': 'BL01',  // Johnston Island
    'KH4': 'AL07',  // Midway
    'KH5': 'BK29',  // Palmyra/Jarvis
    'KH6': 'BL01',  // Hawaii
    'KH7': 'BL01',  // Kure Island
    'KH8': 'AH38',  // American Samoa
    'KH9': 'AK19',  // Wake Island
    'NH6': 'BL01',  // Hawaii
    'NH7': 'BL01',  // Hawaii
    'WH6': 'BL01',  // Hawaii
    'WH7': 'BL01',  // Hawaii
    'KL7': 'BP51',  // Alaska
    'NL7': 'BP51',  // Alaska
    'WL7': 'BP51',  // Alaska
    'AL7': 'BP51',  // Alaska
    'KG4': 'FK29',  // Guantanamo Bay
  };
  
  // Check for US territory prefix (3 chars like KP4, KH6, KL7)
  const territoryPrefix3 = upper.substring(0, 3);
  if (usTerritoryPrefixes[territoryPrefix3]) {
    const grid = usTerritoryPrefixes[territoryPrefix3];
    const gridLoc = maidenheadToLatLon(grid);
    if (gridLoc) {
      return {
        callsign,
        lat: gridLoc.lat,
        lon: gridLoc.lon,
        grid: grid,
        country: territoryPrefix3.startsWith('KP') || territoryPrefix3.startsWith('NP') || territoryPrefix3.startsWith('WP') ? 'Puerto Rico/USVI' :
                 territoryPrefix3.startsWith('KH') || territoryPrefix3.startsWith('NH') || territoryPrefix3.startsWith('WH') ? 'Hawaii/Pacific' :
                 territoryPrefix3.includes('L7') ? 'Alaska' : 'US Territory',
        estimated: true,
        source: 'prefix-grid'
      };
    }
  }
  
  // Smart US callsign detection - US prefixes follow specific patterns
  // K, N, W + anything = USA
  // A[A-L] + digit = USA (e.g., AA0, AE5, AL7)
  const usCallPattern = /^([KNW][0-9]?|A[A-L][0-9])/;
  const usMatch = upper.match(usCallPattern);
  if (usMatch) {
    // Extract call district (the digit) for more precise location
    const districtMatch = upper.match(/^[KNWA][A-L]?([0-9])/);
    const district = districtMatch ? districtMatch[1] : null;
    
    const usDistrictGrids = {
      '0': 'EN31', // Central (CO, IA, KS, MN, MO, NE, ND, SD)
      '1': 'FN41', // New England (CT, MA, ME, NH, RI, VT)
      '2': 'FN20', // NY, NJ
      '3': 'FM19', // PA, MD, DE
      '4': 'EM73', // Southeast (AL, FL, GA, KY, NC, SC, TN, VA)
      '5': 'EM12', // TX, OK, LA, AR, MS, NM
      '6': 'CM97', // California
      '7': 'DN31', // Pacific NW/Mountain (AZ, ID, MT, NV, OR, UT, WA, WY)
      '8': 'EN81', // MI, OH, WV
      '9': 'EN52', // IL, IN, WI
    };
    
    const grid = district && usDistrictGrids[district] ? usDistrictGrids[district] : 'EM79';
    const gridLoc = maidenheadToLatLon(grid);
    if (gridLoc) {
      return {
        callsign,
        lat: gridLoc.lat,
        lon: gridLoc.lon,
        grid: grid,
        country: 'USA',
        estimated: true,
        source: 'prefix-grid'
      };
    }
  }
  
  // Try longest prefix match first (up to 4 chars) for non-US calls
  for (let len = 4; len >= 1; len--) {
    const prefix = upper.substring(0, len);
    if (prefixGrids[prefix]) {
      const gridLoc = maidenheadToLatLon(prefixGrids[prefix]);
      if (gridLoc) {
        return { 
          callsign, 
          lat: gridLoc.lat, 
          lon: gridLoc.lon, 
          grid: prefixGrids[prefix],
          country: getCountryFromPrefix(prefix),
          estimated: true,
          source: 'prefix-grid'
        };
      }
    }
  }
  
  // Fallback to first character (most likely country for each letter)
  const firstCharGrids = {
    'A': 'EM79', 'B': 'PL02', 'C': 'FN03', 'D': 'JO51', 'E': 'IO63', // A=USA (AA-AL), B=China, C=Canada, D=Germany, E=Spain/Ireland
    'F': 'JN18', 'G': 'IO91', 'H': 'KM72', 'I': 'JN61', 'J': 'PM95', // F=France, G=UK, H=varies, I=Italy, J=Japan
    'K': 'EM79', 'L': 'GF05', 'M': 'IO91', 'N': 'EM79', 'O': 'KP20', // K=USA, L=Argentina, M=UK, N=USA, O=Finland
    'P': 'GG87', 'R': 'KO85', 'S': 'JO89', 'T': 'KI88', 'U': 'KO85', // P=Brazil, R=Russia, S=Sweden, T=varies, U=Russia
    'V': 'QF56', 'W': 'EM79', 'X': 'EK09', 'Y': 'JO91', 'Z': 'KG33'  // V=Australia, W=USA, X=Mexico, Y=varies, Z=South Africa
  };
  
  const firstChar = upper[0];
  if (firstCharGrids[firstChar]) {
    const gridLoc = maidenheadToLatLon(firstCharGrids[firstChar]);
    if (gridLoc) {
      return {
        callsign,
        lat: gridLoc.lat,
        lon: gridLoc.lon,
        grid: firstCharGrids[firstChar],
        country: 'Unknown',
        estimated: true,
        source: 'prefix-grid'
      };
    }
  }
  
  return null;
}

// Helper to get country name from prefix
function getCountryFromPrefix(prefix) {
  const prefixCountries = {
    'W': 'USA', 'K': 'USA', 'N': 'USA', 'AA': 'USA',
    'KP4': 'Puerto Rico', 'NP4': 'Puerto Rico', 'WP4': 'Puerto Rico',
    'KP2': 'US Virgin Is', 'NP2': 'US Virgin Is', 'WP2': 'US Virgin Is',
    'KH6': 'Hawaii', 'NH6': 'Hawaii', 'WH6': 'Hawaii',
    'KH2': 'Guam', 'KL7': 'Alaska', 'NL7': 'Alaska', 'WL7': 'Alaska',
    'VE': 'Canada', 'VA': 'Canada', 'VY': 'Canada', 'VO': 'Canada',
    'G': 'England', 'M': 'England', '2E': 'England', 'GM': 'Scotland', 'GW': 'Wales', 'GI': 'N. Ireland',
    'EI': 'Ireland', 'F': 'France', 'DL': 'Germany', 'I': 'Italy', 'EA': 'Spain', 'CT': 'Portugal',
    'PA': 'Netherlands', 'ON': 'Belgium', 'HB': 'Switzerland', 'OE': 'Austria',
    'OZ': 'Denmark', 'SM': 'Sweden', 'LA': 'Norway', 'OH': 'Finland',
    'SP': 'Poland', 'OK': 'Czech Rep', 'HA': 'Hungary', 'YO': 'Romania', 'LZ': 'Bulgaria',
    'UA': 'Russia', 'UR': 'Ukraine',
    'JA': 'Japan', 'HL': 'S. Korea', 'BV': 'Taiwan', 'BY': 'China', 'VU': 'India', 'HS': 'Thailand',
    'VK': 'Australia', 'ZL': 'New Zealand',
    'LU': 'Argentina', 'PY': 'Brazil', 'ZV': 'Brazil', 'ZW': 'Brazil', 'ZX': 'Brazil', 'ZY': 'Brazil', 'ZZ': 'Brazil',
    'CE': 'Chile', 'HK': 'Colombia', 'YV': 'Venezuela', 'HC': 'Ecuador', 'OA': 'Peru', 'CX': 'Uruguay',
    'ZS': 'South Africa', 'CN': 'Morocco', 'SU': 'Egypt', '5N': 'Nigeria', '5Z': 'Kenya', 'ET': 'Ethiopia',
    'TY': 'Benin', 'TU': 'Ivory Coast', 'TR': 'Gabon', 'TZ': 'Mali', 'V5': 'Namibia', 'A2': 'Botswana',
    'JY': 'Jordan', 'HZ': 'Saudi Arabia', 'A6': 'UAE', 'A7': 'Qatar', 'A9': 'Bahrain', 'A4': 'Oman',
    '4X': 'Israel', 'OD': 'Lebanon', 'YK': 'Syria', 'YI': 'Iraq', 'EP': 'Iran', 'TA': 'Turkey',
    '5B': 'Cyprus', 'EK': 'Armenia', '4J': 'Azerbaijan'
  };
  
  for (let len = 3; len >= 1; len--) {
    const p = prefix.substring(0, len);
    if (prefixCountries[p]) return prefixCountries[p];
  }
  return 'Unknown';
}

// ============================================
// MY SPOTS API - Get spots involving a specific callsign
// ============================================

// Cache for my spots data
let mySpotsCache = new Map(); // key = callsign, value = { data, timestamp }
const MYSPOTS_CACHE_TTL = 45000; // 45 seconds (just under 60s frontend poll to maximize cache hits)

// Clean expired mySpots entries every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [call, entry] of mySpotsCache) {
    if (now - entry.timestamp > MYSPOTS_CACHE_TTL * 2) {
      mySpotsCache.delete(call);
    }
  }
}, 2 * 60 * 1000);

app.get('/api/myspots/:callsign', async (req, res) => {
  const callsign = req.params.callsign.toUpperCase();
  const now = Date.now();
  
  // Check cache first
  const cached = mySpotsCache.get(callsign);
  if (cached && (now - cached.timestamp) < MYSPOTS_CACHE_TTL) {
    logDebug('[My Spots] Returning cached data for:', callsign);
    return res.json(cached.data);
  }
  
  logDebug('[My Spots] Searching for callsign:', callsign);
  
  const mySpots = [];
  
  try {
    // Try HamQTH for spots involving this callsign
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(
      `https://www.hamqth.com/dxc_csv.php?limit=100`,
      {
        headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
        signal: controller.signal
      }
    );
    clearTimeout(timeout);
    
    if (response.ok) {
      const text = await response.text();
      const lines = text.trim().split('\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('^');
        if (parts.length < 3) continue;
        
        const spotter = parts[0]?.trim().toUpperCase();
        const dxCall = parts[2]?.trim().toUpperCase();
        const freq = parts[1]?.trim();
        const comment = parts[3]?.trim() || '';
        const timeStr = parts[4]?.trim() || '';
        
        // Check if our callsign is involved (as spotter or spotted)
        if (spotter === callsign || dxCall === callsign || 
            spotter.includes(callsign) || dxCall.includes(callsign)) {
          mySpots.push({
            spotter,
            dxCall,
            freq: freq ? (parseFloat(freq) / 1000).toFixed(3) : '0.000',
            comment,
            time: timeStr ? timeStr.substring(0, 5) + 'z' : '',
            isMySpot: spotter.includes(callsign),
            isSpottedMe: dxCall.includes(callsign)
          });
        }
      }
    }
    
    logDebug('[My Spots] Found', mySpots.length, 'spots involving', callsign);
    
    // Now try to get locations for each unique callsign
    const uniqueCalls = [...new Set(mySpots.map(s => s.isMySpot ? s.dxCall : s.spotter))];
    const locations = {};
    
    for (const call of uniqueCalls.slice(0, 10)) { // Limit to 10 lookups
      try {
        const loc = estimateLocationFromPrefix(call);
        if (loc) {
          locations[call] = { lat: loc.lat, lon: loc.lon, country: loc.country };
        }
      } catch (e) {
        // Ignore lookup errors
      }
    }
    
    // Add locations to spots
    const spotsWithLocations = mySpots.map(spot => {
      const targetCall = spot.isMySpot ? spot.dxCall : spot.spotter;
      const loc = locations[targetCall];
      return {
        ...spot,
        targetCall,
        lat: loc?.lat,
        lon: loc?.lon,
        country: loc?.country
      };
    }).filter(s => s.lat && s.lon); // Only return spots with valid locations
    
    // Cache the result
    mySpotsCache.set(callsign, { data: spotsWithLocations, timestamp: Date.now() });
    
    res.json(spotsWithLocations);
  } catch (error) {
    logErrorOnce('My Spots', error.message);
    res.json([]);
  }
});

// ============================================
// PSKREPORTER API (MQTT-based for real-time)
// ============================================

// PSKReporter MQTT feed at mqtt.pskreporter.info provides real-time spots
// WebSocket endpoints: 1885 (ws), 1886 (wss)
// Topic format: pskr/filter/v2/{band}/{mode}/{sendercall}/{receivercall}/{senderlocator}/{receiverlocator}/{sendercountry}/{receivercountry}

// NOTE: PSKReporter spots are now handled entirely through the MQTT proxy system
// (pskMqtt.recentSpots and pskMqtt.spotBuffer), not this legacy cache.

// Convert grid square to lat/lon
function gridToLatLonSimple(grid) {
  if (!grid || grid.length < 4) return null;
  
  const g = grid.toUpperCase();
  const lon = (g.charCodeAt(0) - 65) * 20 - 180;
  const lat = (g.charCodeAt(1) - 65) * 10 - 90;
  const lonMin = parseInt(g[2]) * 2;
  const latMin = parseInt(g[3]) * 1;
  
  let finalLon = lon + lonMin + 1;
  let finalLat = lat + latMin + 0.5;
  
  // If 6-character grid, add more precision
  if (grid.length >= 6) {
    const lonSec = (g.charCodeAt(4) - 65) * (2/24);
    const latSec = (g.charCodeAt(5) - 65) * (1/24);
    finalLon = lon + lonMin + lonSec + (1/24);
    finalLat = lat + latMin + latSec + (0.5/24);
  }
  
  return { lat: finalLat, lon: finalLon };
}

// Get band name from frequency in Hz
function getBandFromHz(freqHz) {
  const freq = freqHz / 1000000; // Convert to MHz
  if (freq >= 1.8 && freq <= 2) return '160m';
  if (freq >= 3.5 && freq <= 4) return '80m';
  if (freq >= 5.3 && freq <= 5.4) return '60m';
  if (freq >= 7 && freq <= 7.3) return '40m';
  if (freq >= 10.1 && freq <= 10.15) return '30m';
  if (freq >= 14 && freq <= 14.35) return '20m';
  if (freq >= 18.068 && freq <= 18.168) return '17m';
  if (freq >= 21 && freq <= 21.45) return '15m';
  if (freq >= 24.89 && freq <= 24.99) return '12m';
  if (freq >= 28 && freq <= 29.7) return '10m';
  if (freq >= 50 && freq <= 54) return '6m';
  if (freq >= 144 && freq <= 148) return '2m';
  if (freq >= 420 && freq <= 450) return '70cm';
  return 'Unknown';
}

// PSKReporter endpoint - returns connection info for frontend
// The server now proxies MQTT and exposes it via SSE
app.get('/api/pskreporter/config', (req, res) => {
  res.json({
    stream: {
      endpoint: '/api/pskreporter/stream/{callsign}',
      type: 'text/event-stream',
      batchInterval: '15s',
      note: 'Server maintains single MQTT connection to PSKReporter, relays via SSE'
    },
    mqtt: {
      status: pskMqtt.connected ? 'connected' : 'disconnected',
      activeCallsigns: pskMqtt.subscribedCalls.size,
      sseClients: [...pskMqtt.subscribers.values()].reduce((n, s) => n + s.size, 0)
    },
    info: 'Connect to /api/pskreporter/stream/:callsign for real-time spots via Server-Sent Events'
  });
});

// Combined endpoint - returns stream info (live spots via SSE, no HTTP backfill)
app.get('/api/pskreporter/:callsign', async (req, res) => {
  const callsign = req.params.callsign.toUpperCase();
  
  res.json({
    callsign,
    stream: {
      endpoint: `/api/pskreporter/stream/${callsign}`,
      type: 'text/event-stream',
      hint: 'Connect to SSE stream for real-time spots. Initial spots delivered on connect event.'
    },
    mqtt: {
      status: pskMqtt.connected ? 'connected' : 'disconnected',
      activeCallsigns: pskMqtt.subscribedCalls.size,
      sseClients: Array.from(pskMqtt.subscribers.values()).reduce((s, c) => s + c.size, 0)
    }
  });
});

// ============================================
// PSKREPORTER SERVER-SIDE MQTT PROXY
// ============================================
// Single MQTT connection to mqtt.pskreporter.info, shared across all users.
// Dynamically subscribes per-callsign topics based on active SSE clients.
// Buffers incoming spots and pushes to clients every 15 seconds.

const pskMqtt = {
  client: null,
  connected: false,
  // Map<callsign, Set<response>> — active SSE clients per callsign
  subscribers: new Map(),
  // Map<callsign, Array<spot>> — buffered spots waiting for next flush
  spotBuffer: new Map(),
  // Map<callsign, Array<spot>> — recent spots (last 60 min) for late-joiners
  recentSpots: new Map(),
  // Track subscribed topics to avoid double-subscribe
  subscribedCalls: new Set(),
  reconnectAttempts: 0,
  maxReconnectDelay: 120000, // 2 min max
  reconnectTimer: null, // guards against multiple pending reconnects
  flushInterval: null,
  cleanupInterval: null,
  stats: { spotsReceived: 0, spotsRelayed: 0, messagesDropped: 0, lastSpotTime: null }
};

function pskMqttConnect() {
  // Tear down old client — remove listeners FIRST to prevent its 'close'
  // event from scheduling a duplicate reconnect (fork bomb prevention)
  if (pskMqtt.client) {
    try {
      pskMqtt.client.removeAllListeners();
      // MUST re-attach a no-op error handler — Node.js crashes on
      // unhandled 'error' events, and the old client may still emit
      // errors (e.g. connack timeout) after we've detached
      pskMqtt.client.on('error', () => {});
      pskMqtt.client.end(true);
    } catch {}
    pskMqtt.client = null;
  }

  const clientId = `ohc_svr_${Math.random().toString(16).substr(2, 8)}`;
  console.log(`[PSK-MQTT] Connecting to mqtt.pskreporter.info as ${clientId}...`);

  const client = mqttLib.connect('wss://mqtt.pskreporter.info:1886/mqtt', {
    clientId,
    clean: true,
    connectTimeout: 30000,
    reconnectPeriod: 0,  // We handle reconnect ourselves with backoff
    keepalive: 60,
    protocolVersion: 4
  });

  pskMqtt.client = client;

  client.on('connect', () => {
    pskMqtt.connected = true;
    pskMqtt.reconnectAttempts = 0;

    const count = pskMqtt.subscribedCalls.size;
    if (count > 0) {
      console.log(`[PSK-MQTT] Connected — subscribing ${count} callsigns`);
      // Batch all topic subscriptions into a single subscribe call
      const topics = [];
      for (const call of pskMqtt.subscribedCalls) {
        topics.push(`pskr/filter/v2/+/+/${call}/#`);
        topics.push(`pskr/filter/v2/+/+/+/${call}/#`);
      }
      pskMqtt.client.subscribe(topics, { qos: 0 }, (err) => {
        if (err) {
          // "Connection closed" errors are expected during unstable reconnects —
          // the next on('connect') will retry the batch subscribe
          if (err.message && err.message.includes('onnection closed')) return;
          console.error(`[PSK-MQTT] Batch subscribe error:`, err.message);
        } else {
          console.log(`[PSK-MQTT] Subscribed ${count} callsigns (${topics.length} topics)`);
        }
      });
    } else {
      console.log('[PSK-MQTT] Connected (no active callsigns)');
    }
  });

  client.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      const { sc, rc, sl, rl, f, md, rp, t, b } = data;
      if (!sc || !rc) return;

      const freq = parseInt(f) || 0;
      const now = Date.now();
      const spot = {
        sender: sc,
        senderGrid: sl,
        receiver: rc,
        receiverGrid: rl,
        freq,
        freqMHz: freq ? (freq / 1000000).toFixed(3) : '?',
        band: b || getBandFromHz(freq),
        mode: md || 'Unknown',
        snr: rp !== undefined ? parseInt(rp) : null,
        timestamp: t ? t * 1000 : now,
        age: 0
      };

      // Add lat/lon based on grid for both directions
      const senderLoc = gridToLatLonSimple(sl);
      const receiverLoc = gridToLatLonSimple(rl);

      pskMqtt.stats.spotsReceived++;
      pskMqtt.stats.lastSpotTime = now;

      // Buffer for TX subscribers (sc is the callsign being tracked)
      const scUpper = sc.toUpperCase();
      if (pskMqtt.subscribers.has(scUpper)) {
        const txSpot = { ...spot, lat: receiverLoc?.lat, lon: receiverLoc?.lon, direction: 'tx' };
        if (!pskMqtt.spotBuffer.has(scUpper)) pskMqtt.spotBuffer.set(scUpper, []);
        pskMqtt.spotBuffer.get(scUpper).push(txSpot);
        // Also add to recent spots (capped at insert time to prevent unbounded growth)
        if (!pskMqtt.recentSpots.has(scUpper)) pskMqtt.recentSpots.set(scUpper, []);
        const scRecent = pskMqtt.recentSpots.get(scUpper);
        scRecent.push(txSpot);
        if (scRecent.length > 250) pskMqtt.recentSpots.set(scUpper, scRecent.slice(-200));
      }

      // Buffer for RX subscribers (rc is the callsign being tracked)
      const rcUpper = rc.toUpperCase();
      if (pskMqtt.subscribers.has(rcUpper)) {
        const rxSpot = { ...spot, lat: senderLoc?.lat, lon: senderLoc?.lon, direction: 'rx' };
        if (!pskMqtt.spotBuffer.has(rcUpper)) pskMqtt.spotBuffer.set(rcUpper, []);
        pskMqtt.spotBuffer.get(rcUpper).push(rxSpot);
        if (!pskMqtt.recentSpots.has(rcUpper)) pskMqtt.recentSpots.set(rcUpper, []);
        const rcRecent = pskMqtt.recentSpots.get(rcUpper);
        rcRecent.push(rxSpot);
        if (rcRecent.length > 250) pskMqtt.recentSpots.set(rcUpper, rcRecent.slice(-200));
      }
    } catch {
      pskMqtt.stats.messagesDropped++;
    }
  });

  client.on('error', (err) => {
    if (client !== pskMqtt.client) return;
    // "Connection closed" is redundant with on('close') handler
    if (err.message && err.message.includes('onnection closed')) return;
    console.error(`[PSK-MQTT] Error: ${err.message}`);
  });

  client.on('close', () => {
    // Only react to close events from the CURRENT client — stale clients
    // (replaced by a reconnect) must not schedule additional reconnects
    if (client !== pskMqtt.client) return;
    pskMqtt.connected = false;
    logErrorOnce('PSK-MQTT', 'Disconnected from mqtt.pskreporter.info');
    scheduleMqttReconnect();
  });

  client.on('offline', () => {
    if (client !== pskMqtt.client) return;
    pskMqtt.connected = false;
  });
}

function scheduleMqttReconnect() {
  // Clear any existing reconnect timer — only one pending reconnect at a time
  if (pskMqtt.reconnectTimer) {
    clearTimeout(pskMqtt.reconnectTimer);
    pskMqtt.reconnectTimer = null;
  }

  pskMqtt.reconnectAttempts++;
  const delay = Math.min(
    (Math.pow(2, pskMqtt.reconnectAttempts) * 1000) + (Math.random() * 5000),
    pskMqtt.maxReconnectDelay
  );
  // Log first attempt and every 5th to avoid spam during extended outages
  if (pskMqtt.reconnectAttempts === 1 || pskMqtt.reconnectAttempts % 5 === 0) {
    console.log(`[PSK-MQTT] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${pskMqtt.reconnectAttempts})...`);
  }
  pskMqtt.reconnectTimer = setTimeout(() => {
    pskMqtt.reconnectTimer = null;
    if (pskMqtt.subscribers.size > 0) {
      pskMqttConnect();
    } else {
      console.log('[PSK-MQTT] No active subscribers, skipping reconnect');
    }
  }, delay);
}

function subscribeCallsign(call) {
  if (!pskMqtt.client || !pskMqtt.connected) return;
  const txTopic = `pskr/filter/v2/+/+/${call}/#`;
  const rxTopic = `pskr/filter/v2/+/+/+/${call}/#`;
  pskMqtt.client.subscribe([txTopic, rxTopic], { qos: 0 }, (err) => {
    if (err) {
      // "Connection closed" errors are expected during reconnects — 
      // the on('connect') handler will re-subscribe all active callsigns
      if (err.message && err.message.includes('onnection closed')) return;
      console.error(`[PSK-MQTT] Subscribe error for ${call}:`, err.message);
    }
  });
}

function unsubscribeCallsign(call) {
  if (!pskMqtt.client || !pskMqtt.connected) return;
  const txTopic = `pskr/filter/v2/+/+/${call}/#`;
  const rxTopic = `pskr/filter/v2/+/+/+/${call}/#`;
  pskMqtt.client.unsubscribe([txTopic, rxTopic], (err) => {
    if (err) {
      if (err.message && err.message.includes('onnection closed')) return;
      console.error(`[PSK-MQTT] Unsubscribe error for ${call}:`, err.message);
    }
  });
}

// Flush buffered spots to SSE clients every 15 seconds
pskMqtt.flushInterval = setInterval(() => {
  for (const [call, clients] of pskMqtt.subscribers) {
    const buffer = pskMqtt.spotBuffer.get(call);
    if (!buffer || buffer.length === 0) continue;

    // Send buffered spots as SSE event
    const payload = JSON.stringify(buffer);
    const message = `data: ${payload}\n\n`;

    for (const res of clients) {
      try {
        res.write(message);
        if (typeof res.flush === 'function') res.flush();
        pskMqtt.stats.spotsRelayed += buffer.length;
      } catch {
        // Client disconnected — will be cleaned up
        clients.delete(res);
      }
    }

    // Clear the buffer after flushing
    pskMqtt.spotBuffer.set(call, []);
  }
}, 15000); // 15-second batch interval

// Clean old recent spots every 5 minutes
pskMqtt.cleanupInterval = setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
  for (const [call, spots] of pskMqtt.recentSpots) {
    // Delete entries for unsubscribed callsigns immediately
    if (!pskMqtt.subscribedCalls.has(call)) {
      pskMqtt.recentSpots.delete(call);
      continue;
    }
    const filtered = spots.filter(s => s.timestamp > cutoff);
    if (filtered.length === 0) {
      pskMqtt.recentSpots.delete(call);
    } else {
      // Keep max 200 per callsign (matches what clients receive on connect)
      pskMqtt.recentSpots.set(call, filtered.slice(-200));
    }
  }

  // Clean spotBuffer entries for unsubscribed callsigns
  for (const call of pskMqtt.spotBuffer.keys()) {
    if (!pskMqtt.subscribedCalls.has(call)) {
      pskMqtt.spotBuffer.delete(call);
    }
  }

  // Also clean subscriber entries with no clients
  for (const [call, clients] of pskMqtt.subscribers) {
    if (clients.size === 0) {
      pskMqtt.subscribers.delete(call);
      pskMqtt.subscribedCalls.delete(call);
      unsubscribeCallsign(call);
      console.log(`[PSK-MQTT] Cleaned up empty subscriber set for ${call}`);
    }
  }
}, 5 * 60 * 1000);

// SSE endpoint — clients connect here for real-time spots
app.get('/api/pskreporter/stream/:callsign', (req, res) => {
  const callsign = req.params.callsign.toUpperCase();
  if (!callsign || callsign === 'N0CALL') {
    return res.status(400).json({ error: 'Valid callsign required' });
  }

  // Set up SSE — disable any buffering
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity'
  });
  res.flushHeaders();

  // Send initial connection event with any recent spots we already have
  const recentSpots = pskMqtt.recentSpots.get(callsign) || [];
  res.write(`event: connected\ndata: ${JSON.stringify({
    callsign,
    mqttConnected: pskMqtt.connected,
    recentSpots: recentSpots.slice(-200),
    subscriberCount: (pskMqtt.subscribers.get(callsign)?.size || 0) + 1
  })}\n\n`);
  if (typeof res.flush === 'function') res.flush();

  // Register this client
  if (!pskMqtt.subscribers.has(callsign)) {
    pskMqtt.subscribers.set(callsign, new Set());
  }
  pskMqtt.subscribers.get(callsign).add(res);

  // Subscribe on MQTT if this is a new callsign
  if (!pskMqtt.subscribedCalls.has(callsign)) {
    pskMqtt.subscribedCalls.add(callsign);
    if (pskMqtt.connected) {
      subscribeCallsign(callsign);
    }
    // Start MQTT connection if not already connected
    if (!pskMqtt.client || (!pskMqtt.connected && pskMqtt.reconnectAttempts === 0)) {
      pskMqttConnect();
    }
  }

  console.log(`[PSK-MQTT] SSE client connected for ${callsign} (${pskMqtt.subscribers.get(callsign).size} clients, ${pskMqtt.subscribedCalls.size} callsigns total)`);

  // Keepalive ping every 30 seconds
  const keepalive = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    } catch {
      clearInterval(keepalive);
    }
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(keepalive);
    const clients = pskMqtt.subscribers.get(callsign);
    if (clients) {
      clients.delete(res);
      console.log(`[PSK-MQTT] SSE client disconnected for ${callsign} (${clients.size} remaining)`);

      // If no more clients for this callsign, unsubscribe after a grace period
      if (clients.size === 0) {
        setTimeout(() => {
          const stillEmpty = pskMqtt.subscribers.get(callsign);
          if (stillEmpty && stillEmpty.size === 0) {
            pskMqtt.subscribers.delete(callsign);
            pskMqtt.subscribedCalls.delete(callsign);
            // Clean up spot data for this callsign
            pskMqtt.recentSpots.delete(callsign);
            pskMqtt.spotBuffer.delete(callsign);
            unsubscribeCallsign(callsign);
            console.log(`[PSK-MQTT] Unsubscribed ${callsign} (no more clients after grace period)`);

            // If no subscribers at all, disconnect MQTT entirely
            if (pskMqtt.subscribedCalls.size === 0 && pskMqtt.client) {
              console.log('[PSK-MQTT] No more subscribers, disconnecting from broker');
              // Cancel any pending reconnect
              if (pskMqtt.reconnectTimer) {
                clearTimeout(pskMqtt.reconnectTimer);
                pskMqtt.reconnectTimer = null;
              }
              // Strip listeners before end() to prevent close → reconnect
              try {
                pskMqtt.client.removeAllListeners();
                pskMqtt.client.on('error', () => {}); // prevent crash on late errors
                pskMqtt.client.end(true);
              } catch {}
              pskMqtt.client = null;
              pskMqtt.connected = false;
              pskMqtt.reconnectAttempts = 0;
            }
          }
        }, 30000); // 30s grace period before unsubscribing
      }
    }
  });
});

// ============================================
// REVERSE BEACON NETWORK (RBN) API
// ============================================

// Convert lat/lon to Maidenhead grid (6-character)
function latLonToGrid(lat, lon) {
  if (!isFinite(lat) || !isFinite(lon)) return null;
  
  // Adjust longitude to 0-360 range
  let adjLon = lon + 180;
  let adjLat = lat + 90;
  
  // Field (2 chars): 20° lon x 10° lat
  const field1 = String.fromCharCode(65 + Math.floor(adjLon / 20));
  const field2 = String.fromCharCode(65 + Math.floor(adjLat / 10));
  
  // Square (2 digits): 2° lon x 1° lat
  const square1 = Math.floor((adjLon % 20) / 2);
  const square2 = Math.floor((adjLat % 10) / 1);
  
  // Subsquare (2 chars): 5' lon x 2.5' lat
  const subsq1 = String.fromCharCode(65 + Math.floor(((adjLon % 2) * 60) / 5));
  const subsq2 = String.fromCharCode(65 + Math.floor(((adjLat % 1) * 60) / 2.5));
  
  return `${field1}${field2}${square1}${square2}${subsq1}${subsq2}`.toUpperCase();
}

// Persistent RBN connection and spot storage
let rbnConnection = null;
let rbnSpots = []; // Rolling buffer of recent spots
const MAX_RBN_SPOTS = 2000; // Keep last 2000 spots (all modes: CW, FT8, FT4, RTTY, PSK)
const RBN_SPOT_TTL = 30 * 60 * 1000; // 30 minutes
const callsignLocationCache = new Map(); // Permanent cache for skimmer locations

// Helper function to convert frequency to band
function freqToBandKHz(freqKHz) {
  if (freqKHz >= 1800 && freqKHz < 2000) return '160m';
  if (freqKHz >= 3500 && freqKHz < 4000) return '80m';
  if (freqKHz >= 7000 && freqKHz < 7300) return '40m';
  if (freqKHz >= 10100 && freqKHz < 10150) return '30m';
  if (freqKHz >= 14000 && freqKHz < 14350) return '20m';
  if (freqKHz >= 18068 && freqKHz < 18168) return '17m';
  if (freqKHz >= 21000 && freqKHz < 21450) return '15m';
  if (freqKHz >= 24890 && freqKHz < 24990) return '12m';
  if (freqKHz >= 28000 && freqKHz < 29700) return '10m';
  if (freqKHz >= 50000 && freqKHz < 54000) return '6m';
  return 'Other';
}

/**
 * Maintain persistent connection to RBN Telnet
 */
function maintainRBNConnection(port = 7000) {
  if (rbnConnection && !rbnConnection.destroyed) {
    return; // Already connected
  }
  
  console.log(`[RBN] Creating persistent connection to telnet.reversebeacon.net:${port}...`);
  
  let dataBuffer = '';
  let authenticated = false;
  const userCallsign = 'OPENHAMCLOCK'; // Generic callsign for the app
  
  const client = net.createConnection({ 
    host: 'telnet.reversebeacon.net', 
    port: port 
  }, () => {
    console.log(`[RBN] Persistent connection established`);
  });

  client.setEncoding('utf8');
  client.setKeepAlive(true, 60000); // Keep alive every 60s
  
  client.on('data', (data) => {
    dataBuffer += data;
    
    // Check for authentication prompt
    if (!authenticated && dataBuffer.includes('Please enter your call:')) {
      console.log(`[RBN] Authenticating as ${userCallsign}`);
      client.write(`${userCallsign}\r\n`);
      authenticated = true;
      dataBuffer = '';
      return;
    }
    
    const lines = dataBuffer.split('\n');
    dataBuffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Start collecting after authentication
      if (authenticated && line.includes('Connected')) {
        console.log(`[RBN] Authenticated, now streaming spots...`);
        continue;
      }
      
      // Parse RBN spot line format:
      // CW:   DX de W3LPL-#:     7003.0  K3LR           CW    30 dB  23 WPM  CQ      0123Z
      // FT8:  DX de KM3T-#:     14074.0  K3LR           FT8   -12 dB              CQ      0123Z
      // RTTY: DX de W3LPL-#:    14080.0  K3LR           RTTY  15 dB  45 BPS  CQ      0123Z
      const spotMatch = line.match(/DX de\s+(\S+)\s*:\s*([\d.]+)\s+(\S+)\s+(\S+)\s+([-\d]+)\s+dB/);
      
      if (spotMatch) {
        const [, skimmer, freq, dx, mode, snr] = spotMatch;
        // Optionally extract WPM or BPS after dB
        const speedMatch = line.match(/(\d+)\s+(WPM|BPS)/i);
        const wpm = speedMatch ? parseInt(speedMatch[1]) : null;
        const speedUnit = speedMatch ? speedMatch[2].toUpperCase() : null;
        const timestamp = Date.now();
        const freqNum = parseFloat(freq) * 1000;
        const band = freqToBandKHz(freqNum / 1000);
        
        const spot = {
          callsign: skimmer.replace(/-#.*$/, ''),
          skimmerFull: skimmer,
          dx: dx,
          frequency: freqNum,
          freqMHz: parseFloat(freq),
          band: band,
          mode: mode,
          snr: parseInt(snr),
          wpm: wpm,
          speedUnit: speedUnit,
          timestamp: new Date().toISOString(),
          timestampMs: timestamp,
          age: 0,
          source: 'rbn-telnet',
          grid: null // Will be filled by frontend from cache
        };
        
        // Add to rolling buffer
        rbnSpots.push(spot);
        
        // Keep only recent spots
        if (rbnSpots.length > MAX_RBN_SPOTS) {
          rbnSpots.shift();
        }
        
        // Clean old spots
        const cutoff = timestamp - RBN_SPOT_TTL;
        rbnSpots = rbnSpots.filter(s => s.timestampMs > cutoff);
      }
    }
  });

  client.on('error', (err) => {
    console.error(`[RBN] Connection error: ${err.message}`);
    rbnConnection = null;
    // Reconnect after 5 seconds
    setTimeout(() => maintainRBNConnection(port), 5000);
  });

  client.on('close', () => {
    console.log(`[RBN] Connection closed, reconnecting in 5s...`);
    rbnConnection = null;
    setTimeout(() => maintainRBNConnection(port), 5000);
  });
  
  rbnConnection = client;
}

// Start persistent connection on server startup
maintainRBNConnection(7000);

// Cache for RBN API responses
let rbnApiCache = { data: null, timestamp: 0, key: '' };
const RBN_API_CACHE_TTL = 30000; // 30 seconds - spots change constantly but not every request

// Endpoint to get recent RBN spots (no filtering, just return all recent spots)
app.get('/api/rbn/spots', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || 30;
  const limit = parseInt(req.query.limit) || 200; // Reduced from 500 to save bandwidth
  
  const cacheKey = `${minutes}:${limit}`;
  const now = Date.now();
  
  // Return cached response if fresh
  if (rbnApiCache.data && rbnApiCache.key === cacheKey && (now - rbnApiCache.timestamp) < RBN_API_CACHE_TTL) {
    return res.json(rbnApiCache.data);
  }
  
  const cutoff = now - (minutes * 60 * 1000);
  
  // Filter by time window
  const recentSpots = rbnSpots
    .filter(spot => spot.timestampMs > cutoff)
    .slice(-limit); // Get most recent
  
  // Enrich spots with skimmer location data
  const enrichedSpots = await Promise.all(recentSpots.map(async (spot) => {
    const skimmerCall = spot.callsign;
    
    // Check cache first
    if (callsignLocationCache.has(skimmerCall)) {
      const location = callsignLocationCache.get(skimmerCall);
      return {
        ...spot,
        grid: location.grid,
        skimmerLat: location.lat,
        skimmerLon: location.lon,
        skimmerCountry: location.country
      };
    }
    
    // Lookup location (don't block on failures)
    try {
      const response = await fetch(`http://localhost:${PORT}/api/callsign/${skimmerCall}`);
      if (response.ok) {
        const locationData = await response.json();
        const grid = latLonToGrid(locationData.lat, locationData.lon);
        
        const location = {
          callsign: skimmerCall,
          grid: grid,
          lat: locationData.lat,
          lon: locationData.lon,
          country: locationData.country
        };
        
        // Cache permanently
        callsignLocationCache.set(skimmerCall, location);
        
        return {
          ...spot,
          grid: grid,
          skimmerLat: locationData.lat,
          skimmerLon: locationData.lon,
          skimmerCountry: locationData.country
        };
      }
    } catch (err) {
      // Silent fail - return spot without location
    }
    
    // Return spot as-is if lookup failed
    return spot;
  }));
  
  console.log(`[RBN] Returning ${enrichedSpots.length} enriched spots (last ${minutes} min)`);
  
  const response = {
    count: enrichedSpots.length,
    spots: enrichedSpots,
    minutes: minutes,
    timestamp: new Date().toISOString(),
    source: 'rbn-telnet-stream'
  };
  
  // Cache the response
  rbnApiCache = { data: response, timestamp: Date.now(), key: cacheKey };
  
  res.json(response);
});

// Endpoint to lookup skimmer location (cached permanently)
app.get('/api/rbn/location/:callsign', async (req, res) => {
  const callsign = req.params.callsign.toUpperCase();
  
  // Check cache first
  if (callsignLocationCache.has(callsign)) {
    return res.json(callsignLocationCache.get(callsign));
  }
  
  try {
    // Look up via HamQTH
    const response = await fetch(`http://localhost:${PORT}/api/callsign/${callsign}`);
    if (response.ok) {
      const locationData = await response.json();
      const grid = latLonToGrid(locationData.lat, locationData.lon);
      
      const result = {
        callsign: callsign,
        grid: grid,
        lat: locationData.lat,
        lon: locationData.lon,
        country: locationData.country
      };
      
      // Cache permanently (skimmers don't move!)
      callsignLocationCache.set(callsign, result);
      
      return res.json(result);
    }
  } catch (err) {
    console.warn(`[RBN] Failed to lookup ${callsign}: ${err.message}`);
  }
  
  res.status(404).json({ error: 'Location not found' });
});

// Legacy endpoint for compatibility (deprecated)
app.get('/api/rbn', async (req, res) => {
  console.log('[RBN] Warning: Using deprecated /api/rbn endpoint, use /api/rbn/spots instead');
  
  const callsign = (req.query.callsign || '').toUpperCase().trim();
  const minutes = parseInt(req.query.minutes) || 30;
  const limit = parseInt(req.query.limit) || 100;
  
  if (!callsign || callsign === 'N0CALL') {
    return res.json([]);
  }
  
  const now = Date.now();
  const cutoff = now - (minutes * 60 * 1000);
  
  // Filter spots for this callsign
  const userSpots = rbnSpots
    .filter(spot => spot.timestampMs > cutoff && spot.dx.toUpperCase() === callsign)
    .slice(-limit);
  
  res.json(userSpots);
});
// ============================================
// WSPR PROPAGATION HEATMAP API
// ============================================

// WSPR heatmap endpoint - gets global propagation data
// Uses PSK Reporter to fetch WSPR mode spots from the last N minutes
let wsprCache = { data: null, timestamp: 0 };
const WSPR_CACHE_TTL = 10 * 60 * 1000;  // 10 minutes cache - be kind to PSKReporter
const WSPR_STALE_TTL = 60 * 60 * 1000;  // Serve stale data up to 1 hour

// Aggregate WSPR spots by 4-character grid square for bandwidth efficiency
// Reduces payload from ~2MB to ~50KB while preserving heatmap visualization
function aggregateWSPRByGrid(spots) {
  const grids = new Map();
  const paths = new Map();
  
  for (const spot of spots) {
    // Get 4-char grids (field + square, e.g., "EM48")
    const senderGrid4 = spot.senderGrid?.substring(0, 4)?.toUpperCase();
    const receiverGrid4 = spot.receiverGrid?.substring(0, 4)?.toUpperCase();
    
    // Aggregate sender grid stats
    if (senderGrid4 && spot.senderLat && spot.senderLon) {
      if (!grids.has(senderGrid4)) {
        grids.set(senderGrid4, {
          grid: senderGrid4,
          lat: spot.senderLat,
          lon: spot.senderLon,
          txCount: 0,
          rxCount: 0,
          snrSum: 0,
          snrCount: 0,
          bands: {},
          maxDistance: 0,
          stations: new Set()
        });
      }
      const g = grids.get(senderGrid4);
      g.txCount++;
      if (spot.snr !== null && spot.snr !== undefined) {
        g.snrSum += spot.snr;
        g.snrCount++;
      }
      g.bands[spot.band] = (g.bands[spot.band] || 0) + 1;
      if (spot.distance > g.maxDistance) g.maxDistance = spot.distance;
      if (spot.sender) g.stations.add(spot.sender);
    }
    
    // Aggregate receiver grid stats
    if (receiverGrid4 && spot.receiverLat && spot.receiverLon) {
      if (!grids.has(receiverGrid4)) {
        grids.set(receiverGrid4, {
          grid: receiverGrid4,
          lat: spot.receiverLat,
          lon: spot.receiverLon,
          txCount: 0,
          rxCount: 0,
          snrSum: 0,
          snrCount: 0,
          bands: {},
          maxDistance: 0,
          stations: new Set()
        });
      }
      const g = grids.get(receiverGrid4);
      g.rxCount++;
      if (spot.receiver) g.stations.add(spot.receiver);
    }
    
    // Track paths between grid squares
    if (senderGrid4 && receiverGrid4 && senderGrid4 !== receiverGrid4) {
      const pathKey = `${senderGrid4}-${receiverGrid4}`;
      if (!paths.has(pathKey)) {
        paths.set(pathKey, { 
          from: senderGrid4, 
          to: receiverGrid4, 
          fromLat: spot.senderLat,
          fromLon: spot.senderLon,
          toLat: spot.receiverLat,
          toLon: spot.receiverLon,
          count: 0,
          snrSum: 0,
          snrCount: 0,
          bands: {}
        });
      }
      const p = paths.get(pathKey);
      p.count++;
      if (spot.snr !== null && spot.snr !== undefined) {
        p.snrSum += spot.snr;
        p.snrCount++;
      }
      p.bands[spot.band] = (p.bands[spot.band] || 0) + 1;
    }
  }
  
  // Convert to arrays and compute averages
  const gridArray = Array.from(grids.values()).map(g => ({
    grid: g.grid,
    lat: g.lat,
    lon: g.lon,
    txCount: g.txCount,
    rxCount: g.rxCount,
    totalActivity: g.txCount + g.rxCount,
    avgSnr: g.snrCount > 0 ? Math.round(g.snrSum / g.snrCount) : null,
    bands: g.bands,
    maxDistance: g.maxDistance,
    stationCount: g.stations.size
  })).sort((a, b) => b.totalActivity - a.totalActivity);
  
  // Top 200 paths by activity (limit for bandwidth)
  const pathArray = Array.from(paths.values())
    .map(p => ({
      from: p.from,
      to: p.to,
      fromLat: p.fromLat,
      fromLon: p.fromLon,
      toLat: p.toLat,
      toLon: p.toLon,
      count: p.count,
      avgSnr: p.snrCount > 0 ? Math.round(p.snrSum / p.snrCount) : null,
      bands: p.bands
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 200);
  
  // Band activity summary
  const bandActivity = {};
  for (const spot of spots) {
    if (spot.band) {
      bandActivity[spot.band] = (bandActivity[spot.band] || 0) + 1;
    }
  }
  
  return { 
    grids: gridArray, 
    paths: pathArray, 
    bandActivity,
    totalSpots: spots.length,
    uniqueGrids: gridArray.length,
    uniquePaths: paths.size
  };
}

app.get('/api/wspr/heatmap', async (req, res) => {
  const minutes = parseInt(req.query.minutes) || 30;
  const band = req.query.band || 'all';
  const raw = req.query.raw === 'true';
  const now = Date.now();
  
  // Cache key for this exact query
  const cacheKey = `wspr:${minutes}:${band}:${raw ? 'raw' : 'agg'}`;
  
  // 1. Fresh cache hit — serve immediately
  if (wsprCache.data && 
      wsprCache.data.cacheKey === cacheKey && 
      (now - wsprCache.timestamp) < WSPR_CACHE_TTL) {
    return res.json({ ...wsprCache.data.result, cached: true });
  }
  
  // 2. Backoff active (WSPR uses PSKReporter upstream, shares its backoff)
  if (upstream.isBackedOff('pskreporter')) {
    if (wsprCache.data && wsprCache.data.cacheKey === cacheKey) {
      return res.json({ ...wsprCache.data.result, cached: true, stale: true });
    }
    return res.json({ grids: [], paths: [], totalSpots: 0, minutes, band, format: 'aggregated', backoff: true });
  }
  
  // 3. Stale-while-revalidate: if stale data exists, serve it and refresh in background
  const hasStale = wsprCache.data && wsprCache.data.cacheKey === cacheKey && (now - wsprCache.timestamp) < WSPR_STALE_TTL;
  
  // 4. Deduplicated upstream fetch — WSPR is global data, so all users share ONE in-flight request
  const doFetch = () => upstream.fetch(cacheKey, async () => {
    const flowStartSeconds = -Math.abs(minutes * 60);
    const url = `https://retrieve.pskreporter.info/query?mode=WSPR&flowStartSeconds=${flowStartSeconds}&rronly=1&nolocator=0&appcontact=openhamclock&rptlimit=2000`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'OpenHamClock/15.2.12 (Amateur Radio Dashboard)',
        'Accept': '*/*'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      const backoffSecs = upstream.recordFailure('pskreporter', response.status);
      throw new Error(`HTTP ${response.status} — backing off for ${backoffSecs}s`);
    }
    
    const xml = await response.text();
    const spots = [];
    
    const reportRegex = /<receptionReport[^>]*>/g;
    let match;
    while ((match = reportRegex.exec(xml)) !== null) {
      const report = match[0];
      const getAttr = (name) => {
        const m = report.match(new RegExp(`${name}="([^"]*)"`));
        return m ? m[1] : null;
      };
      
      const receiverCallsign = getAttr('receiverCallsign');
      const receiverLocator = getAttr('receiverLocator');
      const senderCallsign = getAttr('senderCallsign');
      const senderLocator = getAttr('senderLocator');
      const frequency = getAttr('frequency');
      const mode = getAttr('mode');
      const flowStartSecs = getAttr('flowStartSeconds');
      const sNR = getAttr('sNR');
      const power = getAttr('senderPower');
      const distance = getAttr('senderDistance');
      const senderAz = getAttr('senderAzimuth');
      const receiverAz = getAttr('receiverAzimuth');
      const drift = getAttr('drift');
      
      if (receiverCallsign && senderCallsign && senderLocator && receiverLocator) {
        const freq = frequency ? parseInt(frequency) : null;
        const spotBand = freq ? getBandFromHz(freq) : 'Unknown';
        
        if (band !== 'all' && spotBand !== band) continue;
        
        const senderLoc = gridToLatLonSimple(senderLocator);
        const receiverLoc = gridToLatLonSimple(receiverLocator);
        
        if (senderLoc && receiverLoc) {
          const powerWatts = power ? parseFloat(power) : null;
          const powerDbm = powerWatts ? (10 * Math.log10(powerWatts * 1000)).toFixed(0) : null;
          const dist = distance ? parseInt(distance) : null;
          const kPerW = (dist && powerWatts && powerWatts > 0) ? Math.round(dist / powerWatts) : null;
          
          spots.push({
            sender: senderCallsign,
            senderGrid: senderLocator,
            senderLat: senderLoc.lat,
            senderLon: senderLoc.lon,
            receiver: receiverCallsign,
            receiverGrid: receiverLocator,
            receiverLat: receiverLoc.lat,
            receiverLon: receiverLoc.lon,
            freq: freq,
            freqMHz: freq ? (freq / 1000000).toFixed(6) : null,
            band: spotBand,
            snr: sNR ? parseInt(sNR) : null,
            power: powerWatts,
            powerDbm: powerDbm,
            distance: dist,
            senderAz: senderAz ? parseInt(senderAz) : null,
            receiverAz: receiverAz ? parseInt(receiverAz) : null,
            drift: drift ? parseInt(drift) : null,
            kPerW: kPerW,
            timestamp: flowStartSecs ? parseInt(flowStartSecs) * 1000 : Date.now(),
            age: flowStartSecs ? Math.floor((Date.now() / 1000 - parseInt(flowStartSecs)) / 60) : 0
          });
        }
      }
    }
    
    spots.sort((a, b) => b.timestamp - a.timestamp);
    upstream.recordSuccess('pskreporter');
    
    let result;
    if (raw) {
      result = {
        count: spots.length, spots, minutes, band,
        timestamp: new Date().toISOString(), source: 'pskreporter', format: 'raw'
      };
      console.log(`[WSPR Heatmap] Returning ${spots.length} raw spots (${minutes}min, band: ${band})`);
    } else {
      const aggregated = aggregateWSPRByGrid(spots);
      result = {
        ...aggregated, minutes, band,
        timestamp: new Date().toISOString(), source: 'pskreporter', format: 'aggregated'
      };
      console.log(`[WSPR Heatmap] Aggregated ${spots.length} spots → ${aggregated.uniqueGrids} grids, ${aggregated.paths.length} paths (${minutes}min, band: ${band})`);
    }
    
    wsprCache = { data: { result, cacheKey }, timestamp: Date.now() };
    return result;
  });
  
  if (hasStale) {
    // Stale-while-revalidate: respond with stale data now, refresh in background
    doFetch().catch(() => {});
    return res.json({ ...wsprCache.data.result, cached: true, stale: true });
  }
  
  // No stale data — must wait for upstream
  try {
    const result = await doFetch();
    res.json(result);
  } catch (error) {
    // Use stable key for dedup (backoff seconds change every time)
    logErrorOnce('WSPR Heatmap', error.message.replace(/\d+s$/, 'Xs'));
    if (wsprCache.data && wsprCache.data.cacheKey === cacheKey) {
      return res.json({ ...wsprCache.data.result, cached: true, stale: true });
    }
    res.json({ grids: [], paths: [], totalSpots: 0, minutes, band, format: 'aggregated', error: error.message });
  }
});


// ============================================
// SATELLITE TRACKING API
// ============================================

// Comprehensive ham radio satellites - NORAD IDs
// Updated list of active amateur radio satellites and selected weather satellites
const HAM_SATELLITES = {
  // High Priority - Popular FM satellites
  'ISS': { norad: 25544, name: 'ISS (ZARYA)', color: '#00ffff', priority: 1, mode: 'FM/APRS/SSTV' },
  'SO-50': { norad: 27607, name: 'SO-50', color: '#00ff00', priority: 1, mode: 'FM' },
  'AO-91': { norad: 43017, name: 'AO-91 (Fox-1B)', color: '#ff6600', priority: 1, mode: 'FM' },
  'AO-92': { norad: 43137, name: 'AO-92 (Fox-1D)', color: '#ff9900', priority: 1, mode: 'FM/L-band' },
  'PO-101': { norad: 43678, name: 'PO-101 (Diwata-2)', color: '#ff3399', priority: 1, mode: 'FM' },
  
  // Weather Satellites - GOES & METEOR
  //'GOES-18': { norad: 51850, name: 'GOES-18', color: '#66ff66', priority: 1, mode: 'GRB/HRIT/LRIT' },
  //'GOES-19': { norad: 60133, name: 'GOES-19', color: '#33cc33', priority: 1, mode: 'GRB/HRIT/LRIT' },
  'METEOR-M2-3': { norad: 57166, name: 'METEOR M2-3', color: '#FF0000', priority: 1, mode: 'HRPT/LRPT' },
  'METEOR-M2-4': { norad: 59051, name: 'METEOR M2-4', color: '#FF0000', priority: 1, mode: 'HRPT/LRPT' },
  'SUOMI-NPP': { norad: 37849, name: 'SUOMI NPP', color: '#0000FF', priority: 2, mode: 'HRD/SMD' },
  'NOAA-20': { norad: 43013, name: 'NOAA-20 (JPSS-1)', color: '#0000FF', priority: 2, mode: 'HRD/SMD' },
  'NOAA-21': { norad: 54234, name: 'NOAA-21 (JPSS-2)', color: '#0000FF', priority: 2, mode: 'HRD/SMD' },
  
  // Linear Transponder Satellites
  'RS-44': { norad: 44909, name: 'RS-44 (DOSAAF)', color: '#ff0066', priority: 1, mode: 'Linear' },
  'AO-7': { norad: 7530, name: 'AO-7', color: '#ffcc00', priority: 2, mode: 'Linear (daylight)' },
  'FO-29': { norad: 24278, name: 'FO-29 (JAS-2)', color: '#ff6699', priority: 2, mode: 'Linear' },
  'FO-99': { norad: 43937, name: 'FO-99 (NEXUS)', color: '#ff99cc', priority: 2, mode: 'Linear' },
  'JO-97': { norad: 43803, name: 'JO-97 (JY1Sat)', color: '#cc99ff', priority: 2, mode: 'Linear/FM' },
  'XW-2A': { norad: 40903, name: 'XW-2A (CAS-3A)', color: '#66ff99', priority: 2, mode: 'Linear' },
  'XW-2B': { norad: 40911, name: 'XW-2B (CAS-3B)', color: '#66ffcc', priority: 2, mode: 'Linear' },
  'XW-2C': { norad: 40906, name: 'XW-2C (CAS-3C)', color: '#99ffcc', priority: 2, mode: 'Linear' },
  'XW-2D': { norad: 40907, name: 'XW-2D (CAS-3D)', color: '#99ff99', priority: 2, mode: 'Linear' },
  'XW-2E': { norad: 40909, name: 'XW-2E (CAS-3E)', color: '#ccff99', priority: 2, mode: 'Linear' },
  'XW-2F': { norad: 40910, name: 'XW-2F (CAS-3F)', color: '#ccffcc', priority: 2, mode: 'Linear' },
  
  // CAS (Chinese Amateur Satellites)
  'CAS-4A': { norad: 42761, name: 'CAS-4A', color: '#9966ff', priority: 2, mode: 'Linear' },
  'CAS-4B': { norad: 42759, name: 'CAS-4B', color: '#9933ff', priority: 2, mode: 'Linear' },
  'CAS-6': { norad: 44881, name: 'CAS-6 (TO-108)', color: '#cc66ff', priority: 2, mode: 'Linear' },
  
  // GreenCube / IO satellites
  'IO-117': { norad: 53106, name: 'IO-117 (GreenCube)', color: '#00ff99', priority: 2, mode: 'Digipeater' },
  
  // TEVEL constellation
  'TEVEL-1': { norad: 50988, name: 'TEVEL-1', color: '#66ccff', priority: 3, mode: 'FM' },
  'TEVEL-2': { norad: 50989, name: 'TEVEL-2', color: '#66ddff', priority: 3, mode: 'FM' },
  'TEVEL-3': { norad: 50994, name: 'TEVEL-3', color: '#66eeff', priority: 3, mode: 'FM' },
  'TEVEL-4': { norad: 50998, name: 'TEVEL-4', color: '#77ccff', priority: 3, mode: 'FM' },
  'TEVEL-5': { norad: 51062, name: 'TEVEL-5', color: '#77ddff', priority: 3, mode: 'FM' },
  'TEVEL-6': { norad: 51063, name: 'TEVEL-6', color: '#77eeff', priority: 3, mode: 'FM' },
  'TEVEL-7': { norad: 51069, name: 'TEVEL-7', color: '#88ccff', priority: 3, mode: 'FM' },
  'TEVEL-8': { norad: 51084, name: 'TEVEL-8', color: '#88ddff', priority: 3, mode: 'FM' },
  
  // OSCAR satellites
  'AO-27': { norad: 22825, name: 'AO-27', color: '#ff9966', priority: 3, mode: 'FM' },
  'AO-73': { norad: 39444, name: 'AO-73 (FUNcube-1)', color: '#ffcc66', priority: 3, mode: 'Linear/Telemetry' },
  'EO-88': { norad: 42017, name: 'EO-88 (Nayif-1)', color: '#ffaa66', priority: 3, mode: 'Linear/Telemetry' },
  
  // Russian satellites
  'RS-15': { norad: 23439, name: 'RS-15', color: '#ff6666', priority: 3, mode: 'Linear' },
  
  // QO-100 (Geostationary - special)
  'QO-100': { norad: 43700, name: 'QO-100 (Es\'hail-2)', color: '#ffff00', priority: 1, mode: 'Linear (GEO)' },
  
  // APRS Digipeaters
  'ARISS': { norad: 25544, name: 'ARISS (ISS)', color: '#00ffff', priority: 1, mode: 'APRS' },
  
  // Cubesats with amateur payloads
  'UVSQ-SAT': { norad: 47438, name: 'UVSQ-SAT', color: '#ff66ff', priority: 4, mode: 'Telemetry' },
  'MEZNSAT': { norad: 46489, name: 'MeznSat', color: '#66ff66', priority: 4, mode: 'Telemetry' },
  
  // SSTV/Slow Scan
  'SSTV-ISS': { norad: 25544, name: 'ISS SSTV', color: '#00ffff', priority: 2, mode: 'SSTV' }
};

// Cache for TLE data (refresh every 6 hours)
let tleCache = { data: null, timestamp: 0 };
const TLE_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

app.get('/api/satellites/tle', async (req, res) => {
  try {
    const now = Date.now();
    // Return cached data if fresh (6-hour window)
    if (tleCache.data && (now - tleCache.timestamp) < TLE_CACHE_DURATION) {
      return res.json(tleCache.data);
    }

    logDebug('[Satellites] Fetching fresh TLE data from multiple groups...');
    const tleData = {}; // Declare this exactly once to avoid SyntaxErrors
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // This list tells the server to look in all three CelesTrak folders
    const groups = ['amateur', 'weather', 'goes']; 

    for (const group of groups) {
      try {
        const response = await fetch(
          `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
          { headers: { 'User-Agent': 'OpenHamClock/3.3' }, signal: controller.signal }
        );

        if (response.ok) {
          const text = await response.text();
          const lines = text.trim().split('\n');
          // Parse 3 lines per satellite: Name, Line 1, Line 2
          for (let i = 0; i < lines.length - 2; i += 3) {
            const name = lines[i]?.trim();
            const line1 = lines[i + 1]?.trim();
            const line2 = lines[i + 2]?.trim();
            if (name && line1 && line1.startsWith('1 ')) {
              const noradId = parseInt(line1.substring(2, 7));
              
              // Skip if this NORAD ID already exists (prevent duplicates)
              const alreadyExists = Object.values(tleData).some(sat => sat.norad === noradId);
              if (alreadyExists) continue;
              
              // Create a sanitized key from the satellite name
              const key = name.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
              
              // Check if we have metadata in HAM_SATELLITES
              const hamSat = Object.values(HAM_SATELLITES).find(s => s.norad === noradId);
              
              if (hamSat) {
                // Use defined metadata from HAM_SATELLITES
                tleData[key] = { ...hamSat, tle1: line1, tle2: line2 };
              } else {
                // Include all satellites with default metadata
                tleData[key] = {
                  norad: noradId,
                  name: name,
                  color: '#cccccc',
                  priority: group === 'amateur' ? 3 : 4,
                  mode: 'Unknown',
                  tle1: line1,
                  tle2: line2
                };
              }
            }
          }
        }
      } catch (e) {
        logDebug(`[Satellites] Failed to fetch group: ${group}`);
      }
    }
    clearTimeout(timeout);

    // Check if ISS (NORAD 25544) was already added with any key
    const issExists = Object.values(tleData).some(sat => sat.norad === 25544);
    
    // Fallback for ISS if it wasn't found in the groups above
    if (!issExists) {
      try {
        const issRes = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle');
        if (issRes.ok) {
          const issText = await issRes.text();
          const issLines = issText.trim().split('\n');
          if (issLines.length >= 3) {
            tleData['ISS'] = { ...HAM_SATELLITES['ISS'], tle1: issLines[1].trim(), tle2: issLines[2].trim() };
          }
        }
      } catch (e) { logDebug('[Satellites] ISS fallback failed'); }
    }

    tleCache = { data: tleData, timestamp: now };
    res.json(tleData);
  } catch (error) {
    // Return stale cache or empty if everything fails
    res.json(tleCache.data || {});
  }
});

// ============================================
// IONOSONDE DATA API (Real-time ionospheric data from KC2G/GIRO)
// ============================================

// Cache for ionosonde data (refresh every 10 minutes)
let ionosondeCache = {
  data: null,
  timestamp: 0,
  maxAge: 10 * 60 * 1000 // 10 minutes
};

// Fetch real-time ionosonde data from KC2G (GIRO network)
async function fetchIonosondeData() {
  const now = Date.now();
  
  // Return cached data if fresh
  if (ionosondeCache.data && (now - ionosondeCache.timestamp) < ionosondeCache.maxAge) {
    return ionosondeCache.data;
  }
  
  try {
    const response = await fetch('https://prop.kc2g.com/api/stations.json', {
      headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
      timeout: 15000
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    // Filter to only recent data (within last 2 hours) with valid readings
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const validStations = data.filter(s => {
      if (!s.fof2 || !s.station) return false;
      const stationTime = new Date(s.time);
      return stationTime > twoHoursAgo && s.cs > 0; // confidence score > 0
    }).map(s => ({
      code: s.station.code,
      name: s.station.name,
      lat: parseFloat(s.station.latitude),
      lon: parseFloat(s.station.longitude) > 180 ? parseFloat(s.station.longitude) - 360 : parseFloat(s.station.longitude),
      foF2: s.fof2,
      mufd: s.mufd, // MUF at 3000km
      hmF2: s.hmf2, // Height of F2 layer
      md: parseFloat(s.md) || 3.0, // M(3000)F2 factor
      confidence: s.cs,
      time: s.time
    }));
    
    ionosondeCache = {
      data: validStations,
      timestamp: now
    };
    
    logDebug(`[Ionosonde] Fetched ${validStations.length} valid stations from KC2G`);
    return validStations;
    
  } catch (error) {
    logErrorOnce('Ionosonde', `Fetch error: ${error.message}`);
    return ionosondeCache.data || [];
  }
}

// API endpoint to get ionosonde data
app.get('/api/ionosonde', async (req, res) => {
  try {
    const stations = await fetchIonosondeData();
    res.json({
      count: stations.length,
      timestamp: new Date().toISOString(),
      stations: stations
    });
  } catch (error) {
    logErrorOnce('Ionosonde', `API: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch ionosonde data' });
  }
});

// Calculate distance between two points in km
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Interpolate foF2 at a given location using inverse distance weighting
function interpolateFoF2(lat, lon, stations) {
  if (!stations || stations.length === 0) return null;
  
  // Maximum distance (km) to consider ionosonde data valid
  // Beyond this, the data is too far away to be representative
  const MAX_VALID_DISTANCE = 3000; // km
  
  // Calculate distances to all stations
  const stationsWithDist = stations.map(s => ({
    ...s,
    distance: haversineDistance(lat, lon, s.lat, s.lon)
  })).filter(s => s.foF2 > 0);
  
  if (stationsWithDist.length === 0) return null;
  
  // Sort by distance and take nearest 5
  stationsWithDist.sort((a, b) => a.distance - b.distance);
  
  // Check if nearest station is within valid range
  if (stationsWithDist[0].distance > MAX_VALID_DISTANCE) {
    logDebug(`[Ionosonde] Nearest station ${stationsWithDist[0].name} is ${Math.round(stationsWithDist[0].distance)}km away - too far, using estimates`);
    return {
      foF2: null,
      mufd: null,
      hmF2: null,
      md: 3.0,
      nearestStation: stationsWithDist[0].name,
      nearestDistance: Math.round(stationsWithDist[0].distance),
      stationsUsed: 0,
      method: 'no-coverage',
      reason: `Nearest ionosonde (${stationsWithDist[0].name}) is ${Math.round(stationsWithDist[0].distance)}km away - no local coverage`
    };
  }
  
  // Filter to only stations within valid range
  const validStations = stationsWithDist.filter(s => s.distance <= MAX_VALID_DISTANCE);
  const nearest = validStations.slice(0, 5);
  
  // If very close to a station, use its value directly
  if (nearest[0].distance < 100) {
    return {
      foF2: nearest[0].foF2,
      mufd: nearest[0].mufd,
      hmF2: nearest[0].hmF2,
      md: nearest[0].md,
      source: nearest[0].name,
      confidence: nearest[0].confidence,
      nearestDistance: Math.round(nearest[0].distance),
      method: 'direct'
    };
  }
  
  // Inverse distance weighted interpolation
  let sumWeights = 0;
  let sumFoF2 = 0;
  let sumMufd = 0;
  let sumHmF2 = 0;
  let sumMd = 0;
  
  nearest.forEach(s => {
    const weight = (s.confidence / 100) / Math.pow(s.distance, 2);
    sumWeights += weight;
    sumFoF2 += s.foF2 * weight;
    if (s.mufd) sumMufd += s.mufd * weight;
    if (s.hmF2) sumHmF2 += s.hmF2 * weight;
    if (s.md) sumMd += s.md * weight;
  });
  
  return {
    foF2: sumFoF2 / sumWeights,
    mufd: sumMufd > 0 ? sumMufd / sumWeights : null,
    hmF2: sumHmF2 > 0 ? sumHmF2 / sumWeights : null,
    md: sumMd > 0 ? sumMd / sumWeights : 3.0,
    nearestStation: nearest[0].name,
    nearestDistance: Math.round(nearest[0].distance),
    stationsUsed: nearest.length,
    method: 'interpolated'
  };
}

// ============================================
// HYBRID PROPAGATION SYSTEM
// Combines ITURHFProp (ITU-R P.533-14) with real-time ionosonde data
// ============================================

// Cache for ITURHFProp predictions (5-minute cache)
let iturhfpropCache = {
  data: null,
  key: null,
  timestamp: 0,
  maxAge: 5 * 60 * 1000  // 5 minutes
};

/**
 * Fetch base prediction from ITURHFProp service
 */
async function fetchITURHFPropPrediction(txLat, txLon, rxLat, rxLon, ssn, month, hour) {
  if (!ITURHFPROP_URL) return null;
  
  const cacheKey = `${txLat.toFixed(1)},${txLon.toFixed(1)}-${rxLat.toFixed(1)},${rxLon.toFixed(1)}-${ssn}-${month}-${hour}`;
  const now = Date.now();
  
  // Check cache
  if (iturhfpropCache.key === cacheKey && (now - iturhfpropCache.timestamp) < iturhfpropCache.maxAge) {
    return iturhfpropCache.data;
  }
  
  try {
    const url = `${ITURHFPROP_URL}/api/bands?txLat=${txLat}&txLon=${txLon}&rxLat=${rxLat}&rxLon=${rxLon}&ssn=${ssn}&month=${month}&hour=${hour}`;
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      logErrorOnce('Hybrid', `ITURHFProp returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    // Only log success occasionally to reduce noise
    
    // Cache the result
    iturhfpropCache = {
      data,
      key: cacheKey,
      timestamp: now,
      maxAge: iturhfpropCache.maxAge
    };
    
    return data;
  } catch (err) {
    if (err.name !== 'AbortError') {
      logErrorOnce('Hybrid', `ITURHFProp: ${err.message}`);
    }
    return null;
  }
}

/**
 * Fetch 24-hour predictions from ITURHFProp
 */
async function fetchITURHFPropHourly(txLat, txLon, rxLat, rxLon, ssn, month) {
  if (!ITURHFPROP_URL) return null;
  
  try {
    const url = `${ITURHFPROP_URL}/api/predict/hourly?txLat=${txLat}&txLon=${txLon}&rxLat=${rxLat}&rxLon=${rxLon}&ssn=${ssn}&month=${month}`;
    
    const response = await fetch(url, { timeout: 60000 }); // 60s timeout for 24-hour calc
    if (!response.ok) return null;
    
    const data = await response.json();
    return data;
  } catch (err) {
    if (err.name !== 'AbortError') {
      logErrorOnce('Hybrid', `ITURHFProp hourly: ${err.message}`);
    }
    return null;
  }
}

/**
 * Calculate ionospheric correction factor
 * Compares expected foF2 (from P.533 model) vs actual ionosonde foF2
 * Returns multiplier to adjust reliability predictions
 */
function calculateIonoCorrection(expectedFoF2, actualFoF2, kIndex) {
  if (!expectedFoF2 || !actualFoF2) return { factor: 1.0, confidence: 'low' };
  
  // Ratio of actual to expected ionospheric conditions
  const ratio = actualFoF2 / expectedFoF2;
  
  // Geomagnetic correction (storms reduce reliability)
  const kFactor = kIndex <= 3 ? 1.0 : 1.0 - (kIndex - 3) * 0.1;
  
  // Combined correction factor
  // ratio > 1 means better conditions than predicted
  // ratio < 1 means worse conditions than predicted
  const factor = ratio * kFactor;
  
  // Confidence based on how close actual is to expected
  let confidence;
  if (Math.abs(ratio - 1) < 0.15) {
    confidence = 'high';  // Within 15% - model is accurate
  } else if (Math.abs(ratio - 1) < 0.3) {
    confidence = 'medium'; // Within 30%
  } else {
    confidence = 'low';    // Model significantly off - rely more on ionosonde
  }
  
  logDebug(`[Hybrid] Correction factor: ${factor.toFixed(2)} (expected foF2: ${expectedFoF2.toFixed(1)}, actual: ${actualFoF2.toFixed(1)}, K: ${kIndex})`);
  
  return { factor, confidence, ratio, kFactor };
}

/**
 * Apply ionospheric correction to ITURHFProp predictions
 */
function applyHybridCorrection(iturhfpropData, ionoData, kIndex, sfi) {
  if (!iturhfpropData?.bands) return null;
  
  // Estimate what foF2 ITURHFProp expected (based on SSN/SFI)
  const ssn = Math.max(0, Math.round((sfi - 67) / 0.97));
  const expectedFoF2 = 0.9 * Math.sqrt(ssn + 15) * 1.2; // Rough estimate at solar noon
  
  // Get actual foF2 from ionosonde
  const actualFoF2 = ionoData?.foF2;
  
  // Calculate correction
  const correction = calculateIonoCorrection(expectedFoF2, actualFoF2, kIndex);
  
  // Apply correction to each band
  const correctedBands = {};
  for (const [band, data] of Object.entries(iturhfpropData.bands)) {
    const baseReliability = data.reliability || 50;
    
    // Apply correction factor with bounds
    let correctedReliability = baseReliability * correction.factor;
    correctedReliability = Math.max(0, Math.min(100, correctedReliability));
    
    // For high bands, also check if we're above/below MUF
    const freq = data.freq;
    if (actualFoF2 && freq > actualFoF2 * 3.5) {
      // Frequency likely above MUF - reduce reliability
      correctedReliability *= 0.5;
    }
    
    correctedBands[band] = {
      ...data,
      reliability: Math.round(correctedReliability),
      baseReliability: Math.round(baseReliability),
      correctionApplied: correction.factor !== 1.0,
      status: correctedReliability >= 70 ? 'GOOD' : 
              correctedReliability >= 40 ? 'FAIR' : 'POOR'
    };
  }
  
  // Correct MUF based on actual ionosonde data
  let correctedMuf = iturhfpropData.muf;
  if (actualFoF2 && ionoData?.md) {
    // Use actual foF2 * M-factor for more accurate MUF
    const ionoMuf = actualFoF2 * (ionoData.md || 3.0);
    // Blend ITURHFProp MUF with ionosonde-derived MUF
    correctedMuf = (iturhfpropData.muf * 0.4) + (ionoMuf * 0.6);
  }
  
  return {
    bands: correctedBands,
    muf: Math.round(correctedMuf * 10) / 10,
    correction,
    model: 'Hybrid ITU-R P.533-14'
  };
}

/**
 * Estimate expected foF2 from P.533 model for a given hour
 */
function estimateExpectedFoF2(ssn, lat, hour) {
  // Simplified P.533 foF2 estimation
  // diurnal variation: peak around 14:00 local, minimum around 04:00
  const hourFactor = 0.6 + 0.4 * Math.cos((hour - 14) * Math.PI / 12);
  const latFactor = 1 - Math.abs(lat) / 150;
  const ssnFactor = Math.sqrt(ssn + 15);
  
  return 0.9 * ssnFactor * hourFactor * latFactor;
}

// ============================================
// ENHANCED PROPAGATION PREDICTION API (Hybrid ITU-R P.533)
// ============================================

app.get('/api/propagation', async (req, res) => {
  const { deLat, deLon, dxLat, dxLon, mode, power } = req.query;
  
  // Calculate signal margin from mode + power
  const txMode = (mode || 'SSB').toUpperCase();
  const txPower = parseFloat(power) || 100;
  const signalMarginDb = calculateSignalMargin(txMode, txPower);
  
  const useHybrid = ITURHFPROP_URL !== null;
  logDebug(`[Propagation] ${useHybrid ? 'Hybrid' : 'Standalone'} calculation for DE:`, deLat, deLon, 'to DX:', dxLat, dxLon, `[${txMode} @ ${txPower}W, margin: ${signalMarginDb.toFixed(1)}dB]`);
  
  try {
    // Get current space weather data
    let sfi = 150, ssn = 100, kIndex = 2, aIndex = 10;
    
    try {
      // Prefer SWPC summary (updates every few hours) + N0NBH for SSN
      const [summaryRes, kRes] = await Promise.allSettled([
        fetch('https://services.swpc.noaa.gov/products/summary/10cm-flux.json'),
        fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json')
      ]);
      
      if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
        try {
          const summary = await summaryRes.value.json();
          const flux = parseInt(summary?.Flux);
          if (flux > 0) sfi = flux;
        } catch {}
      }
      // Fallback: N0NBH cache (daily, same as hamqsl.com)
      if (sfi === 150 && n0nbhCache.data?.solarData?.solarFlux) {
        const flux = parseInt(n0nbhCache.data.solarData.solarFlux);
        if (flux > 0) sfi = flux;
      }
      // SSN: prefer N0NBH (daily), then estimate from SFI
      if (n0nbhCache.data?.solarData?.sunspots) {
        const s = parseInt(n0nbhCache.data.solarData.sunspots);
        if (s >= 0) ssn = s;
      } else {
        ssn = Math.max(0, Math.round((sfi - 67) / 0.97));
      }
      if (kRes.status === 'fulfilled' && kRes.value.ok) {
        const data = await kRes.value.json();
        if (data?.length > 1) kIndex = parseInt(data[data.length - 1][1]) || 2;
      }
    } catch (e) {
      logDebug('[Propagation] Using default solar values');
    }
    
    // Get real ionosonde data
    const ionosondeStations = await fetchIonosondeData();
    
    // Calculate path geometry
    const de = { lat: parseFloat(deLat) || 40, lon: parseFloat(deLon) || -75 };
    const dx = { lat: parseFloat(dxLat) || 35, lon: parseFloat(dxLon) || 139 };
    
    const distance = haversineDistance(de.lat, de.lon, dx.lat, dx.lon);
    const midLat = (de.lat + dx.lat) / 2;
    let midLon = (de.lon + dx.lon) / 2;
    
    // Handle antimeridian crossing
    if (Math.abs(de.lon - dx.lon) > 180) {
      midLon = (de.lon + dx.lon + 360) / 2;
      if (midLon > 180) midLon -= 360;
    }
    
    // Get ionospheric data at path midpoint
    const ionoData = interpolateFoF2(midLat, midLon, ionosondeStations);
    const hasValidIonoData = !!(ionoData && ionoData.method !== 'no-coverage' && ionoData.foF2);
    
    const currentHour = new Date().getUTCHours();
    const currentMonth = new Date().getMonth() + 1;
    
    logDebug('[Propagation] Distance:', Math.round(distance), 'km');
    logDebug('[Propagation] Solar: SFI', sfi, 'SSN', ssn, 'K', kIndex);
    if (hasValidIonoData) {
      logDebug('[Propagation] Real foF2:', ionoData.foF2?.toFixed(2), 'MHz from', ionoData.nearestStation || ionoData.source);
    }
    
    // ===== HYBRID MODE: Try ITURHFProp first =====
    let hybridResult = null;
    if (useHybrid) {
      const iturhfpropData = await fetchITURHFPropPrediction(
        de.lat, de.lon, dx.lat, dx.lon, ssn, currentMonth, currentHour
      );
      
      if (iturhfpropData && hasValidIonoData) {
        // Full hybrid: ITURHFProp + ionosonde correction
        hybridResult = applyHybridCorrection(iturhfpropData, ionoData, kIndex, sfi);
        logDebug('[Propagation] Using HYBRID mode (ITURHFProp + ionosonde correction)');
      } else if (iturhfpropData) {
        // ITURHFProp only (no ionosonde coverage)
        hybridResult = {
          bands: iturhfpropData.bands,
          muf: iturhfpropData.muf,
          model: 'ITU-R P.533-14 (ITURHFProp)'
        };
        logDebug('[Propagation] Using ITURHFProp only (no ionosonde coverage)');
      }
    }
    
    // ===== FALLBACK: Built-in calculations =====
    const bands = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];
    const bandFreqs = [1.8, 3.5, 7, 10, 14, 18, 21, 24, 28];
    
    // Generate predictions (hybrid or fallback)
    const effectiveIonoData = hasValidIonoData ? ionoData : null;
    const predictions = {};
    let currentBands;
    
    if (hybridResult) {
      // Use hybrid results for current bands
      currentBands = bands.map((band, idx) => {
        const hybridBand = hybridResult.bands?.[band];
        if (hybridBand) {
          return {
            band,
            freq: bandFreqs[idx],
            reliability: hybridBand.reliability,
            baseReliability: hybridBand.baseReliability,
            snr: calculateSNR(hybridBand.reliability),
            status: hybridBand.status,
            corrected: hybridBand.correctionApplied
          };
        }
        // Fallback for bands not in hybrid result
        const reliability = calculateEnhancedReliability(
          bandFreqs[idx], distance, midLat, midLon, currentHour, sfi, ssn, kIndex, de, dx, effectiveIonoData, currentHour, signalMarginDb
        );
        return {
          band,
          freq: bandFreqs[idx],
          reliability: Math.round(reliability),
          snr: calculateSNR(reliability),
          status: getStatus(reliability)
        };
      }).sort((a, b) => b.reliability - a.reliability);
      
      // Generate 24-hour predictions with correction ratios from hybrid data
      // This makes predictions more accurate by scaling them to match the hybrid model
      bands.forEach((band, idx) => {
        const freq = bandFreqs[idx];
        predictions[band] = [];
        
        // Calculate built-in reliability for current hour
        const builtInCurrentReliability = calculateEnhancedReliability(
          freq, distance, midLat, midLon, currentHour, sfi, ssn, kIndex, de, dx, effectiveIonoData, currentHour, signalMarginDb
        );
        
        // Get hybrid reliability for this band (the accurate one)
        const hybridBand = hybridResult.bands?.[band];
        const hybridReliability = hybridBand?.reliability || builtInCurrentReliability;
        
        // Calculate correction ratio (how much to scale predictions)
        // Avoid division by zero, and cap the ratio to prevent extreme corrections
        let correctionRatio = 1.0;
        if (builtInCurrentReliability > 5) {
          correctionRatio = hybridReliability / builtInCurrentReliability;
          // Cap correction ratio to reasonable bounds (0.2x to 3x)
          correctionRatio = Math.max(0.2, Math.min(3.0, correctionRatio));
        } else if (hybridReliability > 20) {
          // Built-in thinks band is closed but hybrid says it's open
          correctionRatio = 2.0;
        }
        
        for (let hour = 0; hour < 24; hour++) {
          const baseReliability = calculateEnhancedReliability(
            freq, distance, midLat, midLon, hour, sfi, ssn, kIndex, de, dx, effectiveIonoData, currentHour, signalMarginDb
          );
          // Apply correction ratio and clamp to valid range
          const correctedReliability = Math.min(99, Math.max(0, Math.round(baseReliability * correctionRatio)));
          predictions[band].push({
            hour,
            reliability: correctedReliability,
            snr: calculateSNR(correctedReliability)
          });
        }
      });
      
    } else {
      // Full fallback - use built-in calculations
      logDebug('[Propagation] Using FALLBACK mode (built-in calculations)');
      
      bands.forEach((band, idx) => {
        const freq = bandFreqs[idx];
        predictions[band] = [];
        for (let hour = 0; hour < 24; hour++) {
          const reliability = calculateEnhancedReliability(
            freq, distance, midLat, midLon, hour, sfi, ssn, kIndex, de, dx, effectiveIonoData, currentHour, signalMarginDb
          );
          predictions[band].push({
            hour,
            reliability: Math.round(reliability),
            snr: calculateSNR(reliability)
          });
        }
      });
      
      currentBands = bands.map((band, idx) => ({
        band,
        freq: bandFreqs[idx],
        reliability: predictions[band][currentHour].reliability,
        snr: predictions[band][currentHour].snr,
        status: getStatus(predictions[band][currentHour].reliability)
      })).sort((a, b) => b.reliability - a.reliability);
    }
    
    // Calculate MUF and LUF
    const currentMuf = hybridResult?.muf || calculateMUF(distance, midLat, midLon, currentHour, sfi, ssn, effectiveIonoData);
    const currentLuf = calculateLUF(distance, midLat, currentHour, sfi, kIndex);
    
    // Build ionospheric response
    let ionosphericResponse;
    if (hasValidIonoData) {
      ionosphericResponse = {
        foF2: ionoData.foF2?.toFixed(2),
        mufd: ionoData.mufd?.toFixed(1),
        hmF2: ionoData.hmF2?.toFixed(0),
        source: ionoData.nearestStation || ionoData.source,
        distance: ionoData.nearestDistance,
        method: ionoData.method,
        stationsUsed: ionoData.stationsUsed || 1
      };
    } else if (ionoData?.method === 'no-coverage') {
      ionosphericResponse = {
        source: 'No ionosonde coverage',
        reason: ionoData.reason,
        nearestStation: ionoData.nearestStation,
        nearestDistance: ionoData.nearestDistance,
        method: 'estimated'
      };
    } else {
      ionosphericResponse = { source: 'model', method: 'estimated' };
    }
    
    // Determine data source description
    let dataSource;
    if (hybridResult && hasValidIonoData) {
      dataSource = 'Hybrid: ITURHFProp (ITU-R P.533-14) + KC2G/GIRO ionosonde';
    } else if (hybridResult) {
      dataSource = 'ITURHFProp (ITU-R P.533-14)';
    } else if (hasValidIonoData) {
      dataSource = 'KC2G/GIRO Ionosonde Network';
    } else {
      dataSource = 'Estimated from solar indices';
    }
    
    res.json({
      model: hybridResult?.model || 'Built-in estimation',
      solarData: { sfi, ssn, kIndex },
      ionospheric: ionosphericResponse,
      muf: Math.round(currentMuf * 10) / 10,
      luf: Math.round(currentLuf * 10) / 10,
      distance: Math.round(distance),
      currentHour,
      currentBands,
      hourlyPredictions: predictions,
      mode: txMode,
      power: txPower,
      signalMargin: Math.round(signalMarginDb * 10) / 10,
      hybrid: {
        enabled: useHybrid,
        iturhfpropAvailable: hybridResult !== null,
        ionosondeAvailable: hasValidIonoData,
        correctionFactor: hybridResult?.correction?.factor?.toFixed(2),
        confidence: hybridResult?.correction?.confidence
      },
      dataSource
    });
    
  } catch (error) {
    logErrorOnce('Propagation', error.message);
    res.status(500).json({ error: 'Failed to calculate propagation' });
  }
});

// Legacy endpoint removed - merged into /api/propagation above

// ===== PROPAGATION HEATMAP =====
// Computes reliability grid from DE location to world grid for a selected band
// Used by VOACAP Heatmap map layer plugin
const PROP_HEATMAP_CACHE = {};
const PROP_HEATMAP_TTL = 5 * 60 * 1000; // 5 minutes

app.get('/api/propagation/heatmap', async (req, res) => {
  const deLat = parseFloat(req.query.deLat) || 0;
  const deLon = parseFloat(req.query.deLon) || 0;
  const freq = parseFloat(req.query.freq) || 14; // MHz, default 20m
  const gridSize = Math.max(5, Math.min(20, parseInt(req.query.grid) || 10)); // 5-20° grid
  const txMode = (req.query.mode || 'SSB').toUpperCase();
  const txPower = parseFloat(req.query.power) || 100;
  const signalMarginDb = calculateSignalMargin(txMode, txPower);
  
  const cacheKey = `${deLat.toFixed(0)}:${deLon.toFixed(0)}:${freq}:${gridSize}:${txMode}:${txPower}`;
  const now = Date.now();
  
  if (PROP_HEATMAP_CACHE[cacheKey] && (now - PROP_HEATMAP_CACHE[cacheKey].ts) < PROP_HEATMAP_TTL) {
    return res.json(PROP_HEATMAP_CACHE[cacheKey].data);
  }
  
  try {
    // Fetch current solar conditions (same as main propagation endpoint)
    let sfi = 150, ssn = 100, kIndex = 2;
    try {
      const [fluxRes, kRes] = await Promise.allSettled([
        fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json'),
        fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json')
      ]);
      if (fluxRes.status === 'fulfilled' && fluxRes.value.ok) {
        const data = await fluxRes.value.json();
        if (data?.length) sfi = Math.round(data[data.length - 1].flux || 150);
      }
      if (kRes.status === 'fulfilled' && kRes.value.ok) {
        const data = await kRes.value.json();
        if (data?.length > 1) kIndex = parseInt(data[data.length - 1][1]) || 2;
      }
      ssn = Math.max(0, Math.round((sfi - 67) / 0.97));
    } catch (e) {
      logDebug('[PropHeatmap] Using default solar values');
    }
    
    const currentHour = new Date().getUTCHours();
    const de = { lat: deLat, lon: deLon };
    const halfGrid = gridSize / 2;
    const cells = [];
    
    // Compute reliability grid
    for (let lat = -85 + halfGrid; lat <= 85 - halfGrid; lat += gridSize) {
      for (let lon = -180 + halfGrid; lon <= 180 - halfGrid; lon += gridSize) {
        const dx = { lat, lon };
        const distance = haversineDistance(de.lat, de.lon, lat, lon);
        
        // Skip very short distances (< 200km) - not meaningful for HF skip
        if (distance < 200) continue;
        
        const midLat = (de.lat + lat) / 2;
        let midLon = (de.lon + lon) / 2;
        if (Math.abs(de.lon - lon) > 180) {
          midLon = (de.lon + lon + 360) / 2;
          if (midLon > 180) midLon -= 360;
        }
        
        const reliability = calculateEnhancedReliability(
          freq, distance, midLat, midLon, currentHour,
          sfi, ssn, kIndex, de, dx, null, currentHour, signalMarginDb
        );
        
        cells.push({
          lat,
          lon,
          r: Math.round(reliability) // reliability 0-99
        });
      }
    }
    
    const result = {
      deLat, deLon, freq, gridSize,
      mode: txMode, power: txPower, signalMargin: Math.round(signalMarginDb * 10) / 10,
      solarData: { sfi, ssn, kIndex },
      hour: currentHour,
      cells,
      timestamp: new Date().toISOString()
    };
    
    PROP_HEATMAP_CACHE[cacheKey] = { data: result, ts: now };
    
    logDebug(`[PropHeatmap] Computed ${cells.length} cells for ${freq} MHz [${txMode} @ ${txPower}W] from ${deLat.toFixed(1)},${deLon.toFixed(1)}`);
    res.json(result);
    
  } catch (error) {
    logErrorOnce('PropHeatmap', error.message);
    res.status(500).json({ error: 'Failed to compute propagation heatmap' });
  }
});

// Calculate MUF using real ionosonde data or model
function calculateMUF(distance, midLat, midLon, hour, sfi, ssn, ionoData) {
  // If we have real MUF(3000) data, scale it for actual distance
  if (ionoData?.mufd) {
    // MUF scales with distance: MUF(d) ≈ MUF(3000) * sqrt(3000/d) for d < 3000km
    // For d > 3000km, MUF(d) ≈ MUF(3000) * (1 + 0.1 * log(d/3000))
    if (distance < 3000) {
      return ionoData.mufd * Math.sqrt(distance / 3000);
    } else {
      return ionoData.mufd * (1 + 0.15 * Math.log10(distance / 3000));
    }
  }
  
  // If we have foF2, calculate MUF using M(3000)F2 factor
  if (ionoData?.foF2) {
    const M = ionoData.md || 3.0; // M(3000)F2 factor, typically 2.5-3.5
    const muf3000 = ionoData.foF2 * M;
    
    // Scale for actual distance
    if (distance < 3000) {
      return muf3000 * Math.sqrt(distance / 3000);
    } else {
      return muf3000 * (1 + 0.15 * Math.log10(distance / 3000));
    }
  }
  
  // Fallback: Estimate foF2 from solar indices
  // foF2 ≈ 0.9 * sqrt(SSN + 15) * diurnal_factor
  const hourFactor = 1 + 0.4 * Math.cos((hour - 14) * Math.PI / 12); // Peak at 14:00 local
  const latFactor = 1 - Math.abs(midLat) / 150; // Higher latitudes = lower foF2
  const foF2_est = 0.9 * Math.sqrt(ssn + 15) * hourFactor * latFactor;
  
  // Standard M(3000)F2 factor
  const M = 3.0;
  const muf3000 = foF2_est * M;
  
  // Scale for distance
  if (distance < 3000) {
    return muf3000 * Math.sqrt(distance / 3000);
  } else {
    return muf3000 * (1 + 0.15 * Math.log10(distance / 3000));
  }
}

// Calculate LUF (Lowest Usable Frequency) based on D-layer absorption
function calculateLUF(distance, midLat, hour, sfi, kIndex) {
  // LUF increases with:
  // - Higher solar flux (more D-layer ionization)
  // - Daytime (D-layer forms during day)
  // - Shorter paths (higher elevation angles = more time in D-layer)
  // - Geomagnetic activity
  
  // Local solar time at midpoint (approximate)
  const localHour = hour; // Would need proper calculation with midLon
  
  // Day/night factor: D-layer absorption is much higher during daytime
  let dayFactor = 0.3; // Night
  if (localHour >= 6 && localHour <= 18) {
    // Daytime - peaks around noon
    dayFactor = 0.5 + 0.5 * Math.cos((localHour - 12) * Math.PI / 6);
  }
  
  // Solar flux factor: higher SFI = more absorption
  const sfiFactor = 1 + (sfi - 70) / 200;
  
  // Distance factor: shorter paths have higher LUF (higher angles)
  const distFactor = Math.max(0.5, 1 - distance / 10000);
  
  // Latitude factor: polar paths have more absorption
  const latFactor = 1 + Math.abs(midLat) / 90 * 0.5;
  
  // K-index: geomagnetic storms increase absorption
  const kFactor = 1 + kIndex * 0.1;
  
  // Base LUF is around 2 MHz for long night paths
  const baseLuf = 2.0;
  
  return baseLuf * dayFactor * sfiFactor * distFactor * latFactor * kFactor;
}

// Mode decode advantage in dB relative to SSB (higher = can decode weaker signals)
// Based on typical required SNR thresholds for each mode
const MODE_ADVANTAGE_DB = {
  'SSB':   0,    // Baseline: requires ~13dB SNR
  'AM':   -6,    // Worse than SSB: requires ~19dB SNR
  'CW':   10,    // Narrow bandwidth: requires ~3dB SNR
  'RTTY':  8,    // Digital FSK: requires ~5dB SNR
  'PSK31':10,    // Phase-shift keying: requires ~3dB SNR
  'FT8':  34,    // Deep decode: requires ~-21dB SNR
  'FT4':  30,    // Slightly less sensitive: requires ~-17dB SNR
  'WSPR': 41,    // Ultra-weak signal: requires ~-28dB SNR
  'JS8':  37,    // Conversational weak-signal: requires ~-24dB SNR
  'OLIVIA': 20,  // Error-correcting: requires ~-7dB SNR
  'JT65': 38     // Deep decode: requires ~-25dB SNR
};

/**
 * Calculate signal margin in dB from mode and power
 * Used to adjust propagation reliability predictions
 * @param {string} mode - Operating mode (SSB, CW, FT8, etc.)
 * @param {number} powerWatts - TX power in watts
 * @returns {number} Signal margin in dB relative to SSB at 100W
 */
function calculateSignalMargin(mode, powerWatts) {
  const modeAdv = MODE_ADVANTAGE_DB[mode] || 0;
  const power = Math.max(0.01, powerWatts || 100);
  const powerOffset = 10 * Math.log10(power / 100); // dB relative to 100W
  return modeAdv + powerOffset;
}

// Enhanced reliability calculation using real ionosonde data
function calculateEnhancedReliability(freq, distance, midLat, midLon, hour, sfi, ssn, kIndex, de, dx, ionoData, currentHour, signalMarginDb = 0) {
  // Calculate MUF and LUF for this hour
  // For non-current hours, we need to estimate how foF2 changes
  let hourIonoData = ionoData;
  
  if (ionoData && hour !== currentHour) {
    // Estimate foF2 change based on diurnal variation
    // foF2 typically varies by factor of 2-3 between day and night
    const currentHourFactor = 1 + 0.4 * Math.cos((currentHour - 14) * Math.PI / 12);
    const targetHourFactor = 1 + 0.4 * Math.cos((hour - 14) * Math.PI / 12);
    const scaleFactor = targetHourFactor / currentHourFactor;
    
    hourIonoData = {
      ...ionoData,
      foF2: ionoData.foF2 * scaleFactor,
      mufd: ionoData.mufd ? ionoData.mufd * scaleFactor : null
    };
  }
  
  const muf = calculateMUF(distance, midLat, midLon, hour, sfi, ssn, hourIonoData);
  const luf = calculateLUF(distance, midLat, hour, sfi, kIndex);
  
  // Apply signal margin from mode + power
  // Positive margin (e.g. FT8 or high power) effectively widens the usable window:
  //   - Extends effective MUF (weak-signal modes can decode signals near/above MUF)
  //   - Reduces effective LUF (more power overcomes D-layer absorption)
  // Each dB of margin extends MUF by ~1.2% and reduces LUF by ~0.8%
  const effectiveMuf = muf * (1 + signalMarginDb * 0.012);
  const effectiveLuf = luf * Math.max(0.1, 1 - signalMarginDb * 0.008);
  
  // Calculate reliability based on frequency position relative to effective MUF/LUF
  let reliability = 0;
  
  if (freq > effectiveMuf * 1.1) {
    // Well above MUF - very poor
    reliability = Math.max(0, 30 - (freq - effectiveMuf) * 5);
  } else if (freq > effectiveMuf) {
    // Slightly above MUF - marginal (sometimes works due to scatter)
    reliability = 30 + (effectiveMuf * 1.1 - freq) / (effectiveMuf * 0.1) * 20;
  } else if (freq < effectiveLuf * 0.8) {
    // Well below LUF - absorbed
    reliability = Math.max(0, 20 - (effectiveLuf - freq) * 10);
  } else if (freq < effectiveLuf) {
    // Near LUF - marginal
    reliability = 20 + (freq - effectiveLuf * 0.8) / (effectiveLuf * 0.2) * 30;
  } else {
    // In usable range - calculate optimum
    // Optimum Working Frequency (OWF) is typically 80-85% of MUF
    const owf = effectiveMuf * 0.85;
    const range = effectiveMuf - effectiveLuf;
    
    if (range <= 0) {
      reliability = 30; // Very narrow window
    } else {
      // Higher reliability near OWF, tapering toward MUF and LUF
      const position = (freq - effectiveLuf) / range; // 0 at LUF, 1 at MUF
      const optimalPosition = 0.75; // 75% up from LUF = OWF
      
      if (position < optimalPosition) {
        // Below OWF - reliability increases as we approach OWF
        reliability = 50 + (position / optimalPosition) * 45;
      } else {
        // Above OWF - reliability decreases as we approach MUF
        reliability = 95 - ((position - optimalPosition) / (1 - optimalPosition)) * 45;
      }
    }
  }
  
  // K-index degradation (geomagnetic storms)
  if (kIndex >= 7) reliability *= 0.1;
  else if (kIndex >= 6) reliability *= 0.2;
  else if (kIndex >= 5) reliability *= 0.4;
  else if (kIndex >= 4) reliability *= 0.6;
  else if (kIndex >= 3) reliability *= 0.8;
  
  // Very long paths (multiple hops) are harder
  const hops = Math.ceil(distance / 3500);
  if (hops > 1) {
    reliability *= Math.pow(0.92, hops - 1); // ~8% loss per additional hop
  }
  
  // Polar path penalty (auroral absorption)
  if (Math.abs(midLat) > 60) {
    reliability *= 0.7;
    if (kIndex >= 3) reliability *= 0.7; // Additional penalty during storms
  }
  
  // High bands need sufficient solar activity
  if (freq >= 21 && sfi < 100) reliability *= Math.sqrt(sfi / 100);
  if (freq >= 28 && sfi < 120) reliability *= Math.sqrt(sfi / 120);
  if (freq >= 50 && sfi < 150) reliability *= Math.pow(sfi / 150, 1.5);
  
  // Low bands work better at night
  const localHour = (hour + midLon / 15 + 24) % 24;
  const isNight = localHour < 6 || localHour > 18;
  if (freq <= 7 && isNight) reliability *= 1.1;
  if (freq <= 3.5 && !isNight) reliability *= 0.7;
  
  return Math.min(99, Math.max(0, reliability));
}

// Convert reliability to estimated SNR
function calculateSNR(reliability) {
  if (reliability >= 80) return '+20dB';
  if (reliability >= 60) return '+10dB';
  if (reliability >= 40) return '0dB';
  if (reliability >= 20) return '-10dB';
  return '-20dB';
}

// Get status label from reliability
function getStatus(reliability) {
  if (reliability >= 70) return 'EXCELLENT';
  if (reliability >= 50) return 'GOOD';
  if (reliability >= 30) return 'FAIR';
  if (reliability >= 15) return 'POOR';
  return 'CLOSED';
}

// QRZ Callsign lookup (requires API key)
app.get('/api/qrz/lookup/:callsign', async (req, res) => {
  const { callsign } = req.params;
  // Note: QRZ requires an API key - this is a placeholder
  res.json({ 
    message: 'QRZ lookup requires API key configuration',
    callsign: callsign.toUpperCase()
  });
});

// ============================================
// CONTEST CALENDAR API
// ============================================

app.get('/api/contests', async (req, res) => {
  // Try WA7BNM Contest Calendar RSS feed
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch('https://www.contestcalendar.com/calendar.rss', {
      headers: { 
        'User-Agent': 'OpenHamClock/3.13.1',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      const text = await response.text();
      const contests = parseContestRSS(text);
      
      if (contests.length > 0) {
        logDebug('[Contests] WA7BNM RSS:', contests.length, 'contests');
        return res.json(contests);
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      logErrorOnce('Contests RSS', error.message);
    }
  }

  // Fallback: Use calculated contests
  try {
    const contests = calculateUpcomingContests();
    logDebug('[Contests] Using calculated:', contests.length, 'contests');
    return res.json(contests);
  } catch (error) {
    logErrorOnce('Contests', error.message);
  }

  res.json([]);
});

// Parse WA7BNM RSS feed
function parseContestRSS(xml) {
  const contests = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Simple regex-based XML parsing (no external dependencies)
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title>([^<]+)<\/title>/;
  const linkRegex = /<link>([^<]+)<\/link>/;
  const descRegex = /<description>([^<]+)<\/description>/;
  
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    
    const titleMatch = item.match(titleRegex);
    const linkMatch = item.match(linkRegex);
    const descMatch = item.match(descRegex);
    
    if (titleMatch && descMatch) {
      const name = titleMatch[1].trim();
      const desc = descMatch[1].trim();
      const url = linkMatch ? linkMatch[1].trim() : null;
      
      // Parse description like "1300Z, Jan 31 to 1300Z, Feb 1" or "0000Z-2359Z, Jan 31"
      const parsed = parseContestDateTime(desc, currentYear);
      
      if (parsed) {
        const status = (now >= parsed.start && now <= parsed.end) ? 'active' : 'upcoming';
        
        // Try to detect mode from contest name
        let mode = 'Mixed';
        const nameLower = name.toLowerCase();
        if (nameLower.includes('cw') || nameLower.includes('morse')) mode = 'CW';
        else if (nameLower.includes('ssb') || nameLower.includes('phone') || nameLower.includes('sideband')) mode = 'SSB';
        else if (nameLower.includes('rtty')) mode = 'RTTY';
        else if (nameLower.includes('ft4') || nameLower.includes('ft8') || nameLower.includes('digi')) mode = 'Digital';
        else if (nameLower.includes('vhf') || nameLower.includes('uhf')) mode = 'VHF';
        
        contests.push({
          name,
          start: parsed.start.toISOString(),
          end: parsed.end.toISOString(),
          mode,
          status,
          url
        });
      }
    }
  }
  
  // Sort by start date, filter out past contests, and limit
  const currentAndFuture = contests.filter(c => new Date(c.end) >= now);
  currentAndFuture.sort((a, b) => new Date(a.start) - new Date(b.start));
  return currentAndFuture.slice(0, 20);
}

// Parse contest date/time strings
function parseContestDateTime(desc, year) {
  try {
    const months = { 'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5, 
                     'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11 };
    
    // Pattern 1: "1300Z, Jan 31 to 1300Z, Feb 1"
    const rangeMatch = desc.match(/(\d{4})Z,\s*(\w+)\s+(\d+)\s+to\s+(\d{4})Z,\s*(\w+)\s+(\d+)/i);
    if (rangeMatch) {
      const [, startTime, startMon, startDay, endTime, endMon, endDay] = rangeMatch;
      const startMonth = months[startMon.toLowerCase()];
      const endMonth = months[endMon.toLowerCase()];
      
      let startYear = year;
      let endYear = year;
      // Handle year rollover
      if (startMonth > 10 && endMonth < 2) endYear = year + 1;
      
      const start = new Date(Date.UTC(startYear, startMonth, parseInt(startDay), 
        parseInt(startTime.substring(0, 2)), parseInt(startTime.substring(2, 4))));
      const end = new Date(Date.UTC(endYear, endMonth, parseInt(endDay),
        parseInt(endTime.substring(0, 2)), parseInt(endTime.substring(2, 4))));
      
      return { start, end };
    }
    
    // Pattern 2: "0000Z-2359Z, Jan 31" (same day)
    const sameDayMatch = desc.match(/(\d{4})Z-(\d{4})Z,\s*(\w+)\s+(\d+)/i);
    if (sameDayMatch) {
      const [, startTime, endTime, mon, day] = sameDayMatch;
      const month = months[mon.toLowerCase()];
      
      const start = new Date(Date.UTC(year, month, parseInt(day),
        parseInt(startTime.substring(0, 2)), parseInt(startTime.substring(2, 4))));
      const end = new Date(Date.UTC(year, month, parseInt(day),
        parseInt(endTime.substring(0, 2)), parseInt(endTime.substring(2, 4))));
      
      // Handle overnight contests (end time < start time means next day)
      if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
      
      return { start, end };
    }
    
    // Pattern 3: "0000Z-0100Z, Feb 5 and 0200Z-0300Z, Feb 6" (multiple sessions - use first)
    const multiMatch = desc.match(/(\d{4})Z-(\d{4})Z,\s*(\w+)\s+(\d+)/i);
    if (multiMatch) {
      const [, startTime, endTime, mon, day] = multiMatch;
      const month = months[mon.toLowerCase()];
      
      const start = new Date(Date.UTC(year, month, parseInt(day),
        parseInt(startTime.substring(0, 2)), parseInt(startTime.substring(2, 4))));
      const end = new Date(Date.UTC(year, month, parseInt(day),
        parseInt(endTime.substring(0, 2)), parseInt(endTime.substring(2, 4))));
      
      if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
      
      return { start, end };
    }
    
  } catch (e) {
    // Parse error, skip this contest
  }
  
  return null;
}

// Helper function to calculate upcoming contests
function calculateUpcomingContests() {
  const now = new Date();
  const contests = [];
  
  // Major contest definitions with typical schedules
  const majorContests = [
    { name: 'CQ WW DX CW', month: 10, weekend: -1, duration: 48, mode: 'CW' }, // Last full weekend Nov
    { name: 'CQ WW DX SSB', month: 9, weekend: -1, duration: 48, mode: 'SSB' }, // Last full weekend Oct
    { name: 'ARRL DX CW', month: 1, weekend: 3, duration: 48, mode: 'CW' }, // 3rd full weekend Feb
    { name: 'ARRL DX SSB', month: 2, weekend: 1, duration: 48, mode: 'SSB' }, // 1st full weekend Mar
    { name: 'CQ WPX SSB', month: 2, weekend: -1, duration: 48, mode: 'SSB' }, // Last full weekend Mar
    { name: 'CQ WPX CW', month: 4, weekend: -1, duration: 48, mode: 'CW' }, // Last full weekend May
    { name: 'IARU HF Championship', month: 6, weekend: 2, duration: 24, mode: 'Mixed' }, // 2nd full weekend Jul
    { name: 'ARRL Field Day', month: 5, weekend: 4, duration: 27, mode: 'Mixed' }, // 4th full weekend Jun
    { name: 'ARRL Sweepstakes CW', month: 10, weekend: 1, duration: 24, mode: 'CW' }, // 1st full weekend Nov
    { name: 'ARRL Sweepstakes SSB', month: 10, weekend: 3, duration: 24, mode: 'SSB' }, // 3rd full weekend Nov
    { name: 'ARRL 10m Contest', month: 11, weekend: 2, duration: 48, mode: 'Mixed' }, // 2nd full weekend Dec
    { name: 'ARRL RTTY Roundup', month: 0, weekend: 1, duration: 24, mode: 'RTTY' }, // 1st full weekend Jan
    { name: 'NA QSO Party CW', month: 0, weekend: 2, duration: 12, mode: 'CW' },
    { name: 'NA QSO Party SSB', month: 0, weekend: 3, duration: 12, mode: 'SSB' },
    { name: 'CQ 160m CW', month: 0, weekend: -1, duration: 42, mode: 'CW' }, // Last full weekend Jan
    { name: 'CQ 160m SSB', month: 1, weekend: -1, duration: 42, mode: 'SSB' }, // Last full weekend Feb
    { name: 'CQ WW RTTY', month: 8, weekend: -1, duration: 48, mode: 'RTTY' },
    { name: 'JIDX CW', month: 3, weekend: 2, duration: 48, mode: 'CW' },
    { name: 'JIDX SSB', month: 10, weekend: 2, duration: 48, mode: 'SSB' },
    { name: 'ARRL VHF Contest', month: 0, weekend: 3, duration: 33, mode: 'Mixed' }, // 3rd weekend Jan
    { name: 'ARRL June VHF', month: 5, weekend: 2, duration: 33, mode: 'Mixed' }, // 2nd weekend Jun
    { name: 'ARRL Sept VHF', month: 8, weekend: 2, duration: 33, mode: 'Mixed' }, // 2nd weekend Sep
    { name: 'Winter Field Day', month: 0, weekend: -1, duration: 24, mode: 'Mixed' }, // Last weekend Jan
    { name: 'CQWW WPX RTTY', month: 1, weekend: 2, duration: 48, mode: 'RTTY' }, // 2nd weekend Feb
    { name: 'Stew Perry Topband', month: 11, weekend: 4, duration: 14, mode: 'CW' }, // 4th weekend Dec
    { name: 'RAC Canada Day', month: 6, weekend: 1, duration: 24, mode: 'Mixed' }, // 1st weekend Jul
    { name: 'RAC Winter Contest', month: 11, weekend: -1, duration: 24, mode: 'Mixed' }, // Last weekend Dec
    { name: 'NAQP RTTY', month: 1, weekend: 4, duration: 12, mode: 'RTTY' }, // 4th weekend Feb
    { name: 'NAQP RTTY', month: 6, weekend: 3, duration: 12, mode: 'RTTY' }, // 3rd weekend Jul
  ];

  // Weekly mini-contests (CWT, SST, etc.) - dayOfWeek: 0=Sun, 1=Mon, ... 6=Sat
  const weeklyContests = [
    { name: 'CWT 1300z', dayOfWeek: 3, hour: 13, duration: 1, mode: 'CW' }, // Wednesday
    { name: 'CWT 1900z', dayOfWeek: 3, hour: 19, duration: 1, mode: 'CW' }, // Wednesday
    { name: 'CWT 0300z', dayOfWeek: 4, hour: 3, duration: 1, mode: 'CW' }, // Thursday
    { name: 'CWT 0700z', dayOfWeek: 4, hour: 7, duration: 1, mode: 'CW' }, // Thursday
    { name: 'NCCC Sprint', dayOfWeek: 5, hour: 3, minute: 30, duration: 0.5, mode: 'CW' }, // Friday
    { name: 'K1USN SST', dayOfWeek: 0, hour: 0, duration: 1, mode: 'CW' }, // Sunday 0000z (Sat evening US)
    { name: 'K1USN SST', dayOfWeek: 1, hour: 20, duration: 1, mode: 'CW' }, // Monday 2000z
    { name: 'ICWC MST', dayOfWeek: 1, hour: 13, duration: 1, mode: 'CW' }, // Monday 1300z
    { name: 'ICWC MST', dayOfWeek: 1, hour: 19, duration: 1, mode: 'CW' }, // Monday 1900z
    { name: 'ICWC MST', dayOfWeek: 2, hour: 3, duration: 1, mode: 'CW' }, // Tuesday 0300z
    { name: 'SKCC Sprint', dayOfWeek: 3, hour: 0, duration: 2, mode: 'CW' }, // Wednesday 0000z
    { name: 'QRP Fox Hunt', dayOfWeek: 3, hour: 2, duration: 1.5, mode: 'CW' }, // Wednesday 0200z
    { name: 'RTTY Weekday Sprint', dayOfWeek: 2, hour: 23, duration: 1, mode: 'RTTY' }, // Tuesday 2300z
  ];

  // Calculate next occurrences of weekly contests
  weeklyContests.forEach(contest => {
    const next = new Date(now);
    const currentDay = now.getUTCDay();
    let daysUntil = contest.dayOfWeek - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0) {
      // Check if it's today but already passed
      const todayStart = new Date(now);
      todayStart.setUTCHours(contest.hour, contest.minute || 0, 0, 0);
      if (now > todayStart) daysUntil = 7;
    }
    
    next.setUTCDate(now.getUTCDate() + daysUntil);
    next.setUTCHours(contest.hour, contest.minute || 0, 0, 0);
    
    const endTime = new Date(next.getTime() + contest.duration * 3600000);
    
    contests.push({
      name: contest.name,
      start: next.toISOString(),
      end: endTime.toISOString(),
      mode: contest.mode,
      status: (now >= next && now <= endTime) ? 'active' : 'upcoming'
    });
  });

  // Calculate next occurrences of major contests
  const year = now.getFullYear();
  majorContests.forEach(contest => {
    for (let y = year; y <= year + 1; y++) {
      let startDate;
      
      if (contest.weekend === -1) {
        // Last weekend of month
        startDate = getLastWeekendOfMonth(y, contest.month);
      } else {
        // Nth weekend of month
        startDate = getNthWeekendOfMonth(y, contest.month, contest.weekend);
      }
      
      // Most contests start at 00:00 UTC Saturday
      startDate.setUTCHours(0, 0, 0, 0);
      const endDate = new Date(startDate.getTime() + contest.duration * 3600000);
      
      if (endDate > now) {
        const status = (now >= startDate && now <= endDate) ? 'active' : 'upcoming';
        contests.push({
          name: contest.name,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          mode: contest.mode,
          status: status
        });
        break; // Only add next occurrence
      }
    }
  });

  // Sort by start date
  contests.sort((a, b) => new Date(a.start) - new Date(b.start));
  
  return contests.slice(0, 15);
}

function getNthWeekendOfMonth(year, month, n) {
  const date = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  let weekendCount = 0;
  
  while (date.getUTCMonth() === month) {
    if (date.getUTCDay() === 6) { // Saturday
      weekendCount++;
      if (weekendCount === n) return new Date(date);
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  
  return date;
}

function getLastWeekendOfMonth(year, month) {
  // Start from last day of month and work backwards
  const date = new Date(Date.UTC(year, month + 1, 0)); // Last day of month
  
  while (date.getUTCDay() !== 6) { // Find last Saturday
    date.setUTCDate(date.getUTCDate() - 1);
  }
  
  return date;
}

// ============================================
// HEALTH CHECK & STATUS DASHBOARD
// ============================================

// Generate HTML status dashboard
function generateStatusDashboard() {
  rolloverVisitorStats();
  
  const uptime = process.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const uptimeStr = `${days}d ${hours}h ${minutes}m`;
  
  // Calculate time since first deployment
  const firstStart = new Date(visitorStats.serverFirstStarted);
  const trackingDays = Math.floor((Date.now() - firstStart.getTime()) / 86400000);
  
  const avg = visitorStats.history.length > 0
    ? Math.round(visitorStats.history.reduce((sum, d) => sum + d.uniqueVisitors, 0) / visitorStats.history.length)
    : visitorStats.uniqueIPsToday.length;
  
  // Get last 14 days for the chart
  const chartData = [...visitorStats.history].slice(-14);
  // Add today if we have data
  if (visitorStats.uniqueIPsToday.length > 0) {
    chartData.push({
      date: visitorStats.today,
      uniqueVisitors: visitorStats.uniqueIPsToday.length,
      totalRequests: visitorStats.totalRequestsToday
    });
  }
  
  const maxVisitors = Math.max(...chartData.map(d => d.uniqueVisitors), 1);
  
  // Generate bar chart
  const bars = chartData.map(d => {
    const height = Math.max((d.uniqueVisitors / maxVisitors) * 100, 2);
    const date = new Date(d.date);
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
    const isToday = d.date === visitorStats.today;
    return `
      <div class="bar-container" title="${d.date}: ${d.uniqueVisitors} visitors, ${d.totalRequests} requests">
        <div class="bar ${isToday ? 'today' : ''}" style="height: ${height}%">
          <span class="bar-value">${d.uniqueVisitors}</span>
        </div>
        <div class="bar-label">${dayLabel}</div>
      </div>
    `;
  }).join('');
  
  // Calculate week-over-week growth
  const thisWeek = chartData.slice(-7).reduce((sum, d) => sum + d.uniqueVisitors, 0);
  const lastWeek = chartData.slice(-14, -7).reduce((sum, d) => sum + d.uniqueVisitors, 0);
  const growth = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;
  const growthIcon = growth > 0 ? '📈' : growth < 0 ? '📉' : '➡️';
  const growthColor = growth > 0 ? '#00ff88' : growth < 0 ? '#ff4466' : '#888';
  
  // Get API traffic stats
  const apiStats = endpointStats.getStats();
  const estimatedMonthlyGB = apiStats.uptimeHours > 0 
    ? ((apiStats.totalBytes / parseFloat(apiStats.uptimeHours)) * 24 * 30 / (1024 * 1024 * 1024)).toFixed(2)
    : '0.00';
  
  // Get session stats
  const sessionStats = sessionTracker.getStats();
  
  // Generate API traffic table rows (top 15 by bandwidth)
  const apiTableRows = apiStats.endpoints.slice(0, 15).map((ep, i) => {
    const bytesFormatted = formatBytes(ep.totalBytes);
    const avgBytesFormatted = formatBytes(ep.avgBytes);
    const bandwidthBar = Math.min((ep.totalBytes / (apiStats.totalBytes || 1)) * 100, 100);
    return `
      <tr>
        <td style="color: #888">${i + 1}</td>
        <td><code style="color: #00ccff">${ep.path}</code></td>
        <td style="text-align: right">${ep.requests.toLocaleString()}</td>
        <td style="text-align: right">${ep.requestsPerHour}/hr</td>
        <td style="text-align: right; color: #ffb347">${bytesFormatted}</td>
        <td style="text-align: right">${avgBytesFormatted}</td>
        <td style="text-align: right">${ep.avgDuration}ms</td>
        <td style="width: 100px">
          <div style="background: rgba(255,179,71,0.2); border-radius: 4px; height: 8px; width: 100%">
            <div style="background: linear-gradient(90deg, #ffb347, #ff6b35); height: 100%; width: ${bandwidthBar}%; border-radius: 4px"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>OpenHamClock Status</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Orbitron:wght@700;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', monospace;
      background: linear-gradient(135deg, #0a0f1a 0%, #1a1f2e 50%, #0d1117 100%);
      color: #e2e8f0;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding: 30px;
      background: rgba(0, 255, 136, 0.05);
      border: 1px solid rgba(0, 255, 136, 0.2);
      border-radius: 16px;
    }
    .logo {
      font-family: 'Orbitron', sans-serif;
      font-size: 2.5rem;
      font-weight: 900;
      background: linear-gradient(135deg, #00ff88, #00ccff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 8px;
    }
    .version {
      color: #00ff88;
      font-size: 1rem;
      opacity: 0.8;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 255, 136, 0.15);
      border: 1px solid rgba(0, 255, 136, 0.4);
      padding: 8px 16px;
      border-radius: 20px;
      margin-top: 15px;
      font-weight: 600;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.4); }
      50% { opacity: 0.8; box-shadow: 0 0 0 8px rgba(0, 255, 136, 0); }
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      transition: all 0.3s ease;
    }
    .stat-card:hover {
      border-color: rgba(0, 255, 136, 0.3);
      transform: translateY(-2px);
    }
    .stat-icon { font-size: 1.5rem; margin-bottom: 8px; }
    .stat-value {
      font-family: 'Orbitron', sans-serif;
      font-size: 2rem;
      font-weight: 700;
      color: #00ccff;
      margin-bottom: 4px;
    }
    .stat-value.amber { color: #ffb347; }
    .stat-value.green { color: #00ff88; }
    .stat-value.purple { color: #a78bfa; }
    .stat-label {
      font-size: 0.75rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .chart-section {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
    }
    .chart-title {
      font-size: 1rem;
      color: #00ff88;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .chart-growth {
      font-size: 0.85rem;
      padding: 4px 10px;
      border-radius: 12px;
      background: rgba(0, 255, 136, 0.1);
    }
    .chart {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      height: 150px;
      gap: 8px;
      padding: 10px 0;
    }
    .bar-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
    }
    .bar {
      width: 100%;
      max-width: 40px;
      background: linear-gradient(180deg, #00ccff 0%, #0066cc 100%);
      border-radius: 4px 4px 0 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      min-height: 4px;
      transition: all 0.3s ease;
      position: relative;
    }
    .bar.today {
      background: linear-gradient(180deg, #00ff88 0%, #00aa55 100%);
    }
    .bar:hover {
      filter: brightness(1.2);
      transform: scaleY(1.02);
    }
    .bar-value {
      position: absolute;
      top: -22px;
      font-size: 0.7rem;
      color: #888;
      font-weight: 600;
    }
    .bar-label {
      font-size: 0.65rem;
      color: #666;
      margin-top: 6px;
      text-transform: uppercase;
    }
    .info-section {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #888; }
    .info-value { color: #e2e8f0; font-weight: 600; }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding: 20px;
      color: #555;
      font-size: 0.8rem;
    }
    .footer a {
      color: #00ccff;
      text-decoration: none;
    }
    .footer a:hover { text-decoration: underline; }
    .json-link {
      display: inline-block;
      margin-top: 10px;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      color: #888;
      text-decoration: none;
      font-size: 0.75rem;
      transition: all 0.2s;
    }
    .json-link:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #e2e8f0;
    }
    .api-section {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
      overflow-x: auto;
    }
    .api-title {
      font-size: 1rem;
      color: #e2e8f0;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .api-summary {
      display: flex;
      gap: 24px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .api-stat {
      background: rgba(255, 179, 71, 0.1);
      border: 1px solid rgba(255, 179, 71, 0.3);
      padding: 12px 16px;
      border-radius: 8px;
    }
    .api-stat-value {
      font-family: 'Orbitron', sans-serif;
      font-size: 1.2rem;
      color: #ffb347;
    }
    .api-stat-label {
      font-size: 0.7rem;
      color: #888;
      text-transform: uppercase;
    }
    .api-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .api-table th {
      text-align: left;
      padding: 8px 12px;
      color: #888;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.7rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .api-table td {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .api-table tr:hover {
      background: rgba(255, 255, 255, 0.02);
    }
    .api-table code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
    }
    @media (max-width: 600px) {
      .logo { font-size: 1.8rem; }
      .stat-value { font-size: 1.5rem; }
      .chart { height: 120px; gap: 4px; }
      .bar-value { font-size: 0.6rem; top: -18px; }
      .api-table { font-size: 0.7rem; }
      .api-summary { gap: 12px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">📡 OpenHamClock</div>
      <div class="version">v${APP_VERSION}</div>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span>All Systems Operational</span>
      </div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">🟢</div>
        <div class="stat-value green">${sessionStats.concurrent}</div>
        <div class="stat-label">Online Now</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">👥</div>
        <div class="stat-value">${visitorStats.uniqueIPsToday.length}</div>
        <div class="stat-label">Visitors Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🌍</div>
        <div class="stat-value amber">${visitorStats.allTimeVisitors.toLocaleString()}</div>
        <div class="stat-label">All-Time Visitors</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📊</div>
        <div class="stat-value green">${avg}</div>
        <div class="stat-label">Daily Average</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏔️</div>
        <div class="stat-value purple">${sessionStats.peakConcurrent}</div>
        <div class="stat-label">Peak Concurrent</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⏱️</div>
        <div class="stat-value purple">${uptimeStr}</div>
        <div class="stat-label">Uptime</div>
      </div>
    </div>
    
    <!-- Session Duration Analytics -->
    <div class="chart-section">
      <div class="chart-title">
        <span>⏱️ Session Duration Analytics</span>
        <span style="color: #888; font-size: 0.75rem">${sessionStats.completedSessions} completed sessions</span>
      </div>
      
      <div class="api-summary" style="margin-bottom: 20px">
        <div class="api-stat">
          <div class="api-stat-value" style="color: #00ccff">${sessionStats.avgDurationFormatted || '--'}</div>
          <div class="api-stat-label">Avg Duration</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value" style="color: #a78bfa">${sessionStats.medianDurationFormatted || '--'}</div>
          <div class="api-stat-label">Median</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value" style="color: #ffb347">${sessionStats.p90DurationFormatted || '--'}</div>
          <div class="api-stat-label">90th Percentile</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value" style="color: #00ff88">${sessionStats.maxDurationFormatted || '--'}</div>
          <div class="api-stat-label">Longest</div>
        </div>
      </div>
      
      <!-- Duration Distribution Bars -->
      ${sessionStats.completedSessions > 0 ? (() => {
        const b = sessionStats.durationBuckets;
        const total = Object.values(b).reduce((s, v) => s + v, 0) || 1;
        const bucketLabels = [
          { key: 'under1m', label: '<1m', color: '#ff4466' },
          { key: '1to5m', label: '1-5m', color: '#ffb347' },
          { key: '5to15m', label: '5-15m', color: '#ffdd00' },
          { key: '15to30m', label: '15-30m', color: '#88cc00' },
          { key: '30to60m', label: '30m-1h', color: '#00ff88' },
          { key: 'over1h', label: '1h+', color: '#00ccff' }
        ];
        return `
          <div style="margin-bottom: 8px; font-size: 0.75rem; color: #888">Session Length Distribution</div>
          <div style="display: flex; gap: 6px; align-items: flex-end; height: 80px; margin-bottom: 4px">
            ${bucketLabels.map(({ key, label, color }) => {
              const count = b[key] || 0;
              const pct = Math.max((count / total) * 100, 2);
              return `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%" title="${label}: ${count} sessions (${Math.round(count/total*100)}%)">
                  <div style="font-size: 0.65rem; color: #888; margin-bottom: 4px">${count}</div>
                  <div style="width: 100%; max-width: 50px; background: ${color}; border-radius: 4px 4px 0 0; height: ${pct}%; min-height: 3px; opacity: 0.85"></div>
                  <div style="font-size: 0.6rem; color: #666; margin-top: 4px">${label}</div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      })() : '<div style="color: #666; text-align: center; padding: 16px">No completed sessions yet — data will appear as users visit and leave</div>'}
    </div>
    
    <!-- Active Users Table -->
    ${sessionStats.activeSessions.length > 0 ? `
    <div class="api-section">
      <div class="api-title">
        <span>🟢 Active Users (${sessionStats.concurrent})</span>
        <span style="color: #888; font-size: 0.75rem">${sessionStats.peakConcurrentTime ? 'Peak: ' + sessionStats.peakConcurrent + ' at ' + new Date(sessionStats.peakConcurrentTime).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
      <table class="api-table">
        <thead>
          <tr>
            <th>#</th>
            <th>IP</th>
            <th style="text-align: right">Session Duration</th>
            <th style="text-align: right">Requests</th>
          </tr>
        </thead>
        <tbody>
          ${sessionStats.activeSessions.map((s, i) => `
            <tr>
              <td style="color: #888">${i + 1}</td>
              <td><code style="color: #00ccff">${s.ip}</code></td>
              <td style="text-align: right; color: #00ff88; font-weight: 600">${s.durationFormatted}</td>
              <td style="text-align: right">${s.requests}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
    
    <div class="chart-section">
      <div class="chart-title">
        <span>📈 Visitor Trend (${chartData.length} days)</span>
        <span class="chart-growth" style="color: ${growthColor}">${growthIcon} ${growth > 0 ? '+' : ''}${growth}% week/week</span>
      </div>
      <div class="chart">
        ${bars || '<div style="color: #666; text-align: center; width: 100%;">No historical data yet</div>'}
      </div>
    </div>
    
    <div class="info-section">
      <div class="info-row">
        <span class="info-label">Tracking Since</span>
        <span class="info-value">${new Date(visitorStats.serverFirstStarted).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Days Tracked</span>
        <span class="info-value">${trackingDays} days</span>
      </div>
      <div class="info-row">
        <span class="info-label">Deployment Count</span>
        <span class="info-value">#${visitorStats.deploymentCount}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Last Deployment</span>
        <span class="info-value">${new Date(visitorStats.lastDeployment).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Total Requests</span>
        <span class="info-value">${visitorStats.allTimeRequests.toLocaleString()}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Persistence</span>
        <span class="info-value" style="color: ${STATS_FILE ? '#00ff88' : '#ff4466'}">${STATS_FILE ? '✓ Working' : '✗ Memory Only'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Stats Location</span>
        <span class="info-value" style="font-size: 0.75rem; color: #888">${STATS_FILE || 'Memory only (no writable storage)'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Last Saved</span>
        <span class="info-value">${visitorStats.lastSaved ? new Date(visitorStats.lastSaved).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not yet'}</span>
      </div>
    </div>
    
    ${(() => {
      // Country statistics section
      const allTimeCountries = Object.entries(visitorStats.countryStats || {}).sort((a, b) => b[1] - a[1]);
      const todayCountries = Object.entries(visitorStats.countryStatsToday || {}).sort((a, b) => b[1] - a[1]);
      const totalResolved = allTimeCountries.reduce((s, [, v]) => s + v, 0);
      
      if (allTimeCountries.length === 0 && geoIPQueue.size === 0) return '';
      
      // Country code to flag emoji
      const flag = (cc) => {
        try { return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E5 + c.charCodeAt(0) - 64)); } 
        catch { return '🏳'; }
      };
      
      const maxCount = allTimeCountries[0]?.[1] || 1;
      
      return `
    <div class="api-section">
      <div class="api-title">
        <span>🌍 Visitor Countries</span>
        <span style="color: #888; font-size: 0.75rem">${geoIPCache.size} resolved, ${geoIPQueue.size} pending</span>
      </div>
      
      ${todayCountries.length > 0 ? `
      <div style="margin-bottom: 16px">
        <div style="color: #888; font-size: 0.75rem; margin-bottom: 6px">Today</div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px">
          ${todayCountries.map(([cc, count]) => `
            <span style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 4px 8px; font-size: 0.8rem">
              ${flag(cc)} ${cc} <span style="color: #00ff88; font-weight: 600">${count}</span>
            </span>
          `).join('')}
        </div>
      </div>` : ''}
      
      <div style="color: #888; font-size: 0.75rem; margin-bottom: 6px">All-Time (${allTimeCountries.length} countries, ${totalResolved} visitors resolved)</div>
      <div style="max-height: 300px; overflow-y: auto">
        ${allTimeCountries.slice(0, 40).map(([cc, count]) => {
          const pct = Math.round(count / totalResolved * 100);
          const barWidth = Math.max(2, (count / maxCount) * 100);
          return `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px; font-size: 0.8rem">
            <span style="width: 28px; text-align: center">${flag(cc)}</span>
            <span style="width: 28px; color: #888; font-family: monospace">${cc}</span>
            <div style="flex: 1; background: rgba(255,255,255,0.05); border-radius: 2px; height: 16px; overflow: hidden">
              <div style="width: ${barWidth}%; height: 100%; background: linear-gradient(90deg, rgba(0,100,255,0.6), rgba(0,200,100,0.6)); border-radius: 2px"></div>
            </div>
            <span style="width: 60px; text-align: right; font-family: monospace; color: #ccc">${count}</span>
            <span style="width: 40px; text-align: right; font-size: 0.7rem; color: #888">${pct}%</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
    })()}
    
    <div class="api-section">
      <div class="api-title">
        <span>📊 API Traffic Monitor</span>
        <span style="color: #888; font-size: 0.75rem">Since last restart (${apiStats.uptimeHours}h ago)</span>
      </div>
      
      <div class="api-summary">
        <div class="api-stat">
          <div class="api-stat-value">${apiStats.totalRequests.toLocaleString()}</div>
          <div class="api-stat-label">Total Requests</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value">${formatBytes(apiStats.totalBytes)}</div>
          <div class="api-stat-label">Total Egress</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value" style="color: ${parseFloat(estimatedMonthlyGB) > 100 ? '#ff4466' : '#00ff88'}">${estimatedMonthlyGB} GB</div>
          <div class="api-stat-label">Est. Monthly</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value">${apiStats.endpoints.length}</div>
          <div class="api-stat-label">Active Endpoints</div>
        </div>
      </div>
      
      ${apiStats.endpoints.length > 0 ? `
      <table class="api-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Endpoint</th>
            <th style="text-align: right">Requests</th>
            <th style="text-align: right">Rate</th>
            <th style="text-align: right">Total</th>
            <th style="text-align: right">Avg Size</th>
            <th style="text-align: right">Avg Time</th>
            <th>Bandwidth</th>
          </tr>
        </thead>
        <tbody>
          ${apiTableRows}
        </tbody>
      </table>
      ` : '<div style="color: #666; text-align: center; padding: 20px">No API requests recorded yet</div>'}
    </div>
    
    <div class="api-section">
      <h2>🔗 Upstream Services</h2>
      <table>
        <thead><tr><th>Service</th><th>Status</th><th>Backoff</th><th>Consecutive Failures</th><th>In-Flight</th></tr></thead>
        <tbody>
          ${['pskreporter'].map(svc => {
            const backedOff = upstream.isBackedOff(svc);
            const remaining = upstream.backoffRemaining(svc);
            const consecutive = upstream.backoffs.get(svc)?.consecutive || 0;
            const prefix = svc === 'pskreporter' ? ['psk:', 'wspr:'] : ['weather:'];
            const inFlight = [...upstream.inFlight.keys()].filter(k => prefix.some(p => k.startsWith(p))).length;
            const label = 'PSKReporter (WSPR Heatmap)';
            return `<tr>
              <td>${label}</td>
              <td style="color: ${backedOff ? '#ff4444' : '#00ff88'}">${backedOff ? '⛔ Backoff' : '✅ OK'}</td>
              <td>${backedOff ? remaining + 's' : '—'}</td>
              <td>${consecutive || '—'}</td>
              <td>${inFlight}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <p style="font-size: 11px; color: #888; margin-top: 8px">
        Weather: client-direct (Open-Meteo, per-user rate limits) · In-flight deduped: ${upstream.inFlight.size}
      </p>

      <h2>📡 PSKReporter MQTT Proxy</h2>
      <table>
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Broker Connection</td><td style="color: ${pskMqtt.connected ? '#00ff88' : '#ff4444'}">${pskMqtt.connected ? '✅ Connected' : '⛔ Disconnected'}</td></tr>
          <tr><td>Active Callsigns</td><td>${pskMqtt.subscribedCalls.size}</td></tr>
          <tr><td>SSE Clients</td><td>${[...pskMqtt.subscribers.values()].reduce((n, s) => n + s.size, 0)}</td></tr>
          <tr><td>Spots Received</td><td>${pskMqtt.stats.spotsReceived.toLocaleString()}</td></tr>
          <tr><td>Spots Relayed</td><td>${pskMqtt.stats.spotsRelayed.toLocaleString()}</td></tr>
          <tr><td>Messages Dropped</td><td>${pskMqtt.stats.messagesDropped}</td></tr>
          <tr><td>Buffered Spots</td><td>${[...pskMqtt.spotBuffer.values()].reduce((n, b) => n + b.length, 0)}</td></tr>
          <tr><td>Recent Spots Cache</td><td>${[...pskMqtt.recentSpots.values()].reduce((n, s) => n + s.length, 0)}</td></tr>
          <tr><td>Last Spot</td><td>${pskMqtt.stats.lastSpotTime ? new Date(pskMqtt.stats.lastSpotTime).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—'}</td></tr>
        </tbody>
      </table>
      ${pskMqtt.subscribedCalls.size > 0 ? `<p style="font-size: 11px; color: #888; margin-top: 8px">Subscribed: ${[...pskMqtt.subscribedCalls].join(', ')}</p>` : ''}
    </div>
    
    <div class="footer">
      <div>🔧 Built with ❤️ for Amateur Radio</div>
      <div style="margin-top: 8px">
        <a href="https://openhamclock.com">openhamclock.com</a> • 
        <a href="https://github.com/OpenHamClock/OpenHamClock">GitHub</a>
      </div>
      <a href="/api/health?format=json" class="json-link">📋 View as JSON</a>
    </div>
  </div>
</body>
</html>`;
}

app.get('/api/health', (req, res) => {
  rolloverVisitorStats();
  
  // SECURITY: Check if request is authenticated for full details
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.key || '';
  const isAuthed = API_WRITE_KEY && token === API_WRITE_KEY;
  
  // Check if browser wants HTML or explicitly requesting JSON
  const wantsJSON = req.query.format === 'json' || 
                    req.headers.accept?.includes('application/json') ||
                    !req.headers.accept?.includes('text/html');
  
  if (wantsJSON) {
    // JSON response for API consumers
    const avg = visitorStats.history.length > 0
      ? Math.round(visitorStats.history.reduce((sum, d) => sum + d.uniqueVisitors, 0) / visitorStats.history.length)
      : visitorStats.uniqueIPsToday.length;
    
    // Get endpoint monitoring stats
    const apiStats = endpointStats.getStats();
    
    res.json({
      status: 'ok',
      version: APP_VERSION,
      uptime: process.uptime(),
      uptimeFormatted: `${Math.floor(process.uptime() / 86400)}d ${Math.floor((process.uptime() % 86400) / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
      timestamp: new Date().toISOString(),
      // SECURITY: Only expose file paths and detailed internals to authenticated requests
      persistence: isAuthed ? {
        enabled: !!STATS_FILE,
        file: STATS_FILE || null,
        lastSaved: visitorStats.lastSaved
      } : { enabled: !!STATS_FILE },
      sessions: sessionTracker.getStats(),
      visitors: {
        today: {
          date: visitorStats.today,
          uniqueVisitors: visitorStats.uniqueIPsToday.length,
          totalRequests: visitorStats.totalRequestsToday,
          countries: Object.entries(visitorStats.countryStatsToday || {})
            .sort((a, b) => b[1] - a[1])
            .reduce((o, [k, v]) => { o[k] = v; return o; }, {})
        },
        allTime: {
          since: visitorStats.serverFirstStarted,
          uniqueVisitors: visitorStats.allTimeVisitors,
          totalRequests: visitorStats.allTimeRequests,
          deployments: visitorStats.deploymentCount,
          countries: Object.entries(visitorStats.countryStats || {})
            .sort((a, b) => b[1] - a[1])
            .reduce((o, [k, v]) => { o[k] = v; return o; }, {})
        },
        geoIP: {
          resolved: geoIPCache.size,
          pending: geoIPQueue.size,
          coverage: visitorStats.allTimeVisitors > 0 
            ? `${Math.round(geoIPCache.size / visitorStats.allTimeVisitors * 100)}%` 
            : '0%'
        },
        dailyAverage: avg,
        history: visitorStats.history.slice(-30) // Last 30 days
      },
      apiTraffic: {
        monitoringStarted: new Date(endpointStats.startTime).toISOString(),
        uptimeHours: apiStats.uptimeHours,
        totalRequests: apiStats.totalRequests,
        totalBytes: apiStats.totalBytes,
        totalBytesFormatted: formatBytes(apiStats.totalBytes),
        estimatedMonthlyGB: ((apiStats.totalBytes / parseFloat(apiStats.uptimeHours)) * 24 * 30 / (1024 * 1024 * 1024)).toFixed(2),
        endpoints: apiStats.endpoints.slice(0, 20) // Top 20 by bandwidth
      },
      upstream: {
        pskreporter: {
          status: upstream.isBackedOff('pskreporter') ? 'backoff' : 'ok',
          backoffRemaining: upstream.backoffRemaining('pskreporter'),
          consecutive: upstream.backoffs.get('pskreporter')?.consecutive || 0,
          inFlightRequests: [...upstream.inFlight.keys()].filter(k => k.startsWith('psk:') || k.startsWith('wspr:')).length
        },
        weather: {
          status: 'client-direct',
          note: 'All weather fetched directly by user browsers from Open-Meteo (per-user rate limits)'
        },
        totalInFlight: upstream.inFlight.size,
        pskMqttProxy: {
          connected: pskMqtt.connected,
          // SECURITY: Only expose active callsigns to authenticated requests
          activeCallsigns: isAuthed ? [...pskMqtt.subscribedCalls] : pskMqtt.subscribedCalls.size,
          sseClients: [...pskMqtt.subscribers.values()].reduce((n, s) => n + s.size, 0),
          spotsReceived: pskMqtt.stats.spotsReceived,
          spotsRelayed: pskMqtt.stats.spotsRelayed,
          messagesDropped: pskMqtt.stats.messagesDropped,
          bufferedSpots: [...pskMqtt.spotBuffer.values()].reduce((n, b) => n + b.length, 0),
          recentSpotsCache: [...pskMqtt.recentSpots.values()].reduce((n, s) => n + s.length, 0),
          lastSpotTime: pskMqtt.stats.lastSpotTime ? new Date(pskMqtt.stats.lastSpotTime).toISOString() : null
        }
      }
    });
  } else {
    // HTML dashboard for browsers
    res.type('html').send(generateStatusDashboard());
  }
});


// ============================================
// CONFIGURATION ENDPOINT
// ============================================

// Lightweight version check (for auto-refresh polling)
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store');
  res.json({ version: APP_VERSION });
});

// ============================================
// USER SETTINGS SYNC (SERVER-SIDE PERSISTENCE)
// ============================================
// Stores all UI settings (layout, panels, filters, etc.) on the server
// so they persist across all devices accessing the same OHC instance.
// ONLY for self-hosted/Pi deployments — disabled by default.
// Enable with SETTINGS_SYNC=true in .env
// On multi-user hosted deployments (openhamclock.com), leave disabled —
// settings stay in each user's browser localStorage.

const SETTINGS_SYNC_ENABLED = (process.env.SETTINGS_SYNC || '').toLowerCase() === 'true';

function getSettingsFilePath() {
  if (!SETTINGS_SYNC_ENABLED) return null;
  // Same directory strategy as stats file
  const pathsToTry = [
    process.env.SETTINGS_FILE,
    '/data/settings.json',
    path.join(__dirname, 'data', 'settings.json'),
    '/tmp/openhamclock-settings.json'
  ].filter(Boolean);
  
  for (const settingsPath of pathsToTry) {
    try {
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Test write permission
      const testFile = path.join(dir, '.settings-test-' + Date.now());
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return settingsPath;
    } catch {}
  }
  return null;
}

const SETTINGS_FILE = getSettingsFilePath();
if (SETTINGS_SYNC_ENABLED && SETTINGS_FILE) logInfo(`[Settings] ✓ Sync enabled, using: ${SETTINGS_FILE}`);
else if (SETTINGS_SYNC_ENABLED) logWarn('[Settings] Sync enabled but no writable path found');
else logInfo('[Settings] Sync disabled (set SETTINGS_SYNC=true in .env to enable)');

function loadServerSettings() {
  if (!SETTINGS_SYNC_ENABLED || !SETTINGS_FILE) return null;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {
    logWarn('[Settings] Failed to load:', e.message);
  }
  return {};
}

function saveServerSettings(settings) {
  if (!SETTINGS_SYNC_ENABLED || !SETTINGS_FILE) return false;
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) {
    logWarn('[Settings] Failed to save:', e.message);
    return false;
  }
}

// GET /api/settings — return saved UI settings (or 404 if sync disabled)
app.get('/api/settings', (req, res) => {
  if (!SETTINGS_SYNC_ENABLED) {
    return res.status(404).json({ enabled: false });
  }
  const settings = loadServerSettings();
  res.json(settings || {});
});

// POST /api/settings — save UI settings (or 404 if sync disabled)
app.post('/api/settings', writeLimiter, requireWriteAuth, (req, res) => {
  if (!SETTINGS_SYNC_ENABLED) {
    return res.status(404).json({ enabled: false });
  }
  const settings = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Invalid settings object' });
  }
  
  // Only allow openhamclock_* and ohc_* keys (security: prevent arbitrary data injection)
  const filtered = {};
  for (const [key, value] of Object.entries(settings)) {
    if ((key.startsWith('openhamclock_') || key.startsWith('ohc_')) && typeof value === 'string') {
      filtered[key] = value;
    }
  }
  
  if (saveServerSettings(filtered)) {
    res.json({ ok: true, keys: Object.keys(filtered).length });
  } else {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Serve station configuration to frontend
// This allows the frontend to get config from .env/config.json without exposing secrets
app.get('/api/config', (req, res) => {
  // Don't expose API keys/passwords - only public config
  res.json({
    version: APP_VERSION,
    
    // Station info (from .env or config.json)
    callsign: CONFIG.callsign,
    locator: CONFIG.gridSquare,
    latitude: CONFIG.latitude,
    longitude: CONFIG.longitude,
    
    // Display preferences
    units: CONFIG.units,
    timeFormat: CONFIG.timeFormat,
    theme: CONFIG.theme,
    layout: CONFIG.layout,
    
    // DX target
    dxLatitude: CONFIG.dxLatitude,
    dxLongitude: CONFIG.dxLongitude,
    
    // Feature toggles
    showSatellites: CONFIG.showSatellites,
    showPota: CONFIG.showPota,
    showDxPaths: CONFIG.showDxPaths,
    showContests: CONFIG.showContests,
    showDXpeditions: CONFIG.showDXpeditions,
    
    // DX Cluster settings
    spotRetentionMinutes: CONFIG.spotRetentionMinutes,
    dxClusterSource: CONFIG.dxClusterSource,
    
    // Whether config is incomplete (show setup wizard)
    configIncomplete: CONFIG.callsign === 'N0CALL' || !CONFIG.gridSquare,
    
    // Server timezone (from TZ env var or system)
    timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    
    // Feature availability
    features: {
      spaceWeather: true,
      pota: true,
      sota: true,
      dxCluster: true,
      satellites: true,
      contests: true,
      dxpeditions: true,
      wsjtxRelay: !!WSJTX_RELAY_KEY,
      settingsSync: SETTINGS_SYNC_ENABLED,
    },
    
    // Refresh intervals (ms)
    refreshIntervals: {
      spaceWeather: 300000,
      pota: 60000,
      sota: 60000,
      dxCluster: 30000
    }
  });
});

// ============================================
// WEATHER (backward-compatible stub)
// ============================================
// Weather is now fetched directly by each user's browser from Open-Meteo.
// This stub exists so old cached client JS (pre-v15.1.7) that still calls
// /api/weather doesn't get a 404 and crash with a blank screen.
// The old client already handles the _direct response and falls through to Open-Meteo.
// New clients never hit this endpoint.
app.get('/api/weather', (req, res) => {
  res.json({ _direct: true, _source: 'client-openmeteo' });
});

// ============================================
// MANUAL UPDATE ENDPOINT
// ============================================
app.post('/api/update', writeLimiter, requireWriteAuth, async (req, res) => {
  if (autoUpdateState.inProgress) {
    return res.status(409).json({ error: 'Update already in progress' });
  }

  try {
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
      return res.status(503).json({ error: 'Not a git repository' });
    }
    await execFilePromise('git', ['--version']);
  } catch (err) {
    return res.status(500).json({ error: 'Update preflight failed' });
  }

  // Respond immediately; update runs asynchronously
  res.json({ ok: true, started: true, timestamp: Date.now() });

  setTimeout(() => {
    autoUpdateTick('manual', true);
  }, 100);
});

app.get('/api/update/status', (req, res) => {
  res.json({
    enabled: AUTO_UPDATE_ENABLED,
    inProgress: autoUpdateState.inProgress,
    lastCheck: autoUpdateState.lastCheck,
    lastResult: autoUpdateState.lastResult
  });
});

// ============================================
// WSJT-X UDP LISTENER
// ============================================
// Receives decoded messages from WSJT-X, JTDX, etc.
// Configure WSJT-X: Settings > Reporting > UDP Server > address/port
// Protocol: QDataStream binary format per NetworkMessage.hpp

const WSJTX_UDP_PORT = parseInt(process.env.WSJTX_UDP_PORT || '2237');
const WSJTX_ENABLED = process.env.WSJTX_ENABLED !== 'false'; // enabled by default
const WSJTX_RELAY_KEY = process.env.WSJTX_RELAY_KEY || ''; // auth key for remote relay agent
const WSJTX_MAX_DECODES = 500; // max decodes to keep in memory
const WSJTX_MAX_AGE = 60 * 60 * 1000; // 60 minutes (configurable via client)

// WSJT-X protocol magic number
const WSJTX_MAGIC = 0xADBCCBDA;

// Message types
const WSJTX_MSG = {
  HEARTBEAT: 0,
  STATUS: 1,
  DECODE: 2,
  CLEAR: 3,
  REPLY: 4,
  QSO_LOGGED: 5,
  CLOSE: 6,
  REPLAY: 7,
  HALT_TX: 8,
  FREE_TEXT: 9,
  WSPR_DECODE: 10,
  LOCATION: 11,
  LOGGED_ADIF: 12,
  HIGHLIGHT_CALLSIGN: 13,
  SWITCH_CONFIG: 14,
  CONFIGURE: 15,
};

// In-memory store (for local UDP — no session)
const wsjtxState = {
  clients: {},    // clientId -> { status, lastSeen }
  decodes: [],    // decoded messages (ring buffer)
  qsos: [],       // logged QSOs
  wspr: [],       // WSPR decodes
  relay: null,    // not used for local UDP
};

// Per-session relay storage — each browser gets its own isolated data
const wsjtxRelaySessions = {};  // sessionId -> { clients, decodes, qsos, wspr, relay, lastAccess }
const WSJTX_SESSION_MAX_AGE = 60 * 60 * 1000; // 1 hour inactive expiry
const WSJTX_MAX_SESSIONS = 50; // prevent memory abuse

function getRelaySession(sessionId) {
  if (!sessionId) return null;
  if (!wsjtxRelaySessions[sessionId]) {
    // Check session limit
    if (Object.keys(wsjtxRelaySessions).length >= WSJTX_MAX_SESSIONS) {
      // Evict oldest session
      let oldestId = null, oldestTime = Infinity;
      for (const [id, s] of Object.entries(wsjtxRelaySessions)) {
        if (s.lastAccess < oldestTime) { oldestTime = s.lastAccess; oldestId = id; }
      }
      if (oldestId) delete wsjtxRelaySessions[oldestId];
    }
    wsjtxRelaySessions[sessionId] = {
      clients: {}, decodes: [], qsos: [], wspr: [],
      relay: null, lastAccess: Date.now()
    };
  }
  wsjtxRelaySessions[sessionId].lastAccess = Date.now();
  return wsjtxRelaySessions[sessionId];
}

// Cleanup expired sessions and stale grid cache entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of Object.entries(wsjtxRelaySessions)) {
    if (now - session.lastAccess > WSJTX_SESSION_MAX_AGE) {
      delete wsjtxRelaySessions[id];
    }
  }
  // Prune grid cache entries older than 2 hours
  const gridCutoff = now - 2 * 60 * 60 * 1000;
  for (const [call, entry] of wsjtxGridCache) {
    if (entry.timestamp < gridCutoff) wsjtxGridCache.delete(call);
  }
}, 5 * 60 * 1000);

/**
 * QDataStream binary reader for WSJT-X protocol
 * Reads big-endian Qt-serialized data types
 */
class WSJTXReader {
  constructor(buffer) {
    this.buf = buffer;
    this.offset = 0;
  }
  
  remaining() { return this.buf.length - this.offset; }
  
  readUInt8() {
    if (this.remaining() < 1) return null;
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  
  readInt32() {
    if (this.remaining() < 4) return null;
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  
  readUInt32() {
    if (this.remaining() < 4) return null;
    const v = this.buf.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  
  readUInt64() {
    if (this.remaining() < 8) return null;
    // JavaScript can't do 64-bit ints natively, use BigInt or approximate
    const high = this.buf.readUInt32BE(this.offset);
    const low = this.buf.readUInt32BE(this.offset + 4);
    this.offset += 8;
    return high * 0x100000000 + low;
  }
  
  readBool() {
    const v = this.readUInt8();
    return v === null ? null : v !== 0;
  }
  
  readDouble() {
    if (this.remaining() < 8) return null;
    const v = this.buf.readDoubleBE(this.offset);
    this.offset += 8;
    return v;
  }
  
  // Qt utf8 string: uint32 length + bytes (0xFFFFFFFF = null)
  readUtf8() {
    const len = this.readUInt32();
    if (len === null || len === 0xFFFFFFFF) return null;
    if (len === 0) return '';
    if (this.remaining() < len) return null;
    const str = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return str;
  }
  
  // QTime: uint32 milliseconds since midnight
  readQTime() {
    const ms = this.readUInt32();
    if (ms === null) return null;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return { ms, hours: h, minutes: m, seconds: s, 
             formatted: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` };
  }
  
  // QDateTime: QDate (int64 julian day) + QTime (uint32 ms) + timespec
  readQDateTime() {
    const julianDay = this.readUInt64();
    const time = this.readQTime();
    const timeSpec = this.readUInt8();
    if (timeSpec === 2) this.readInt32(); // UTC offset
    return { julianDay, time, timeSpec };
  }
}

/**
 * Parse a WSJT-X UDP datagram
 */
function parseWSJTXMessage(buffer) {
  const reader = new WSJTXReader(buffer);
  
  // Header
  const magic = reader.readUInt32();
  if (magic !== WSJTX_MAGIC) return null;
  
  const schema = reader.readUInt32();
  const type = reader.readUInt32();
  const id = reader.readUtf8();
  
  if (type === null || id === null) return null;
  
  const msg = { type, id, schema, timestamp: Date.now() };
  
  try {
    switch (type) {
      case WSJTX_MSG.HEARTBEAT: {
        msg.maxSchema = reader.readUInt32();
        msg.version = reader.readUtf8();
        msg.revision = reader.readUtf8();
        break;
      }
      
      case WSJTX_MSG.STATUS: {
        msg.dialFrequency = reader.readUInt64();
        msg.mode = reader.readUtf8();
        msg.dxCall = reader.readUtf8();
        msg.report = reader.readUtf8();
        msg.txMode = reader.readUtf8();
        msg.txEnabled = reader.readBool();
        msg.transmitting = reader.readBool();
        msg.decoding = reader.readBool();
        msg.rxDF = reader.readUInt32();
        msg.txDF = reader.readUInt32();
        msg.deCall = reader.readUtf8();
        msg.deGrid = reader.readUtf8();
        msg.dxGrid = reader.readUtf8();
        msg.txWatchdog = reader.readBool();
        msg.subMode = reader.readUtf8();
        msg.fastMode = reader.readBool();
        msg.specialOp = reader.readUInt8();
        msg.freqTolerance = reader.readUInt32();
        msg.trPeriod = reader.readUInt32();
        msg.configName = reader.readUtf8();
        msg.txMessage = reader.readUtf8();
        break;
      }
      
      case WSJTX_MSG.DECODE: {
        msg.isNew = reader.readBool();
        msg.time = reader.readQTime();
        msg.snr = reader.readInt32();
        msg.deltaTime = reader.readDouble();
        msg.deltaFreq = reader.readUInt32();
        msg.mode = reader.readUtf8();
        msg.message = reader.readUtf8();
        msg.lowConfidence = reader.readBool();
        msg.offAir = reader.readBool();
        break;
      }
      
      case WSJTX_MSG.CLEAR: {
        msg.window = reader.readUInt8();
        break;
      }
      
      case WSJTX_MSG.QSO_LOGGED: {
        msg.dateTimeOff = reader.readQDateTime();
        msg.dxCall = reader.readUtf8();
        msg.dxGrid = reader.readUtf8();
        msg.txFrequency = reader.readUInt64();
        msg.mode = reader.readUtf8();
        msg.reportSent = reader.readUtf8();
        msg.reportRecv = reader.readUtf8();
        msg.txPower = reader.readUtf8();
        msg.comments = reader.readUtf8();
        msg.name = reader.readUtf8();
        msg.dateTimeOn = reader.readQDateTime();
        msg.operatorCall = reader.readUtf8();
        msg.myCall = reader.readUtf8();
        msg.myGrid = reader.readUtf8();
        msg.exchangeSent = reader.readUtf8();
        msg.exchangeRecv = reader.readUtf8();
        msg.adifPropMode = reader.readUtf8();
        break;
      }
      
      case WSJTX_MSG.WSPR_DECODE: {
        msg.isNew = reader.readBool();
        msg.time = reader.readQTime();
        msg.snr = reader.readInt32();
        msg.deltaTime = reader.readDouble();
        msg.frequency = reader.readUInt64();
        msg.drift = reader.readInt32();
        msg.callsign = reader.readUtf8();
        msg.grid = reader.readUtf8();
        msg.power = reader.readInt32();
        msg.offAir = reader.readBool();
        break;
      }
      
      case WSJTX_MSG.LOGGED_ADIF: {
        msg.adif = reader.readUtf8();
        break;
      }
      
      case WSJTX_MSG.CLOSE:
        break;
        
      default:
        // Unknown message type - ignore per protocol spec
        return null;
    }
  } catch (e) {
    // Malformed packet - ignore
    return null;
  }
  
  return msg;
}

/**
 * Parse decoded message text to extract callsigns and grid
 * FT8/FT4 messages follow a standard format
 */
// Callsign → grid cache: remembers grids seen in CQ messages for later QSO exchanges
const wsjtxGridCache = new Map(); // callsign → { grid, lat, lon, timestamp }
const wsjtxHamqthInflight = new Set(); // callsigns currently being looked up (prevents duplicate requests)

function parseDecodeMessage(text) {
  if (!text) return {};
  const result = {};
  
  // FT8/FT4 protocol tokens that look like valid Maidenhead grids but aren't
  // RR73 matches [A-R]{2}\d{2} but is a QSO acknowledgment
  const FT8_TOKENS = new Set(['RR73', 'RR53', 'RR13', 'RR23', 'RR33', 'RR43', 'RR63', 'RR83', 'RR93']);
  
  // Validate grid: must be valid Maidenhead AND not an FT8 protocol token
  function isGrid(s) {
    if (!s || s.length < 4) return false;
    const g = s.toUpperCase();
    if (FT8_TOKENS.has(g)) return false;
    return /^[A-R]{2}\d{2}(?:[A-Xa-x]{2})?$/.test(s);
  }
  
  // Grid square regex: 2 alpha (A-R) + 2 digits, optionally + 2 alpha (a-x)
  const gridRegex = /\b([A-R]{2}\d{2}(?:[a-x]{2})?)\b/i;
  
  // ── CQ messages ──
  // Format: "CQ [modifier] CALLSIGN [GRID]"
  // Examples: "CQ K1ABC FN42", "CQ DX K1ABC FN42", "CQ POTA N0VIG EM28", "CQ K1ABC"
  if (/^CQ\s/i.test(text)) {
    result.type = 'CQ';
    const tokens = text.split(/\s+/).slice(1); // drop "CQ"
    
    // Work backwards: last token might be a grid
    let grid = null;
    if (tokens.length >= 2 && isGrid(tokens[tokens.length - 1])) {
      grid = tokens.pop();
    }
    
    // Remaining tokens: [modifier] CALLSIGN
    // The callsign is always the LAST remaining token
    // Modifiers (DX, POTA, NA, EU, etc.) come before it
    if (tokens.length >= 1) {
      result.caller = tokens[tokens.length - 1];
      result.modifier = tokens.length >= 2 ? tokens.slice(0, -1).join(' ') : null;
    }
    
    result.grid = grid;
    
    // Cache this callsign's grid for future lookups
    if (result.caller && result.grid) {
      const coords = gridToLatLon(result.grid);
      if (coords) {
        wsjtxGridCache.set(result.caller.toUpperCase(), {
          grid: result.grid,
          lat: coords.latitude,
          lon: coords.longitude,
          timestamp: Date.now()
        });
      }
    }
    return result;
  }
  
  // ── Standard QSO exchange ──
  // Format: "DXCALL DECALL EXCHANGE"
  // Exchange can be: grid (EN82), report (+05, -12, R+05, R-12), 73, RR73, RRR
  const qsoMatch = text.match(/^([A-Z0-9/<>.]+)\s+([A-Z0-9/<>.]+)\s+(.*)/i);
  if (qsoMatch) {
    result.type = 'QSO';
    result.dxCall = qsoMatch[1];
    result.deCall = qsoMatch[2];
    result.exchange = qsoMatch[3].trim();
    
    // Look for a grid square in the exchange, but NOT FT8 protocol tokens
    const gridMatch = result.exchange.match(gridRegex);
    if (gridMatch && isGrid(gridMatch[1])) {
      result.grid = gridMatch[1];
      // Cache grid — in exchange it typically belongs to the calling station (dxCall)
      const coords = gridToLatLon(result.grid);
      if (coords) {
        wsjtxGridCache.set(result.dxCall.toUpperCase(), {
          grid: result.grid,
          lat: coords.latitude,
          lon: coords.longitude,
          timestamp: Date.now()
        });
      }
    }
    return result;
  }
  
  return result;
}

/**
 * Convert frequency in Hz to band name
 */
function freqToBand(freqHz) {
  const mhz = freqHz / 1000000;
  if (mhz >= 1.8 && mhz < 2.0) return '160m';
  if (mhz >= 3.5 && mhz < 4.0) return '80m';
  if (mhz >= 5.3 && mhz < 5.4) return '60m';
  if (mhz >= 7.0 && mhz < 7.3) return '40m';
  if (mhz >= 10.1 && mhz < 10.15) return '30m';
  if (mhz >= 14.0 && mhz < 14.35) return '20m';
  if (mhz >= 18.068 && mhz < 18.168) return '17m';
  if (mhz >= 21.0 && mhz < 21.45) return '15m';
  if (mhz >= 24.89 && mhz < 24.99) return '12m';
  if (mhz >= 28.0 && mhz < 29.7) return '10m';
  if (mhz >= 50.0 && mhz < 54.0) return '6m';
  if (mhz >= 144.0 && mhz < 148.0) return '2m';
  if (mhz >= 420.0 && mhz < 450.0) return '70cm';
  return `${mhz.toFixed(3)} MHz`;
}

/**
 * Handle incoming WSJT-X messages
 * @param {Object} msg - parsed WSJT-X message
 * @param {Object} state - state object to update (wsjtxState for local, session for relay)
 */
function handleWSJTXMessage(msg, state) {
  if (!msg) return;
  if (!state) state = wsjtxState;
  
  switch (msg.type) {
    case WSJTX_MSG.HEARTBEAT: {
      state.clients[msg.id] = {
        ...(state.clients[msg.id] || {}),
        version: msg.version,
        lastSeen: msg.timestamp
      };
      break;
    }
    
    case WSJTX_MSG.STATUS: {
      state.clients[msg.id] = {
        ...(state.clients[msg.id] || {}),
        lastSeen: msg.timestamp,
        dialFrequency: msg.dialFrequency,
        mode: msg.mode,
        dxCall: msg.dxCall,
        deCall: msg.deCall,
        deGrid: msg.deGrid,
        txEnabled: msg.txEnabled,
        transmitting: msg.transmitting,
        decoding: msg.decoding,
        subMode: msg.subMode,
        band: msg.dialFrequency ? freqToBand(msg.dialFrequency) : null,
        configName: msg.configName,
        txMessage: msg.txMessage,
      };
      break;
    }
    
    case WSJTX_MSG.DECODE: {
      const clientStatus = state.clients[msg.id] || {};
      const parsed = parseDecodeMessage(msg.message);
      
      const decode = {
        id: `${msg.id}-${msg.timestamp}-${msg.deltaFreq}`,
        clientId: msg.id,
        isNew: msg.isNew,
        time: msg.time?.formatted || '',
        timeMs: msg.time?.ms || 0,
        snr: msg.snr,
        dt: msg.deltaTime ? msg.deltaTime.toFixed(1) : '0.0',
        freq: msg.deltaFreq,
        mode: msg.mode || clientStatus.mode || '',
        message: msg.message,
        lowConfidence: msg.lowConfidence,
        offAir: msg.offAir,
        dialFrequency: clientStatus.dialFrequency || 0,
        band: clientStatus.band || '',
        ...parsed,
        timestamp: msg.timestamp,
      };
      
      // Resolve grid to lat/lon for map plotting
      if (parsed.grid) {
        const coords = gridToLatLon(parsed.grid);
        if (coords) {
          decode.lat = coords.latitude;
          decode.lon = coords.longitude;
        }
      }
      
      // If no grid from message, try callsign → grid cache (from prior CQ/exchange with grid)
      if (!decode.lat) {
        const targetCall = (parsed.caller || parsed.dxCall || '').toUpperCase();
        if (targetCall) {
          const cached = wsjtxGridCache.get(targetCall);
          if (cached) {
            decode.lat = cached.lat;
            decode.lon = cached.lon;
            decode.grid = decode.grid || cached.grid;
            decode.gridSource = 'cache';
          }
        }
      }
      
      // Try HamQTH callsign cache (DXCC-level, more accurate than prefix centroid)
      if (!decode.lat) {
        const targetCall = (parsed.caller || parsed.dxCall || '').toUpperCase();
        if (targetCall) {
          const cached = callsignLookupCache.get(targetCall);
          if (cached && (Date.now() - cached.timestamp) < CALLSIGN_CACHE_TTL && cached.data?.lat != null) {
            decode.lat = cached.data.lat;
            decode.lon = cached.data.lon;
            decode.gridSource = 'hamqth';
          } else if (targetCall.length >= 3 && !wsjtxHamqthInflight.has(targetCall) && wsjtxHamqthInflight.size < 5) {
            // Background lookup for next cycle (fire-and-forget, max 5 concurrent)
            wsjtxHamqthInflight.add(targetCall);
            fetch(`https://www.hamqth.com/dxcc.php?callsign=${encodeURIComponent(targetCall)}`, {
              headers: { 'User-Agent': 'OpenHamClock/' + APP_VERSION },
              signal: AbortSignal.timeout(5000)
            }).then(async (resp) => {
              if (!resp.ok) return;
              const text = await resp.text();
              const latMatch = text.match(/<lat>([^<]+)<\/lat>/);
              const lonMatch = text.match(/<lng>([^<]+)<\/lng>/);
              const countryMatch = text.match(/<n>([^<]+)<\/name>/);
              if (latMatch && lonMatch) {
                callsignLookupCache.set(targetCall, {
                  data: {
                    callsign: targetCall,
                    lat: parseFloat(latMatch[1]),
                    lon: parseFloat(lonMatch[1]),
                    country: countryMatch ? countryMatch[1] : ''
                  },
                  timestamp: Date.now()
                });
              }
            }).finally(() => { wsjtxHamqthInflight.delete(targetCall); });
          }
        }
      }
      
      // Last resort: estimate from callsign prefix
      if (!decode.lat) {
        const targetCall = parsed.caller || parsed.dxCall || '';
        if (targetCall) {
          const prefixLoc = estimateLocationFromPrefix(targetCall);
          if (prefixLoc) {
            decode.lat = prefixLoc.lat;
            decode.lon = prefixLoc.lon;
            decode.grid = decode.grid || prefixLoc.grid;
            decode.gridSource = 'prefix';
          }
        }
      }
      
      // Only keep new decodes (not replays)
      if (msg.isNew) {
        state.decodes.push(decode);
        
        // Trim old decodes
        const cutoff = Date.now() - WSJTX_MAX_AGE;
        while (state.decodes.length > WSJTX_MAX_DECODES || 
               (state.decodes.length > 0 && state.decodes[0].timestamp < cutoff)) {
          state.decodes.shift();
        }
      }
      break;
    }
    
    case WSJTX_MSG.CLEAR: {
      // WSJT-X cleared its band activity - optionally clear our decodes for this client
      state.decodes = state.decodes.filter(d => d.clientId !== msg.id);
      break;
    }
    
    case WSJTX_MSG.QSO_LOGGED: {
      const clientStatus = state.clients[msg.id] || {};
      const qso = {
        clientId: msg.id,
        dxCall: msg.dxCall,
        dxGrid: msg.dxGrid,
        frequency: msg.txFrequency,
        band: msg.txFrequency ? freqToBand(msg.txFrequency) : '',
        mode: msg.mode,
        reportSent: msg.reportSent,
        reportRecv: msg.reportRecv,
        myCall: msg.myCall || clientStatus.deCall,
        myGrid: msg.myGrid || clientStatus.deGrid,
        timestamp: msg.timestamp,
      };
      // Resolve grid to lat/lon
      if (msg.dxGrid) {
        const coords = gridToLatLon(msg.dxGrid);
        if (coords) { qso.lat = coords.latitude; qso.lon = coords.longitude; }
      }
      state.qsos.push(qso);
      // Keep last 50 QSOs
      if (state.qsos.length > 50) state.qsos.shift();
      break;
    }
    
    case WSJTX_MSG.WSPR_DECODE: {
      const wsprDecode = {
        clientId: msg.id,
        isNew: msg.isNew,
        time: msg.time?.formatted || '',
        snr: msg.snr,
        dt: msg.deltaTime ? msg.deltaTime.toFixed(1) : '0.0',
        frequency: msg.frequency,
        drift: msg.drift,
        callsign: msg.callsign,
        grid: msg.grid,
        power: msg.power,
        timestamp: msg.timestamp,
      };
      if (msg.isNew) {
        state.wspr.push(wsprDecode);
        if (state.wspr.length > 100) state.wspr.shift();
      }
      break;
    }
    
    case WSJTX_MSG.CLOSE: {
      delete state.clients[msg.id];
      break;
    }
  }
}

// ---- N3FJP Logged QSO relay (in-memory) ----
const N3FJP_QSO_RETENTION_MINUTES = parseInt(process.env.N3FJP_QSO_RETENTION_MINUTES || "15", 10);
let n3fjpQsos = [];

function pruneN3fjpQsos() {
  const cutoff = Date.now() - (N3FJP_QSO_RETENTION_MINUTES * 60 * 1000);
  n3fjpQsos = n3fjpQsos.filter(q => {
    const t = Date.parse(q.ts_utc || q.ts || "");
    return !Number.isNaN(t) && t >= cutoff;
  });
}

// Simple in-memory cache so we don't hammer callsign lookup on every QSO
const n3fjpCallCache = new Map(); // key=callsign, val={ts, result}
const N3FJP_CALL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function lookupCallLatLon(callsign) {
  const call = (callsign || "").toUpperCase().trim();
  if (!call) return null;

  const cached = n3fjpCallCache.get(call);
  if (cached && (Date.now() - cached.ts) < N3FJP_CALL_CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    // Reuse your existing endpoint (keeps all HamQTH/grid logic in one place)
    const resp = await fetch(`http://localhost:${PORT}/api/callsign/${encodeURIComponent(call)}`);
    if (!resp.ok) return null;

    const data = await resp.json();
    if (typeof data.lat === "number" && typeof data.lon === "number") {
      n3fjpCallCache.set(call, { ts: Date.now(), result: data });
      return data;
    }
  } catch (e) {
    // swallow: mapping should never crash the server
  }
  return null;
}

// POST one QSO from a bridge (your Python script)
app.post("/api/n3fjp/qso", writeLimiter, requireWriteAuth, async (req, res) => {
  const qso = req.body || {};
  if (!qso.dx_call) return res.status(400).json({ ok: false, error: "dx_call required" });

  if (!qso.ts_utc) qso.ts_utc = new Date().toISOString();
  if (!qso.source) qso.source = "n3fjp_to_timemapper_udp";

  // Always ACK immediately so the bridge never times out
  res.json({ ok: true });

  // Do enrichment + storage after ACK
  setImmediate(async () => {
    try {
      //
      // Enrich DX location: GRID → (preferred) → HamQTH fallback
      //
      let locSource = "";

      // 1) Prefer exact operating grid (N3FJP “Grid Rec” field)
      if (qso.dx_grid) {
        const loc = maidenheadToLatLon(qso.dx_grid);
        if (loc) {
          qso.lat = loc.lat;
          qso.lon = loc.lon;
          qso.loc_source = "grid";
          locSource = "grid";
        }
      }

      // 2) If no grid provided, fall back to HamQTH/home QTH lookup
      if (!locSource) {
        const dx = await lookupCallLatLon(qso.dx_call);
        if (dx) {
          qso.lat = dx.lat;
          qso.lon = dx.lon;
          qso.dx_country = dx.country || "";
          qso.dx_cqZone = dx.cqZone || "";
          qso.dx_ituZone = dx.ituZone || "";
          qso.loc_source = "hamqth";
        }
      }

      n3fjpQsos.unshift(qso);
      pruneN3fjpQsos();

      // cap memory
      if (n3fjpQsos.length > 200) n3fjpQsos.length = 200;
    } catch (e) {
      console.error("[/api/n3fjp/qso] post-ack processing failed:", e);
    }
  });
});

// GET recent QSOs (pruned to retention window)
app.get("/api/n3fjp/qsos", (req, res) => {
  pruneN3fjpQsos();
  res.json({ ok: true, retention_minutes: N3FJP_QSO_RETENTION_MINUTES, qsos: n3fjpQsos });
});

// Start UDP listener
let wsjtxSocket = null;
if (WSJTX_ENABLED) {
  try {
    wsjtxSocket = dgram.createSocket('udp4');
    
    wsjtxSocket.on('message', (buf, rinfo) => {
      const msg = parseWSJTXMessage(buf);
      if (msg) handleWSJTXMessage(msg);
    });
    
    wsjtxSocket.on('error', (err) => {
      logErrorOnce('WSJT-X UDP', err.message);
    });
    
    wsjtxSocket.on('listening', () => {
      const addr = wsjtxSocket.address();
      console.log(`[WSJT-X] UDP listener on ${addr.address}:${addr.port}`);
    });
    
    wsjtxSocket.bind(WSJTX_UDP_PORT, '0.0.0.0');
  } catch (e) {
    console.error(`[WSJT-X] Failed to start UDP listener: ${e.message}`);
  }
}

// API endpoint: get WSJT-X data
app.get('/api/wsjtx', (req, res) => {
  const sessionId = req.query.session || '';
  
  // Use session-specific state for relay mode, or global state for local UDP
  const state = (sessionId && WSJTX_RELAY_KEY) ? (wsjtxRelaySessions[sessionId] || { clients: {}, decodes: [], qsos: [], wspr: [], relay: null }) : wsjtxState;
  
  const clients = {};
  for (const [id, client] of Object.entries(state.clients)) {
    // Only include clients seen in last 5 minutes
    if (Date.now() - client.lastSeen < 5 * 60 * 1000) {
      clients[id] = client;
    }
  }
  
  // Relay is "connected" if this session's relay was seen in last 60 seconds
  const relayConnected = state.relay && (Date.now() - state.relay.lastSeen < 60000);
  
  res.json({
    enabled: WSJTX_ENABLED,
    port: WSJTX_UDP_PORT,
    relayEnabled: !!WSJTX_RELAY_KEY,
    relayConnected: !!relayConnected,
    clients,
    decodes: state.decodes.slice(-100), // last 100
    qsos: state.qsos.slice(-20), // last 20
    wspr: state.wspr.slice(-50), // last 50
    stats: {
      totalDecodes: state.decodes.length,
      totalQsos: state.qsos.length,
      totalWspr: state.wspr.length,
      activeClients: Object.keys(clients).length,
    }
  });
});

// API endpoint: get just decodes (lightweight polling)
app.get('/api/wsjtx/decodes', (req, res) => {
  const sessionId = req.query.session || '';
  const state = (sessionId && WSJTX_RELAY_KEY) ? (wsjtxRelaySessions[sessionId] || { decodes: [] }) : wsjtxState;
  
  const since = parseInt(req.query.since) || 0;
  const decodes = since 
    ? state.decodes.filter(d => d.timestamp > since)
    : state.decodes.slice(-100);
  
  res.json({ decodes, timestamp: Date.now() });
});

// API endpoint: relay — receive messages from remote relay agent
// The relay agent runs on the same machine as WSJT-X and forwards
// parsed messages over HTTPS for cloud-hosted instances.
app.post('/api/wsjtx/relay', (req, res) => {
  // Auth check
  if (!WSJTX_RELAY_KEY) {
    return res.status(503).json({ error: 'Relay not configured — set WSJTX_RELAY_KEY in .env' });
  }
  
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== WSJTX_RELAY_KEY) {
    return res.status(401).json({ error: 'Invalid relay key' });
  }
  
  // Session ID is required for relay — isolates data per browser
  const sessionId = req.body.session || req.headers['x-relay-session'] || '';
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }
  
  const session = getRelaySession(sessionId);
  
  // Relay heartbeat — just registers the relay as alive for this session
  if (req.body && req.body.relay === true) {
    session.relay = {
      lastSeen: Date.now(),
      version: req.body.version || '1.0.0',
      port: req.body.port || 2237,
    };
    return res.json({ ok: true, timestamp: Date.now() });
  }
  
  // Regular message batch
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided' });
  }
  
  // Update relay last seen on every batch too
  session.relay = { ...(session.relay || {}), lastSeen: Date.now() };
  
  // Rate limit: max 100 messages per request
  const batch = messages.slice(0, 100);
  let processed = 0;
  
  for (const msg of batch) {
    if (msg && typeof msg.type === 'number' && msg.id) {
      // Ensure timestamp is reasonable (within last 5 minutes or use server time)
      if (!msg.timestamp || Math.abs(Date.now() - msg.timestamp) > 5 * 60 * 1000) {
        msg.timestamp = Date.now();
      }
      handleWSJTXMessage(msg, session);
      processed++;
    }
  }
  
  res.json({ ok: true, processed, timestamp: Date.now() });
});

// API endpoint: serve raw relay.js (used by Windows .bat launcher)
app.get('/api/wsjtx/relay/agent.js', (req, res) => {
  const relayJsPath = path.join(__dirname, 'wsjtx-relay', 'relay.js');
  try {
    const content = fs.readFileSync(relayJsPath, 'utf8');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(content);
  } catch (e) {
    res.status(500).json({ error: 'relay.js not found on server' });
  }
});

// API endpoint: download pre-configured relay agent script
// Embeds relay.js + server URL + relay key into a one-file launcher
app.get('/api/wsjtx/relay/download/:platform', (req, res) => {
  if (!WSJTX_RELAY_KEY) {
    return res.status(503).json({ error: 'Relay not configured — set WSJTX_RELAY_KEY in .env' });
  }
  
  const platform = req.params.platform; // 'linux', 'mac', or 'windows'
  const relayJsPath = path.join(__dirname, 'wsjtx-relay', 'relay.js');
  
  let relayJs;
  try {
    relayJs = fs.readFileSync(relayJsPath, 'utf8');
  } catch (e) {
    return res.status(500).json({ error: 'relay.js not found on server' });
  }
  
  // Detect server URL from request
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const serverURL = proto + '://' + host;
  
  // Session ID from query param — ties this relay to the downloading browser
  const sessionId = req.query.session || '';
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required — download from the OpenHamClock dashboard' });
  }
  
  // SECURITY: Validate platform parameter
  if (!['linux', 'mac', 'windows'].includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform. Use: linux, mac, or windows' });
  }
  
  // SECURITY: Sanitize all values embedded into generated scripts to prevent command injection
  // Only allow URL-safe characters in serverURL, alphanumeric + hyphen/underscore in session/key
  function sanitizeForShell(str) {
    return String(str).replace(/[^a-zA-Z0-9._\-:\/\@]/g, '');
  }
  const safeServerURL = sanitizeForShell(serverURL);
  const safeSessionId = sanitizeForShell(sessionId);
  const safeRelayKey = sanitizeForShell(WSJTX_RELAY_KEY);
  
  if (platform === 'linux' || platform === 'mac') {
    // Build bash script with relay.js embedded as heredoc
    const lines = [
      '#!/bin/bash',
      '# OpenHamClock WSJT-X Relay — Auto-configured',
      '# Generated by ' + safeServerURL,
      '#',
      '# Usage:  bash ' + (platform === 'mac' ? 'start-relay.command' : 'start-relay.sh'),
      '# Stop:   Ctrl+C',
      '# Requires: Node.js 14+ (https://nodejs.org)',
      '#',
      '# In WSJT-X: Settings > Reporting > UDP Server',
      '#   Address: 127.0.0.1   Port: 2237',
      '',
      'set -e',
      '',
      '# Check for Node.js',
      'if ! command -v node &> /dev/null; then',
      '    echo ""',
      '    echo "Node.js is not installed."',
      '    echo "Install from https://nodejs.org (LTS recommended)"',
      '    echo ""',
      '    echo "Quick install:"',
      '    echo "  Ubuntu/Debian: sudo apt install nodejs"',
      '    echo "  Mac (Homebrew): brew install node"',
      '    echo "  Fedora: sudo dnf install nodejs"',
      '    echo ""',
      '    exit 1',
      'fi',
      '',
      '# Write relay agent to temp file',
      'RELAY_FILE=$(mktemp /tmp/ohc-relay-XXXXXX.js)',
      'trap "rm -f $RELAY_FILE" EXIT',
      '',
      "cat > \"$RELAY_FILE\" << 'OPENHAMCLOCK_RELAY_EOF'",
      relayJs,
      'OPENHAMCLOCK_RELAY_EOF',
      '',
      '# Run relay',
      'exec node "$RELAY_FILE" \\',
      '  --url "' + safeServerURL + '" \\',
      '  --key "' + safeRelayKey + '" \\',
      '  --session "' + safeSessionId + '"',
    ];
    
    const script = lines.join('\n') + '\n';
    const filename = platform === 'mac' ? 'start-relay.command' : 'start-relay.sh';
    res.setHeader('Content-Type', 'application/x-sh');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    return res.send(script);
    
  } else if (platform === 'windows') {
    // .bat that auto-downloads portable Node.js if needed, then runs relay
    // No install, no admin, no PowerShell execution policy issues
    const NODE_VERSION = 'v22.13.1'; // LTS
    const NODE_ZIP = 'node-' + NODE_VERSION + '-win-x64.zip';
    const NODE_DIR = 'node-' + NODE_VERSION + '-win-x64';
    const NODE_URL = 'https://nodejs.org/dist/' + NODE_VERSION + '/' + NODE_ZIP;
    
    const batLines = [
      '@echo off',
      'setlocal',
      'title OpenHamClock WSJT-X Relay',
      'echo.',
      'echo  =========================================',
      'echo   OpenHamClock WSJT-X Relay Agent v1.0',
      'echo  =========================================',
      'echo.',
      '',
      ':: Check for Node.js (system-installed or portable)',
      'set "NODE_EXE=node"',
      'set "PORTABLE_DIR=%TEMP%\\ohc-node"',
      '',
      'where node >nul 2>nul',
      'if not errorlevel 1 (',
      '    for /f "tokens=*" %%i in (\'node -v\') do echo   Found Node.js %%i',
      '    goto :have_node',
      ')',
      '',
      ':: Check for previously downloaded portable Node.js',
      'if exist "%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe" (',
      '    set "NODE_EXE=%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe"',
      '    echo   Found portable Node.js',
      '    goto :have_node',
      ')',
      '',
      ':: Download portable Node.js',
      'echo   Node.js not found. Downloading portable version...',
      'echo   (This is a one-time ~30MB download^)',
      'echo.',
      '',
      'if not exist "%PORTABLE_DIR%" mkdir "%PORTABLE_DIR%"',
      '',
      'powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \'' + NODE_URL + '\' -OutFile \'%PORTABLE_DIR%\\' + NODE_ZIP + '\' } catch { Write-Host $_.Exception.Message; exit 1 }"',
      'if errorlevel 1 (',
      '    echo.',
      '    echo   Failed to download Node.js!',
      '    echo   Check your internet connection and try again.',
      '    echo.',
      '    pause',
      '    exit /b 1',
      ')',
      '',
      'echo   Extracting...',
      'powershell -Command "Expand-Archive -Path \'%PORTABLE_DIR%\\' + NODE_ZIP + '\' -DestinationPath \'%PORTABLE_DIR%\' -Force"',
      'if errorlevel 1 (',
      '    echo   Failed to extract Node.js!',
      '    echo.',
      '    pause',
      '    exit /b 1',
      ')',
      '',
      'del "%PORTABLE_DIR%\\' + NODE_ZIP + '" >nul 2>nul',
      'set "NODE_EXE=%PORTABLE_DIR%\\' + NODE_DIR + '\\node.exe"',
      'echo   Portable Node.js ready.',
      'echo.',
      '',
      ':have_node',
      'echo   Server: ' + safeServerURL,
      'echo.',
      '',
      ':: Download relay agent',
      'echo   Downloading relay agent...',
      'powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri \'' + safeServerURL + '/api/wsjtx/relay/agent.js\' -OutFile \'%TEMP%\\ohc-relay.js\' } catch { Write-Host $_.Exception.Message; exit 1 }"',
      'if errorlevel 1 (',
      '    echo   Failed to download relay agent!',
      '    echo   Check your internet connection and try again.',
      '    echo.',
      '    pause',
      '    exit /b 1',
      ')',
      '',
      'echo   Relay agent ready.',
      'echo.',
      'echo   In WSJT-X: Settings ^> Reporting ^> UDP Server',
      'echo     Address: 127.0.0.1   Port: 2237',
      'echo.',
      'echo   Press Ctrl+C to stop',
      'echo.',
      '',
      ':: Run relay',
      '%NODE_EXE% "%TEMP%\\ohc-relay.js" --url "' + safeServerURL + '" --key "' + safeRelayKey + '" --session "' + safeSessionId + '"',
      '',
      'echo.',
      'echo   Relay stopped.',
      'del "%TEMP%\\ohc-relay.js" >nul 2>nul',
      'echo.',
      'pause',
    ];
    
    const script = batLines.join('\r\n') + '\r\n';
    res.setHeader('Content-Type', 'application/x-msdos-program');
    res.setHeader('Content-Disposition', 'attachment; filename="start-relay.bat"');
    return res.send(script);
    
  } else {
    return res.status(400).json({ error: 'Invalid platform. Use: linux, mac, or windows' });
  }
});

// CONTEST LOGGER UDP + API (N1MM / DXLog)
// ============================================

const N1MM_UDP_PORT = parseInt(process.env.N1MM_UDP_PORT || '12060');
const N1MM_ENABLED = process.env.N1MM_UDP_ENABLED === 'true';
const N1MM_MAX_QSOS = parseInt(process.env.N1MM_MAX_QSOS || '200');
const N1MM_QSO_MAX_AGE = parseInt(process.env.N1MM_QSO_MAX_AGE_MINUTES || '360') * 60 * 1000;

const contestQsoState = {
  qsos: [],
  stats: { total: 0, lastSeen: 0 }
};
const contestQsoIds = new Map();

function extractContactInfoXml(text) {
  if (!text) return null;
  const start = text.indexOf('<contactinfo');
  if (start === -1) return null;
  const end = text.indexOf('</contactinfo>', start);
  if (end === -1) return null;
  return text.slice(start, end + '</contactinfo>'.length);
}

function getXmlTag(xml, tag) {
  if (!xml) return '';
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : '';
}

function parseN1MMTimestamp(value) {
  if (!value) return null;
  const normalized = value.trim().replace(' ', 'T');
  const tsUtc = Date.parse(`${normalized}Z`);
  if (!Number.isNaN(tsUtc)) return tsUtc;
  const tsLocal = Date.parse(normalized);
  if (!Number.isNaN(tsLocal)) return tsLocal;
  return null;
}

function normalizeCallsign(value) {
  return (value || '').trim().toUpperCase();
}

function n1mmFreqToMHz(value, bandMHz) {
  const v = parseFloat(value);
  if (!v || Number.isNaN(v)) return bandMHz || null;

  // N1MM often reports freq in 10 Hz units (e.g., 1420000 => 14.2 MHz).
  // Use band as a hint to pick the most plausible scaling.
  const candidates = [
    v / 1000000, // Hz -> MHz
    v / 100000,  // 10 Hz -> MHz
    v / 1000     // kHz -> MHz
  ];

  if (bandMHz && !Number.isNaN(bandMHz)) {
    let best = candidates[0];
    let bestDiff = Math.abs(best - bandMHz);
    for (let i = 1; i < candidates.length; i++) {
      const diff = Math.abs(candidates[i] - bandMHz);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidates[i];
      }
    }
    return best;
  }

  if (v >= 1000000) return v / 1000000;
  if (v >= 100000) return v / 100000;
  if (v >= 1000) return v / 1000;
  return bandMHz || null;
}

function resolveQsoLocation(dxCall, grid, comment) {
  let gridToUse = grid;
  if (!gridToUse && comment) {
    const extracted = extractGridFromComment(comment);
    if (extracted) gridToUse = extracted;
  }
  if (gridToUse) {
    const loc = maidenheadToLatLon(gridToUse);
    if (loc) {
      return { lat: loc.lat, lon: loc.lon, grid: gridToUse, source: 'grid' };
    }
  }
  const prefixLoc = estimateLocationFromPrefix(dxCall);
  if (prefixLoc) {
    return { lat: prefixLoc.lat, lon: prefixLoc.lon, grid: prefixLoc.grid || null, source: prefixLoc.source || 'prefix' };
  }
  return null;
}

function pruneContestQsos() {
  const now = Date.now();
  contestQsoState.qsos = contestQsoState.qsos.filter(q => (now - q.timestamp) <= N1MM_QSO_MAX_AGE);
  if (contestQsoState.qsos.length > N1MM_MAX_QSOS) {
    contestQsoState.qsos = contestQsoState.qsos.slice(-N1MM_MAX_QSOS);
  }
  if (contestQsoIds.size > N1MM_MAX_QSOS * 10) {
    contestQsoIds.clear();
    contestQsoState.qsos.forEach(q => contestQsoIds.set(q.id, q.timestamp));
  }
}

function rememberContestQsoId(id) {
  contestQsoIds.set(id, Date.now());
  if (contestQsoIds.size > 2000) {
    let removed = 0;
    for (const key of contestQsoIds.keys()) {
      contestQsoIds.delete(key);
      removed++;
      if (removed >= 500) break;
    }
  }
}

function addContestQso(qso) {
  if (!qso || !qso.dxCall) return false;
  const now = Date.now();
  const timestamp = Number.isFinite(qso.timestamp) ? qso.timestamp : now;
  const id = qso.id || `${qso.source || 'qso'}-${qso.myCall || ''}-${qso.dxCall}-${timestamp}-${qso.bandMHz || qso.freqMHz || ''}-${qso.mode || ''}`;
  if (contestQsoIds.has(id)) return false;
  qso.id = id;
  qso.timestamp = timestamp;
  rememberContestQsoId(id);
  contestQsoState.qsos.push(qso);
  contestQsoState.stats.total += 1;
  contestQsoState.stats.lastSeen = now;
  pruneContestQsos();
  return true;
}

function parseN1MMContactInfo(xml) {
  const dxCall = normalizeCallsign(getXmlTag(xml, 'call'));
  if (!dxCall) return null;

  const myCall = normalizeCallsign(getXmlTag(xml, 'mycall')) ||
    normalizeCallsign(getXmlTag(xml, 'stationprefix')) ||
    CONFIG.callsign;

  const bandStr = getXmlTag(xml, 'band');
  const bandMHz = bandStr ? parseFloat(bandStr) : null;
  const rxRaw = parseFloat(getXmlTag(xml, 'rxfreq'));
  const txRaw = parseFloat(getXmlTag(xml, 'txfreq'));
  const freqMHz = n1mmFreqToMHz(!Number.isNaN(rxRaw) ? rxRaw : (!Number.isNaN(txRaw) ? txRaw : null), bandMHz);
  const mode = (getXmlTag(xml, 'mode') || '').toUpperCase();
  const comment = getXmlTag(xml, 'comment') || '';
  const gridRaw = getXmlTag(xml, 'gridsquare');
  const grid = (gridRaw || extractGridFromComment(comment) || '').toUpperCase();
  const contestName = getXmlTag(xml, 'contestname') || '';
  const timestampStr = getXmlTag(xml, 'timestamp') || '';
  const timestamp = parseN1MMTimestamp(timestampStr) || Date.now();
  const id = getXmlTag(xml, 'ID') || '';

  const loc = resolveQsoLocation(dxCall, grid, comment);

  const qso = {
    id,
    source: 'n1mm',
    timestamp,
    time: timestampStr,
    myCall,
    dxCall,
    bandMHz: Number.isNaN(bandMHz) ? null : bandMHz,
    freqMHz: Number.isNaN(freqMHz) ? null : freqMHz,
    rxFreq: Number.isNaN(rxRaw) ? null : rxRaw,
    txFreq: Number.isNaN(txRaw) ? null : txRaw,
    mode,
    grid: grid || null,
    contest: contestName
  };

  if (loc) {
    qso.lat = loc.lat;
    qso.lon = loc.lon;
    qso.locSource = loc.source;
    if (!qso.grid && loc.grid) qso.grid = loc.grid;
  }

  return qso;
}

function normalizeContestQso(input, source) {
  if (!input || typeof input !== 'object') return null;
  const dxCall = normalizeCallsign(input.dxCall || input.call);
  if (!dxCall) return null;
  const myCall = normalizeCallsign(input.myCall || input.mycall || input.deCall) || CONFIG.callsign;
  const bandMHz = parseFloat(input.bandMHz || input.band);
  const freqMHz = parseFloat(input.freqMHz || input.freq);
  const mode = (input.mode || '').toUpperCase();
  const grid = (input.grid || input.gridsquare || '').toUpperCase();
  const timestamp = typeof input.timestamp === 'number'
    ? input.timestamp
    : (parseN1MMTimestamp(input.timestamp) || Date.now());

  let lat = parseFloat(input.lat);
  let lon = parseFloat(input.lon);
  let locSource = '';

  if (grid && (Number.isNaN(lat) || Number.isNaN(lon))) {
    const loc = maidenheadToLatLon(grid);
    if (loc) {
      lat = loc.lat;
      lon = loc.lon;
      locSource = 'grid';
    }
  }

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    const loc = estimateLocationFromPrefix(dxCall);
    if (loc) {
      lat = loc.lat;
      lon = loc.lon;
      if (!locSource) locSource = loc.source || 'prefix';
    }
  }

  return {
    id: input.id || '',
    source,
    timestamp,
    time: input.time || '',
    myCall,
    dxCall,
    bandMHz: Number.isNaN(bandMHz) ? null : bandMHz,
    freqMHz: Number.isNaN(freqMHz) ? null : freqMHz,
    mode,
    grid: grid || null,
    lat: Number.isNaN(lat) ? null : lat,
    lon: Number.isNaN(lon) ? null : lon,
    locSource
  };
}

let n1mmSocket = null;
if (N1MM_ENABLED) {
  try {
    n1mmSocket = dgram.createSocket('udp4');

    n1mmSocket.on('message', (buf) => {
      const text = buf.toString('utf8');
      const xml = extractContactInfoXml(text);
      if (!xml) return;
      const qso = parseN1MMContactInfo(xml);
      if (qso) addContestQso(qso);
    });

    n1mmSocket.on('error', (err) => {
      logErrorOnce('N1MM UDP', err.message);
    });

    n1mmSocket.on('listening', () => {
      const addr = n1mmSocket.address();
      console.log(`[N1MM] UDP listener on ${addr.address}:${addr.port}`);
    });

    n1mmSocket.bind(N1MM_UDP_PORT, '0.0.0.0');
  } catch (e) {
    console.error(`[N1MM] Failed to start UDP listener: ${e.message}`);
  }
}

// API endpoint: get contest QSOs
app.get('/api/contest/qsos', (req, res) => {
  const limitRaw = parseInt(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
  const since = parseInt(req.query.since) || 0;

  pruneContestQsos();

  const filtered = since
    ? contestQsoState.qsos.filter(q => q.timestamp > since)
    : contestQsoState.qsos;

  res.json({
    qsos: filtered.slice(-limit),
    stats: {
      total: contestQsoState.stats.total,
      lastSeen: contestQsoState.stats.lastSeen
    },
    timestamp: Date.now()
  });
});

// API endpoint: ingest contest QSOs (JSON)
app.post('/api/contest/qsos', writeLimiter, requireWriteAuth, (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];
  let accepted = 0;

  for (const entry of payload) {
    const qso = normalizeContestQso(entry, 'http');
    if (qso && addContestQso(qso)) accepted++;
  }

  res.json({ ok: true, accepted, timestamp: Date.now() });
});

// ============================================
// CATCH-ALL FOR SPA
// ============================================

app.get('*', (req, res) => {
  // Try dist first (built React app), fallback to public (monolithic)
  const distIndex = path.join(__dirname, 'dist', 'index.html');
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  
  const indexPath = fs.existsSync(distIndex) ? distIndex : publicIndex;
  // Never cache index.html - stale copies cause browsers to load old JS after updates
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(indexPath);
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║                                                       ║');
  console.log('║   ██████╗ ██████╗ ███████╗███╗   ██╗                  ║');
  console.log('║  ██╔═══██╗██╔══██╗██╔════╝████╗  ██║                  ║');
  console.log('║  ██║   ██║██████╔╝█████╗  ██╔██╗ ██║                  ║');
  console.log('║  ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║                  ║');
  console.log('║  ╚██████╔╝██║     ███████╗██║ ╚████║                  ║');
  console.log('║   ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝                  ║');
  console.log('║                                                       ║');
  console.log('║  ██╗  ██╗ █████╗ ███╗   ███╗ ██████╗██╗      ██╗  ██╗ ║');
  console.log('║  ██║  ██║██╔══██╗████╗ ████║██╔════╝██║      ██║ ██╔╝ ║');
  console.log('║  ███████║███████║██╔████╔██║██║     ██║      █████╔╝  ║');
  console.log('║  ██╔══██║██╔══██║██║╚██╔╝██║██║     ██║      ██╔═██╗  ║');
  console.log('║  ██║  ██║██║  ██║██║ ╚═╝ ██║╚██████╗███████╗██║  ██╗ ║');
  console.log('║  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ║');
  console.log('║                                                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`  🌐 OpenHamClock v${APP_VERSION}`);
  console.log(`  🌐 Server running at http://${displayHost}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`  🔗 Network access: http://<your-ip>:${PORT}`);
  }
  console.log('  📡 API proxy enabled for NOAA, POTA, SOTA, DX Cluster');
  console.log(`  📋 Log level: ${LOG_LEVEL} (set LOG_LEVEL=debug for verbose)`);
  if (WSJTX_ENABLED) {
    console.log(`  🔊 WSJT-X UDP listener on port ${WSJTX_UDP_PORT}`);
  }
  if (WSJTX_RELAY_KEY) {
    console.log(`  🔁 WSJT-X relay endpoint enabled (POST /api/wsjtx/relay)`);
  }
if (N1MM_ENABLED) {
    console.log(`  📥 N1MM UDP listener on port ${N1MM_UDP_PORT}`);
  }
  if (AUTO_UPDATE_ENABLED) {
    console.log(`  🔄 Auto-update enabled every ${AUTO_UPDATE_INTERVAL_MINUTES || 60} minutes`);
  }
  console.log('  🖥️  Open your browser to start using OpenHamClock');
  console.log('');
  if (CONFIG.callsign !== 'N0CALL') {
    console.log(`  📻 Station: ${CONFIG.callsign} @ ${CONFIG.gridSquare}`);
  } else {
    console.log('  ⚠️  Configure your station in .env file');
  }
  console.log('');
  console.log('  In memory of Elwood Downey, WB0OEW');
  console.log('  73 de OpenHamClock contributors');
  console.log('');

  startAutoUpdateScheduler();
  
  // Check for outdated systemd service file that prevents auto-update restart
  if (AUTO_UPDATE_ENABLED && (process.env.INVOCATION_ID || process.ppid === 1)) {
    try {
      const serviceFile = fs.readFileSync('/etc/systemd/system/openhamclock.service', 'utf8');
      if (serviceFile.includes('Restart=on-failure') && !serviceFile.includes('Restart=always')) {
        console.log('  ⚠️  Your systemd service file uses Restart=on-failure');
        console.log('     Auto-updates may not restart properly.');
        console.log('     Fix: sudo sed -i "s/Restart=on-failure/Restart=always/" /etc/systemd/system/openhamclock.service');
        console.log('     Then: sudo systemctl daemon-reload');
        console.log('');
      }
    } catch { /* Not running as systemd service, or can't read file — ignore */ }
  }

  // Pre-warm N0NBH cache so solar-indices has current SFI/SSN on first request
  setTimeout(async () => {
    try {
      const response = await fetch('https://www.hamqsl.com/solarxml.php');
      const xml = await response.text();
      n0nbhCache = { data: parseN0NBHxml(xml), timestamp: Date.now() };
      logInfo('[Startup] N0NBH solar data pre-warmed');
    } catch (e) { logWarn('[Startup] N0NBH pre-warm failed:', e.message); }
  }, 3000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});
