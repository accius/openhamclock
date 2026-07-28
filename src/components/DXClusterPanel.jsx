/**
 * DXClusterPanel Component
 * Displays DX cluster spots with filtering controls and ON/OFF toggle
 */
import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getBandColor } from '../utils/callsign.js';
import { matchesDXSpotPath } from '../utils/dxClusterSpotMatcher';
import { balanceSpotWindow } from '../utils/dxClusterFilters';
import { IconSearch, IconMap, IconGlobe } from './Icons.jsx';
import CallsignLink from './CallsignLink.jsx';
import { useCallsignPopup } from './CallsignPopupManager.jsx';
import { classifySpotMode } from '../hooks/useBandHealth.js';
import { apiFetch } from '../utils/apiFetch';

// Mirrors the server-side validator — good enough to gate the Spot button.
const isValidCallsign = (call) =>
  typeof call === 'string' && /^[A-Z0-9]{1,3}\d[A-Z]{1,4}(-\d{1,2})?$/i.test(call.trim());

export const DXClusterPanel = ({
  data,
  loading,
  error,
  totalSpots,
  filters,
  onFilterChange,
  onOpenFilters,
  onHoverSpot,
  onSpotClick,
  hoveredSpot,
  showOnMap,
  onToggleMap,
  userCallsign,
}) => {
  const { t } = useTranslation();
  const { showPopup } = useCallsignPopup();

  // ── Spot submission (only when this instance has an OHC Cluster) ────
  const [canSpot, setCanSpot] = useState(false);
  const [showSpotForm, setShowSpotForm] = useState(false);
  const [spotCall, setSpotCall] = useState('');
  const [spotFreq, setSpotFreq] = useState('');
  const [spotComment, setSpotComment] = useState('');
  const [spotStatus, setSpotStatus] = useState(null); // {ok, msg} | 'sending'

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/dxcluster/sources')
      .then((r) => (r?.ok ? r.json() : []))
      .then((sources) => {
        if (!cancelled && Array.isArray(sources)) setCanSpot(sources.some((s) => s.id === 'ohc'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const callsignOk = isValidCallsign(userCallsign || '') && (userCallsign || '').toUpperCase() !== 'N0CALL';

  const submitSpot = async () => {
    const freqRaw = parseFloat(spotFreq);
    // Hams type either kHz (14025.5) or MHz (14.0255) — values under 1000
    // can only be MHz on the bands people actually spot from a web UI.
    const freqKhz = Number.isFinite(freqRaw) && freqRaw < 1000 ? freqRaw * 1000 : freqRaw;

    setSpotStatus('sending');
    try {
      const response = await apiFetch('/api/dxcluster/spot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spotter: userCallsign,
          call: spotCall.trim().toUpperCase(),
          freqKhz,
          comment: spotComment.trim(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setSpotStatus({ ok: true, msg: t('dxClusterPanel.spot.sent', { defaultValue: 'Spot sent!' }) });
        setSpotCall('');
        setSpotComment('');
        setTimeout(() => setSpotStatus(null), 4000);
      } else {
        setSpotStatus({ ok: false, msg: body.error || `HTTP ${response.status}` });
      }
    } catch {
      setSpotStatus({
        ok: false,
        msg: t('dxClusterPanel.spot.failed', { defaultValue: 'Could not send spot' }),
      });
    }
  };

  // Spotter column visibility (#995). Default on to match historical behaviour;
  // users with tight vertical space can hide it to roughly double the spot
  // density in the panel.
  const [showSpotter, setShowSpotter] = useState(() => {
    try {
      return localStorage.getItem('ohc_dx_show_spotter') !== '0';
    } catch {
      return true;
    }
  });
  const toggleSpotter = () => {
    setShowSpotter((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ohc_dx_show_spotter', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  // Sort field (#998). Default 'time' preserves upstream order (newest first).
  const [sortField, setSortField] = useState(() => {
    try {
      return localStorage.getItem('ohc_dx_sort') || 'time';
    } catch {
      return 'time';
    }
  });
  const handleSortChange = (v) => {
    setSortField(v);
    try {
      localStorage.setItem('ohc_dx_sort', v);
    } catch {}
  };

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

    const diffMs = Math.max(0, Date.now() - ts);
    const minutes = Math.floor(diffMs / 60000);
    const utc = new Date(ts);
    const hh = String(utc.getUTCHours()).padStart(2, '0');
    const mm = String(utc.getUTCMinutes()).padStart(2, '0');
    const clock = `${hh}:${mm}z`;

    return t('dxClusterPanel.relativeTime', { minutes, time: clock });
  };

  const formatSpotTimeAriaLabel = (spot) => {
    const ts = parseSpotTimeToTimestamp(spot);
    if (!ts) return spot?.time || '';

    const diffMs = Math.max(0, Date.now() - ts);
    const minutes = Math.floor(diffMs / 60000);
    const utc = new Date(ts);
    const hh = String(utc.getUTCHours()).padStart(2, '0');
    const mm = String(utc.getUTCMinutes()).padStart(2, '0');
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago, ${hh}:${mm} UTC`;
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters?.continents?.length) count++;
    if (filters?.cqZones?.length) count++;
    if (filters?.ituZones?.length) count++;
    if (filters?.bands?.length) count++;
    if (filters?.modes?.length) count++;
    if (filters?.watchlist?.length) count++;
    if (filters?.commentText?.length) count++;
    if (filters?.callsign) count++;
    if (filters?.watchlistOnly) count++;
    if (filters?.dxpeditionsOnly) count++;
    if (filters?.contest) count++;
    if (filters?.excludeContinents) count += filters.excludeContinents.length;
    if (filters?.excludeCqZones) count += filters.excludeCqZones.length;
    if (filters?.excludeItuZones) count += filters.excludeItuZones.length;
    if (filters?.excludeDXCallList) count += filters.excludeDXCallList.length;
    if (filters?.excludeDECallList) count += filters.excludeDECallList.length;

    return count;
  };

  const filterCount = getActiveFilterCount();
  const rawSpots = data || [];

  // Helper: parse spot.freq → MHz number for sort comparison. Mirrors the
  // display-side logic at the row level (kHz values >1000 get divided).
  const freqToMHz = (spot) => {
    if (!spot?.freq) return 0;
    const v = parseFloat(spot.freq);
    if (!Number.isFinite(v)) return 0;
    return v > 1000 ? v / 1000 : v;
  };

  const spots = useMemo(() => {
    // Pick the display window before sorting so mode balance survives: a raw
    // "newest 50" slice is all FT8/FT4 skimmer churn and SSB never shows.
    const windowed = balanceSpotWindow(rawSpots, 50);
    if (sortField === 'time') return windowed;
    const copy = [...windowed];
    if (sortField === 'freq') {
      copy.sort((a, b) => freqToMHz(a) - freqToMHz(b));
    } else if (sortField === 'call') {
      copy.sort((a, b) => (a.call || '').localeCompare(b.call || ''));
    }
    return copy;
  }, [rawSpots, sortField]);

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
          {canSpot && (
            <button
              type="button"
              onClick={() => setShowSpotForm((v) => !v)}
              disabled={!callsignOk}
              title={
                callsignOk
                  ? t('dxClusterPanel.spot.tooltip', { defaultValue: 'Spot a station on the OpenHamClock Cluster' })
                  : t('dxClusterPanel.spot.needCallsign', { defaultValue: 'Set your callsign in Settings to spot' })
              }
              aria-label={t('dxClusterPanel.spot.tooltip', { defaultValue: 'Spot a station' })}
              aria-pressed={showSpotForm}
              style={{
                background: showSpotForm ? 'rgba(0, 255, 136, 0.3)' : 'rgba(100, 100, 100, 0.3)',
                border: `1px solid ${showSpotForm ? 'var(--accent-green)' : '#666'}`,
                color: callsignOk ? (showSpotForm ? 'var(--accent-green)' : '#888') : '#555',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                cursor: callsignOk ? 'pointer' : 'not-allowed',
              }}
            >
              +DX
            </button>
          )}
          <button
            type="button"
            onClick={onOpenFilters}
            title={t('dxClusterPanel.filterTooltip')}
            aria-label={t('dxClusterPanel.filterTooltip')}
            style={{
              background: filterCount > 0 ? 'rgba(255, 170, 0, 0.3)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${filterCount > 0 ? '#ffaa00' : '#666'}`,
              color: filterCount > 0 ? '#ffaa00' : '#888',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            <IconSearch size={10} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
            {filterCount > 0 ? filterCount : ''}
          </button>
          <button
            onClick={toggleSpotter}
            title={showSpotter ? 'Hide spotter (de) column' : 'Show spotter (de) column'}
            aria-label={showSpotter ? 'Hide spotter column' : 'Show spotter column'}
            aria-pressed={showSpotter}
            style={{
              background: showSpotter ? 'rgba(68, 136, 255, 0.3)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${showSpotter ? '#4488ff' : '#666'}`,
              color: showSpotter ? '#4488ff' : '#888',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            de
          </button>
          <button
            type="button"
            onClick={onToggleMap}
            title={showOnMap ? t('dxClusterPanel.mapToggleHide') : t('dxClusterPanel.mapToggleShow')}
            aria-label={showOnMap ? t('dxClusterPanel.mapToggleHide') : t('dxClusterPanel.mapToggleShow')}
            aria-pressed={showOnMap}
            style={{
              background: showOnMap ? 'rgba(68, 136, 255, 0.3)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${showOnMap ? '#4488ff' : '#666'}`,
              color: showOnMap ? '#4488ff' : '#888',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            <IconMap size={10} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
          </button>
        </div>
      </div>

      {/* Quick search */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
        <label htmlFor="dx-cluster-search" className="visually-hidden">
          {t('dxClusterPanel.quickSearchLabel', { defaultValue: 'Search DX cluster spots by callsign' })}
        </label>
        <input
          id="dx-cluster-search"
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
            fontFamily: 'var(--font-mono)',
          }}
        />
      </div>
      {/* Spot submission form */}
      {canSpot && showSpotForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (spotStatus !== 'sending') submitSpot();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}
        >
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              type="text"
              placeholder={t('dxClusterPanel.spot.call', { defaultValue: 'DX call' })}
              aria-label={t('dxClusterPanel.spot.call', { defaultValue: 'DX callsign to spot' })}
              value={spotCall}
              onChange={(e) => setSpotCall(e.target.value)}
              required
              style={{
                flex: 2,
                padding: '4px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
              }}
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder={t('dxClusterPanel.spot.freq', { defaultValue: 'kHz' })}
              aria-label={t('dxClusterPanel.spot.freqLabel', { defaultValue: 'Frequency in kHz' })}
              value={spotFreq}
              onChange={(e) => setSpotFreq(e.target.value)}
              required
              style={{
                flex: 1.5,
                padding: '4px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <button
              type="submit"
              disabled={spotStatus === 'sending'}
              style={{
                background: 'rgba(0, 255, 136, 0.2)',
                border: '1px solid var(--accent-green)',
                color: 'var(--accent-green)',
                padding: '2px 10px',
                borderRadius: '3px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                cursor: spotStatus === 'sending' ? 'wait' : 'pointer',
              }}
            >
              {spotStatus === 'sending'
                ? t('dxClusterPanel.spot.sending', { defaultValue: '...' })
                : t('dxClusterPanel.spot.send', { defaultValue: 'Spot' })}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder={t('dxClusterPanel.spot.comment', { defaultValue: 'Comment (optional)' })}
              aria-label={t('dxClusterPanel.spot.comment', { defaultValue: 'Spot comment' })}
              value={spotComment}
              onChange={(e) => setSpotComment(e.target.value)}
              maxLength={60}
              style={{
                flex: 1,
                padding: '4px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              de {(userCallsign || '').toUpperCase()}
            </span>
          </div>
          {spotStatus && spotStatus !== 'sending' && (
            <div
              role="status"
              style={{ fontSize: '10px', color: spotStatus.ok ? 'var(--accent-green)' : 'var(--accent-red)' }}
            >
              {spotStatus.msg}
            </div>
          )}
        </form>
      )}
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
            color: error ? 'var(--accent-red)' : 'var(--text-muted)',
            fontSize: '12px',
          }}
        >
          {error ? error : filterCount > 0 ? t('dxClusterPanel.noSpotsFiltered') : t('dxClusterPanel.noSpots')}
        </div>
      ) : (
        <div
          role="table"
          aria-label={t('dxClusterPanel.tableLabel', { defaultValue: 'DX cluster spots' })}
          style={{
            flex: 1,
            overflow: 'auto',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <div className="visually-hidden" role="row">
            <span role="columnheader">Frequency</span>
            <span role="columnheader">Callsign</span>
            <span role="columnheader">Mode</span>
            {showSpotter && <span role="columnheader">Spotter</span>}
            <span role="columnheader">Age</span>
          </div>
          {spots.map((spot, i) => {
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
            const isHovered = matchesDXSpotPath(hoveredSpot, spot);
            // Mode is never on the wire — DX cluster format doesn't carry it. Derive from spot.comment if
            // it has an explicit mode keyword, otherwise fall back to frequency band-plan inference.
            const modeInfo = classifySpotMode(spot);

            return (
              <div
                key={`${spot.call}-${spot.freq}-${i}`}
                role="row"
                onMouseEnter={() => onHoverSpot?.(spot)}
                onMouseLeave={() => onHoverSpot?.(null)}
                onClick={() => {
                  onSpotClick?.(spot);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSpotClick?.(spot);
                  }
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: showSpotter ? '55px 1fr auto auto auto' : '55px 1fr auto auto',
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
                <div role="cell" style={{ color, fontWeight: '600' }}>
                  {freqDisplay}
                  <span className="visually-hidden"> megahertz</span>
                </div>
                <div
                  role="cell"
                  style={{
                    color: 'var(--text-primary)',
                    fontWeight: '700',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <CallsignLink
                    call={spot.call}
                    color="var(--text-primary)"
                    fontWeight="700"
                    onPopup={showPopup}
                    location={{ grid: spot.dxGrid, lat: spot.dxLat, lon: spot.dxLon }}
                  />
                </div>
                <div
                  role="cell"
                  style={{
                    color: modeInfo?.mode ? 'var(--text-secondary)' : 'var(--text-muted)',
                    fontStyle: modeInfo?.inferred ? 'italic' : 'normal',
                    fontSize: '10px',
                    alignSelf: 'center',
                    minWidth: '32px',
                    textAlign: 'right',
                  }}
                  title={
                    modeInfo?.mode
                      ? modeInfo.inferred
                        ? `${modeInfo.mode} (inferred from ${modeInfo.inferredBy}, ${modeInfo.confidence} confidence)`
                        : `${modeInfo.mode} (from spot comment)`
                      : 'mode unknown'
                  }
                >
                  {modeInfo?.mode || '—'}
                </div>
                {showSpotter && (
                  <div
                    role="cell"
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '10px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      alignSelf: 'center',
                    }}
                  >
                    de{' '}
                    <CallsignLink
                      call={spot.spotter || '?'}
                      color="var(--text-muted)"
                      fontSize="10px"
                      onPopup={showPopup}
                      location={{ grid: spot.spotterGrid, lat: spot.spotterLat, lon: spot.spotterLon }}
                    />
                  </div>
                )}
                <div
                  role="cell"
                  aria-label={formatSpotTimeAriaLabel(spot)}
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
