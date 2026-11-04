/**
 * Configuration routes — /api/config, /api/settings, /api/version, /api/weather.
 * Lines ~10701-10887 of original server.js
 */

const fs = require('fs');
const path = require('path');

module.exports = function (app, ctx) {
  const {
    CONFIG,
    APP_VERSION,
    ROOT_DIR,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    writeLimiter,
    requireWriteAuth,
    SETTINGS_SYNC,
    configJsonPath,
    isQRZConfigured,
    WSJTX_RELAY_KEY,
  } = ctx;

  // Lightweight version check (for auto-refresh polling)
  app.get('/api/version', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store');
    res.json({ version: APP_VERSION });
  });

  // ============================================
  // N3FJP BRIDGE CONFIGURATION & PROCESS MANAGER
  // ============================================
  const net = require('net');
  const { fork } = require('child_process');

  let runningBridgeProcess = null;

  // NOTE on Architecture: The N3FJP background bridge is forked directly here
  // to keep configuration changes reactive and self-contained within the route.
  // Gated strictly on n3fjpEnabled. Crashed/killed child processes run independently
  // and will not destabilize the main clock server lifecycle.

  // ⚡ SMART AUTO-START: Only boot if explicitly saved as true in config
  try {
    const configPath = path.join(ROOT_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (diskConfig.n3fjpEnabled === true && !runningBridgeProcess) {
        const startupBridgePath = path.join(ROOT_DIR, 'scripts', 'n3fjp-bridge.js');
        if (fs.existsSync(startupBridgePath)) {
          logInfo('🔌 [Startup] N3FJP is enabled on disk. Initializing background bridge script...');
          runningBridgeProcess = fork(startupBridgePath);
          runningBridgeProcess.on('error', (err) => logErrorOnce(`❌ Bridge error: ${err.message}`));
        }
      }
    }
  } catch (e) {
    logWarn(`Failed to parse startup config: ${e.message}`);
  }

  // ⚡ Updated to include security middleware
  app.post('/api/n3fjp/configure', writeLimiter, requireWriteAuth, async (req, res) => {
    const { host, port, enabled } = req.body || {};

    if (!host || !port) {
      return res.status(400).json({ success: false, error: 'Missing host or port' });
    }

    const isEnabled = !!enabled;

    // 💾 STEP 1: PERSIST TO DISK IMMEDIATELY
    try {
      const configPath = path.join(ROOT_DIR, 'config.json');
      let currentConfigData = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};

      currentConfigData.n3fjpHost = host;
      currentConfigData.n3fjpPort = parseInt(port, 10);
      currentConfigData.n3fjpEnabled = isEnabled;

      fs.writeFileSync(configPath, JSON.stringify(currentConfigData, null, 2), 'utf8');

      ctx.N3FJP_SERVER_HOST = host;
      ctx.N3FJP_SERVER_PORT = parseInt(port, 10);
      ctx.N3FJP_ENABLED = isEnabled;
    } catch (saveError) {
      logWarn(`Failed to write parameters to disk: ${saveError.message}`);
    }

    // 🛑 STEP 2: MANAGE SCRIPT BACKGROUND LIFECYCLE
    if (!isEnabled) {
      if (runningBridgeProcess) {
        logInfo('📡 UI Toggle: Turning OFF N3FJP Bridge. Terminating script process...');
        try {
          runningBridgeProcess.kill('SIGKILL');
        } catch (e) {}
        runningBridgeProcess = null;
      }
      return res
        .status(200)
        .send({ success: true, connected: false, message: 'Configuration saved. Background bridge deactivated.' });
    }

    // 🔄 STEP 3: REBOOT BACKGROUND PROCESS
    if (runningBridgeProcess) {
      logInfo('🔄 Bridge configuration updated. Refreshing background worker thread...');
      try {
        runningBridgeProcess.kill('SIGKILL');
      } catch (e) {}
      runningBridgeProcess = null;
    }

    const bridgeScriptPath = path.join(ROOT_DIR, 'scripts', 'n3fjp-bridge.js');
    if (fs.existsSync(bridgeScriptPath)) {
      runningBridgeProcess = fork(bridgeScriptPath, [], {
        env: {
          ...process.env,
          N3FJP_TARGET_HOST: host,
          N3FJP_TARGET_PORT: String(port),
        },
      });
      runningBridgeProcess.on('error', (err) =>
        logErrorOnce(`❌ Background bridge thread threw an error: ${err.message}`),
      );
    }

    // 🎯 STEP 4: CLEAN CONFIRMATION RETURN
    logInfo(`N3FJP Bridge: Local configurations applied for station at ${host}:${port}.`);

    // Return immediately to keep the UI snappy and avoid network timeouts
    return res.status(200).send({
      success: true,
      connected: true, // Set to true so your React panel doesn't flag a red error box
      message: 'Settings updated successfully! Check your server console for live connection status.',
    });
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
      path.join(ROOT_DIR, 'data', 'settings.json'),
      '/tmp/openhamclock-settings.json',
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

    // Only allow openhamclock_*, ohc_*, and custom n3fjp keys (security: prevent arbitrary data injection)
    const filtered = {};
    for (const [key, value] of Object.entries(settings)) {
      if (
        (key.startsWith('openhamclock_') || key.startsWith('ohc_') || key.startsWith('n3fjp')) &&
        (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
      ) {
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
      // Port of the optional LAN HTTPS listener (server/utils/lanHttps.js) —
      // the Decoder panel links plain-http visitors to it.
      lanHttpsPort: Number(process.env.HTTPS_PORT) > 0 ? Number(process.env.HTTPS_PORT) : null,

      // Station info (from .env or config.json)
      callsign: CONFIG.callsign,
      locator: CONFIG.gridSquare,
      latitude: CONFIG.latitude,
      longitude: CONFIG.longitude,
      serverLocal: CONFIG.serverLocal,

      // Display preferences
      units: CONFIG.units,
      allUnits: CONFIG.allUnits,
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

      // N3FJP Log Integration
      n3fjpEnabled: ctx.N3FJP_ENABLED,
      n3fjpHost: ctx.N3FJP_SERVER_HOST,
      n3fjpPort: ctx.N3FJP_SERVER_PORT,
      n3fjpRetentionMinutes: ctx.N3FJP_QSO_RETENTION_MINUTES,

      // DX Cluster settings
      spotRetentionMinutes: CONFIG.spotRetentionMinutes,
      dxClusterSource: CONFIG.dxClusterSource,
      dxUdpHost: CONFIG.dxUdpHost,
      dxUdpPort: CONFIG.dxUdpPort,

      // Whether config is incomplete (show setup wizard)
      configIncomplete: CONFIG.callsign === 'N0CALL' || !CONFIG.gridSquare,

      // Server timezone (from TZ env var or system), validated.
      // On minimal Linux containers without TZ set, Intl can return "Etc/Unknown"
      // which browsers reject with RangeError. Validate before sending.
      timezone: (() => {
        const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        if (!tz) return '';
        try {
          new Intl.DateTimeFormat(undefined, { timeZone: tz });
          return tz;
        } catch (e) {
          console.warn(
            '[config] Invalid resolved timezone "%s" — falling back to empty (client will use browser TZ). Set TZ env var to silence.',
            tz,
          );
          return '';
        }
      })(),

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
        qrzLookup: isQRZConfigured(),
      },

      // Refresh intervals (ms)
      refreshIntervals: {
        spaceWeather: 300000,
        pota: 60000,
        sota: 60000,
        dxCluster: 30000,
      },
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
};
