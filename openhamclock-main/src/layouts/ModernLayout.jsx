/**
 * Modern layout
 */
import {
  Header,
  WorldMap,
  DXClusterPanel,
  PotaSotaPanel,
  ContestPanel,
  SolarPanel,
  PropagationPanel,
  DXpeditionPanel,
  PSKReporterPanel,
  WeatherPanel,
  AnalogClockPanel
} from '../components';

export default function ModernLayout(props) {
  const {
    config,
    t,
    utcTime,
    utcDate,
    localTime,
    localDate,
    localWeather,
    dxWeather,
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
    setShowDXFilters,
    setShowPSKFilters,
    mapLayers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    toggleSOTA,
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
            <div className="panel" style={{ padding: '14px', flex: '0 0 auto' }}>
              <div style={{ fontSize: '14px', color: 'var(--accent-cyan)', fontWeight: '700', marginBottom: '10px' }}>
                {t('app.dxLocation.deTitle')}
              </div>
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
                weatherData={localWeather}
                tempUnit={tempUnit}
                onTempUnitChange={(unit) => { setTempUnit(unit); try { localStorage.setItem('openhamclock_tempUnit', unit); } catch { } }}
              />
            </div>
          )}

          {/* DX Location */}
          {config.panels?.dxLocation?.visible !== false && (
            <div className="panel" style={{ padding: '14px', flex: '0 0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '14px', color: 'var(--accent-green)', fontWeight: '700' }}>
                  {t('app.dxLocation.dxTitle')}
                </div>
                <button
                  onClick={handleToggleDxLock}
                  title={dxLocked ? t('app.dxLock.unlockTooltip') : t('app.dxLock.lockTooltip')}
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
                  <div style={{ marginTop: '8px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
                    <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{dxSunTimes.sunrise}</span>
                    <span style={{ color: 'var(--text-secondary)' }}> → </span>
                    <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{dxSunTimes.sunset}</span>
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '12px', marginLeft: '12px', minWidth: '90px' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '4px' }}>{t('app.dxLocation.beamDir')}</div>
                  <div style={{ fontSize: '13px', marginBottom: '3px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{t('app.dxLocation.sp')} </span>
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
                    <span style={{ color: 'var(--text-secondary)' }}>{t('app.dxLocation.lp')} </span>
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
                      const R = 6371; // Earth radius in km
                      const deLat = config.location.lat * Math.PI / 180;
                      const deLon = config.location.lon * Math.PI / 180;
                      const dxLat = dxLocation.lat * Math.PI / 180;
                      const dxLon = dxLocation.lon * Math.PI / 180;
                      const dLat = dxLat - deLat;
                      const dLon = dxLon - deLon;
                      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(deLat) * Math.cos(dxLat) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
                      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                      const km = R * c;
                      return `📏 ${Math.round(km).toLocaleString()} km`;
                    })()}</span>
                  </div>
                </div>
              </div>
              {showDxWeather && (
                <WeatherPanel
                  weatherData={dxWeather}
                  tempUnit={tempUnit}
                  onTempUnitChange={(unit) => { setTempUnit(unit); try { localStorage.setItem('openhamclock_tempUnit', unit); } catch { } }}
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
              units={config.units}
              propConfig={config.propagation}
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
          sotaSpots={sotaSpots.data}
          mySpots={mySpots.data}
          dxPaths={dxClusterData.paths}
          dxFilters={dxFilters}
          satellites={filteredSatellites}
          pskReporterSpots={filteredPskSpots}
          showDXPaths={mapLayers.showDXPaths}
          showDXLabels={mapLayers.showDXLabels}
          onToggleDXLabels={toggleDXLabels}
          showPOTA={mapLayers.showPOTA}
          showSOTA={mapLayers.showSOTA}
          showSatellites={mapLayers.showSatellites}
          showPSKReporter={mapLayers.showPSKReporter}
          wsjtxSpots={wsjtxMapSpots}
          showWSJTX={mapLayers.showWSJTX}
          showDXNews={mapLayers.showDXNews}
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
                onSpotClick={(spot) => {
                  const path = (dxClusterData.paths || []).find(p => p.dxCall === spot.call);
                  if (path && path.dxLat != null && path.dxLon != null) {
                    handleDXChange({ lat: path.dxLat, lon: path.dxLon });
                  }
                }}
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
                pskReporter={pskReporter}
                showOnMap={mapLayers.showPSKReporter}
                onToggleMap={togglePSKReporter}
                filters={pskFilters}
                onOpenFilters={() => setShowPSKFilters(true)}
                onShowOnMap={(report) => {
                  if (report.lat && report.lon) {
                    handleDXChange({ lat: report.lat, lon: report.lon });
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

          {/* POTA / SOTA */}
          {config.panels?.pota?.visible !== false && (
            <div style={{ flex: `${config.panels.pota?.size || 1} 0 auto`, minHeight: '60px', maxHeight: '120px', overflow: 'hidden' }}>
              <PotaSotaPanel
                potaData={potaSpots.data}
                potaLoading={potaSpots.loading}
                showPOTA={mapLayers.showPOTA}
                onTogglePOTA={togglePOTA}
                sotaData={sotaSpots.data}
                sotaLoading={sotaSpots.loading}
                showSOTA={mapLayers.showSOTA}
                onToggleSOTA={toggleSOTA}
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
