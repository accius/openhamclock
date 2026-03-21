/**
 * OpenHamClock - Main Application Component
 * Amateur Radio Dashboard
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsPanel, DXFilterManager, PSKFilterManager, KeybindingsPanel } from './components';
import SidebarMenu from './components/SidebarMenu.jsx';

import DockableLayout from './layouts/DockableLayout.jsx';
import ClassicLayout from './layouts/ClassicLayout.jsx';
import ModernLayout from './layouts/ModernLayout.jsx';
import EmcommLayout from './layouts/EmcommLayout.jsx';

import { resetLayout } from './store/layoutStore.js';
import { RigProvider } from './contexts/RigContext.jsx';

import {
  useSpaceWeather,
  useBandConditions,
  useDXClusterData,
  usePOTASpots,
  useWWFFSpots,
  useSOTASpots,
  useWWBOTASpots,
  useContests,
  useWeather,
  useWeatherAlerts,
  usePropagation,
  useMySpots,
  useDXpeditions,
  useSatellites,
  useSolarIndices,
  usePSKReporter,
  useWSJTX,
  useAPRS,
  useEmcommData,
} from './hooks';

import useAppConfig from './hooks/app/useAppConfig';
import useDXLocation from './hooks/app/useDXLocation';
import useMapLayers from './hooks/app/useMapLayers';
import useFilters from './hooks/app/useFilters';
import useSatellitesFilters from './hooks/app/useSatellitesFilters';
import useTimeState from './hooks/app/useTimeState';
import useFullscreen from './hooks/app/useFullscreen';
import useScreenWakeLock from './hooks/app/useScreenWakeLock';
import useResponsiveScale from './hooks/app/useResponsiveScale';
import useLocalInstall from './hooks/app/useLocalInstall';
import useVersionCheck from './hooks/app/useVersionCheck';
import usePresence from './hooks/app/usePresence';
import useAudioAlerts from './hooks/app/useAudioAlerts';
import WhatsNew from './components/WhatsNew.jsx';
import { initCtyLookup } from './utils/ctyLookup.js';
import { getAllLayers } from './plugins/layerRegistry.js';
import ActivateFilterManager from './components/ActivateFilterManager.jsx';

// Load DXCC entity database on app startup (non-blocking)
initCtyLookup();

const App = () => {
  const { t } = useTranslation();

  // Core config/state
  const { config, configLoaded, showDxWeather, classicAnalogClock, handleSaveConfig } = useAppConfig();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState(null);
  const [showDXFilters, setShowDXFilters] = useState(false);
  const [showPSKFilters, setShowPSKFilters] = useState(false);
  const [showKeybindings, setShowKeybindings] = useState(false);
  const [showPotaFilters, setShowPotaFilters] = useState(false);
  const [showSotaFilters, setShowSotaFilters] = useState(false);
  const [showWwffFilters, setShowWwffFilters] = useState(false);
  const [showWwbotaFilters, setShowWwbotaFilters] = useState(false);
  const [layoutResetKey, setLayoutResetKey] = useState(0);
  const [, setBandColorChangeVersion] = useState(0);
  const [updateInProgress, setUpdateInProgress] = useState(false);

  useEffect(() => {
    const onBandColorsChange = () => {
      setBandColorChangeVersion((v) => v + 1);
    };
    window.addEventListener('openhamclock-band-colors-change', onBandColorsChange);
    return () => window.removeEventListener('openhamclock-band-colors-change', onBandColorsChange);
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    const hasLocalStorage = localStorage.getItem('openhamclock_config');
    if (!hasLocalStorage && config.callsign === 'N0CALL') {
      setShowSettings(true);

      // Auto-detect mobile/tablet on first visit and set appropriate layout
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth <= 768;
      const isTabletSize = window.innerWidth > 768 && window.innerWidth <= 1200;

      if (isTouchDevice && isSmallScreen) {
        // Phone → compact layout
        handleSaveConfig({ ...config, layout: 'compact' });
      } else if (isTouchDevice && isTabletSize) {
        // Tablet → tablet layout
        handleSaveConfig({ ...config, layout: 'tablet' });
      }
    }
  }, [configLoaded, config.callsign]);

  // ── Keyboard shortcuts for map layer toggling ──
  // Uses pinned shortcuts from layer metadata when available,
  // falls back to first unique letter from layer name.
  const layerShortcuts = useMemo(() => {
    const layers = getAllLayers();
    const map = {};
    const used = new Set();

    // First pass: assign pinned shortcuts from layer metadata
    for (const layer of layers) {
      if (layer.shortcut) {
        const key = layer.shortcut.toLowerCase();
        if (/^[a-z]$/.test(key) && !used.has(key)) {
          map[key] = layer.id;
          used.add(key);
        }
      }
    }

    // Second pass: auto-assign remaining layers (first unique letter)
    for (const layer of layers) {
      if (map[layer.shortcut?.toLowerCase()] === layer.id) continue; // already pinned
      const name = (layer.name || layer.id || '').toLowerCase();
      for (const char of name) {
        if (/[a-z]/.test(char) && !used.has(char)) {
          map[char] = layer.id;
          used.add(char);
          break;
        }
      }
    }
    return map;
  }, []);

  const keybindingsList = useMemo(() => {
    return Object.entries(layerShortcuts)
      .map(([key, id]) => {
        const layer = getAllLayers().find((l) => l.id === id);
        let name = layer?.name || layer?.id || id;
        if (name?.startsWith('plugins.layers.')) {
          name = t(name, name);
        }
        return { key: key.toUpperCase(), description: `Toggle ${name}` };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [layerShortcuts, t]);

  useEffect(() => {
    const handleKey = (e) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        showSettings ||
        showDXFilters ||
        showPSKFilters ||
        showKeybindings ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      )
        return;

      if (e.key === '?') {
        setShowKeybindings((v) => !v);
        e.preventDefault();
        return;
      }

      if (e.key === '/') {
        toggleDeDxMarkers();
        e.preventDefault();
        return;
      }

      const layerId = layerShortcuts[e.key.toLowerCase()];
      if (layerId && window.hamclockLayerControls) {
        const isEnabled = window.hamclockLayerControls.layers?.find((l) => l.id === layerId)?.enabled ?? false;
        window.hamclockLayerControls.toggleLayer(layerId, !isEnabled);
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showSettings, showDXFilters, showPSKFilters, showKeybindings, layerShortcuts]);

  const handleResetLayout = useCallback(() => {
    resetLayout();
    setLayoutResetKey((prev) => prev + 1);
  }, []);

  const handleUpdateClick = useCallback(async () => {
    if (updateInProgress) return;
    const confirmed = window.confirm(t('app.update.confirm'));
    if (!confirmed) return;
    setUpdateInProgress(true);
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      let payload = {};
      try {
        payload = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        throw new Error(payload.error || t('app.update.failedToStart'));
      }
      alert(t('app.update.started'));
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          /* ignore */
        }
      }, 15000);
    } catch (err) {
      setUpdateInProgress(false);
      alert(t('app.update.failed', { error: err.message || t('app.update.unknownError') }));
    }
  }, [updateInProgress, t]);

  // Report presence to active users layer (runs for all configured users)
  usePresence({ callsign: config.callsign, locator: config.locator });

  // Location & map state
  const { dxLocation, dxLocked, handleToggleDxLock, handleDXChange } = useDXLocation(config.defaultDX);

  const {
    mapLayers,
    toggleDeDxMarkers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    togglePOTALabels,
    toggleWWFF,
    toggleWWFFLabels,
    toggleSOTA,
    toggleSOTALabels,
    toggleWWBOTA,
    toggleWWBOTALabels,
    toggleSatellites,
    togglePSKReporter,
    togglePSKPaths,
    toggleWSJTX,
    toggleDXNews,
    toggleRotatorBearing,
    toggleAPRS,
  } = useMapLayers();

  const {
    dxFilters,
    setDxFilters,
    pskFilters,
    setPskFilters,
    mapBandFilter,
    setMapBandFilter,
    potaFilters,
    setPotaFilters,
    sotaFilters,
    setSotaFilters,
    wwffFilters,
    setWwffFilters,
    wwbotaFilters,
    setWwbotaFilters,
  } = useFilters();

  const { isFullscreen, handleFullscreenToggle } = useFullscreen();
  const { wakeLockStatus } = useScreenWakeLock(config);
  const scale = useResponsiveScale();
  const isLocalInstall = useLocalInstall();

  // Responsive breakpoint for sidebar/header behavior
  const [breakpoint, setBreakpoint] = useState(() => {
    const w = window.innerWidth;
    return w <= 768 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop';
  });
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setBreakpoint(w <= 768 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useVersionCheck();

  // Data hooks
  const spaceWeather = useSpaceWeather();
  const bandConditions = useBandConditions();
  const solarIndices = useSolarIndices();
  const potaSpots = usePOTASpots();
  const wwffSpots = useWWFFSpots();
  const sotaSpots = useSOTASpots();
  const wwbotaSpots = useWWBOTASpots();
  const dxClusterData = useDXClusterData(dxFilters, config);
  const dxpeditions = useDXpeditions();
  const contests = useContests();
  // Audio alerts for new items in data feeds
  useAudioAlerts({
    pota: potaSpots.data,
    sota: sotaSpots.data,
    wwff: wwffSpots.data,
    wwbota: wwbotaSpots.data,
    dxcluster: dxClusterData.spots,
    dxpeditions: dxpeditions.data,
    contests: contests.data,
  });

  const propagation = usePropagation(config.location, dxLocation, config.propagation);
  const mySpots = useMySpots(config.callsign);
  const satellites = useSatellites(config.location);
  const localWeather = useWeather(config.location, config.allUnits);
  const dxWeather = useWeather(dxLocation, config.allUnits);
  const localAlerts = useWeatherAlerts(config.location);
  const dxAlerts = useWeatherAlerts(dxLocation);
  const pskReporter = usePSKReporter(config.callsign, {
    minutes: config.lowMemoryMode ? 5 : 30,
    enabled: pskFilters?.filterMode === 'grid' ? !!config.locator : config.callsign !== 'N0CALL',
    maxSpots: config.lowMemoryMode ? 50 : 500,
    filterMode: pskFilters?.filterMode || 'call',
    gridSquare: config.locator || '',
  });
  const wsjtx = useWSJTX();
  const aprsData = useAPRS();
  const emcommData = useEmcommData({
    location: config.location,
    enabled: config.layout === 'emcomm',
  });

  // ── WSJT-X → DX Target ──
  // When the operator selects a callsign in WSJT-X (setting Std Msgs),
  // the server resolves it to coordinates. Set the DX target automatically
  // so propagation predictions and beam heading update in real time.
  // Respects the DX Lock toggle — if locked, WSJT-X changes are ignored.
  useEffect(() => {
    if (wsjtx.dxTarget?.lat != null && wsjtx.dxTarget?.lon != null) {
      handleDXChange({ lat: wsjtx.dxTarget.lat, lon: wsjtx.dxTarget.lon });
    }
  }, [wsjtx.dxTarget, handleDXChange]);

  const { satelliteFilters, setSatelliteFilters, filteredSatellites } = useSatellitesFilters(satellites.data);

  const {
    currentTime,
    uptime,
    use12Hour,
    handleTimeFormatToggle,
    utcTime,
    utcDate,
    localTime,
    localDate,
    deGrid,
    dxGrid,
    deSunTimes,
    dxSunTimes,
  } = useTimeState(config.location, dxLocation, config.timezone);

  const filteredPskSpots = useMemo(() => {
    // Apply direction filter: 'tx' = only my transmissions, 'rx' = only what I hear, default = both
    const dir = pskFilters?.direction;
    let allSpots;
    if (dir === 'tx') {
      allSpots = [...(pskReporter.txReports || [])];
    } else if (dir === 'rx') {
      allSpots = [...(pskReporter.rxReports || [])];
    } else {
      allSpots = [...(pskReporter.txReports || []), ...(pskReporter.rxReports || [])];
    }
    if (!pskFilters?.bands?.length && !pskFilters?.grids?.length && !pskFilters?.modes?.length) {
      return allSpots;
    }
    return allSpots.filter((spot) => {
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

  function ActivateFilter(spots, filters) {
    if (!filters?.bands?.length && !filters?.grids?.length && !filters?.modes?.length) {
      return spots.data;
    }
    return spots.data.filter((spot) => {
      if (filters?.bands?.length && !filters.bands.includes(spot.band)) return false;
      if (filters?.modes?.length && !filters.modes.includes(spot.mode)) return false;
      if (filters?.grids?.length) {
        const gridPrefix = spot.grid.substring(0, 2).toUpperCase();
        if (!filters.grids.includes(gridPrefix)) return false;
      }
      return true;
    });
  }

  const filteredPotaSpots = useMemo(() => {
    return ActivateFilter(potaSpots, potaFilters);
  }, [potaSpots.data, potaFilters]);

  const filteredWwffSpots = useMemo(() => {
    return ActivateFilter(wwffSpots, wwffFilters);
  }, [wwffSpots.data, wwffFilters]);

  const filteredSotaSpots = useMemo(() => {
    return ActivateFilter(sotaSpots, sotaFilters);
  }, [sotaSpots.data, sotaFilters]);

  const filteredWwbotaSpots = useMemo(() => {
    return ActivateFilter(wwbotaSpots, wwbotaFilters);
  }, [wwbotaSpots.data, wwbotaFilters]);

  const wsjtxMapSpots = useMemo(() => {
    // Apply same age filter as panel (stored in localStorage)
    let ageMinutes = 30;
    try {
      ageMinutes = parseInt(localStorage.getItem('ohc_wsjtx_age')) || 30;
    } catch {}
    const ageCutoff = Date.now() - ageMinutes * 60 * 1000;

    // Map all decodes with resolved coordinates (CQ, QSO exchanges, prefix estimates)
    // WorldMap deduplicates by callsign, keeping most recent
    return wsjtx.decodes.filter((d) => d.lat != null && d.lon != null && d.timestamp >= ageCutoff);
  }, [wsjtx.decodes]);

  // Map hover
  const [hoveredSpot, setHoveredSpot] = useState(null);

  // Sidebar visibility & layout (used by some layouts)
  const leftSidebarVisible =
    config.panels?.deLocation?.visible !== false ||
    config.panels?.dxLocation?.visible !== false ||
    config.panels?.solar?.visible !== false ||
    config.panels?.propagation?.visible !== false;
  const rightSidebarVisible =
    config.panels?.dxCluster?.visible !== false ||
    config.panels?.pskReporter?.visible !== false ||
    config.panels?.dxpeditions?.visible !== false ||
    config.panels?.pota?.visible !== false ||
    config.panels?.contests?.visible !== false;
  const leftSidebarWidth = leftSidebarVisible ? '270px' : '0px';
  const rightSidebarWidth = rightSidebarVisible ? '300px' : '0px';

  const getGridTemplateColumns = () => {
    if (!leftSidebarVisible && !rightSidebarVisible) return '1fr';
    if (!leftSidebarVisible) return `1fr ${rightSidebarWidth}`;
    if (!rightSidebarVisible) return `${leftSidebarWidth} 1fr`;
    return `${leftSidebarWidth} 1fr ${rightSidebarWidth}`;
  };

  const layoutProps = {
    config,
    t,
    showDxWeather,
    classicAnalogClock,
    currentTime,
    uptime,
    utcTime,
    utcDate,
    localTime,
    localDate,
    use12Hour,
    handleTimeFormatToggle,
    handleFullscreenToggle,
    isFullscreen,
    setShowSettings,
    setShowDXFilters,
    setShowPSKFilters,
    setShowPotaFilters,
    setShowSotaFilters,
    setShowWwffFilters,
    setShowWwbotaFilters,
    handleUpdateClick,
    updateInProgress,
    isLocalInstall,
    deGrid,
    dxGrid,
    dxLocation,
    dxLocked,
    handleDXChange,
    handleToggleDxLock,
    deSunTimes,
    dxSunTimes,
    localWeather,
    dxWeather,
    localAlerts,
    dxAlerts,
    spaceWeather,
    solarIndices,
    bandConditions,
    propagation,
    dxClusterData,
    potaSpots,
    filteredPotaSpots,
    wwffSpots,
    filteredWwffSpots,
    sotaSpots,
    filteredSotaSpots,
    wwbotaSpots,
    filteredWwbotaSpots,
    mySpots,
    dxpeditions,
    contests,
    satellites,
    pskReporter,
    wsjtx,
    aprsData,
    emcommData,
    filteredPskSpots,
    wsjtxMapSpots,
    dxFilters,
    setDxFilters,
    mapBandFilter,
    setMapBandFilter,
    pskFilters,
    setPskFilters,
    potaFilters,
    setPotaFilters,
    sotaFilters,
    setSotaFilters,
    wwffFilters,
    setWwffFilters,
    wwbotaFilters,
    setWwbotaFilters,
    mapLayers,
    toggleDeDxMarkers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    togglePOTALabels,
    toggleWWFF,
    toggleWWFFLabels,
    toggleSOTA,
    toggleSOTALabels,
    toggleWWBOTA,
    toggleWWBOTALabels,
    toggleSatellites,
    togglePSKReporter,
    togglePSKPaths,
    toggleWSJTX,
    toggleDXNews,
    toggleRotatorBearing,
    toggleAPRS,
    hoveredSpot,
    setHoveredSpot,
    filteredSatellites,
    leftSidebarVisible,
    rightSidebarVisible,
    getGridTemplateColumns,
    scale,
    keybindingsList,
  };

  // Sidebar width reacts to mode changes (hidden=0, icons=40, pinned=180)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (breakpoint === 'mobile') return 0;
    const savedMode = localStorage.getItem('openhamclock_sidebarMode') || 'icons';
    return savedMode === 'hidden'
      ? 0
      : savedMode === 'pinned'
        ? SidebarMenu.EXPANDED_WIDTH
        : SidebarMenu.COLLAPSED_WIDTH;
  });

  useEffect(() => {
    const onModeChange = (e) => {
      const m = e.detail?.mode;
      if (m === 'hidden') setSidebarWidth(0);
      else if (m === 'pinned') setSidebarWidth(SidebarMenu.EXPANDED_WIDTH);
      else setSidebarWidth(SidebarMenu.COLLAPSED_WIDTH);
    };
    window.addEventListener('sidebar-mode-change', onModeChange);
    return () => window.removeEventListener('sidebar-mode-change', onModeChange);
  }, []);

  useEffect(() => {
    if (breakpoint === 'mobile') setSidebarWidth(0);
  }, [breakpoint]);

  // Dockable layout lock state (lifted here so sidebar can control it)
  const [layoutLocked, setLayoutLocked] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_layoutLocked') === 'true';
    } catch {
      return false;
    }
  });

  const toggleLayoutLock = useCallback(() => {
    setLayoutLocked((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('openhamclock_layoutLocked', String(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        paddingLeft: sidebarWidth,
        boxSizing: 'border-box',
        transition: 'padding-left 0.2s ease',
      }}
    >
      {/* Sidebar Menu */}
      <SidebarMenu
        onSettingsClick={(tabId) => {
          setSettingsDefaultTab(tabId || null);
          setShowSettings(true);
        }}
        onFullscreenToggle={handleFullscreenToggle}
        isFullscreen={isFullscreen}
        onUpdateClick={handleUpdateClick}
        showUpdateButton={isLocalInstall}
        updateInProgress={updateInProgress}
        breakpoint={breakpoint}
        isDockable={config.layout === 'dockable'}
        layoutLocked={layoutLocked}
        onToggleLayoutLock={toggleLayoutLock}
        onResetLayout={handleResetLayout}
        version={config.version}
      />

      <RigProvider rigConfig={config.rigControl || { enabled: false, host: 'http://localhost', port: 5555 }}>
        {config.layout === 'emcomm' ? (
          <EmcommLayout {...layoutProps} />
        ) : config.layout === 'dockable' ? (
          <DockableLayout
            key={layoutResetKey}
            {...layoutProps}
            layoutLocked={layoutLocked}
            onToggleLayoutLock={toggleLayoutLock}
          />
        ) : config.layout === 'classic' || config.layout === 'tablet' || config.layout === 'compact' ? (
          <ClassicLayout {...layoutProps} />
        ) : (
          <ModernLayout {...layoutProps} />
        )}
      </RigProvider>

      {/* Modals */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => {
          setShowSettings(false);
          setSettingsDefaultTab(null);
        }}
        defaultTab={settingsDefaultTab}
        config={config}
        onSave={handleSaveConfig}
        onResetLayout={handleResetLayout}
        satellites={satellites.data}
        satelliteFilters={satelliteFilters}
        onSatelliteFiltersChange={setSatelliteFilters}
        mapLayers={mapLayers}
        onToggleDeDxMarkers={toggleDeDxMarkers}
        onToggleDXNews={toggleDXNews}
        wakeLockStatus={wakeLockStatus}
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
        callsign={config.callsign}
        locator={config.locator}
      />
      <KeybindingsPanel
        isOpen={showKeybindings}
        onClose={() => setShowKeybindings(false)}
        keybindings={keybindingsList}
      />
      <ActivateFilterManager
        name="POTA"
        filters={potaFilters}
        onFilterChange={setPotaFilters}
        isOpen={showPotaFilters}
        onClose={() => setShowPotaFilters(false)}
      />
      <ActivateFilterManager
        name="SOTA"
        filters={sotaFilters}
        onFilterChange={setSotaFilters}
        isOpen={showSotaFilters}
        onClose={() => setShowSotaFilters(false)}
      />
      <ActivateFilterManager
        name="WWFF"
        filters={wwffFilters}
        onFilterChange={setWwffFilters}
        isOpen={showWwffFilters}
        onClose={() => setShowWwffFilters(false)}
      />
      <ActivateFilterManager
        name="WWBOTA"
        filters={wwbotaFilters}
        onFilterChange={setWwbotaFilters}
        isOpen={showWwbotaFilters}
        onClose={() => setShowWwbotaFilters(false)}
      />
      <WhatsNew />
    </div>
  );
};

export default App;
