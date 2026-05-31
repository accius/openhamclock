/**
 * ActivatePanel Component
 * Displays <whatever> on the Air activations with ON/OFF toggle
 */
import React, { useState, useMemo } from 'react';
import CallsignLink from './CallsignLink.jsx';
import { IconSearch, IconRefresh, IconMap, IconTag } from './Icons.jsx';

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
}) => {
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
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '62px 72px 58px 1fr',
                    gap: '4px',
                    cursor: 'pointer',
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
                    <CallsignLink call={spot.call} color={mapDefs.color} fontWeight="600" />
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
                </div>
                {spot.comments?.length > 0 && (
                  <div
                    style={{ textAlign: 'center', fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '11px' }}
                  >
                    {spot.comments}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No spots
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivatePanel;
