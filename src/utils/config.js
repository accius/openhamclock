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
 * Save config to localStorage
 */
export const saveConfig = (config) => {
  try {
    localStorage.setItem('openhamclock_config', JSON.stringify(config));
    console.log('[Config] Saved to localStorage');
  } catch (e) {
    console.error('[Config] Error saving to localStorage:', e);
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
};

/**
 * Map Tile Providers
 */
export const MAP_STYLES = {
  dark: {
    name: 'Dark',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
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
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  watercolor: {
    name: 'Ocean',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  hybrid: {
    name: 'Hybrid',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google'
  },
  gray: {
    name: 'Gray',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  political: {
    name: 'Political',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  natgeo: {
    name: 'Nat Geo',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, National Geographic'
  },
  countries: {
    name: 'Countries',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Natural Earth',
    countriesOverlay: true
  }
};

export default {
  DEFAULT_CONFIG,
  fetchServerConfig,
  loadConfig,
  saveConfig,
  isConfigIncomplete,
  applyTheme,
  MAP_STYLES
};
