/**
 * Configuration Utilities
 * Handles app configuration, localStorage persistence, and theme management
 *
 * Configuration priority:
 * 1. localStorage (user's browser settings)
 * 2. Server config (from .env file)
 * 3. Default values
 */

import { readCustomTileSource, customSourceToStyle, CUSTOM_STYLE_ID } from './customTileSource.js';

// Map offset for MODIS Gibs imagery to attempt to load latest global planetary coverage
const getGIBSUrl = (offsetDays = 0) => {
  // Subtracts offsetDays and 12 hours to ensure a complete global pass
  const date = new Date(Date.now() - (offsetDays * 24 + 12) * 60 * 60 * 1000);
  const dateString = date.toISOString().split('T')[0];

  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateString}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
};
// *Offset delay end code here *
export const DEFAULT_CONFIG = {
  callsign: 'N0CALL',
  headerSize: 1.0, // Float multiplies base px size (0.1 to 2.0)
  locator: '',
  location: { lat: 40.015, lon: -105.2705, stationAlt: 1630 }, // Boulder, CO (default), altitude [m]
  satellite: {
    minElev: 5, // Min elevation for visibility (degrees)
    trackDurationMins: 45, // orbit track window (± minutes around now)
    maxTleAgeDays: 7, // element sets older than this are flagged stale (dashed tracks)
    hamsAtApiKey: '', // optional hams.at personal API key (Satellite Passes → Alerts)
    dopplerStepHz: 20, // Doppler tuning: retune the rig when the correction moves by this much
    rotatorStepDeg: 2, // Rotator auto-track: command when the target moves by this much
    rotatorMaxEl: 90, // Rotator elevation travel: 90 = normal, 180 = flip-capable (G-5500 style)
    rotatorStopAz: 0, // Rotator mechanical stop azimuth (0 = north stop, 180 = south stop)
    rotatorPrepositionMins: 10, // Swing to the AOS azimuth this many minutes before a pass
  },
  defaultDX: { lat: 35.6762, lon: 139.6503 }, // Tokyo
  units: 'imperial', // 'imperial' or 'metric'
  allUnits: { dist: 'imperial', temp: 'imperial', press: 'imperial' },
  showWhatsNew: true,
  propagation: {
    mode: 'SSB', // SSB, CW, FT8, FT4, WSPR, JS8, RTTY, PSK31
    power: 100, // TX power in watts
    antenna: 'isotropic', // Antenna profile key
  },
  licenseClass: 'other', // US license class for privilege shading/warnings: 'other', 'technician', 'general', 'extra'
  theme: 'dark', // 'dark', 'light', 'legacy', or 'retro'
  layout: 'modern', // see App.jsx for the full list: 'modern', 'classic', 'dockable', 'mobile', …
  mouseZoom: 50, // Factor to affect rate of zooming with scrollwheel (1-100)
  timezone: '', // IANA timezone (e.g. 'America/Regina') — empty means consumers must fall back to browser default themselves; passing '' to Intl.DateTimeFormat throws RangeError
  use12Hour: true,
  swapHeaderClocks: false, // false = UTC first, true = Local first
  showMutualReception: true, // Show gold star on PSK spots with mutual reception
  preventSleep: false, // Keep screen awake while app is open (tablet/kiosk mode)
  sharePresence: true, // Share callsign on the Active Users map layer
  displaySchedule: { enabled: false, sleepTime: '23:00', wakeTime: '07:00', keepSignalActive: true }, // Scheduled display on/off (#901)
  gpsFollow: 'off', // Rig Bridge GPS plugin → DE location: 'off' | 'once' (first fix) | 'follow' (rover mode)
  displayBrightness: { manual: 100, auto: false }, // Display tab: overlay dim / bridge backlight; auto = light sensor
  showSatellites: true,
  showPota: true,
  showDxPaths: true,
  showDxWeather: true,
  panels: {
    // Left sidebar panels
    deLocation: { visible: true, size: 1.0 },
    dxLocation: { visible: true, size: 1.0 },
    solar: { visible: true, size: 1.0 },
    propagation: { visible: true, size: 1.0 },
    // Right sidebar panels
    dxCluster: { visible: true, size: 2.0 },
    pskReporter: { visible: true, size: 1.2 },
    dxpeditions: { visible: true, size: 0.6 },
    pota: { visible: true, size: 1.0 },
    contests: { visible: true, size: 0.8 },
  },
  refreshIntervals: {
    spaceWeather: 300000, // 5 minutes
    bandConditions: 300000, // 5 minutes
    pota: 120000, // 2 minutes (was 1 min)
    dxCluster: 30000, // 30 seconds (was 5 sec)
    terminator: 60000, // 1 minute
  },
  dxClusterSource: 'dxspider-proxy',
  // loginCommands: native cluster commands sent once after login on a custom
  // telnet cluster (e.g. "set/filter dxbm/pass 20,15"); each { cmd, enabled }.
  customDxCluster: { enabled: false, host: '', port: 7300, loginCommands: [] },
  // setDx: spots arriving over UDP (N1MM / DXLog / MacLoggerDX) set the DX
  // target; show: 'all' | 'mine' (only spots entered by this station).
  udpDxCluster: { host: '', port: 12060, setDx: false, show: 'all' },
  wsjtxRelayMulticast: { enabled: false, address: '224.0.0.1' },
  // Alarm clock (utils/alarmClock.js): a daily alarm and a once-only alarm, HH:MM in DE local or UTC
  alarm: {
    daily: { time: '07:00', utc: false, armed: false },
    once: { time: '', utc: true, armed: false, at: null, label: '' },
  },
  // KiwiSDR beacon monitor (Rig Bridge plugin kiwi-beacon-monitor). The
  // browser reads measurements only when enabled; host/port/password are
  // pushed to the bridge from Settings → Rig Bridge.
  beaconMonitor: {
    enabled: false,
    host: '',
    port: 8073,
    password: '',
    bands: ['20m', '17m', '15m', '12m', '10m'],
    kiwiName: '',
  },
  remoteControl: { enabled: null }, // null = auto (on for local installs, off on the hosted site) — docs/API.md
  callsignTitles: '', // up to six ';'-separated titles rotating in the callsign box (HamClock set_title)
  grayscale: 'off', // 'off' | 'map' | 'all' — filter: grayscale(1) on the map or the whole display
  autoSpaceWxLayers: false, // Auto-enable Aurora / D-RAP map layers when space weather warrants (Settings → Map Layers)
  bearings: 'true', // 'true' = true north, 'magnetic' = corrected by WMM2025 declination at DE (suffix "M")
};

// Cache for server config
let serverConfig = null;

/**
 * Fetch configuration from server (.env file)
 * This is called once on app startup
 */
export const fetchServerConfig = async () => {
  try {
    // no-store: the API cache middleware marks /api/config cacheable for an
    // hour, so after an update the auto-reload still read the old response
    // and the version badge beside the callsign lagged behind the server.
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (response.ok) {
      serverConfig = await response.json();
      // Only log if server has real config (not defaults)
      if (serverConfig.callsign && serverConfig.callsign !== 'N0CALL') {
        console.info('[Config] Server config:', serverConfig.callsign, '@', serverConfig.locator);
      }
      return serverConfig;
    }
  } catch (e) {
    console.warn('[Config] Could not fetch server config');
  }
  return null;
};

/**
 * Load config - localStorage is the primary source of truth
 * Server config provides baseline values from .env, then localStorage overrides
 */
export const loadConfig = () => {
  // Start with defaults
  let config = { ...DEFAULT_CONFIG };

  // Apply server config baseline (.env/config.json) when available
  if (serverConfig) {
    config = {
      ...config,
      callsign: serverConfig.callsign && serverConfig.callsign !== 'N0CALL' ? serverConfig.callsign : config.callsign,
      locator: serverConfig.locator || config.locator,
      location: {
        lat: serverConfig.latitude ?? config.location.lat,
        lon: serverConfig.longitude ?? config.location.lon,
      },
      defaultDX: {
        lat: serverConfig.dxLatitude ?? config.defaultDX.lat,
        lon: serverConfig.dxLongitude ?? config.defaultDX.lon,
      },
      units: serverConfig.units || config.units,
      allUnits: serverConfig.allUnits || config.allUnits,
      theme: serverConfig.theme || config.theme,
      layout: serverConfig.layout || config.layout,
      mouseZoom: serverConfig.mouseZoom || config.mouseZoom,
      timezone: serverConfig.timezone || config.timezone,
      use12Hour: serverConfig.timeFormat === '12',
      showSatellites: serverConfig.showSatellites ?? config.showSatellites,
      showPota: serverConfig.showPota ?? config.showPota,
      showDxPaths: serverConfig.showDxPaths ?? config.showDxPaths,
      panels: { ...config.panels, ...serverConfig.panels },
      dxClusterSource: serverConfig.dxClusterSource || config.dxClusterSource,
      udpDxCluster: {
        ...config.udpDxCluster,
        host: serverConfig.dxUdpHost || config.udpDxCluster.host,
        port: parseInt(serverConfig.dxUdpPort, 10) || config.udpDxCluster.port,
      },
    };
  }

  // Try to load from localStorage FIRST (user's saved settings)
  let localConfig = null;
  try {
    const saved = localStorage.getItem('openhamclock_config');
    if (saved) {
      localConfig = JSON.parse(saved);
      console.debug('[Config] Loaded from localStorage:', localConfig.callsign);
    }
  } catch (e) {
    console.error('Error loading config from localStorage:', e);
  }

  // Local browser settings override server/default values
  if (localConfig) {
    config = {
      ...config,
      ...localConfig,
      // Ensure nested objects are properly merged
      location: localConfig.location || config.location,
      defaultDX: localConfig.defaultDX || config.defaultDX,
      panels: { ...config.panels, ...localConfig.panels },
      refreshIntervals: { ...config.refreshIntervals, ...localConfig.refreshIntervals },
      // Deep-merge propagation so saved configs predating the antenna field
      // (or server-synced configs missing it) don't reset antenna to default.
      propagation: { ...config.propagation, ...localConfig.propagation },
      udpDxCluster: { ...config.udpDxCluster, ...(localConfig.udpDxCluster || {}) },
      customDxCluster: { ...config.customDxCluster, ...(localConfig.customDxCluster || {}) },
    };
  }

  // Mark if config needs setup (no callsign set anywhere)
  config.configIncomplete = config.callsign === 'N0CALL' || !config.locator;

  // Always inject version from server (not a user preference — server is source of truth)
  if (serverConfig?.version) {
    config.version = serverConfig.version;
  }

  return config;
};

/**
 * Save config to localStorage and sync to server
 */
export const saveConfig = (config) => {
  try {
    localStorage.setItem('openhamclock_config', JSON.stringify(config));
    console.debug('[Config] Saved to localStorage');
    // Notify plugins of config change (storage events don't fire in the same tab)
    window.dispatchEvent(new CustomEvent('openhamclock-config-change', { detail: config }));
  } catch (e) {
    console.error('[Config] Error saving to localStorage:', e);
  }
  // Debounced server sync happens via syncAllSettingsToServer()
};

// ============================================
// SERVER SETTINGS SYNC
// ============================================
// All openhamclock_* localStorage keys are synced to the server
// so all devices viewing the same OHC instance share one config.

// All localStorage keys that are part of user settings
const SYNC_KEYS = [
  'openhamclock_config',
  'openhamclock_dockLayout',
  'openhamclock_dockLayoutPresets',
  'openhamclock_dxFavorites',
  'openhamclock_dxFilters',
  'openhamclock_watchlists',
  'openhamclock_dxLocation',
  'openhamclock_dxLocked',
  'openhamclock_mapLayers',
  'openhamclock_mapSettings',
  'openhamclock_panelZoom',
  'openhamclock_emcommAliases',
  'openhamclock_emcommPanelSets',
  'openhamclock_pskActiveTab',
  'openhamclock_pskFilters',
  'openhamclock_potaFilters',
  'openhamclock_sotaFilters',
  'openhamclock_wwffFilters',
  'openhamclock_wwbotaFilters',
  'openhamclock_callsignSearchHistory',
  'openhamclock_contestSession',
  'openhamclock_freqMemories',
  'openhamclock_netSchedule',
  'openhamclock_netControlScripts',
  'openhamclock_pskPanelMode',
  'openhamclock_bandColors',
  'openhamclock_satelliteFilters',
  'openhamclock_solarImageType',
  'openhamclock_solarPanelMode',
  'openhamclock_graylineMargin',
  'openhamclock_emePlannerMinElev',
  'openhamclock_satPlannerSat',
  'openhamclock_use12Hour',
  'openhamclock_voacapColorScheme',
  'openhamclock_voacapViewMode',
  'openhamclock_weatherExpanded',
  'ohc_openmeteo_apikey',
  'ohc_wsjtx_age',
];

/**
 * Fetch settings from server and apply to localStorage.
 * Server is source of truth for multi-device consistency.
 * Returns true if server had settings, false if empty/error.
 */
export const fetchServerSettings = async () => {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return false; // 404 = sync disabled, or server error
    const settings = await response.json();

    // Check if sync is disabled (server returns { enabled: false })
    if (settings.enabled === false) return false;
    if (!settings || Object.keys(settings).length === 0) return false;

    // Apply server settings to localStorage (server wins)
    let applied = 0;
    for (const [key, value] of Object.entries(settings)) {
      if ((key.startsWith('openhamclock_') || key.startsWith('ohc_')) && typeof value === 'string') {
        localStorage.setItem(key, value);
        applied++;
      }
    }

    if (applied > 0) {
      console.debug(`[Config] Synced ${applied} settings from server`);
    }
    return applied > 0;
  } catch (e) {
    console.warn('[Config] Server settings unavailable:', e.message);
    return false;
  }
};

/**
 * Push all current localStorage settings to server.
 * No-op if settings sync is not enabled (interceptor not installed).
 */
let _syncTimeout = null;

/** Gather every synced localStorage key into one settings object. */
const collectSyncSettings = () => {
  const settings = {};
  for (const key of SYNC_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) settings[key] = val;
  }
  // Also capture any openhamclock_*/ohc_* keys not in the static list
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('openhamclock_') || key.startsWith('ohc_')) && !settings[key]) {
      // Skip profiles (too large, browser-specific)
      if (key === 'openhamclock_profiles' || key === 'openhamclock_activeProfile') continue;
      settings[key] = localStorage.getItem(key);
    }
  }
  return settings;
};

/**
 * If a debounced sync is still pending when the page goes away, push it now
 * with sendBeacon (survives unload). Without this, changing a setting and
 * refreshing within the 2 s debounce lost the change: the server copy was
 * stale, and on reload "server wins" wrote the old value back over
 * localStorage (N3DD: antenna type reverting on refresh).
 * @returns {boolean} true when a beacon was queued
 */
/** True while a debounced server sync is armed and not yet sent. */
export const hasPendingSettingsSync = () => _syncTimeout != null;

export const flushSettingsSync = () => {
  if (!_syncTimeout) return false;
  clearTimeout(_syncTimeout);
  _syncTimeout = null;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    const body = new Blob([JSON.stringify(collectSyncSettings())], { type: 'application/json' });
    return navigator.sendBeacon('/api/settings', body);
  } catch {
    return false;
  }
};

export const syncAllSettingsToServer = () => {
  if (!_interceptorInstalled) return; // Sync not enabled — no-op

  // Debounce: wait 2s after last change before pushing
  if (_syncTimeout) clearTimeout(_syncTimeout);
  _syncTimeout = setTimeout(async () => {
    _syncTimeout = null;
    try {
      const settings = collectSyncSettings();

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        const result = await response.json();
        console.debug(`[Config] Synced ${result.keys} settings to server`);
      }
    } catch (e) {
      // Silent fail — server sync is best-effort
      console.warn('[Config] Server sync failed:', e.message);
    }
  }, 2000);
};

/**
 * Install global localStorage interceptor.
 * Any write to openhamclock_* or ohc_* keys auto-triggers debounced server sync.
 * Call once at app startup.
 */
let _interceptorInstalled = false;
export const installSettingsSyncInterceptor = () => {
  if (_interceptorInstalled) return;
  _interceptorInstalled = true;

  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    originalSetItem(key, value);
    if (key && (key.startsWith('openhamclock_') || key.startsWith('ohc_'))) {
      syncAllSettingsToServer();
    }
  };

  // A refresh inside the debounce window must not lose the last change
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushSettingsSync);
  }
};

/**
 * Check if configuration is incomplete (show setup wizard)
 */
export const isConfigIncomplete = () => {
  const config = loadConfig();
  return config.callsign === 'N0CALL' || !config.locator;
};

/**
 * Apply theme to document
 */
export const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  // Theme-aware chrome (e.g. the sidebar's 8-bit width) re-measures on this.
  try {
    window.dispatchEvent(new CustomEvent('openhamclock-theme-change', { detail: { theme } }));
  } catch {
    /* non-browser env */
  }
};

/**
 * Map Tile Providers
 *
 * CARTO started watermarking keyless raster tiles in August 2026 ("API KEY
 * REQUIRED", issue #1162) and is retiring its raster basemap service, so the
 * Dark and Streets styles default to Esri sources that need no key. Anyone
 * who wants the original CARTO look back can get a free key (5M tiles/month,
 * carto.com/basemaps/apikey) and paste it in Settings → Integrations — Dark
 * and Streets then switch back to CARTO, localized labels and all. The former
 * "Dark (Esri)" and "Political" entries were folded into Dark and Streets
 * (same tiles); WorldMap migrates saved references.
 *
 * The key is stored under 'ohc-carto-key' (dash prefix, like ohc-callbook-auth)
 * so the settings-sync interceptor and catch-all — which sweep every ohc_* and
 * openhamclock_* key to the server — can never ship one browser's personal key
 * to every user of a shared instance. Do not "fix" the prefix.
 */
export const CARTO_KEY_STORAGE = 'ohc-carto-key';

export const getCartoApiKey = () => {
  try {
    // Migrate the briefly-used synced key name, then forget it existed.
    const legacy = localStorage.getItem('ohc_carto_apikey');
    if (legacy && !localStorage.getItem(CARTO_KEY_STORAGE)) {
      localStorage.setItem(CARTO_KEY_STORAGE, legacy);
    }
    if (legacy) localStorage.removeItem('ohc_carto_apikey');
    return localStorage.getItem(CARTO_KEY_STORAGE) || '';
  } catch {
    return '';
  }
};

const cartoApiKey = getCartoApiKey();
// Operator's own tile server (Settings → Map Layers → Offline map areas).
const customStyle = customSourceToStyle(readCustomTileSource());

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// Offline area packs (Settings → Map Layers → Offline map areas) may only be
// downloaded from styles flagged `offlinePack: true` — tile sources whose
// terms allow fetching an area ahead of time. Esri ArcGIS Online basemaps
// (offline use goes through Esri's own export-tiles workflow with an ArcGIS
// account), Google, CARTO, and OpenStreetMap's own tile servers (which ban
// "save area for offline" outright) are deliberately not flagged; NASA GIBS
// imagery is date-stamped and changes daily. A flagged style's tile host must
// also be listed in public/sw-policy.js OFFLINE_TILE_HOSTS (unit-tested).
export const MAP_STYLES = {
  dark: cartoApiKey
    ? {
        name: 'Dark',
        url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?language={lang}&key=${encodeURIComponent(cartoApiKey)}`,
        attribution: CARTO_ATTRIBUTION,
      }
    : {
        name: 'Dark',
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; Esri',
      },
  satellite: {
    name: 'Satellite',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    // Web Mercator stops at ±85.05°, so the globe's polar caps have no imagery
    // from the tiles above. These polar-projected services cover the rest, and
    // ArcGIS reprojects them to plate carrée server-side on request — see
    // fetchPolarStrip() in utils/globeTexture.js.
    polar: {
      north: 'https://services.arcgisonline.com/arcgis/rest/services/Polar/Arctic_Imagery/MapServer',
      south: 'https://services.arcgisonline.com/arcgis/rest/services/Polar/Antarctic_Imagery/MapServer',
    },
  },
  MODIS: {
    name: 'Modis Truecolor', // NASA GIBS MODIS Truecolor Imagery
    url: '', // Handled dynamically in WorldMap.jsx
    attribution: '&copy; NASA GIBS',
  },
  terrain: {
    name: 'Terrain',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, US National Park Service',
  },
  streets: cartoApiKey
    ? {
        name: 'Streets',
        url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?language={lang}&key=${encodeURIComponent(cartoApiKey)}`,
        attribution: CARTO_ATTRIBUTION,
      }
    : {
        name: 'Streets',
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; Esri',
      },
  topo: {
    name: 'Topo',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  watercolor: {
    name: 'Ocean',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  hybrid: {
    name: 'Hybrid',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl={lang}',
    attribution: '&copy; Google',
  },
  gray: {
    name: 'Gray',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  usgsTopo: {
    name: 'USGS Topo',
    // The National Map (U.S. Geological Survey): U.S. public-domain topo
    // tiles — roads, contours, hydrography, place names. Detailed for the
    // United States; elsewhere only coarse world data at low zoom.
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    attribution: 'USGS The National Map',
    offlinePack: true,
    offlineAvgTileBytes: 28 * 1024, // measured: ~10–36 KB JPEG tiles, z6–z16
    offlineMaxZoom: 16,
  },
  // ── Regional offline-capable basemaps (national mapping agencies) ──────
  // Each is an open-licence service whose terms allow copying the map data
  // and do not forbid fetching an area ahead of time at a polite rate.
  // `regional: true` keeps them out of the default wall-display rotation.
  ignPlan: {
    name: 'Plan IGN (France)',
    // IGN Géoplateforme, Plan IGN v2. Licence Ouverte / Open Licence 2.0
    // (Etalab); the Géoplateforme WMTS API is "non soumis à limite
    // d'usage" (cartes.gouv.fr/cgu). France and overseas territories in
    // detail, the world at low zoom.
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    attribution: '&copy; <a href="https://www.ign.fr/">IGN</a> Plan IGN, Licence Ouverte Etalab 2.0',
    offlinePack: true,
    offlineAvgTileBytes: 50 * 1024, // measured 39–74 KB PNG, z6–z16
    offlineMaxZoom: 18,
    regional: true,
  },
  gsiStd: {
    name: 'GSI Standard (Japan)',
    // Geospatial Information Authority of Japan, 地理院タイル 標準地図.
    // GSI Content Terms of Use = Public Data License 1.0 (reproduction and
    // redistribution allowed with attribution, CC BY 4.0-compatible); the
    // service asks only that clients not overload it.
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル (GSI)</a>',
    offlinePack: true,
    offlineAvgTileBytes: 55 * 1024, // measured 9–105 KB PNG (dense Tokyo high)
    offlineMaxZoom: 18,
    regional: true,
  },
  kartverketTopo: {
    name: 'Kartverket Topo (Norway)',
    // Norwegian Mapping Authority topographic cache, CC BY 4.0
    // (kartverket.no/api-og-data/vilkar-for-bruk) — attribution "© Kartverket".
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a> (CC BY 4.0)',
    offlinePack: true,
    offlineAvgTileBytes: 70 * 1024, // measured 1–127 KB PNG
    offlineMaxZoom: 18,
    regional: true,
  },
  gaBase: {
    name: 'GA Base Map (Australia)',
    // Geoscience Australia National Base Map, CC BY 4.0
    // (© Commonwealth of Australia (Geoscience Australia)); includes
    // OpenStreetMap-derived data (ODbL). Tiles exist to z16.
    url: 'https://services.ga.gov.au/gis/rest/services/NationalBaseMap/MapServer/tile/{z}/{y}/{x}',
    attribution:
      '&copy; Commonwealth of Australia (<a href="https://www.ga.gov.au/">Geoscience Australia</a>) CC BY 4.0, &copy; OpenStreetMap contributors',
    offlinePack: true,
    offlineAvgTileBytes: 45 * 1024, // measured 2–114 KB PNG
    offlineMaxZoom: 16,
    maxNativeZoom: 16, // the service 404s past z16 — Leaflet scales z16 up
    regional: true,
  },
  ...(customStyle ? { [CUSTOM_STYLE_ID]: customStyle } : {}),
  natgeo: {
    name: 'Nat Geo',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, National Geographic',
  },
  countries: {
    name: 'Countries',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Natural Earth',
    countriesOverlay: true,
  },
  azimuthal: {
    name: 'Azimuthal',
    url: '',
    attribution: 'Azimuthal Equidistant',
    isCanvas: true,
    legacy: true, // Hidden from dropdown — projection is now a separate toggle
  },
};

export default {
  DEFAULT_CONFIG,
  fetchServerConfig,
  fetchServerSettings,
  syncAllSettingsToServer,
  flushSettingsSync,
  hasPendingSettingsSync,
  loadConfig,
  saveConfig,
  isConfigIncomplete,
  applyTheme,
  MAP_STYLES,
};
