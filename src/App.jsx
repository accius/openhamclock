/**
 * OpenHamClock - Main Application Component
 * Amateur Radio Dashboard
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';

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
  PSKReporterPanel
} from './components';

// Hooks
import {
  useSpaceWeather,
  useBandConditions,
  useDXCluster,
  useDXPaths,
  usePOTASpots,
  useContests,
  useLocalWeather,
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
  calculateSunTimes
} from './utils';

const App = () => {
  // Configuration state - initially use defaults, then load from server
  const [config, setConfig] = useState(loadConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [startTime] = useState(Date.now());
  const [uptime, setUptime] = useState('0d 0h 0m');
  
  // Load server configuration on startup (only matters for first-time users)
  useEffect(() => {
    const initConfig = async () => {
      // Fetch server config (provides defaults for new users without localStorage)
      await fetchServerConfig();
      
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
  
  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [showDXFilters, setShowDXFilters] = useState(false);
  const [showPSKFilters, setShowPSKFilters] = useState(false);
  const [weatherExpanded, setWeatherExpanded] = useState(() => {
    try { return localStorage.getItem('openhamclock_weatherExpanded') === 'true'; } catch { return false; }
  });
  const [tempUnit, setTempUnit] = useState(() => {
    try { return localStorage.getItem('openhamclock_tempUnit') || 'F'; } catch { return 'F'; }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  
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

  // Fullscreen
  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

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
  
  const dxCluster = useDXCluster(config.dxClusterSource || 'auto', dxFilters);
  const dxPaths = useDXPaths();
  const dxpeditions = useDXpeditions();
  const contests = useContests();
  const propagation = usePropagation(config.location, dxLocation);
  const mySpots = useMySpots(config.callsign);
  const satellites = useSatellites(config.location);
  const localWeather = useLocalWeather(config.location, tempUnit);
  const pskReporter = usePSKReporter(config.callsign, { minutes: 15, enabled: config.callsign !== 'N0CALL' });
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
      {config.layout === 'classic' ? (
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
                        {dxCluster.data?.filter(s => {
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
                  <div style={{ color: '#00ff00', fontSize: '16px', fontWeight: '700' }}>{spaceWeather?.data?.kIndex ?? '--'}</div>
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
                {dxCluster.data?.slice(0, 25).map((spot, i) => (
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
                potaSpots={potaSpots.data}
                mySpots={mySpots.data}
                dxPaths={dxPaths.data}
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
                ⚙ Settings
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
          use12Hour={use12Hour}
          onTimeFormatToggle={handleTimeFormatToggle}
          onSettingsClick={() => setShowSettings(true)}
          onFullscreenToggle={handleFullscreenToggle}
          isFullscreen={isFullscreen}
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
              
              {/* Local Weather — compact by default, click to expand */}
              {localWeather.data && (() => {
                const w = localWeather.data;
                const deg = `°${w.tempUnit || tempUnit}`;
                const wind = w.windUnit || 'mph';
                const vis = w.visUnit || 'mi';
                return (
                <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                  {/* Compact summary row — always visible */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div 
                      onClick={() => { const next = !weatherExpanded; setWeatherExpanded(next); try { localStorage.setItem('openhamclock_weatherExpanded', next.toString()); } catch {} }}
                      style={{ 
                        display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                        userSelect: 'none', flex: 1, minWidth: 0,
                      }}
                    >
                      <span style={{ fontSize: '20px', lineHeight: 1 }}>{w.icon}</span>
                      <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'Orbitron, monospace' }}>
                        {w.temp}{deg}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.description}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                        💨{w.windSpeed}
                      </span>
                      <span style={{ 
                        fontSize: '10px', color: 'var(--text-muted)', 
                        transform: weatherExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }}>▼</span>
                    </div>
                    {/* F/C toggle */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = tempUnit === 'F' ? 'C' : 'F';
                        setTempUnit(next);
                        try { localStorage.setItem('openhamclock_tempUnit', next); } catch {}
                      }}
                      style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)',
                        fontSize: '10px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontWeight: '600',
                        flexShrink: 0,
                      }}
                      title={`Switch to °${tempUnit === 'F' ? 'C' : 'F'}`}
                    >
                      °{tempUnit === 'F' ? 'C' : 'F'}
                    </button>
                  </div>
                  
                  {/* Expanded details */}
                  {weatherExpanded && (
                    <div style={{ marginTop: '10px' }}>
                      {/* Feels like + hi/lo */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '8px', fontFamily: 'JetBrains Mono, monospace' }}>
                        {w.feelsLike !== w.temp && (
                          <span style={{ color: 'var(--text-muted)' }}>Feels like {w.feelsLike}{deg}</span>
                        )}
                        {w.todayHigh != null && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                            <span style={{ color: 'var(--accent-amber)' }}>▲{w.todayHigh}°</span>
                            {' '}
                            <span style={{ color: 'var(--accent-blue)' }}>▼{w.todayLow}°</span>
                          </span>
                        )}
                      </div>
                      
                      {/* Detail grid */}
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: '1fr 1fr', 
                        gap: '6px 12px',
                        fontSize: '11px',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>💨 Wind</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{w.windDir} {w.windSpeed} {wind}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>💧 Humidity</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{w.humidity}%</span>
                        </div>
                        {w.windGusts > w.windSpeed + 5 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>🌬️ Gusts</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{w.windGusts} {wind}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>🌡️ Dew Pt</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{w.dewPoint}{deg}</span>
                        </div>
                        {w.pressure && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>🔵 Pressure</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{w.pressure} hPa</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>☁️ Clouds</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{w.cloudCover}%</span>
                        </div>
                        {w.visibility && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>👁️ Vis</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{w.visibility} {vis}</span>
                          </div>
                        )}
                        {w.uvIndex > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>☀️ UV</span>
                            <span style={{ color: w.uvIndex >= 8 ? '#ef4444' : w.uvIndex >= 6 ? '#f97316' : w.uvIndex >= 3 ? '#eab308' : 'var(--text-secondary)' }}>
                              {w.uvIndex.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </div>
                      
                      {/* 3-Day Forecast */}
                      {w.daily?.length > 0 && (
                        <div style={{ 
                          marginTop: '10px', 
                          paddingTop: '8px', 
                          borderTop: '1px solid var(--border-color)',
                        }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: '600' }}>FORECAST</div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {w.daily.map((day, i) => (
                              <div key={i} style={{ 
                                flex: 1, 
                                textAlign: 'center', 
                                padding: '6px 2px',
                                background: 'var(--bg-tertiary)',
                                borderRadius: '4px',
                                fontSize: '10px',
                              }}>
                                <div style={{ color: 'var(--text-muted)', fontWeight: '600', marginBottom: '2px' }}>{i === 0 ? 'Today' : day.date}</div>
                                <div style={{ fontSize: '16px', lineHeight: 1.2 }}>{day.icon}</div>
                                <div style={{ fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>
                                  <span style={{ color: 'var(--accent-amber)' }}>{day.high}°</span>
                                  <span style={{ color: 'var(--text-muted)' }}>/</span>
                                  <span style={{ color: 'var(--accent-blue)' }}>{day.low}°</span>
                                </div>
                                {day.precipProb > 0 && (
                                  <div style={{ color: 'var(--accent-blue)', fontSize: '9px', marginTop: '1px' }}>
                                    💧{day.precipProb}%
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          )}
          
          {/* DX Location */}
          {config.panels?.dxLocation?.visible !== false && (
            <div className="panel" style={{ padding: '14px', flex: '0 0 auto' }}>
              <div style={{ fontSize: '14px', color: 'var(--accent-green)', fontWeight: '700', marginBottom: '10px' }}>🎯 DX - TARGET</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px' }}>
                <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700', letterSpacing: '1px' }}>{dxGrid}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>{dxLocation.lat.toFixed(4)}°, {dxLocation.lon.toFixed(4)}°</div>
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
                  <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{dxSunTimes.sunrise}</span>
                  <span style={{ color: 'var(--text-secondary)' }}> → </span>
                  <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{dxSunTimes.sunset}</span>
                </div>
              </div>
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
            potaSpots={potaSpots.data}
            mySpots={mySpots.data}
            dxPaths={dxPaths.data}
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
            Click map to set DX • 73 de {config.callsign}
          </div>
        </div>
        
        {/* RIGHT SIDEBAR */}
        {rightSidebarVisible && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
            {/* DX Cluster - primary panel, takes most space */}
            {config.panels?.dxCluster?.visible !== false && (
              <div style={{ flex: `${config.panels.dxCluster.size || 2} 1 auto`, minHeight: '180px', overflow: 'hidden' }}>
                <DXClusterPanel
                data={dxCluster.data}
                loading={dxCluster.loading}
                totalSpots={dxCluster.totalSpots}
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
