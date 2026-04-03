/**
 * OpenHamClock Server — Modular Entry Point
 *
 * Express server that:
 * 1. Serves the static web application
 * 2. Proxies API requests to avoid CORS issues
 * 3. Provides HF propagation predictions via ITU-R P.533-14 (ITURHFProp)
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
  PORT,
  HOST,
  API_WRITE_KEY,
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
  ROTATOR_HOST,
  ROTATOR_PORT,
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

// ── Upstream request manager ──
const UpstreamManager = require('./server/utils/upstream-manager');
const upstream = new UpstreamManager();
upstream.setMaxBackoff('wspr', 5 * 60 * 1000); // WSPR: 5 min max (PSKReporter rate limits are transient)

// ── Express app ──
const app = express();

// ── Apply middleware (security, rate limiting, compression, caching, monitoring) ──
const applyMiddleware = require('./server/middleware');
const { endpointStats, writeLimiter, requireWriteAuth } = applyMiddleware(app, {
  CONFIG,
  PORT,
  TRUST_PROXY: config.TRUST_PROXY,
  API_WRITE_KEY,
  CORS_ORIGINS,
});

// ── Build shared context object ──
const ctx = {
  // Core
  fetch,
  CONFIG,
  APP_VERSION,
  ROOT_DIR,
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
  ROTATOR_HOST,
  ROTATOR_PORT,
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
  endpointStats,
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
const distDir = path.join(ROOT_DIR, 'dist');
const publicDir = path.join(ROOT_DIR, 'public');
const distExists = fs.existsSync(path.join(distDir, 'index.html'));

const staticOptions = {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('.html')) {
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
require('./server/routes/dxpeditions')(app, ctx);

const dxclusterExports = require('./server/routes/dxcluster')(app, ctx);
Object.assign(ctx, dxclusterExports);

const pskreporterExports = require('./server/routes/pskreporter')(app, ctx);
Object.assign(ctx, pskreporterExports);

const rbnExports = require('./server/routes/rbn')(app, ctx);
Object.assign(ctx, rbnExports);

require('./server/routes/satellites')(app, ctx);

const propagationExports = require('./server/routes/propagation')(app, ctx);
Object.assign(ctx, propagationExports);

require('./server/routes/contests')(app, ctx);
require('./server/routes/aprs')(app, ctx);
require('./server/routes/wsjtx')(app, ctx);
require('./server/routes/n1mm')(app, ctx);
require('./server/routes/meshtastic')(app, ctx);
require('./server/routes/presence')(app, ctx);
require('./server/routes/rig-bridge')(app, ctx);
require('./server/routes/config-routes')(app, ctx);
require('./server/routes/admin')(app, ctx);

// ── Catch-all for SPA ──
app.get('*', (req, res) => {
  const distIndex = path.join(ROOT_DIR, 'dist', 'index.html');
  const publicIndex = path.join(ROOT_DIR, 'public', 'index.html');
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
  console.log('║  ██╗  ██╗ █████╗ ███╗   ███╗ ██████╗██╗     ██╗  ██╗  ║');
  console.log('║  ██║  ██║██╔══██╗████╗ ████║██╔════╝██║     ██║ ██╔╝  ║');
  console.log('║  ███████║███████║██╔████╔██║██║     ██║     █████╔╝   ║');
  console.log('║  ██╔══██║██╔══██║██║╚██╔╝██║██║     ██║     ██╔═██╗   ║');
  console.log('║  ██║  ██║██║  ██║██║ ╚═╝ ██║╚██████╗███████╗██║  ██╗  ║');
  console.log('║  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝  ║');
  console.log('║                                                       ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`  \uD83C\uDF10 OpenHamClock v${APP_VERSION}`);
  console.log(`  \uD83C\uDF10 Server running at http://${displayHost}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`  \uD83D\uDD17 Network access: http://<your-ip>:${PORT}`);
  }
  console.log('  \uD83D\uDCE1 API proxy enabled for NOAA, POTA, SOTA, DX Cluster');
  console.log(`  \uD83D\uDCCB Log level: ${LOG_LEVEL} (set LOG_LEVEL=debug for verbose)`);
  if (WSJTX_ENABLED) {
    console.log(`  \uD83D\uDD0A WSJT-X UDP listener on port ${WSJTX_UDP_PORT}`);
  }
  if (config.WSJTX_RELAY_KEY) {
    console.log(`  \uD83D\uDD01 WSJT-X relay endpoint enabled (POST /api/wsjtx/relay)`);
  }
  if (N1MM_ENABLED) {
    console.log(`  \uD83D\uDCE5 N1MM UDP listener on port ${N1MM_UDP_PORT}`);
  }
  if (AUTO_UPDATE_ENABLED) {
    console.log(`  \uD83D\uDD04 Auto-update enabled every ${AUTO_UPDATE_INTERVAL_MINUTES || 60} minutes`);
  }
  if (!API_WRITE_KEY) {
    console.log('');
    console.log(
      '  \u26A0\uFE0F  API_WRITE_KEY is not set \u2014 write endpoints (settings, update, rotator, QRZ) are unprotected.',
    );
    console.log('     Set API_WRITE_KEY in .env to secure POST endpoints.');
  }
  console.log('  \uD83D\uDDA5\uFE0F  Open your browser to start using OpenHamClock');
  console.log('');
  if (CONFIG.callsign !== 'N0CALL') {
    console.log(`  \uD83D\uDCFB Station: ${CONFIG.callsign} @ ${CONFIG.gridSquare}`);
  } else {
    console.log('  \u26A0\uFE0F  Configure your station in .env file');
  }
  console.log('');
  console.log('  In memory of Elwood Downey, WB0OEW');
  console.log('  73 de OpenHamClock contributors');
  console.log('');

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
});

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
