/**
 * BalloonsPanel — amateur high-altitude / pico balloons from SondeHub
 * Amateur (via /api/balloons). Nearest-to-DE first when a station location
 * is known; otherwise most recently heard first. Each row: payload
 * callsign, altitude, ground speed, last heard, distance and bearing from
 * DE. Click a row to set the DX target on the balloon. The 🗺 button
 * toggles the matching "Balloons" map layer (markers with 6-hour trails).
 */
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useBalloons } from '../hooks/useBalloons.js';
import { calculateBearing, calculateDistance, formatDistance } from '../utils/geo.js';
import { formatBearing, useBearingMode } from '../utils/bearing.js';
import { IconMap } from './Icons.jsx';

const LAYER_ID = 'balloons';

function useLayerEnabled(id) {
  const read = () => {
    try {
      const l = window.hamclockLayerControls?.layers?.find((x) => x.id === id);
      if (l) return !!l.enabled;
      const settings = JSON.parse(localStorage.getItem('openhamclock_mapSettings') || '{}');
      return !!settings?.layers?.[id]?.enabled;
    } catch {
      return false;
    }
  };
  const [enabled, setEnabled] = useState(read);
  useEffect(() => {
    const onToggle = (e) => {
      if (e.detail?.id === id) setEnabled(!!e.detail.enabled);
    };
    window.addEventListener('openhamclock-layer-toggle', onToggle);
    return () => window.removeEventListener('openhamclock-layer-toggle', onToggle);
  }, [id]);
  const toggle = () => {
    const next = !enabled;
    if (window.hamclockLayerControls?.toggleLayer) window.hamclockLayerControls.toggleLayer(id, next);
    setEnabled(next);
  };
  return [enabled, toggle];
}

const fmtAlt = (m, units) => {
  if (m == null) return '—';
  return units === 'metric' ? `${Math.round(m).toLocaleString()} m` : `${Math.round(m * 3.28084).toLocaleString()} ft`;
};
const fmtSpeed = (kmh, units) => {
  if (kmh == null) return '—';
  return units === 'metric' ? `${Math.round(kmh)} km/h` : `${Math.round(kmh * 0.621371)} mph`;
};
const ageLabel = (iso, now) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, '0')}`;
};

export const BalloonsPanel = ({ deLat = null, deLon = null, units = 'imperial', onSpotClick }) => {
  const { t } = useTranslation();
  const { balloons, loading, error, fetchedAt, stale } = useBalloons();
  const [layerOn, toggleLayer] = useLayerEnabled(LAYER_ID);
  const bearingMode = useBearingMode();
  const [now, setNow] = useState(() => Date.now());
  const [sort, setSort] = useState(() => {
    try {
      return localStorage.getItem('ohc_balloons_sort') || 'dist';
    } catch {
      return 'dist';
    }
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  const hasDE = Number.isFinite(deLat) && Number.isFinite(deLon);

  const rows = useMemo(() => {
    const list = balloons.map((b) => {
      const dist = hasDE ? calculateDistance(deLat, deLon, b.lat, b.lon) : null;
      const brg = hasDE ? calculateBearing(deLat, deLon, b.lat, b.lon) : null;
      return { ...b, distKm: dist, bearing: brg };
    });
    if (sort === 'dist' && hasDE) list.sort((a, b) => a.distKm - b.distKm);
    else if (sort === 'alt') list.sort((a, b) => (b.alt ?? -1) - (a.alt ?? -1));
    else list.sort((a, b) => Date.parse(b.lastHeard) - Date.parse(a.lastHeard));
    return list;
  }, [balloons, deLat, deLon, hasDE, sort]);

  const setSortPersist = (v) => {
    setSort(v);
    try {
      localStorage.setItem('ohc_balloons_sort', v);
    } catch {}
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
        }}
      >
        <span>
          🎈 {t('balloons.title', { defaultValue: 'BALLOONS' })}{' '}
          <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: '400' }}>
            {balloons.length} · 6h{stale ? ` · ${t('balloons.stale', { defaultValue: 'stale' })}` : ''}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <select
            value={sort}
            onChange={(e) => setSortPersist(e.target.value)}
            aria-label={t('balloons.sort', { defaultValue: 'Sort balloons' })}
            title={t('balloons.sort', { defaultValue: 'Sort balloons' })}
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              fontSize: '9px',
              padding: '1px 3px',
            }}
          >
            <option value="dist">{t('balloons.sortDist', { defaultValue: 'Nearest' })}</option>
            <option value="time">{t('balloons.sortTime', { defaultValue: 'Newest' })}</option>
            <option value="alt">{t('balloons.sortAlt', { defaultValue: 'Highest' })}</option>
          </select>
          <button
            type="button"
            onClick={toggleLayer}
            aria-pressed={layerOn}
            title={
              layerOn
                ? t('balloons.mapHide', { defaultValue: 'Hide balloons on the map' })
                : t('balloons.mapShow', { defaultValue: 'Show balloons on the map' })
            }
            aria-label={
              layerOn
                ? t('balloons.mapHide', { defaultValue: 'Hide balloons on the map' })
                : t('balloons.mapShow', { defaultValue: 'Show balloons on the map' })
            }
            style={{
              background: layerOn ? 'rgba(68, 136, 255, 0.3)' : 'rgba(100, 100, 100, 0.3)',
              border: `1px solid ${layerOn ? '#4488ff' : '#666'}`,
              color: layerOn ? '#4488ff' : '#888',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              cursor: 'pointer',
            }}
          >
            <IconMap size={10} style={{ verticalAlign: 'middle' }} />
          </button>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
            <div className="loading-spinner" />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ color: error ? 'var(--accent-red, #f44)' : 'var(--text-muted)', padding: '10px 4px' }}>
            {error
              ? t('balloons.error', { defaultValue: 'SondeHub unavailable — retrying.' })
              : t('balloons.empty', { defaultValue: 'No amateur balloons reported in the last 6 hours.' })}
          </div>
        ) : (
          <div role="table" aria-label={t('balloons.title', { defaultValue: 'Balloons' })}>
            <div className="visually-hidden" role="row">
              <span role="columnheader">Payload</span>
              <span role="columnheader">Altitude</span>
              <span role="columnheader">Speed</span>
              <span role="columnheader">Last heard</span>
              <span role="columnheader">Distance and bearing</span>
            </div>
            {rows.map((b, i) => {
              const brg = b.bearing != null ? formatBearing(b.bearing, deLat, deLon, bearingMode) : null;
              return (
                <div
                  key={b.id}
                  role="row"
                  tabIndex={0}
                  onClick={() => onSpotClick?.({ call: b.call, lat: b.lat, lon: b.lon })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSpotClick?.({ call: b.call, lat: b.lat, lon: b.lon });
                    }
                  }}
                  title={[b.model, b.modulation, b.comment].filter(Boolean).join(' · ')}
                  style={{
                    padding: '4px 5px',
                    borderRadius: '3px',
                    marginBottom: '2px',
                    background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', alignItems: 'center' }}>
                    <span role="cell" style={{ color: 'var(--text-primary)', fontWeight: '700' }}>
                      {b.call}
                      {b.aprs && (
                        <span
                          title="Reported via APRS"
                          style={{
                            marginLeft: '4px',
                            fontSize: '8px',
                            color: 'var(--accent-amber)',
                            fontWeight: '400',
                          }}
                        >
                          APRS
                        </span>
                      )}
                    </span>
                    <span role="cell" style={{ color: 'var(--accent-cyan)' }}>
                      {fmtAlt(b.alt, units)}
                      {b.ascentRate != null && Math.abs(b.ascentRate) >= 0.3 && (
                        <span style={{ marginLeft: '3px', color: 'var(--text-muted)' }}>
                          {b.ascentRate > 0 ? '↑' : '↓'}
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '6px',
                      color: 'var(--text-muted)',
                      fontSize: '9px',
                      marginTop: '1px',
                    }}
                  >
                    <span role="cell">
                      {fmtSpeed(b.speedKmh, units)}
                      {b.frequency ? ` · ${b.frequency.toFixed(3)} MHz` : ''}
                      {b.uploader ? ` · via ${b.uploader}` : ''}
                    </span>
                    <span role="cell">
                      {ageLabel(b.lastHeard, now)}
                      {b.distKm != null && (
                        <span style={{ marginLeft: '6px', color: 'var(--accent-green)' }}>
                          {formatDistance(b.distKm, units)} @ {brg}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
          paddingTop: '2px',
        }}
      >
        {t('balloons.footer', { defaultValue: 'SondeHub Amateur · click a balloon to set DX' })}
        {fetchedAt ? ` · ${ageLabel(fetchedAt, now)}` : ''}
      </div>
    </div>
  );
};

export default BalloonsPanel;
