/**
 * RoverPanel — grid-square roving with a GPS on the Rig Bridge.
 *
 * Shows the live 6-character grid, speed and heading, the distance (and ETA
 * at the current speed) to each edge of the grid, which edge the current
 * course crosses first and the grid on the other side, VUCC status of the
 * 4-character grid from the logbook, and the QSOs already logged from here.
 * Grid changes ring the `grid-change` audio alert (Settings → Alerts).
 *
 * Needs: Rig Bridge GPS plugin enabled + Settings → Station → Follow GPS.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGps } from '../hooks/useGps.js';
import { useAwards } from '../hooks/useAwards.js';
import { getAll as getLogbookQsos, subscribe as subscribeLogbook } from '../services/logbookStore.js';
import { distanceToGridEdges, nextGridCrossing, adjacentGrid, etaMinutes, formatSpeed } from '../utils/gridBoundary.js';
import { formatDistance } from '../utils/geo.js';

const fmtEta = (min) => {
  if (!Number.isFinite(min)) return '—';
  if (min < 1) return '<1 min';
  if (min < 90) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
};

const fmtAge = (ms) => {
  if (!Number.isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
};

const cardinal = (deg) => {
  if (!Number.isFinite(deg)) return '—';
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(deg / 45) % 8];
};

export const RoverPanel = ({ config }) => {
  const { t } = useTranslation();
  const { gps, fix, stale, timeOffsetMs, clockWarning } = useGps();
  const { awards } = useAwards();
  const units = config?.allUnits?.dist || config?.units || 'metric';
  const following = config?.gpsFollow === 'follow';
  const [now, setNow] = useState(Date.now());
  const [qsoCountHere, setQsoCountHere] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const grid6 = fix?.grid6 || null;
  const grid4 = grid6 ? grid6.slice(0, 4).toUpperCase() : null;

  // QSOs already logged with MY_GRIDSQUARE in this 4-char grid
  useEffect(() => {
    const recount = () => {
      if (!grid4) return setQsoCountHere(0);
      const n = getLogbookQsos().filter((q) =>
        String(q?.my_gridsquare || '')
          .toUpperCase()
          .startsWith(grid4),
      ).length;
      setQsoCountHere(n);
    };
    recount();
    return subscribeLogbook(recount);
  }, [grid4]);

  const edges = useMemo(() => (fix ? distanceToGridEdges(fix.lat, fix.lon, 6) : null), [fix?.lat, fix?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const crossing = useMemo(
    () => (fix ? nextGridCrossing(fix.lat, fix.lon, fix.course, fix.speed, 6) : null),
    [fix?.lat, fix?.lon, fix?.course, fix?.speed], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const vucc = grid4 ? awards?.vucc?.worked?.get(grid4) : null;
  const vuccBands = vucc ? Array.from(vucc.bands || []).join(' ') : '';

  const edgeRows = edges
    ? [
        ['N', edges.north],
        ['E', edges.east],
        ['S', edges.south],
        ['W', edges.west],
      ]
    : [];

  const statusLabel = !gps
    ? t('roverPanel.status.noGps')
    : stale
      ? t('roverPanel.status.stale')
      : fix
        ? t('roverPanel.status.fix', { sats: fix.sats ?? '?' })
        : t('roverPanel.status.noFix');
  const statusColor = fix && !stale ? 'var(--accent-green)' : 'var(--accent-amber)';

  return (
    <div
      className="panel"
      style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }}
    >
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
        <span>🚙 {t('roverPanel.title')}</span>
        <span style={{ color: statusColor, fontFamily: 'var(--font-mono)', fontSize: '10px' }} aria-live="polite">
          {statusLabel}
          {gps?.receivedAt ? ` · ${fmtAge(now - gps.receivedAt)}` : ''}
        </span>
      </div>

      {!gps && (
        <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.5 }}>
          <div>{t('roverPanel.setup.noGps')}</div>
          <div style={{ marginTop: '6px' }}>{t('roverPanel.setup.hint')}</div>
        </div>
      )}

      {gps && (
        <>
          {/* Grid */}
          <div style={{ textAlign: 'center', margin: '4px 0 8px' }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '34px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: fix ? 'var(--accent-amber)' : 'var(--text-muted)',
                lineHeight: 1.1,
              }}
              aria-label={t('roverPanel.currentGrid')}
            >
              {grid6 || '——————'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {fix ? `${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)}` : t('roverPanel.waitingFix')}
              {fix && Number.isFinite(fix.alt)
                ? ` · ${units === 'imperial' ? `${Math.round(fix.alt * 3.28084)} ft` : `${Math.round(fix.alt)} m`}`
                : ''}
            </div>
          </div>

          {/* Speed / heading */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px',
              marginBottom: '8px',
              fontSize: '12px',
            }}
          >
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {t('roverPanel.speed')}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', color: 'var(--text-primary)' }}>
                {formatSpeed(fix?.speed, units)}
              </div>
            </div>
            <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {t('roverPanel.heading')}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', color: 'var(--text-primary)' }}>
                {Number.isFinite(fix?.course) ? `${Math.round(fix.course)}° ${cardinal(fix.course)}` : '—'}
              </div>
            </div>
          </div>

          {/* Grid edges */}
          {edges && (
            <div style={{ marginBottom: '8px' }}>
              <div
                style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}
              >
                {t('roverPanel.edges')}
              </div>
              <table
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
              >
                <tbody>
                  {edgeRows.map(([dir, km]) => {
                    const eta = etaMinutes(km, fix.speed);
                    const next = adjacentGrid(fix.lat, fix.lon, dir, 6);
                    const isNext = crossing?.edge === dir;
                    return (
                      <tr key={dir} style={{ color: isNext ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>
                        <td style={{ padding: '2px 4px', fontWeight: 700 }}>{dir}</td>
                        <td style={{ padding: '2px 4px', textAlign: 'right' }}>{formatDistance(km, units)}</td>
                        <td style={{ padding: '2px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {fmtEta(eta)}
                        </td>
                        <td style={{ padding: '2px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {next || ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {crossing && (
                <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '4px' }}>
                  {t('roverPanel.nextGrid', {
                    grid: crossing.nextGrid || '?',
                    dist: formatDistance(crossing.distanceKm, units),
                    eta: fmtEta(crossing.etaMin),
                  })}
                </div>
              )}
            </div>
          )}

          {/* VUCC + log */}
          {grid4 && (
            <div
              style={{
                fontSize: '11px',
                borderTop: '1px solid var(--border-color)',
                paddingTop: '6px',
                lineHeight: 1.6,
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)' }}>VUCC {grid4}: </span>
                {vucc ? (
                  <span style={{ color: 'var(--accent-green)' }}>
                    {t('roverPanel.vuccWorked', { count: vucc.count })}
                    {vuccBands ? ` · ${vuccBands}` : ''}
                  </span>
                ) : (
                  <span style={{ color: 'var(--accent-amber)' }}>{t('roverPanel.vuccNew')}</span>
                )}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>{t('roverPanel.qsosFromHere')}: </span>
                <span style={{ color: 'var(--text-primary)' }}>{qsoCountHere}</span>
                {awards?.vucc?.worked?.size ? (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}
                    · {t('roverPanel.vuccTotal', { count: awards.vucc.worked.size })}
                  </span>
                ) : null}
              </div>
            </div>
          )}

          {/* Warnings */}
          {clockWarning && (
            <div style={{ fontSize: '11px', color: 'var(--accent-amber)', marginTop: '6px' }} role="status">
              ⚠ {t('roverPanel.clockWarning', { secs: (timeOffsetMs / 1000).toFixed(1) })}
            </div>
          )}
          {!following && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px' }}>
              {t('roverPanel.notFollowing')}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RoverPanel;
