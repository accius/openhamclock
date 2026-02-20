/**
 * DXClusterPanel Component
 * Displays DX cluster spots with filtering controls and ON/OFF toggle
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getBandColor, detectMode } from '../utils/callsign.js';
import { useRig } from '../contexts/RigContext.jsx';
import { IconSearch, IconMap, IconGlobe } from './Icons.jsx';
import CallsignLink from './CallsignLink.jsx';

export const DXClusterPanel = ({
  data,
  loading,
  totalSpots,
  filters,
  onFilterChange,
  onOpenFilters,
  onHoverSpot,
  onSpotClick,
  hoveredSpot,
  showOnMap,
  onToggleMap,
}) => {
  const { t } = useTranslation();

  const parseSpotTimeToTimestamp = (spot) => {
    if (spot?.timestamp && Number.isFinite(spot.timestamp)) {
      return spot.timestamp;
    }

    const raw = typeof spot?.time === 'string' ? spot.time.trim() : '';
    const m = raw.match(/^(\d{2}):(\d{2})z$/i);
    if (!m) return null;

    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;

    const now = new Date();
    let ts = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0, 0);

    // Handle day rollover near UTC midnight.
    if (ts - Date.now() > 5 * 60 * 1000) {
      ts -= 24 * 60 * 60 * 1000;
    }

    return ts;
  };

  const formatSpotTimeLabel = (spot) => {
    const ts = parseSpotTimeToTimestamp(spot);
    if (!ts) return spot?.time || '';

    const utc = new Date(ts);
    const hh = String(utc.getUTCHours()).padStart(2, '0');
    const mm = String(utc.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}z`;
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters?.continents?.length) count++;
    if (filters?.cqZones?.length) count++;
    if (filters?.ituZones?.length) count++;
    if (filters?.bands?.length) count++;
    if (filters?.modes?.length) count++;
    if (filters?.watchlist?.length) count++;
    if (filters?.callsign) count++;
    if (filters?.watchlistOnly) count++;
    if (filters?.excludeContinents) count += filters.excludeContinents.length;
    if (filters?.excludeCqZones) count += filters.excludeCqZones.length;
    if (filters?.excludeItuZones) count += filters.excludeItuZones.length;
    if (filters?.excludeCallList) count += filters.excludeCallList.length;

    return count;
  };

  const { tuneTo, tuneEnabled } = useRig();
  const filterCount = getActiveFilterCount();
  const spots = data || [];

  return (
    <div
      className="panel"
      style={{
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: '12px',
          color: 'var(--accent-green)',
          fontWeight: '700',
          marginBottom: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          <IconGlobe size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
          {t('dxClusterPanel.title')}{' '}
          <span style={{ color: 'var(--accent-green)', fontSize: '10px' }}>● {t('dxClusterPanel.live')}</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
            {spots.length}/{totalSpots || spots.length}
          </span>
          <button
            onClick={onOpenFilters}
            title={t('dxClusterPanel.filterTooltip')}
            style={{
              background: filterCount > 0 ? 'rgba(255, 170, 0, 0.3)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${filterCount > 0 ? '#ffaa00' : '#666'}`,
              color: filterCount > 0 ? '#ffaa00' : '#888',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'JetBrains Mono',
              cursor: 'pointer',
            }}
          >
            <IconSearch size={10} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
            {t('dxClusterPanel.filtersButton')}
          </button>
          <button
            onClick={onToggleMap}
            title={showOnMap ? t('dxClusterPanel.mapToggleHide') : t('dxClusterPanel.mapToggleShow')}
            style={{
              background: showOnMap ? 'rgba(68, 136, 255, 0.3)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${showOnMap ? '#4488ff' : '#666'}`,
              color: showOnMap ? '#4488ff' : '#888',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'JetBrains Mono',
              cursor: 'pointer',
            }}
          >
            <IconMap size={10} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
            {showOnMap ? t('dxClusterPanel.mapToggleOn') : t('dxClusterPanel.mapToggleOff')}
          </button>
        </div>
      </div>

      {/* Quick search */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
        <input
          type="text"
          placeholder={t('dxClusterPanel.quickSearch')}
          value={filters?.callsign || ''}
          onChange={(e) => onFilterChange?.({ ...filters, callsign: e.target.value || undefined })}
          style={{
            flex: 1,
            padding: '4px 8px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '3px',
            color: 'var(--text-primary)',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono',
          }}
        />
      </div>

      {/* Spots list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
          <div className="loading-spinner" />
        </div>
      ) : spots.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '20px',
            color: 'var(--text-muted)',
            fontSize: '12px',
          }}
        >
          {filterCount > 0 ? t('dxClusterPanel.noSpotsFiltered') : t('dxClusterPanel.noSpots')}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            fontSize: '12px',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {spots.slice(0, 25).map((spot, i) => {
            // Frequency can be in MHz (string like "14.070") or kHz (number like 14070)
            let freqDisplay = '?';
            let freqMHz = 0;

            if (spot.freq) {
              const freqVal = parseFloat(spot.freq);
              if (freqVal > 1000) {
                // It's in kHz, convert to MHz
                freqMHz = freqVal / 1000;
                freqDisplay = freqMHz.toFixed(3);
              } else {
                // Already in MHz
                freqMHz = freqVal;
                freqDisplay = freqVal.toFixed(3);
              }
            }

            const color = getBandColor(freqMHz);
            const isHovered = hoveredSpot?.call === spot.call;

            return (
              <div
                key={`${spot.call}-${spot.freq}-${i}`}
                onMouseEnter={() => onHoverSpot?.(spot)}
                onMouseLeave={() => onHoverSpot?.(null)}
                onClick={() => {
                  onSpotClick?.(spot);
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '55px 1fr auto 42px',
                  gap: '6px',
                  padding: '5px 6px',
                  borderRadius: '3px',
                  marginBottom: '2px',
                  background: isHovered
                    ? 'rgba(68, 136, 255, 0.25)'
                    : i % 2 === 0
                      ? 'rgba(255,255,255,0.03)'
                      : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  borderLeft: isHovered ? '2px solid #4488ff' : '2px solid transparent',
                }}
              >
                <div style={{ color, fontWeight: '600' }}>{freqDisplay}</div>
                <div
                  style={{
                    color: 'var(--text-primary)',
                    fontWeight: '700',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <CallsignLink call={spot.call} color="var(--text-primary)" fontWeight="700" />
                </div>
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '10px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    alignSelf: 'center',
                  }}
                >
                  de <CallsignLink call={spot.spotter || '?'} color="var(--text-muted)" fontSize="10px" />
                </div>
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '10px',
                    alignSelf: 'center',
                  }}
                >
                  {formatSpotTimeLabel(spot)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DXClusterPanel;
