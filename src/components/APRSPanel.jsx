/**
 * APRSPanel Component
 * Displays real-time APRS station positions with watchlist group management.
 * Supports tagging callsigns into named groups for EmComm and public service tracking.
 */
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import CallsignLink from './CallsignLink.jsx';
import { calculateDistance, formatDistance } from '../utils/geo.js';

const APRSPanel = ({ aprsData, showOnMap, onToggleMap, onSpotClick, onHoverSpot, deLocation, units = 'metric' }) => {
  const {
    filteredStations = [],
    stations = [],
    connected,
    aprsEnabled,
    loading,
    watchlist = { groups: {}, activeGroup: 'all' },
    allWatchlistCalls = new Set(),
    addGroup,
    removeGroup,
    addCallToGroup,
    removeCallFromGroup,
    setActiveGroup,
    sourceFilter = 'all',
    setSourceFilter,
    tncConnected = false,
    hasRFStations = false,
  } = aprsData || {};

  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addCallInput, setAddCallInput] = useState('');
  const [addCallTarget, setAddCallTarget] = useState('');
  const [tooltip, setTooltip] = useState(null); // { station, distKm, x, y }

  // Search filter
  const displayStations = useMemo(() => {
    if (!search.trim()) return filteredStations;
    const q = search.toUpperCase();
    return filteredStations.filter(
      (s) => s.call?.includes(q) || s.ssid?.includes(q) || s.comment?.toUpperCase().includes(q),
    );
  }, [filteredStations, search]);

  const groupNames = Object.keys(watchlist.groups);

  const handleAddGroup = useCallback(() => {
    if (newGroupName.trim()) {
      addGroup(newGroupName.trim());
      setNewGroupName('');
    }
  }, [newGroupName, addGroup]);

  const handleAddCall = useCallback(() => {
    if (addCallInput.trim() && addCallTarget) {
      addCallToGroup(addCallTarget, addCallInput.trim());
      setAddCallInput('');
    }
  }, [addCallInput, addCallTarget, addCallToGroup]);

  const formatAge = (minutes) =>
    minutes == null ? '?' : minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
  const stationAgeMinutes = (station) => {
    if (station.age != null) return station.age;
    if (station.timestamp != null) return Math.floor((Date.now() - station.timestamp) / 60000);
    return null;
  };

  if (!aprsEnabled) {
    return (
      <div
        className="panel"
        style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}
      >
        <div style={{ fontSize: '24px', marginBottom: '10px' }}>📍</div>
        <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
          {t('aprsPanel.disabled.title')}
        </div>
        <div>
          {t('aprsPanel.disabled.internetBefore')}{' '}
          <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>
            APRS_ENABLED=true
          </code>{' '}
          {t('aprsPanel.disabled.internetAfter')}
        </div>
        <div style={{ marginTop: '8px' }}>
          {t('aprsPanel.disabled.rfBefore')}{' '}
          <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>aprs-tnc</code>{' '}
          {t('aprsPanel.disabled.rfAfter')}
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px' }}>
          {t('aprsPanel.disabled.filterBefore')}{' '}
          <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>
            APRS_FILTER=r/{'{lat}'}/{'{lon}'}/500
          </code>{' '}
          {t('aprsPanel.disabled.filterAfter')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: '12px' }}>
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px' }}>📍</span>
          <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>APRS</span>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
              display: 'inline-block',
            }}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            {displayStations.length}/{stations.length}
            {sourceFilter !== 'all' && (
              <span
                style={{
                  color: sourceFilter === 'rf' ? 'var(--accent-green)' : 'var(--accent-cyan)',
                  marginLeft: '3px',
                }}
              >
                {sourceFilter === 'rf' ? '📡' : '🌐'}
              </span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => setShowGroupManager(!showGroupManager)}
            title={t('aprsPanel.groupsButtonTitle')}
            style={{
              background: showGroupManager ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              color: showGroupManager ? '#000' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('aprsPanel.groupsButton')}
          </button>
          <button
            onClick={onToggleMap}
            style={{
              background: showOnMap ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              color: showOnMap ? '#000' : 'var(--text-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {showOnMap ? t('aprsPanel.mapOn') : t('aprsPanel.mapOff')}
          </button>
        </div>
      </div>

      {/* Source selector — All / Internet / Local RF */}
      <div
        style={{
          display: 'flex',
          gap: '3px',
          padding: '4px 8px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginRight: '4px' }}>
          {t('aprsPanel.source.label')}
        </span>
        {[
          { key: 'all', label: t('aprsPanel.source.all') },
          { key: 'internet', label: t('aprsPanel.source.internet') },
          { key: 'rf', label: t('aprsPanel.source.rf') },
        ].map((opt) => {
          const isRF = opt.key === 'rf';
          const isActive = sourceFilter === opt.key;
          const rfDisabled = isRF && !hasRFStations;
          return (
            <button
              key={opt.key}
              onClick={() => !rfDisabled && setSourceFilter?.(opt.key)}
              title={
                isRF && tncConnected
                  ? t('aprsPanel.source.tncConnected')
                  : isRF
                    ? t('aprsPanel.source.noRfData')
                    : undefined
              }
              style={{
                padding: '2px 7px',
                fontSize: '10px',
                borderRadius: '3px',
                border: isActive ? '1px solid var(--accent-green)' : '1px solid var(--border-color)',
                background: isActive ? 'var(--accent-green)' : 'transparent',
                color: isActive ? '#000' : rfDisabled ? 'var(--text-muted)' : 'var(--text-secondary)',
                cursor: rfDisabled ? 'default' : 'pointer',
                fontFamily: 'inherit',
                fontWeight: isActive ? '600' : '400',
                opacity: rfDisabled ? 0.5 : 1,
              }}
            >
              {opt.label}
              {isRF && tncConnected && (
                <span
                  style={{
                    display: 'inline-block',
                    width: '5px',
                    height: '5px',
                    borderRadius: '50%',
                    background: '#22c55e',
                    marginLeft: '4px',
                    verticalAlign: 'middle',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Group filter tabs */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '4px 8px',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        {[
          { key: 'all', label: t('aprsPanel.groupTab.all', { count: stations.length }) },
          ...(allWatchlistCalls.size > 0 ? [{ key: 'watchlist', label: t('aprsPanel.groupTab.watchlist') }] : []),
          ...groupNames.map((g) => ({ key: g, label: `${g} (${watchlist.groups[g].length})` })),
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveGroup(tab.key)}
            style={{
              padding: '3px 8px',
              fontSize: '10px',
              borderRadius: '3px',
              border:
                watchlist.activeGroup === tab.key ? '1px solid var(--accent-amber)' : '1px solid var(--border-color)',
              background: watchlist.activeGroup === tab.key ? 'var(--accent-amber)' : 'transparent',
              color: watchlist.activeGroup === tab.key ? '#000' : 'var(--text-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: watchlist.activeGroup === tab.key ? '600' : '400',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Group manager */}
      {showGroupManager && (
        <div
          style={{
            padding: '8px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
          }}
        >
          <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px', fontSize: '11px' }}>
            {t('aprsPanel.groups.title')}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            {t('aprsPanel.groups.description')}
          </div>

          {/* Create group */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
              placeholder={t('aprsPanel.groups.newGroupPlaceholder')}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: '11px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleAddGroup}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                background: 'var(--accent-cyan)',
                border: 'none',
                borderRadius: '3px',
                color: '#000',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: '600',
              }}
            >
              {t('aprsPanel.groups.createButton')}
            </button>
          </div>

          {/* Add call to group */}
          {groupNames.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
              <input
                value={addCallInput}
                onChange={(e) => setAddCallInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCall()}
                placeholder={t('aprsPanel.groups.callsignPlaceholder')}
                style={{
                  width: '90px',
                  padding: '4px 6px',
                  fontSize: '11px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              <select
                value={addCallTarget}
                onChange={(e) => setAddCallTarget(e.target.value)}
                style={{
                  flex: 1,
                  padding: '4px',
                  fontSize: '11px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                }}
              >
                <option value="">{t('aprsPanel.groups.selectGroup')}</option>
                {groupNames.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddCall}
                disabled={!addCallInput.trim() || !addCallTarget}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  background: addCallInput.trim() && addCallTarget ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                  border: 'none',
                  borderRadius: '3px',
                  color: addCallInput.trim() && addCallTarget ? '#000' : 'var(--text-muted)',
                  cursor: addCallInput.trim() && addCallTarget ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  fontWeight: '600',
                }}
              >
                {t('aprsPanel.groups.addButton')}
              </button>
            </div>
          )}

          {/* Group list with members */}
          {groupNames.map((g) => (
            <div
              key={g}
              style={{
                padding: '6px 8px',
                marginBottom: '4px',
                borderRadius: '4px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}
              >
                <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '11px' }}>{g}</span>
                <button
                  onClick={() => removeGroup(g)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t('aprsPanel.groups.deleteButton')}
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {(watchlist.groups[g] || []).map((call) => (
                  <span
                    key={call}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: '2px 6px',
                      fontSize: '10px',
                      borderRadius: '3px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {call}
                    <span
                      onClick={() => removeCallFromGroup(g, call)}
                      style={{ cursor: 'pointer', color: '#ef4444', fontWeight: '700' }}
                    >
                      ×
                    </span>
                  </span>
                ))}
                {(watchlist.groups[g] || []).length === 0 && (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {t('aprsPanel.groups.noCallsigns')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('aprsPanel.quickSearch')}
          style={{
            width: '100%',
            padding: '5px 8px',
            fontSize: '11px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Station list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
            {t('aprsPanel.loading')}
          </div>
        ) : displayStations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
            {stations.length === 0 ? t('aprsPanel.noStations') : t('aprsPanel.noStationsFiltered')}
          </div>
        ) : (
          displayStations.map((station, i) => {
            const isWatched = allWatchlistCalls.has(station.call) || allWatchlistCalls.has(station.ssid);
            const distKm =
              deLocation?.lat != null && deLocation?.lon != null && station.lat != null && station.lon != null
                ? calculateDistance(deLocation.lat, deLocation.lon, station.lat, station.lon)
                : null;

            return (
              <div
                key={`${station.ssid}-${i}`}
                onMouseEnter={(e) => {
                  onHoverSpot?.({ call: station.call, lat: station.lat, lon: station.lon });
                  setTooltip({ station, distKm, x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev))}
                onMouseLeave={() => {
                  onHoverSpot?.(null);
                  setTooltip(null);
                }}
                onClick={() => onSpotClick?.({ call: station.call, lat: station.lat, lon: station.lon })}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '4px',
                  padding: '5px 6px',
                  borderRadius: '3px',
                  marginBottom: '2px',
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  borderLeft: isWatched ? '2px solid var(--accent-amber)' : '2px solid transparent',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {isWatched && <span style={{ fontSize: '10px' }}>★</span>}
                    <CallsignLink call={station.ssid || station.call} color="var(--text-primary)" fontWeight="700" />
                    {station.source === 'local-tnc' && (
                      <span
                        title={t('aprsPanel.rfBadgeTitle')}
                        style={{
                          fontSize: '9px',
                          padding: '1px 4px',
                          borderRadius: '2px',
                          background: 'rgba(74,222,128,0.15)',
                          border: '1px solid rgba(74,222,128,0.4)',
                          color: '#4ade80',
                          fontWeight: '600',
                          letterSpacing: '0.02em',
                        }}
                      >
                        RF
                      </span>
                    )}
                  </div>
                  {station.comment && (
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: '10px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '180px',
                      }}
                    >
                      {station.comment}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>{formatAge(stationAgeMinutes(station))}</span>
                  {distKm != null && <span>{formatDistance(distKm, units)}</span>}
                  {station.speed > 0 && <span>{station.speed} kt</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Hover tooltip */}
      {tooltip &&
        (() => {
          const s = tooltip.station;
          const age = stationAgeMinutes(s);
          // Keep tooltip within viewport
          const tipX = tooltip.x + 14;
          const tipY = tooltip.y + 14;
          return (
            <div
              style={{
                position: 'fixed',
                left: tipX,
                top: tipY,
                zIndex: 9999,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '8px 10px',
                fontSize: '11px',
                color: 'var(--text-primary)',
                pointerEvents: 'none',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                maxWidth: '280px',
                lineHeight: '1.6',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontWeight: '700', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>
                  {s.ssid || s.call}
                </span>
                {s.source === 'local-tnc' && (
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '1px 4px',
                      borderRadius: '2px',
                      background: 'rgba(74,222,128,0.15)',
                      border: '1px solid rgba(74,222,128,0.4)',
                      color: '#4ade80',
                      fontWeight: '600',
                    }}
                  >
                    RF
                  </span>
                )}
              </div>
              {s.comment && (
                <div style={{ color: 'var(--text-secondary)', marginBottom: '4px', wordBreak: 'break-word' }}>
                  {s.comment}
                </div>
              )}
              <div style={{ color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                {s.lat != null && s.lon != null && (
                  <span>
                    {s.lat.toFixed(4)}°, {s.lon.toFixed(4)}°
                  </span>
                )}
                {tooltip.distKm != null && <span>{formatDistance(tooltip.distKm, units)}</span>}
                {age != null && <span>Age: {formatAge(age)}</span>}
                {s.speed > 0 && (
                  <span>
                    Speed: {s.speed} kt{s.course != null ? ` / ${s.course}°` : ''}
                  </span>
                )}
                {s.altitude != null && <span>Altitude: {s.altitude} ft</span>}
                {s.symbol && <span>Symbol: {s.symbol}</span>}
              </div>
            </div>
          );
        })()}
    </div>
  );
};

export default APRSPanel;
