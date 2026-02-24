/**
 * Modern layout — fully responsive.
 *
 * Desktop (>1024px):  Header | Left sidebar | Map | Right sidebar
 *                     Sidebars scale proportionally with viewport width:
 *                       Left:  clamp(260px, 18vw, 480px)
 *                       Right: clamp(280px, 20vw, 500px)
 *                     e.g. at 1440px → 260/288px; 1920px → 345/384px; 2560px → 460/500px
 * Tablet (768–1024):  Header | Map (full width) | Panels in 2-col grid
 * Mobile (<768):      Compact header | Map | Panels stacked one per row, scroll
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
  AnalogClockPanel,
} from '../components';
import { useRig } from '../contexts/RigContext.jsx';
import useBreakpoint from '../hooks/app/useBreakpoint';

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
    wwffSpots,
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
    mapBandFilter,
    setMapBandFilter,
    pskFilters,
    setShowDXFilters,
    setShowPSKFilters,
    mapLayers,
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    toggleWWFF,
    toggleSOTA,
    toggleSatellites,
    togglePSKReporter,
    toggleWSJTX,
    hoveredSpot,
    setHoveredSpot,
    filteredSatellites,
  } = props;

  const { tuneTo } = useRig();
  const { breakpoint, width } = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';
  const isDesktop = breakpoint === 'desktop';

  const handleParkSpotClick = (spot) => tuneTo(spot);
  const handleDXSpotClick = (spot) => {
    tuneTo(spot);
    const path = (dxClusterData.paths || []).find((p) => p.dxCall === spot.call);
    if (path && path.dxLat != null && path.dxLon != null) {
      handleDXChange({ lat: path.dxLat, lon: path.dxLon });
    }
  };

  const tempUnitToggle = (unit) => {
    setTempUnit(unit);
    try {
      localStorage.setItem('openhamclock_tempUnit', unit);
    } catch {}
  };

  // ─── Shared map component ───
  const mapComponent = (style) => (
    <div style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', ...style }}>
      <WorldMap
        deLocation={config.location}
        dxLocation={dxLocation}
        onDXChange={handleDXChange}
        dxLocked={dxLocked}
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
        showDXPaths={mapLayers.showDXPaths}
        showDXLabels={mapLayers.showDXLabels}
        onToggleDXLabels={toggleDXLabels}
        showPOTA={mapLayers.showPOTA}
        showWWFF={mapLayers.showWWFF}
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
        mouseZoom={config.mouseZoom}
        onSpotClick={tuneTo}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '13px',
          color: 'var(--text-muted)',
          background: 'rgba(0,0,0,0.7)',
          padding: '2px 8px',
          borderRadius: '4px',
        }}
      >
        {t('app.callsign', { callsign: config.callsign })}
      </div>
    </div>
  );

  // ─── Shared panel: DE location + weather ───
  const deLocationPanel = (
    <div className="panel" style={{ padding: isMobile ? '10px' : '14px', flex: '0 0 auto' }}>
      <div style={{ fontSize: '14px', color: 'var(--accent-cyan)', fontWeight: '700', marginBottom: '10px' }}>
        {t('app.dxLocation.deTitle')}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px' }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '22px', fontWeight: '700', letterSpacing: '1px' }}>
          {deGrid}
        </div>
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
      <WeatherPanel weatherData={localWeather} tempUnit={tempUnit} onTempUnitChange={tempUnitToggle} />
    </div>
  );

  // ─── Shared panel: DX location ───
  const dxLocationPanel = (
    <div className="panel" style={{ padding: isMobile ? '10px' : '14px', flex: '0 0 auto' }}>
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
            cursor: 'pointer',
          }}
        >
          {dxLocked ? '🔒' : '🔓'}
        </button>
      </div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: '14px' }}>
        <div style={{ color: 'var(--accent-green)', fontSize: '22px', fontWeight: '700', letterSpacing: '1px' }}>
          {dxGrid}
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
          {dxLocation.lat.toFixed(4)}°, {dxLocation.lon.toFixed(4)}°
        </div>
        <div style={{ marginTop: '8px', display: 'flex', gap: '16px', fontSize: '13px' }}>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.dxLocation.beamDir')} </span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>
              {t('app.dxLocation.sp')}{' '}
              {(() => {
                const dLon = ((dxLocation.lon - config.location.lon) * Math.PI) / 180;
                const dLat1 = (config.location.lat * Math.PI) / 180;
                const dLat2 = (dxLocation.lat * Math.PI) / 180;
                const y = Math.sin(dLon) * Math.cos(dLat2);
                const x = Math.cos(dLat1) * Math.sin(dLat2) - Math.sin(dLat1) * Math.cos(dLat2) * Math.cos(dLon);
                return `${Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)}°`;
              })()}
            </span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.dxLocation.sp')} </span>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>
              {(() => {
                const R = 6371;
                const dLat1 = (config.location.lat * Math.PI) / 180;
                const dLon1 = (config.location.lon * Math.PI) / 180;
                const dLat2 = (dxLocation.lat * Math.PI) / 180;
                const dLon2 = (dxLocation.lon * Math.PI) / 180;
                const dLat = dLat2 - dLat1;
                const dLon = dLon2 - dLon1;
                const a = Math.sin(dLat / 2) ** 2 + Math.cos(dLat1) * Math.cos(dLat2) * Math.sin(dLon / 2) ** 2;
                return `📏 ${Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toLocaleString()} km`;
              })()}
            </span>
          </span>
        </div>
        <div style={{ marginTop: '8px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>☀ </span>
          <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{dxSunTimes.sunrise}</span>
          <span style={{ color: 'var(--text-secondary)' }}> → </span>
          <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{dxSunTimes.sunset}</span>
        </div>
      </div>
      {showDxWeather && <WeatherPanel weatherData={dxWeather} tempUnit={tempUnit} onTempUnitChange={tempUnitToggle} />}
    </div>
  );

  // ─── Shared DX Cluster panel ───
  const dxCluster = config.panels?.dxCluster?.visible !== false && (
    <DXClusterPanel
      data={dxClusterData.spots}
      loading={dxClusterData.loading}
      totalSpots={dxClusterData.totalSpots}
      filters={dxFilters}
      onFilterChange={setDxFilters}
      onOpenFilters={() => setShowDXFilters(true)}
      onHoverSpot={setHoveredSpot}
      onSpotClick={handleDXSpotClick}
      hoveredSpot={hoveredSpot}
      showOnMap={mapLayers.showDXPaths}
      onToggleMap={toggleDXPaths}
    />
  );

  const pskPanel = config.panels?.pskReporter?.visible !== false && (
    <PSKReporterPanel
      callsign={config.callsign}
      pskReporter={pskReporter}
      showOnMap={mapLayers.showPSKReporter}
      onToggleMap={togglePSKReporter}
      filters={pskFilters}
      onOpenFilters={() => setShowPSKFilters(true)}
      onShowOnMap={(r) => {
        if (r.lat && r.lon) handleDXChange({ lat: r.lat, lon: r.lon });
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
  );

  const potaSotaPanel = config.panels?.pota?.visible !== false && (
    <PotaSotaPanel
      potaData={potaSpots.data}
      potaLoading={potaSpots.loading}
      potaLastUpdated={potaSpots.lastUpdated}
      potaLastChecked={potaSpots.lastChecked}
      showPOTA={mapLayers.showPOTA}
      onTogglePOTA={togglePOTA}
      sotaData={sotaSpots.data}
      sotaLoading={sotaSpots.loading}
      sotaLastUpdated={sotaSpots.lastUpdated}
      sotaLastChecked={sotaSpots.lastChecked}
      showSOTA={mapLayers.showSOTA}
      onToggleSOTA={toggleSOTA}
      wwffData={wwffSpots.data}
      wwffLoading={wwffSpots.loading}
      wwffLastUpdated={wwffSpots.lastUpdated}
      wwffLastChecked={wwffSpots.lastChecked}
      showWWFF={mapLayers.showWWFF}
      onToggleWWFF={toggleWWFF}
      onPOTASpotClick={handleParkSpotClick}
      onWWFFSpotClick={handleParkSpotClick}
      onSOTASpotClick={handleParkSpotClick}
    />
  );

  const headerEl = (
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
      breakpoint={breakpoint}
    />
  );

  /* ═══════════════════════════════════════════════════════════════
     MOBILE (<768px) — stacked modules, one at a time, scroll down
     ═══════════════════════════════════════════════════════════════ */
  if (isMobile) {
    // Each module gets a "card" wrapper for consistent full-width stacking
    const mobileCard = (child, key, opts = {}) => (
      <div key={key} style={{ width: '100%', minHeight: opts.minH || 'auto', flexShrink: 0 }}>
        {child}
      </div>
    );

    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Sticky header */}
        <div style={{ flexShrink: 0, padding: '4px' }}>{headerEl}</div>

        {/* Scrollable body — full-width stacked modules */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            scrollSnapType: 'y proximity',
            padding: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {/* Map — full viewport width, 60% of remaining height */}
          {mapComponent({ width: '100%', height: '60vh', minHeight: '240px', flexShrink: 0 })}

          {/* DE Location */}
          {mobileCard(deLocationPanel, 'de')}

          {/* DX Location */}
          {mobileCard(dxLocationPanel, 'dx')}

          {/* DX Cluster — give it room to show spots */}
          {dxCluster && mobileCard(dxCluster, 'dxc', { minH: '280px' })}

          {/* PSK Reporter */}
          {pskPanel && mobileCard(pskPanel, 'psk', { minH: '250px' })}

          {/* Solar */}
          {config.panels?.solar?.visible !== false && mobileCard(<SolarPanel solarIndices={solarIndices} />, 'solar')}

          {/* Propagation */}
          {config.panels?.propagation?.visible !== false &&
            mobileCard(
              <PropagationPanel
                propagation={propagation.data}
                loading={propagation.loading}
                bandConditions={bandConditions}
                units={config.units}
                propConfig={config.propagation}
              />,
              'prop',
            )}

          {/* DXpeditions */}
          {config.panels?.dxpeditions?.visible !== false &&
            mobileCard(<DXpeditionPanel data={dxpeditions.data} loading={dxpeditions.loading} />, 'dxped')}

          {/* POTA/SOTA/WWFF */}
          {potaSotaPanel && mobileCard(potaSotaPanel, 'pota')}

          {/* Contests */}
          {config.panels?.contests?.visible !== false &&
            mobileCard(<ContestPanel data={contests.data} loading={contests.loading} />, 'contests')}

          {/* Bottom breathing room so last panel can scroll fully into view */}
          <div style={{ height: '20px', flexShrink: 0 }} />
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     TABLET (768–1024px) — map on top, panels in 2-col grid below
     ═══════════════════════════════════════════════════════════════ */
  if (isTablet) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '4px 6px' }}>{headerEl}</div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {/* Map — full width, prominent */}
          {mapComponent({ width: '100%', height: '45vh', minHeight: '280px', flexShrink: 0 })}

          {/* Panels — 2-column grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {deLocationPanel}
              {dxLocationPanel}
              {config.panels?.solar?.visible !== false && <SolarPanel solarIndices={solarIndices} />}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {dxCluster && <div style={{ minHeight: '200px', flex: '2 1 auto', overflow: 'hidden' }}>{dxCluster}</div>}
              {pskPanel && <div style={{ minHeight: '160px', flex: '1 1 auto', overflow: 'hidden' }}>{pskPanel}</div>}
              {config.panels?.dxpeditions?.visible !== false && (
                <DXpeditionPanel data={dxpeditions.data} loading={dxpeditions.loading} />
              )}
              {potaSotaPanel}
              {config.panels?.contests?.visible !== false && (
                <ContestPanel data={contests.data} loading={contests.loading} />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     DESKTOP (>1024px) — 3-column: left sidebar | map | right sidebar
     Sidebars scale proportionally with viewport width so ultra-wide
     monitors get wider panels instead of an oversized map.
     ═══════════════════════════════════════════════════════════════ */
  // Proportional sidebar widths that grow with viewport
  // clamp(min, preferred, max) — sidebars take ~18-22% of viewport each
  const leftW = leftSidebarVisible ? 'clamp(260px, 18vw, 480px)' : '0px';
  const rightW = rightSidebarVisible ? 'clamp(280px, 20vw, 500px)' : '0px';

  const getGridCols = () => {
    if (!leftSidebarVisible && !rightSidebarVisible) return '1fr';
    if (!leftSidebarVisible) return `1fr ${rightW}`;
    if (!rightSidebarVisible) return `${leftW} 1fr`;
    return `${leftW} 1fr ${rightW}`;
  };

  return (
    <div
      style={{
        width: scale < 1 ? `${100 / scale}vw` : '100vw',
        height: scale < 1 ? `${100 / scale}vh` : '100vh',
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        display: 'grid',
        gridTemplateColumns: getGridCols(),
        gridTemplateRows: 'auto 1fr',
        gap: leftSidebarVisible || rightSidebarVisible ? '8px' : '0',
        padding: leftSidebarVisible || rightSidebarVisible ? '8px' : '0',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {headerEl}

      {/* LEFT SIDEBAR */}
      {leftSidebarVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', overflowX: 'hidden' }}>
          {config.panels?.deLocation?.visible !== false && deLocationPanel}
          {config.panels?.dxLocation?.visible !== false && dxLocationPanel}
          {classicAnalogClock && (
            <div className="panel" style={{ flex: '0 0 auto', minHeight: '200px' }}>
              <AnalogClockPanel currentTime={currentTime} sunTimes={deSunTimes} />
            </div>
          )}
          {config.panels?.solar?.visible !== false && <SolarPanel solarIndices={solarIndices} />}
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
      {mapComponent({ width: '100%', height: '100%', minWidth: 0 })}

      {/* RIGHT SIDEBAR — panels flex to fill available height evenly */}
      {rightSidebarVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
          {dxCluster && (
            <div style={{ flex: `${config.panels?.dxCluster?.size || 3} 1 0`, minHeight: '140px', overflow: 'hidden' }}>
              {dxCluster}
            </div>
          )}
          {pskPanel && (
            <div
              style={{ flex: `${config.panels?.pskReporter?.size || 2} 1 0`, minHeight: '120px', overflow: 'hidden' }}
            >
              {pskPanel}
            </div>
          )}
          {config.panels?.dxpeditions?.visible !== false && (
            <div
              style={{ flex: `${config.panels?.dxpeditions?.size || 1} 1 0`, minHeight: '60px', overflow: 'hidden' }}
            >
              <DXpeditionPanel data={dxpeditions.data} loading={dxpeditions.loading} />
            </div>
          )}
          {potaSotaPanel && (
            <div style={{ flex: `${config.panels?.pota?.size || 1} 1 0`, minHeight: '60px', overflow: 'hidden' }}>
              {potaSotaPanel}
            </div>
          )}
          {config.panels?.contests?.visible !== false && (
            <div style={{ flex: `${config.panels?.contests?.size || 1} 1 0`, minHeight: '60px', overflow: 'hidden' }}>
              <ContestPanel data={contests.data} loading={contests.loading} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
