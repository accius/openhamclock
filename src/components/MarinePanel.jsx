/**
 * MarinePanel — nearest NDBC buoys / coastal stations to DE
 * (/api/ndbc/latest): wind, gusts, wave height and dominant period,
 * pressure, air and water temperature, sorted by distance. Click a station
 * to set DX on it. The ndbc-buoys map layer plots every station.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNDBCBuoys } from '../hooks/useNDBCBuoys.js';
import { formatDistance } from '../utils/geo.js';
import {
  formatWindObs,
  formatWaves,
  formatPressure,
  formatTemp,
  formatObsAge,
  hasMarineData,
  waveColor,
} from '../utils/marine.js';
import { requestMapFocus } from '../utils/mapFocus.js';

const COUNT_OPTIONS = [10, 25, 50];
const COUNT_KEY = 'ohc_marine_count';
const BUOYS_KEY = 'ohc_marine_buoys_only';
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const isBuoy = (s) => /buoy/i.test(s.type || '') || /^\d{5}$/.test(String(s.id));

export const MarinePanel = ({ deLocation = null, units = 'metric', onSetDX = null, dxLocked = false }) => {
  const { t } = useTranslation();
  const lat = deLocation?.lat ?? null;
  const lon = deLocation?.lon ?? null;
  const [count, setCount] = useState(() => {
    try {
      const v = Number(localStorage.getItem(COUNT_KEY));
      return COUNT_OPTIONS.includes(v) ? v : 25;
    } catch {
      return 25;
    }
  });
  const [buoysOnly, setBuoysOnly] = useState(() => {
    try {
      return localStorage.getItem(BUOYS_KEY) !== '0';
    } catch {
      return true;
    }
  });
  // Ask for more than we show so the buoys-only / has-data filter still fills the list
  const { stations, loading, error, stale, hasLocation } = useNDBCBuoys(lat, lon, count * 3);
  const shown = stations.filter((s) => hasMarineData(s) && (!buoysOnly || isBuoy(s))).slice(0, count);

  const changeCount = (n) => {
    setCount(n);
    try {
      localStorage.setItem(COUNT_KEY, String(n));
    } catch {}
  };
  const toggleBuoys = () => {
    setBuoysOnly((v) => {
      try {
        localStorage.setItem(BUOYS_KEY, v ? '0' : '1');
      } catch {}
      return !v;
    });
  };
  const select = (s) => {
    if (dxLocked || !onSetDX) return;
    onSetDX({ lat: s.lat, lon: s.lon });
    requestMapFocus({ lat: s.lat, lon: s.lon });
  };

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent-primary)',
          fontWeight: '700',
          gap: '6px',
        }}
      >
        <span>🛟 {t('marine.title', { defaultValue: 'MARINE WX' })}</span>
        <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={toggleBuoys}
            aria-pressed={buoysOnly}
            aria-label={t('marine.buoysOnly', { defaultValue: 'Buoys only' })}
            title={t('marine.buoysOnlyTitle', { defaultValue: 'Hide coastal / water-level stations' })}
            style={{
              padding: '2px 6px',
              background: buoysOnly ? 'rgba(0,255,136,0.15)' : 'var(--bg-tertiary)',
              border: `1px solid ${buoysOnly ? 'var(--accent-green)' : 'var(--border-color)'}`,
              borderRadius: '4px',
              color: buoysOnly ? 'var(--accent-green)' : 'var(--text-secondary)',
              fontSize: '9px',
              cursor: 'pointer',
            }}
          >
            {t('marine.buoysOnly', { defaultValue: 'Buoys only' })}
          </button>
          <select
            value={count}
            onChange={(e) => changeCount(Number(e.target.value))}
            aria-label={t('marine.count', { defaultValue: 'Number of stations' })}
            style={{
              padding: '2px 4px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: '9px',
            }}
          >
            {COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {!hasLocation ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {t('marine.noLocation', { defaultValue: 'Set your location in Settings → Station' })}
          </div>
        ) : loading && !stations.length ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !shown.length ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {error
              ? t('marine.unavailable', { defaultValue: 'NDBC observations unavailable' })
              : t('marine.none', { defaultValue: 'No reporting stations found' })}
          </div>
        ) : (
          shown.map((s) => {
            const color = waveColor(s.wvht);
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => select(s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    select(s);
                  }
                }}
                aria-label={`${s.id} ${s.name || ''}`}
                title={
                  dxLocked
                    ? t('marine.dxLocked', { defaultValue: 'DX is locked' })
                    : t('marine.setDx', { defaultValue: 'Set DX to this station' })
                }
                style={{
                  padding: '4px 6px',
                  marginBottom: '3px',
                  borderRadius: '4px',
                  background: 'rgba(255,255,255,0.03)',
                  borderLeft: `3px solid ${color}`,
                  cursor: dxLocked ? 'default' : 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px' }}>
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.id}
                    {s.name && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {s.name}</span>}
                  </span>
                  <span style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
                    {formatDistance(s.km, units)} {compass(s.bearing)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '6px',
                    color: 'var(--text-secondary)',
                    marginTop: '1px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>{t('marine.wind', { defaultValue: 'wind' })}</span>{' '}
                    {formatWindObs(s)}
                  </span>
                  <span>
                    <span style={{ color: 'var(--text-muted)' }}>{t('marine.seas', { defaultValue: 'seas' })}</span>{' '}
                    <span style={{ color: s.wvht != null ? color : 'inherit' }}>{formatWaves(s, units)}</span>
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '6px',
                    color: 'var(--text-muted)',
                    marginTop: '1px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{formatPressure(s)}</span>
                  <span>
                    {t('marine.air', { defaultValue: 'air' })} {formatTemp(s.atmp, units)} ·{' '}
                    {t('marine.water', { defaultValue: 'water' })} {formatTemp(s.wtmp, units)}
                    {s.time ? ` · ${formatObsAge(s.time)}` : ''}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '9px',
          color: 'var(--text-muted)',
          paddingTop: '3px',
        }}
      >
        <span>{stale ? t('marine.stale', { defaultValue: 'stale data' }) : ''}</span>
        <a
          href="https://www.ndbc.noaa.gov/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          NOAA NDBC
        </a>
      </div>
    </div>
  );
};

export default MarinePanel;
