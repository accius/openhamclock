/**
 * APRSPanel Component
 * Displays real-time APRS station positions with watchlist group management.
 * Supports tagging callsigns into named groups for EmComm and public service tracking.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import CallsignLink from './CallsignLink.jsx';
import { useCallsignPopup } from './CallsignPopupManager.jsx';
import { calculateDistance, formatDistance } from '../utils/geo.js';
import { stationAgeMinutes, formatStationAge } from '../utils/aprsStationAge.js';
import {
  sortAprsStations,
  nextAprsSort,
  readStoredAprsSort,
  storeAprsSort,
  APRS_SORT_KEYS,
} from '../utils/aprsSort.js';
import { APRS_SELECT_EVENT, APRS_SELECT_HIGHLIGHT_MS } from '../utils/aprsSelect.js';
import { formatAprsDevice } from '../utils/aprsDevice.js';

const APRSPanel = ({
  aprsData,
  showOnMap,
  onToggleMap,
  showLabelsOnMap = false,
  onToggleLabelsOnMap,
  iconScale = 1,
  onCycleIconScale,
  onHoverSpot,
  onSpotClick,
  deLocation,
  units = 'metric',
}) => {
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
    dwellMinutes = 60,
    setDwellMinutes,
    dwellOptions = [60],
    clearStations,
    internetAprs = { enabled: true, radiusKm: 250 },
    setInternetAprs,
    internetArea = null,
    radiusOptions = [250],
    serverInternetEnabled = true,
    serverInternetReason = null,
  } = aprsData || {};

  const { t } = useTranslation();
  const { showPopup } = useCallsignPopup();

  const [search, setSearch] = useState('');
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [showInternetSettings, setShowInternetSettings] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addCallInput, setAddCallInput] = useState('');
  const [addCallTarget, setAddCallTarget] = useState('');
  const [tooltip, setTooltip] = useState(null); // { station, distKm, x, y }
  const [sort, setSort] = useState(() => readStoredAprsSort()); // { key, dir } | null (#1208)
  const [selectedKey, setSelectedKey] = useState(null); // row highlighted from a map click (#1210)
  const listRef = useRef(null);

  // Search filter, then the chosen sort (arrival order when none is active)
  const displayStations = useMemo(() => {
    let list = filteredStations;
    if (search.trim()) {
      const q = search.toUpperCase();
      list = filteredStations.filter(
        (s) => s.call?.includes(q) || s.ssid?.includes(q) || s.comment?.toUpperCase().includes(q),
      );
    }
    return sortAprsStations(list, sort, deLocation);
  }, [filteredStations, search, sort, deLocation]);

  const handleSortClick = useCallback((key) => {
    setSort((prev) => {
      const next = nextAprsSort(prev, key);
      storeAprsSort(next);
      return next;
    });
  }, []);

  // Map marker click → bring that station's row into view. A station hidden
  // only by the search box gets the search cleared; the group/source filters
  // are the user's explicit choice and are left alone.
  useEffect(() => {
    const onSelect = (e) => {
      const key = e?.detail?.key;
      if (!key) return;
      const station = filteredStations.find((s) => (s.ssid || s.call) === key || s.call === key);
      if (!station) return;
      setSearch('');
      setSelectedKey(station.ssid || station.call);
    };
    window.addEventListener(APRS_SELECT_EVENT, onSelect);
    return () => window.removeEventListener(APRS_SELECT_EVENT, onSelect);
  }, [filteredStations]);

  useEffect(() => {
    if (!selectedKey) return undefined;
    const safe = String(selectedKey).replace(/["\\]/g, '');
    listRef.current?.querySelector(`[data-aprs-row="${safe}"]`)?.scrollIntoView?.({ block: 'nearest' });
    const timer = setTimeout(() => setSelectedKey(null), APRS_SELECT_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [selectedKey, displayStations]);

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

  const formatAge = formatStationAge;
  const formatDwell = (m) => (m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`);

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
          {typeof setInternetAprs === 'function' && (
            <button
              onClick={() => setShowInternetSettings(!showInternetSettings)}
              title={t('aprsPanel.internet.buttonTitle')}
              aria-label={t('aprsPanel.internet.buttonTitle')}
              aria-expanded={showInternetSettings}
              style={{
                background: showInternetSettings ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '3px 6px',
                fontSize: '11px',
                color: showInternetSettings ? '#000' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ⚙
            </button>
          )}
          <button
            onClick={() => setShowGroupManager(!showGroupManager)}
            title={t('aprsPanel.groupsButtonTitle')}
            aria-pressed={showGroupManager}
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
            aria-pressed={showOnMap}
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
          {typeof onToggleLabelsOnMap === 'function' && (
            <button
              onClick={onToggleLabelsOnMap}
              title={showLabelsOnMap ? t('aprsPanel.labelsOn') : t('aprsPanel.labelsOff')}
              aria-label={showLabelsOnMap ? t('aprsPanel.labelsOn') : t('aprsPanel.labelsOff')}
              aria-pressed={showLabelsOnMap}
              style={{
                background: showLabelsOnMap ? 'rgba(255, 170, 0, 0.22)' : 'var(--bg-tertiary)',
                border: `1px solid ${showLabelsOnMap ? '#ffaa00' : 'var(--border-color)'}`,
                borderRadius: '4px',
                padding: '3px 6px',
                fontSize: '11px',
                fontWeight: '700',
                color: showLabelsOnMap ? '#ffaa00' : 'var(--text-muted)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('aprsPanel.labelsButton')}
            </button>
          )}
          {typeof onCycleIconScale === 'function' && (
            <button
              onClick={onCycleIconScale}
              title={t('aprsPanel.iconSizeTitle')}
              aria-label={t('aprsPanel.iconSizeTitle')}
              style={{
                background: iconScale !== 1 ? 'rgba(34, 211, 238, 0.18)' : 'var(--bg-tertiary)',
                border: `1px solid ${iconScale !== 1 ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                borderRadius: '4px',
                padding: '3px 6px',
                fontSize: '11px',
                fontWeight: '700',
                color: iconScale !== 1 ? 'var(--accent-cyan)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                minWidth: '38px',
              }}
            >
              {iconScale}×
            </button>
          )}
        </div>
      </div>

      {/* Internet APRS settings — per viewer: on/off and radius around the station */}
      {showInternetSettings && typeof setInternetAprs === 'function' && (
        <div
          style={{
            padding: '8px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            fontSize: '11px',
          }}
        >
          <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            {t('aprsPanel.internet.title')}
          </div>
          {!serverInternetEnabled ? (
            <div style={{ color: 'var(--text-muted)' }}>
              {t(
                serverInternetReason === 'no-callsign'
                  ? 'aprsPanel.internet.serverNoCallsign'
                  : 'aprsPanel.internet.serverOff',
              )}
            </div>
          ) : (
            <>
              <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>
                {t('aprsPanel.internet.description')}
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' }}>
                {[
                  { on: true, label: t('aprsPanel.internet.on') },
                  { on: false, label: t('aprsPanel.internet.off') },
                ].map((opt) => {
                  const isActive = internetAprs.enabled === opt.on;
                  return (
                    <button
                      key={String(opt.on)}
                      onClick={() => setInternetAprs({ enabled: opt.on })}
                      aria-pressed={isActive}
                      style={{
                        padding: '2px 7px',
                        fontSize: '10px',
                        borderRadius: '3px',
                        border: isActive ? '1px solid var(--accent-green)' : '1px solid var(--border-color)',
                        background: isActive ? 'var(--accent-green)' : 'transparent',
                        color: isActive ? '#000' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontWeight: isActive ? '600' : '400',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                <span style={{ flex: 1 }} />
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    opacity: internetAprs.enabled ? 1 : 0.5,
                  }}
                >
                  {t('aprsPanel.internet.radius')}
                  <select
                    value={internetAprs.radiusKm}
                    disabled={!internetAprs.enabled}
                    onChange={(e) => setInternetAprs({ radiusKm: Number(e.target.value) })}
                    aria-label={t('aprsPanel.internet.radius')}
                    style={{
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '3px',
                      fontSize: '10px',
                      padding: '1px 3px',
                      fontFamily: 'inherit',
                    }}
                  >
                    {radiusOptions.map((km) => (
                      <option key={km} value={km}>
                        {formatDistance(km, units)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {internetAprs.enabled && (
                <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                  {internetArea
                    ? t('aprsPanel.internet.centre', {
                        lat: internetArea.lat.toFixed(2),
                        lon: internetArea.lon.toFixed(2),
                      })
                    : t('aprsPanel.internet.noLocation')}
                </div>
              )}
            </>
          )}
        </div>
      )}

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
              aria-pressed={isActive}
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
        <span style={{ flex: 1 }} />
        {/* Dwell + clear (#1190) */}
        <label
          title={t('aprsPanel.dwell.title')}
          style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: 'var(--text-muted)' }}
        >
          {t('aprsPanel.dwell.label')}
          <select
            value={dwellMinutes}
            onChange={(e) => setDwellMinutes?.(Number(e.target.value))}
            aria-label={t('aprsPanel.dwell.title')}
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              fontSize: '10px',
              padding: '1px 3px',
              fontFamily: 'inherit',
            }}
          >
            {dwellOptions.map((m) => (
              <option key={m} value={m}>
                {formatDwell(m)}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => clearStations?.()}
          title={t('aprsPanel.clearTitle')}
          disabled={stations.length === 0}
          style={{
            padding: '2px 7px',
            fontSize: '10px',
            borderRadius: '3px',
            border: '1px solid var(--border-color)',
            background: 'transparent',
            color: stations.length === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
            cursor: stations.length === 0 ? 'default' : 'pointer',
            fontFamily: 'inherit',
            opacity: stations.length === 0 ? 0.5 : 1,
          }}
        >
          {t('aprsPanel.clear')}
        </button>
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
            aria-pressed={watchlist.activeGroup === tab.key}
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
                  fontFamily: 'var(--font-mono)',
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
                      fontFamily: 'var(--font-mono)',
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

      {/* Sort header (#1208) */}
      <div
        role="group"
        aria-label={t('aprsPanel.sort.label')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 8px',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '10px',
          color: 'var(--text-muted)',
        }}
      >
        <span>{t('aprsPanel.sort.label')}</span>
        {APRS_SORT_KEYS.map((key) => {
          const active = sort?.key === key;
          return (
            <button
              key={key}
              onClick={() => handleSortClick(key)}
              title={t('aprsPanel.sort.title')}
              aria-pressed={active}
              style={{
                background: active ? 'var(--bg-tertiary)' : 'transparent',
                border: `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                borderRadius: '3px',
                padding: '1px 6px',
                fontSize: '10px',
                color: active ? 'var(--accent-cyan)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t(`aprsPanel.sort.${key}`)}
              {active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
            </button>
          );
        })}
      </div>

      {/* Station list */}
      <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
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

            const rowKey = station.ssid || station.call;
            const isSelected = selectedKey != null && rowKey === selectedKey;

            return (
              <div
                key={`${station.ssid}-${i}`}
                data-aprs-row={rowKey}
                onMouseEnter={(e) => {
                  onHoverSpot?.({ call: station.call, lat: station.lat, lon: station.lon });
                  setTooltip({ station, distKm, x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev))}
                onMouseLeave={() => {
                  onHoverSpot?.(null);
                  setTooltip(null);
                }}
                onClick={() => {
                  // Set DX + bring the station into view on the map (#1182)
                  if (station.lat != null && station.lon != null) {
                    onSpotClick?.({ call: station.call, ssid: station.ssid, lat: station.lat, lon: station.lon });
                  }
                }}
                title={station.lat != null && station.lon != null ? 'Show on map' : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '4px',
                  padding: '5px 6px',
                  borderRadius: '3px',
                  marginBottom: '2px',
                  background: isSelected
                    ? 'rgba(34,211,238,0.18)'
                    : i % 2 === 0
                      ? 'rgba(255,255,255,0.03)'
                      : 'transparent',
                  outline: isSelected ? '1px solid var(--accent-cyan)' : 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  borderLeft: isWatched ? '2px solid var(--accent-amber)' : '2px solid transparent',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {isWatched && <span style={{ fontSize: '10px' }}>★</span>}
                    <CallsignLink
                      call={station.ssid || station.call}
                      color="var(--text-primary)"
                      fontWeight="700"
                      onPopup={showPopup}
                      location={
                        station.lat != null && station.lon != null ? { lat: station.lat, lon: station.lon } : undefined
                      }
                    />
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
                  {(station.device || station.comment) && (
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
                      {station.device && (
                        <span style={{ color: 'var(--text-secondary)' }} title={t('aprsPanel.deviceTitle')}>
                          {formatAprsDevice(station.device)}
                          {station.comment ? ' · ' : ''}
                        </span>
                      )}
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
          const TIP_W = 290;
          const TIP_H = 220;
          const tipX = Math.min(tooltip.x + 14, window.innerWidth - TIP_W - 4);
          const tipY = Math.min(tooltip.y + 14, window.innerHeight - TIP_H - 4);
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
                <span style={{ fontWeight: '700', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
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
                {s.device && (
                  <span>
                    {t('aprsPanel.deviceTitle')}: {formatAprsDevice(s.device)}
                  </span>
                )}
                {s.symbol && <span>Symbol: {s.symbol}</span>}
              </div>
            </div>
          );
        })()}
    </div>
  );
};

export default APRSPanel;
