/**
 * Classic HamClock-style layout — faithful WB0OEW HamClock recreation
 */
import React, { useState, useEffect, useCallback } from 'react';
import { DXNewsTicker, WorldMap } from '../components';
import { DXGridInput } from '../components/DXGridInput.jsx';
import { DXFavorites } from '../components/DXFavorites.jsx';
import { getBandColor, getBandColorForBand } from '../utils';
import { calculateBearing, calculateDistance, formatDistance } from '../utils/geo.js';
import { findDXPathForSpot, matchesDXSpotPath } from '../utils/dxClusterSpotMatcher';
import CallsignLink from '../components/CallsignLink.jsx';
import DonateButton from '../components/DonateButton.jsx';
import { useRig } from '../contexts/RigContext.jsx';

/**
 * RotatingPane — cycles through views on a timer, click to advance
 */
function RotatingPane({ views, interval = 15000 }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (views.length <= 1) return;
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % views.length);
    }, interval);
    return () => clearInterval(timer);
  }, [views.length, interval]);

  const advance = useCallback(() => {
    setIdx((i) => (i + 1) % views.length);
  }, [views.length]);

  const view = views[idx];
  if (!view) return null;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
      onClick={advance}
    >
      {/* Header with label + dot indicators */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '3px 6px',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '14px', color: '#ffff00', fontWeight: '700', textTransform: 'uppercase' }}>
          {view.label}
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {views.map((_, i) => (
            <div
              key={i}
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: i === idx ? '#ffff00' : '#444',
              }}
            />
          ))}
        </div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '4px 6px' }}>{view.render()}</div>
    </div>
  );
}

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
    dxCallsign,
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
    wwbotaSpots,
    mySpots,
    satellites,
    filteredSatellites,
    mapLayers,
    dxFilters,
    mapBandFilter,
    setMapBandFilter,
    filteredPskSpots,
    wsjtxMapSpots,
    toggleDXLabels,
    toggleSatellites,
    toggleDXPaths,
    togglePOTA,
    toggleSOTA,
    toggleWWBOTA,
    togglePSKReporter,
    toggleWSJTX,
    toggleDXNews,
    toggleAPRS,
    contests,
    dxpeditions,
    filteredPotaSpots,
    filteredSotaSpots,
  } = props;

  const mapLegendBands = ['160', '80', '40', '30', '20', '17', '15', '12', '10', '8', '6', '4'];

  const { tuneTo } = useRig();

  // Seconds ticker for UTC clock
  const [seconds, setSeconds] = useState(() => String(new Date().getUTCSeconds()).padStart(2, '0'));
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(String(new Date().getUTCSeconds()).padStart(2, '0'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Handler for spot clicks — tune radio + move DX marker
  const handleSpotClick = useCallback(
    (spot) => {
      tuneTo(spot);
      const path = findDXPathForSpot(dxClusterData.paths || [], spot);
      if (path && path.dxLat != null && path.dxLon != null) {
        handleDXChange({ lat: path.dxLat, lon: path.dxLon, callsign: spot.call ?? spot.dxCall ?? null });
      }
    },
    [tuneTo, dxClusterData.paths, handleDXChange],
  );

  // Handler for POTA/WWFF/SOTA spot clicks
  const handleParkSpotClick = (spot) => {
    tuneTo(spot);
    if (spot.lat != null && spot.lon != null) {
      handleDXChange({ lat: spot.lat, lon: spot.lon, callsign: spot.call ?? null });
    }
  };

  // Kp color coding
  const kpColor = (val) => {
    const n = parseFloat(val);
    if (isNaN(n)) return '#888';
    if (n >= 6) return '#ff4444';
    if (n >= 4) return '#ffff00';
    return '#00ff00';
  };

  // Geomag field color
  const geomagColor = (field) => {
    if (!field) return '#888';
    if (field === 'QUIET') return '#00ff00';
    if (field === 'UNSETTLED') return '#ffff00';
    return '#ff4444';
  };

  // Band condition colors
  const condColor = (cond) => {
    if (cond === 'GOOD') return '#00ff88';
    if (cond === 'FAIR') return '#ffb432';
    return '#ff4466';
  };

  // Format frequency for display
  const fmtFreq = (freq) => {
    const f = parseFloat(freq);
    return f > 1000 ? (f / 1000).toFixed(3) : f.toFixed(3);
  };

  // Format sun times — calculateSunTimes returns pre-formatted "HH:MM" strings
  const fmtSunTime = (val) => val || '--:--';

  // DE/DX bearing & distance
  const deLat = config.location?.lat;
  const deLon = config.location?.lon;
  const dxLat = dxLocation?.lat;
  const dxLon = dxLocation?.lon;
  const bearing = deLat != null && dxLat != null ? Math.round(calculateBearing(deLat, deLon, dxLat, dxLon)) : null;
  const distKm = deLat != null && dxLat != null ? calculateDistance(deLat, deLon, dxLat, dxLon) : null;
  const distStr =
    distKm != null ? formatDistance(distKm, config.allUnits === 'imperial' ? 'imperial' : 'metric') : '--';

  // Map layer toggle button style
  const layerBtnStyle = (active) => ({
    background: active ? 'rgba(0,255,0,0.15)' : 'rgba(0,0,0,0.6)',
    border: `1px solid ${active ? '#00ff00' : '#555'}`,
    color: active ? '#00ff00' : '#666',
    padding: '3px 6px',
    fontSize: '11px',
    cursor: 'pointer',
    borderRadius: '2px',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: '700',
  });

  // === Build rotating pane views ===

  // Pane 1: DX Cluster, POTA, SOTA, DXpeditions
  const pane1Views = [
    {
      label: 'DX Cluster',
      render: () => (
        <div style={{ fontSize: '13px', overflow: 'auto', height: '100%' }}>
          {dxClusterData.spots?.slice(0, 10).map((spot, i) => (
            <div
              key={i}
              style={{
                padding: '2px 0',
                borderBottom: '1px solid #111',
                cursor: 'pointer',
                background: matchesDXSpotPath(hoveredSpot, spot) ? '#222' : 'transparent',
              }}
              onMouseEnter={() => setHoveredSpot(spot)}
              onMouseLeave={() => setHoveredSpot(null)}
              onClick={(e) => {
                e.stopPropagation();
                handleSpotClick(spot);
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <span style={{ color: '#ffff00' }}>{fmtFreq(spot.freq)}</span>
                  <span style={{ color: '#00ffff', marginLeft: '6px' }}>
                    <CallsignLink call={spot.call} color="#00ffff" />
                  </span>
                </span>
                <span style={{ color: '#aaa', fontSize: '11px' }}>{spot.time || ''}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '1px' }}>
                <span
                  style={{
                    color: '#666',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '70%',
                  }}
                >
                  {spot.comment || ''}
                </span>
                {spot.spotter && (
                  <span style={{ color: '#555' }}>
                    de <CallsignLink call={spot.spotter} color="#555" />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      label: 'POTA',
      render: () => (
        <div style={{ fontSize: '13px', overflow: 'auto', height: '100%' }}>
          {(filteredPotaSpots || potaSpots?.data || []).slice(0, 8).map((spot, i) => (
            <div
              key={i}
              style={{
                padding: '2px 0',
                borderBottom: '1px solid #111',
                cursor: 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleParkSpotClick(spot);
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <span style={{ color: '#00ff00' }}>
                    <CallsignLink call={spot.activator || spot.call} color="#00ff00" />
                  </span>
                  <span style={{ color: '#ffff00', marginLeft: '6px' }}>
                    {spot.frequency ? fmtFreq(spot.frequency) : spot.freq ? fmtFreq(spot.freq) : ''}
                  </span>
                  {spot.mode && <span style={{ color: '#888', marginLeft: '4px' }}>{spot.mode}</span>}
                </span>
                <span style={{ color: '#aaa', fontSize: '11px' }}>{spot.time || ''}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '1px' }}>
                <span style={{ color: '#22c55e' }}>{spot.ref || spot.reference || ''}</span>
                <span
                  style={{
                    color: '#666',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '60%',
                    textAlign: 'right',
                  }}
                >
                  {spot.name || spot.locationDesc || ''}
                </span>
              </div>
            </div>
          ))}
          {(filteredPotaSpots || potaSpots?.data || []).length === 0 && (
            <div style={{ color: '#777', textAlign: 'center', marginTop: '8px' }}>No POTA activations</div>
          )}
        </div>
      ),
    },
    {
      label: 'SOTA',
      render: () => (
        <div style={{ fontSize: '13px', overflow: 'auto', height: '100%' }}>
          {(filteredSotaSpots || sotaSpots?.data || []).slice(0, 8).map((spot, i) => (
            <div
              key={i}
              style={{
                padding: '2px 0',
                borderBottom: '1px solid #111',
                cursor: 'pointer',
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleParkSpotClick(spot);
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <span style={{ color: '#ff66ff' }}>
                    <CallsignLink call={spot.activator || spot.call} color="#ff66ff" />
                  </span>
                  <span style={{ color: '#ffff00', marginLeft: '6px' }}>
                    {spot.frequency ? fmtFreq(spot.frequency) : spot.freq ? fmtFreq(spot.freq) : ''}
                  </span>
                  {spot.mode && <span style={{ color: '#888', marginLeft: '4px' }}>{spot.mode}</span>}
                </span>
                <span style={{ color: '#aaa', fontSize: '11px' }}>{spot.time || ''}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '1px' }}>
                <span style={{ color: '#c084fc' }}>{spot.ref || spot.reference || ''}</span>
                <span
                  style={{
                    color: '#666',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '60%',
                    textAlign: 'right',
                  }}
                >
                  {spot.summit || spot.name || ''}
                  {spot.points ? ` (${spot.points}pt)` : ''}
                </span>
              </div>
            </div>
          ))}
          {(filteredSotaSpots || sotaSpots?.data || []).length === 0 && (
            <div style={{ color: '#777', textAlign: 'center', marginTop: '8px' }}>No SOTA activations</div>
          )}
        </div>
      ),
    },
    {
      label: 'DXpeditions',
      render: () => (
        <div style={{ fontSize: '13px', overflow: 'auto', height: '100%' }}>
          {(dxpeditions?.data?.dxpeditions || []).slice(0, 8).map((dx, i) => (
            <div
              key={i}
              style={{
                padding: '3px 0',
                borderBottom: '1px solid #111',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <CallsignLink call={dx.callsign} color="#ff8800" />
                  {dx.isActive && (
                    <span style={{ color: '#22c55e', marginLeft: '6px', fontSize: '10px', fontWeight: 700 }}>
                      ACTIVE
                    </span>
                  )}
                  {dx.isUpcoming && !dx.isActive && (
                    <span style={{ color: '#eab308', marginLeft: '6px', fontSize: '10px' }}>UPCOMING</span>
                  )}
                </span>
                <span style={{ color: '#aaa', fontSize: '11px' }}>{dx.dates || ''}</span>
              </div>
              <div style={{ fontSize: '11px', marginTop: '1px' }}>
                <span style={{ color: '#ff8800' }}>{dx.entity || ''}</span>
                {dx.bands && <span style={{ color: '#666', marginLeft: '6px' }}>{dx.bands}</span>}
                {dx.modes && <span style={{ color: '#555', marginLeft: '4px' }}>{dx.modes}</span>}
              </div>
            </div>
          ))}
          {(!dxpeditions?.data?.dxpeditions || dxpeditions.data.dxpeditions.length === 0) && (
            <div style={{ color: '#777', textAlign: 'center', marginTop: '8px' }}>No active DXpeditions</div>
          )}
        </div>
      ),
    },
  ];

  // Pane 2: SSN/SFI graphs, Propagation
  const pane2Views = [
    {
      label: 'SSN / SFI',
      render: () => (
        <div style={{ display: 'flex', gap: '8px', height: '100%' }}>
          {/* SSN */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', color: '#aaa', textAlign: 'center' }}>SSN</div>
            <div
              style={{
                height: '60px',
                background: '#001100',
                border: '1px solid #333',
                borderRadius: '2px',
                padding: '2px',
              }}
            >
              {solarIndices?.data?.ssn?.history?.length > 0 && (
                <svg width="100%" height="100%" viewBox="0 0 100 50" preserveAspectRatio="none">
                  {(() => {
                    const data = solarIndices.data.ssn.history.slice(-30);
                    const values = data.map((d) => d.value);
                    const max = Math.max(...values, 1);
                    const min = Math.min(...values, 0);
                    const range = max - min || 1;
                    const points = data
                      .map((d, i) => {
                        const x = (i / (data.length - 1)) * 100;
                        const y = 50 - ((d.value - min) / range) * 45;
                        return `${x},${y}`;
                      })
                      .join(' ');
                    return <polyline points={points} fill="none" stroke="#00ff00" strokeWidth="1.5" />;
                  })()}
                </svg>
              )}
            </div>
            <div style={{ fontSize: '24px', color: '#00ffff', fontWeight: '700', textAlign: 'center' }}>
              {solarIndices?.data?.ssn?.current ?? '--'}
            </div>
          </div>
          {/* SFI */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', color: '#aaa', textAlign: 'center' }}>SFI</div>
            <div
              style={{
                height: '60px',
                background: '#001100',
                border: '1px solid #333',
                borderRadius: '2px',
                padding: '2px',
              }}
            >
              {solarIndices?.data?.sfi?.history?.length > 0 && (
                <svg width="100%" height="100%" viewBox="0 0 100 50" preserveAspectRatio="none">
                  {(() => {
                    const data = solarIndices.data.sfi.history.slice(-30);
                    const values = data.map((d) => d.value);
                    const max = Math.max(...values, 1);
                    const min = Math.min(...values, 0);
                    const range = max - min || 1;
                    const points = data
                      .map((d, i) => {
                        const x = (i / (data.length - 1)) * 100;
                        const y = 50 - ((d.value - min) / range) * 45;
                        return `${x},${y}`;
                      })
                      .join(' ');
                    return <polyline points={points} fill="none" stroke="#ff66ff" strokeWidth="1.5" />;
                  })()}
                </svg>
              )}
            </div>
            <div style={{ fontSize: '24px', color: '#ff66ff', fontWeight: '700', textAlign: 'center' }}>
              {solarIndices?.data?.sfi?.current ?? '--'}
            </div>
          </div>
        </div>
      ),
    },
    {
      label: 'Propagation',
      render: () => (
        <div style={{ fontSize: '15px', height: '100%' }}>
          {propagation?.data && (
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '6px' }}>
              <span>
                <span style={{ color: '#aaa' }}>MUF </span>
                <span style={{ color: '#ff8800', fontWeight: '700', fontSize: '18px' }}>
                  {propagation.data.muf || '?'} MHz
                </span>
              </span>
              <span>
                <span style={{ color: '#aaa' }}>LUF </span>
                <span style={{ color: '#00aaff', fontWeight: '700', fontSize: '18px' }}>
                  {propagation.data.luf || '?'} MHz
                </span>
              </span>
            </div>
          )}
          {/* Band reliability bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
            {(bandConditions?.data || []).slice(0, 13).map((band, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ color: '#bbb', width: '32px', textAlign: 'right' }}>{band.band}</span>
                <div
                  style={{
                    flex: 1,
                    height: '8px',
                    background: '#111',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: band.condition === 'GOOD' ? '100%' : band.condition === 'FAIR' ? '50%' : '15%',
                      background: condColor(band.condition),
                      borderRadius: '2px',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      label: 'VOACAP',
      render: () => {
        const bands = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];
        const pd = propagation?.data || {};
        const currentHour = pd.currentHour ?? new Date().getUTCHours();
        const currentBands = pd.currentBands || [];
        const hourlyPredictions = pd.hourlyPredictions || {};
        const getHeatColor = (rel) => {
          if (rel >= 80) return '#00cc00';
          if (rel >= 60) return '#55bb00';
          if (rel >= 40) return '#ffcc00';
          if (rel >= 20) return '#ff6600';
          if (rel >= 10) return '#cc2200';
          return '#221111';
        };
        return (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {pd.muf && (
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'center',
                  marginBottom: '4px',
                  fontSize: '13px',
                }}
              >
                <span>
                  <span style={{ color: '#aaa' }}>MUF </span>
                  <span style={{ color: '#ff8800', fontWeight: '700' }}>{pd.muf} MHz</span>
                </span>
                <span>
                  <span style={{ color: '#aaa' }}>LUF </span>
                  <span style={{ color: '#00aaff', fontWeight: '700' }}>{pd.luf || '?'} MHz</span>
                </span>
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '28px repeat(24, 1fr)',
                gridTemplateRows: `repeat(${bands.length}, 1fr)`,
                gap: '1px',
                fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace',
                flex: 1,
                minHeight: 0,
              }}
            >
              {bands.map((band) => (
                <React.Fragment key={band}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      paddingRight: '3px',
                      color: '#aaa',
                      fontSize: '10px',
                    }}
                  >
                    {band.replace('m', '')}
                  </div>
                  {Array.from({ length: 24 }, (_, i) => {
                    const hour = (currentHour - 12 + i + 24) % 24;
                    let rel = 0;
                    if (hour === currentHour && currentBands?.length > 0) {
                      const cbd = currentBands.find((b) => b.band === band);
                      if (cbd) rel = cbd.reliability || 0;
                    } else {
                      const hd = hourlyPredictions[band]?.find((h) => h.hour === hour);
                      rel = hd?.reliability || 0;
                    }
                    return (
                      <div
                        key={hour}
                        style={{
                          background: getHeatColor(rel),
                          borderRadius: '1px',
                          border: hour === currentHour ? '1px solid #fff' : 'none',
                        }}
                        title={`${band} @ ${hour}:00 UTC: ${rel}%`}
                      />
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
            {/* Hour labels */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '28px repeat(24, 1fr)',
                marginTop: '2px',
                fontSize: '9px',
                color: '#888',
              }}
            >
              <div>UTC</div>
              {Array.from({ length: 24 }, (_, i) => {
                const hour = (currentHour - 12 + i + 24) % 24;
                return (
                  <div
                    key={i}
                    style={{
                      textAlign: 'center',
                      fontWeight: hour === currentHour ? '700' : 'normal',
                      color: hour === currentHour ? '#fff' : undefined,
                    }}
                  >
                    {hour % 3 === 0 ? hour : ''}
                  </div>
                );
              })}
            </div>
          </div>
        );
      },
    },
  ];

  // Pane 3: Band Conditions, Contests, Space Wx Summary
  const pane3Views = [
    {
      label: 'Band Conditions',
      render: () => (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '3px',
            fontSize: '14px',
          }}
        >
          {(bandConditions?.data || []).slice(0, 13).map((band, i) => (
            <div
              key={i}
              style={{
                background: '#111',
                border: `1px solid ${condColor(band.condition)}33`,
                borderRadius: '2px',
                padding: '3px 2px',
                textAlign: 'center',
              }}
            >
              <div style={{ color: condColor(band.condition), fontWeight: '700', fontSize: '15px' }}>{band.band}</div>
              <div style={{ color: condColor(band.condition), fontSize: '11px', opacity: 0.9 }}>{band.condition}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      label: 'Contests',
      render: () => (
        <div style={{ fontSize: '15px', overflow: 'auto', height: '100%' }}>
          {(contests?.data || []).slice(0, 6).map((contest, i) => (
            <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #111' }}>
              <div style={{ color: '#ffff00', fontWeight: '700' }}>{contest.name || contest.title}</div>
              <div style={{ color: '#aaa' }}>
                {contest.startDate || contest.start || ''} - {contest.endDate || contest.end || ''}
              </div>
            </div>
          ))}
          {(!contests?.data || contests.data.length === 0) && (
            <div style={{ color: '#777', textAlign: 'center', marginTop: '8px' }}>No active contests</div>
          )}
        </div>
      ),
    },
    {
      label: 'Space Wx',
      render: () => (
        <div style={{ fontSize: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div>
              <span style={{ color: '#aaa' }}>Kp </span>
              <span
                style={{
                  color: kpColor(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex),
                  fontWeight: '700',
                }}
              >
                {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
              </span>
            </div>
            <div>
              <span style={{ color: '#aaa' }}>A </span>
              <span style={{ color: '#00ffff', fontWeight: '700' }}>{bandConditions?.extras?.aIndex ?? '--'}</span>
            </div>
            <div>
              <span style={{ color: '#aaa' }}>SFI </span>
              <span style={{ color: '#ff66ff', fontWeight: '700' }}>
                {solarIndices?.data?.sfi?.current ?? spaceWeather?.data?.solarFlux ?? '--'}
              </span>
            </div>
            <div>
              <span style={{ color: '#aaa' }}>SSN </span>
              <span style={{ color: '#00ffff', fontWeight: '700' }}>{solarIndices?.data?.ssn?.current ?? '--'}</span>
            </div>
            <div>
              <span style={{ color: '#aaa' }}>Wind </span>
              <span style={{ color: '#ffff00', fontWeight: '700' }}>
                {bandConditions?.extras?.solarWind || '--'} km/s
              </span>
            </div>
            <div>
              <span style={{ color: '#aaa' }}>X-ray </span>
              <span style={{ color: '#ffff00', fontWeight: '700' }}>{bandConditions?.extras?.xray || '--'}</span>
            </div>
          </div>
          <div style={{ marginTop: '6px' }}>
            <span style={{ color: '#aaa' }}>Geomag: </span>
            <span style={{ color: geomagColor(bandConditions?.extras?.geomagField), fontWeight: '700' }}>
              {bandConditions?.extras?.geomagField || '--'}
            </span>
          </div>
        </div>
      ),
    },
  ];

  return config.layout === 'classic' ? (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'grid',
        gridTemplateRows: '1fr 210px 28px',
        background: '#000',
        fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden',
        color: '#ccc',
      }}
    >
      {/* === TOP AREA: Left Column + Map + Right Column === */}
      <div style={{ display: 'grid', gridTemplateColumns: '310px 1fr 90px', overflow: 'hidden' }}>
        {/* LEFT COLUMN: Callsign+Clock on top, DE/DX below */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #333',
            overflow: 'hidden',
          }}
        >
          {/* Callsign + Clock Block */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #333' }}>
            <div
              style={{
                fontSize: '42px',
                fontWeight: '900',
                color: '#ff4444',
                fontFamily: 'Orbitron, monospace',
                cursor: 'pointer',
                lineHeight: 1,
              }}
              onClick={() => setShowSettings(true)}
              title={t('app.settings.click')}
            >
              {config.callsign}
            </div>
            <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>
              {t('app.uptime', { uptime, version: config.version ? `v${config.version}` : '' })}
            </div>
            <div style={{ marginTop: '10px' }}>
              <div
                style={{
                  fontSize: '44px',
                  fontWeight: '700',
                  color: '#00ff00',
                  fontFamily: 'JetBrains Mono, monospace',
                  lineHeight: 1,
                }}
              >
                {utcTime}
                <span style={{ fontSize: '26px', color: '#00cc00' }}>:{seconds}</span>
              </div>
              <div style={{ fontSize: '18px', color: '#00aa00', marginTop: '4px' }}>
                {utcDate} <span style={{ color: '#888' }}>UTC</span>
              </div>
            </div>
          </div>

          {/* DE / DX Panels — stacked vertically */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
            {/* DE Panel */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #333' }}>
              <div style={{ fontSize: '22px', fontWeight: '700', color: '#00ff00', marginBottom: '4px' }}>DE:</div>
              <div style={{ fontSize: '16px' }}>
                <div style={{ color: '#00cccc', fontSize: '20px', fontWeight: '600' }}>{localTime}</div>
                <div style={{ color: '#00aaaa', fontSize: '16px' }}>{localDate}</div>
                <div style={{ color: '#bbb', marginTop: '4px', fontSize: '15px' }}>
                  {deLat != null ? `${Math.abs(deLat).toFixed(1)}°${deLat >= 0 ? 'N' : 'S'}` : '--'}{' '}
                  {deLon != null ? `${Math.abs(deLon).toFixed(1)}°${deLon >= 0 ? 'E' : 'W'}` : '--'}
                </div>
                <div style={{ color: '#00ffff', fontWeight: '700', fontSize: '20px', marginTop: '2px' }}>
                  {deGrid || '--'}
                </div>
                <div style={{ marginTop: '4px', color: '#ffcc00', fontSize: '12px' }}>
                  <span>&#9728;&#8593; {fmtSunTime(deSunTimes.local?.sunrise ?? deSunTimes?.sunrise)}</span>
                  <span style={{ marginLeft: '12px' }}>
                    &#9728;&#8595; {fmtSunTime(deSunTimes.local?.sunset ?? deSunTimes?.sunset)}
                  </span>
                  <span> {deSunTimes.local !== null ? config.timezone : 'UTC'}</span>
                </div>
              </div>
            </div>

            {/* DX Panel */}
            <div style={{ padding: '10px 14px', flex: 1 }}>
              <div style={{ fontSize: '22px', fontWeight: '700', color: '#00ff00', marginBottom: '4px' }}>DX:</div>
              <div style={{ fontSize: '16px' }}>
                <div style={{ color: '#00cccc', fontSize: '20px', fontWeight: '600' }}>
                  {utcTime} <span style={{ color: '#888', fontSize: '13px' }}>UTC</span>
                </div>
                <div style={{ color: '#00aaaa', fontSize: '16px' }}>{utcDate}</div>
                <div style={{ color: '#bbb', marginTop: '4px', fontSize: '15px' }}>
                  {dxLat != null ? `${Math.abs(dxLat).toFixed(1)}°${dxLat >= 0 ? 'N' : 'S'}` : '--'}{' '}
                  {dxLon != null ? `${Math.abs(dxLon).toFixed(1)}°${dxLon >= 0 ? 'E' : 'W'}` : '--'}
                </div>
                <div style={{ color: '#00ffff', fontWeight: '700', fontSize: '20px', marginTop: '2px' }}>
                  {dxGrid || '--'}
                </div>
                <div style={{ marginTop: '4px', color: '#ffcc00', fontSize: '12px' }}>
                  <span>&#9728;&#8593; {fmtSunTime(dxSunTimes?.sunrise)}</span>
                  <span style={{ marginLeft: '12px' }}>&#9728;&#8595; {fmtSunTime(dxSunTimes?.sunset)}</span>
                  <span> UTC</span>
                </div>
                <div style={{ marginTop: '6px', color: '#ff8800', fontSize: '18px', fontWeight: '600' }}>
                  <span>{bearing != null ? `${bearing}°` : '--°'}</span>
                  <span style={{ marginLeft: '12px' }}>{distStr}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER: World Map */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <WorldMap
            deLocation={config.location}
            dxLocation={dxLocation}
            onDXChange={handleDXChange}
            dxLocked={dxLocked}
            potaSpots={potaSpots.data}
            sotaSpots={sotaSpots.data}
            wwbotaSpots={wwbotaSpots.data}
            mySpots={mySpots.data}
            dxPaths={dxClusterData.paths}
            dxFilters={dxFilters}
            mapBandFilter={mapBandFilter}
            onMapBandFilterChange={setMapBandFilter}
            satellites={filteredSatellites}
            pskReporterSpots={filteredPskSpots}
            showDeDxMarkers={mapLayers.showDeDxMarkers}
            showDXPaths={mapLayers.showDXPaths}
            showDXLabels={mapLayers.showDXLabels}
            onToggleDXLabels={toggleDXLabels}
            showPOTA={mapLayers.showPOTA}
            showSOTA={mapLayers.showSOTA}
            showWWBOTA={mapLayers.showWWBOTA}
            showSatellites={mapLayers.showSatellites}
            showPSKReporter={mapLayers.showPSKReporter}
            showPSKPaths={mapLayers.showPSKPaths}
            showMutualReception={config.showMutualReception !== false}
            wsjtxSpots={wsjtxMapSpots}
            showWSJTX={mapLayers.showWSJTX}
            showDXNews={mapLayers.showDXNews}
            onToggleSatellites={toggleSatellites}
            hoveredSpot={hoveredSpot}
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
            allUnits={config.allUnits}
            mouseZoom={config.mouseZoom}
            onSpotClick={tuneTo}
          />

          {/* Map overlay: Settings + DX Lock */}
          <div
            style={{
              position: 'absolute',
              bottom: '30px',
              left: '8px',
              display: 'flex',
              gap: '4px',
              zIndex: 1000,
            }}
          >
            <button
              onClick={() => setShowSettings(true)}
              style={{
                background: 'rgba(0,0,0,0.7)',
                border: '1px solid #444',
                color: '#fff',
                padding: '4px 8px',
                fontSize: '10px',
                cursor: 'pointer',
                borderRadius: '2px',
              }}
            >
              ⚙ {t('app.settings.title')}
            </button>
            <button
              onClick={handleToggleDxLock}
              title={dxLocked ? t('app.dxLock.unlockTooltip') : t('app.dxLock.lockTooltip')}
              style={{
                background: dxLocked ? 'rgba(255,180,0,0.9)' : 'rgba(0,0,0,0.7)',
                border: '1px solid #444',
                color: dxLocked ? '#000' : '#fff',
                padding: '4px 8px',
                fontSize: '10px',
                cursor: 'pointer',
                borderRadius: '2px',
              }}
            >
              {dxLocked ? t('app.dxLock.locked') : t('app.dxLock.unlocked')}
            </button>
          </div>

          {/* Map layer toggles */}
          <div
            style={{
              position: 'absolute',
              bottom: '28px',
              right: '4px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '2px',
              zIndex: 1000,
              maxWidth: '200px',
              justifyContent: 'flex-end',
            }}
          >
            {toggleDXPaths && (
              <button onClick={toggleDXPaths} style={layerBtnStyle(mapLayers.showDXPaths)}>
                DX
              </button>
            )}
            {togglePOTA && (
              <button onClick={togglePOTA} style={layerBtnStyle(mapLayers.showPOTA)}>
                POTA
              </button>
            )}
            {toggleSOTA && (
              <button onClick={toggleSOTA} style={layerBtnStyle(mapLayers.showSOTA)}>
                SOTA
              </button>
            )}
            {toggleWWBOTA && (
              <button onClick={toggleWWBOTA} style={layerBtnStyle(mapLayers.showWWBOTA)}>
                BOTA
              </button>
            )}
            {toggleSatellites && (
              <button onClick={toggleSatellites} style={layerBtnStyle(mapLayers.showSatellites)}>
                SAT
              </button>
            )}
            {togglePSKReporter && (
              <button onClick={togglePSKReporter} style={layerBtnStyle(mapLayers.showPSKReporter)}>
                PSK
              </button>
            )}
            {toggleWSJTX && (
              <button onClick={toggleWSJTX} style={layerBtnStyle(mapLayers.showWSJTX)}>
                FT8
              </button>
            )}
          </div>

          {/* MUF color bar at bottom of map */}
          <div
            style={{
              position: 'absolute',
              bottom: '4px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.8)',
              border: '1px solid #333',
              borderRadius: '3px',
              padding: '3px 8px',
              zIndex: 1000,
              display: 'flex',
              gap: '3px',
              alignItems: 'center',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono, monospace',
              fontWeight: '700',
            }}
          >
            {mapLegendBands.map((band) => (
              <span
                key={band}
                style={{
                  background: getBandColorForBand(`${band}m`),
                  color: '#000',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  lineHeight: 1.2,
                }}
              >
                {band}
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: Pane 4 — Space Weather Stats */}
        <div
          style={{
            borderLeft: '1px solid #333',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-evenly',
            padding: '6px 4px',
            overflow: 'hidden',
          }}
        >
          {/* Kp */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#aaa' }}>Kp</div>
            <div
              style={{
                fontSize: '22px',
                fontWeight: '700',
                color: kpColor(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex),
              }}
            >
              {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
            </div>
          </div>
          {/* Bz */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#aaa' }}>Bz</div>
            <div
              style={{
                fontSize: '20px',
                fontWeight: '700',
                color: (() => {
                  const bz = solarIndices?.data?.bz?.current;
                  if (bz == null) return '#00ffff';
                  if (bz < -10) return '#ef4444';
                  if (bz < -5) return '#f59e0b';
                  if (bz < 0) return '#eab308';
                  return '#22c55e';
                })(),
              }}
            >
              {solarIndices?.data?.bz?.current != null ? `${solarIndices.data.bz.current} nT` : '--'}
            </div>
          </div>
          {/* X-ray */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#aaa' }}>X-ray</div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#ffff00' }}>
              {bandConditions?.extras?.xray || '--'}
            </div>
          </div>
          {/* SFI */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#aaa' }}>SFI</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#ff66ff' }}>
              {solarIndices?.data?.sfi?.current ?? spaceWeather?.data?.solarFlux ?? '--'}
            </div>
          </div>
          {/* SSN */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#aaa' }}>SSN</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#00ffff' }}>
              {solarIndices?.data?.ssn?.current ?? '--'}
            </div>
          </div>
          {/* Solar Wind */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#aaa' }}>Wind</div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#ffff00' }}>
              {bandConditions?.extras?.solarWind || '--'}
            </div>
          </div>
          {/* Geomag */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: '#aaa' }}>Geo</div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: '700',
                color: geomagColor(bandConditions?.extras?.geomagField),
              }}
            >
              {bandConditions?.extras?.geomagField ? bandConditions.extras.geomagField.slice(0, 5) : '--'}
            </div>
          </div>
        </div>
      </div>

      {/* === BOTTOM ROW: Three Rotating Panes === */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          borderTop: '1px solid #333',
          overflow: 'hidden',
        }}
      >
        <div style={{ borderRight: '1px solid #333', overflow: 'hidden' }}>
          <RotatingPane views={pane1Views} />
        </div>
        <div style={{ borderRight: '1px solid #333', overflow: 'hidden' }}>
          <RotatingPane views={pane2Views} />
        </div>
        <div style={{ overflow: 'hidden' }}>
          <RotatingPane views={pane3Views} />
        </div>
      </div>

      {/* === BOTTOM TICKER === */}
      <div style={{ borderTop: '1px solid #333', overflow: 'hidden' }}>
        <DXNewsTicker />
      </div>
    </div>
  ) : config.layout === 'tablet' ? (
    /* TABLET LAYOUT - Optimized for 7-10" widescreen displays (16:9) */
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden',
      }}
    >
      {/* COMPACT TOP BAR */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-color)',
          padding: '6px 12px',
          height: '52px',
          flexShrink: 0,
          gap: '10px',
        }}
      >
        {/* Callsign */}
        <span
          style={{
            fontSize: '28px',
            fontWeight: '900',
            color: 'var(--accent-amber)',
            fontFamily: 'Orbitron, monospace',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onClick={() => setShowSettings(true)}
          title={t('app.settings.title')}
        >
          {config.callsign}
        </span>

        {/* UTC */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              fontWeight: '600',
            }}
          >
            {t('app.time.utc')}
          </span>
          <span
            style={{
              fontSize: '24px',
              fontWeight: '700',
              color: 'var(--accent-cyan)',
            }}
          >
            {utcTime}
          </span>
        </div>

        {/* Local */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onClick={handleTimeFormatToggle}
          title={t('app.time.toggleFormat', {
            format: use12Hour ? '24h' : '12h',
          })}
        >
          <span
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              fontWeight: '600',
            }}
          >
            {t('app.time.locShort')}
          </span>
          <span
            style={{
              fontSize: '24px',
              fontWeight: '700',
              color: 'var(--accent-amber)',
            }}
          >
            {localTime}
          </span>
        </div>

        {/* Solar Quick Stats */}
        <div
          style={{
            display: 'flex',
            gap: '10px',
            fontSize: '15px',
            whiteSpace: 'nowrap',
          }}
        >
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.sfiShort')} </span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: '700' }}>
              {solarIndices?.data?.sfi?.current ?? spaceWeather?.data?.solarFlux ?? '--'}
            </span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.kpShort')} </span>
            <span
              style={{
                color:
                  parseInt(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex) >= 4
                    ? 'var(--accent-red)'
                    : 'var(--accent-green)',
                fontWeight: '700',
              }}
            >
              {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
            </span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.ssnShort')} </span>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>
              {solarIndices?.data?.ssn?.current ?? '--'}
            </span>
          </span>
          {bandConditions?.extras?.aIndex && (
            <span>
              <span style={{ color: 'var(--text-muted)' }}>A </span>
              <span
                style={{
                  color:
                    parseInt(bandConditions.extras.aIndex) >= 20
                      ? 'var(--accent-red)'
                      : parseInt(bandConditions.extras.aIndex) >= 10
                        ? 'var(--accent-amber)'
                        : 'var(--accent-green)',
                  fontWeight: '700',
                }}
              >
                {bandConditions.extras.aIndex}
              </span>
            </span>
          )}
          {bandConditions?.extras?.solarWind && (
            <span title="Solar Wind Speed">
              <span style={{ color: 'var(--text-muted)' }}>SW </span>
              <span
                style={{
                  color:
                    parseFloat(bandConditions.extras.solarWind) >= 700
                      ? 'var(--accent-red)'
                      : parseFloat(bandConditions.extras.solarWind) >= 500
                        ? 'var(--accent-amber)'
                        : 'var(--accent-green)',
                  fontWeight: '700',
                }}
              >
                {bandConditions.extras.solarWind}
              </span>
            </span>
          )}
          {bandConditions?.extras?.geomagField && (
            <span
              style={{
                fontSize: '12px',
                color:
                  bandConditions.extras.geomagField === 'QUIET'
                    ? 'var(--accent-green)'
                    : bandConditions.extras.geomagField === 'ACTIVE' ||
                        bandConditions.extras.geomagField.includes('STORM')
                      ? 'var(--accent-red)'
                      : 'var(--accent-amber)',
                fontWeight: '600',
              }}
            >
              {bandConditions.extras.geomagField}
            </span>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {!isFullscreen && <DonateButton compact fontSize="11px" padding="4px 8px" />}
          <button
            onClick={() => setShowSettings(true)}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              padding: '4px 8px',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            ⚙
          </button>
          <button
            onClick={handleFullscreenToggle}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              padding: '4px 8px',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {isFullscreen ? '⛶' : '⛶'}
          </button>
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
            wwbotaSpots={wwbotaSpots.data}
            mySpots={mySpots.data}
            dxPaths={dxClusterData.paths}
            dxFilters={dxFilters}
            mapBandFilter={mapBandFilter}
            onMapBandFilterChange={setMapBandFilter}
            satellites={filteredSatellites}
            pskReporterSpots={filteredPskSpots}
            showDeDxMarkers={mapLayers.showDeDxMarkers}
            showDXPaths={mapLayers.showDXPaths}
            showDXLabels={mapLayers.showDXLabels}
            onToggleDXLabels={toggleDXLabels}
            showPOTA={mapLayers.showPOTA}
            showSOTA={mapLayers.showSOTA}
            showWWBOTA={mapLayers.showWWBOTA}
            showSatellites={mapLayers.showSatellites}
            showPSKReporter={mapLayers.showPSKReporter}
            showPSKPaths={mapLayers.showPSKPaths}
            showMutualReception={config.showMutualReception !== false}
            wsjtxSpots={wsjtxMapSpots}
            showWSJTX={mapLayers.showWSJTX}
            showDXNews={mapLayers.showDXNews}
            onToggleSatellites={toggleSatellites}
            hoveredSpot={hoveredSpot}
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
            allUnits={config.allUnits}
            mouseZoom={config.mouseZoom}
            onSpotClick={tuneTo}
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
              zIndex: 1000,
            }}
          >
            {dxLocked ? t('app.dxLock.locked') : t('app.dxLock.unlocked')}
          </button>
          {/* Compact Band Legend */}
          <div
            style={{
              position: 'absolute',
              bottom: '4px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.8)',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '3px 8px',
              zIndex: 1000,
              display: 'flex',
              gap: '3px',
              alignItems: 'center',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono, monospace',
              fontWeight: '700',
            }}
          >
            {mapLegendBands.map((band) => (
              <span
                key={band}
                style={{
                  background: getBandColorForBand(`${band}m`),
                  color: '#000',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  lineHeight: 1.2,
                }}
              >
                {band}
              </span>
            ))}
          </div>
        </div>

        {/* DATA SIDEBAR */}
        <div
          style={{
            width: '280px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            overflow: 'hidden',
          }}
        >
          {/* Band Conditions Grid */}
          <div
            style={{
              padding: '8px',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                color: 'var(--accent-amber)',
                fontWeight: '700',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {t('band.conditions')}
              {(() => {
                if (!bandConditions?.extras?.stale || bandConditions.extras.fetchedAt == null) return null;
                const mins = Math.round((Date.now() - bandConditions.extras.fetchedAt) / 60_000);
                return (
                  <span
                    title={t('band.conditions.stale.tooltip', { mins })}
                    style={{
                      fontSize: '10px',
                      fontWeight: '600',
                      color: 'var(--accent-amber)',
                      background: 'rgba(255,180,50,0.15)',
                      border: '1px solid var(--accent-amber)',
                      borderRadius: '4px',
                      padding: '1px 5px',
                      cursor: 'default',
                      textTransform: 'none',
                    }}
                  >
                    {t('band.conditions.stale.label', { mins })}
                  </span>
                );
              })()}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '4px',
              }}
            >
              {(bandConditions?.data || []).slice(0, 13).map((band, idx) => {
                const colors = {
                  GOOD: {
                    bg: 'rgba(0,255,136,0.2)',
                    color: '#00ff88',
                    border: 'rgba(0,255,136,0.4)',
                  },
                  FAIR: {
                    bg: 'rgba(255,180,50,0.2)',
                    color: '#ffb432',
                    border: 'rgba(255,180,50,0.4)',
                  },
                  POOR: {
                    bg: 'rgba(255,68,102,0.2)',
                    color: '#ff4466',
                    border: 'rgba(255,68,102,0.4)',
                  },
                };
                const s = colors[band.condition] || colors.FAIR;
                return (
                  <div
                    key={idx}
                    style={{
                      background: s.bg,
                      border: `1px solid ${s.border}`,
                      borderRadius: '4px',
                      padding: '5px 2px',
                      textAlign: 'center',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'Orbitron, monospace',
                        fontSize: '15px',
                        fontWeight: '700',
                        color: s.color,
                      }}
                    >
                      {band.band}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        fontWeight: '600',
                        color: s.color,
                        opacity: 0.8,
                      }}
                    >
                      {band.condition}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* MUF/LUF */}
            {propagation?.data && (
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  marginTop: '6px',
                  fontSize: '14px',
                  justifyContent: 'center',
                }}
              >
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>{t('app.propagation.muf')} </span>
                  <span style={{ color: '#ff8800', fontWeight: '700' }}>{propagation.data.muf || '?'}</span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>{t('app.propagation.luf')} </span>
                  <span style={{ color: '#00aaff', fontWeight: '700' }}>{propagation.data.luf || '?'}</span>
                </span>
              </div>
            )}
          </div>

          {/* Compact DX Cluster */}
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '6px 8px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontSize: '14px',
                  color: 'var(--accent-red)',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                }}
              >
                {t('app.dxCluster.title')}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {t('app.dxCluster.spotsCount', {
                  count: dxClusterData.spots?.length || 0,
                })}
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
                    background: matchesDXSpotPath(hoveredSpot, spot) ? 'var(--bg-tertiary)' : 'transparent',
                    fontSize: '14px',
                  }}
                  onMouseEnter={() => setHoveredSpot(spot)}
                  onMouseLeave={() => setHoveredSpot(null)}
                  onClick={() => {
                    tuneTo(spot);
                    const path = findDXPathForSpot(dxClusterData.paths || [], spot);
                    if (path && path.dxLat != null && path.dxLon != null) {
                      handleDXChange({ lat: path.dxLat, lon: path.dxLon, callsign: spot.call ?? spot.dxCall ?? null });
                    }
                  }}
                >
                  <span
                    style={{
                      color: getBandColor(
                        parseFloat(spot.freq) > 1000 ? parseFloat(spot.freq) / 1000 : parseFloat(spot.freq),
                      ),
                      fontWeight: '700',
                    }}
                  >
                    {(() => {
                      const f = parseFloat(spot.freq);
                      return f > 1000 ? (f / 1000).toFixed(3) : f.toFixed(3);
                    })()}
                  </span>
                  <span
                    style={{
                      color: 'var(--accent-cyan)',
                      fontWeight: '600',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <CallsignLink call={spot.call} color="var(--accent-cyan)" fontWeight="600" />
                  </span>
                  <span
                    style={{
                      color: 'var(--text-muted)',
                      textAlign: 'right',
                      fontSize: '12px',
                    }}
                  >
                    {spot.time || '--'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* DX News - sidebar footer */}
          {mapLayers.showDXNews && (
            <div
              style={{
                flexShrink: 0,
                borderTop: '1px solid var(--border-color)',
                background: 'var(--bg-panel)',
                height: '28px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <DXNewsTicker sidebar={true} />
            </div>
          )}
        </div>
      </div>
    </div>
  ) : config.layout === 'compact' ? (
    /* COMPACT LAYOUT - Optimized for 4:3 screens and data-first display */
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden',
      }}
    >
      {/* TOP: Callsign + Times + Solar */}
      <div
        style={{
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-color)',
          padding: '8px 12px',
          flexShrink: 0,
        }}
      >
        {/* Row 1: Callsign + Times */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '6px',
          }}
        >
          <span
            style={{
              fontSize: '32px',
              fontWeight: '900',
              color: 'var(--accent-amber)',
              fontFamily: 'Orbitron, monospace',
              cursor: 'pointer',
            }}
            onClick={() => setShowSettings(true)}
            title={t('app.settings.title')}
          >
            {config.callsign}
          </span>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  fontWeight: '600',
                }}
              >
                {t('app.time.utc')}
              </div>
              <div
                style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: 'var(--accent-cyan)',
                  lineHeight: 1,
                }}
              >
                {utcTime}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{utcDate}</div>
            </div>
            <div
              style={{ textAlign: 'center', cursor: 'pointer' }}
              onClick={handleTimeFormatToggle}
              title={t('app.time.toggleFormat', {
                format: use12Hour ? '24h' : '12h',
              })}
            >
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  fontWeight: '600',
                }}
              >
                {t('app.time.local')}
              </div>
              <div
                style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: 'var(--accent-amber)',
                  lineHeight: 1,
                }}
              >
                {localTime}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{localDate}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {!isFullscreen && <DonateButton compact fontSize="13px" padding="6px 10px" />}
            <button
              onClick={() => setShowSettings(true)}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                padding: '6px 10px',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              ⚙
            </button>
            <button
              onClick={handleFullscreenToggle}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                padding: '6px 10px',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              ⛶
            </button>
          </div>
        </div>
        {/* Row 2: Solar indices inline */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            fontSize: '15px',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.sfiShort')} </span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: '700' }}>
              {solarIndices?.data?.sfi?.current ?? spaceWeather?.data?.solarFlux ?? '--'}
            </span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.kpShort')} </span>
            <span
              style={{
                color:
                  parseInt(solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex) >= 4
                    ? 'var(--accent-red)'
                    : 'var(--accent-green)',
                fontWeight: '700',
              }}
            >
              {solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--'}
            </span>
          </span>
          <span>
            <span style={{ color: 'var(--text-muted)' }}>{t('app.solar.ssnShort')} </span>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>
              {solarIndices?.data?.ssn?.current ?? '--'}
            </span>
          </span>
          {bandConditions?.extras?.aIndex && (
            <span>
              <span style={{ color: 'var(--text-muted)' }}>A </span>
              <span
                style={{
                  color:
                    parseInt(bandConditions.extras.aIndex) >= 20
                      ? 'var(--accent-red)'
                      : parseInt(bandConditions.extras.aIndex) >= 10
                        ? 'var(--accent-amber)'
                        : 'var(--accent-green)',
                  fontWeight: '700',
                }}
              >
                {bandConditions.extras.aIndex}
              </span>
            </span>
          )}
          {bandConditions?.extras?.solarWind && (
            <span title="Solar Wind Speed">
              <span style={{ color: 'var(--text-muted)' }}>SW </span>
              <span
                style={{
                  color:
                    parseFloat(bandConditions.extras.solarWind) >= 700
                      ? 'var(--accent-red)'
                      : parseFloat(bandConditions.extras.solarWind) >= 500
                        ? 'var(--accent-amber)'
                        : 'var(--accent-green)',
                  fontWeight: '700',
                }}
              >
                {bandConditions.extras.solarWind}
              </span>
            </span>
          )}
          {bandConditions?.extras?.geomagField && (
            <span
              style={{
                fontSize: '12px',
                color:
                  bandConditions.extras.geomagField === 'QUIET'
                    ? 'var(--accent-green)'
                    : bandConditions.extras.geomagField === 'ACTIVE' ||
                        bandConditions.extras.geomagField.includes('STORM')
                      ? 'var(--accent-red)'
                      : 'var(--accent-amber)',
                fontWeight: '600',
              }}
            >
              {bandConditions.extras.geomagField}
            </span>
          )}
          {propagation?.data && (
            <>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>{t('app.propagation.muf')} </span>
                <span style={{ color: '#ff8800', fontWeight: '600' }}>
                  {propagation.data.muf || '?'} {t('app.units.mhz')}
                </span>
              </span>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>{t('app.propagation.luf')} </span>
                <span style={{ color: '#00aaff', fontWeight: '600' }}>
                  {propagation.data.luf || '?'} {t('app.units.mhz')}
                </span>
              </span>
            </>
          )}
          {localWeather?.data && (
            <span>
              <span style={{ marginRight: '2px' }}>{localWeather.data.icon}</span>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>
                {localWeather.data.temp}°{localWeather.data.tempUnit || tempUnit}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* BAND CONDITIONS - Full Width */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '5px',
            flexWrap: 'wrap',
          }}
        >
          {(bandConditions?.data || []).slice(0, 13).map((band, idx) => {
            const colors = {
              GOOD: {
                bg: 'rgba(0,255,136,0.2)',
                color: '#00ff88',
                border: 'rgba(0,255,136,0.4)',
              },
              FAIR: {
                bg: 'rgba(255,180,50,0.2)',
                color: '#ffb432',
                border: 'rgba(255,180,50,0.4)',
              },
              POOR: {
                bg: 'rgba(255,68,102,0.2)',
                color: '#ff4466',
                border: 'rgba(255,68,102,0.4)',
              },
            };
            const s = colors[band.condition] || colors.FAIR;
            return (
              <div
                key={idx}
                style={{
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  borderRadius: '4px',
                  padding: '5px 10px',
                  textAlign: 'center',
                  minWidth: '58px',
                }}
              >
                <div
                  style={{
                    fontFamily: 'Orbitron, monospace',
                    fontSize: '16px',
                    fontWeight: '700',
                    color: s.color,
                  }}
                >
                  {band.band}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: s.color,
                    opacity: 0.8,
                  }}
                >
                  {band.condition}
                </div>
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
            wwbotaSpots={wwbotaSpots.data}
            mySpots={mySpots.data}
            dxPaths={dxClusterData.paths}
            dxFilters={dxFilters}
            mapBandFilter={mapBandFilter}
            onMapBandFilterChange={setMapBandFilter}
            satellites={filteredSatellites}
            pskReporterSpots={filteredPskSpots}
            showDeDxMarkers={mapLayers.showDeDxMarkers}
            showDXPaths={mapLayers.showDXPaths}
            showDXLabels={mapLayers.showDXLabels}
            onToggleDXLabels={toggleDXLabels}
            showPOTA={mapLayers.showPOTA}
            showSOTA={mapLayers.showSOTA}
            showWWBOTA={mapLayers.showWWBOTA}
            showSatellites={mapLayers.showSatellites}
            showPSKReporter={mapLayers.showPSKReporter}
            showPSKPaths={mapLayers.showPSKPaths}
            showMutualReception={config.showMutualReception !== false}
            wsjtxSpots={wsjtxMapSpots}
            showWSJTX={mapLayers.showWSJTX}
            showDXNews={mapLayers.showDXNews}
            onToggleSatellites={toggleSatellites}
            hoveredSpot={hoveredSpot}
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
            allUnits={config.allUnits}
            mouseZoom={config.mouseZoom}
            onSpotClick={tuneTo}
          />
          <div
            style={{
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
              gap: '8px',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {deGrid} →{' '}
              <DXGridInput
                dxGrid={dxGrid}
                onDXChange={handleDXChange}
                dxLocked={dxLocked}
                style={{ color: 'var(--text-muted)', fontSize: '14px' }}
              />
              {dxCallsign && (
                <span
                  style={{
                    color: 'var(--accent-amber)',
                    fontSize: '14px',
                    fontFamily: 'JetBrains Mono',
                    fontWeight: '900',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dxCallsign}
                </span>
              )}
              <DXFavorites dxLocation={dxLocation} dxGrid={dxGrid} onDXChange={handleDXChange} dxLocked={dxLocked} /> •{' '}
              {dxLocked ? t('app.dxLock.lockedShort') : t('app.dxLock.clickToSet')}
            </span>
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
                cursor: 'pointer',
              }}
            >
              {dxLocked ? '🔒' : '🔓'}
            </button>
          </div>
          {/* Compact Band Legend */}
          <div
            style={{
              position: 'absolute',
              bottom: '4px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.8)',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '3px 8px',
              zIndex: 1000,
              display: 'flex',
              gap: '3px',
              alignItems: 'center',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono, monospace',
              fontWeight: '700',
            }}
          >
            {mapLegendBands.map((band) => (
              <span
                key={band}
                style={{
                  background: getBandColorForBand(`${band}m`),
                  color: '#000',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  lineHeight: 1.2,
                }}
              >
                {band}
              </span>
            ))}
          </div>
        </div>

        {/* Compact DX Cluster */}
        <div
          style={{
            width: '250px',
            flexShrink: 0,
            borderLeft: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '6px 8px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: '14px',
                color: 'var(--accent-red)',
                fontWeight: '700',
                textTransform: 'uppercase',
              }}
            >
              {t('app.dxCluster.title')}
            </span>
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
                  background: matchesDXSpotPath(hoveredSpot, spot) ? 'var(--bg-tertiary)' : 'transparent',
                  fontSize: '14px',
                }}
                onMouseEnter={() => setHoveredSpot(spot)}
                onMouseLeave={() => setHoveredSpot(null)}
                onClick={() => {
                  tuneTo(spot);
                  const path = findDXPathForSpot(dxClusterData.paths || [], spot);
                  if (path && path.dxLat != null && path.dxLon != null) {
                    handleDXChange({ lat: path.dxLat, lon: path.dxLon, callsign: spot.call ?? spot.dxCall ?? null });
                  }
                }}
              >
                <span
                  style={{
                    color: getBandColor(
                      parseFloat(spot.freq) > 1000 ? parseFloat(spot.freq) / 1000 : parseFloat(spot.freq),
                    ),
                    fontWeight: '700',
                  }}
                >
                  {(() => {
                    const f = parseFloat(spot.freq);
                    return f > 1000 ? (f / 1000).toFixed(3) : f.toFixed(3);
                  })()}
                </span>
                <span
                  style={{
                    color: 'var(--accent-cyan)',
                    fontWeight: '600',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <CallsignLink call={spot.call} color="var(--accent-cyan)" fontWeight="600" />
                </span>
                <span
                  style={{
                    color: 'var(--text-muted)',
                    textAlign: 'right',
                    fontSize: '12px',
                  }}
                >
                  {spot.time || '--'}
                </span>
              </div>
            ))}
          </div>

          {/* DX News - sidebar footer */}
          {mapLayers.showDXNews && (
            <div
              style={{
                flexShrink: 0,
                borderTop: '1px solid var(--border-color)',
                background: 'var(--bg-panel)',
                height: '28px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <DXNewsTicker sidebar={true} />
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;
}
