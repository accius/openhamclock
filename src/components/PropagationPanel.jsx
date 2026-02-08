/**
 * PropagationPanel Component (VOACAP)
 * Toggleable between heatmap chart, bar chart, and band conditions view
 */
import React, { useState } from 'react';

export const PropagationPanel = ({ propagation, loading, bandConditions }) => {
  // Load view mode preference from localStorage
  const [viewMode, setViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_voacapViewMode');
      if (saved === 'bars' || saved === 'bands') return saved;
      return 'chart';
    } catch (e) { return 'chart'; }
  });
  
  // Cycle through view modes
  const cycleViewMode = () => {
    const modes = ['chart', 'bars', 'bands'];
    const currentIdx = modes.indexOf(viewMode);
    const newMode = modes[(currentIdx + 1) % modes.length];
    setViewMode(newMode);
    try {
      localStorage.setItem('openhamclock_voacapViewMode', newMode);
    } catch (e) {}
  };
  
  const getBandStyle = (condition) => ({
    GOOD: { bg: 'rgba(0,255,136,0.2)', color: '#00ff88', border: 'rgba(0,255,136,0.4)' },
    FAIR: { bg: 'rgba(255,180,50,0.2)', color: '#ffb432', border: 'rgba(255,180,50,0.4)' },
    POOR: { bg: 'rgba(255,68,102,0.2)', color: '#ff4466', border: 'rgba(255,68,102,0.4)' }
  }[condition] || { bg: 'rgba(255,180,50,0.2)', color: '#ffb432', border: 'rgba(255,180,50,0.4)' });
  
  if (loading || !propagation) {
    return (
      <div className="panel">
        <div className="panel-header">⌇ VOACAP</div>
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading predictions...
        </div>
      </div>
    );
  }

  const { solarData, distance, currentBands, currentHour, hourlyPredictions, muf, luf, ionospheric, dataSource } = propagation;
  const hasRealData = ionospheric?.method === 'direct' || ionospheric?.method === 'interpolated';
  
  // Heat map colors (VOACAP style - red=good, green=poor)
  const getHeatColor = (rel) => {
    if (rel >= 80) return '#00aa00';
    if (rel >= 60) return '#88cc00';
    if (rel >= 40) return '#ffcc00';
    if (rel >= 20) return '#ff6600';
    if (rel >= 10) return '#ff0000';
    return '#004400';
  };

  const getReliabilityColor = (rel) => {
    if (rel >= 70) return '#00ff88';
    if (rel >= 50) return '#88ff00';
    if (rel >= 30) return '#ffcc00';
    if (rel >= 15) return '#ff8800';
    return '#ff4444';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'EXCELLENT': return '#00ff88';
      case 'GOOD': return '#88ff00';
      case 'FAIR': return '#ffcc00';
      case 'POOR': return '#ff8800';
      case 'CLOSED': return '#ff4444';
      default: return 'var(--text-muted)';
    }
  };

  const bands = ['10m', '11m', '12m', '15m', '17m', '20m', '30m', '40m', '80m'];
  const viewModeLabels = { chart: '▤ chart', bars: '▦ bars', bands: '◫ bands' };

  return (
    <div className="panel" style={{ cursor: 'pointer' }} onClick={cycleViewMode}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          {viewMode === 'bands' ? '◫ BAND CONDITIONS' : '⌇ VOACAP'}
          {hasRealData && viewMode !== 'bands' && <span style={{ color: '#00ff88', fontSize: '10px', marginLeft: '4px' }}>●</span>}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
          {viewModeLabels[viewMode]} • click to toggle
        </span>
      </div>
      
      {viewMode === 'bands' ? (
        /* Band Conditions Grid View */
        <div style={{ padding: '4px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            {(bandConditions?.data || []).slice(0, 13).map((band, idx) => {
              const style = getBandStyle(band.condition);
              return (
                <div key={idx} style={{ 
                  background: style.bg,
                  border: `1px solid ${style.border}`,
                  borderRadius: '4px',
                  padding: '6px 2px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontFamily: 'Orbitron, monospace', fontSize: '13px', fontWeight: '700', color: style.color }}>
                    {band.band}
                  </div>
                  <div style={{ fontSize: '9px', fontWeight: '600', color: style.color, marginTop: '2px', opacity: 0.8 }}>
                    {band.condition}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
            SFI {solarData?.sfi} • K {solarData?.kIndex} • General conditions for all paths
          </div>
        </div>
      ) : (
        <>
          {/* MUF/LUF and Data Source Info */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            padding: '4px 8px',
            background: hasRealData ? 'rgba(0, 255, 136, 0.1)' : 'var(--bg-tertiary)',
            borderRadius: '4px',
            marginBottom: '4px',
            fontSize: '11px'
          }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>MUF </span>
                <span style={{ color: '#ff8800', fontWeight: '600' }}>{muf || '?'}</span>
                <span style={{ color: 'var(--text-muted)' }}> MHz</span>
              </span>
              <span>
                <span style={{ color: 'var(--text-muted)' }}>LUF </span>
                <span style={{ color: '#00aaff', fontWeight: '600' }}>{luf || '?'}</span>
                <span style={{ color: 'var(--text-muted)' }}> MHz</span>
              </span>
            </div>
            <span style={{ color: hasRealData ? '#00ff88' : 'var(--text-muted)', fontSize: '10px' }}>
              {hasRealData 
                ? `⌇ Iono: ${ionospheric?.source || 'ionosonde'}${ionospheric?.distance ? ` (${ionospheric.distance}km from path)` : ''}`
                : '⚡ estimated'
              }
            </span>
            {dataSource && dataSource.includes('ITU') && (
              <span style={{ 
                color: '#ff6b35', 
                fontSize: '9px', 
                marginLeft: '8px',
                padding: '1px 4px',
                background: 'rgba(255,107,53,0.15)',
                borderRadius: '3px'
              }}>
                🔬 ITU-R P.533
              </span>
            )}
          </div>
          
          {viewMode === 'chart' ? (
            /* VOACAP Heat Map Chart View */
            <div style={{ padding: '4px' }}>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '28px repeat(24, 1fr)',
                gridTemplateRows: `repeat(${bands.length}, 12px)`,
                gap: '1px',
                fontSize: '12px',
                fontFamily: 'JetBrains Mono, monospace'
              }}>
                {bands.map((band) => (
                  <React.Fragment key={band}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'flex-end',
                      paddingRight: '4px',
                      color: 'var(--text-muted)',
                      fontSize: '12px'
                    }}>
                      {band.replace('m', '')}
                    </div>
                    {Array.from({ length: 24 }, (_, hour) => {
                      let rel = 0;
                      if (hour === currentHour && currentBands?.length > 0) {
                        const currentBandData = currentBands.find(b => b.band === band);
                        if (currentBandData) {
                          rel = currentBandData.reliability || 0;
                        }
                      } else {
                        const bandData = hourlyPredictions?.[band];
                        const hourData = bandData?.find(h => h.hour === hour);
                        rel = hourData?.reliability || 0;
                      }
                      return (
                        <div 
                          key={hour}
                          style={{ 
                            background: getHeatColor(rel),
                            borderRadius: '1px',
                            border: hour === currentHour ? '1px solid white' : 'none'
                          }}
                          title={`${band} @ ${hour}:00 UTC: ${rel}%`}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
              
              {/* Hour labels */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '28px repeat(24, 1fr)',
                marginTop: '2px',
                fontSize: '9px',
                color: 'var(--text-muted)'
              }}>
                <div>UTC</div>
                {[0, '', '', 3, '', '', 6, '', '', 9, '', '', 12, '', '', 15, '', '', 18, '', '', 21, '', ''].map((h, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>{h}</div>
                ))}
              </div>
              
              {/* Legend */}
              <div style={{ 
                marginTop: '6px', 
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '11px'
              }}>
                <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>REL:</span>
                  {['#004400', '#ff0000', '#ff6600', '#ffcc00', '#88cc00', '#00aa00'].map((c, i) => (
                    <div key={i} style={{ width: '8px', height: '8px', background: c, borderRadius: '1px' }} />
                  ))}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  {Math.round(distance || 0)}km • {ionospheric?.foF2 ? `foF2=${ionospheric.foF2}` : `SSN=${solarData?.ssn}`}
                </div>
              </div>
            </div>
          ) : (
            /* Bar Chart View */
            <div style={{ fontSize: '13px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-around',
                padding: '4px',
                marginBottom: '4px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                fontSize: '11px'
              }}>
                <span><span style={{ color: 'var(--text-muted)' }}>SFI </span><span style={{ color: 'var(--accent-amber)' }}>{solarData?.sfi}</span></span>
                {ionospheric?.foF2 ? (
                  <span><span style={{ color: 'var(--text-muted)' }}>foF2 </span><span style={{ color: '#00ff88' }}>{ionospheric.foF2}</span></span>
                ) : (
                  <span><span style={{ color: 'var(--text-muted)' }}>SSN </span><span style={{ color: 'var(--accent-cyan)' }}>{solarData?.ssn}</span></span>
                )}
                <span><span style={{ color: 'var(--text-muted)' }}>K </span><span style={{ color: solarData?.kIndex >= 4 ? '#ff4444' : '#00ff88' }}>{solarData?.kIndex}</span></span>
              </div>
              
              {(currentBands || []).slice(0, 11).map((band) => (
                <div key={band.band} style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '32px 1fr 40px', 
                  gap: '4px',
                  padding: '2px 0',
                  alignItems: 'center'
                }}>
                  <span style={{ 
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '12px',
                    color: band.reliability >= 50 ? 'var(--accent-green)' : 'var(--text-muted)'
                  }}>
                    {band.band}
                  </span>
                  <div style={{ position: 'relative', height: '10px', background: 'var(--bg-tertiary)', borderRadius: '2px' }}>
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      height: '100%',
                      width: `${band.reliability}%`,
                      background: getReliabilityColor(band.reliability),
                      borderRadius: '2px'
                    }} />
                  </div>
                  <span style={{ 
                    textAlign: 'right',
                    fontSize: '12px',
                    color: getStatusColor(band.status)
                  }}>
                    {band.reliability}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PropagationPanel;
