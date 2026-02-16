/**
 * OpenHamClock Configuration
 * 
 * Edit this file to customize your OpenHamClock instance.
 * After making changes, refresh the browser to apply.
 * 
 * For Raspberry Pi: Edit this file at ~/openhamclock/config.js
 */

const OpenHamClockConfig = {
  // ========================================
  // STATION INFORMATION
  // ========================================
  
  // Your callsign (displayed in header)
  callsign: "K0CJH",
  
  // Your location (DE - "This End")
  // Find coordinates: https://www.latlong.net/
  location: {
    lat: 39.7392,    // Latitude (positive = North, negative = South)
    lon: -104.9903   // Longitude (positive = East, negative = West)
  },
  
  // Default DX location (far end for path calculations)
  // Set to a frequently worked location, or leave as default
  defaultDX: {
    lat: 35.6762,   // Tokyo, Japan
    lon: 139.6503
  },
  
  // ========================================
  // DISPLAY OPTIONS
  // ========================================
  
  // Theme: 'dark' (default), 'light' (coming soon)
  theme: "dark",
  
  // Time format: '24h' or '12h'
  timeFormat: "24h",
  
  // Date format: 'iso' (YYYY-MM-DD), 'us' (MM/DD/YYYY), 'eu' (DD/MM/YYYY)
  dateFormat: "iso",
  
  // Show seconds in time display
  showSeconds: true,
  
  // ========================================
  // PANELS TO DISPLAY
  // ========================================
  
  // Enable/disable individual panels
  panels: {
    utcClock: true,
    localClock: true,
    worldMap: true,
    deInfo: true,
    dxInfo: true,
    spaceWeather: true,
    bandConditions: true,
    dxCluster: true,
    potaActivity: true,
    sotaActivity: false,  // Coming soon
    satellites: false,     // Coming soon
    contests: false        // Coming soon
  },
  
  // ========================================
  // MAP OPTIONS
  // ========================================
  
  map: {
    // Map style: 'standard', 'terrain', 'minimal'
    style: "standard",
    
    // Show day/night terminator (gray line)
    showTerminator: true,
    
    // Show grid lines
    showGrid: true,
    
    // Show path between DE and DX
    showPath: true,
    
    // Path style: 'greatCircle' or 'straight'
    pathStyle: "greatCircle"
  },
  
  // ========================================
  // DX CLUSTER SETTINGS
  // ========================================
  
  dxCluster: {
    // Enable live DX cluster connection
    enabled: false,  // Set to true when API is implemented
    
    // Cluster node (Telnet)
    node: "dxc.nc7j.com",
    port: 7373,
    
    // Login callsign (usually your call)
    login: "K0CJH",
    
    // Filter options
    filters: {
      // Only show spots for these bands (empty = all bands)
      bands: [],  // e.g., ["20m", "40m", "15m"]
      
      // Only show these modes (empty = all modes)
      modes: [],  // e.g., ["FT8", "CW", "SSB"]
      
      // Minimum spot age to display (minutes)
      maxAge: 30
    }
  },
  
  // ========================================
  // POTA/SOTA SETTINGS
  // ========================================
  
  pota: {
    enabled: true,
    
    // Filter by state/region (empty = all)
    regions: [],  // e.g., ["K-CO", "K-WY"]
    
    // Maximum number of spots to show
    maxSpots: 10
  },
  
  sota: {
    enabled: false,
    
    // Filter by association (empty = all)
    associations: [],  // e.g., ["W7C", "W0C"]
    
    maxSpots: 10
  },
  
  // ========================================
  // SPACE WEATHER DATA SOURCES
  // ========================================
  
  dataRefresh: {
    // Refresh interval in seconds
    spaceWeather: 300,    // 5 minutes
    bandConditions: 300,  // 5 minutes
    dxCluster: 5,         // 5 seconds (live)
    pota: 60,             // 1 minute
    sota: 60              // 1 minute
  },
  
  // ========================================
  // SOUND/ALERTS (Coming Soon)
  // ========================================
  
  alerts: {
    enabled: false,
    
    // Sound alerts for new DX spots
    dxClusterSound: false,
    
    // Alert for specific DXCC entities
    watchedEntities: [],  // e.g., ["VP8", "3Y", "P5"]
    
    // Alert for space weather events
    spaceWeatherAlert: false
  },
  
  // ========================================
  // ADVANCED
  // ========================================
  
  advanced: {
    // Enable debug logging
    debug: false,
    
    // Custom CSS (appended to page)
    customCSS: "",
    
    // API endpoints (for self-hosted data servers)
    apiEndpoints: {
      spaceWeather: null,  // null = use default
      dxCluster: null,
      pota: null,
      sota: null
    }
  }
};

// Export for use in main application
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OpenHamClockConfig;
}
