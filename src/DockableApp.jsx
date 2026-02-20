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
} from './components';

import { loadLayout, saveLayout, DEFAULT_LAYOUT } from './store/layoutStore.js';
import { DockableLayoutProvider } from './contexts';
import { useRig } from './contexts/RigContext.jsx';
import './styles/flexlayout-openhamclock.css';
import useMapLayers from './hooks/app/useMapLayers';
import useRotator from './hooks/useRotator';

// Icons
const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const DockableApp = ({
  // Config & state from parent
  config,
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
  tempUnit,
  setTempUnit,
  showDxWeather,

  // Space weather & solar
  spaceWeather,
  solarIndices,
  bandConditions,
  propagation,

  // Spots & data
  dxClusterData,
  potaSpots,
  wwffSpots,
  sotaSpots,
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

  // Map layers
  mapLayers,
  toggleDXPaths,
  toggleDXLabels,
  togglePOTA,
  togglePOTALabels,
  toggleWWFF,
  toggleWWFFLabels,
  toggleSOTA,
  toggleSatellites,
  togglePSKReporter,
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
  const [targetTabSetId, setTargetTabSetId] = useState(null);
  const saveTimeoutRef = useRef(null);

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
  const toggleSatellitesEff = useInternalMapLayers ? internalMap.toggleSatellites : toggleSatellites;
  const togglePSKReporterEff = useInternalMapLayers ? internalMap.togglePSKReporter : togglePSKReporter;
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
    } catch {}
  }, [panelZoom]);

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
      aprs: { name: 'APRS', icon: '📍' },
      ...(isLocalInstall ? { rotator: { name: 'Rotator', icon: '🧭' } } : {}),
      contests: { name: 'Contests', icon: '🏆' },
      ...(hasAmbient ? { ambient: { name: 'Ambient Weather', icon: '🌦️' } } : {}),
      'rig-control': { name: 'Rig Control', icon: '📻' },
      'on-air': { name: 'On Air', icon: '🔴' },
      'id-timer': { name: 'ID Timer', icon: '📢' },
    };
  }, [isLocalInstall]);

  // Add panel
  const handleAddPanel = useCallback(
    (panelId) => {
      if (!targetTabSetId || !panelDefs[panelId]) return;
      model.doAction(
        Actions.addNode(
          { type: 'tab', name: panelDefs[panelId].name, component: panelId, id: `${panelId}-${Date.now()}` },
          targetTabSetId,
          DockLocation.CENTER,
          -1,
          true,
        ),
      );
      setShowPanelPicker(false);
    },
    [model, targetTabSetId, panelDefs],
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

      <WeatherPanel
        weatherData={localWeather}
        tempUnit={tempUnit}
        onTempUnitChange={(unit) => {
          setTempUnit(unit);
          try {
            localStorage.setItem('openhamclock_tempUnit', unit);
          } catch {}
        }}
        nodeId={nodeId}
      />
    </div>
  );

  // Render DX Location panel
  const renderDXLocation = (nodeId) => (
    <div style={{ padding: '14px', height: '100%' }}>
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
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px' }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700' }}>{dxGrid}</div>
        {(() => {
          const utcOffsetH = Math.round(dxLocation.lon / 15);
          const dxDate = new Date(currentTime.getTime() + utcOffsetH * 3600000);
          const hh = String(dxDate.getUTCHours()).padStart(2, '0');
          const mm = String(dxDate.getUTCMinutes()).padStart(2, '0');
          const sign = utcOffsetH >= 0 ? '+' : '';
          return (
            <div style={{ color: 'var(--accent-cyan)', fontSize: '13px', marginTop: '2px' }}>
              {hh}:{mm}{' '}
              <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                (UTC{sign}
                {utcOffsetH})
              </span>
            </div>
          );
        })()}
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
      {showDxWeather && (
        <WeatherPanel
          weatherData={dxWeather}
          tempUnit={tempUnit}
          onTempUnitChange={(unit) => {
            setTempUnit(unit);
            try {
              localStorage.setItem('openhamclock_tempUnit', unit);
            } catch {}
          }}
          nodeId={nodeId}
        />
      )}
    </div>
  );

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
        potaSpots={potaSpots.data}
        wwffSpots={wwffSpots.data}
        sotaSpots={sotaSpots.data}
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
        showSatellites={mapLayersEff.showSatellites}
        onToggleSatellites={toggleSatellitesEff}
        showPSKReporter={mapLayersEff.showPSKReporter}
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
          content = (
            <AmbientPanel
              tempUnit={tempUnit}
              onTempUnitChange={(unit) => {
                setTempUnit(unit);
                try {
                  localStorage.setItem('openhamclock_tempUnit', unit);
                } catch {}
              }}
            />
          );
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
      tempUnit,
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
      toggleWSJTX,
      dxLocked,
      handleToggleDxLock,
      panelZoom,
    ],
  );

  // Add + and font size buttons to tabsets
  const onRenderTabSet = useCallback(
    (node, renderValues) => {
      // Get the active tab's component name for zoom controls
      const selectedNode = node.getSelectedNode?.();
      const selectedComponent = selectedNode?.getComponent?.();

      // Skip zoom controls for world-map
      if (selectedComponent && selectedComponent !== 'world-map') {
        const currentZoom = panelZoom[selectedComponent] || 1.0;
        const zoomPct = Math.round(currentZoom * 100);

        renderValues.stickyButtons.push(
          <button
            key="zoom-out"
            title="Decrease font size"
            className="flexlayout__tab_toolbar_button"
            onClick={(e) => {
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
          renderValues.stickyButtons.push(
            <button
              key="zoom-reset"
              title="Reset font size"
              className="flexlayout__tab_toolbar_button"
              onClick={(e) => {
                e.stopPropagation();
                resetZoom(selectedComponent);
              }}
              style={{
                fontSize: '9px',
                fontFamily: 'JetBrains Mono, monospace',
                padding: '0 2px',
                color: 'var(--accent-amber)',
              }}
            >
              {zoomPct}%
            </button>,
          );
        }
        renderValues.stickyButtons.push(
          <button
            key="zoom-in"
            title="Increase font size"
            className="flexlayout__tab_toolbar_button"
            onClick={(e) => {
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

      renderValues.stickyButtons.push(
        <button
          key="add"
          title="Add panel"
          className="flexlayout__tab_toolbar_button"
          onClick={(e) => {
            e.stopPropagation();
            setTargetTabSetId(node.getId());
            setShowPanelPicker(true);
          }}
        >
          <PlusIcon />
        </button>,
      );
    },
    [panelZoom, adjustZoom, resetZoom],
  );

  // Get unused panels
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

      {/* Dockable Layout */}
      <div style={{ flex: 1, position: 'relative', padding: '8px', minHeight: 0 }}>
        <DockableLayoutProvider model={model}>
          <Layout
            ref={layoutRef}
            model={model}
            factory={factory}
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
              border: '1px solid #2d3748',
              borderRadius: '12px',
              padding: '20px',
              minWidth: '350px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', color: '#00ffcc', fontFamily: 'JetBrains Mono', fontSize: '14px' }}>
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
                            <span style={{ fontSize: '14px', marginRight: '6px' }}>{p.icon}</span>
                            <span style={{ color: '#cbd5e0', fontFamily: 'JetBrains Mono', fontSize: '11px' }}>
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
