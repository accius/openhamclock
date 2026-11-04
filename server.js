/**
 * OpenHamClock Server — Modular Entry Point
 *
 * Express server that:
 * 1. Serves the static web application
 * 2. Proxies API requests to avoid CORS issues
 * 3. Provides HF propagation predictions via ITU-R P.533-14 (ITURHFProp)
 * 4. Streams real-time updates to clients via Server-Sent Events (SSE)
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
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { initCtyData, getCtyData } = require('./src/server/ctydat.js');

// ── Load configuration (also loads .env) ──
const config = require('./server/config');
const {
  CONFIG,
  APP_VERSION,
  ROOT_DIR,
  ASSET_DIR,
  IS_PACKAGED,
  PORT,
  HOST,
  BIND_HOST,
  API_WRITE_KEY,
  METRICS_AUTH_KEY,
  ITURHFPROP_URL,
  WSJTX_ENABLED,
  WSJTX_UDP_PORT,
  WSJTX_RELAY_KEY,
  N1MM_ENABLED,
  N1MM_UDP_PORT,
  AUTO_UPDATE_ENABLED,
  AUTO_UPDATE_INTERVAL_MINUTES,
  DXSPIDER_PROXY_URL,
  CORS_ORIGINS,
  SETTINGS_SYNC,
  APRS_ENABLED,
  APRS_CALLSIGN_FILTER,
  N3FJP_QSO_RETENTION_MINUTES,
  N1MM_MAX_QSOS,
  N1MM_QSO_MAX_AGE,
  WSJTX_MULTICAST_ADDRESS,
  WSJTX_RELAY_KEY: WSJTX_RELAY_KEY_CFG,
  RIG_BRIDGE_RELAY_KEY,
  ROTATOR_PROVIDER,
  WINLINK_API_KEY,
  configJsonPath,
} = config;

// ── Global safety nets ──
process.on('uncaughtException', (err) => {
  if (err.type === 'request.aborted' || (err.name === 'BadRequestError' && err.message === 'request aborted')) {
    return;
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    return;
  }
  console.error(`[FATAL] Uncaught exception: ${err.message}`);
  console.error(err.stack);
  setTimeout(() => process.exit(1), 1000);
});
process.on('unhandledRejection', (reason) => {
  if (reason && (reason.name === 'AbortError' || (typeof reason === 'string' && reason.includes('AbortError')))) {
    return;
  }
  console.error(`[WARN] Unhandled rejection: ${reason}`);
});

// ── Logging (must be initialized before middleware) ──
const { LOG_LEVEL, logDebug, logInfo, logWarn, logErrorOnce, installRateLimiter } = require('./server/utils/logging');
installRateLimiter();

// ── Prometheus metrics (bootstrapped, references injected after services) ──
const prometheus = require('./server/services/prometheus-metrics');

// ── Upstream request manager ──
const UpstreamManager = require('./server/utils/upstream-manager');
const upstream = new UpstreamManager();
upstream.setMaxBackoff('wspr', 5 * 60 * 1000); // WSPR: 5 min max (PSKReporter rate limits are transient)

// ── Express app ──
const app = express();

// ── Apply middleware (security, rate limiting, compression, caching, monitoring) ──
const applyMiddleware = require('./server/middleware');
const { endpointStats, writeLimiter, ingestLimiter, requireWriteAuth, INTERNAL_TOKEN } = applyMiddleware(app, {
  CONFIG,
  PORT,
  TRUST_PROXY: config.TRUST_PROXY,
  TRUST_CLOUDFLARE: config.TRUST_CLOUDFLARE,
  API_WRITE_KEY,
  CORS_ORIGINS,
});

// ── Utilities ──
const { maintainCache } = require('./server/utils/cache');

// ── Build shared context object ──
const ctx = {
  // Core
  fetch,
  CONFIG,
  APP_VERSION,
  ROOT_DIR,
  ASSET_DIR,
  IS_PACKAGED,
  PORT,
  HOST,
  ITURHFPROP_URL,
  API_WRITE_KEY,
  DXSPIDER_PROXY_URL,
  CORS_ORIGINS,
  SETTINGS_SYNC,
  WSJTX_ENABLED,
  WSJTX_UDP_PORT,
  WSJTX_MULTICAST_ADDRESS: config.WSJTX_MULTICAST_ADDRESS,
  WSJTX_RELAY_KEY: config.WSJTX_RELAY_KEY,
  N1MM_ENABLED,
  N1MM_UDP_PORT,
  N1MM_MAX_QSOS,
  N1MM_QSO_MAX_AGE,
  AUTO_UPDATE_ENABLED,
  AUTO_UPDATE_INTERVAL_MINUTES,
  APRS_ENABLED,
  APRS_CALLSIGN_FILTER,
  N3FJP_QSO_RETENTION_MINUTES,
  RIG_BRIDGE_RELAY_KEY,
  ROTATOR_PROVIDER,
  WINLINK_API_KEY,
  configJsonPath,

  // Logging
  LOG_LEVEL,
  logDebug,
  logInfo,
  logWarn,
  logErrorOnce,

  // Shared services
  upstream,
  requireWriteAuth,
  writeLimiter,
  ingestLimiter,
  INTERNAL_TOKEN,
  endpointStats,
  maintainCache,
};

// ── Visitor stats service ──
const createVisitorStatsService = require('./server/services/visitor-stats');
const visitorStatsService = createVisitorStatsService(ctx);
Object.assign(ctx, {
  visitorStats: visitorStatsService.visitorStats,
  sessionTracker: visitorStatsService.sessionTracker,
  saveVisitorStats: visitorStatsService.saveVisitorStats,
  rolloverVisitorStats: visitorStatsService.rolloverVisitorStats,
  STATS_FILE: visitorStatsService.STATS_FILE,
});
app.use(visitorStatsService.visitorMiddleware);

// ── Inject references into Prometheus collect() functions ──
prometheus.setSessionTracker(visitorStatsService.sessionTracker);
prometheus.setVisitorStats(visitorStatsService.visitorStats);

// ── Auto-update service ──
const createAutoUpdateService = require('./server/services/auto-update');
const autoUpdateService = createAutoUpdateService(ctx);
Object.assign(ctx, {
  autoUpdateState: autoUpdateService.autoUpdateState,
  autoUpdateTick: autoUpdateService.autoUpdateTick,
  startAutoUpdateScheduler: autoUpdateService.startAutoUpdateScheduler,
  hasGitUpdates: autoUpdateService.hasGitUpdates,
});

// ── Serve static files ──
// Bundled frontend + static files come from ASSET_DIR (the repo root, or the
// read-only snapshot inside a packaged executable). Writes go to ROOT_DIR.
const distDir = path.join(ASSET_DIR, 'dist');
const publicDir = path.join(ASSET_DIR, 'public');
const distExists = fs.existsSync(path.join(distDir, 'index.html'));

const staticOptions = {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Service worker files must never be served stale — a cached sw.js can
    // pin users to an old deploy for up to a day.
    if (
      filePath.endsWith('index.html') ||
      filePath.endsWith('.html') ||
      filePath.endsWith(`${path.sep}sw.js`) ||
      filePath.endsWith(`${path.sep}sw-policy.js`)
    ) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('CDN-Cache-Control', 'no-store'); // Cloudflare-specific: never cache at edge
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
};

const assetOptions = {
  maxAge: '1y',
  immutable: true,
};

const VENDOR_CDN_MAP = {
  '/vendor/leaflet/leaflet.js': 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  '/vendor/leaflet/leaflet.css': 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  '/vendor/fonts/fonts.css':
    'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600;700&family=Orbitron:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@300;400;500;600;700&display=swap',
};

app.use('/vendor', (req, res, next) => {
  const vendorDir = path.join(publicDir, 'vendor');
  const localPath = path.resolve(vendorDir, req.path.replace(/^\//, ''));
  // Prevent path traversal — resolved path must stay inside vendor directory
  if (!localPath.startsWith(vendorDir)) return next();
  if (fs.existsSync(localPath)) return next();
  const cdnUrl = VENDOR_CDN_MAP['/vendor' + req.path];
  if (cdnUrl) return res.redirect(302, cdnUrl);
  next();
});

if (distExists) {
  app.use('/assets', express.static(path.join(distDir, 'assets'), assetOptions));
  app.use(express.static(distDir, staticOptions));
  console.log('[Server] Serving React app from dist/');
} else {
  console.log('[Server] No build found! Run: npm run build');
}

app.use(express.static(publicDir, staticOptions));

// ── Prometheus API metrics middleware (before routes, patterns extracted lazily) ──
app.use(prometheus.apiMetricsMiddleware());

// ── Register route modules ──
// Order matters: modules that export shared state must come first

// 1. Callsign (exports extractBaseCallsign, estimateLocationFromPrefix, etc.)
const callsignExports = require('./server/routes/callsign')(app, ctx);
Object.assign(ctx, callsignExports);

// 2. Space weather (exports n0nbhCache, parseN0NBHxml)
const spaceWeatherExports = require('./server/routes/space-weather')(app, ctx);
Object.assign(ctx, spaceWeatherExports);

// 3. Remaining routes (can use callsign + space-weather exports)
require('./server/routes/rotator')(app, ctx);
require('./server/routes/spots')(app, ctx);
require('./server/routes/emcomm')(app, ctx);
const swpcAlertsExports = require('./server/routes/swpc-alerts')(app, ctx);
Object.assign(ctx, swpcAlertsExports); // refreshSwpcAlerts + onSwpcAlertsRefreshed (used by push.js)
require('./server/routes/websdr')(app, ctx);
require('./server/routes/dxpeditions')(app, ctx);
require('./server/routes/aircraft')(app, ctx);
require('./server/routes/atc-sectors')(app, ctx);

const dxclusterExports = require('./server/routes/dxcluster')(app, ctx);
Object.assign(ctx, dxclusterExports);

const pskreporterExports = require('./server/routes/pskreporter')(app, ctx);
Object.assign(ctx, pskreporterExports);

const rbnExports = require('./server/routes/rbn')(app, ctx);
Object.assign(ctx, rbnExports);

// Band-opening detection (reads rbn + dxcluster spot caches — register after both)
require('./server/routes/band-openings')(app, ctx);

// 24h spot recorder for map history playback (samples the dxcluster cache)
require('./server/routes/history')(app, ctx);

require('./server/routes/satellites')(app, ctx);

const propagationExports = require('./server/routes/propagation')(app, ctx);
Object.assign(ctx, propagationExports);

require('./server/routes/p533-data')(app, ctx);
require('./server/routes/ionosonde')(app, ctx);
require('./server/routes/winlink')(app, ctx);
require('./server/routes/logsync')(app, ctx); // Wavelog/QRZ push + LoTW pull proxies (per-user creds, never stored)

require('./server/routes/contests')(app, ctx);
require('./server/routes/swpc-trends')(app, ctx); // solar wind/Bz/proton trend series (Space Wx Trends panel)
require('./server/routes/wsprlive')(app, ctx); // wspr.live "my spots" proxy (WSPR My Spots panel)
require('./server/routes/amsat-status')(app, ctx); // AMSAT status board proxy (AMSAT Status panel)
require('./server/routes/repeaters')(app, ctx); // hearham.com repeater directory (Repeaters panel)
require('./server/routes/pota-spot')(app, ctx); // POTA activator self-spotting + park lookup
require('./server/routes/aprs')(app, ctx);
require('./server/routes/field-reports')(app, ctx); // EmComm field reports (Winlink Express CSV ingest)
require('./server/routes/incident')(app, ctx); // shared EmComm incident: roster, event log, reports across sites
require('./server/routes/wsjtx')(app, ctx);
require('./server/routes/n1mm')(app, ctx);
require('./server/routes/openapi')(app, ctx); // Open QSO-layer API (#1015) — see docs/API.md
require('./server/routes/group-log')(app, ctx); // shared multi-operator log sessions (Field Day)
require('./server/routes/meshtastic')(app, ctx);
require('./server/routes/meshcom')(app, ctx);
require('./server/routes/presence')(app, ctx);
require('./server/routes/rig-bridge')(app, ctx);
require('./server/routes/config-routes')(app, ctx);
require('./server/routes/geo-time')(app, ctx);
require('./server/routes/admin')(app, ctx);
require('./server/routes/push')(app, ctx); // Web Push (dormant without VAPID keys); needs swpc-alerts exports
require('./server/routes/ibp')(app, ctx); // NCDXF/IBP beacon SNR measurements from Rig Bridge KiwiSDR monitors
require('./server/routes/hams-at')(app, ctx); // hams.at satellite pass alerts (key passed through, never stored)
require('./server/routes/control')(app, ctx); // Remote-control API + phone remote (docs/API.md#remote-control-api)
require('./server/routes/solar-outlook')(app, ctx); // SWPC 27-day outlook (Contests pills + Solar Outlook panel)
require('./server/routes/benchmark')(app, ctx); // Station benchmark — taps the RBN stream via ctx.onRbnSpot
require('./server/routes/mqtt-publish')(app, ctx); // Outbound MQTT + Home Assistant discovery (dormant without MQTT_PUBLISH_URL)
require('./server/routes/noaa-scales')(app, ctx); // NOAA R/S/G scales + 3-day forecast (NOAA Scales panel)
require('./server/routes/dst')(app, ctx); // Kyoto Dst index with SWPC fallback (Dst panel)
require('./server/routes/space-wx-activity')(app, ctx); // aurora peak + D-RAP max for the auto space-weather layer
require('./server/routes/space-launches')(app, ctx); // Launch Library 2 upcoming launches (Space Launches panel + layer)
require('./server/routes/tropical')(app, ctx); // NHC + JTWC tropical cyclones (Tropical panel + layer)
require('./server/routes/fire-weather')(app, ctx); // NWS Red Flag / Fire Weather Watch alerts
require('./server/routes/ndbc')(app, ctx); // NDBC buoy observations (Marine panel + layer)
require('./server/routes/wefax')(app, ctx); // NWS radiofax chart catalogue + GIF proxy (WEFAX panel)
require('./server/routes/motd')(app, ctx); // Message of the day (env MOTD or /api/admin/motd)
require('./server/routes/netlogger')(app, ctx); // NetLogger live nets proxy (60 s cache)
require('./server/routes/hamalert')(app, ctx); // HamAlert server feed (dormant without HAMALERT_USER/PASS)
require('./server/routes/balloons')(app, ctx); // SondeHub Amateur balloon telemetry proxy (2 min cache)

// Subsystem health background refresher (read by /api/health).
const health = require('./server/health');
ctx.getSubsystemsHealth = health.getSubsystems;
health.start(ctx);
prometheus.setSubsystemsHealth(health.getSubsystems);

// ── Prometheus metrics endpoint ──
app.get('/metrics', async (req, res) => {
  if (METRICS_AUTH_KEY) {
    const token = req.query.key || req.headers.authorization?.replace('Bearer ', '');
    if (token !== METRICS_AUTH_KEY) {
      return res.status(401).json({ error: 'Metrics endpoint requires authentication' });
    }
  }
  try {
    res.set('Content-Type', prometheus.registry.contentType);
    res.send(await prometheus.registry.metrics());
  } catch (err) {
    logErrorOnce('Prometheus', `Metrics collection failed: ${err.message}`);
    res.status(500).send('Metrics collection failed');
  }
});

// ── Catch-all for SPA ──
app.get('*', (req, res) => {
  const distIndex = path.join(distDir, 'index.html');
  const publicIndex = path.join(publicDir, 'index.html');
  const indexPath = fs.existsSync(distIndex) ? distIndex : publicIndex;
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store'); // Cloudflare: never cache at edge
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(indexPath);
});

// ── Express error handler ──
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'request.aborted' || (err.name === 'BadRequestError' && err.message === 'request aborted')) {
    return;
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Request too large' });
  }
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  logErrorOnce('Express', `${err.name || 'Error'}: ${err.message}`);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start server ──
// BIND_HOST (server/config.js): every interface by default; 127.0.0.1 keeps
// the server on this machine.
app.listen(PORT, BIND_HOST, () => {
  // The startup banner is ~40 lines; write it straight to stdout so the
  // console rate limiter (20-line burst) cannot drop the "Server running at"
  // line that tells the user where to point their browser.
  const say = (line = '') => process.stdout.write(`${line}\n`);
  say('');
  say('╔═══════════════════════════════════════════════════════╗');
  say('║                                                       ║');
  say('║   ██████╗ ██████╗ ███████╗███╗   ██╗                  ║');
  say('║  ██╔═══██╗██╔══██╗██╔════╝████╗  ██║                  ║');
  say('║  ██║   ██║██████╔╝█████╗  ██╔██╗ ██║                  ║');
  say('║  ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║                  ║');
  say('║  ╚██████╔╝██║     ███████╗██║ ╚████║                  ║');
  say('║   ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝                  ║');
  say('║                                                       ║');
  say('║  ██╗  ██╗ █████╗ ███╗   ███╗ ██████╗██╗     ██╗  ██╗  ║');
  say('║  ██║  ██║██╔══██╗████╗ ████║██╔════╝██║     ██║ ██╔╝  ║');
  say('║  ███████║███████║██╔████╔██║██║     ██║     █████╔╝   ║');
  say('║  ██╔══██║██╔══██║██║╚██╔╝██║██║     ██║     ██╔═██╗   ║');
  say('║  ██║  ██║██║  ██║██║ ╚═╝ ██║╚██████╗███████╗██║  ██╗  ║');
  say('║  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝  ║');
  say('║                                                       ║');
  say('╚═══════════════════════════════════════════════════════╝');
  say('');
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  say(`  \uD83C\uDF10 OpenHamClock v${APP_VERSION}`);
  say(`  \uD83C\uDF10 Server running at http://${displayHost}:${PORT}`);
  if (BIND_HOST === '0.0.0.0' || BIND_HOST === '::') {
    say(`  \uD83D\uDD17 Network access: http://<your-ip>:${PORT}`);
  } else {
    say(`  \uD83D\uDD12 Listening on ${BIND_HOST} only (BIND_HOST)`);
  }
  say('  \uD83D\uDCE1 API proxy enabled for NOAA, POTA, SOTA, DX Cluster');
  say(`  \uD83D\uDCCB Log level: ${LOG_LEVEL} (set LOG_LEVEL=debug for verbose)`);
  if (WSJTX_ENABLED) {
    say(`  \uD83D\uDD0A WSJT-X UDP listener on port ${WSJTX_UDP_PORT}`);
  }
  if (config.WSJTX_RELAY_KEY) {
    say(`  \uD83D\uDD01 WSJT-X relay endpoint enabled (POST /api/wsjtx/relay)`);
  }
  if (N1MM_ENABLED) {
    say(`  \uD83D\uDCE5 N1MM UDP listener on port ${N1MM_UDP_PORT}`);
  }
  if (AUTO_UPDATE_ENABLED) {
    say(`  \uD83D\uDD04 Auto-update enabled every ${AUTO_UPDATE_INTERVAL_MINUTES || 60} minutes`);
  }
  if (!API_WRITE_KEY) {
    say('');
    say(
      '  \u26A0\uFE0F  API_WRITE_KEY is not set \u2014 write endpoints (settings, update, rotator, QRZ) are unprotected.',
    );
    say('     Set API_WRITE_KEY in .env to secure POST endpoints.');
  }
  say('  \uD83D\uDDA5\uFE0F  Open your browser to start using OpenHamClock');
  say('');
  if (IS_PACKAGED) {
    say(`  \uD83D\uDCC1 Settings and data folder: ${ROOT_DIR}`);
    say('     (.env, config.json and data/ live here; set OPENHAMCLOCK_HOME to move them)');
    say('');
  }
  if (CONFIG.callsign !== 'N0CALL') {
    say(`  \uD83D\uDCFB Station: ${CONFIG.callsign} @ ${CONFIG.gridSquare}`);
  } else {
    say('  \u26A0\uFE0F  Configure your station in .env file');
  }
  say('');
  say('  In memory of Elwood Downey, WB0OEW');
  say('  73 de OpenHamClock contributors');
  say('');

  ctx.startAutoUpdateScheduler();

  // Load DXCC entity database
  initCtyData()
    .then(() => {
      const data = getCtyData();
      if (data) {
        console.log(
          `  \uD83D\uDCE1 CTY database: ${data.entities.length} entities, ${Object.keys(data.prefixes).length} prefixes`,
        );
      }
    })
    .catch(() => {});

  // Check for outdated systemd service file
  if (AUTO_UPDATE_ENABLED && (process.env.INVOCATION_ID || process.ppid === 1)) {
    try {
      const serviceFile = fs.readFileSync('/etc/systemd/system/openhamclock.service', 'utf8');
      if (serviceFile.includes('Restart=on-failure') && !serviceFile.includes('Restart=always')) {
        console.log('  \u26A0\uFE0F  Your systemd service file uses Restart=on-failure');
        console.log('     Auto-updates may not restart properly.');
        console.log(
          '     Fix: sudo sed -i "s/Restart=on-failure/Restart=always/" /etc/systemd/system/openhamclock.service',
        );
        console.log('     Then: sudo systemctl daemon-reload');
        console.log('');
      }
    } catch {
      /* Not running as systemd service */
    }
  }

  // Pre-warm N0NBH cache
  setTimeout(() => {
    if (ctx.prewarmN0NBH) ctx.prewarmN0NBH();
  }, 3000);

  // Packaged executable launched interactively (double-click / terminal):
  // open the app in the default browser so "download and run" is all it takes.
  // Headless (systemd, no TTY) and OPEN_BROWSER=false skip this.
  if (IS_PACKAGED && process.stdout.isTTY && process.env.OPEN_BROWSER !== 'false') {
    openInBrowser(`http://localhost:${PORT}`);
  }

  // Optional HTTPS on the LAN (HTTPS_PORT) — a secure context for browsers
  // opening a Pi's dashboard by IP, which microphone access (Decoder panel)
  // requires. See server/utils/lanHttps.js.
  require('./server/utils/lanHttps').startLanHttps(app, { dataDir: path.join(ROOT_DIR, 'data'), host: BIND_HOST });
});

function openInBrowser(url) {
  const { spawn } = require('child_process');
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* no desktop session — the banner already shows the URL */
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (visitorStatsService.saveVisitorStats) visitorStatsService.saveVisitorStats(true);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (visitorStatsService.saveVisitorStats) visitorStatsService.saveVisitorStats(true);
  process.exit(0);
});
