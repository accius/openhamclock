/**
 * Configuration routes — /api/config, /api/settings, /api/version, /api/weather.
 * Lines ~10701-10887 of original server.js
 */

const fs = require('fs');

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
