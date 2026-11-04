/**
 * DXClusterPanel Component
 * Displays DX cluster spots with filtering controls and ON/OFF toggle
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getReadableBandColorForFreq } from '../utils/bandColors.js';
import { matchesDXSpotPath } from '../utils/dxClusterSpotMatcher';
import { balanceSpotWindow } from '../utils/dxClusterFilters';
import { IconSearch, IconMap, IconGlobe } from './Icons.jsx';
import CallsignLink from './CallsignLink.jsx';
import SpotBadge from './SpotBadge.jsx';
import { useCallsignPopup } from './CallsignPopupManager.jsx';
import { classifySpotMode } from '../hooks/useBandHealth.js';
import { useWorkedBefore } from '../hooks/useWorkedBefore.js';
import { useAwards } from '../hooks/useAwards.js';
import { spotBadge } from '../utils/awards.js';
import { apiFetch } from '../utils/apiFetch';
import { getListenUrl, loadNearbyReceivers } from '../utils/webSdr.js';
import { requestLogQso } from '../services/logbookStore.js';
import { useCompiledWatchlist } from '../hooks/useWatchlists.js';
import { spotIota, iotaName } from '../utils/iota.js';

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
  // Optional second click hook (Contest layout): receives the spot so the
  // quick-log strip can populate its callsign box. Undefined elsewhere —
  // zero behavior change for other layouts.
  onSpotSelect,
  hoveredSpot,
  showOnMap,
  onToggleMap,
  userCallsign,
  deLat,
  deLon,
}) => {
  const { t } = useTranslation();
  const { showPopup } = useCallsignPopup();

  // Warm the nearby web-SDR receiver cache (KiwiSDR public directory) so the
  // 🎧 links can be computed synchronously at render time. One re-render when
  // the list lands; getListenUrl() reads the module-level cache directly.
  const [, setSdrDirectoryTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadNearbyReceivers(deLat, deLon).then((list) => {
      if (!cancelled && list) setSdrDirectoryTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [deLat, deLon]);

  // Worked-before / dupe flags from live logged QSOs (N3FJP + N1MM/DXLog).
  // getStatus returns null for every call when neither source has data, so
  // the badges simply never render unless the operator is actually logging.
  const { getStatus: getWorkedStatus } = useWorkedBefore();

  // Award status from the native logbook: 'new' = the spot's DXCC entity is
  // not in the log at all (ATNO), 'new-band' = entity worked, but not on this
  // band. Null for everyone until the logbook has QSOs — zero-config.
  const { getSpotStatus: getAwardStatus } = useAwards();

  // HamClock-style DX watch list. Only/Not filtering happens in
  // useDXClusterData; Red mode is painted here (plus off-screen arrows).
  const watch = useCompiledWatchlist('dx');
  const isWatchRed = useCallback(
    (spot) =>
      watch.mode === 'red' && !!watch.matcher && watch.matcher({ call: spot.call, freq: spot.freq, grid: spot.dxGrid }),
    [watch],
  );

  // ── Scroll handling: freeze the list while the user is scrolled away, show
  // a "NEW n" jump button for spots that arrived meanwhile, and red arrows
  // when Red-list matches sit above/below the viewport.
  const listRef = useRef(null);
  const frozenRef = useRef(null); // snapshot shown while scrolled away
  const [scrolledAway, setScrolledAway] = useState(false);
  const [scrollTick, setScrollTick] = useState(0);
  const [redArrows, setRedArrows] = useState({ up: false, down: false });
  const spotKey = (s) => s.id || `${s.call}-${s.freq}-${s.spotter}`;

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
    if (watch.matcher) count++;
    if (filters?.commentText?.length) count++;
    if (filters?.callsign) count++;
    if (filters?.dxpeditionsOnly) count++;
    if (filters?.iotaOnly) count++;
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

  // While scrolled away, keep showing the snapshot taken when the user left
  // the top so rows don't shift under the pointer; count what arrived since.
  const displaySpots = scrolledAway && frozenRef.current ? frozenRef.current : spots;
  const newCount = useMemo(() => {
    if (!scrolledAway || !frozenRef.current) return 0;
    const known = new Set(frozenRef.current.map(spotKey));
    return spots.filter((s) => !known.has(spotKey(s))).length;
  }, [spots, scrolledAway]);

  const handleListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const away = el.scrollTop > 4;
    if (away !== scrolledAway) {
      frozenRef.current = away ? spots : null;
      setScrolledAway(away);
    }
    setScrollTick((n) => n + 1);
  }, [scrolledAway, spots]);

  const jumpToTop = useCallback(() => {
    frozenRef.current = null;
    setScrolledAway(false);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, []);

  const scrollToRed = useCallback((direction) => {
    const el = listRef.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll('[data-watch-red="1"]'));
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    const target =
      direction === 'up'
        ? rows.filter((r) => r.offsetTop + r.offsetHeight <= top).pop()
        : rows.find((r) => r.offsetTop >= bottom);
    if (target) el.scrollTop = Math.max(0, target.offsetTop - 4);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el || watch.mode !== 'red' || !watch.matcher) {
      setRedArrows((prev) => (prev.up || prev.down ? { up: false, down: false } : prev));
      return;
    }
    const rows = el.querySelectorAll('[data-watch-red="1"]');
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    let up = false;
    let down = false;
    rows.forEach((r) => {
      if (r.offsetTop + r.offsetHeight <= top) up = true;
      else if (r.offsetTop >= bottom) down = true;
    });
    setRedArrows((prev) => (prev.up === up && prev.down === down ? prev : { up, down }));
  }, [displaySpots, scrollTick, watch, showSpotter]);

  const overlayButtonStyle = {
    position: 'absolute',
    right: '10px',
    zIndex: 2,
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '10px',
    fontFamily: 'var(--font-mono)',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
  };

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
            type="button"
            onClick={() => onFilterChange?.({ ...filters, iotaOnly: filters?.iotaOnly ? undefined : true })}
            title={t('dxClusterPanel.iota.toggleTooltip', {
              defaultValue: 'Show only spots with an IOTA reference (panel and map)',
            })}
            aria-label={t('dxClusterPanel.iota.toggleTooltip', {
              defaultValue: 'Show only spots with an IOTA reference (panel and map)',
            })}
            aria-pressed={!!filters?.iotaOnly}
            style={{
              background: filters?.iotaOnly ? 'rgba(0, 221, 255, 0.25)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${filters?.iotaOnly ? 'var(--accent-cyan)' : '#666'}`,
              color: filters?.iotaOnly ? 'var(--accent-cyan)' : '#888',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '9px',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            {t('dxClusterPanel.iota.badge', { defaultValue: 'IOTA' })}
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
      ) : displaySpots.length === 0 ? (
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
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {scrolledAway && newCount > 0 && (
            <button
              type="button"
              onClick={jumpToTop}
              aria-label={t('dxClusterPanel.newSpotsAria', {
                defaultValue: '{{count}} new spots — jump to top',
                count: newCount,
              })}
              style={{
                ...overlayButtonStyle,
                top: '4px',
                left: '50%',
                right: 'auto',
                transform: 'translateX(-50%)',
                background: 'var(--accent-green)',
                color: '#000',
                border: 'none',
              }}
            >
              ↑ {t('dxClusterPanel.newSpots', { defaultValue: 'NEW {{count}}', count: newCount })}
            </button>
          )}
          {redArrows.up && (
            <button
              type="button"
              onClick={() => scrollToRed('up')}
              aria-label={t('dxClusterPanel.watchAbove', { defaultValue: 'Watch list match above — scroll up' })}
              title={t('dxClusterPanel.watchAbove', { defaultValue: 'Watch list match above — scroll up' })}
              style={{
                ...overlayButtonStyle,
                top: '4px',
                background: 'var(--accent-red)',
                color: '#fff',
                border: 'none',
              }}
            >
              ▲
            </button>
          )}
          {redArrows.down && (
            <button
              type="button"
              onClick={() => scrollToRed('down')}
              aria-label={t('dxClusterPanel.watchBelow', { defaultValue: 'Watch list match below — scroll down' })}
              title={t('dxClusterPanel.watchBelow', { defaultValue: 'Watch list match below — scroll down' })}
              style={{
                ...overlayButtonStyle,
                bottom: '4px',
                background: 'var(--accent-red)',
                color: '#fff',
                border: 'none',
              }}
            >
              ▼
            </button>
          )}
          <div
            ref={listRef}
            onScroll={handleListScroll}
            role="table"
            aria-label={t('dxClusterPanel.tableLabel', { defaultValue: 'DX cluster spots' })}
            style={{
              position: 'relative',
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
              <span role="columnheader">Log / Listen</span>
            </div>
            {displaySpots.map((spot, i) => {
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

              const color = getReadableBandColorForFreq(freqMHz);
              const isHovered = matchesDXSpotPath(hoveredSpot, spot);
              // Mode is never on the wire — DX cluster format doesn't carry it. Derive from spot.comment if
              // it has an explicit mode keyword, otherwise fall back to frequency band-plan inference.
              const modeInfo = classifySpotMode(spot);
              // 'dupe' = worked on this band+mode, 'worked' = in the log on
              // another band/mode, null = not in the log (a "new one").
              const workedStatus = getWorkedStatus(spot.call, freqMHz, modeInfo?.mode);
              // Award angle from the native logbook: 'new' (ATNO) / 'new-band'.
              // spotBadge collapses both statuses into the single badge shown —
              // precedence: new > new-band > worked/dupe.
              const badge = spotBadge(getAwardStatus(spot.call, freqMHz), workedStatus);
              // Web SDR "listen" link — lets rig-less users hear the station.
              const listen = freqMHz > 0 ? getListenUrl(freqMHz * 1000, modeInfo?.mode) : null;
              // Red watch-list match: tinted row + red callsign (Red mode only).
              const watchRed = isWatchRed(spot);
              // IOTA reference from the comment ("EU-005") — badge + island group tooltip.
              const iota = spotIota(spot);

              return (
                <div
                  key={`${spot.call}-${spot.freq}-${i}`}
                  role="row"
                  data-watch-red={watchRed ? '1' : undefined}
                  onMouseEnter={() => onHoverSpot?.(spot)}
                  onMouseLeave={() => onHoverSpot?.(null)}
                  onClick={() => {
                    onSpotClick?.(spot);
                    onSpotSelect?.(spot);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSpotClick?.(spot);
                      onSpotSelect?.(spot);
                    }
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: showSpotter ? '55px 1fr auto auto auto auto' : '55px 1fr auto auto auto',
                    gap: '6px',
                    padding: '5px 6px',
                    borderRadius: '3px',
                    marginBottom: '2px',
                    background: isHovered
                      ? 'rgba(68, 136, 255, 0.25)'
                      : watchRed
                        ? 'rgba(255, 68, 68, 0.12)'
                        : i % 2 === 0
                          ? 'rgba(255,255,255,0.03)'
                          : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    borderLeft: isHovered
                      ? '2px solid #4488ff'
                      : watchRed
                        ? '2px solid var(--accent-red)'
                        : '2px solid transparent',
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
                      color={watchRed ? 'var(--accent-red)' : 'var(--text-primary)'}
                      fontWeight="700"
                      onPopup={showPopup}
                      location={{ grid: spot.dxGrid, lat: spot.dxLat, lon: spot.dxLon }}
                      spot={freqMHz > 0 ? { freq: freqMHz * 1000, mode: modeInfo?.mode ?? null } : undefined}
                    />
                    <SpotBadge badge={badge} />
                    {iota && (
                      <span
                        title={`IOTA ${iota}${iotaName(iota) ? ` — ${iotaName(iota)}` : ''}`}
                        aria-label={`IOTA ${iota}${iotaName(iota) ? `, ${iotaName(iota)}` : ''}`}
                        style={{
                          marginLeft: '4px',
                          padding: '0 3px',
                          fontSize: '8px',
                          fontWeight: '700',
                          letterSpacing: '0.5px',
                          color: 'var(--accent-cyan)',
                          background: 'rgba(0, 221, 255, 0.12)',
                          border: '1px solid rgba(0, 221, 255, 0.5)',
                          borderRadius: '2px',
                          verticalAlign: 'middle',
                        }}
                      >
                        {iota}
                      </span>
                    )}
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
                  <div role="cell" style={{ alignSelf: 'center', display: 'flex', gap: '2px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestLogQso({
                          call: spot.call,
                          freq: freqMHz > 0 ? freqMHz : undefined,
                          mode: modeInfo?.mode || undefined,
                          gridsquare: spot.dxGrid || undefined,
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
                        transition: 'opacity 0.15s',
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
                    {listen && (
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
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default DXClusterPanel;
