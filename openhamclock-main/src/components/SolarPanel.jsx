/**
 * SolarPanel Component
 * Cycles between: Solar Image → Solar Indices → X-Ray Flux Chart → Lunar Phase
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getMoonPhase } from '../utils/geo.js';

const MODES = ['image', 'indices', 'xray', 'lunar'];
const MODE_LABELS = { image: 'SOLAR', indices: 'SOLAR INDICES', xray: 'X-RAY FLUX', lunar: 'LUNAR' };
const MODE_ICONS = { image: '◫', indices: '⊞', xray: '☽', lunar: '☼' };
const MODE_TITLES = { image: 'Show solar indices', indices: 'Show X-ray flux', xray: 'Show lunar phase', lunar: 'Show solar image' };

// Flare class from flux value (W/m²)
const getFlareClass = (flux) => {
  if (!flux || flux <= 0) return { letter: '?', color: '#666', level: 0 };
  if (flux >= 1e-4) return { letter: 'X', color: '#ff0000', level: 4 };
  if (flux >= 1e-5) return { letter: 'M', color: '#ff6600', level: 3 };
  if (flux >= 1e-6) return { letter: 'C', color: '#ffcc00', level: 2 };
  if (flux >= 1e-7) return { letter: 'B', color: '#00cc88', level: 1 };
  return { letter: 'A', color: '#4488ff', level: 0 };
};

// Format flux value for display
const formatFlux = (flux) => {
  if (!flux || flux <= 0) return '--';
  const cls = getFlareClass(flux);
  const base = flux >= 1e-4 ? flux / 1e-4 :
               flux >= 1e-5 ? flux / 1e-5 :
               flux >= 1e-6 ? flux / 1e-6 :
               flux >= 1e-7 ? flux / 1e-7 : flux / 1e-8;
  return `${cls.letter}${base.toFixed(1)}`;
};

export const SolarPanel = ({ solarIndices, forcedMode }) => {
  const [internalMode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_solarPanelMode');
      if (MODES.includes(saved)) return saved;
      if (saved === 'indices') return 'indices';
      return 'image';
    } catch (e) { return 'image'; }
  });

  // When forcedMode is set, lock to that mode (used by dockable sub-panels)
  const mode = forcedMode && MODES.includes(forcedMode) ? forcedMode : internalMode;
  const [imageType, setImageType] = useState(() => {
    try { return localStorage.getItem('openhamclock_solarImageType') || '0193'; } catch { return '0193'; }
  });
  const [xrayData, setXrayData] = useState(null);
  const [xrayLoading, setXrayLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Refresh solar image every 15 minutes and retry on error
  const [imageTimestamp, setImageTimestamp] = useState(() => Math.floor(Date.now() / 900000) * 900000);
  useEffect(() => {
    // Refresh every 15 minutes to get latest SDO image
    const interval = setInterval(() => {
      setImageTimestamp(Math.floor(Date.now() / 900000) * 900000);
      setImageError(false); // Reset error state on refresh
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Retry failed image loads after 30 seconds
  useEffect(() => {
    if (!imageError || mode !== 'image') return;
    const retry = setTimeout(() => {
      setImageTimestamp(Date.now()); // Force new URL to bypass cache
      setImageError(false);
    }, 30000);
    return () => clearTimeout(retry);
  }, [imageError, mode]);
  
  const cycleMode = () => {
    const nextIdx = (MODES.indexOf(mode) + 1) % MODES.length;
    const next = MODES[nextIdx];
    setMode(next);
    try { localStorage.setItem('openhamclock_solarPanelMode', next); } catch (e) {}
  };

  // Fetch X-ray data when xray mode is active
  const fetchXray = useCallback(async () => {
    try {
      setXrayLoading(true);
      const res = await fetch('/api/noaa/xray');
      if (res.ok) {
        const data = await res.json();
        // Filter to 0.1-0.8nm (long wavelength, standard for flare classification)
        const filtered = data.filter(d => d.energy === '0.1-0.8nm' && d.flux > 0);
        setXrayData(filtered);
      }
    } catch (err) {
      console.error('X-ray fetch error:', err);
    } finally {
      setXrayLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'xray') {
      fetchXray();
      const interval = setInterval(fetchXray, 5 * 60 * 1000); // 5 min refresh
      return () => clearInterval(interval);
    }
  }, [mode, fetchXray]);
  
  const imageTypes = {
    '0193': { name: 'AIA 193Å', desc: 'Corona' },
    '0304': { name: 'AIA 304Å', desc: 'Chromosphere' },
    '0171': { name: 'AIA 171Å', desc: 'Quiet Corona' },
    '0094': { name: 'AIA 94Å', desc: 'Flaring' },
    'HMIIC': { name: 'HMI Int', desc: 'Visible' }
  };
  
  const imageUrl = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_${imageType}.jpg?t=${imageTimestamp}`;
  
  const getKpColor = (value) => {
    if (value >= 7) return '#ff0000';
    if (value >= 5) return '#ff6600';
    if (value >= 4) return '#ffcc00';
    if (value >= 3) return '#88cc00';
    return '#00ff88';
  };

  const kpData = solarIndices?.data?.kp || solarIndices?.data?.kIndex;

  // X-Ray flux chart renderer
  const renderXrayChart = () => {
    if (xrayLoading && !xrayData) {
      return <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>Loading X-ray data...</div>;
    }
    if (!xrayData || xrayData.length === 0) {
      return <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>No X-ray data available</div>;
    }

    // Use last ~360 points (~6 hours at 1-min resolution)
    const points = xrayData.slice(-360);
    const currentFlux = points[points.length - 1]?.flux;
    const currentClass = getFlareClass(currentFlux);
    const peakFlux = Math.max(...points.map(p => p.flux));
    const peakClass = getFlareClass(peakFlux);

    // Chart dimensions
    const W = 280, H = 130;
    const padL = 28, padR = 6, padT = 8, padB = 18;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    // Log scale: 1e-8 (A1.0) to 1e-3 (X10)
    const logMin = -8, logMax = -3;
    const logRange = logMax - logMin;
    
    const fluxToY = (flux) => {
      if (!flux || flux <= 0) return padT + chartH;
      const log = Math.log10(flux);
      const clamped = Math.max(logMin, Math.min(logMax, log));
      return padT + chartH - ((clamped - logMin) / logRange) * chartH;
    };

    // Build SVG path
    const pathD = points.map((p, i) => {
      const x = padL + (i / (points.length - 1)) * chartW;
      const y = fluxToY(p.flux);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    // Gradient fill path
    const fillD = pathD + ` L${(padL + chartW).toFixed(1)},${(padT + chartH).toFixed(1)} L${padL},${(padT + chartH).toFixed(1)} Z`;

    // Flare class threshold lines
    const thresholds = [
      { flux: 1e-7, label: 'B', color: '#00cc88' },
      { flux: 1e-6, label: 'C', color: '#ffcc00' },
      { flux: 1e-5, label: 'M', color: '#ff6600' },
      { flux: 1e-4, label: 'X', color: '#ff0000' }
    ];

    // Time labels
    const firstTime = new Date(points[0]?.time_tag);
    const lastTime = new Date(points[points.length - 1]?.time_tag);
    const midTime = new Date((firstTime.getTime() + lastTime.getTime()) / 2);
    const fmt = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

    return (
      <div>
        {/* Current level display */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '6px',
          padding: '4px 8px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px'
        }}>
          <div>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Current </span>
            <span style={{ 
              fontSize: '18px', fontWeight: '700', color: currentClass.color,
              fontFamily: 'Orbitron, monospace'
            }}>
              {formatFlux(currentFlux)}
            </span>
          </div>
          <div>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>6h Peak </span>
            <span style={{ 
              fontSize: '14px', fontWeight: '600', color: peakClass.color,
              fontFamily: 'Orbitron, monospace'
            }}>
              {formatFlux(peakFlux)}
            </span>
          </div>
        </div>

        {/* SVG Chart */}
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
          style={{ background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
          
          {/* Flare class background bands */}
          {thresholds.map((t, i) => {
            const y1 = fluxToY(t.flux);
            const y0 = i === 0 ? padT + chartH : fluxToY(thresholds[i - 1].flux);
            return (
              <rect key={t.label} x={padL} y={y1} width={chartW} height={y0 - y1}
                fill={t.color} opacity={0.06} />
            );
          })}
          {/* X class band to top */}
          <rect x={padL} y={padT} width={chartW} 
            height={fluxToY(1e-4) - padT} fill="#ff0000" opacity={0.06} />

          {/* Threshold lines */}
          {thresholds.map(t => {
            const y = fluxToY(t.flux);
            return (
              <g key={t.label}>
                <line x1={padL} y1={y} x2={padL + chartW} y2={y}
                  stroke={t.color} strokeWidth="0.5" strokeDasharray="3,3" opacity={0.5} />
                <text x={padL + 2} y={y - 2} fill={t.color} fontSize="8" fontWeight="600"
                  fontFamily="JetBrains Mono, monospace">{t.label}</text>
              </g>
            );
          })}

          {/* Gradient fill under curve */}
          <defs>
            <linearGradient id="xrayGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={currentClass.color} stopOpacity="0.4" />
              <stop offset="100%" stopColor={currentClass.color} stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <path d={fillD} fill="url(#xrayGrad)" />

          {/* Flux line */}
          <path d={pathD} fill="none" stroke={currentClass.color} strokeWidth="1.5" />

          {/* Time axis labels */}
          <text x={padL} y={H - 2} fill="var(--text-muted, #888)" fontSize="8"
            fontFamily="JetBrains Mono, monospace">{fmt(firstTime)}</text>
          <text x={padL + chartW / 2} y={H - 2} fill="var(--text-muted, #888)" fontSize="8"
            fontFamily="JetBrains Mono, monospace" textAnchor="middle">{fmt(midTime)}</text>
          <text x={padL + chartW} y={H - 2} fill="var(--text-muted, #888)" fontSize="8"
            fontFamily="JetBrains Mono, monospace" textAnchor="end">{fmt(lastTime)} UTC</text>
        </svg>

        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '3px', textAlign: 'center' }}>
          GOES • 0.1–0.8nm • 6hr
        </div>
      </div>
    );
  };

  // Lunar phase renderer
  const renderLunar = () => {
    const now = new Date();
    const phase = getMoonPhase(now); // 0-1, 0=new, 0.5=full
    const illumination = Math.round((1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100);
    
    // Phase name
    let phaseName = 'New Moon';
    if (phase >= 0.0625 && phase < 0.1875) phaseName = 'Waxing Crescent';
    else if (phase >= 0.1875 && phase < 0.3125) phaseName = 'First Quarter';
    else if (phase >= 0.3125 && phase < 0.4375) phaseName = 'Waxing Gibbous';
    else if (phase >= 0.4375 && phase < 0.5625) phaseName = 'Full Moon';
    else if (phase >= 0.5625 && phase < 0.6875) phaseName = 'Waning Gibbous';
    else if (phase >= 0.6875 && phase < 0.8125) phaseName = 'Last Quarter';
    else if (phase >= 0.8125 && phase < 0.9375) phaseName = 'Waning Crescent';

    // Find next full moon & new moon by scanning forward
    const findNextPhase = (targetPhase, label) => {
      const d = new Date(now);
      for (let i = 1; i <= 35; i++) {
        d.setDate(d.getDate() + 1);
        const p = getMoonPhase(d);
        const diff = Math.abs(p - targetPhase);
        if (diff < 0.018 || diff > 0.982) {
          return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
      }
      return '—';
    };
    const nextFull = findNextPhase(0.5, 'Full');
    const nextNew = findNextPhase(0.0, 'New');

    // SVG moon — uses a crescent/gibbous mask technique
    // phase 0=new(dark), 0.25=first quarter(right lit), 0.5=full(all lit), 0.75=last quarter(left lit)
    const R = 60; // moon radius
    const CX = 70, CY = 70;
    
    // The terminator curve is an ellipse whose x-radius varies with phase
    // At new moon (0): fully dark. At full (0.5): fully lit.
    // phase 0-0.5: right side lit (waxing), 0.5-1: left side lit (waning)
    const angle = phase * 2 * Math.PI;
    const terminatorX = R * Math.cos(angle); // ranges from R (new) through 0 (quarter) to -R (full) and back

    // Build the lit area path
    // Right half arc (from top to bottom) is always an arc of radius R
    // Left boundary (terminator) is an ellipse with rx = |terminatorX|
    const buildMoonPath = () => {
      // Lit portion: we draw two arcs — the outer limb and the terminator
      // For waxing (0 < phase < 0.5): right side is lit
      // For waning (0.5 < phase < 1): left side is lit
      
      if (phase < 0.01 || phase > 0.99) {
        // New moon — no lit area
        return null;
      }
      if (phase > 0.49 && phase < 0.51) {
        // Full moon — entire circle lit
        return `M${CX},${CY - R} A${R},${R} 0 1,1 ${CX},${CY + R} A${R},${R} 0 1,1 ${CX},${CY - R}`;
      }
      
      const absTermX = Math.abs(terminatorX);
      
      if (phase < 0.5) {
        // Waxing — right side lit
        // Outer arc: top to bottom along right limb (sweep=1, clockwise)
        // Terminator: bottom to top (elliptical arc)
        const sweepTerminator = phase < 0.25 ? 1 : 0; // concave before quarter, convex after
        return `M${CX},${CY - R} A${R},${R} 0 0,1 ${CX},${CY + R} A${absTermX},${R} 0 0,${sweepTerminator} ${CX},${CY - R}`;
      } else {
        // Waning — left side lit
        // Outer arc: top to bottom along left limb (sweep=0, counter-clockwise)
        // Terminator: bottom to top
        const sweepTerminator = phase > 0.75 ? 1 : 0;
        return `M${CX},${CY - R} A${R},${R} 0 0,0 ${CX},${CY + R} A${absTermX},${R} 0 0,${sweepTerminator} ${CX},${CY - R}`;
      }
    };
    
    const litPath = buildMoonPath();

    return (
      <div>
        {/* Moon SVG */}
        <div style={{ textAlign: 'center', marginBottom: '6px' }}>
          <svg width="140" height="140" viewBox="0 0 140 140" style={{ display: 'block', margin: '0 auto' }}>
            <defs>
              {/* Crater texture */}
              <radialGradient id="moonSurface" cx="40%" cy="35%" r="60%">
                <stop offset="0%" stopColor="#e8e4d8" />
                <stop offset="100%" stopColor="#c8c0ae" />
              </radialGradient>
              <radialGradient id="crater1" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#b0a898" />
                <stop offset="100%" stopColor="#c4bca8" />
              </radialGradient>
              {/* Clip to circle */}
              <clipPath id="moonClip">
                <circle cx={CX} cy={CY} r={R} />
              </clipPath>
            </defs>
            
            {/* Dark side (always full circle, dark) */}
            <circle cx={CX} cy={CY} r={R} fill="#1a1a2e" stroke="#333" strokeWidth="1.5" />
            
            {/* Lit surface with craters — clipped to lit path */}
            {litPath && (
              <g clipPath="url(#moonClip)">
                <path d={litPath} fill="url(#moonSurface)" />
                {/* Mare (dark patches) */}
                <ellipse cx={CX - 12} cy={CY - 8} rx="18" ry="14" fill="#b8b0a0" opacity="0.5" clipPath="url(#moonClip)" />
                <ellipse cx={CX + 15} cy={CY + 10} rx="12" ry="10" fill="#b0a898" opacity="0.4" clipPath="url(#moonClip)" />
                <ellipse cx={CX - 5} cy={CY + 20} rx="14" ry="8" fill="#ada598" opacity="0.35" clipPath="url(#moonClip)" />
                {/* Craters */}
                <circle cx={CX + 20} cy={CY - 20} r="6" fill="url(#crater1)" opacity="0.5" />
                <circle cx={CX - 25} cy={CY + 5} r="4" fill="url(#crater1)" opacity="0.4" />
                <circle cx={CX + 8} cy={CY + 25} r="5" fill="url(#crater1)" opacity="0.45" />
                <circle cx={CX - 10} cy={CY - 25} r="3.5" fill="url(#crater1)" opacity="0.35" />
                <circle cx={CX + 25} cy={CY + 5} r="3" fill="url(#crater1)" opacity="0.3" />
              </g>
            )}
            
            {/* Subtle glow */}
            <circle cx={CX} cy={CY} r={R + 3} fill="none" stroke="rgba(200,200,180,0.1)" strokeWidth="4" />
          </svg>
        </div>
        
        {/* Phase info */}
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>{phaseName}</div>
          <div style={{ fontSize: '12px', color: 'var(--accent-amber)', fontFamily: 'Orbitron, monospace', marginTop: '2px' }}>
            {illumination}% illuminated
          </div>
        </div>
        
        {/* Next phases */}
        <div style={{ 
          display: 'flex', gap: '8px', justifyContent: 'center',
          fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
        }}>
          <div style={{ 
            background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '4px 8px', textAlign: 'center',
          }}>
            <div style={{ color: 'var(--text-muted)' }}>● New</div>
            <div style={{ color: 'var(--text-secondary)', fontWeight: '600' }}>{nextNew}</div>
          </div>
          <div style={{ 
            background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '4px 8px', textAlign: 'center',
          }}>
            <div style={{ color: 'var(--text-muted)' }}>○ Full</div>
            <div style={{ color: 'var(--text-secondary)', fontWeight: '600' }}>{nextFull}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '8px',
      boxSizing: 'border-box'
    }}>
      {/* Header with cycle button */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '6px',
        flexShrink: 0
      }}>
        <span style={{ fontSize: '12px', color: mode === 'lunar' ? 'var(--accent-purple)' : 'var(--accent-amber)', fontWeight: '700' }}>
          {mode === 'lunar' ? '🌙' : '☀'} {MODE_LABELS[mode]}
        </span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {mode === 'image' && (
            <select 
              value={imageType}
              onChange={(e) => { setImageType(e.target.value); setImageError(false); try { localStorage.setItem('openhamclock_solarImageType', e.target.value); } catch {} }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                fontSize: '10px',
                padding: '2px 4px',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              {Object.entries(imageTypes).map(([key, val]) => (
                <option key={key} value={key}>{val.desc}</option>
              ))}
            </select>
          )}
          {!forcedMode && (
          <button
            onClick={cycleMode}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
            title={MODE_TITLES[mode]}
          >
            {MODE_ICONS[mode]}
          </button>
          )}
        </div>
      </div>
      
      {mode === 'indices' ? (
        /* Solar Indices View */
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {solarIndices?.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* SFI Row */}
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ minWidth: '60px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>SFI</div>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#ff8800', fontFamily: 'Orbitron, monospace' }}>
                    {solarIndices.data.sfi?.current || '--'}
                  </div>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', lineHeight: 1.2 }}>
                    {(() => {
                      const v = solarIndices.data.sfi?.current;
                      if (!v) return '';
                      if (v >= 150) return 'Excellent';
                      if (v >= 120) return 'Good';
                      if (v >= 90) return 'Fair';
                      if (v >= 70) return 'Poor';
                      return 'Very Poor';
                    })()}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  {solarIndices.data.sfi?.history?.length > 0 ? (
                    <div>
                      <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '1px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>10.7cm Solar Flux — 20-day trend</span>
                        <span>{(() => { const h = solarIndices.data.sfi.history.slice(-20); const vals = h.map(d => d.value); return `${Math.min(...vals)}–${Math.max(...vals)}`; })()}</span>
                      </div>
                      <svg width="100%" height="30" viewBox="0 0 100 30" preserveAspectRatio="none">
                        {(() => {
                          const data = solarIndices.data.sfi.history.slice(-20);
                          const values = data.map(d => d.value);
                          const max = Math.max(...values, 1);
                          const min = Math.min(...values);
                          const range = max - min || 1;
                          const points = data.map((d, i) => {
                            const x = (i / (data.length - 1)) * 100;
                            const y = 30 - ((d.value - min) / range) * 25;
                            return `${x},${y}`;
                          }).join(' ');
                          return <polyline points={points} fill="none" stroke="#ff8800" strokeWidth="1.5" />;
                        })()}
                      </svg>
                    </div>
                  ) : (
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                      10.7cm radio flux from the sun.<br/>Higher = better HF propagation.<br/>70 poor · 120+ good · 150+ excellent
                    </div>
                  )}
                </div>
              </div>
              
              {/* K-Index Row */}
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ minWidth: '60px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>K-Index</div>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: getKpColor(kpData?.current), fontFamily: 'Orbitron, monospace' }}>
                    {kpData?.current ?? '--'}
                  </div>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', lineHeight: 1.2 }}>
                    {(() => {
                      const v = kpData?.current;
                      if (v == null) return '';
                      if (v >= 7) return 'Storm!';
                      if (v >= 5) return 'Storm';
                      if (v >= 4) return 'Unsettled';
                      if (v >= 2) return 'Quiet';
                      return 'Very Quiet';
                    })()}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  {kpData?.forecast?.length > 0 ? (
                    <div>
                      <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                        Geomagnetic 3hr forecast — low is better for HF
                      </div>
                      <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '30px' }}>
                        {kpData.forecast.slice(0, 8).map((item, i) => {
                          const val = typeof item === 'object' ? item.value : item;
                          return (
                            <div key={i} style={{
                              flex: 1,
                              height: `${Math.max(10, (val / 9) * 100)}%`,
                              background: getKpColor(val),
                              borderRadius: '2px',
                              opacity: 0.8
                            }} title={`Kp ${val}`} />
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', fontSize: '7px', color: 'var(--text-muted)', marginTop: '1px' }}>
                        <span>Now</span><span style={{ marginLeft: 'auto' }}>+24h</span>
                      </div>
                    </div>
                  ) : kpData?.history?.length > 0 ? (
                    <div>
                      <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                        Geomagnetic activity — recent 3hr periods
                      </div>
                      <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '30px' }}>
                        {kpData.history.slice(-8).map((item, i) => {
                          const val = typeof item === 'object' ? item.value : item;
                          return (
                            <div key={i} style={{
                              flex: 1,
                              height: `${Math.max(10, (val / 9) * 100)}%`,
                              background: getKpColor(val),
                              borderRadius: '2px',
                              opacity: 0.8
                            }} title={`Kp ${val}`} />
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', fontSize: '7px', color: 'var(--text-muted)', marginTop: '1px' }}>
                        <span>-24h</span><span style={{ marginLeft: 'auto' }}>Now</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                      Geomagnetic disturbance (0–9).<br/>Low K = stable ionosphere, good HF.<br/>K≥5 = geomagnetic storm, HF disrupted.
                    </div>
                  )}
                </div>
              </div>
              
              {/* SSN Row */}
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ minWidth: '60px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>SSN</div>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#aa88ff', fontFamily: 'Orbitron, monospace' }}>
                    {solarIndices.data.ssn?.current || '--'}
                  </div>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', lineHeight: 1.2 }}>
                    {(() => {
                      const v = solarIndices.data.ssn?.current;
                      if (!v) return '';
                      if (v >= 150) return 'Very High';
                      if (v >= 100) return 'High';
                      if (v >= 50) return 'Moderate';
                      if (v >= 20) return 'Low';
                      return 'Very Low';
                    })()}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  {solarIndices.data.ssn?.history?.length > 0 ? (
                    <div>
                      <div style={{ fontSize: '8px', color: 'var(--text-muted)', marginBottom: '1px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Sunspot Number — 20-day trend</span>
                        <span>{(() => { const h = solarIndices.data.ssn.history.slice(-20); const vals = h.map(d => d.value); return `${Math.min(...vals)}–${Math.max(...vals)}`; })()}</span>
                      </div>
                      <svg width="100%" height="30" viewBox="0 0 100 30" preserveAspectRatio="none">
                        {(() => {
                          const data = solarIndices.data.ssn.history.slice(-20);
                          const values = data.map(d => d.value);
                          const max = Math.max(...values, 1);
                          const min = Math.min(...values, 0);
                          const range = max - min || 1;
                          const points = data.map((d, i) => {
                            const x = (i / (data.length - 1)) * 100;
                            const y = 30 - ((d.value - min) / range) * 25;
                            return `${x},${y}`;
                          }).join(' ');
                          return <polyline points={points} fill="none" stroke="#aa88ff" strokeWidth="1.5" />;
                        })()}
                      </svg>
                    </div>
                  ) : (
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                      Daily sunspot count.<br/>More sunspots = more ionization = better HF.<br/>Tracks the 11-year solar cycle.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
              Loading solar data...
            </div>
          )}
        </div>
      ) : mode === 'xray' ? (
        /* X-Ray Flux Chart View */
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {renderXrayChart()}
        </div>
      ) : mode === 'lunar' ? (
        /* Lunar Phase View */
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {renderLunar()}
        </div>
      ) : (
        /* Solar Image View */
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 0,
          overflow: 'hidden'
        }}>
          {imageError ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>☀️</div>
              <div style={{ fontSize: '10px' }}>Retrying...</div>
            </div>
          ) : (
            <img
              src={imageUrl}
              alt="SDO Solar Image"
              style={{
                maxHeight: '100%',
                maxWidth: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '50%',
                border: '2px solid var(--border-color)'
              }}
              onError={() => setImageError(true)}
              onLoad={() => setImageError(false)}
            />
          )}
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', flexShrink: 0 }}>
            SDO/AIA • Live from NASA
          </div>
        </div>
      )}
    </div>
  );
};

export default SolarPanel;
