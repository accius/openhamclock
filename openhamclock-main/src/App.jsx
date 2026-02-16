/**
 * OpenHamClock - Main Application Component
 * Amateur Radio Dashboard
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsPanel, DXFilterManager, PSKFilterManager } from './components';

import DockableLayout from './layouts/DockableLayout.jsx';
import ClassicLayout from './layouts/ClassicLayout.jsx';
import ModernLayout from './layouts/ModernLayout.jsx';

import { resetLayout } from './store/layoutStore.js';

import {
  useSpaceWeather,
  useBandConditions,
  useDXClusterData,
  usePOTASpots,
  useSOTASpots,
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

import useAppConfig from './hooks/app/useAppConfig';
import useDXLocation from './hooks/app/useDXLocation';
import useMapLayers from './hooks/app/useMapLayers';
import useFilters from './hooks/app/useFilters';
import useSatellitesFilters from './hooks/app/useSatellitesFilters';
import useTimeState from './hooks/app/useTimeState';
import useFullscreen from './hooks/app/useFullscreen';
import useResponsiveScale from './hooks/app/useResponsiveScale';
import useLocalInstall from './hooks/app/useLocalInstall';
import useVersionCheck from './hooks/app/useVersionCheck';

const App = () => {
  const { t } = useTranslation();

  // Core config/state
  const {
    config,
    configLoaded,
    showDxWeather,
    classicAnalogClock,
    handleSaveConfig
  } = useAppConfig();

  const [showSettings, setShowSettings] = useState(false);
  const [showDXFilters, setShowDXFilters] = useState(false);
  const [showPSKFilters, setShowPSKFilters] = useState(false);
  const [layoutResetKey, setLayoutResetKey] = useState(0);
  const [tempUnit, setTempUnit] = useState(() => {
    try { return localStorage.getItem('openhamclock_tempUnit') || 'F'; } catch { return 'F'; }
  });
  const [updateInProgress, setUpdateInProgress] = useState(false);

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

  const handleResetLayout = useCallback(() => {
    resetLayout();
    setLayoutResetKey(prev => prev + 1);
  }, []);

  const handleUpdateClick = useCallback(async () => {
    if (updateInProgress) return;
    const confirmed = window.confirm(t('app.update.confirm'));
    if (!confirmed) return;
    setUpdateInProgress(true);
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      let payload = {};
      try { payload = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        throw new Error(payload.error || t('app.update.failedToStart'));
      }
      alert(t('app.update.started'));
      setTimeout(() => {
        try { window.location.reload(); } catch { /* ignore */ }
      }, 15000);
    } catch (err) {
      setUpdateInProgress(false);
      alert(t('app.update.failed', { error: err.message || t('app.update.unknownError') }));
    }
  }, [updateInProgress, t]);

  // Location & map state
  const {
    dxLocation,
    dxLocked,
    handleToggleDxLock,
    handleDXChange
  } = useDXLocation(config.defaultDX);

  const {
    mapLayers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    toggleSOTA,
    toggleSatellites,
    togglePSKReporter,
    toggleWSJTX,
    toggleDXNews
  } = useMapLayers();

  const {
    dxFilters,
    setDxFilters,
    pskFilters,
    setPskFilters
  } = useFilters();

  const { isFullscreen, handleFullscreenToggle } = useFullscreen();
  const scale = useResponsiveScale();
  const isLocalInstall = useLocalInstall();
  useVersionCheck();

  // Data hooks
  const spaceWeather = useSpaceWeather();
  const bandConditions = useBandConditions();
  const solarIndices = useSolarIndices();
  const potaSpots = usePOTASpots();
  const sotaSpots = useSOTASpots();
  const dxClusterData = useDXClusterData(dxFilters, config);
  const dxpeditions = useDXpeditions();
  const contests = useContests();
  const propagation = usePropagation(config.location, dxLocation, config.propagation);
  const mySpots = useMySpots(config.callsign);
  const satellites = useSatellites(config.location);
  const localWeather = useWeather(config.location, tempUnit);
  const dxWeather = useWeather(dxLocation, tempUnit);
  const pskReporter = usePSKReporter(config.callsign, {
    minutes: config.lowMemoryMode ? 5 : 30,
    enabled: config.callsign !== 'N0CALL',
    maxSpots: config.lowMemoryMode ? 50 : 500
  });
  const wsjtx = useWSJTX();

  const {
    satelliteFilters,
    setSatelliteFilters,
    filteredSatellites
  } = useSatellitesFilters(satellites.data);

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
    dxSunTimes
  } = useTimeState(config.location, dxLocation, config.timezone);

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

  const wsjtxMapSpots = useMemo(() => {
    // Apply same age filter as panel (stored in localStorage)
    let ageMinutes = 30;
    try { ageMinutes = parseInt(localStorage.getItem('ohc_wsjtx_age')) || 30; } catch {}
    const ageCutoff = Date.now() - ageMinutes * 60 * 1000;
    
    // Map all decodes with resolved coordinates (CQ, QSO exchanges, prefix estimates)
    // WorldMap deduplicates by callsign, keeping most recent
    return wsjtx.decodes.filter(d => d.lat && d.lon && d.timestamp >= ageCutoff);
  }, [wsjtx.decodes]);

  // Map hover
  const [hoveredSpot, setHoveredSpot] = useState(null);

  // Sidebar visibility & layout (used by some layouts)
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
    tempUnit,
    setTempUnit,
    localWeather,
    dxWeather,
    spaceWeather,
    solarIndices,
    bandConditions,
    propagation,
    dxClusterData,
    potaSpots,
    sotaSpots,
    mySpots,
    dxpeditions,
    contests,
    satellites,
    pskReporter,
    wsjtx,
    filteredPskSpots,
    wsjtxMapSpots,
    dxFilters,
    setDxFilters,
    pskFilters,
    setPskFilters,
    mapLayers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    toggleSOTA,
    toggleSatellites,
    togglePSKReporter,
    toggleWSJTX,
    toggleDXNews,
    hoveredSpot,
    setHoveredSpot,
    filteredSatellites,
    leftSidebarVisible,
    rightSidebarVisible,
    getGridTemplateColumns,
    scale
  };

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
        <DockableLayout
          key={layoutResetKey}
          {...layoutProps}
        />
      ) : (config.layout === 'classic' || config.layout === 'tablet' || config.layout === 'compact') ? (
        <ClassicLayout {...layoutProps} />
      ) : (
        <ModernLayout
          {...layoutProps}
        />
      )}

      {/* Modals */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        config={config}
        onSave={handleSaveConfig}
        onResetLayout={handleResetLayout}
        satellites={satellites.data}
        satelliteFilters={satelliteFilters}
        onSatelliteFiltersChange={setSatelliteFilters}
        mapLayers={mapLayers}
        onToggleDXNews={toggleDXNews}
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
