/**
 * ActivatePanel Component
 * Displays <whatever> on the Air activations with ON/OFF toggle
 */
import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getListenUrl, loadNearbyReceivers } from '../utils/webSdr.js';
import CallsignLink from './CallsignLink.jsx';
import { useCallsignPopup } from './CallsignPopupManager.jsx';
import { IconSearch, IconRefresh, IconMap, IconTag } from './Icons.jsx';
import { useWorkedBefore } from '../hooks/useWorkedBefore.js';
import { useAwards } from '../hooks/useAwards.js';
import { spotBadge } from '../utils/awards.js';
import { requestLogQso } from '../services/logbookStore.js';
import { useCompiledWatchlist } from '../hooks/useWatchlists.js';
import { spotIota, iotaName } from '../utils/iota.js';

export const ActivatePanel = ({
  mapDefs,
  data,
  loading,
  lastUpdated,
  lastChecked,
  connected,
  showOnMap,
  onToggleMap,
  showLabelsOnMap = true,
  onToggleLabelsOnMap,
  onSpotClick,
  onHoverSpot,
  filters,
  onOpenFilters,
  filteredData,
  emptyText,
}) => {
  const { t } = useTranslation();
  const { showPopup } = useCallsignPopup();

  // Warm the nearby web-SDR receiver cache so the 🎧 links can be computed
  // synchronously at render time (same pattern as DXClusterPanel). DE
  // location isn't a prop here, so read it from the stored config; without
  // one, getListenUrl falls back to the static regional receiver list.
  const [, setSdrDirectoryTick] = useState(0);
  useEffect(() => {
    let de = null;
    try {
      de = JSON.parse(localStorage.getItem('openhamclock_config') || '{}').location;
    } catch {}
    if (de?.lat == null || de?.lon == null) return undefined;
    let cancelled = false;
    loadNearbyReceivers(de.lat, de.lon).then((list) => {
      if (!cancelled && list) setSdrDirectoryTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Worked-before flag from live logged QSOs (N3FJP + N1MM/DXLog). Call-level
  // only here — activation hunters mostly care whether the activator is
  // already in the log at all. Returns null for everyone when no QSO source
  // has data, so the badge never renders outside a logging session.
  const { getStatus: getWorkedStatus } = useWorkedBefore();
  // Award status from the native logbook: 'new' = the activator's DXCC entity
  // is not in the log at all (ATNO), 'new-band' = entity worked but not on
  // the spot's band. Null for everyone until the logbook has QSOs.
  const { getSpotStatus: getAwardStatus } = useAwards();
  // Activation watch list in Red mode — Only/Not filtering happens upstream
  // (App.jsx ActivateFilter), so here it is purely a highlight.
  const watch = useCompiledWatchlist('activations');
  const isWatchRed = (spot) =>
    watch.mode === 'red' && !!watch.matcher && watch.matcher({ call: spot.call, freq: spot.freq, grid: spot.grid });
  const staleMinutes = lastUpdated ? Math.floor((Date.now() - lastUpdated) / 60000) : null;
  const isStale = staleMinutes !== null && staleMinutes >= 5;
  const checkedTime = lastChecked ? new Date(lastChecked).toISOString().substr(11, 5) + 'z' : '';
  const filterActiveColor = '#ffaa00';
  const rawSpots = filteredData ? filteredData : data;

  // Sort field (#998). Default 'time' preserves the upstream feed order
  // (newest first for POTA/SOTA/WWFF). All activation panels share one key
  // — sorting POTA by freq but SOTA by time tends to be more confusing than
  // useful in practice; revisit if anyone asks.
  const [sortField, setSortField] = useState(() => {
    try {
      return localStorage.getItem('ohc_activations_sort') || 'time';
    } catch {
      return 'time';
    }
  });
  const handleSortChange = (v) => {
    setSortField(v);
    try {
      localStorage.setItem('ohc_activations_sort', v);
    } catch {}
  };

  const spots = useMemo(() => {
    if (!rawSpots) return rawSpots;
    if (sortField === 'time') return rawSpots; // upstream order
    const copy = [...rawSpots];
    if (sortField === 'freq') {
      copy.sort((a, b) => (parseFloat(a.freq) || 0) - (parseFloat(b.freq) || 0));
    } else if (sortField === 'call') {
      copy.sort((a, b) => (a.call || '').localeCompare(b.call || ''));
    }
    return copy;
  }, [rawSpots, sortField]);

  let filterCount = 0;
  if (filters?.bands?.length) filterCount += filters.bands.length;
  if (filters?.grids?.length) filterCount += filters.grids.length;
  if (filters?.modes?.length) filterCount += filters.modes.length;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        className="panel-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px',
          fontSize: '11px',
        }}
      >
        <span>
          {mapDefs.shape && mapDefs.color ? (
            <span
              style={{
                display: 'inline-block',
                background: mapDefs.color,
                color: '#000',
                padding: '1px 4px',
                borderRadius: '3px',
                fontWeight: '700',
                fontSize: '10px',
                marginRight: '4px',
                lineHeight: 1.2,
                verticalAlign: 'middle',
              }}
              title={`Map marker: ${mapDefs.color}`}
            >
              {mapDefs.shape}
            </span>
          ) : (
            '▲ '
          )}
          {mapDefs.name} {data?.length > 0 ? `(${data.length})` : ''}
          {checkedTime && (
            <span
              style={{
                color: isStale ? (staleMinutes >= 10 ? '#ff4444' : '#ffaa00') : '#666',
                marginLeft: '6px',
                fontSize: '9px',
              }}
            >
              {isStale ? `⚠ ${staleMinutes}m stale` : `✓${checkedTime}`}
            </span>
          )}
          {connected !== undefined && (
            <span
              style={{
                color: connected ? '#44cc44' : '#ff4444',
                marginLeft: '6px',
                fontSize: '9px',
              }}
            >
              {connected ? '✓' : '✗'} {connected ? 'Live' : 'Error'}
            </span>
          )}
        </span>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <select
            value={sortField}
            onChange={(e) => handleSortChange(e.target.value)}
            title="Sort spots"
            aria-label="Sort spots"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              fontSize: '10px',
              padding: '1px 4px',
              cursor: 'pointer',
              maxWidth: '70px',
            }}
          >
            <option value="time">Time</option>
            <option value="freq">Freq</option>
            <option value="call">Call</option>
          </select>
          {typeof onOpenFilters === 'function' && (
            <button
              onClick={onOpenFilters}
              title={'Filter spots by band, mode or grid'}
              style={{
                background: filterCount > 0 ? `${filterActiveColor}30` : 'rgba(100,100,100,0.3)',
                border: `1px solid ${filterCount > 0 ? filterActiveColor : '#555'}`,
                color: filterCount > 0 ? filterActiveColor : '#777',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              <IconSearch size={11} style={{ verticalAlign: 'middle' }} />
              {filterCount > 0 ? filterCount : ''}
            </button>
          )}

          {typeof onToggleLabelsOnMap === 'function' && (
            <button
              onClick={onToggleLabelsOnMap}
              title={
                showLabelsOnMap ? `Hide ${mapDefs.name} callsigns on map` : `Show ${mapDefs.name} callsigns on map`
              }
              aria-label={
                showLabelsOnMap ? `Hide ${mapDefs.name} callsigns on map` : `Show ${mapDefs.name} callsigns on map`
              }
              aria-pressed={showLabelsOnMap}
              style={{
                background: showLabelsOnMap ? 'rgba(255, 170, 0, 0.22)' : 'rgba(100, 100, 100, 0.3)',
                border: `1px solid ${showLabelsOnMap ? '#ffaa00' : '#666'}`,
                color: showLabelsOnMap ? '#ffaa00' : '#888',
                padding: '1px 6px',
                borderRadius: '3px',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
              }}
            >
              <IconTag size={11} style={{ verticalAlign: 'middle' }} />
            </button>
          )}

          <button
            onClick={onToggleMap}
            title={showOnMap ? `Hide ${mapDefs.name} activators on map` : `Show ${mapDefs.name} activators on map`}
            aria-label={showOnMap ? `Hide ${mapDefs.name} activators on map` : `Show ${mapDefs.name} activators on map`}
            aria-pressed={showOnMap}
            style={{
              background: showOnMap ? 'rgba(255, 170, 0, 0.22)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${showOnMap ? '#ffaa00' : '#666'}`,
              color: showOnMap ? '#ffaa00' : '#888',
              padding: '1px 6px',
              borderRadius: '3px',
              fontSize: '9px',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            <IconMap size={11} style={{ verticalAlign: 'middle' }} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : spots && spots.length > 0 ? (
          <div
            role="table"
            aria-label={`${mapDefs.label || 'Activation'} spots`}
            style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}
          >
            <div className="visually-hidden" role="row">
              <span role="columnheader">Callsign</span>
              <span role="columnheader">Reference</span>
              <span role="columnheader">Frequency</span>
              <span role="columnheader">Time</span>
              <span role="columnheader">Log</span>
            </div>
            {spots.map((spot, i) => (
              <div
                key={`${spot.call}-${spot.ref}-${i}`}
                style={{
                  padding: '3px 0',
                  borderBottom: i < spots.length - 1 ? '1px solid var(--border-color)' : 'none',
                }}
              >
                <div
                  role="row"
                  data-watch-red={isWatchRed(spot) ? '1' : undefined}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '62px 72px 58px 1fr auto',
                    gap: '4px',
                    cursor: 'pointer',
                    background: isWatchRed(spot) ? 'rgba(255, 68, 68, 0.12)' : undefined,
                    borderLeft: isWatchRed(spot) ? '2px solid var(--accent-red)' : '2px solid transparent',
                    paddingLeft: '2px',
                  }}
                  onMouseEnter={() => onHoverSpot?.(spot)}
                  onMouseLeave={() => onHoverSpot?.(null)}
                  onClick={() => {
                    onSpotClick?.(spot);
                  }}
                >
                  <span
                    role="cell"
                    style={{
                      color: mapDefs.color,
                      fontWeight: '600',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <CallsignLink
                      call={spot.call}
                      color={mapDefs.color}
                      fontWeight="600"
                      onPopup={showPopup}
                      location={spot.grid ? { grid: spot.grid } : undefined}
                      spot={
                        parseFloat(spot.freq) > 0
                          ? { freq: parseFloat(spot.freq) * 1000, mode: spot.mode || null }
                          : undefined
                      }
                    />
                    {(() => {
                      // One badge per row — precedence: new > new-band > worked.
                      // Worked-before is call-level here (activation hunters
                      // mostly care whether the activator is in the log at all).
                      const badge = spotBadge(
                        getAwardStatus(spot.call, parseFloat(spot.freq)),
                        getWorkedStatus(spot.call),
                      );
                      if (badge === 'new') {
                        const label = t('activations.badge.newTooltip', {
                          defaultValue: 'New one — this DXCC entity is not in your logbook (ATNO)',
                        });
                        return (
                          <span
                            title={label}
                            aria-label={label}
                            style={{
                              marginLeft: '3px',
                              padding: '0 3px',
                              fontSize: '8px',
                              fontWeight: '700',
                              letterSpacing: '0.5px',
                              color: '#ff4444',
                              background: 'rgba(255, 68, 68, 0.15)',
                              border: '1px solid rgba(255, 68, 68, 0.6)',
                              borderRadius: '2px',
                              verticalAlign: 'middle',
                            }}
                          >
                            {t('activations.badge.new', { defaultValue: 'NEW' })}
                          </span>
                        );
                      }
                      if (badge === 'new-band') {
                        const label = t('activations.badge.newBandTooltip', {
                          defaultValue: 'Entity worked before, but not on this band — new band slot',
                        });
                        return (
                          <span
                            title={label}
                            aria-label={label}
                            style={{
                              marginLeft: '3px',
                              padding: '0 3px',
                              fontSize: '8px',
                              fontWeight: '700',
                              letterSpacing: '0.5px',
                              color: '#ff8844',
                              background: 'rgba(255, 136, 68, 0.12)',
                              border: '1px solid rgba(255, 136, 68, 0.5)',
                              borderRadius: '2px',
                              verticalAlign: 'middle',
                            }}
                          >
                            {t('activations.badge.newBand', { defaultValue: 'BAND' })}
                          </span>
                        );
                      }
                      if (badge) {
                        const label = t('activations.badge.workedTooltip', {
                          defaultValue: 'In your log — worked this station before',
                        });
                        return (
                          <span
                            title={label}
                            aria-label={label}
                            style={{
                              marginLeft: '3px',
                              fontSize: '9px',
                              color: 'var(--text-muted)',
                              opacity: 0.75,
                            }}
                          >
                            ✓
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </span>
                  <span
                    role="cell"
                    style={{
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`${spot.ref} - ${spot.name}`}
                  >
                    {spot.ref}
                  </span>
                  <span
                    role="cell"
                    style={{ color: 'var(--accent-cyan)', textAlign: 'right' }}
                    title={`${spot.freq} ${spot.mode}`}
                  >
                    {(() => {
                      if (!spot.freq) return '?';
                      const freqVal = parseFloat(spot.freq);
                      // Already in MHz in the hook
                      return freqVal.toFixed(3);
                    })()}
                    <span className="visually-hidden"> megahertz</span>
                  </span>
                  <span role="cell" style={{ color: 'var(--text-muted)', textAlign: 'right', fontSize: '9px' }}>
                    {spot.time}
                  </span>
                  <span role="cell" style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const freqVal = parseFloat(spot.freq);
                        requestLogQso({
                          call: spot.call,
                          freq: Number.isFinite(freqVal) && freqVal > 0 ? freqVal : undefined,
                          mode: spot.mode || undefined,
                          gridsquare: spot.grid || undefined,
                          comment: spot.ref ? `${spot.ref}${spot.name ? ` ${spot.name}` : ''}` : undefined,
                        });
                      }}
                      title={t('logbook.logFromSpotTooltip', {
                        defaultValue: 'Log a QSO with {{call}} in your logbook',
                        call: spot.call,
                      })}
                      aria-label={t('logbook.logFromSpotTooltip', {
                        defaultValue: 'Log a QSO with {{call}} in your logbook',
                        call: spot.call,
                      })}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: '10px',
                        cursor: 'pointer',
                        opacity: 0.55,
                        lineHeight: 1,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.55';
                      }}
                    >
                      📓+
                    </button>
                    {(() => {
                      // Web SDR "listen" link — hear the activator without a rig.
                      const freqVal = parseFloat(spot.freq); // MHz
                      const listen =
                        Number.isFinite(freqVal) && freqVal > 0 ? getListenUrl(freqVal * 1000, spot.mode) : null;
                      if (!listen) return null;
                      return (
                        <a
                          href={listen.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t('dxClusterPanel.listenTooltip', {
                            defaultValue: 'Listen on a web SDR ({{receiver}})',
                            receiver: listen.name,
                          })}
                          aria-label={t('dxClusterPanel.listenTooltip', {
                            defaultValue: 'Listen on a web SDR ({{receiver}})',
                            receiver: listen.name,
                          })}
                          style={{
                            marginLeft: '4px',
                            fontSize: '10px',
                            textDecoration: 'none',
                            opacity: 0.55,
                            transition: 'opacity 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '1';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '0.55';
                          }}
                        >
                          🎧
                        </a>
                      );
                    })()}
                  </span>
                </div>
                {spot.comments?.length > 0 && (
                  <div
                    style={{ textAlign: 'center', fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '11px' }}
                  >
                    {spotIota(spot) && (
                      <span
                        title={`IOTA ${spotIota(spot)}${iotaName(spotIota(spot)) ? ` — ${iotaName(spotIota(spot))}` : ''}`}
                        style={{
                          marginRight: '5px',
                          padding: '0 3px',
                          fontSize: '8px',
                          fontStyle: 'normal',
                          fontWeight: '700',
                          letterSpacing: '0.5px',
                          color: 'var(--accent-cyan)',
                          background: 'rgba(0, 221, 255, 0.12)',
                          border: '1px solid rgba(0, 221, 255, 0.5)',
                          borderRadius: '2px',
                          verticalAlign: 'middle',
                        }}
                      >
                        {spotIota(spot)}
                      </span>
                    )}
                    {spot.comments}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {emptyText || 'No spots'}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivatePanel;
