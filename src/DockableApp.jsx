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
  ContestPanel,
  SolarPanel,
  PropagationPanel,
  DXpeditionPanel,
  PSKReporterPanel,
  WeatherPanel,
  AnalogClockPanel
} from './components';

import { loadLayout, saveLayout, DEFAULT_LAYOUT } from './store/layoutStore.js';
import { DockableLayoutProvider } from './contexts';
import DELocationPanel from './renders/renderDELocation.jsx';
import DXLocationPanel from './renders/renderDXLocation.jsx';
import './styles/flexlayout-openhamclock.css';

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
  mySpots,
  dxpeditions,
  contests,
  satellites,
  pskReporter,
  wsjtx,
  filteredPskSpots,
  wsjtxMapSpots,

  // Filters
  dxFilters,
  setDxFilters,
  pskFilters,
  setShowDXFilters,
  setShowPSKFilters,

  // Map layers
  mapLayers,
  toggleDXPaths,
  toggleDXLabels,
  togglePOTA,
  toggleSatellites,
  togglePSKReporter,
  toggleWSJTX,
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
}) => {
  const layoutRef = useRef(null);
  const [model, setModel] = useState(() => Model.fromJson(loadLayout()));
  const [showPanelPicker, setShowPanelPicker] = useState(false);
  const [targetTabSetId, setTargetTabSetId] = useState(null);
  const saveTimeoutRef = useRef(null);

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
  const panelDefs = useMemo(() => ({
    'world-map': { name: 'World Map', icon: '🗺️' },
    'de-location': { name: 'DE Location', icon: '📍' },
    'dx-location': { name: 'DX Target', icon: '🎯' },
    'analog-clock': { name: 'Analog Clock', icon: '🕐' },
    'solar': { name: 'Solar', icon: '☀️' },
    'propagation': { name: 'Propagation', icon: '📡' },
    'dx-cluster': { name: 'DX Cluster', icon: '📻' },
    'psk-reporter': { name: 'PSK Reporter', icon: '📡' },
    'dxpeditions': { name: 'DXpeditions', icon: '🏝️' },
    'pota': { name: 'POTA', icon: '🏕️' },
    'contests': { name: 'Contests', icon: '🏆' },
  }), []);

  // Add panel
  const handleAddPanel = useCallback((panelId) => {
    if (!targetTabSetId || !panelDefs[panelId]) return;
    model.doAction(Actions.addNode(
      { type: 'tab', name: panelDefs[panelId].name, component: panelId, id: `${panelId}-${Date.now()}` },
      targetTabSetId, DockLocation.CENTER, -1, true
    ));
    setShowPanelPicker(false);
  }, [model, targetTabSetId, panelDefs]);

  // Render DE Location panel content
  const renderDELocation = (nodeId) => (
    <div style={{ padding: '14px', height: '100%', overflowY: 'auto' }}>
      <DELocationPanel
        location={config.location}
        grid={deGrid}
        sunTimes={deSunTimes}
        tempUnit={tempUnit}
        onTempUnitChange={(unit) => { setTempUnit(unit); try { localStorage.setItem('openhamclock_tempUnit', unit); } catch {} }}
        nodeId={nodeId}
      />
    </div>
  );

  // Render DX Location panel
  const renderDXLocation = (nodeId) => (
    <div style={{ padding: '14px', height: '100%' }}>
      <DXLocationPanel
        deLocation={config.location}
        dxLocation={dxLocation}
        grid={dxGrid}
        sunTimes={dxSunTimes}
        dxLocked={dxLocked}
        onToggleDxLock={handleToggleDxLock}
        showWeather={showDxWeather}
        tempUnit={tempUnit}
        onTempUnitChange={(unit) => { setTempUnit(unit); try { localStorage.setItem('openhamclock_tempUnit', unit); } catch {} }}
        nodeId={nodeId}
      />
    </div>
  );

  // Render World Map
  const renderWorldMap = () => (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
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
        leftSidebarVisible={true}
        rightSidebarVisible={true}
        lowMemoryMode={config.lowMemoryMode}
      />
    </div>
  );

  // Factory for rendering panel content
  const factory = useCallback((node) => {
    const component = node.getComponent();
    const nodeId = node.getId();

    switch (component) {
      case 'world-map':
        return renderWorldMap();

      case 'de-location':
        return renderDELocation(nodeId);

      case 'dx-location':
        return renderDXLocation(nodeId);

      case 'analog-clock':
        return <AnalogClockPanel currentTime={currentTime} sunTimes={deSunTimes} />;

      case 'solar':
        return <SolarPanel solarIndices={solarIndices} />;

      case 'propagation':
        return <PropagationPanel propagation={propagation.data} loading={propagation.loading} bandConditions={bandConditions} />;

      case 'dx-cluster':
        return (
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
        );

      case 'psk-reporter':
        return (
          <PSKReporterPanel
            callsign={config.callsign}
            showOnMap={mapLayers.showPSKReporter}
            onToggleMap={togglePSKReporter}
            filters={pskFilters}
            onOpenFilters={() => setShowPSKFilters(true)}
            onShowOnMap={() => {}}
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
        );

      case 'dxpeditions':
        return <DXpeditionPanel data={dxpeditions.data} loading={dxpeditions.loading} />;

      case 'pota':
        return <POTAPanel data={potaSpots.data} loading={potaSpots.loading} showOnMap={mapLayers.showPOTA} onToggleMap={togglePOTA} />;

      case 'contests':
        return <ContestPanel data={contests.data} loading={contests.loading} />;

      default:
        // Handle legacy layout components - prompt user to reset
        return (
          <div style={{ padding: '20px', color: '#ff6b6b', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px' }}>Outdated panel: {component}</div>
            <div style={{ fontSize: '12px', color: '#888' }}>Click "Reset" button below to update layout</div>
          </div>
        );
    }
  }, [
    config, deGrid, dxGrid, dxLocation, deSunTimes, dxSunTimes, showDxWeather, tempUnit, solarIndices,
    propagation, bandConditions, dxClusterData, dxFilters, hoveredSpot, mapLayers, potaSpots,
    mySpots, satellites, filteredPskSpots, wsjtxMapSpots, dxpeditions, contests,
    pskFilters, wsjtx, handleDXChange, setDxFilters, setShowDXFilters, setShowPSKFilters,
    setHoveredSpot, toggleDXPaths, toggleDXLabels, togglePOTA, toggleSatellites, togglePSKReporter, toggleWSJTX,
    dxLocked, handleToggleDxLock
  ]);

  // Add + button to tabsets
  const onRenderTabSet = useCallback((node, renderValues) => {
    renderValues.stickyButtons.push(
      <button
        key="add"
        title="Add panel"
        className="flexlayout__tab_toolbar_button"
        onClick={(e) => { e.stopPropagation(); setTargetTabSetId(node.getId()); setShowPanelPicker(true); }}
      >
        <PlusIcon />
      </button>
    );
  }, []);

  // Get unused panels
  const getAvailablePanels = useCallback(() => {
    const used = new Set();
    const walk = (n) => {
      if (n.getType?.() === 'tab') used.add(n.getComponent());
      (n.getChildren?.() || []).forEach(walk);
    };
    walk(model.getRoot());
    return Object.entries(panelDefs).filter(([id]) => !used.has(id)).map(([id, def]) => ({ id, ...def }));
  }, [model, panelDefs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: 'var(--bg-primary)' }}>
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
          use12Hour={use12Hour}
          onTimeFormatToggle={handleTimeFormatToggle}
          onSettingsClick={() => setShowSettings(true)}
          onFullscreenToggle={handleFullscreenToggle}
          isFullscreen={isFullscreen}
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
          onClick={() => setShowPanelPicker(false)}
        >
          <div
            style={{ background: 'rgba(26,32,44,0.98)', border: '1px solid #2d3748', borderRadius: '12px', padding: '20px', minWidth: '350px' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', color: '#00ffcc', fontFamily: 'JetBrains Mono', fontSize: '14px' }}>Add Panel</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {getAvailablePanels().map(p => (
                <button
                  key={p.id}
                  onClick={() => handleAddPanel(p.id)}
                  style={{
                    background: 'rgba(0,0,0,0.3)', border: '1px solid #2d3748', borderRadius: '6px',
                    padding: '10px', cursor: 'pointer', textAlign: 'left'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#00ffcc'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2d3748'; }}
                >
                  <span style={{ fontSize: '16px', marginRight: '8px' }}>{p.icon}</span>
                  <span style={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono', fontSize: '12px' }}>{p.name}</span>
                </button>
              ))}
            </div>
            {getAvailablePanels().length === 0 && (
              <div style={{ color: '#718096', textAlign: 'center', padding: '20px' }}>All panels visible</div>
            )}
            <button
              onClick={() => setShowPanelPicker(false)}
              style={{ width: '100%', marginTop: '12px', background: 'transparent', border: '1px solid #2d3748', borderRadius: '6px', padding: '8px', color: '#a0aec0', cursor: 'pointer' }}
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