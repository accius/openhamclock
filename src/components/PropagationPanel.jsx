/**
 * PropagationPanel Component (VOACAP)
 * Toggleable between heatmap chart, bar chart, and band conditions view
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistance } from '../utils/geo.js';
import { saveConfig, loadConfig } from '../utils/config.js';
import BandHealthPanel from './BandHealthPanel.jsx';
import useAutoRotate from '../hooks/app/useAutoRotate.js';

const MODES = ['SSB', 'CW', 'FT8', 'FT4', 'WSPR', 'JS8', 'RTTY', 'AM'];
const POWERS = [5, 10, 25, 50, 100, 200, 500, 1000, 1500];

export const PropagationPanel = ({
  propagation,
  loading,
  bandConditions,
  forcedMode,
  allUnits = { dist: 'imperial', temp: 'imperial', press: 'imperial' },
  propConfig = {},
  dxSpots,
  clusterFilters,
  deSunTimes,
  currentTime,
}) => {
  const { t } = useTranslation();

  // Local state for inline controls — initialized from prop, synced back on change
  const [localMode, setLocalMode] = useState(propConfig.mode || 'SSB');
  const [localPower, setLocalPower] = useState(propConfig.power || 100);
  const [localAntenna, setLocalAntenna] = useState(propConfig.antenna || 'isotropic');

  // Keep local state in sync if parent config changes (e.g. settings panel update)
  useEffect(() => {
    if (propConfig.mode && propConfig.mode !== localMode) setLocalMode(propConfig.mode);
  }, [propConfig.mode]);
  useEffect(() => {
    if (propConfig.power && propConfig.power !== localPower) setLocalPower(propConfig.power);
  }, [propConfig.power]);
  useEffect(() => {
    if (propConfig.antenna && propConfig.antenna !== localAntenna) setLocalAntenna(propConfig.antenna);
  }, [propConfig.antenna]);

  // Antenna profiles fetched from server
  const [antennaProfiles, setAntennaProfiles] = useState(null);
  useEffect(() => {
    fetch('/api/propagation/antennas')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setAntennaProfiles(data);
      })
      .catch(() => {});
  }, []);

  // Update propagation config (mode, power, antenna) — update local state + persist
  const updatePropConfig = useCallback((updates) => {
    if (updates.mode != null) setLocalMode(updates.mode);
    if (updates.power != null) setLocalPower(updates.power);
    if (updates.antenna != null) setLocalAntenna(updates.antenna);
    const cfg = loadConfig();
    cfg.propagation = { ...cfg.propagation, ...updates };
    saveConfig(cfg);
  }, []);

  // Load view mode preference from localStorage
  const [internalViewMode, setViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_voacapViewMode');
      if (saved === 'bars' || saved === 'bands') return saved;
      return 'chart';
    } catch (e) {
      return 'chart';
    }
  });

  // When forcedMode is set, lock to that mode (used by dockable sub-panels)
  const viewMode = forcedMode || internalViewMode;

  // Color scheme: 'stoplight' (green=good, default) or 'heatmap' (red=good, VOACAP traditional)
  const [colorScheme, setColorScheme] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_voacapColorScheme');
      if (saved === 'heatmap') return 'heatmap';
      return 'stoplight';
    } catch (e) {
      return 'stoplight';
    }
  });

  const toggleColorScheme = (e) => {
    e.stopPropagation();
    const newScheme = colorScheme === 'stoplight' ? 'heatmap' : 'stoplight';
    setColorScheme(newScheme);
    try {
      localStorage.setItem('openhamclock_voacapColorScheme', newScheme);
    } catch (e) {}
  };

  // Cycle through view modes
  const modes = ['chart', 'bars', 'bands', 'health'];
  const cycleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const currentIdx = modes.indexOf(prev);
      const newMode = modes[(currentIdx + 1) % modes.length];
      try {
        localStorage.setItem('openhamclock_voacapViewMode', newMode);
      } catch (e) {}
      return newMode;
    });
  }, []);

  // Auto-rotate through views on a timer
  const rotate = useAutoRotate('propPanel', { onTick: cycleViewMode, itemCount: modes.length });

  const getBandStyle = (condition) =>
    ({
      GOOD: { bg: 'rgba(0,255,136,0.2)', color: '#00ff88', border: 'rgba(0,255,136,0.4)' },
      FAIR: { bg: 'rgba(255,180,50,0.2)', color: '#ffb432', border: 'rgba(255,180,50,0.4)' },
      POOR: { bg: 'rgba(255,68,102,0.2)', color: '#ff4466', border: 'rgba(255,68,102,0.4)' },
    })[condition] || { bg: 'rgba(255,180,50,0.2)', color: '#ffb432', border: 'rgba(255,180,50,0.4)' };

  if (loading || !propagation) {
    return (
      <div className="panel">
        <div className="panel-header">⌇ VOACAP</div>
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          {t('propagation.loading')}
        </div>
      </div>
    );
  }

  const { solarData, distance, currentBands, hourlyPredictions, muf, luf, dataSource } = propagation;
  const currentHour = propagation.currentHour ?? new Date().getUTCHours();
  const isDaytime =
    deSunTimes.sunset > deSunTimes.sunrise
      ? currentTime.getUTCHours() >= deSunTimes.sunrise && currentTime.getUTCHours() <= deSunTimes.sunset()
      : !(currentTime.getUTCHours() >= deSunTimes.sunset && currentTime.getUTCHours() <= deSunTimes.sunrise());

  // Heat map colors - supports both schemes
  // Stoplight: green=good, red=bad (intuitive)
  // Heatmap: red=good, green=bad (traditional VOACAP)
  const getHeatColor = (rel) => {
    if (colorScheme === 'heatmap') {
      // Traditional VOACAP: red=good, green=poor
      if (rel >= 80) return '#ff0000';
      if (rel >= 60) return '#ff6600';
      if (rel >= 40) return '#ffcc00';
      if (rel >= 20) return '#88cc00';
      if (rel >= 10) return '#00aa00';
      return '#004400';
    }
    // Stoplight: green=good, red=bad
    if (rel >= 80) return '#00cc00';
    if (rel >= 60) return '#55bb00';
    if (rel >= 40) return '#ffcc00';
    if (rel >= 20) return '#ff6600';
    if (rel >= 10) return '#cc2200';
    return '#441111';
  };

  // Legend colors (must match getHeatColor order low→high)
  const legendColors =
    colorScheme === 'heatmap'
      ? ['#004400', '#00aa00', '#88cc00', '#ffcc00', '#ff6600', '#ff0000']
      : ['#441111', '#cc2200', '#ff6600', '#ffcc00', '#55bb00', '#00cc00'];

  const getReliabilityColor = (rel) => {
    if (rel >= 70) return '#00ff88';
    if (rel >= 50) return '#88ff00';
    if (rel >= 30) return '#ffcc00';
    if (rel >= 15) return '#ff8800';
    return '#ff4444';
  };

  const translateCondition = (cond) => {
    switch (cond) {
      case 'GOOD':
        return t('band.conditions.good');
      case 'FAIR':
        return t('band.conditions.fair');
      case 'POOR':
        return t('band.conditions.poor');
      default:
        return cond;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'EXCELLENT':
        return '#00ff88';
      case 'GOOD':
        return '#88ff00';
      case 'FAIR':
        return '#ffcc00';
      case 'POOR':
        return '#ff8800';
      case 'CLOSED':
        return '#ff4444';
      default:
        return 'var(--text-muted)';
    }
  };

  const bands = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];
  const viewModeLabels = {
    chart: t('propagation.view.chart'),
    bars: t('propagation.view.bars'),
    bands: t('propagation.view.bands'),
    health: 'Band Health',
  };

  return (
    <div className="panel">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {viewMode === 'bands' ? t('band.conditions') : viewMode === 'health' ? '📶 Band Health' : '⌇ VOACAP'}
          {viewMode === 'bands' &&
            bandConditions?.extras?.stale &&
            bandConditions.extras.fetchedAt != null &&
            (() => {
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
                  }}
                >
                  {t('band.conditions.stale.label', { mins })}
                </span>
              );
            })()}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {!forcedMode && (
            <span
              onClick={cycleViewMode}
              style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '1px 6px',
                borderRadius: '3px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                userSelect: 'none',
              }}
              title={t('propagation.view.toggle')}
            >
              {viewModeLabels[viewMode]} ▸
            </span>
          )}
          {/* Auto-rotate controls */}
          {!forcedMode && (
            <span
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', cursor: 'default' }}
            >
              {rotate.enabled && (
                <select
                  value={rotate.interval}
                  onChange={(e) => rotate.setInterval(e.target.value)}
                  style={{
                    fontSize: '9px',
                    padding: '1px 2px',
                    background: 'var(--bg-secondary)',
                    color: 'var(--accent-amber)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '3px',
                    outline: 'none',
                    cursor: 'pointer',
                    width: '42px',
                  }}
                >
                  {rotate.INTERVAL_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}s
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={rotate.toggle}
                title={rotate.enabled ? 'Stop auto-rotate' : 'Auto-rotate views'}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: '0 2px',
                  color: rotate.enabled ? 'var(--accent-amber)' : 'var(--text-muted)',
                  lineHeight: 1,
                }}
              >
                {rotate.enabled ? '⏸' : '▶'}
              </button>
            </span>
          )}
        </span>
      </div>

      {/* Mode & Power indicator */}
      {(propConfig.mode || propConfig.power) && viewMode !== 'bands' && viewMode !== 'health' && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
            padding: '2px 0 4px',
            fontSize: '10px',
            color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border-color)',
            marginBottom: '4px',
          }}
        >
          <span style={{ color: 'var(--accent-amber)' }}>{propConfig.mode || 'SSB'}</span>
          <span>•</span>
          <span>
            {(propConfig.power || 100) >= 1000
              ? `${((propConfig.power || 100) / 1000).toFixed(1)}kW`
              : `${propConfig.power || 100}W`}
          </span>
          {propagation?.signalMargin !== undefined && propagation.signalMargin !== 0 && (
            <>
              <span>•</span>
              <span style={{ color: propagation.signalMargin > 0 ? '#00ff88' : '#ff6644' }}>
                {propagation.signalMargin > 0 ? '+' : ''}
                {propagation.signalMargin}dB
              </span>
            </>
          )}
        </div>
      )}

      {viewMode === 'bands' ? (
        /* Band Conditions Grid View - N0NBH Data */
        <div style={{ padding: '4px' }}>
          {/* Day/Night toggle indicator */}
          {bandConditions?.extras?.source && (
            <div
              style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '4px', fontSize: '10px' }}
            >
              <span style={{ color: isDaytime ? '#ffcc00' : 'var(--text-muted)' }}>
                ☀ {t('propagation.day')} {isDaytime ? `(${t('propagation.now')})` : ''}
              </span>
              <span style={{ color: !isDaytime ? '#88aaff' : 'var(--text-muted)' }}>
                ☾ {t('propagation.night')} {!isDaytime ? `(${t('propagation.now')})` : ''}
              </span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
            {(bandConditions?.data || []).slice(0, 12).map((band, idx) => {
              const style = getBandStyle(band.condition);
              const translatedCond = translateCondition(band.condition);
              return (
                <div
                  key={idx}
                  style={{
                    background: style.bg,
                    border: `1px solid ${style.border}`,
                    borderRadius: '4px',
                    padding: '6px 2px',
                    textAlign: 'center',
                  }}
                  title={`${band.band}: ${t('propagation.day')}=${band.day || band.condition} ${t('propagation.night')}=${band.night || band.condition}`}
                >
                  <div
                    style={{
                      fontFamily: 'Orbitron, monospace',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: style.color,
                    }}
                  >
                    {band.band}
                  </div>
                  <div
                    style={{ fontSize: '9px', fontWeight: '600', color: style.color, marginTop: '2px', opacity: 0.8 }}
                  >
                    {translatedCond}
                  </div>
                  {/* Day/Night mini indicator when both are available */}
                  {band.day && band.night && band.day !== band.night && (
                    <div style={{ fontSize: '7px', color: 'var(--text-muted)', marginTop: '1px' }}>
                      ☀{band.day.charAt(0)} ☾{band.night.charAt(0)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* VHF Conditions */}
          {(bandConditions?.vhfConditions || []).length > 0 && (
            <div style={{ marginTop: '6px', padding: '4px', background: 'var(--bg-tertiary)', borderRadius: '4px' }}>
              <div
                style={{
                  fontSize: '9px',
                  color: 'var(--text-muted)',
                  marginBottom: '3px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {t('propagation.vhf.title')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {bandConditions.vhfConditions.map((v, i) => {
                  const isOpen = !v.condition?.toLowerCase().includes('closed');
                  const label =
                    v.name === 'vhf-aurora'
                      ? 'Aurora'
                      : v.name === 'E-Skip'
                        ? `Es ${v.location?.replace('_', ' ').replace('north america', 'NA').replace('europe', 'EU').replace('6m', '6m EU').replace('4m', '4m EU')}`
                        : v.name;
                  return (
                    <span
                      key={i}
                      style={{
                        fontSize: '9px',
                        padding: '1px 4px',
                        borderRadius: '2px',
                        background: isOpen ? 'rgba(0,255,136,0.15)' : 'rgba(255,255,255,0.05)',
                        color: isOpen ? '#00ff88' : 'var(--text-muted)',
                        border: `1px solid ${isOpen ? 'rgba(0,255,136,0.3)' : 'rgba(255,255,255,0.1)'}`,
                      }}
                    >
                      {label}: {isOpen ? v.condition : t('propagation.vhf.closed')}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Geomag + Signal Noise + Source */}
          <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
            <span>
              SFI {bandConditions?.extras?.solarFlux ?? solarData?.sfi} • K{' '}
              {bandConditions?.extras?.kIndex ?? solarData?.kIndex}
            </span>
            {bandConditions?.extras?.geomagField && (
              <span>
                {' '}
                • {t('propagation.geomag')}:{' '}
                <span
                  style={{
                    color:
                      bandConditions.extras.geomagField === 'QUIET'
                        ? 'var(--accent-green)'
                        : bandConditions.extras.geomagField === 'ACTIVE' ||
                            bandConditions.extras.geomagField === 'STORM'
                          ? 'var(--accent-red)'
                          : 'var(--accent-amber)',
                  }}
                >
                  {bandConditions.extras.geomagField}
                </span>
              </span>
            )}
            {bandConditions?.extras?.signalNoise && (
              <span>
                {' '}
                • {t('propagation.noise')}: {bandConditions.extras.signalNoise}
              </span>
            )}
          </div>
          <div
            style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '2px', opacity: 0.6 }}
          >
            {bandConditions?.extras?.source === 'N0NBH' ? 'Source: N0NBH / NOAA' : t('propagation.source.general')}
            {bandConditions?.extras?.updated && ` • ${bandConditions.extras.updated}`}
          </div>
        </div>
      ) : viewMode === 'health' ? (
        /* Band Health View - Real-time DX cluster spot analysis */
        <div onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
          <BandHealthPanel dxSpots={dxSpots} clusterFilters={clusterFilters} embedded />
        </div>
      ) : (
        <>
          {/* MUF/LUF and Data Source Info */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '4px 8px',
              background: 'var(--bg-tertiary)',
              borderRadius: '4px',
              marginBottom: '4px',
              fontSize: '11px',
            }}
          >
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
            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
              {dataSource || t('propagation.estimated')}
            </span>
            {dataSource && dataSource.includes('ITU') && (
              <span
                style={{
                  color: '#ff6b35',
                  fontSize: '9px',
                  marginLeft: '8px',
                  padding: '1px 4px',
                  background: 'rgba(255,107,53,0.15)',
                  borderRadius: '3px',
                }}
              >
                🔬 ITU-R P.533
              </span>
            )}
          </div>

          {/* Inline Mode / Power / Antenna controls */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              alignItems: 'center',
              padding: '3px 8px',
              marginBottom: '4px',
              fontSize: '10px',
              flexWrap: 'wrap',
            }}
          >
            {/* Mode */}
            <select
              value={localMode}
              onChange={(e) => updatePropConfig({ mode: e.target.value })}
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                padding: '2px 4px',
                fontSize: '10px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            {/* Power */}
            <select
              value={localPower}
              onChange={(e) => updatePropConfig({ power: parseInt(e.target.value) })}
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                padding: '2px 4px',
                fontSize: '10px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {POWERS.map((p) => (
                <option key={p} value={p}>
                  {p}W
                </option>
              ))}
            </select>

            {/* Antenna */}
            {antennaProfiles && (
              <select
                value={localAntenna}
                onChange={(e) => updatePropConfig({ antenna: e.target.value })}
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  padding: '2px 4px',
                  fontSize: '10px',
                  fontFamily: 'JetBrains Mono, monospace',
                  maxWidth: '110px',
                }}
              >
                {Object.entries(antennaProfiles).map(([key, profile]) => (
                  <option key={key} value={key}>
                    {profile.name} ({profile.gain > 0 ? '+' : ''}
                    {profile.gain}dBi)
                  </option>
                ))}
              </select>
            )}

            {/* Signal margin indicator */}
            {propagation?.signalMargin != null && (
              <span style={{ color: propagation.signalMargin >= 0 ? '#00ff88' : '#ff6666', marginLeft: 'auto' }}>
                {propagation.signalMargin > 0 ? '+' : ''}
                {propagation.signalMargin}dB
              </span>
            )}
          </div>

          {viewMode === 'chart' ? (
            /* VOACAP Heat Map Chart View */
            <div style={{ padding: '4px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px repeat(24, 1fr)',
                  gridTemplateRows: `repeat(${bands.length}, 12px)`,
                  gap: '1px',
                  fontSize: '12px',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {bands.map((band) => (
                  <React.Fragment key={band}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: '4px',
                        color: 'var(--text-muted)',
                        fontSize: '12px',
                      }}
                    >
                      {band.replace('m', '')}
                    </div>
                    {Array.from({ length: 24 }, (_, i) => {
                      const hour = (currentHour - 12 + i + 24) % 24;
                      let rel = 0;
                      if (hour === currentHour && currentBands?.length > 0) {
                        const currentBandData = currentBands.find((b) => b.band === band);
                        if (currentBandData) {
                          rel = currentBandData.reliability || 0;
                        }
                      } else {
                        const bandData = hourlyPredictions?.[band];
                        const hourData = bandData?.find((h) => h.hour === hour);
                        rel = hourData?.reliability || 0;
                      }
                      return (
                        <div
                          key={hour}
                          style={{
                            background: getHeatColor(rel),
                            borderRadius: '1px',
                            border: hour === currentHour ? '1px solid white' : 'none',
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
                  color: 'var(--text-muted)',
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
                        color: hour === currentHour ? 'var(--text-primary)' : undefined,
                      }}
                    >
                      {hour % 3 === 0 ? hour : ''}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div
                style={{
                  marginTop: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '11px',
                }}
              >
                <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>REL:</span>
                  {legendColors.map((c, i) => (
                    <div key={i} style={{ width: '8px', height: '8px', background: c, borderRadius: '1px' }} />
                  ))}
                  <span
                    onClick={toggleColorScheme}
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '9px',
                      marginLeft: '4px',
                      padding: '1px 4px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      border: '1px solid rgba(255,255,255,0.1)',
                      userSelect: 'none',
                    }}
                    title={
                      colorScheme === 'stoplight'
                        ? t('propagation.heatmap.tooltip.voacap')
                        : t('propagation.heatmap.tooltip.stoplight')
                    }
                  >
                    {colorScheme === 'stoplight' ? '🚦' : '🌡️'}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  {formatDistance(distance || 0, allUnits.dist)} • SSN={solarData?.ssn}
                </div>
              </div>
            </div>
          ) : (
            /* Bar Chart View */
            <div style={{ fontSize: '13px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-around',
                  padding: '4px',
                  marginBottom: '4px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '4px',
                  fontSize: '11px',
                }}
              >
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>SFI </span>
                  <span style={{ color: 'var(--accent-amber)' }}>{solarData?.sfi}</span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>SSN </span>
                  <span style={{ color: 'var(--accent-cyan)' }}>{solarData?.ssn}</span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>K </span>
                  <span style={{ color: solarData?.kIndex >= 4 ? '#ff4444' : '#00ff88' }}>{solarData?.kIndex}</span>
                </span>
              </div>

              {(currentBands || []).slice(0, 11).map((band) => (
                <div
                  key={band.band}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 1fr 40px',
                    gap: '4px',
                    padding: '2px 0',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '12px',
                      color: band.reliability >= 50 ? 'var(--accent-green)' : 'var(--text-muted)',
                    }}
                  >
                    {band.band}
                  </span>
                  <div
                    style={{
                      position: 'relative',
                      height: '10px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '2px',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        height: '100%',
                        width: `${band.reliability}%`,
                        background: getReliabilityColor(band.reliability),
                        borderRadius: '2px',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      textAlign: 'right',
                      fontSize: '12px',
                      color: getStatusColor(band.status),
                    }}
                  >
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
