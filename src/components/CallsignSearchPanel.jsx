/**
 * CallsignSearchPanel — standalone callbook lookup (dockable panel
 * `callsign-search`).
 *
 * Reuses the same lookup path as the callsign popups (useCallsignLookup →
 * /api/callsign/:call with the user's callbook credentials and the shared
 * LRU cache). Shows the full result card — name, grid, country/state,
 * lat/lon, distance and bearing from DE — with a "Set as DX" button that
 * moves the DX target the same way spot clicks do (handleDXChange). The
 * last 10 searches persist in localStorage
 * (openhamclock_callsignSearchHistory — synced/profiled/backed up).
 */
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useCallsignLookup from '../hooks/app/useCallsignLookup.js';
import { calculateBearing, calculateDistance, formatDistance, maidenheadToLatLon } from '../utils/geo.js';
import { formatBearing } from '../utils/bearing.js';
import {
  isValidCallsignQuery,
  normalizeCallsignQuery,
  pushHistory,
  loadCallsignSearchHistory,
  saveCallsignSearchHistory,
} from '../utils/callsignSearchHistory.js';

const DEBOUNCE_MS = 600;

const inputStyle = {
  padding: '5px 7px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-primary)',
  fontSize: '12px',
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  minWidth: 0,
  flex: 1,
};

const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '3px' };
const labelStyle = { color: 'var(--text-muted)', flexShrink: 0 };
const valueStyle = { color: 'var(--text-primary)', textAlign: 'right', overflowWrap: 'anywhere' };

export const CallsignSearchPanel = ({ deLocation, units, onSetDX, dxLocked }) => {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState(''); // committed search — drives the lookup
  const [invalid, setInvalid] = useState(false);
  const [history, setHistory] = useState(loadCallsignSearchHistory);
  const debounceRef = useRef(null);

  const { data, loading, error } = useCallsignLookup(query || null);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const commit = (raw) => {
    const call = normalizeCallsignQuery(raw);
    if (!isValidCallsignQuery(call)) {
      if (call) setInvalid(true);
      return;
    }
    setInvalid(false);
    setQuery(call);
    setHistory((prev) => {
      const next = pushHistory(prev, call);
      saveCallsignSearchHistory(next);
      return next;
    });
  };

  const handleChange = (e) => {
    const value = e.target.value.toUpperCase();
    setInput(value);
    setInvalid(false);
    clearTimeout(debounceRef.current);
    // Debounced auto-search once the input looks like a callsign
    if (isValidCallsignQuery(value)) {
      debounceRef.current = setTimeout(() => commit(value), DEBOUNCE_MS);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounceRef.current);
      commit(input);
    }
  };

  const handleHistoryClick = (call) => {
    setInput(call);
    clearTimeout(debounceRef.current);
    commit(call);
  };

  const clearHistory = () => {
    setHistory([]);
    saveCallsignSearchHistory([]);
  };

  // Coordinates: callbook lat/lon first, else derive from grid
  let lat = data?.lat ?? null;
  let lon = data?.lon ?? null;
  if ((lat == null || lon == null) && data?.grid) {
    try {
      const fromGrid = maidenheadToLatLon(data.grid);
      if (fromGrid && Number.isFinite(fromGrid.lat) && Number.isFinite(fromGrid.lon)) {
        lat = fromGrid.lat;
        lon = fromGrid.lon;
      }
    } catch {}
  }
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  const hasDE = Number.isFinite(deLocation?.lat) && Number.isFinite(deLocation?.lon);
  const distanceKm = hasCoords && hasDE ? calculateDistance(deLocation.lat, deLocation.lon, lat, lon) : null;
  const bearing = hasCoords && hasDE ? Math.round(calculateBearing(deLocation.lat, deLocation.lon, lat, lon)) : null;

  const showResult = !!query && !loading && !error && !!data;
  const notFound = !!query && !loading && (!!error || (!!data && !data.name && !data.grid && !hasCoords));
  const country = data?.country && data.country !== 'Unknown' ? data.country : null;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        🔎 {t('callsignSearch.title', { defaultValue: 'CALLSIGN LOOKUP' })}
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
        <input
          style={{ ...inputStyle, borderColor: invalid ? 'var(--accent-red, #f44)' : 'var(--border-color)' }}
          value={input}
          maxLength={16}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder={t('callsignSearch.placeholder', { defaultValue: 'Callsign…' })}
          aria-label={t('callsignSearch.inputAriaLabel', { defaultValue: 'Callsign to look up' })}
          aria-invalid={invalid}
        />
        <button
          onClick={() => {
            clearTimeout(debounceRef.current);
            commit(input);
          }}
          title={t('callsignSearch.searchBtn', { defaultValue: 'Search' })}
          aria-label={t('callsignSearch.searchBtn', { defaultValue: 'Search' })}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-color)',
            borderRadius: '3px',
            color: 'var(--accent-cyan)',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '0 9px',
          }}
        >
          🔎
        </button>
      </div>
      {invalid && (
        <div style={{ color: 'var(--accent-red, #f44)', fontSize: '9px', marginBottom: '4px' }}>
          {t('callsignSearch.invalid', { defaultValue: 'That does not look like a callsign' })}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
        {!query && !invalid && (
          <div style={{ color: 'var(--text-muted)', padding: '8px 2px', lineHeight: 1.5, fontSize: '10px' }}>
            {t('callsignSearch.emptyHint', {
              defaultValue:
                'Type a callsign and press Enter to look it up via your configured callbook (Settings → Integrations).',
            })}
          </div>
        )}

        {loading && !!query && (
          <div style={{ color: 'var(--text-secondary)', padding: '8px 2px' }}>
            {t('callsignSearch.loading', { defaultValue: 'Looking up {{call}}…', call: query })}
          </div>
        )}

        {notFound && (
          <div style={{ color: 'var(--accent-amber)', padding: '8px 2px', fontSize: '10px' }}>
            {t('callsignSearch.notFound', { defaultValue: 'No callbook data found for {{call}}', call: query })}
          </div>
        )}

        {showResult && !notFound && (
          <div
            style={{
              padding: '7px 8px',
              borderRadius: '4px',
              border: '1px solid var(--border-color)',
              background: 'rgba(255,255,255,0.03)',
              marginBottom: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '5px' }}>
              <span
                style={{ color: 'var(--accent-amber)', fontWeight: '700', fontSize: '15px', letterSpacing: '0.5px' }}
              >
                {data.callsign || query}
              </span>
              {data.grid && <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>{data.grid}</span>}
            </div>

            {data.name && (
              <div style={rowStyle}>
                <span style={labelStyle}>{t('callsignSearch.name', { defaultValue: 'Name' })}</span>
                <span style={valueStyle}>{data.name}</span>
              </div>
            )}
            {(country || data.state) && (
              <div style={rowStyle}>
                <span style={labelStyle}>{t('callsignSearch.country', { defaultValue: 'Country' })}</span>
                <span style={valueStyle}>
                  {country}
                  {data.state ? ` · ${data.state}` : ''}
                </span>
              </div>
            )}
            {hasCoords && (
              <div style={rowStyle}>
                <span style={labelStyle}>{t('callsignSearch.coords', { defaultValue: 'Lat/Lon' })}</span>
                <span style={valueStyle}>
                  {lat.toFixed(2)}°, {lon.toFixed(2)}°
                </span>
              </div>
            )}
            {distanceKm != null && (
              <div style={rowStyle}>
                <span style={labelStyle}>{t('callsignSearch.fromDe', { defaultValue: 'From DE' })}</span>
                <span style={{ ...valueStyle, color: 'var(--accent-green)' }}>
                  {formatDistance(distanceKm, units)} @ {formatBearing(bearing, deLocation?.lat, deLocation?.lon)}
                </span>
              </div>
            )}

            {hasCoords && onSetDX && (
              <button
                onClick={() => onSetDX({ lat, lon, callsign: data.callsign || query })}
                disabled={dxLocked}
                title={
                  dxLocked
                    ? t('callsignSearch.setDxLocked', { defaultValue: 'Unlock the DX position to set a new target' })
                    : t('callsignSearch.setDxTooltip', { defaultValue: 'Set the DX target to this station' })
                }
                style={{
                  marginTop: '5px',
                  background: dxLocked ? 'rgba(100,100,100,0.3)' : 'rgba(0, 255, 136, 0.15)',
                  border: `1px solid ${dxLocked ? '#666' : 'var(--accent-green)'}`,
                  color: dxLocked ? '#888' : 'var(--accent-green)',
                  padding: '2px 10px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  cursor: dxLocked ? 'default' : 'pointer',
                }}
              >
                🎯 {t('callsignSearch.setDx', { defaultValue: 'Set as DX' })}
              </button>
            )}

            {data.source && (
              <div style={{ marginTop: '6px', fontSize: '9px', color: 'var(--text-muted)', textAlign: 'right' }}>
                {data.source === 'prefix'
                  ? t('callsignSearch.sourcePrefix', { defaultValue: 'prefix estimate — no callbook record' })
                  : t('callsignSearch.source', { defaultValue: 'source: {{source}}', source: data.source })}
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '9px',
                color: 'var(--text-muted)',
                marginBottom: '3px',
              }}
            >
              <span>{t('callsignSearch.recent', { defaultValue: 'RECENT' })}</span>
              <button
                onClick={clearHistory}
                title={t('callsignSearch.clearHistory', { defaultValue: 'Clear recent searches' })}
                aria-label={t('callsignSearch.clearHistory', { defaultValue: 'Clear recent searches' })}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '9px',
                  padding: '0 2px',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {history.map((call) => (
                <button
                  key={call}
                  onClick={() => handleHistoryClick(call)}
                  style={{
                    background: call === query ? 'rgba(0, 229, 255, 0.12)' : 'var(--bg-tertiary)',
                    border: `1px solid ${call === query ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                    borderRadius: '3px',
                    color: call === query ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '9px',
                    fontFamily: 'var(--font-mono)',
                    padding: '1px 6px',
                  }}
                >
                  {call}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CallsignSearchPanel;
