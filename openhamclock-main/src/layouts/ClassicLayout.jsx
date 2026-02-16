/**
 * Classic HamClock-style layout
 */
import { DXNewsTicker, WorldMap } from '../components';
import { getBandColor } from '../utils';
import CallsignLink from '../components/CallsignLink.jsx';

export default function ClassicLayout(props) {
  const {
    config,
    t,
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
    dxClusterData,
    hoveredSpot,
    setHoveredSpot,
    dxLocation,
    dxLocked,
    handleDXChange,
    handleToggleDxLock,
    deGrid,
    dxGrid,
    deSunTimes,
    dxSunTimes,
    tempUnit,
    setTempUnit,
    showDxWeather,
    localWeather,
    spaceWeather,
    solarIndices,
    bandConditions,
    propagation,
    potaSpots,
    sotaSpots,
    mySpots,
    satellites,
    filteredSatellites,
    mapLayers,
    dxFilters,
    filteredPskSpots,
    wsjtxMapSpots,
    toggleDXLabels,
    toggleSatellites,
  } = props;

  return config.layout === 'classic' ? (
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
            title={t('app.settings.click')}
          >
            {config.callsign}
          </div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
            {t('app.uptime', { uptime, version: 'v4.20' })}
          </div>
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '36px', fontWeight: '700', color: '#00ff00', fontFamily: 'JetBrains Mono, Consolas, monospace', lineHeight: 1, width: '180px' }}>
              {utcTime}<span style={{ fontSize: '20px', color: '#00cc00' }}>:{String(new Date().getUTCSeconds()).padStart(2, '0')}</span>
            </div>
            <div style={{ fontSize: '14px', color: '#00cc00', marginTop: '2px' }}>
              {utcDate} <span style={{ color: '#666', marginLeft: '8px' }}>{t('app.time.utc')}</span>
            </div>
          </div>
        </div>

        {/* Solar Indices - SSN & SFI */}
        <div style={{ display: 'flex', borderRight: '1px solid #333' }}>
          {/* SSN */}
          <div style={{ flex: 1, padding: '8px', borderRight: '1px solid #333' }}>
            <div style={{ fontSize: '10px', color: '#888', textAlign: 'center' }}>{t('app.solar.sunspotNumber')}</div>
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
            <div style={{ fontSize: '10px', color: '#666', textAlign: 'center', marginTop: '2px' }}>{t('app.solar.last30Days')}</div>
          </div>

          {/* SFI */}
          <div style={{ flex: 1, padding: '8px' }}>
            <div style={{ fontSize: '10px', color: '#888', textAlign: 'center' }}>{t('app.solar.solarFlux')}</div>
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
            <div style={{ fontSize: '10px', color: '#666', textAlign: 'center', marginTop: '2px' }}>{t('app.solar.last30DaysPlus7')}</div>
          </div>
        </div>

        {/* Live Spots & Indices */}
        <div style={{ display: 'flex' }}>
          {/* Live Spots by Band */}
          <div style={{ flex: 1, padding: '8px', borderRight: '1px solid #333' }}>
            <div style={{ fontSize: '12px', color: '#ff6666', fontWeight: '700' }}>{t('app.liveSpots.title')}</div>
            <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>
              {t('app.liveSpots.ofGridLastMinutes', { grid: deGrid, minutes: 15 })}
            </div>
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
              <div style={{ color: '#888' }}>{t('app.spaceWeather.xray')}</div>
              <div style={{ color: '#ffff00', fontSize: '16px', fontWeight: '700' }}>M3.0</div>
            </div>
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: '#888' }}>{t('app.spaceWeather.kp')}</div>
              <div style={{ color: '#00ff00', fontSize: '16px', fontWeight: '700' }}>{solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}</div>
            </div>
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: '#888' }}>{t('app.spaceWeather.bz')}</div>
              <div style={{ color: '#00ffff', fontSize: '16px', fontWeight: '700' }}>-0</div>
            </div>
            <div>
              <div style={{ color: '#888' }}>{t('app.spaceWeather.aurora')}</div>
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
            <span style={{ color: '#ff6666', fontSize: '14px', fontWeight: '700' }}>{t('app.dxCluster.shortTitle')}</span>
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
                onClick={() => {
                  const path = (dxClusterData.paths || []).find(p => p.dxCall === spot.call);
                  if (path && path.dxLat != null && path.dxLon != null) {
                    handleDXChange({ lat: path.dxLat, lon: path.dxLon });
                  }
                }}
              >
                <span style={{ color: '#ffff00' }}>{(() => { const f = parseFloat(spot.freq); return f > 1000 ? (f/1000).toFixed(3) : f.toFixed(3); })()}</span>
                <span style={{ color: '#00ffff' }}><CallsignLink call={spot.call} color="#00ffff" /></span>
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

          {/* Map overlay buttons — bottom-left to avoid WorldMap's SAT/CALLS buttons at top */}
          <div style={{
            position: 'absolute',
            bottom: '54px',
            left: '10px',
            display: 'flex',
            gap: '6px',
            zIndex: 1000
          }}>
            <button
              onClick={() => setShowSettings(true)}
              style={{
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

            <button
              onClick={handleToggleDxLock}
              title={dxLocked ? t('app.dxLock.unlockTooltip') : t('app.dxLock.lockTooltip')}
              style={{
                background: dxLocked ? 'rgba(255,180,0,0.9)' : 'rgba(0,0,0,0.7)',
                border: '1px solid #444',
                color: dxLocked ? '#000' : '#fff',
                padding: '6px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                borderRadius: '4px'
              }}
            >
              {dxLocked ? t('app.dxLock.locked') : t('app.dxLock.unlocked')}
            </button>
          </div>
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
        <span>{t('app.units.mhz')}</span>
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
          title={t('app.settings.title')}
        >
          {config.callsign}
        </span>

        {/* UTC */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: '600' }}>{t('app.time.utc')}</span>
          <span style={{ fontSize: '24px', fontWeight: '700', color: 'var(--accent-cyan)' }}>{utcTime}</span>
        </div>

        {/* Local */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          onClick={handleTimeFormatToggle}
          title={t('app.time.toggleFormat', { format: use12Hour ? '24h' : '12h' })}
        >
          <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: '600' }}>{t('app.time.locShort')}</span>
          <span style={{ fontSize: '24px', fontWeight: '700', color: 'var(--accent-amber)' }}>{localTime}</span>
        </div>

        {/* Solar Quick Stats */}
        <div style={{ display: 'flex', gap: '10px', fontSize: '15px', whiteSpace: 'nowrap' }}>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.sfiShort')} </span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: '700' }}>{solarIndices?.data?.sfi?.current || spaceWeather?.data?.solarFlux || '--'}</span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.kpShort')} </span>
            <span style={{ color: parseInt(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex) >= 4 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: '700' }}>
              {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
            </span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.ssnShort')} </span>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{solarIndices?.data?.ssn?.current || '--'}</span>
          </span>
          {bandConditions?.extras?.aIndex && (
            <span>
              <span style={{ color: 'var(--text-muted)' }}>A </span>
              <span style={{ color: parseInt(bandConditions.extras.aIndex) >= 20 ? 'var(--accent-red)' : parseInt(bandConditions.extras.aIndex) >= 10 ? 'var(--accent-amber)' : 'var(--accent-green)', fontWeight: '700' }}>
                {bandConditions.extras.aIndex}
              </span>
            </span>
          )}
          {bandConditions?.extras?.geomagField && (
            <span style={{ 
              fontSize: '12px',
              color: bandConditions.extras.geomagField === 'QUIET' ? 'var(--accent-green)' : 
                     bandConditions.extras.geomagField === 'ACTIVE' || bandConditions.extras.geomagField.includes('STORM') ? 'var(--accent-red)' : 
                     'var(--accent-amber)',
              fontWeight: '600'
            }}>
              {bandConditions.extras.geomagField}
            </span>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {!isFullscreen && (
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
              title={t('app.donate.paypal')}
            >💳</a>
          )}
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
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
          units={config.units}
          />
          {/* DX Lock button overlay — bottom-left to avoid WorldMap's SAT/CALLS buttons at top */}
          <button
            onClick={handleToggleDxLock}
            title={dxLocked ? t('app.dxLock.unlockTooltip') : t('app.dxLock.lockTooltip')}
            style={{
              position: 'absolute',
              bottom: '40px',
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
            {dxLocked ? t('app.dxLock.locked') : t('app.dxLock.unlocked')}
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
            <div style={{ fontSize: '13px', color: 'var(--accent-amber)', fontWeight: '700', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {t('band.conditions')}
            </div>
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
                <span><span style={{ color: 'var(--text-muted)' }}>{t('app.propagation.muf')} </span><span style={{ color: '#ff8800', fontWeight: '700' }}>{propagation.data.muf || '?'}</span></span>
                <span><span style={{ color: 'var(--text-muted)' }}>{t('app.propagation.luf')} </span><span style={{ color: '#00aaff', fontWeight: '700' }}>{propagation.data.luf || '?'}</span></span>
              </div>
            )}
          </div>

          {/* Compact DX Cluster */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: 'var(--accent-red)', fontWeight: '700', textTransform: 'uppercase' }}>{t('app.dxCluster.title')}</span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {t('app.dxCluster.spotsCount', { count: dxClusterData.spots?.length || 0 })}
              </span>
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
                  onClick={() => {
                    const path = (dxClusterData.paths || []).find(p => p.dxCall === spot.call);
                    if (path && path.dxLat != null && path.dxLon != null) {
                      handleDXChange({ lat: path.dxLat, lon: path.dxLon });
                    }
                  }}
                >
                  <span style={{ color: getBandColor(parseFloat(spot.freq) > 1000 ? parseFloat(spot.freq)/1000 : parseFloat(spot.freq)), fontWeight: '700' }}>{(() => { const f = parseFloat(spot.freq); return f > 1000 ? (f/1000).toFixed(3) : f.toFixed(3); })()}</span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><CallsignLink call={spot.call} color="var(--accent-cyan)" fontWeight="600" /></span>
                  <span style={{ color: 'var(--text-muted)', textAlign: 'right', fontSize: '12px' }}>{spot.time || '--'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* DX News - sidebar footer */}
          {mapLayers.showDXNews && (
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
          )}
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
            title={t('app.settings.title')}
          >
            {config.callsign}
          </span>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>{t('app.time.utc')}</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--accent-cyan)', lineHeight: 1 }}>{utcTime}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{utcDate}</div>
            </div>
            <div
              style={{ textAlign: 'center', cursor: 'pointer' }}
              onClick={handleTimeFormatToggle}
              title={t('app.time.toggleFormat', { format: use12Hour ? '24h' : '12h' })}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>{t('app.time.local')}</div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: 'var(--accent-amber)', lineHeight: 1 }}>{localTime}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{localDate}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {!isFullscreen && (
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
                title={t('app.donate.paypal')}
              >💳</a>
            )}
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
        <div style={{ display: 'flex', gap: '16px', fontSize: '15px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.sfiShort')} </span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: '700' }}>{solarIndices?.data?.sfi?.current || spaceWeather?.data?.solarFlux || '--'}</span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.kpShort')} </span>
            <span style={{ color: parseInt(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex) >= 4 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: '700' }}>
              {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
            </span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.ssnShort')} </span>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{solarIndices?.data?.ssn?.current || '--'}</span>
          </span>
          {bandConditions?.extras?.aIndex && (
            <span>
              <span style={{ color: 'var(--text-muted)' }}>A </span>
              <span style={{ color: parseInt(bandConditions.extras.aIndex) >= 20 ? 'var(--accent-red)' : parseInt(bandConditions.extras.aIndex) >= 10 ? 'var(--accent-amber)' : 'var(--accent-green)', fontWeight: '700' }}>
                {bandConditions.extras.aIndex}
              </span>
            </span>
          )}
          {bandConditions?.extras?.geomagField && (
            <span style={{ 
              fontSize: '12px',
              color: bandConditions.extras.geomagField === 'QUIET' ? 'var(--accent-green)' : 
                     bandConditions.extras.geomagField === 'ACTIVE' || bandConditions.extras.geomagField.includes('STORM') ? 'var(--accent-red)' : 
                     'var(--accent-amber)',
              fontWeight: '600'
            }}>
              {bandConditions.extras.geomagField}
            </span>
          )}
          {propagation.data && (
            <>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>{t('app.propagation.muf')} </span>
                <span style={{ color: '#ff8800', fontWeight: '600' }}>{propagation.data.muf || '?'} {t('app.units.mhz')}</span>
              </span>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>{t('app.propagation.luf')} </span>
                <span style={{ color: '#00aaff', fontWeight: '600' }}>{propagation.data.luf || '?'} {t('app.units.mhz')}</span>
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
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
          units={config.units}
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
            <span>{deGrid} → {dxGrid} • {dxLocked ? t('app.dxLock.lockedShort') : t('app.dxLock.clickToSet')}</span>
            <button
              onClick={handleToggleDxLock}
              title={dxLocked ? t('app.dxLock.unlockShort') : t('app.dxLock.lockShort')}
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
            <span style={{ fontSize: '14px', color: 'var(--accent-red)', fontWeight: '700', textTransform: 'uppercase' }}>{t('app.dxCluster.title')}</span>
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
                onClick={() => {
                  const path = (dxClusterData.paths || []).find(p => p.dxCall === spot.call);
                  if (path && path.dxLat != null && path.dxLon != null) {
                    handleDXChange({ lat: path.dxLat, lon: path.dxLon });
                  }
                }}
              >
                <span style={{ color: getBandColor(parseFloat(spot.freq) > 1000 ? parseFloat(spot.freq)/1000 : parseFloat(spot.freq)), fontWeight: '700' }}>{(() => { const f = parseFloat(spot.freq); return f > 1000 ? (f/1000).toFixed(3) : f.toFixed(3); })()}</span>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><CallsignLink call={spot.call} color="var(--accent-cyan)" fontWeight="600" /></span>
                <span style={{ color: 'var(--text-muted)', textAlign: 'right', fontSize: '12px' }}>{spot.time || '--'}</span>
              </div>
            ))}
          </div>

          {/* DX News - sidebar footer */}
          {mapLayers.showDXNews && (
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
          )}
        </div>
      </div>
    </div>
  ) : null;
}
