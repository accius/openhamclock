/**
 * FireWeatherPanel — NWS Red Flag Warnings and Fire Weather Watches
 * (/api/fire-weather/alerts), nearest to DE first, with distance/bearing,
 * affected zones and timing. Click an alert to set DX on its centroid; the
 * fire-weather-alerts map layer draws the polygons.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFireWeather } from '../hooks/useFireWeather.js';
import { fireAlertStyle } from '../plugins/layers/useFireWeatherAlerts.js';
import { formatDistance } from '../utils/geo.js';
import { requestMapFocus } from '../utils/mapFocus.js';

const RADIUS_OPTIONS_KM = [250, 500, 1000, 0]; // 0 = all
const RADIUS_KEY = 'ohc_firewx_radius';

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

export const FireWeatherPanel = ({ deLocation = null, units = 'metric', onSetDX = null, dxLocked = false }) => {
  const { t } = useTranslation();
  const deLat = deLocation?.lat ?? null;
  const deLon = deLocation?.lon ?? null;
  const { alerts, loading, error, stale, zonesPending } = useFireWeather(true, deLat, deLon);
  const [expanded, setExpanded] = useState(null);
  const [radiusKm, setRadiusKm] = useState(() => {
    try {
      const raw = localStorage.getItem(RADIUS_KEY);
      const v = raw == null ? NaN : Number(raw);
      return RADIUS_OPTIONS_KM.includes(v) ? v : 1000;
    } catch {
      return 1000;
    }
  });
  const hasDe = Number.isFinite(deLat) && Number.isFinite(deLon);
  const useMiles = units === 'imperial';
  const shown = hasDe && radiusKm > 0 ? alerts.filter((a) => a.km == null || a.km <= radiusKm) : alerts;
  const warnings = shown.filter((a) => a.event === 'Red Flag Warning').length;

  const changeRadius = (km) => {
    setRadiusKm(km);
    try {
      localStorage.setItem(RADIUS_KEY, String(km));
    } catch {}
  };

  const select = (alert) => {
    setExpanded((cur) => (cur === alert.id ? null : alert.id));
    if (dxLocked || !onSetDX || !alert.centroid) return;
    onSetDX({ lat: alert.centroid.lat, lon: alert.centroid.lon });
    requestMapFocus({ lat: alert.centroid.lat, lon: alert.centroid.lon });
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
        <span>
          🚩 {t('fireWeather.title', { defaultValue: 'FIRE WEATHER' })}
          {warnings > 0 && (
            <span
              style={{
                marginLeft: '6px',
                background: 'rgba(255,45,45,0.25)',
                color: '#ff2d2d',
                border: '1px solid #ff2d2d',
                borderRadius: '4px',
                padding: '1px 5px',
                fontSize: '9px',
              }}
            >
              {warnings} RFW
            </span>
          )}
        </span>
        <select
          value={radiusKm}
          onChange={(e) => changeRadius(Number(e.target.value))}
          aria-label={t('fireWeather.radius', { defaultValue: 'Distance filter' })}
          disabled={!hasDe}
          style={{
            padding: '2px 4px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            fontSize: '9px',
          }}
        >
          {RADIUS_OPTIONS_KM.map((km) => (
            <option key={km} value={km}>
              {km === 0
                ? t('fireWeather.all', { defaultValue: 'All (US)' })
                : useMiles
                  ? `≤ ${Math.round(km * 0.621371)} mi`
                  : `≤ ${km} km`}
            </option>
          ))}
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !shown.length ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {error
              ? t('fireWeather.unavailable', { defaultValue: 'NWS fire weather alerts unavailable' })
              : alerts.length
                ? t('fireWeather.noneNearby', {
                    defaultValue: 'No fire weather alerts within range — widen the filter',
                  })
                : t('fireWeather.none', { defaultValue: 'No Red Flag Warnings or Fire Weather Watches in effect' })}
          </div>
        ) : (
          shown.map((a) => {
            const st = fireAlertStyle(a.event);
            const isOpen = expanded === a.id;
            return (
              <div
                key={a.id}
                style={{
                  padding: '5px 6px',
                  marginBottom: '3px',
                  borderRadius: '4px',
                  background: 'rgba(255,255,255,0.03)',
                  borderLeft: `3px solid ${st.color}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => select(a)}
                  aria-expanded={isOpen}
                  aria-label={`${a.event}: ${a.areaDesc || ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                    color: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      background: st.color,
                      color: '#111',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {st.short}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      flex: 1,
                      whiteSpace: isOpen ? 'normal' : 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {a.zoneNames?.length ? a.zoneNames.join(', ') : a.areaDesc}
                  </span>
                  {a.km != null && (
                    <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                      {formatDistance(a.km, units)} {Math.round(a.bearing)}°
                    </span>
                  )}
                </button>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                  {fmtTime(a.onset)} → {fmtTime(a.ends)}
                  {a.senderName ? ` · ${a.senderName.replace(/^NWS\s*/, '')}` : ''}
                  {!a.geometry ? ` · ${t('fireWeather.zonesPending', { defaultValue: 'map outline loading' })}` : ''}
                </div>
                {isOpen && (
                  <div
                    style={{
                      marginTop: '5px',
                      padding: '6px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '4px',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {a.headline && (
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '4px' }}>
                        {a.headline}
                      </div>
                    )}
                    {a.description}
                    {a.web && (
                      <div style={{ marginTop: '4px' }}>
                        <a
                          href={a.web}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent-cyan)' }}
                        >
                          {t('fireWeather.fullAlert', { defaultValue: 'Full alert' })} →
                        </a>
                      </div>
                    )}
                  </div>
                )}
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
        <span>
          {!hasDe
            ? t('fireWeather.noLocation', { defaultValue: 'Set your location for distances' })
            : stale
              ? t('fireWeather.stale', { defaultValue: 'stale data' })
              : zonesPending > 0
                ? `${zonesPending} ${t('fireWeather.zonesLoading', { defaultValue: 'zone outlines loading' })}`
                : ''}
        </span>
        <a
          href="https://www.weather.gov/fire/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          NWS Fire Weather
        </a>
      </div>
    </div>
  );
};

export default FireWeatherPanel;
