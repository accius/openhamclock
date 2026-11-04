/**
 * TropicalPanel — active tropical cyclones worldwide (NHC + JTWC via
 * /api/tropical/storms): name, basin, category, winds, pressure, movement,
 * position, forecast table. Click a storm to set the DX target on it (and
 * pan the map there); the matching map layer draws the track and cone.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTropicalStorms } from '../hooks/useTropicalStorms.js';
import {
  categoryColor,
  categoryBadge,
  formatWind,
  formatMovement,
  formatPosition,
  basinName,
  sortStorms,
  formatValidAt,
} from '../utils/tropical.js';
import { calculateDistance, calculateBearing, formatDistance } from '../utils/geo.js';
import { requestMapFocus } from '../utils/mapFocus.js';

const relTime = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return '';
  return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
};

export const TropicalPanel = ({ deLocation = null, units = 'metric', onSetDX = null, dxLocked = false }) => {
  const { t } = useTranslation();
  const { storms, loading, error, stale, sources, fetchedAt } = useTropicalStorms(true);
  const [expanded, setExpanded] = useState(null);
  const sorted = sortStorms(storms);
  const deLat = deLocation?.lat;
  const deLon = deLocation?.lon;
  const hasDe = Number.isFinite(deLat) && Number.isFinite(deLon);

  const selectStorm = (storm) => {
    setExpanded((cur) => (cur === storm.id ? null : storm.id));
    if (dxLocked || !onSetDX || !Number.isFinite(storm.lat)) return;
    onSetDX({ lat: storm.lat, lon: storm.lon });
    requestMapFocus({ lat: storm.lat, lon: storm.lon });
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
        <span>🌀 {t('tropical.title', { defaultValue: 'TROPICAL CYCLONES' })}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: 400 }}>
          {stale ? t('tropical.stale', { defaultValue: 'stale' }) + ' · ' : ''}
          {sources ? `NHC ${sources.nhc === 'ok' ? '✓' : '✗'} · JTWC ${sources.jtwc === 'ok' ? '✓' : '✗'}` : ''}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !sorted.length ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {error
              ? t('tropical.unavailable', { defaultValue: 'Tropical cyclone data unavailable' })
              : t('tropical.none', { defaultValue: 'No active tropical cyclones' })}
          </div>
        ) : (
          sorted.map((storm) => {
            const color = categoryColor(storm.category?.code);
            const isOpen = expanded === storm.id;
            const km =
              hasDe && Number.isFinite(storm.lat) ? calculateDistance(deLat, deLon, storm.lat, storm.lon) : null;
            const brg = km != null ? Math.round(calculateBearing(deLat, deLon, storm.lat, storm.lon)) : null;
            return (
              <div
                key={storm.id}
                style={{
                  padding: '5px 6px',
                  marginBottom: '3px',
                  borderRadius: '4px',
                  background: 'rgba(255,255,255,0.03)',
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => selectStorm(storm)}
                  aria-expanded={isOpen}
                  aria-label={`${storm.name}: ${storm.category?.label || ''}`}
                  title={
                    dxLocked
                      ? t('tropical.dxLocked', { defaultValue: 'DX is locked — click to expand' })
                      : t('tropical.setDx', { defaultValue: 'Set DX to this storm' })
                  }
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
                      background: color,
                      color: '#111',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      fontWeight: 700,
                      flexShrink: 0,
                      minWidth: '28px',
                      textAlign: 'center',
                    }}
                  >
                    {categoryBadge(storm)}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {storm.name}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {basinName(storm.basin)}</span>
                  </span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: 600, flexShrink: 0 }}>
                    {storm.windKt != null ? `${storm.windKt} kt` : '—'}
                  </span>
                </button>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: 'var(--text-muted)',
                    marginTop: '2px',
                  }}
                >
                  <span>
                    {formatPosition(storm.lat, storm.lon)} · {formatMovement(storm, units)}
                  </span>
                  <span style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
                    {km != null ? `${formatDistance(km, units)} ${brg}°` : relTime(storm.lastUpdate)}
                  </span>
                </div>
                {isOpen && (
                  <div
                    style={{
                      marginTop: '5px',
                      padding: '6px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '4px',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <div>
                      <b style={{ color: 'var(--text-primary)' }}>
                        {storm.classificationLabel || storm.category?.label}
                      </b>
                      {storm.designation ? ` ${storm.designation}` : ''} · {storm.source}
                      {storm.advisoryNum != null ? ` adv #${storm.advisoryNum}` : ''} · {relTime(storm.lastUpdate)}
                    </div>
                    <div>
                      {t('tropical.wind', { defaultValue: 'Wind' })}: {formatWind(storm.windKt, units)}
                      {storm.gustKt ? ` · ${t('tropical.gusts', { defaultValue: 'gusts' })} ${storm.gustKt} kt` : ''}
                      {storm.pressureMb != null ? ` · ${storm.pressureMb} mb` : ''}
                    </div>
                    {storm.forecast?.filter((f) => f.hour > 0).length > 0 && (
                      <table style={{ width: '100%', marginTop: '4px', fontSize: '9px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ color: 'var(--text-muted)' }}>
                            <th style={{ textAlign: 'left', fontWeight: 400 }}>+h</th>
                            <th style={{ textAlign: 'left', fontWeight: 400 }}>
                              {t('tropical.valid', { defaultValue: 'valid' })}
                            </th>
                            <th style={{ textAlign: 'left', fontWeight: 400 }}>
                              {t('tropical.position', { defaultValue: 'position' })}
                            </th>
                            <th style={{ textAlign: 'right', fontWeight: 400 }}>kt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storm.forecast
                            .filter((f) => f.hour > 0)
                            .map((f) => (
                              <tr key={f.hour}>
                                <td>+{f.hour}</td>
                                <td>{formatValidAt(f.validAt)}</td>
                                <td>{formatPosition(f.lat, f.lon)}</td>
                                <td
                                  style={{
                                    textAlign: 'right',
                                    color: categoryColor(
                                      f.windKt == null
                                        ? '?'
                                        : f.windKt < 34
                                          ? 'TD'
                                          : f.windKt < 64
                                            ? 'TS'
                                            : f.windKt < 83
                                              ? '1'
                                              : f.windKt < 96
                                                ? '2'
                                                : f.windKt < 113
                                                  ? '3'
                                                  : f.windKt < 137
                                                    ? '4'
                                                    : '5',
                                    ),
                                  }}
                                >
                                  {f.windKt ?? '—'}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                    <div style={{ marginTop: '4px', display: 'flex', gap: '10px' }}>
                      {storm.advisoryUrl && (
                        <a
                          href={storm.advisoryUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent-cyan)' }}
                        >
                          {t('tropical.advisory', { defaultValue: 'Advisory' })} →
                        </a>
                      )}
                      {storm.discussionUrl && (
                        <a
                          href={storm.discussionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent-cyan)' }}
                        >
                          {t('tropical.discussion', { defaultValue: 'Discussion' })} →
                        </a>
                      )}
                      {storm.graphicsUrl && (
                        <a
                          href={storm.graphicsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent-cyan)' }}
                        >
                          {t('tropical.graphics', { defaultValue: 'Graphics' })} →
                        </a>
                      )}
                    </div>
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
        <span>{fetchedAt ? `${t('tropical.updated', { defaultValue: 'updated' })} ${relTime(fetchedAt)}` : ''}</span>
        <span>
          <a
            href="https://www.nhc.noaa.gov/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            NHC
          </a>
          {' · '}
          <a
            href="https://www.metoc.navy.mil/jtwc/jtwc.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            JTWC
          </a>
        </span>
      </div>
    </div>
  );
};

export default TropicalPanel;
