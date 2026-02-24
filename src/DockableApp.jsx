/**
 * DockableApp - Dockable panel layout wrapper for OpenHamClock
 * Provides resizable, draggable panels while maintaining the original styling
 */
import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { Layout, Model, Actions, DockLocation } from 'flexlayout-react';

// Components
import {
  Header,
  WorldMap,
  DXClusterPanel,
  POTAPanel,
  WWFFPanel,
  SOTAPanel,
  WWBOTAPanel,
  ContestPanel,
  SolarPanel,
  PropagationPanel,
  BandHealthPanel,
  RotatorPanel,
  DXpeditionPanel,
  PSKReporterPanel,
  APRSPanel,
  WeatherPanel,
  AmbientPanel,
  AnalogClockPanel,
  RigControlPanel,
  OnAirPanel,
  IDTimerPanel,
  DXLocalTime,
} from './components';

import { loadLayout, saveLayout } from './store/layoutStore.js';
import { DockableLayoutProvider } from './contexts';
import { useRig } from './contexts/RigContext.jsx';
import { calculateBearing, calculateDistance, formatDistance } from './utils/geo.js';
import './styles/flexlayout-openhamclock.css';
import useMapLayers from './hooks/app/useMapLayers';
import useRotator from './hooks/useRotator';

const getEffectiveUnits = (fallback = 'imperial') => {
  try {
    const raw = localStorage.getItem('openhamclock_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.units === 'metric' || parsed?.units === 'imperial') {
        return parsed.units;
      }
    }
  } catch (err) {
    /* noop */ void err;
  }
  return fallback === 'metric' || fallback === 'imperial' ? fallback : 'imperial';
};

// Icons
const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const DockableApp = ({
  // Config & state from parent
  config,
  t,
  currentTime,

  // Location data
  deGrid,
  dxGrid,
  dxLocation,
  deSunTimes,
  dxSunTimes,
  handleDXChange,
  dxLocked,
  handleToggleDxLock,

  // Weather
  localWeather,
  dxWeather,
  showDxWeather,

  // Space weather & solar
  spaceWeather,
  solarIndices,
  bandConditions,
  propagation,

  // Spots & data
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
  filteredSatellites,
  pskReporter,
  wsjtx,
  aprsData,
  filteredPskSpots,
  wsjtxMapSpots,

  // Filters
  dxFilters,
  setDxFilters,
  mapBandFilter,
  setMapBandFilter,
  pskFilters,
  setShowDXFilters,
  setShowPSKFilters,
  potaFilters,
  setShowPotaFilters,
  sotaFilters,
  setShowSotaFilters,
  wwffFilters,
  setShowWwffFilters,
  wwbotaFilters,
  setShowWwbotaFilters,

  // Map layers
  mapLayers,
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
  toggleAPRS,
  toggleRotatorBearing,
  hoveredSpot,
  setHoveredSpot,

  // Time & UI
  utcTime,
  utcDate,
  localTime,
  localDate,
  use12Hour,
  handleTimeFormatToggle,
  setShowSettings,
  handleFullscreenToggle,
  isFullscreen,

  // Update
  handleUpdateClick,
  updateInProgress,
  isLocalInstall,
}) => {
  const layoutRef = useRef(null);
  const [model, setModel] = useState(() => Model.fromJson(loadLayout()));
  const [showPanelPicker, setShowPanelPicker] = useState(false);
  const [panelPickerView, setPanelPickerView] = useState('switch'); // 'switch' | 'add'

  const [targetTabSetId, setTargetTabSetId] = useState(null);
  const saveTimeoutRef = useRef(null);
  const allowMaximizeRef = useRef(false);

  // Layout lock — prevents accidental drag/resize/close of panels
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
      } catch (err) {
        /* noop */ void err;
      }
      return next;
    });
  }, []);
  const [effectiveUnits, setEffectiveUnits] = useState(() => getEffectiveUnits(config?.units));
  const [showDXLocalTime, setShowDXLocalTime] = useState(false);

  // Fallback: if parent did not provide map-layer toggles (seen with rotator),
  // use the internal hook so the map buttons still work.
  const internalMap = useMapLayers();

  const useInternalMapLayers =
    typeof toggleRotatorBearing !== 'function' ||
    typeof toggleDXPaths !== 'function' ||
    typeof toggleDXLabels !== 'function' ||
    typeof toggleSatellites !== 'function';

  const mapLayersEff = useInternalMapLayers ? internalMap.mapLayers : mapLayers;
  const toggleDXPathsEff = useInternalMapLayers ? internalMap.toggleDXPaths : toggleDXPaths;
  const toggleDXLabelsEff = useInternalMapLayers ? internalMap.toggleDXLabels : toggleDXLabels;
  const togglePOTAEff = useInternalMapLayers ? internalMap.togglePOTA : togglePOTA;
  const togglePOTALabelsEff = useInternalMapLayers ? internalMap.togglePOTALabels : togglePOTALabels;
  const toggleWWFFEff = useInternalMapLayers ? internalMap.toggleWWFF : toggleWWFF;
  const toggleWWFFLabelsEff = useInternalMapLayers ? internalMap.toggleWWFFLabels : toggleWWFFLabels;
  const toggleSOTAEff = useInternalMapLayers ? internalMap.toggleSOTA : toggleSOTA;
  const toggleSOTALabelsEff = useInternalMapLayers ? internalMap.toggleSOTALabels : toggleSOTALabels;
  const toggleWWBOTAEff = useInternalMapLayers ? internalMap.toggleWWBOTA : toggleWWBOTA;
  const toggleWWBOTALabelsEff = useInternalMapLayers ? internalMap.toggleWWBOTALabels : toggleWWBOTALabels;
  const toggleSatellitesEff = useInternalMapLayers ? internalMap.toggleSatellites : toggleSatellites;
  const togglePSKReporterEff = useInternalMapLayers ? internalMap.togglePSKReporter : togglePSKReporter;
  const togglePSKPathsEff = useInternalMapLayers ? internalMap.togglePSKPaths : togglePSKPaths;
  const toggleWSJTXEff = useInternalMapLayers ? internalMap.toggleWSJTX : toggleWSJTX;
  const toggleRotatorBearingEff = useInternalMapLayers ? internalMap.toggleRotatorBearing : toggleRotatorBearing;
  const toggleAPRSEff = useInternalMapLayers ? internalMap.toggleAPRS : toggleAPRS;

  // Per-panel zoom levels (persisted)
  const [panelZoom, setPanelZoom] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_panelZoom');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_panelZoom', JSON.stringify(panelZoom));
    } catch (err) {
      /* noop */ void err;
    }
  }, [panelZoom]);

  useEffect(() => {
    const syncUnits = () => setEffectiveUnits(getEffectiveUnits(config?.units));
    syncUnits();
    window.addEventListener('storage', syncUnits);
    window.addEventListener('openhamclock-config-change', syncUnits);
    return () => {
      window.removeEventListener('storage', syncUnits);
      window.removeEventListener('openhamclock-config-change', syncUnits);
    };
  }, [config?.units]);

  const ZOOM_STEPS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 1.75, 2.0];
  const adjustZoom = useCallback((component, delta) => {
    setPanelZoom((prev) => {
      const current = prev[component] || 1.0;
      const currentIdx = ZOOM_STEPS.findIndex((s) => s >= current - 0.01);
      const newIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, (currentIdx >= 0 ? currentIdx : 3) + delta));
      const newZoom = ZOOM_STEPS[newIdx];
      if (newZoom === 1.0) {
        const { [component]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [component]: newZoom };
    });
  }, []);

  // Rig Control Hook
  const { tuneTo, enabled } = useRig();

  // Unified Spot Click Handler (Tune + Set DX)
  const handleSpotClick = useCallback(
    (spot) => {
      if (!spot) return;

      // 1. Tune Rig if frequency is available and rig control is enabled
      if (enabled && (spot.freq || spot.freqMHz || spot.dialFrequency)) {
        let freqToSend;

        // WSJT-X decodes have dialFrequency (the VFO frequency to tune to)
        // The freq field is just the audio delta offset within the passband
        if (spot.dialFrequency) {
          freqToSend = spot.dialFrequency; // Use dial frequency directly
        } else {
          // For other spot types (DX Cluster, POTA, etc.), use freq or freqMHz as-is
          freqToSend = spot.freq || spot.freqMHz;
        }

        tuneTo(freqToSend, spot.mode);
      }

      // 2. Set DX Location if location data is available
      // For DX Cluster spots, we need to find the path data which contains coordinates
      // For POTA/SOTA, the spot object itself has lat/lon
      if (spot.lat && spot.lon) {
        handleDXChange({ lat: spot.lat, lon: spot.lon });
      } else if (spot.call) {
        // Try to find in DX Cluster paths
        const path = (dxClusterData.paths || []).find((p) => p.dxCall === spot.call);
        if (path && path.dxLat != null && path.dxLon != null) {
          handleDXChange({ lat: path.dxLat, lon: path.dxLon });
        }
      }
    },
    [tuneTo, enabled, handleDXChange, dxClusterData.paths],
  );

  const resetZoom = useCallback((component) => {
    setPanelZoom((prev) => {
      const { [component]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Block layout-altering actions when locked
  const handleAction = useCallback(
    (action) => {
      // Prevent FlexLayout's default dblclick-to-maximize behavior.
      // We only allow maximize when our own drawer button requests it.
      if (action?.type === 'FlexLayout_MaximizeToggle') {
        if (allowMaximizeRef.current) {
          allowMaximizeRef.current = false;
          return action;
        }
        return undefined;
      }

      // Block layout-altering actions when locked
      if (layoutLocked) {
        const blockedTypes = [
          'FlexLayout_MoveNode',
          'FlexLayout_AdjustSplit',
          'FlexLayout_DeleteTab',
          'FlexLayout_AdjustBorderSplit',
        ];
        if (blockedTypes.includes(action.type)) return undefined;
      }
      return action;
    },
    [layoutLocked],
  );

  // Handle model changes with debounced save
  const handleModelChange = useCallback((newModel) => {
    setModel(newModel);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveLayout(newModel.toJson());
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Panel definitions
  const panelDefs = useMemo(() => {
    // Only show Ambient Weather when credentials are configured
    const hasAmbient = (() => {
      try {
        return !!(import.meta.env?.VITE_AMBIENT_API_KEY && import.meta.env?.VITE_AMBIENT_APPLICATION_KEY);
      } catch {
        return false;
      }
    })();

    return {
      'world-map': { name: 'World Map', icon: '🗺️' },
      'de-location': { name: 'DE Location', icon: '📍' },
      'dx-location': { name: 'DX Target', icon: '🎯' },
      'analog-clock': { name: 'Analog Clock', icon: '🕐' },
      solar: { name: 'Solar (all views)', icon: '☀️' },
      'solar-image': { name: 'Solar Image', icon: '☀️', group: 'Solar' },
      'solar-indices': { name: 'Solar Indices', icon: '📊', group: 'Solar' },
      'solar-xray': { name: 'X-Ray Flux', icon: '⚡', group: 'Solar' },
      lunar: { name: 'Lunar Phase', icon: '🌙', group: 'Solar' },
      propagation: { name: 'Propagation (all views)', icon: '📡' },
      'propagation-chart': { name: 'VOACAP Chart', icon: '📈', group: 'Propagation' },
      'propagation-bars': { name: 'VOACAP Bars', icon: '📊', group: 'Propagation' },
      'band-conditions': { name: 'Band Conditions', icon: '📶', group: 'Propagation' },
      'band-health': { name: 'Band Health', icon: '📶' },
      'dx-cluster': { name: 'DX Cluster', icon: '📻' },
      'psk-reporter': { name: 'PSK Reporter', icon: '📡' },
      dxpeditions: { name: 'DXpeditions', icon: '🏝️' },
      pota: { name: 'POTA', icon: '🏕️' },
      wwff: { name: 'WWFF', icon: '🌲' },
      sota: { name: 'SOTA', icon: '⛰️' },
      wwbota: { name: 'WWBOTA', icon: '☢️' },
      aprs: { name: 'APRS', icon: '📍' },
      ...(isLocalInstall ? { rotator: { name: 'Rotator', icon: '🧭' } } : {}),
      contests: { name: 'Contests', icon: '🏆' },
      ...(hasAmbient ? { ambient: { name: 'Ambient Weather', icon: '🌦️' } } : {}),
      'rig-control': { name: 'Rig Control', icon: '📻' },
      'on-air': { name: 'On Air', icon: '🔴' },
      'id-timer': { name: 'ID Timer', icon: '📢' },
    };
  }, [isLocalInstall]);

  // Add panel (force-select new tab so it becomes visible immediately)
  const handleAddPanel = useCallback(
    (panelId) => {
      if (!targetTabSetId || !panelDefs[panelId]) return;

      const newTabId = `${panelId}-${Date.now()}`;

      model.doAction(
        Actions.addNode(
          { type: 'tab', name: panelDefs[panelId].name, component: panelId, id: newTabId },
          targetTabSetId,
          DockLocation.CENTER,
          -1,
          true,
        ),
      );

      // Ensure the target tabset is the active one, then force-select the new tab.
      const activateNewTab = () => {
        try {
          if (typeof Actions.setActiveTabset === 'function') {
            model.doAction(Actions.setActiveTabset(targetTabSetId));
          }
        } catch (err) {
          /* noop */ void err;
        }
        try {
          model.doAction(Actions.selectTab(newTabId));
        } catch (err) {
          /* noop */ void err;
        }
      };

      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(activateNewTab);
      } else {
        setTimeout(activateNewTab, 0);
      }

      setShowPanelPicker(false);
    },
    [model, targetTabSetId, panelDefs],
  );

  const handleSelectTab = useCallback(
    (tabId) => {
      if (!tabId) return;
      try {
        model.doAction(Actions.selectTab(tabId));
      } catch (err) {
        /* noop */ void err;
      }
      setShowPanelPicker(false);
    },
    [model],
  );

  // Render DE Location panel content
  const renderDELocation = (nodeId) => (
    <div style={{ padding: '14px', height: '100%', overflowY: 'auto' }}>
      <div style={{ fontSize: '14px', color: 'var(--accent-cyan)', fontWeight: '700', marginBottom: '10px' }}>
        📍 DE - YOUR LOCATION
      </div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px' }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700' }}>{deGrid}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
          {config.location.lat.toFixed(4)}°, {config.location.lon.toFixed(4)}°
        </div>
        <div style={{ marginTop: '8px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
          <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{deSunTimes.sunrise}</span>
          <span style={{ color: 'var(--text-secondary)' }}> → </span>
          <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{deSunTimes.sunset}</span>
        </div>
      </div>

      <WeatherPanel weatherData={localWeather} units={config.units} nodeId={nodeId} />
    </div>
  );

  // Render DX Location panel
  const renderDXLocation = (nodeId) => {
    const spBearing = Math.round(
      calculateBearing(config.location.lat, config.location.lon, dxLocation.lat, dxLocation.lon),
    );
    const lpBearing = (spBearing + 180) % 360;
    const distanceKm = calculateDistance(config.location.lat, config.location.lon, dxLocation.lat, dxLocation.lon);

    return (
      <div style={{ padding: '14px', height: '100%', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ fontSize: '14px', color: 'var(--accent-green)', fontWeight: '700' }}>🎯 DX - TARGET</div>
          {handleToggleDxLock && (
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
                fontFamily: 'JetBrains Mono, monospace',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              {dxLocked ? '🔒' : '🔓'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px', flex: '1 1 auto', minWidth: 0 }}>
            <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700' }}>{dxGrid}</div>
            <DXLocalTime
              currentTime={currentTime}
              dxLocation={dxLocation}
              isLocal={showDXLocalTime}
              onToggle={() => setShowDXLocalTime((prev) => !prev)}
              marginTop="2px"
            />
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
              {dxLocation.lat.toFixed(4)}°, {dxLocation.lon.toFixed(4)}°
            </div>
            <div style={{ marginTop: '8px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
              <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{dxSunTimes.sunrise}</span>
              <span style={{ color: 'var(--text-secondary)' }}> → </span>
              <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{dxSunTimes.sunset}</span>
            </div>
          </div>

          <div
            style={{
              borderLeft: '1px solid var(--border-color)',
              paddingLeft: '12px',
              flex: '0 0 auto',
            }}
          >
            <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '6px' }}>
              {t?.('app.dxLocation.beamDir') || 'Beam Dir:'}
            </div>
            <div style={{ fontSize: '13px', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t?.('app.dxLocation.sp') || 'SP:'} </span>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{spBearing}°</span>
            </div>
            <div style={{ fontSize: '13px', marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t?.('app.dxLocation.lp') || 'LP:'} </span>
              <span style={{ color: 'var(--accent-purple)', fontWeight: '700' }}>{lpBearing}°</span>
            </div>
            <div style={{ fontSize: '13px', paddingTop: '6px', borderTop: '1px solid var(--border-color)' }}>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>
                📏 {formatDistance(distanceKm, effectiveUnits)}
              </span>
            </div>
          </div>
        </div>

        {showDxWeather && <WeatherPanel weatherData={dxWeather} units={config.units} nodeId={nodeId} />}
      </div>
    );
  };

  const rot = useRotator({
    mock: false,
    endpointUrl: isLocalInstall ? '/api/rotator/status' : undefined,
    pollMs: 2000,
    staleMs: 5000,
  });
  const turnRotator = useCallback(async (azimuth) => {
    const res = await fetch('/api/rotator/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ azimuth }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }, []);

  const stopRotator = useCallback(async () => {
    const res = await fetch('/api/rotator/stop', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }, []);

  // Render World Map
  const renderWorldMap = () => (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <WorldMap
        deLocation={config.location}
        dxLocation={dxLocation}
        onDXChange={handleDXChange}
        dxLocked={dxLocked}
        onHoverSpot={setHoveredSpot}
        potaSpots={filteredPotaSpots ? filteredPotaSpots : potaSpots.data}
        wwffSpots={filteredWwffSpots ? filteredWwffSpots : wwffSpots.data}
        sotaSpots={filteredSotaSpots ? filteredSotaSpots : sotaSpots.data}
        wwbotaSpots={filteredWwbotaSpots ? filteredWwbotaSpots : wwbotaSpots.data}
        mySpots={mySpots.data}
        dxPaths={dxClusterData.paths}
        dxFilters={dxFilters}
        mapBandFilter={mapBandFilter}
        onMapBandFilterChange={setMapBandFilter}
        satellites={filteredSatellites}
        pskReporterSpots={filteredPskSpots}
        wsjtxSpots={wsjtxMapSpots}
        showDXPaths={mapLayersEff.showDXPaths}
        showDXLabels={mapLayersEff.showDXLabels}
        onToggleDXLabels={mapLayersEff.showDXPaths ? toggleDXLabelsEff : undefined}
        showPOTA={mapLayersEff.showPOTA}
        showPOTALabels={mapLayersEff.showPOTALabels}
        showWWFF={mapLayersEff.showWWFF}
        showWWFFLabels={mapLayersEff.showWWFFLabels}
        showSOTA={mapLayersEff.showSOTA}
        showSOTALabels={mapLayersEff.showSOTALabels}
        showWWBOTA={mapLayersEff.showWWBOTA}
        showWWBOTALabels={mapLayersEff.showWWBOTALabels}
        showSatellites={mapLayersEff.showSatellites}
        onToggleSatellites={toggleSatellitesEff}
        showPSKReporter={mapLayersEff.showPSKReporter}
        showPSKPaths={mapLayersEff.showPSKPaths}
        showWSJTX={mapLayersEff.showWSJTX}
        showDXNews={mapLayersEff.showDXNews}
        showAPRS={mapLayersEff.showAPRS}
        aprsStations={aprsData?.filteredStations}
        aprsWatchlistCalls={aprsData?.allWatchlistCalls}
        // ✅ Rotator bearing overlay support
        showRotatorBearing={mapLayersEff.showRotatorBearing}
        rotatorAzimuth={rot.azimuth}
        rotatorLastGoodAzimuth={rot.lastGoodAzimuth}
        rotatorIsStale={rot.isStale}
        rotatorControlEnabled={!rot.isStale}
        onRotatorTurnRequest={turnRotator}
        hoveredSpot={hoveredSpot}
        leftSidebarVisible={true}
        rightSidebarVisible={true}
        callsign={config.callsign}
        lowMemoryMode={config.lowMemoryMode}
        units={config.units}
        onSpotClick={handleSpotClick}
        mouseZoom={config.mouseZoom}
      />
    </div>
  );

  // Factory for rendering panel content
  const factory = useCallback(
    (node) => {
      const component = node.getComponent();
      const nodeId = node.getId();

      let content;
      switch (component) {
        case 'world-map':
          return renderWorldMap(); // Map has its own zoom — skip panel zoom

        case 'de-location':
          content = renderDELocation(nodeId);
          break;

        case 'dx-location':
          content = renderDXLocation(nodeId);
          break;

        case 'analog-clock':
          content = <AnalogClockPanel currentTime={currentTime} sunTimes={deSunTimes} />;
          break;

        case 'solar':
          content = <SolarPanel solarIndices={solarIndices} />;
          break;

        case 'solar-image':
          content = <SolarPanel solarIndices={solarIndices} forcedMode="image" />;
          break;

        case 'solar-indices':
          content = <SolarPanel solarIndices={solarIndices} forcedMode="indices" />;
          break;

        case 'solar-xray':
          content = <SolarPanel solarIndices={solarIndices} forcedMode="xray" />;
          break;

        case 'lunar':
          content = <SolarPanel solarIndices={solarIndices} forcedMode="lunar" />;
          break;

        case 'propagation':
          content = (
            <PropagationPanel
              propagation={propagation.data}
              loading={propagation.loading}
              bandConditions={bandConditions}
              units={config.units}
              propConfig={config.propagation}
            />
          );
          break;

        case 'propagation-chart':
          content = (
            <PropagationPanel
              propagation={propagation.data}
              loading={propagation.loading}
              bandConditions={bandConditions}
              units={config.units}
              propConfig={config.propagation}
              forcedMode="chart"
            />
          );
          break;

        case 'propagation-bars':
          content = (
            <PropagationPanel
              propagation={propagation.data}
              loading={propagation.loading}
              bandConditions={bandConditions}
              units={config.units}
              propConfig={config.propagation}
              forcedMode="bars"
            />
          );
          break;

        case 'band-conditions':
          content = (
            <PropagationPanel
              propagation={propagation.data}
              loading={propagation.loading}
              bandConditions={bandConditions}
              units={config.units}
              propConfig={config.propagation}
              forcedMode="bands"
            />
          );
          break;

        case 'band-health':
          return <BandHealthPanel dxSpots={dxClusterData.spots} clusterFilters={dxFilters} />;

        case 'dx-cluster':
          content = (
            <DXClusterPanel
              data={dxClusterData.spots}
              loading={dxClusterData.loading}
              totalSpots={dxClusterData.totalSpots}
              filters={dxFilters}
              onFilterChange={setDxFilters}
              onOpenFilters={() => setShowDXFilters(true)}
              onHoverSpot={setHoveredSpot}
              onSpotClick={handleSpotClick}
              hoveredSpot={hoveredSpot}
              showOnMap={mapLayersEff.showDXPaths}
              onToggleMap={toggleDXPathsEff}
            />
          );
          break;

        case 'psk-reporter':
          content = (
            <PSKReporterPanel
              callsign={config.callsign}
              pskReporter={pskReporter}
              showOnMap={mapLayersEff.showPSKReporter}
              onToggleMap={togglePSKReporterEff}
              showPaths={mapLayersEff.showPSKPaths}
              onTogglePaths={togglePSKPathsEff}
              filters={pskFilters}
              onOpenFilters={() => setShowPSKFilters(true)}
              onSpotClick={handleSpotClick}
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
              showWSJTXOnMap={mapLayersEff.showWSJTX}
              onToggleWSJTXMap={toggleWSJTXEff}
            />
          );
          break;

        case 'dxpeditions':
          content = <DXpeditionPanel data={dxpeditions.data} loading={dxpeditions.loading} />;
          break;

        case 'pota':
          content = (
            <POTAPanel
              data={potaSpots.data}
              loading={potaSpots.loading}
              lastUpdated={potaSpots.lastUpdated}
              lastChecked={potaSpots.lastChecked}
              showOnMap={mapLayersEff.showPOTA}
              onToggleMap={togglePOTAEff}
              onHoverSpot={setHoveredSpot}
              showLabelsOnMap={mapLayersEff.showPOTALabels}
              onToggleLabelsOnMap={togglePOTALabelsEff}
              onSpotClick={handleSpotClick}
              filters={potaFilters}
              onOpenFilters={() => setShowPotaFilters(true)}
              filteredData={filteredPotaSpots}
            />
          );
          break;

        case 'wwff':
          content = (
            <WWFFPanel
              data={wwffSpots.data}
              loading={wwffSpots.loading}
              lastUpdated={wwffSpots.lastUpdated}
              lastChecked={wwffSpots.lastChecked}
              showOnMap={mapLayersEff.showWWFF}
              onToggleMap={toggleWWFFEff}
              onHoverSpot={setHoveredSpot}
              showLabelsOnMap={mapLayersEff.showWWFFLabels}
              onToggleLabelsOnMap={toggleWWFFLabelsEff}
              onSpotClick={handleSpotClick}
              filters={wwffFilters}
              onOpenFilters={() => setShowWwffFilters(true)}
              filteredData={filteredWwffSpots}
            />
          );
          break;

        case 'sota':
          content = (
            <SOTAPanel
              data={sotaSpots.data}
              loading={sotaSpots.loading}
              lastUpdated={sotaSpots.lastUpdated}
              lastChecked={sotaSpots.lastChecked}
              showOnMap={mapLayersEff.showSOTA}
              onToggleMap={toggleSOTAEff}
              onHoverSpot={setHoveredSpot}
              showLabelsOnMap={mapLayersEff.showSOTALabels}
              onToggleLabelsOnMap={toggleSOTALabelsEff}
              onSpotClick={handleSpotClick}
              filters={sotaFilters}
              onOpenFilters={() => setShowSotaFilters(true)}
              filteredData={filteredSotaSpots}
            />
          );
          break;

        case 'wwbota':
          content = (
            <WWBOTAPanel
              data={wwbotaSpots.data}
              loading={wwbotaSpots.loading}
              lastUpdated={wwbotaSpots.lastUpdated}
              connected={wwbotaSpots.connected}
              showOnMap={mapLayersEff.showWWBOTA}
              onToggleMap={toggleWWBOTAEff}
              onHoverSpot={setHoveredSpot}
              showLabelsOnMap={mapLayersEff.showWWBOTALabels}
              onToggleLabelsOnMap={toggleWWBOTALabelsEff}
              onSpotClick={handleSpotClick}
              filters={wwbotaFilters}
              onOpenFilters={() => setShowWwbotaFilters(true)}
              filteredData={filteredWwbotaSpots}
            />
          );
          break;

        case 'aprs':
          content = (
            <APRSPanel
              aprsData={aprsData}
              showOnMap={mapLayersEff.showAPRS}
              onToggleMap={toggleAPRSEff}
              onHoverSpot={setHoveredSpot}
              onSpotClick={handleSpotClick}
            />
          );
          break;

        case 'contests':
          content = <ContestPanel data={contests.data} loading={contests.loading} />;
          break;

        case 'rotator':
          return (
            <RotatorPanel
              state={rot}
              overlayEnabled={mapLayersEff.showRotatorBearing}
              onToggleOverlay={toggleRotatorBearingEff}
              onTurnAzimuth={turnRotator}
              onStop={stopRotator}
              controlsEnabled={!rot.isStale}
            />
          );

        case 'ambient':
          content = <AmbientPanel units={config.units} />;
          break;

        case 'rig-control':
          content = <RigControlPanel />;
          break;

        case 'on-air':
          content = <OnAirPanel />;
          break;

        case 'id-timer':
          content = <IDTimerPanel callsign={config.callsign} />;
          break;

        default:
          content = (
            <div style={{ padding: '20px', color: '#ff6b6b', textAlign: 'center' }}>
              <div style={{ fontSize: '14px', marginBottom: '8px' }}>Outdated panel: {component}</div>
              <div style={{ fontSize: '12px', color: '#888' }}>Click "Reset" button below to update layout</div>
            </div>
          );
      }

      // Apply per-panel zoom
      const zoom = panelZoom[component] || 1.0;
      if (zoom !== 1.0) {
        return <div style={{ zoom, width: '100%', height: '100%', transformOrigin: 'top left' }}>{content}</div>;
      }
      return content;
    },
    [
      config,
      deGrid,
      dxGrid,
      dxLocation,
      deSunTimes,
      dxSunTimes,
      showDxWeather,
      localWeather,
      dxWeather,
      solarIndices,
      propagation,
      bandConditions,
      dxClusterData,
      dxFilters,
      mapBandFilter,
      hoveredSpot,
      mapLayers,
      potaSpots,
      wwffSpots,
      sotaSpots,
      mySpots,
      satellites,
      filteredSatellites,
      filteredPskSpots,
      wsjtxMapSpots,
      dxpeditions,
      contests,
      pskFilters,
      wsjtx,
      handleDXChange,
      setDxFilters,
      setMapBandFilter,
      setShowDXFilters,
      setShowPSKFilters,
      setHoveredSpot,
      toggleDXPaths,
      toggleDXLabels,
      togglePOTA,
      toggleWWFF,
      toggleSOTA,
      toggleSatellites,
      togglePSKReporter,
      togglePSKPaths,
      toggleWSJTX,
      dxLocked,
      handleToggleDxLock,
      panelZoom,
    ],
  );

  // Add + and font size buttons to tabsets

  // Minimal Tabset toolbar:
  // - No custom tabs UI in the header (tabs hidden in CSS)
  // - Drawer is CSS-hover only (no JS pin/toggle)
  // - Tools live in renderValues.buttons (drawer row)
  const onRenderTabSet = useCallback(
    (node, renderValues) => {
      const selectedNode = node.getSelectedNode?.();
      const selectedComponent = selectedNode?.getComponent?.();

      // Kill any default header-row icons (close, maximize, overflow, etc.)
      // Everything lives in the hover-drawer row.
      renderValues.stickyButtons = [];
      renderValues.buttons = [];

      const addDrawerBtn = (btn) => renderValues.buttons.push(btn);

      const cycleTab = (delta) => {
        try {
          const tabs = node.getChildren?.() || [];
          if (tabs.length < 2) return;

          const selectedId = selectedNode?.getId?.();
          let idx = tabs.findIndex((t) => t.getId?.() === selectedId);
          if (idx < 0) idx = 0;

          const nextIdx = (idx + delta + tabs.length) % tabs.length;
          const nextId = tabs[nextIdx]?.getId?.();
          if (nextId) model.doAction(Actions.selectTab(nextId));
        } catch (err) {
          /* noop */ void err;
        }
      };

      // Header-as-button: when drawer is open (hover), let users click anywhere on the header to cycle tabs.
      // Click = next tab, Shift+Click = previous tab.
      // Z-index in CSS keeps drawer buttons clickable above this hit-area.
      renderValues.stickyButtons.push(
        <button
          key="ohc-header-cycle"
          type="button"
          className="ohc-header-cycle-hitarea"
          title="Click to cycle panels (Shift = previous)"
          aria-label="Cycle panels (Shift = previous)"
          onPointerDown={(e) => {
            // Tablet/touch safety:
            // First tap should OPEN the drawer (via :focus-within), not immediately cycle.
            // Once the drawer is open (hover or focus-within), tap/click cycles.
            e.preventDefault();
            e.stopPropagation();

            const outer = e.currentTarget.closest('.flexlayout__tabset_tabbar_outer');
            const drawerOpen = !!outer && outer.matches(':hover, :focus-within');
            if (!drawerOpen) {
              try {
                e.currentTarget.focus();
              } catch {
                /* noop */
              }
              return;
            }

            cycleTab(e.shiftKey ? -1 : 1);
          }}
          onKeyDown={(e) => {
            const outer = e.currentTarget.closest('.flexlayout__tabset_tabbar_outer');
            const drawerOpen = !!outer && outer.matches(':hover, :focus-within');
            if (!drawerOpen) return;

            const key = e.key;
            if (key === 'Enter' || key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              cycleTab(e.shiftKey ? -1 : 1);
            } else if (key === 'ArrowLeft') {
              e.preventDefault();
              e.stopPropagation();
              cycleTab(-1);
            } else if (key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              cycleTab(1);
            }
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />,
      );

      // Panels (drawer) — opens the React panel picker for this tabset
      addDrawerBtn(
        <button
          key="ohc-panels"
          title="Panels"
          className="flexlayout__tab_toolbar_button ohc-drawer-tool"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTargetTabSetId(node.getId());
            setPanelPickerView('switch');
            setShowPanelPicker(true);
          }}
        >
          ▦
        </button>,
      );

      // Zoom controls (skip world-map)
      if (selectedComponent && selectedComponent !== 'world-map') {
        const currentZoom = panelZoom[selectedComponent] || 1.0;
        const zoomPct = Math.round(currentZoom * 100);

        addDrawerBtn(
          <button
            key="zoom-out"
            title="Decrease font size"
            className="flexlayout__tab_toolbar_button ohc-drawer-tool"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              adjustZoom(selectedComponent, -1);
            }}
            style={{
              fontSize: '11px',
              fontWeight: '700',
              fontFamily: 'JetBrains Mono, monospace',
              padding: '0 3px',
              opacity: currentZoom <= 0.7 ? 0.3 : 1,
            }}
          >
            A−
          </button>,
        );

        if (currentZoom !== 1.0) {
          addDrawerBtn(
            <button
              key="zoom-reset"
              title="Reset font size"
              className="flexlayout__tab_toolbar_button ohc-drawer-tool"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                resetZoom(selectedComponent);
              }}
              style={{
                fontSize: '9px',
                fontFamily: 'JetBrains Mono, monospace',
                padding: '0 6px',
                color: 'var(--accent-amber)',
              }}
            >
              {zoomPct}%
            </button>,
          );
        }

        addDrawerBtn(
          <button
            key="zoom-in"
            title="Increase font size"
            className="flexlayout__tab_toolbar_button ohc-drawer-tool"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              adjustZoom(selectedComponent, 1);
            }}
            style={{
              fontSize: '11px',
              fontWeight: '700',
              fontFamily: 'JetBrains Mono, monospace',
              padding: '0 3px',
              opacity: currentZoom >= 2.0 ? 0.3 : 1,
            }}
          >
            A+
          </button>,
        );
      }

      // Maximize (drawer) — explicitly allowed (blocks dblclick maximize)
      addDrawerBtn(
        <button
          key="maximize"
          title="Maximize panel"
          className="flexlayout__tab_toolbar_button ohc-drawer-tool"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              allowMaximizeRef.current = true;
              model.doAction(Actions.maximizeToggle(node.getId()));
            } catch (err) {
              /* noop */ void err;
            }
          }}
        >
          ⛶
        </button>,
      );

      // Close (drawer) — closes the currently selected tab in this tabset
      addDrawerBtn(
        <button
          key="close"
          title="Close panel"
          className="flexlayout__tab_toolbar_button ohc-drawer-tool"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              const tabId = selectedNode?.getId?.();
              if (!tabId) return;
              model.doAction(Actions.deleteTab(tabId));
            } catch (err) {
              /* noop */ void err;
            }
          }}
        >
          ✕
        </button>,
      );
    },
    [model, panelZoom, adjustZoom, resetZoom],
  );

  const getAvailablePanels = useCallback(() => {
    const used = new Set();
    const walk = (n) => {
      if (n.getType?.() === 'tab') used.add(n.getComponent());
      (n.getChildren?.() || []).forEach(walk);
    };
    walk(model.getRoot());
    return Object.entries(panelDefs)
      .filter(([id]) => !used.has(id))
      .map(([id, def]) => ({ id, ...def }));
  }, [model, panelDefs]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Header */}
      <div style={{ flexShrink: 0, padding: '8px 8px 0 8px' }}>
        <Header
          config={config}
          utcTime={utcTime}
          utcDate={utcDate}
          localTime={localTime}
          localDate={localDate}
          localWeather={localWeather}
          spaceWeather={spaceWeather}
          solarIndices={solarIndices}
          bandConditions={bandConditions}
          use12Hour={use12Hour}
          onTimeFormatToggle={handleTimeFormatToggle}
          onSettingsClick={() => setShowSettings(true)}
          onFullscreenToggle={handleFullscreenToggle}
          isFullscreen={isFullscreen}
          onUpdateClick={handleUpdateClick}
          updateInProgress={updateInProgress}
          showUpdateButton={isLocalInstall}
        />
      </div>

      {/* Dockable toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '2px 16px 0',
        }}
      >
        <button
          onClick={toggleLayoutLock}
          title={
            layoutLocked ? 'Unlock layout — allow drag, resize, and close' : 'Lock layout — prevent accidental changes'
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: layoutLocked ? 'rgba(255, 170, 0, 0.15)' : 'var(--bg-tertiary)',
            border: `1px solid ${layoutLocked ? 'var(--accent-amber)' : 'var(--border-color)'}`,
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono, monospace',
            color: layoutLocked ? 'var(--accent-amber)' : 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          {layoutLocked ? '🔒' : '🔓'} Layout {layoutLocked ? 'Locked' : 'Unlocked'}
        </button>
      </div>

      {/* Dockable Layout */}
      <div style={{ flex: 1, position: 'relative', padding: '8px', minHeight: 0 }}>
        <DockableLayoutProvider model={model}>
          <Layout
            ref={layoutRef}
            model={model}
            factory={factory}
            onAction={handleAction}
            onModelChange={handleModelChange}
            onRenderTabSet={onRenderTabSet}
          />
        </DockableLayoutProvider>
      </div>

      {/* Panel picker modal */}
      {showPanelPicker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setShowPanelPicker(false)}
        >
          <div
            style={{
              background: 'rgba(26,32,44,0.98)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              padding: 18,
              width: 380,
              maxWidth: '88vw',
              boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(10px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                onClick={() => setPanelPickerView('switch')}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #2d3748',
                  background: panelPickerView === 'switch' ? 'rgba(0,255,204,0.12)' : 'rgba(0,0,0,0.25)',
                  color: panelPickerView === 'switch' ? '#00ffcc' : '#cbd5e0',
                  fontFamily: 'JetBrains Mono',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Panels
              </button>
              <button
                onClick={() => setPanelPickerView('add')}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #2d3748',
                  background: panelPickerView === 'add' ? 'rgba(0,255,204,0.12)' : 'rgba(0,0,0,0.25)',
                  color: panelPickerView === 'add' ? '#00ffcc' : '#cbd5e0',
                  fontFamily: 'JetBrains Mono',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Add
              </button>
            </div>

            {panelPickerView === 'switch' ? (
              <>
                <h3
                  style={{
                    margin: '0 0 14px',
                    color: '#00ffcc',
                    fontFamily: 'JetBrains Mono',
                    fontSize: '14px',
                  }}
                >
                  Switch Panels
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                  {(() => {
                    try {
                      const tabset = targetTabSetId ? model.getNodeById(targetTabSetId) : null;
                      const tabs = tabset?.getChildren?.() || [];
                      if (!tabs.length) {
                        return (
                          <div
                            style={{
                              color: '#a0aec0',
                              fontFamily: 'JetBrains Mono',
                              fontSize: 12,
                              padding: '8px 2px',
                            }}
                          >
                            No panels in this stack.
                          </div>
                        );
                      }
                      return tabs.map((tab) => {
                        const tabId = tab.getId?.();
                        const name = tab.getName?.() || tab.getComponent?.() || 'Panel';
                        const sub = tab.getComponent?.() || '';
                        return (
                          <div
                            key={tabId}
                            style={{
                              position: 'relative',
                              background: 'rgba(0,0,0,0.25)',
                              border: '1px solid #2d3748',
                              borderRadius: 10,
                              padding: '12px 40px 12px 40px', // symmetric padding
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = '#00ffcc';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = '#2d3748';
                            }}
                          >
                            {/* Centered content */}
                            <button
                              onClick={() => handleSelectTab(tabId)}
                              style={{
                                width: '100%',
                                background: 'transparent',
                                border: 0,
                                padding: 0,
                                cursor: 'pointer',
                                textAlign: 'center',
                              }}
                            >
                              <div
                                style={{
                                  color: '#e2e8f0',
                                  fontFamily: 'JetBrains Mono',
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {name}
                              </div>
                              <div
                                style={{
                                  color: '#718096',
                                  fontFamily: 'JetBrains Mono',
                                  fontSize: 10,
                                  marginTop: 3,
                                }}
                              >
                                {sub}
                              </div>
                            </button>

                            {/* Floating close button */}
                            <button
                              title="Close panel"
                              onClick={(e) => {
                                e.stopPropagation();
                                try {
                                  model.doAction(Actions.deleteTab(tabId));
                                } catch (err) {
                                  /* noop */ void err;
                                }
                              }}
                              style={{
                                position: 'absolute',
                                right: 12,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: 26,
                                height: 26,
                                display: 'grid',
                                placeItems: 'center',
                                borderRadius: 8,
                                border: '1px solid #2d3748',
                                background: 'rgba(0,0,0,0.25)',
                                color: '#cbd5e0',
                                cursor: 'pointer',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#ff6b6b';
                                e.currentTarget.style.color = '#ff6b6b';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = '#2d3748';
                                e.currentTarget.style.color = '#cbd5e0';
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      });
                    } catch {
                      return null;
                    }
                  })()}
                </div>
              </>
            ) : (
              <>
                <h3
                  style={{
                    margin: '0 0 16px',
                    color: '#00ffcc',
                    fontFamily: 'JetBrains Mono',
                    fontSize: '14px',
                  }}
                >
                  Add Panel
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {(() => {
                    const panels = getAvailablePanels();
                    const ungrouped = panels.filter((p) => !p.group);
                    const groups = {};
                    panels
                      .filter((p) => p.group)
                      .forEach((p) => {
                        if (!groups[p.group]) groups[p.group] = [];
                        groups[p.group].push(p);
                      });
                    return (
                      <>
                        {ungrouped.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleAddPanel(p.id)}
                            style={{
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid #2d3748',
                              borderRadius: '6px',
                              padding: '10px',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = '#00ffcc';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = '#2d3748';
                            }}
                          >
                            <span style={{ fontSize: '16px', marginRight: '8px' }}>{p.icon}</span>
                            <span style={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono', fontSize: '12px' }}>
                              {p.name}
                            </span>
                          </button>
                        ))}
                        {Object.entries(groups).map(([group, items]) => (
                          <React.Fragment key={group}>
                            <div
                              style={{
                                gridColumn: '1 / -1',
                                fontSize: '10px',
                                color: '#718096',
                                fontFamily: 'JetBrains Mono',
                                marginTop: '6px',
                                borderTop: '1px solid #2d3748',
                                paddingTop: '8px',
                              }}
                            >
                              {group} Sub-panels
                            </div>
                            {items.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => handleAddPanel(p.id)}
                                style={{
                                  background: 'rgba(0,0,0,0.2)',
                                  border: '1px solid #2d3748',
                                  borderRadius: '6px',
                                  padding: '8px 10px',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.borderColor = '#00ffcc';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.borderColor = '#2d3748';
                                }}
                              >
                                <span style={{ fontSize: '14px', marginRight: '8px' }}>{p.icon}</span>
                                <span style={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono', fontSize: '12px' }}>
                                  {p.name}
                                </span>
                              </button>
                            ))}
                          </React.Fragment>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </>
            )}

            {getAvailablePanels().length === 0 && (
              <div style={{ color: '#718096', textAlign: 'center', padding: '20px' }}>All panels visible</div>
            )}
            <button
              onClick={() => setShowPanelPicker(false)}
              style={{
                width: '100%',
                marginTop: '12px',
                background: 'transparent',
                border: '1px solid #2d3748',
                borderRadius: '6px',
                padding: '8px',
                color: '#a0aec0',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default DockableApp;
