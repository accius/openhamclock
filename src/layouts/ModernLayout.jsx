/**
 * Modern layout
 */
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
} from '../components';

import DELocationPanel from '../renders/renderDELocation.jsx';
import DXLocationPanel from '../renders/renderDXLocation.jsx';

export default function ModernLayout(props) {
  const {
    config,
    t,
    utcTime,
    utcDate,
    localTime,
    localDate,
    localWeather,
    spaceWeather,
    solarIndices,
    use12Hour,
    handleTimeFormatToggle,
    setShowSettings,
    handleUpdateClick,
    handleFullscreenToggle,
    isFullscreen,
    updateInProgress,
    isLocalInstall,
    leftSidebarVisible,
    rightSidebarVisible,
    getGridTemplateColumns,
    scale,
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
    showDxWeather,
    currentTime,
    classicAnalogClock,
    bandConditions,
    propagation,
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
    dxFilters,
    setDxFilters,
    pskFilters,
    setShowDXFilters,
    setShowPSKFilters,
    mapLayers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    toggleSatellites,
    togglePSKReporter,
    toggleWSJTX,
    hoveredSpot,
    setHoveredSpot,
    filteredSatellites,
  } = props;

  return (
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
        bandConditions={bandConditions}
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
          )}

          {/* DX Location */}
          {config.panels?.dxLocation?.visible !== false && (
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
          {t('app.callsign', { callsign: config.callsign })}
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
    </div>);
}
