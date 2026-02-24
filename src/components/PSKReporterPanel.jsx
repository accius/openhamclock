/**
 * PSKReporter + WSJT-X Panel
 * Digital mode spots — toggle between internet (PSKReporter) and local (WSJT-X UDP)
 *
 * Layout:
 *   Row 1: Segmented mode toggle  |  map + filter controls
 *   Row 2: Sub-tabs (Being Heard / Hearing  or  Decodes / QSOs)
 *   Content: Scrolling spot/decode list
 */
import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getBandColor } from '../utils/callsign.js';
import { IconSearch, IconRefresh, IconMap } from './Icons.jsx';
import CallsignLink from './CallsignLink.jsx';

const PSKReporterPanel = ({
  callsign,
  onShowOnMap, // Deprecated in favor of onSpotClick, but kept just in case
  onSpotClick, // New unified handler
  showOnMap,
  onToggleMap,
  filters = {},
  onOpenFilters,
  // PSK data from App-level hook (single SSE connection)
  pskReporter = {},
  // WSJT-X props
  wsjtxDecodes = [],
  wsjtxClients = {},
  wsjtxQsos = [],
  wsjtxStats = {},
  wsjtxLoading,
  wsjtxEnabled,
  wsjtxPort,
  wsjtxRelayEnabled,
  wsjtxRelayConnected,
  wsjtxSessionId,
  showWSJTXOnMap,
  onToggleWSJTXMap,
}) => {
  const { t } = useTranslation();
  const [panelMode, setPanelMode] = useState(() => {
    try {
      const s = localStorage.getItem('openhamclock_pskPanelMode');
      return s || 'psk';
    } catch {
      return 'psk';
    }
  });
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const s = localStorage.getItem('openhamclock_pskActiveTab');
      return s || 'tx';
    } catch {
      return 'tx';
    }
  });
  const [wsjtxTab, setWsjtxTab] = useState('decodes');
  const [wsjtxFilter, setWsjtxFilter] = useState('all'); // 'all' | 'cq' | band name
  const [wsjtxAge, setWsjtxAge] = useState(() => {
    try {
      return parseInt(localStorage.getItem('ohc_wsjtx_age')) || 30;
    } catch {
      return 30;
    }
  }); // minutes: 5, 15, 30, 60

  // Persist panel mode and active tab
  const setPanelModePersist = (v) => {
    setPanelMode(v);
    try {
      localStorage.setItem('openhamclock_pskPanelMode', v);
    } catch {}
  };
  const setActiveTabPersist = (v) => {
    setActiveTab(v);
    try {
      localStorage.setItem('openhamclock_pskActiveTab', v);
    } catch {}
  };

  // PSKReporter data from App-level hook (single SSE connection shared across app)
  const {
    txReports = [],
    txCount = 0,
    rxReports = [],
    rxCount = 0,
    loading = false,
    error = null,
    connected = false,
    source = '',
    refresh = () => {},
  } = pskReporter;

  // ── PSK filtering ──
  const filterReports = (reports) => {
    return reports.filter((r) => {
      if (filters?.bands?.length && !filters.bands.includes(r.band)) return false;
      if (filters?.grids?.length) {
        const grid = activeTab === 'tx' ? r.receiverGrid : r.senderGrid;
        if (!grid) return false;
        if (!filters.grids.includes(grid.substring(0, 2).toUpperCase())) return false;
      }
      if (filters?.modes?.length && !filters.modes.includes(r.mode)) return false;
      return true;
    });
  };

  const filteredTx = useMemo(() => filterReports(txReports), [txReports, filters, activeTab]);
  const filteredRx = useMemo(() => filterReports(rxReports), [rxReports, filters, activeTab]);
  const filteredReports = activeTab === 'tx' ? filteredTx : filteredRx;
  const pskFilterCount = [filters?.bands?.length, filters?.grids?.length, filters?.modes?.length].filter(
    Boolean,
  ).length;

  const getFreqColor = (freqMHz) => (!freqMHz ? 'var(--text-muted)' : getBandColor(parseFloat(freqMHz)));
  const formatAge = (m) =>
    m < 1
      ? t('pskReporterPanel.time.now')
      : m < 60
        ? t('pskReporterPanel.time.minutes', { minutes: m })
        : t('pskReporterPanel.time.hours', { hours: Math.floor(m / 60) });

  // ── WSJT-X helpers ──
  const activeClients = Object.entries(wsjtxClients);
  const primaryClient = activeClients[0]?.[1] || null;

  // Build unified filter options: All, CQ Only, then each available band
  const wsjtxFilterOptions = useMemo(() => {
    const bands = [...new Set(wsjtxDecodes.map((d) => d.band).filter(Boolean))].sort(
      (a, b) => (parseInt(b) || 999) - (parseInt(a) || 999),
    );
    return [
      { value: 'all', label: t('pskReporterPanel.wsjtx.filterAll') },
      { value: 'cq', label: t('pskReporterPanel.wsjtx.filterCq') },
      ...bands.map((b) => ({ value: b, label: b })),
    ];
  }, [wsjtxDecodes, t]);

  const filteredDecodes = useMemo(() => {
    let filtered = [...wsjtxDecodes];

    // Time retention filter
    const ageCutoff = Date.now() - wsjtxAge * 60 * 1000;
    filtered = filtered.filter((d) => d.timestamp >= ageCutoff);

    if (wsjtxFilter === 'cq') {
      filtered = filtered.filter((d) => d.type === 'CQ');
    } else if (wsjtxFilter !== 'all') {
      // Band filter
      filtered = filtered.filter((d) => d.band === wsjtxFilter);
    }
    return filtered.reverse();
  }, [wsjtxDecodes, wsjtxFilter, wsjtxAge]);

  const getSnrColor = (snr) => {
    if (snr == null) return 'var(--text-muted)';
    if (snr >= 0) return '#4ade80';
    if (snr >= -10) return '#fbbf24';
    if (snr >= -18) return '#fb923c';
    return '#ef4444';
  };

  const getMsgColor = (d) => {
    if (d.type === 'CQ') return '#60a5fa';
    if (['RR73', '73', 'RRR'].includes(d.exchange)) return '#4ade80';
    if (d.exchange?.startsWith('R')) return '#fbbf24';
    return 'var(--text-primary)';
  };

  // Active map toggle for current mode
  const isMapOn = panelMode === 'psk' ? showOnMap : showWSJTXOnMap;
  const handleMapToggle = panelMode === 'psk' ? onToggleMap : onToggleWSJTXMap;

  // Compact status dot
  const statusDot = connected
    ? { color: '#4ade80', char: '●' }
    : source === 'connecting' || source === 'reconnecting'
      ? { color: '#fbbf24', char: '◐' }
      : error
        ? { color: '#ef4444', char: '●' }
        : null;

  // ── Shared styles ──
  const segBtn = (active, color) => ({
    padding: '3px 10px',
    background: active ? `${color}18` : 'transparent',
    color: active ? color : 'var(--text-muted)',
    border: 'none',
    borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
    fontSize: '11px',
    fontWeight: active ? '700' : '400',
    cursor: 'pointer',
    letterSpacing: '0.02em',
  });

  const subTabBtn = (active, color) => ({
    flex: 1,
    padding: '3px 4px',
    background: active ? `${color}20` : 'transparent',
    border: `1px solid ${active ? color + '66' : 'var(--border-color)'}`,
    borderRadius: '3px',
    color: active ? color : 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: active ? '600' : '400',
  });

  const iconBtn = (active, activeColor = '#4488ff') => ({
    background: active ? `${activeColor}30` : 'rgba(100,100,100,0.3)',
    border: `1px solid ${active ? activeColor : '#555'}`,
    color: active ? activeColor : '#777',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '10px',
    cursor: 'pointer',
    lineHeight: 1,
  });

  return (
    <div
      className="panel"
      style={{
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ── Row 1: Mode toggle + controls ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '5px',
          flexShrink: 0,
        }}
      >
        {/* Mode toggle */}
        <div style={{ display: 'flex' }}>
          <button
            onClick={() => setPanelModePersist('psk')}
            style={segBtn(panelMode === 'psk', 'var(--accent-primary)')}
            title={t('pskReporterPanel.mode.pskTooltip')}
          >
            PSKReporter
          </button>
          <button
            onClick={() => setPanelModePersist('wsjtx')}
            style={segBtn(panelMode === 'wsjtx', '#a78bfa')}
            title={t('pskReporterPanel.mode.wsjtxTooltip')}
          >
            WSJT-X
          </button>
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* PSK: status dot + filter + refresh */}
          {panelMode === 'psk' && (
            <>
              {statusDot && (
                <span style={{ color: statusDot.color, fontSize: '10px', lineHeight: 1 }}>{statusDot.char}</span>
              )}
              <button
                onClick={onOpenFilters}
                style={iconBtn(pskFilterCount > 0, '#ffaa00')}
                title={t('pskReporterPanel.psk.filterTooltip')}
              >
                <IconSearch size={11} style={{ verticalAlign: 'middle' }} />
                {pskFilterCount > 0 ? pskFilterCount : ''}
              </button>
              <button
                onClick={refresh}
                disabled={loading}
                style={{
                  ...iconBtn(false),
                  opacity: loading ? 0.4 : 1,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
                title={t('pskReporterPanel.psk.refreshTooltip')}
              >
                <IconRefresh size={11} style={{ verticalAlign: 'middle' }} />
              </button>
            </>
          )}

          {/* WSJT-X: mode/band info + unified filter + age */}
          {panelMode === 'wsjtx' && (
            <>
              {primaryClient && (
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                  {primaryClient.mode} {primaryClient.band}
                  {primaryClient.transmitting && <span style={{ color: '#ef4444', marginLeft: '2px' }}>TX</span>}
                </span>
              )}
              <select
                value={wsjtxFilter}
                onChange={(e) => setWsjtxFilter(e.target.value)}
                style={{
                  background: 'var(--bg-tertiary)',
                  color: wsjtxFilter !== 'all' ? '#a78bfa' : 'var(--text-primary)',
                  border: `1px solid ${wsjtxFilter !== 'all' ? '#a78bfa55' : 'var(--border-color)'}`,
                  borderRadius: '3px',
                  fontSize: '10px',
                  padding: '1px 4px',
                  cursor: 'pointer',
                  maxWidth: '90px',
                }}
              >
                {wsjtxFilterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={wsjtxAge}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  setWsjtxAge(v);
                  try {
                    localStorage.setItem('ohc_wsjtx_age', v);
                  } catch {}
                }}
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  fontSize: '10px',
                  padding: '1px 4px',
                  cursor: 'pointer',
                  maxWidth: '55px',
                }}
                title="Decode retention time"
              >
                <option value={5}>5m</option>
                <option value={15}>15m</option>
                <option value={30}>30m</option>
                <option value={60}>60m</option>
              </select>
            </>
          )}

          {/* Map toggle (always visible) */}
          {handleMapToggle && (
            <button
              onClick={handleMapToggle}
              style={iconBtn(isMapOn, panelMode === 'psk' ? '#4488ff' : '#a78bfa')}
              title={isMapOn ? t('pskReporterPanel.map.hide') : t('pskReporterPanel.map.show')}
            >
              <IconMap size={11} style={{ verticalAlign: 'middle' }} />
            </button>
          )}
        </div>
      </div>

      {/* ── Row 2: Sub-tabs ── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '5px', flexShrink: 0 }}>
        {panelMode === 'psk' ? (
          <>
            <button
              onClick={() => setActiveTabPersist('tx')}
              style={subTabBtn(activeTab === 'tx', '#4ade80')}
              title={t('pskReporterPanel.tabs.heardTooltip')}
            >
              ▲ {t('pskReporterPanel.tabs.heard', { count: pskFilterCount > 0 ? filteredTx.length : txCount })}
            </button>
            <button
              onClick={() => setActiveTabPersist('rx')}
              style={subTabBtn(activeTab === 'rx', '#60a5fa')}
              title={t('pskReporterPanel.tabs.hearingTooltip')}
            >
              ▼ {t('pskReporterPanel.tabs.hearing', { count: pskFilterCount > 0 ? filteredRx.length : rxCount })}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setWsjtxTab('decodes')}
              style={subTabBtn(wsjtxTab === 'decodes', '#a78bfa')}
              title={t('pskReporterPanel.wsjtx.decodingTooltip')}
            >
              {t('pskReporterPanel.wsjtx.decodes', { count: filteredDecodes.length })}
            </button>
            <button
              onClick={() => setWsjtxTab('qsos')}
              style={subTabBtn(wsjtxTab === 'qsos', '#a78bfa')}
              title={t('pskReporterPanel.wsjtx.qsosTooltip')}
            >
              {t('pskReporterPanel.wsjtx.qsos', { count: wsjtxQsos.length })}
            </button>
          </>
        )}
      </div>

      {/* ── Content area ── */}
      <div style={{ flex: 1, overflow: 'auto', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>
        {/* === PSKReporter content === */}
        {panelMode === 'psk' && (
          <>
            {!callsign || callsign === 'N0CALL' ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '16px', fontSize: '11px' }}>
                {t('pskReporterPanel.psk.setCallsign')}
              </div>
            ) : error && !connected ? (
              <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)', fontSize: '11px' }}>
                {t('pskReporterPanel.psk.connectionFailed')}
              </div>
            ) : loading && filteredReports.length === 0 && pskFilterCount === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '11px' }}>
                <div className="loading-spinner" style={{ margin: '0 auto 8px' }} />
                {t('pskReporterPanel.psk.connecting')}
              </div>
            ) : filteredReports.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)', fontSize: '11px' }}>
                {pskFilterCount > 0
                  ? t('pskReporterPanel.psk.noSpotsFiltered')
                  : activeTab === 'tx'
                    ? t('pskReporterPanel.psk.waitingForSpots')
                    : t('pskReporterPanel.psk.noStationsHeard')}
              </div>
            ) : (
              filteredReports.slice(0, 25).map((report, i) => {
                const freqMHz = report.freqMHz || (report.freq ? (report.freq / 1000000).toFixed(3) : '?');
                const color = getFreqColor(freqMHz);
                const displayCall = activeTab === 'tx' ? report.receiver : report.sender;
                const grid = activeTab === 'tx' ? report.receiverGrid : report.senderGrid;

                return (
                  <div
                    key={`${displayCall}-${report.freq}-${i}`}
                    onClick={() => {
                      if (onSpotClick) onSpotClick(report);
                      else if (onShowOnMap) onShowOnMap(report);
                    }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '52px 1fr auto',
                      gap: '5px',
                      padding: '3px 4px',
                      borderRadius: '2px',
                      background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                      cursor: report.lat && report.lon ? 'pointer' : 'default',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(68,136,255,0.12)')}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent')
                    }
                  >
                    <span style={{ color, fontWeight: '600', fontSize: '10px' }}>{freqMHz}</span>
                    <span
                      style={{
                        color: 'var(--text-primary)',
                        fontWeight: '600',
                        fontSize: '11px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <CallsignLink call={displayCall} color="var(--text-primary)" fontWeight="600" fontSize="11px" />
                      {grid && (
                        <span
                          style={{ color: 'var(--text-muted)', fontWeight: '400', marginLeft: '4px', fontSize: '9px' }}
                        >
                          {grid}
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '9px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{report.mode}</span>
                      {report.snr != null && (
                        <span
                          style={{
                            color: report.snr >= 0 ? '#4ade80' : report.snr >= -10 ? '#fbbf24' : '#f97316',
                            fontWeight: '600',
                          }}
                        >
                          {report.snr > 0 ? '+' : ''}
                          {report.snr}
                        </span>
                      )}
                      <span style={{ color: 'var(--text-muted)' }}>{formatAge(report.age)}</span>
                    </span>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* === WSJT-X content === */}
        {panelMode === 'wsjtx' && (
          <>
            {/* No client connected */}
            {!wsjtxLoading && activeClients.length === 0 && wsjtxDecodes.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '8px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  textAlign: 'center',
                  padding: '16px 8px',
                  height: '100%',
                }}
              >
                <div style={{ fontSize: '12px' }}>{t('pskReporterPanel.wsjtx.waiting')}</div>
                {wsjtxRelayEnabled ? (
                  wsjtxRelayConnected ? (
                    <div style={{ fontSize: '10px', opacity: 0.8, lineHeight: 1.6 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          marginBottom: '4px',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: '#4ade80',
                            boxShadow: '0 0 4px #4ade80',
                          }}
                        />
                        <span style={{ color: '#4ade80', fontWeight: 600 }}>
                          {t('pskReporterPanel.wsjtx.relayConnected')}
                        </span>
                      </div>
                      <div style={{ fontSize: '9px', opacity: 0.5 }}>{t('pskReporterPanel.wsjtx.relayHint')}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '10px', opacity: 0.8, lineHeight: 1.6 }}>
                      <div style={{ marginBottom: '8px' }}>{t('pskReporterPanel.wsjtx.downloadRelay')}</div>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <a
                          href={`/api/wsjtx/relay/download/linux?session=${wsjtxSessionId || ''}`}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: '600',
                            background: 'rgba(167,139,250,0.2)',
                            border: '1px solid #a78bfa55',
                            color: '#a78bfa',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {t('pskReporterPanel.wsjtx.platformLinux')}
                        </a>
                        <a
                          href={`/api/wsjtx/relay/download/mac?session=${wsjtxSessionId || ''}`}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: '600',
                            background: 'rgba(167,139,250,0.2)',
                            border: '1px solid #a78bfa55',
                            color: '#a78bfa',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {t('pskReporterPanel.wsjtx.platformMac')}
                        </a>
                        <a
                          href={`/api/wsjtx/relay/download/windows?session=${wsjtxSessionId || ''}`}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: '600',
                            background: 'rgba(167,139,250,0.2)',
                            border: '1px solid #a78bfa55',
                            color: '#a78bfa',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {t('pskReporterPanel.wsjtx.platformWindows')}
                        </a>
                      </div>
                      <div style={{ fontSize: '9px', opacity: 0.5, marginTop: '6px' }}>
                        {t('pskReporterPanel.wsjtx.requiresNode')}
                      </div>
                    </div>
                  )
                ) : (
                  <div style={{ fontSize: '10px', opacity: 0.6, lineHeight: 1.5 }}>
                    {t('                                                pskReporterPanel.wsjtx.udpPath')}
                    <br />
                    {t('pskReporterPanel.wsjtx.udpAddress', { port: wsjtxPort || 2237 })}
                  </div>
                )}
              </div>
            ) : wsjtxTab === 'decodes' ? (
              <>
                {filteredDecodes.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '16px', fontSize: '11px' }}>
                    {wsjtxDecodes.length > 0
                      ? t('pskReporterPanel.wsjtx.noDecodesFiltered')
                      : t('pskReporterPanel.wsjtx.listening')}
                  </div>
                ) : (
                  filteredDecodes.map((d, i) => (
                    <div
                      key={d.id || i}
                      style={{
                        display: 'flex',
                        gap: '5px',
                        padding: '2px 2px',
                        borderBottom: '1px solid var(--border-color)',
                        alignItems: 'baseline',
                        opacity: d.lowConfidence ? 0.5 : 1,
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)', minWidth: '44px', fontSize: '10px' }}>{d.time}</span>
                      <span
                        style={{ color: getSnrColor(d.snr), minWidth: '26px', textAlign: 'right', fontSize: '10px' }}
                      >
                        {d.snr != null ? (d.snr >= 0 ? `+${d.snr}` : d.snr) : ''}
                      </span>
                      <span
                        style={{ color: 'var(--text-muted)', minWidth: '24px', textAlign: 'right', fontSize: '10px' }}
                      >
                        {d.dt}
                      </span>
                      <span
                        style={{
                          color: d.band ? getBandColor(d.dialFrequency / 1000000) : 'var(--text-muted)',
                          minWidth: '32px',
                          textAlign: 'right',
                          fontSize: '10px',
                        }}
                      >
                        {d.freq}
                      </span>
                      <span
                        style={{
                          color: getMsgColor(d),
                          flex: 1,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {d.message}
                      </span>
                    </div>
                  ))
                )}
              </>
            ) : (
              /* QSOs tab */
              <>
                {wsjtxQsos.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '16px', fontSize: '11px' }}>
                    {t('pskReporterPanel.wsjtx.noQsos')}
                  </div>
                ) : (
                  [...wsjtxQsos].reverse().map((q, i) => (
                    <div
                      key={`${q.dxCall}-${q.frequency}-${q.mode}-${q.timestamp || i}`}
                      style={{
                        display: 'flex',
                        gap: '5px',
                        padding: '3px 2px',
                        borderBottom: '1px solid var(--border-color)',
                        alignItems: 'baseline',
                      }}
                    >
                      <span
                        style={{
                          color: q.band ? getBandColor(q.frequency / 1000000) : 'var(--accent-green)',
                          fontWeight: '600',
                          minWidth: '65px',
                        }}
                      >
                        <CallsignLink
                          call={q.dxCall}
                          color={q.band ? getBandColor(q.frequency / 1000000) : 'var(--accent-green)'}
                          fontWeight="600"
                        />
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{q.band}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{q.mode}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                        {q.reportSent}/{q.reportRecv}
                      </span>
                      {q.dxGrid && <span style={{ color: '#a78bfa', fontSize: '10px' }}>{q.dxGrid}</span>}
                    </div>
                  ))
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── WSJT-X status footer ── */}
      {panelMode === 'wsjtx' && activeClients.length > 0 && (
        <div
          style={{
            fontSize: '9px',
            color: 'var(--text-muted)',
            borderTop: '1px solid var(--border-color)',
            paddingTop: '2px',
            marginTop: '2px',
            display: 'flex',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <span>{activeClients.map(([id, c]) => `${id}${c.version ? ` v${c.version}` : ''}`).join(', ')}</span>
          {primaryClient?.dialFrequency && (
            <span style={{ color: '#a78bfa' }}>{(primaryClient.dialFrequency / 1000000).toFixed(6)} MHz</span>
          )}
        </div>
      )}
    </div>
  );
};

export default PSKReporterPanel;
export { PSKReporterPanel };
