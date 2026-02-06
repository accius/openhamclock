/**
 * OpenHamClock - Main Application Component
 * Amateur Radio Dashboard
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// Components
import {
  Header,
  WorldMap,
  DXClusterPanel,
  POTAPanel,
  ContestPanel,
  SettingsPanel,
  DXFilterManager,
  PSKFilterManager,
  SolarPanel,
  PropagationPanel,
  DXpeditionPanel,
  PSKReporterPanel,
  DXNewsTicker,
  WeatherPanel,
  AnalogClockPanel
} from './components';

// Dockable layout
import DockableApp from './DockableApp.jsx';
import { resetLayout } from './store/layoutStore.js';

// Hooks
import {
  useSpaceWeather,
  useBandConditions,
  useDXClusterData,
  usePOTASpots,
  useContests,
  useWeather,
  usePropagation,
  useMySpots,
  useDXpeditions,
  useSatellites,
  useSolarIndices,
  usePSKReporter,
  useWSJTX
} from './hooks';

// Utils
import {
  loadConfig,
  saveConfig,
  applyTheme,
  fetchServerConfig,
  calculateGridSquare,
  calculateSunTimes,
  getBandColor
} from './utils';

const App = () => {
  // Configuration state - initially use defaults, then load from server
  const [config, setConfig] = useState(loadConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showDxWeather, setShowDxWeather] = useState(true);
  const [classicAnalogClock, setClassicAnalogClock] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [startTime] = useState(Date.now());
  const [uptime, setUptime] = useState('0d 0h 0m');
  const { t } = useTranslation();
  
  // Load server configuration on startup (only matters for first-time users)
  useEffect(() => {
    const initConfig = async () => {
      // Fetch server config (provides defaults for new users without localStorage)
      const serverCfg = await fetchServerConfig();
      if (serverCfg) {
        setShowDxWeather(serverCfg.showDxWeather !== false);
        setClassicAnalogClock(serverCfg.classicAnalogClock === true);
      }

      // Load config - localStorage takes priority over server config
      const loadedConfig = loadConfig();
      setConfig(loadedConfig);
      setConfigLoaded(true);
      
      // Only show settings if user has no saved config AND no valid callsign
      // This prevents the popup from appearing every refresh
      const hasLocalStorage = localStorage.getItem('openhamclock_config');
      if (!hasLocalStorage && loadedConfig.callsign === 'N0CALL') {
        setShowSettings(true);
      }
    };
    initConfig();
  }, []);
  
  // DX Location with localStorage persistence
  const [dxLocation, setDxLocation] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxLocation');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.lat && parsed.lon) return parsed;
      }
    } catch (e) {}
    return config.defaultDX;
  });
  
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxLocation', JSON.stringify(dxLocation));
    } catch (e) {}
  }, [dxLocation]);
  
  // DX Location Lock state with localStorage persistence
  const [dxLocked, setDxLocked] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxLocked');
      return stored === 'true';
    } catch (e) {}
    return false;
  });
  
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxLocked', dxLocked.toString());
    } catch (e) {}
  }, [dxLocked]);
  
  const handleToggleDxLock = useCallback(() => {
    setDxLocked(prev => !prev);
  }, []);
  
  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [showDXFilters, setShowDXFilters] = useState(false);
  const [showPSKFilters, setShowPSKFilters] = useState(false);
  const [layoutResetKey, setLayoutResetKey] = useState(0);
  const [tempUnit, setTempUnit] = useState(() => {
    try { return localStorage.getItem('openhamclock_tempUnit') || 'F'; } catch { return 'F'; }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [updateInProgress, setUpdateInProgress] = useState(false);
  const isLocalInstall = useMemo(() => {
    const host = (window.location.hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'openhamclock.com' || host.endsWith('.openhamclock.com')) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.local')) return true;
    // RFC1918 private ranges
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
    if (host.startsWith('172.')) {
      const parts = host.split('.');
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  }, []);
  
  // Map layer visibility
  const [mapLayers, setMapLayers] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_mapLayers');
      const defaults = { showDXPaths: true, showDXLabels: true, showPOTA: true, showSatellites: false, showPSKReporter: true, showWSJTX: true };
      return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    } catch (e) { return { showDXPaths: true, showDXLabels: true, showPOTA: true, showSatellites: false, showPSKReporter: true, showWSJTX: true }; }
  });
  
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_mapLayers', JSON.stringify(mapLayers));
    } catch (e) {}
  }, [mapLayers]);
  
  const [hoveredSpot, setHoveredSpot] = useState(null);
  
  const toggleDXPaths = useCallback(() => setMapLayers(prev => ({ ...prev, showDXPaths: !prev.showDXPaths })), []);
  const toggleDXLabels = useCallback(() => setMapLayers(prev => ({ ...prev, showDXLabels: !prev.showDXLabels })), []);
  const togglePOTA = useCallback(() => setMapLayers(prev => ({ ...prev, showPOTA: !prev.showPOTA })), []);
  const toggleSatellites = useCallback(() => setMapLayers(prev => ({ ...prev, showSatellites: !prev.showSatellites })), []);
  
  // Satellite filters
  const [satelliteFilters, setSatelliteFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_satelliteFilters');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_satelliteFilters', JSON.stringify(satelliteFilters));
    } catch (e) {}
  }, [satelliteFilters]);
  
  const togglePSKReporter = useCallback(() => setMapLayers(prev => ({ ...prev, showPSKReporter: !prev.showPSKReporter })), []);
  const toggleWSJTX = useCallback(() => setMapLayers(prev => ({ ...prev, showWSJTX: !prev.showWSJTX })), []);
  
  // 12/24 hour format
  const [use12Hour, setUse12Hour] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_use12Hour') === 'true';
    } catch (e) { return false; }
  });
  
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_use12Hour', use12Hour.toString());
    } catch (e) {}
  }, [use12Hour]);
  
  const handleTimeFormatToggle = useCallback(() => setUse12Hour(prev => !prev), []);

  // Reset dockable layout
  const handleResetLayout = useCallback(() => {
    resetLayout();
    setLayoutResetKey(prev => prev + 1);
  }, []);

  // Fullscreen
  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const handleUpdateClick = useCallback(async () => {
    if (updateInProgress) return;
    const confirmed = window.confirm('Run update now? The server will restart when finished.');
    if (!confirmed) return;
    setUpdateInProgress(true);
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      let payload = {};
      try { payload = await res.json(); } catch {}
      if (!res.ok) {
        throw new Error(payload.error || 'Update failed to start');
      }
      alert('Update started. The page will reload after the server restarts.');
      setTimeout(() => {
        try { window.location.reload(); } catch {}
      }, 15000);
    } catch (err) {
      setUpdateInProgress(false);
      alert(`Update failed: ${err.message || 'Unknown error'}`);
    }
  }, [updateInProgress]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    applyTheme(config.theme || 'dark');
  }, []);

  // Config save handler - persists to localStorage
  const handleSaveConfig = (newConfig) => {
    setConfig(newConfig);
    saveConfig(newConfig);
    applyTheme(newConfig.theme || 'dark');
    console.log('[Config] Saved to localStorage:', newConfig.callsign);
    if (newConfig.lowMemoryMode) {
      console.log('[Config] Low Memory Mode ENABLED - reduced spot limits, disabled animations');
    }
  };

  // Data hooks
  const spaceWeather = useSpaceWeather();
  const bandConditions = useBandConditions(spaceWeather.data);
  const solarIndices = useSolarIndices();
  const potaSpots = usePOTASpots();
  
  // DX Filters
  const [dxFilters, setDxFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  });
  
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_dxFilters', JSON.stringify(dxFilters));
    } catch (e) {}
  }, [dxFilters]);
  
  // PSKReporter Filters
  const [pskFilters, setPskFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_pskFilters');
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  });
  
  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_pskFilters', JSON.stringify(pskFilters));
    } catch (e) {}
  }, [pskFilters]);
  
  const dxClusterData = useDXClusterData(dxFilters, config);
  const dxpeditions = useDXpeditions();
  const contests = useContests();
  const propagation = usePropagation(config.location, dxLocation);
  const mySpots = useMySpots(config.callsign);
  const satellites = useSatellites(config.location);
  
  // Create static satellite list for Settings (doesn't reorder with visibility changes)
  // Only updates when new satellites are added/removed from TLE data
  const satelliteNameList = useMemo(() => {
    if (!satellites.data || satellites.data.length === 0) return [];
    
    // Create a Set of current names to track what we've seen
    const currentNames = new Set(satellites.data.map(s => s.name));
    
    // Keep existing order if satellites haven't changed
    // Sort alphabetically by name for stable display
    return satellites.data
      .map(s => ({ name: s.name, mode: s.mode, color: s.color }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [satellites.data?.length]); // Only recompute when satellite count changes
  
  // Filter satellites based on selection
  const filteredSatellites = satelliteFilters.length > 0 
    ? (satellites.data || []).filter(sat => satelliteFilters.includes(sat.name))
    : satellites.data;
  
  const localWeather = useWeather(config.location, tempUnit);
  const pskReporter = usePSKReporter(config.callsign, { 
    minutes: config.lowMemoryMode ? 5 : 15, 
    enabled: config.callsign !== 'N0CALL',
    maxSpots: config.lowMemoryMode ? 30 : 100
  });
  const wsjtx = useWSJTX();

  // Filter PSKReporter spots for map display
  const filteredPskSpots = useMemo(() => {
    const allSpots = [...(pskReporter.txReports || []), ...(pskReporter.rxReports || [])];
    if (!pskFilters?.bands?.length && !pskFilters?.grids?.length && !pskFilters?.modes?.length) {
      return allSpots;
    }
    return allSpots.filter(spot => {
      if (pskFilters?.bands?.length && !pskFilters.bands.includes(spot.band)) return false;
      if (pskFilters?.modes?.length && !pskFilters.modes.includes(spot.mode)) return false;
      if (pskFilters?.grids?.length) {
        const grid = spot.receiverGrid || spot.senderGrid;
        if (!grid) return false;
        const gridPrefix = grid.substring(0, 2).toUpperCase();
        if (!pskFilters.grids.includes(gridPrefix)) return false;
      }
      return true;
    });
  }, [pskReporter.txReports, pskReporter.rxReports, pskFilters]);

  // Filter WSJT-X decodes for map display (only those with lat/lon from grid)
  const wsjtxMapSpots = useMemo(() => {
    return wsjtx.decodes.filter(d => d.lat && d.lon && d.type === 'CQ');
  }, [wsjtx.decodes]);

  // Computed values
  const deGrid = useMemo(() => calculateGridSquare(config.location.lat, config.location.lon), [config.location]);
  const dxGrid = useMemo(() => calculateGridSquare(dxLocation.lat, dxLocation.lon), [dxLocation]);
  const deSunTimes = useMemo(() => calculateSunTimes(config.location.lat, config.location.lon, currentTime), [config.location, currentTime]);
  const dxSunTimes = useMemo(() => calculateSunTimes(dxLocation.lat, dxLocation.lon, currentTime), [dxLocation, currentTime]);

  // Time update
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      const elapsed = Date.now() - startTime;
      const d = Math.floor(elapsed / 86400000);
      const h = Math.floor((elapsed % 86400000) / 3600000);
      const m = Math.floor((elapsed % 3600000) / 60000);
      setUptime(`${d}d ${h}h ${m}m`);
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const handleDXChange = useCallback((coords) => {
    setDxLocation({ lat: coords.lat, lon: coords.lon });
  }, []);

  // Format times — use explicit timezone if configured (fixes privacy browsers like Librewolf
  // that spoof timezone to UTC via privacy.resistFingerprinting)
  const utcTime = currentTime.toISOString().substr(11, 8);
  const utcDate = currentTime.toISOString().substr(0, 10);
  const localTimeOpts = { hour12: use12Hour };
  const localDateOpts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (config.timezone) {
    localTimeOpts.timeZone = config.timezone;
    localDateOpts.timeZone = config.timezone;
  }
  const localTime = currentTime.toLocaleTimeString('en-US', localTimeOpts);
  const localDate = currentTime.toLocaleDateString('en-US', localDateOpts);

  // Calculate sidebar visibility for responsive grid
  const leftSidebarVisible = config.panels?.deLocation?.visible !== false ||
                           config.panels?.dxLocation?.visible !== false ||
                           config.panels?.solar?.visible !== false ||
                           config.panels?.propagation?.visible !== false;
  const rightSidebarVisible = config.panels?.dxCluster?.visible !== false ||
                            config.panels?.pskReporter?.visible !== false ||
                            config.panels?.dxpeditions?.visible !== false ||
                            config.panels?.pota?.visible !== false ||
                            config.panels?.contests?.visible !== false;
  const leftSidebarWidth = leftSidebarVisible ? '270px' : '0px';
  const rightSidebarWidth = rightSidebarVisible ? '300px' : '0px';
  
  // Dynamic grid columns - adjust based on which sidebars are visible
  const getGridTemplateColumns = () => {
    if (!leftSidebarVisible && !rightSidebarVisible) {
      return '1fr'; // Only map visible - single column
    }
    if (!leftSidebarVisible) {
      return `1fr ${rightSidebarWidth}`; // Only right sidebar
    }
    if (!rightSidebarVisible) {
      return `${leftSidebarWidth} 1fr`; // Only left sidebar
    }
    return `${leftSidebarWidth} 1fr ${rightSidebarWidth}`; // Both sidebars
  };

  // Scale for small screens
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const calculateScale = () => {
      const minWidth = 1200;
      const minHeight = 800;
      const scaleX = window.innerWidth / minWidth;
      const scaleY = window.innerHeight / minHeight;
      setScale(Math.min(scaleX, scaleY, 1));
    };
    calculateScale();
    window.addEventListener('resize', calculateScale);
    return () => window.removeEventListener('resize', calculateScale);
  }, []);

  return (
    <div style={{ 
      width: '100vw',
      height: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden'
    }}>
      {config.layout === 'dockable' ? (
        /* DOCKABLE PANEL LAYOUT */
        <DockableApp
          key={layoutResetKey}
          config={config}
          currentTime={currentTime}
          deGrid={deGrid}
          dxGrid={dxGrid}
          dxLocation={dxLocation}
          deSunTimes={deSunTimes}
          dxSunTimes={dxSunTimes}
          handleDXChange={handleDXChange}
          dxLocked={dxLocked}
          handleToggleDxLock={handleToggleDxLock}
          localWeather={localWeather}
          tempUnit={tempUnit}
          setTempUnit={setTempUnit}
          showDxWeather={showDxWeather}
          spaceWeather={spaceWeather}
          solarIndices={solarIndices}
          bandConditions={bandConditions}
          propagation={propagation}
          dxClusterData={dxClusterData}
          potaSpots={potaSpots}
          mySpots={mySpots}
          dxpeditions={dxpeditions}
          contests={contests}
          satellites={satellites}
          pskReporter={pskReporter}
          wsjtx={wsjtx}
          filteredPskSpots={filteredPskSpots}
          wsjtxMapSpots={wsjtxMapSpots}
          dxFilters={dxFilters}
          setDxFilters={setDxFilters}
          pskFilters={pskFilters}
          setShowDXFilters={setShowDXFilters}
          setShowPSKFilters={setShowPSKFilters}
          mapLayers={mapLayers}
          toggleDXPaths={toggleDXPaths}
          toggleDXLabels={toggleDXLabels}
          togglePOTA={togglePOTA}
          toggleSatellites={toggleSatellites}
          togglePSKReporter={togglePSKReporter}
          toggleWSJTX={toggleWSJTX}
          hoveredSpot={hoveredSpot}
          setHoveredSpot={setHoveredSpot}
          utcTime={utcTime}
          utcDate={utcDate}
          localTime={localTime}
          localDate={localDate}
          use12Hour={use12Hour}
          handleTimeFormatToggle={handleTimeFormatToggle}
          setShowSettings={setShowSettings}
          handleFullscreenToggle={handleFullscreenToggle}
          isFullscreen={isFullscreen}
        />
      ) : config.layout === 'classic' ? (
        /* CLASSIC HAMCLOCK-STYLE LAYOUT */
        <div style={{ 
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#000000',
          fontFamily: 'JetBrains Mono, monospace',
          overflow: 'hidden'
        }}>
          {/* TOP BAR - HamClock style */}
          <div style={{ 
            display: 'grid',
            gridTemplateColumns: '280px 1fr 300px',
            height: '130px',
            borderBottom: '2px solid #333',
            background: '#000'
          }}>
            {/* Callsign & Time */}
            <div style={{ padding: '8px 12px', borderRight: '1px solid #333' }}>
              <div 
                style={{ 
                  fontSize: '42px', 
                  fontWeight: '900', 
                  color: '#ff4444', 
                  fontFamily: 'Orbitron, monospace',
                  cursor: 'pointer',
                  lineHeight: 1
                }}
                onClick={() => setShowSettings(true)}
                title="Click for settings"
              >
                {config.callsign}
              </div>
              <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                Up 35d 18h • v4.20
              </div>
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '36px', fontWeight: '700', color: '#00ff00', fontFamily: 'JetBrains Mono, Consolas, monospace', lineHeight: 1, width: '180px' }}>
                  {utcTime}<span style={{ fontSize: '20px', color: '#00cc00' }}>:{String(new Date().getUTCSeconds()).padStart(2, '0')}</span>
                </div>
                <div style={{ fontSize: '14px', color: '#00cc00', marginTop: '2px' }}>
                  {utcDate} <span style={{ color: '#666', marginLeft: '8px' }}>UTC</span>
                </div>
              </div>
            </div>
            
            {/* Solar Indices - SSN & SFI */}
            <div style={{ display: 'flex', borderRight: '1px solid #333' }}>
              {/* SSN */}
              <div style={{ flex: 1, padding: '8px', borderRight: '1px solid #333' }}>
                <div style={{ fontSize: '10px', color: '#888', textAlign: 'center' }}>Sunspot Number</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, height: '70px', background: '#001100', border: '1px solid #333', borderRadius: '2px', padding: '4px' }}>
                    {solarIndices?.data?.ssn?.history?.length > 0 && (
                      <svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none">
                        {(() => {
                          const data = solarIndices.data.ssn.history.slice(-30);
                          const values = data.map(d => d.value);
                          const max = Math.max(...values, 1);
                          const min = Math.min(...values, 0);
                          const range = max - min || 1;
                          const points = data.map((d, i) => {
                            const x = (i / (data.length - 1)) * 100;
                            const y = 60 - ((d.value - min) / range) * 55;
                            return `${x},${y}`;
                          }).join(' ');
                          return <polyline points={points} fill="none" stroke="#00ff00" strokeWidth="1.5" />;
                        })()}
                      </svg>
                    )}
                  </div>
                  <div style={{ fontSize: '48px', fontWeight: '700', color: '#00ffff', fontFamily: 'Orbitron, monospace' }}>
                    {solarIndices?.data?.ssn?.current || '--'}
                  </div>
                </div>
                <div style={{ fontSize: '10px', color: '#666', textAlign: 'center', marginTop: '2px' }}>-30 Days</div>
              </div>
              
              {/* SFI */}
              <div style={{ flex: 1, padding: '8px' }}>
                <div style={{ fontSize: '10px', color: '#888', textAlign: 'center' }}>10.7 cm Solar flux</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, height: '70px', background: '#001100', border: '1px solid #333', borderRadius: '2px', padding: '4px' }}>
                    {solarIndices?.data?.sfi?.history?.length > 0 && (
                      <svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none">
                        {(() => {
                          const data = solarIndices.data.sfi.history.slice(-30);
                          const values = data.map(d => d.value);
                          const max = Math.max(...values, 1);
                          const min = Math.min(...values);
                          const range = max - min || 1;
                          const points = data.map((d, i) => {
                            const x = (i / (data.length - 1)) * 100;
                            const y = 60 - ((d.value - min) / range) * 55;
                            return `${x},${y}`;
                          }).join(' ');
                          return <polyline points={points} fill="none" stroke="#00ff00" strokeWidth="1.5" />;
                        })()}
                      </svg>
                    )}
                  </div>
                  <div style={{ fontSize: '48px', fontWeight: '700', color: '#ff66ff', fontFamily: 'Orbitron, monospace' }}>
                    {solarIndices?.data?.sfi?.current || '--'}
                  </div>
                </div>
                <div style={{ fontSize: '10px', color: '#666', textAlign: 'center', marginTop: '2px' }}>-30 Days +7</div>
              </div>
            </div>
            
            {/* Live Spots & Indices */}
            <div style={{ display: 'flex' }}>
              {/* Live Spots by Band */}
              <div style={{ flex: 1, padding: '8px', borderRight: '1px solid #333' }}>
                <div style={{ fontSize: '12px', color: '#ff6666', fontWeight: '700' }}>Live Spots</div>
                <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>of {deGrid} - 15 mins</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', fontSize: '10px' }}>
                  {[
                    { band: '160m', color: '#ff6666' },
                    { band: '80m', color: '#ff9966' },
                    { band: '60m', color: '#ffcc66' },
                    { band: '40m', color: '#ccff66' },
                    { band: '30m', color: '#66ff99' },
                    { band: '20m', color: '#66ffcc' },
                    { band: '17m', color: '#66ccff' },
                    { band: '15m', color: '#6699ff' },
                    { band: '12m', color: '#9966ff' },
                    { band: '10m', color: '#cc66ff' },
                  ].map(b => (
                    <div key={b.band} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: b.color }}>{b.band}</span>
                      <span style={{ color: '#fff' }}>
                        {dxClusterData.spots?.filter(s => {
                          const freq = parseFloat(s.freq);
                          const bands = {
                            '160m': [1.8, 2], '80m': [3.5, 4], '60m': [5.3, 5.4], '40m': [7, 7.3],
                            '30m': [10.1, 10.15], '20m': [14, 14.35], '17m': [18.068, 18.168],
                            '15m': [21, 21.45], '12m': [24.89, 24.99], '10m': [28, 29.7]
                          };
                          const r = bands[b.band];
                          return r && freq >= r[0] && freq <= r[1];
                        }).length || 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Space Weather Indices */}
              <div style={{ width: '70px', padding: '8px', fontSize: '11px' }}>
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ color: '#888' }}>X-Ray</div>
                  <div style={{ color: '#ffff00', fontSize: '16px', fontWeight: '700' }}>M3.0</div>
                </div>
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ color: '#888' }}>Kp</div>
                  <div style={{ color: '#00ff00', fontSize: '16px', fontWeight: '700' }}>{solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}</div>
                </div>
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ color: '#888' }}>Bz</div>
                  <div style={{ color: '#00ffff', fontSize: '16px', fontWeight: '700' }}>-0</div>
                </div>
                <div>
                  <div style={{ color: '#888' }}>Aurora</div>
                  <div style={{ color: '#ff00ff', fontSize: '16px', fontWeight: '700' }}>18</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* MAIN AREA */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* DX Cluster List */}
            <div style={{ width: '220px', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', background: '#000' }}>
              <div style={{ padding: '4px 8px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#ff6666', fontSize: '14px', fontWeight: '700' }}>Cluster</span>
                <span style={{ color: '#00ff00', fontSize: '10px' }}>dxspider.co.uk:7300</span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', fontSize: '11px' }}>
                {dxClusterData.spots?.slice(0, 25).map((spot, i) => (
                  <div 
                    key={i} 
                    style={{ 
                      padding: '2px 6px', 
                      display: 'grid', 
                      gridTemplateColumns: '65px 1fr 35px',
                      gap: '4px',
                      borderBottom: '1px solid #111',
                      cursor: 'pointer',
                      background: hoveredSpot?.call === spot.call ? '#333' : 'transparent'
                    }}
                    onMouseEnter={() => setHoveredSpot(spot)}
                    onMouseLeave={() => setHoveredSpot(null)}
                  >
                    <span style={{ color: '#ffff00' }}>{parseFloat(spot.freq).toFixed(1)}</span>
                    <span style={{ color: '#00ffff' }}>{spot.call}</span>
                    <span style={{ color: '#888' }}>{spot.time || '--'}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Map */}
            <div style={{ flex: 1, position: 'relative' }}>
              <WorldMap
                deLocation={config.location}
                dxLocation={dxLocation}
                onDXChange={handleDXChange}
                dxLocked={dxLocked}
                potaSpots={potaSpots.data}
                mySpots={mySpots.data}
                dxPaths={dxClusterData.paths}
                dxFilters={dxFilters}
                satellites={satellites.data}
                pskReporterSpots={filteredPskSpots}
                showDXPaths={mapLayers.showDXPaths}
                showDXLabels={mapLayers.showDXLabels}
                onToggleDXLabels={toggleDXLabels}
                showPOTA={mapLayers.showPOTA}
                showSatellites={mapLayers.showSatellites}
                showPSKReporter={mapLayers.showPSKReporter}
                wsjtxSpots={wsjtxMapSpots}
                showWSJTX={mapLayers.showWSJTX}
                onToggleSatellites={toggleSatellites}
                hoveredSpot={hoveredSpot}
                callsign={config.callsign}
                lowMemoryMode={config.lowMemoryMode}
              />
              
              {/* Settings button overlay */}
              <button
                onClick={() => setShowSettings(true)}
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  background: 'rgba(0,0,0,0.7)',
                  border: '1px solid #444',
                  color: '#fff',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  borderRadius: '4px'
                }}
              >
                {t('app.settings')}
              </button>
              
              {/* DX Lock button overlay */}
              <button
                onClick={handleToggleDxLock}
                title={dxLocked ? 'Unlock DX position (allow map clicks)' : 'Lock DX position (prevent map clicks)'}
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '110px',
                  background: dxLocked ? 'rgba(255,180,0,0.9)' : 'rgba(0,0,0,0.7)',
                  border: '1px solid #444',
                  color: dxLocked ? '#000' : '#fff',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  borderRadius: '4px'
                }}
              >
                {dxLocked ? '🔒 DX Locked' : '🔓 DX Unlocked'}
              </button>
            </div>
          </div>
          
          {/* BOTTOM - Frequency Scale */}
          <div style={{ 
            height: '24px', 
            background: 'linear-gradient(90deg, #ff0000 0%, #ff8800 15%, #ffff00 30%, #00ff00 45%, #00ffff 60%, #0088ff 75%, #8800ff 90%, #ff00ff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            fontSize: '10px',
            color: '#000',
            fontWeight: '700'
          }}>
            <span>MHz</span>
            <span>5</span>
            <span>10</span>
            <span>15</span>
            <span>20</span>
            <span>25</span>
            <span>30</span>
            <span>35</span>
          </div>
        </div>
      ) : config.layout === 'tablet' ? (
        /* TABLET LAYOUT - Optimized for 7-10" widescreen displays (16:9) */
        <div style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          fontFamily: 'JetBrains Mono, monospace',
          overflow: 'hidden'
        }}>
          {/* COMPACT TOP BAR */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-color)',
            padding: '6px 12px',
            height: '52px',
            flexShrink: 0,
            gap: '10px'
          }}>
            {/* Callsign */}
            <span
              style={{
                fontSize: '28px',
                fontWeight: '900',
                color: 'var(--accent-amber)',
                fontFamily: 'Orbitron, monospace',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
              onClick={() => setShowSettings(true)}
              title="Settings"
            >
              {config.callsign}
            </span>

            {/* UTC */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: '600' }}>UTC</span>
              <span style={{ fontSize: '24px', fontWeight: '700', color: 'var(--accent-cyan)' }}>{utcTime}</span>
            </div>

            {/* Local */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              onClick={handleTimeFormatToggle}
              title={`Click for ${use12Hour ? '24h' : '12h'} format`}
            >
              <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: '600' }}>LOC</span>
              <span style={{ fontSize: '24px', fontWeight: '700', color: 'var(--accent-amber)' }}>{localTime}</span>
            </div>

            {/* Solar Quick Stats */}
            <div style={{ display: 'flex', gap: '10px', fontSize: '15px', whiteSpace: 'nowrap' }}>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>SFI </span>
                <span style={{ color: 'var(--accent-amber)', fontWeight: '700' }}>{solarIndices?.data?.sfi?.current || spaceWeather?.data?.solarFlux || '--'}</span>
              </span>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>K </span>
                <span style={{ color: parseInt(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex) >= 4 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: '700' }}>
                  {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
                </span>
              </span>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>SSN </span>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{solarIndices?.data?.ssn?.current || '--'}</span>
              </span>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: '4px' }}>
              <a
                href="https://www.paypal.com/donate/?hosted_button_id=MMYPQBLA6SW68"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: 'linear-gradient(135deg, #0070ba 0%, #003087 100%)',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: '600',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
                title="Donate via PayPal"
              >💳</a>
              <button
                onClick={() => setShowSettings(true)}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >⚙</button>
              <button
                onClick={handleFullscreenToggle}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >{isFullscreen ? '⛶' : '⛶'}</button>
            </div>
          </div>

          {/* MAIN AREA: Map + Data Sidebar */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* MAP */}
            <div style={{ flex: 1, position: 'relative' }}>
              <WorldMap
                deLocation={config.location}
                dxLocation={dxLocation}
                onDXChange={handleDXChange}
                dxLocked={dxLocked}
                potaSpots={potaSpots.data}
                mySpots={mySpots.data}
                dxPaths={dxClusterData.paths}
                dxFilters={dxFilters}
                satellites={satellites.data}
                pskReporterSpots={filteredPskSpots}
                showDXPaths={mapLayers.showDXPaths}
                showDXLabels={mapLayers.showDXLabels}
                onToggleDXLabels={toggleDXLabels}
                showPOTA={mapLayers.showPOTA}
                showSatellites={mapLayers.showSatellites}
                showPSKReporter={mapLayers.showPSKReporter}
                wsjtxSpots={wsjtxMapSpots}
                showWSJTX={mapLayers.showWSJTX}
                onToggleSatellites={toggleSatellites}
                hoveredSpot={hoveredSpot}
                hideOverlays={true}
                lowMemoryMode={config.lowMemoryMode}
              />
              {/* DX Lock button overlay */}
              <button
                onClick={handleToggleDxLock}
                title={dxLocked ? 'Unlock DX position (allow map clicks)' : 'Lock DX position (prevent map clicks)'}
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  background: dxLocked ? 'rgba(255,180,0,0.9)' : 'rgba(0,0,0,0.7)',
                  border: '1px solid #444',
                  color: dxLocked ? '#000' : '#fff',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  zIndex: 1000
                }}
              >
                {dxLocked ? '🔒 DX Locked' : '🔓 DX Unlocked'}
              </button>
              {/* Compact Band Legend */}
              <div style={{
                position: 'absolute',
                bottom: '4px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.8)',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '3px 6px',
                zIndex: 1000,
                display: 'flex',
                gap: '3px',
                alignItems: 'center',
                fontSize: '9px',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: '700'
              }}>
                {[
                  { band: '160', color: '#ff6666' }, { band: '80', color: '#ff9966' },
                  { band: '40', color: '#ffcc66' }, { band: '30', color: '#99ff66' },
                  { band: '20', color: '#66ff99' }, { band: '17', color: '#66ffcc' },
                  { band: '15', color: '#66ccff' }, { band: '12', color: '#6699ff' },
                  { band: '10', color: '#9966ff' }, { band: '6', color: '#ff66ff' }
                ].map(b => (
                  <span key={b.band} style={{
                    background: b.color,
                    color: '#000',
                    padding: '1px 3px',
                    borderRadius: '2px',
                    lineHeight: 1.2
                  }}>{b.band}</span>
                ))}
              </div>
            </div>

            {/* DATA SIDEBAR */}
            <div style={{
              width: '280px',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              overflow: 'hidden'
            }}>
              {/* Band Conditions Grid */}
              <div style={{ padding: '8px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '13px', color: 'var(--accent-amber)', fontWeight: '700', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Band Conditions</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                  {(bandConditions?.data || []).slice(0, 13).map((band, idx) => {
                    const colors = {
                      GOOD: { bg: 'rgba(0,255,136,0.2)', color: '#00ff88', border: 'rgba(0,255,136,0.4)' },
                      FAIR: { bg: 'rgba(255,180,50,0.2)', color: '#ffb432', border: 'rgba(255,180,50,0.4)' },
                      POOR: { bg: 'rgba(255,68,102,0.2)', color: '#ff4466', border: 'rgba(255,68,102,0.4)' }
                    };
                    const s = colors[band.condition] || colors.FAIR;
                    return (
                      <div key={idx} style={{
                        background: s.bg,
                        border: `1px solid ${s.border}`,
                        borderRadius: '4px',
                        padding: '5px 2px',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: '15px', fontWeight: '700', color: s.color }}>{band.band}</div>
                        <div style={{ fontSize: '10px', fontWeight: '600', color: s.color, opacity: 0.8 }}>{band.condition}</div>
                      </div>
                    );
                  })}
                </div>
                {/* MUF/LUF */}
                {propagation.data && (
                  <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '14px', justifyContent: 'center' }}>
                    <span><span style={{ color: 'var(--text-muted)' }}>MUF </span><span style={{ color: '#ff8800', fontWeight: '700' }}>{propagation.data.muf || '?'}</span></span>
                    <span><span style={{ color: 'var(--text-muted)' }}>LUF </span><span style={{ color: '#00aaff', fontWeight: '700' }}>{propagation.data.luf || '?'}</span></span>
                  </div>
                )}
              </div>

              {/* Compact DX Cluster */}
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', color: 'var(--accent-red)', fontWeight: '700', textTransform: 'uppercase' }}>DX Cluster</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{dxClusterData.spots?.length || 0} spots</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {dxClusterData.spots?.slice(0, 30).map((spot, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '3px 8px',
                        display: 'grid',
                        gridTemplateColumns: '80px 1fr 52px',
                        gap: '4px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        cursor: 'pointer',
                        background: hoveredSpot?.call === spot.call ? 'var(--bg-tertiary)' : 'transparent',
                        fontSize: '14px'
                      }}
                      onMouseEnter={() => setHoveredSpot(spot)}
                      onMouseLeave={() => setHoveredSpot(null)}
                    >
                      <span style={{ color: getBandColor(spot.freq), fontWeight: '700' }}>{parseFloat(spot.freq).toFixed(1)}</span>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.call}</span>
                      <span style={{ color: 'var(--text-muted)', textAlign: 'right', fontSize: '12px' }}>{spot.time || '--'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* DX News - sidebar footer */}
              <div style={{
                flexShrink: 0,
                borderTop: '1px solid var(--border-color)',
                background: 'var(--bg-panel)',
                height: '28px',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <DXNewsTicker sidebar={true} />
              </div>
            </div>
          </div>
        </div>

      ) : config.layout === 'compact' ? (
        /* COMPACT LAYOUT - Optimized for 4:3 screens and data-first display */
        <div style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          fontFamily: 'JetBrains Mono, monospace',
          overflow: 'hidden'
        }}>
          {/* TOP: Callsign + Times + Solar */}
          <div style={{
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-color)',
            padding: '8px 12px',
            flexShrink: 0
          }}>
            {/* Row 1: Callsign + Times */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span
                style={{
                  fontSize: '32px',
                  fontWeight: '900',
                  color: 'var(--accent-amber)',
                  fontFamily: 'Orbitron, monospace',
                  cursor: 'pointer'
                }}
                onClick={() => setShowSettings(true)}
                title="Settings"
              >
                {config.callsign}
              </span>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>UTC</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--accent-cyan)', lineHeight: 1 }}>{utcTime}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{utcDate}</div>
                </div>
                <div
                  style={{ textAlign: 'center', cursor: 'pointer' }}
                  onClick={handleTimeFormatToggle}
                  title={`Click for ${use12Hour ? '24h' : '12h'}`}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Local</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--accent-amber)', lineHeight: 1 }}>{localTime}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{localDate}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <a
                  href="https://www.paypal.com/donate/?hosted_button_id=MMYPQBLA6SW68"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: 'linear-gradient(135deg, #0070ba 0%, #003087 100%)',
                    border: 'none',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer'
                  }}
                  title="Donate via PayPal"
                >💳</a>
                <button
                  onClick={() => setShowSettings(true)}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >⚙</button>
                <button
                  onClick={handleFullscreenToggle}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >⛶</button>
              </div>
            </div>
            {/* Row 2: Solar indices inline */}
            <div style={{ display: 'flex', gap: '16px', fontSize: '15px', justifyContent: 'center' }}>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>SFI </span>
                <span style={{ color: 'var(--accent-amber)', fontWeight: '700' }}>{solarIndices?.data?.sfi?.current || spaceWeather?.data?.solarFlux || '--'}</span>
              </span>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>K </span>
                <span style={{ color: parseInt(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex) >= 4 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: '700' }}>
                  {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
                </span>
              </span>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>SSN </span>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{solarIndices?.data?.ssn?.current || '--'}</span>
              </span>
              {propagation.data && (
                <>
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>MUF </span>
                    <span style={{ color: '#ff8800', fontWeight: '600' }}>{propagation.data.muf || '?'} MHz</span>
                  </span>
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>LUF </span>
                    <span style={{ color: '#00aaff', fontWeight: '600' }}>{propagation.data.luf || '?'} MHz</span>
                  </span>
                </>
              )}
              {localWeather?.data && (
                <span>
                  <span style={{ marginRight: '2px' }}>{localWeather.data.icon}</span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>{localWeather.data.temp}°{localWeather.data.tempUnit || tempUnit}</span>
                </span>
              )}
            </div>
          </div>

          {/* BAND CONDITIONS - Full Width */}
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', flexWrap: 'wrap' }}>
              {(bandConditions?.data || []).slice(0, 13).map((band, idx) => {
                const colors = {
                  GOOD: { bg: 'rgba(0,255,136,0.2)', color: '#00ff88', border: 'rgba(0,255,136,0.4)' },
                  FAIR: { bg: 'rgba(255,180,50,0.2)', color: '#ffb432', border: 'rgba(255,180,50,0.4)' },
                  POOR: { bg: 'rgba(255,68,102,0.2)', color: '#ff4466', border: 'rgba(255,68,102,0.4)' }
                };
                const s = colors[band.condition] || colors.FAIR;
                return (
                  <div key={idx} style={{
                    background: s.bg,
                    border: `1px solid ${s.border}`,
                    borderRadius: '4px',
                    padding: '5px 10px',
                    textAlign: 'center',
                    minWidth: '58px'
                  }}>
                    <div style={{ fontFamily: 'Orbitron, monospace', fontSize: '16px', fontWeight: '700', color: s.color }}>{band.band}</div>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: s.color, opacity: 0.8 }}>{band.condition}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* MAIN: Map + DX Cluster side by side */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Map */}
            <div style={{ flex: 1, position: 'relative' }}>
              <WorldMap
                deLocation={config.location}
                dxLocation={dxLocation}
                onDXChange={handleDXChange}
                dxLocked={dxLocked}
                potaSpots={potaSpots.data}
                mySpots={mySpots.data}
                dxPaths={dxClusterData.paths}
                dxFilters={dxFilters}
                satellites={satellites.data}
                pskReporterSpots={filteredPskSpots}
                showDXPaths={mapLayers.showDXPaths}
                showDXLabels={mapLayers.showDXLabels}
                onToggleDXLabels={toggleDXLabels}
                showPOTA={mapLayers.showPOTA}
                showSatellites={mapLayers.showSatellites}
                showPSKReporter={mapLayers.showPSKReporter}
                wsjtxSpots={wsjtxMapSpots}
                showWSJTX={mapLayers.showWSJTX}
                onToggleSatellites={toggleSatellites}
                hoveredSpot={hoveredSpot}
                hideOverlays={true}
                lowMemoryMode={config.lowMemoryMode}
              />
              <div style={{
                position: 'absolute',
                bottom: '26px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '14px',
                color: 'var(--text-muted)',
                background: 'rgba(0,0,0,0.7)',
                padding: '3px 10px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>{deGrid} → {dxGrid} • {dxLocked ? 'DX locked' : 'Click map to set DX'}</span>
                <button
                  onClick={handleToggleDxLock}
                  title={dxLocked ? 'Unlock DX position' : 'Lock DX position'}
                  style={{
                    background: dxLocked ? 'var(--accent-amber)' : 'transparent',
                    color: dxLocked ? '#000' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '1px 4px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  {dxLocked ? '🔒' : '🔓'}
                </button>
              </div>
              {/* Compact Band Legend */}
              <div style={{
                position: 'absolute',
                bottom: '4px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.8)',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '3px 6px',
                zIndex: 1000,
                display: 'flex',
                gap: '3px',
                alignItems: 'center',
                fontSize: '9px',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: '700'
              }}>
                {[
                  { band: '160', color: '#ff6666' }, { band: '80', color: '#ff9966' },
                  { band: '40', color: '#ffcc66' }, { band: '30', color: '#99ff66' },
                  { band: '20', color: '#66ff99' }, { band: '17', color: '#66ffcc' },
                  { band: '15', color: '#66ccff' }, { band: '12', color: '#6699ff' },
                  { band: '10', color: '#9966ff' }, { band: '6', color: '#ff66ff' }
                ].map(b => (
                  <span key={b.band} style={{
                    background: b.color,
                    color: '#000',
                    padding: '1px 3px',
                    borderRadius: '2px',
                    lineHeight: 1.2
                  }}>{b.band}</span>
                ))}
              </div>
            </div>

            {/* Compact DX Cluster */}
            <div style={{
              width: '250px',
              flexShrink: 0,
              borderLeft: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}>
              <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: 'var(--accent-red)', fontWeight: '700', textTransform: 'uppercase' }}>DX Cluster</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{dxClusterData.spots?.length || 0}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {dxClusterData.spots?.slice(0, 40).map((spot, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '3px 8px',
                      display: 'grid',
                      gridTemplateColumns: '75px 1fr 50px',
                      gap: '4px',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      cursor: 'pointer',
                      background: hoveredSpot?.call === spot.call ? 'var(--bg-tertiary)' : 'transparent',
                      fontSize: '14px'
                    }}
                    onMouseEnter={() => setHoveredSpot(spot)}
                    onMouseLeave={() => setHoveredSpot(null)}
                  >
                    <span style={{ color: getBandColor(spot.freq), fontWeight: '700' }}>{parseFloat(spot.freq).toFixed(1)}</span>
                    <span style={{ color: 'var(--accent-cyan)', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{spot.call}</span>
                    <span style={{ color: 'var(--text-muted)', textAlign: 'right', fontSize: '12px' }}>{spot.time || '--'}</span>
                  </div>
                ))}
              </div>

              {/* DX News - sidebar footer */}
              <div style={{
                flexShrink: 0,
                borderTop: '1px solid var(--border-color)',
                background: 'var(--bg-panel)',
                height: '28px',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <DXNewsTicker sidebar={true} />
              </div>
            </div>
          </div>
        </div>

      ) : (
        /* MODERN LAYOUT */
        <div style={{ 
          width: scale < 1 ? `${100 / scale}vw` : '100vw',
          height: scale < 1 ? `${100 / scale}vh` : '100vh',
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          display: 'grid',
          gridTemplateColumns: getGridTemplateColumns(),
          gridTemplateRows: '55px 1fr',
          gap: leftSidebarVisible || rightSidebarVisible ? '8px' : '0',
          padding: leftSidebarVisible || rightSidebarVisible ? '8px' : '0',
          overflow: 'hidden',
          boxSizing: 'border-box'
        }}>
        {/* TOP BAR */}
        <Header
          config={config}
          utcTime={utcTime}
          utcDate={utcDate}
          localTime={localTime}
          localDate={localDate}
          localWeather={localWeather}
          spaceWeather={spaceWeather}
          solarIndices={solarIndices}
          use12Hour={use12Hour}
          onTimeFormatToggle={handleTimeFormatToggle}
          onSettingsClick={() => setShowSettings(true)}
          onUpdateClick={handleUpdateClick}
          onFullscreenToggle={handleFullscreenToggle}
          isFullscreen={isFullscreen}
          updateInProgress={updateInProgress}
          showUpdateButton={isLocalInstall}
        />
        
        {/* LEFT SIDEBAR */}
        {leftSidebarVisible && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', overflowX: 'hidden' }}>
            {/* DE Location + Weather */}
            {config.panels?.deLocation?.visible !== false && (
              <div className="panel" style={{ padding: '14px', flex: '0 0 auto' }}>
              <div style={{ fontSize: '14px', color: 'var(--accent-cyan)', fontWeight: '700', marginBottom: '10px' }}>📍 DE - YOUR LOCATION</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px' }}>
                <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700', letterSpacing: '1px' }}>{deGrid}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>{config.location.lat.toFixed(4)}°, {config.location.lon.toFixed(4)}°</div>
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
                  <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{deSunTimes.sunrise}</span>
                  <span style={{ color: 'var(--text-secondary)' }}> → </span>
                  <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{deSunTimes.sunset}</span>
                </div>
              </div>
              
              <WeatherPanel
                location={config.location}
                tempUnit={tempUnit}
                onTempUnitChange={(unit) => { setTempUnit(unit); try { localStorage.setItem('openhamclock_tempUnit', unit); } catch {} }}
              />
            </div>
          )}
          
          {/* DX Location */}
          {config.panels?.dxLocation?.visible !== false && (
            <div className="panel" style={{ padding: '14px', flex: '0 0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '14px', color: 'var(--accent-green)', fontWeight: '700' }}>🎯 DX - TARGET</div>
                <button
                  onClick={handleToggleDxLock}
                  title={dxLocked ? 'Unlock DX position (allow map clicks)' : 'Lock DX position (prevent map clicks)'}
                  style={{
                    background: dxLocked ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                    color: dxLocked ? '#000' : 'var(--text-secondary)',
                    border: '1px solid ' + (dxLocked ? 'var(--accent-amber)' : 'var(--border-color)'),
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  {dxLocked ? '🔒' : '🔓'}
                </button>
              </div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700', letterSpacing: '1px' }}>{dxGrid}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>{dxLocation.lat.toFixed(4)}°, {dxLocation.lon.toFixed(4)}°</div>
                  <div style={{ color: 'var(--accent-cyan)', fontSize: '13px', marginTop: '4px', fontWeight: '600' }}>
                    {(() => {
                      // Haversine distance formula
                      const R = config.units === 'imperial' ? 3963.1 : 6371; // Earth radius in miles or km
                      const deLat = config.location.lat * Math.PI / 180;
                      const deLon = config.location.lon * Math.PI / 180;
                      const dxLat = dxLocation.lat * Math.PI / 180;
                      const dxLon = dxLocation.lon * Math.PI / 180;
                      const dLat = dxLat - deLat;
                      const dLon = dxLon - deLon;
                      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                                Math.cos(deLat) * Math.cos(dxLat) *
                                Math.sin(dLon/2) * Math.sin(dLon/2);
                      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                      const distance = R * c;
                      const unit = config.units === 'imperial' ? 'mi' : 'km';
                      return `📏 ${Math.round(distance).toLocaleString()} ${unit}`;
                    })()}
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
                    <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{dxSunTimes.sunrise}</span>
                    <span style={{ color: 'var(--text-secondary)' }}> → </span>
                    <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{dxSunTimes.sunset}</span>
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '12px', marginLeft: '12px', minWidth: '90px' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '4px' }}>Beam Dir:</div>
                  <div style={{ fontSize: '13px', marginBottom: '3px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>SP: </span>
                    <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{(() => {
                      const deLat = config.location.lat * Math.PI / 180;
                      const deLon = config.location.lon * Math.PI / 180;
                      const dxLat = dxLocation.lat * Math.PI / 180;
                      const dxLon = dxLocation.lon * Math.PI / 180;
                      const dLon = dxLon - deLon;
                      const y = Math.sin(dLon) * Math.cos(dxLat);
                      const x = Math.cos(deLat) * Math.sin(dxLat) - Math.sin(deLat) * Math.cos(dxLat) * Math.cos(dLon);
                      let sp = Math.atan2(y, x) * 180 / Math.PI;
                      sp = (sp + 360) % 360;
                      return Math.round(sp);
                    })()}°</span>
                  </div>
                  <div style={{ fontSize: '13px', marginBottom: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>LP: </span>
                    <span style={{ color: 'var(--accent-purple)', fontWeight: '700' }}>{(() => {
                      const deLat = config.location.lat * Math.PI / 180;
                      const deLon = config.location.lon * Math.PI / 180;
                      const dxLat = dxLocation.lat * Math.PI / 180;
                      const dxLon = dxLocation.lon * Math.PI / 180;
                      const dLon = dxLon - deLon;
                      const y = Math.sin(dLon) * Math.cos(dxLat);
                      const x = Math.cos(deLat) * Math.sin(dxLat) - Math.sin(deLat) * Math.cos(dxLat) * Math.cos(dLon);
                      let sp = Math.atan2(y, x) * 180 / Math.PI;
                      sp = (sp + 360) % 360;
                      let lp = (sp + 180) % 360;
                      return Math.round(lp);
                    })()}°</span>
                  </div>
                  <div style={{ fontSize: '13px', paddingTop: '6px', borderTop: '1px solid var(--border-color)' }}>
                    <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{(() => {
                      // Haversine distance formula
                      const R = config.units === 'imperial' ? 3963.1 : 6371; // Earth radius in miles or km
                      const deLat = config.location.lat * Math.PI / 180;
                      const deLon = config.location.lon * Math.PI / 180;
                      const dxLat = dxLocation.lat * Math.PI / 180;
                      const dxLon = dxLocation.lon * Math.PI / 180;
                      const dLat = dxLat - deLat;
                      const dLon = dxLon - deLon;
                      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                                Math.cos(deLat) * Math.cos(dxLat) *
                                Math.sin(dLon/2) * Math.sin(dLon/2);
                      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                      const distance = R * c;
                      const unit = config.units === 'imperial' ? 'mi' : 'km';
                      return `📏 ${Math.round(distance).toLocaleString()} ${unit}`;
                    })()}</span>
                  </div>
                </div>
              </div>
              {showDxWeather && (
                <WeatherPanel
                  location={dxLocation}
                  tempUnit={tempUnit}
                  onTempUnitChange={(unit) => { setTempUnit(unit); try { localStorage.setItem('openhamclock_tempUnit', unit); } catch {} }}
                />
              )}
            </div>
          )}

          {/* Analog Clock */}
          {classicAnalogClock && (
            <div className="panel" style={{ flex: '0 0 auto', minHeight: '200px' }}>
              <AnalogClockPanel currentTime={currentTime} sunTimes={deSunTimes} />
            </div>
          )}

          {/* Solar Panel */}
          {config.panels?.solar?.visible !== false && (
            <SolarPanel solarIndices={solarIndices} />
          )}
          
          {/* VOACAP/Propagation Panel */}
          {config.panels?.propagation?.visible !== false && (
            <PropagationPanel 
              propagation={propagation.data} 
              loading={propagation.loading} 
              bandConditions={bandConditions} 
            />
          )}
        </div>
        )}
        
        {/* CENTER - MAP */}
        <div style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', width: '100%', height: '100%', minWidth: 0 }}>
          <WorldMap
            deLocation={config.location}
            dxLocation={dxLocation}
            onDXChange={handleDXChange}
            dxLocked={dxLocked}
            potaSpots={potaSpots.data}
            mySpots={mySpots.data}
            dxPaths={dxClusterData.paths}
            dxFilters={dxFilters}
            satellites={filteredSatellites}
            pskReporterSpots={filteredPskSpots}
            showDXPaths={mapLayers.showDXPaths}
            showDXLabels={mapLayers.showDXLabels}
            onToggleDXLabels={toggleDXLabels}
            showPOTA={mapLayers.showPOTA}
            showSatellites={mapLayers.showSatellites}
            showPSKReporter={mapLayers.showPSKReporter}
            wsjtxSpots={wsjtxMapSpots}
            showWSJTX={mapLayers.showWSJTX}
            onToggleSatellites={toggleSatellites}
            hoveredSpot={hoveredSpot}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
            units={config.units}
          />
          <div style={{ 
            position: 'absolute', 
            bottom: '8px', 
            left: '50%', 
            transform: 'translateX(-50%)', 
            fontSize: '13px', 
            color: 'var(--text-muted)', 
            background: 'rgba(0,0,0,0.7)', 
            padding: '2px 8px', 
            borderRadius: '4px' 
          }}>
                    {t('app.callsign', {callsign: config.callsign })}
          </div>
        </div>
        
        {/* RIGHT SIDEBAR */}
        {rightSidebarVisible && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
            {/* DX Cluster - primary panel, takes most space */}
            {config.panels?.dxCluster?.visible !== false && (
              <div style={{ flex: `${config.panels.dxCluster.size || 2} 1 auto`, minHeight: '180px', overflow: 'hidden' }}>
                <DXClusterPanel
                data={dxClusterData.spots}
                loading={dxClusterData.loading}
                totalSpots={dxClusterData.totalSpots}
                filters={dxFilters}
                onFilterChange={setDxFilters}
                onOpenFilters={() => setShowDXFilters(true)}
                onHoverSpot={setHoveredSpot}
                hoveredSpot={hoveredSpot}
                showOnMap={mapLayers.showDXPaths}
                onToggleMap={toggleDXPaths}
              />
            </div>
            )}
            
            {/* PSKReporter + WSJT-X - digital mode spots */}
            {config.panels?.pskReporter?.visible !== false && (
              <div style={{ flex: `${config.panels.pskReporter.size || 1} 1 auto`, minHeight: '140px', overflow: 'hidden' }}>
                <PSKReporterPanel 
                callsign={config.callsign}
                showOnMap={mapLayers.showPSKReporter}
                onToggleMap={togglePSKReporter}
                filters={pskFilters}
                onOpenFilters={() => setShowPSKFilters(true)}
                onShowOnMap={(report) => {
                  if (report.lat && report.lon) {
                    setDxLocation({ lat: report.lat, lon: report.lon, call: report.receiver || report.sender });
                  }
                }}
                wsjtxDecodes={wsjtx.decodes}
                wsjtxClients={wsjtx.clients}
                wsjtxQsos={wsjtx.qsos}
                wsjtxStats={wsjtx.stats}
                wsjtxLoading={wsjtx.loading}
                wsjtxEnabled={wsjtx.enabled}
                wsjtxPort={wsjtx.port}
                wsjtxRelayEnabled={wsjtx.relayEnabled}
                wsjtxRelayConnected={wsjtx.relayConnected}
                wsjtxSessionId={wsjtx.sessionId}
                showWSJTXOnMap={mapLayers.showWSJTX}
                onToggleWSJTXMap={toggleWSJTX}
              />
            </div>
            )}
            
            {/* DXpeditions */}
            {config.panels?.dxpeditions?.visible !== false && (
              <div style={{ flex: `${config.panels.dxpeditions?.size || 1} 0 auto`, minHeight: '70px', maxHeight: '100px', overflow: 'hidden' }}>
                <DXpeditionPanel data={dxpeditions.data} loading={dxpeditions.loading} />
              </div>
            )}
            
            {/* POTA */}
            {config.panels?.pota?.visible !== false && (
              <div style={{ flex: `${config.panels.pota?.size || 1} 0 auto`, minHeight: '60px', maxHeight: '90px', overflow: 'hidden' }}>
                <POTAPanel 
                data={potaSpots.data} 
                loading={potaSpots.loading} 
                showOnMap={mapLayers.showPOTA}
                onToggleMap={togglePOTA}
              />
            </div>
            )}
            
            {/* Contests - at bottom, compact */}
            {config.panels?.contests?.visible !== false && (
              <div style={{ flex: `${config.panels.contests?.size || 1} 0 auto`, minHeight: '80px', maxHeight: '120px', overflow: 'hidden' }}>
                <ContestPanel data={contests.data} loading={contests.loading} />
              </div>
            )}
          </div>
        )}
      </div>
      )}
      
      {/* Modals */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        config={config}
        onSave={handleSaveConfig}
        onResetLayout={handleResetLayout}
        satellites={satelliteNameList}
        satelliteFilters={satelliteFilters}
        onSatelliteFiltersChange={setSatelliteFilters}
      />
      <DXFilterManager
        filters={dxFilters}
        onFilterChange={setDxFilters}
        isOpen={showDXFilters}
        onClose={() => setShowDXFilters(false)}
      />
      <PSKFilterManager
        filters={pskFilters}
        onFilterChange={setPskFilters}
        isOpen={showPSKFilters}
        onClose={() => setShowPSKFilters(false)}
      />
    </div>
  );
};

export default App;
