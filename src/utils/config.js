/**
 * Configuration Utilities
 * Handles app configuration, localStorage persistence, and theme management
 * 
 * Configuration priority:
 * 1. localStorage (user's browser settings)
 * 2. Server config (from .env file)
 * 3. Default values
 */
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
  location: { lat: 40.0150, lon: -105.2705 }, // Boulder, CO (default)
  defaultDX: { lat: 35.6762, lon: 139.6503 }, // Tokyo
  units: 'imperial', // 'imperial' or 'metric'
  propagation: {
    mode: 'SSB',    // SSB, CW, FT8, FT4, WSPR, JS8, RTTY, PSK31
    power: 100      // TX power in watts
  },
  theme: 'dark', // 'dark', 'light', 'legacy', or 'retro'
  layout: 'modern', // 'modern' or 'classic'
  mouseZoom: 50, // Factor to affect rate of zooming with scrollwheel (1-100)
  timezone: '', // IANA timezone (e.g. 'America/Regina') — empty = browser default
  use12Hour: true,
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
    pskReporter: { visible: true, size: 1.0 },
    dxpeditions: { visible: true, size: 1.0 },
    pota: { visible: true, size: 1.0 },
    contests: { visible: true, size: 1.0 }
  },
  refreshIntervals: {
    spaceWeather: 300000,   // 5 minutes
    bandConditions: 300000, // 5 minutes
    pota: 120000,           // 2 minutes (was 1 min)
    dxCluster: 30000,       // 30 seconds (was 5 sec)
    terminator: 60000       // 1 minute
  }
};

// Cache for server config
let serverConfig = null;

/**
 * Fetch configuration from server (.env file)
 * This is called once on app startup
 */
export const fetchServerConfig = async () => {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      serverConfig = await response.json();
      // Only log if server has real config (not defaults)
      if (serverConfig.callsign && serverConfig.callsign !== 'N0CALL') {
        console.log('[Config] Server config:', serverConfig.callsign, '@', serverConfig.locator);
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
 * Server config only provides defaults for first-time users
 */
export const loadConfig = () => {
  // Start with defaults
  let config = { ...DEFAULT_CONFIG };
  
  // Try to load from localStorage FIRST (user's saved settings)
  let localConfig = null;
  try {
    const saved = localStorage.getItem('openhamclock_config');
    if (saved) {
      localConfig = JSON.parse(saved);
      console.log('[Config] Loaded from localStorage:', localConfig.callsign);
    }
  } catch (e) {
    console.error('Error loading config from localStorage:', e);
  }
  
  // If user has localStorage config, use it (this is the priority)
  if (localConfig) {
    config = {
      ...config,
      ...localConfig,
      // Ensure nested objects are properly merged
      location: localConfig.location || config.location,
      defaultDX: localConfig.defaultDX || config.defaultDX,
      panels: { ...config.panels, ...localConfig.panels },
      refreshIntervals: { ...config.refreshIntervals, ...localConfig.refreshIntervals }
    };
  } 
  // Only use server config if NO localStorage exists (first-time user)
  else if (serverConfig) {
    // Server config provides initial defaults for new users
    // But only if they have real values (not N0CALL)
    config = {
      ...config,
      callsign: (serverConfig.callsign && serverConfig.callsign !== 'N0CALL')
        ? serverConfig.callsign : config.callsign,
      locator: serverConfig.locator || config.locator,
      location: {
        lat: serverConfig.latitude || config.location.lat,
        lon: serverConfig.longitude || config.location.lon
      },
      defaultDX: {
        lat: serverConfig.dxLatitude || config.defaultDX.lat,
        lon: serverConfig.dxLongitude || config.defaultDX.lon
      },
      units: serverConfig.units || config.units,
      theme: serverConfig.theme || config.theme,
      layout: serverConfig.layout || config.layout,
      mouseZoom: serverConfig.mouseZoom || config.mouseZoom,
      timezone: serverConfig.timezone || config.timezone,
      use12Hour: serverConfig.timeFormat === '12',
      showSatellites: serverConfig.showSatellites ?? config.showSatellites,
      showPota: serverConfig.showPota ?? config.showPota,
      showDxPaths: serverConfig.showDxPaths ?? config.showDxPaths,
      panels: { ...config.panels, ...serverConfig.panels }
    };
  }
  
  // Mark if config needs setup (no callsign set anywhere)
  config.configIncomplete = (config.callsign === 'N0CALL' || !config.locator);
  
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
    console.log('[Config] Saved to localStorage');
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
  'openhamclock_dxFilters',
  'openhamclock_dxLocation',
  'openhamclock_dxLocked',
  'openhamclock_mapLayers',
  'openhamclock_mapSettings',
  'openhamclock_panelZoom',
  'openhamclock_pskActiveTab',
  'openhamclock_pskFilters',
  'openhamclock_pskPanelMode',
  'openhamclock_satelliteFilters',
  'openhamclock_solarImageType',
  'openhamclock_solarPanelMode',
  'openhamclock_tempUnit',
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
      console.log(`[Config] Synced ${applied} settings from server`);
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
export const syncAllSettingsToServer = () => {
  if (!_interceptorInstalled) return; // Sync not enabled — no-op
  
  // Debounce: wait 2s after last change before pushing
  if (_syncTimeout) clearTimeout(_syncTimeout);
  _syncTimeout = setTimeout(async () => {
    try {
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
      
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`[Config] Synced ${result.keys} settings to server`);
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
};

/**
 * Map Tile Providers
 */
export const MAP_STYLES = {
  dark: {
    name: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
  },
  darkEsri: {
    name: 'Dark (Esri)',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  satellite: {
    name: 'Satellite',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  MODIS: {
    name: 'Modis Truecolor', // NASA GIBS MODIS Truecolor Imagery
    url: '', // Handled dynamically in WorldMap.jsx 
    attribution: '&copy; NASA GIBS'
  },
  terrain: {
    name: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
  },
  streets: {
    name: 'Streets',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  topo: {
    name: 'Topo',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  watercolor: {
    name: 'Ocean',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  hybrid: {
    name: 'Hybrid',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google'
  },
  gray: {
    name: 'Gray',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  political: {
    name: 'Political',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  natgeo: {
    name: 'Nat Geo',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, National Geographic'
  },
  countries: {
    name: 'Countries',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Natural Earth',
    countriesOverlay: true
  },
  azimuthal: {
    name: 'Azimuthal',
    url: '',
    attribution: 'Azimuthal Equidistant',
    isCanvas: true
  }
};

export default {
  DEFAULT_CONFIG,
  fetchServerConfig,
  fetchServerSettings,
  syncAllSettingsToServer,
  loadConfig,
  saveConfig,
  isConfigIncomplete,
  applyTheme,
  MAP_STYLES
};
