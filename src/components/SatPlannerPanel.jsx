/**
 * SatPlannerPanel — for one tracked satellite, elevation at DE and at the
 * DX target over the next 24 h, with the windows where the bird is above
 * the minimum elevation at BOTH ends (utils/satRelay.js computeMutualPasses)
 * listed underneath. Clicking a window sets the display time to its start
 * so the map, globe and footprints jump there. Dockable panel `sat-planner`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeElevationSeries, computeMutualPasses } from '../utils/satRelay.js';
import { displayNow, displayNowMs, subscribeDisplayTime, setDisplayTime } from '../utils/displayTime.js';
import { formatDurationShort } from '../utils/eme.js';
import { ElevationChart, DE_COLOR, DX_COLOR } from './ElevationChart.jsx';

const HOURS = 24;
const SAT_KEY = 'openhamclock_satPlannerSat';

const pad = (n) => String(n).padStart(2, '0');
const fmtUtc = (d) =>
  `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z`;
const fmtHm = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z`;
const cell = { padding: '2px 4px', whiteSpace: 'nowrap' };

const readSat = () => {
  try {
    return localStorage.getItem(SAT_KEY) || '';
  } catch {
    return '';
  }
};

export function SatPlannerPanel({ satellites, config, dxLocation, dxCallsign }) {
  const { t } = useTranslation();
  const [satName, setSatNameState] = useState(readSat);
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5 * 60_000);
    const unsub = subscribeDisplayTime(() => {
      setPicked(null);
      setTick((n) => n + 1);
    });
    return () => {
      clearInterval(id);
      unsub();
    };
  }, []);

  const tracked = useMemo(() => (satellites?.data || []).filter((s) => s?.omm), [satellites?.data]);
  const trackedKey = tracked
    .map((s) => s.name)
    .sort()
    .join(',');
  const sat = tracked.find((s) => s.name === satName) || tracked[0] || null;
  const setSatName = (name) => {
    setSatNameState(name);
    try {
      localStorage.setItem(SAT_KEY, name);
    } catch {}
  };

  const de = config?.location;
  const deLat = de?.lat;
  const deLon = de?.lon;
  const dxLat = dxLocation?.lat;
  const dxLon = dxLocation?.lon;
  const hasDE = Number.isFinite(deLat) && Number.isFinite(deLon);
  const hasDX = Number.isFinite(dxLat) && Number.isFinite(dxLon);
  const minElev = Number.isFinite(config?.satellite?.minElev) ? config.satellite.minElev : 5;
  const omm = sat?.omm;
  const ommKey = omm ? `${omm.NORAD_CAT_ID ?? ''}|${omm.EPOCH ?? ''}` : '';

  const { start, series, passes } = useMemo(() => {
    const s = displayNow();
    if (!omm || !hasDE) return { start: s, series: [], passes: [] };
    const series = computeElevationSeries(omm, s, de, hasDX ? dxLocation : null, { hours: HOURS, stepSec: 60 });
    const passes = hasDX ? computeMutualPasses(omm, s, de, dxLocation, { hours: HOURS, minElev, maxPasses: 20 }) : [];
    return { start: s, series, passes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ommKey, deLat, deLon, dxLat, dxLon, minElev, tick, trackedKey]);

  const nowMs = displayNowMs();
  const pickedSample = picked ? series.find((p) => p.t.getTime() === picked.getTime()) || null : null;
  const next = passes.find((p) => p.end.getTime() > nowMs) || null;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '6px',
          color: 'var(--accent-primary)',
          fontWeight: 700,
        }}
      >
        <span>{t('satPlanner.title')}</span>
        <select
          value={sat?.name || ''}
          onChange={(e) => setSatName(e.target.value)}
          aria-label={t('satPlanner.pick')}
          disabled={!tracked.length}
          style={{
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '3px',
            fontSize: '10px',
            maxWidth: '55%',
          }}
        >
          {tracked.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {!tracked.length ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px', textAlign: 'center' }}>
            {t('satPlanner.noSats')}
          </div>
        ) : !hasDE ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px', textAlign: 'center' }}>{t('emePlanner.noDE')}</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px', color: 'var(--text-muted)' }}>
              <span style={{ color: DE_COLOR }}>━━ DE</span>
              <span style={{ color: DX_COLOR }}>┄┄ {dxCallsign ? `DX · ${dxCallsign}` : 'DX'}</span>
              <span style={{ color: '#22c55e' }}>▮ {t('satPlanner.mutual', { minElev })}</span>
              <span style={{ flex: 1 }} />
              <span>{t('planner.from', { when: fmtUtc(start) })}</span>
            </div>
            <ElevationChart
              series={series}
              windows={passes}
              minElev={minElev}
              nowMs={nowMs}
              pickedMs={picked ? picked.getTime() : null}
              onPick={setPicked}
              height={130}
              minY={0}
              ariaLabel={t('satPlanner.chartAria', { sat: sat?.name || '' })}
            />
            {pickedSample && (
              <div
                style={{
                  margin: '6px 0',
                  padding: '6px 8px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px 12px',
                }}
                aria-live="polite"
              >
                <b>{fmtUtc(pickedSample.t)}</b>
                <span>
                  <span style={{ color: DE_COLOR }}>DE</span> el{' '}
                  <b style={{ color: pickedSample.de >= minElev ? '#4ade80' : 'var(--text-muted)' }}>
                    {pickedSample.de == null ? '—' : `${Math.round(pickedSample.de)}°`}
                  </b>
                </span>
                <span>
                  <span style={{ color: DX_COLOR }}>DX</span> el{' '}
                  <b style={{ color: pickedSample.dx >= minElev ? '#4ade80' : 'var(--text-muted)' }}>
                    {pickedSample.dx == null ? '—' : `${Math.round(pickedSample.dx)}°`}
                  </b>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {pickedSample.lat.toFixed(1)}°, {pickedSample.lon.toFixed(1)}° · {Math.round(pickedSample.altKm)} km
                </span>
                <button
                  type="button"
                  onClick={() => setDisplayTime(pickedSample.t)}
                  aria-label={t('planner.setDisplayTime')}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    borderRadius: '3px',
                    color: 'var(--accent-cyan)',
                    fontSize: '9px',
                    cursor: 'pointer',
                    padding: '0 4px',
                  }}
                >
                  ⏱ {t('planner.setDisplayTime')}
                </button>
              </div>
            )}
            {!hasDX ? (
              <div style={{ color: 'var(--text-muted)', padding: '6px', textAlign: 'center' }}>
                {t('satPlanner.noDX')}
              </div>
            ) : passes.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '6px', textAlign: 'center' }}>
                {t('satPlanner.none', { minElev })}
              </div>
            ) : (
              <>
                {next && (
                  <div style={{ color: 'var(--text-secondary)', margin: '4px 0' }}>
                    {next.start.getTime() <= nowMs
                      ? t('emePlanner.openNow', { left: formatDurationShort(next.end.getTime() - nowMs) })
                      : t('emePlanner.nextIn', { in: formatDurationShort(next.start.getTime() - nowMs) })}
                    {' · '}
                    {t('satPlanner.clickHint')}
                  </div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={cell}>{t('planner.start')}</th>
                      <th style={cell}>{t('planner.end')}</th>
                      <th style={cell}>{t('planner.duration')}</th>
                      <th style={cell}>{t('emePlanner.peak')}</th>
                      <th style={cell}>DE AOS–LOS</th>
                      <th style={cell}>DX AOS–LOS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passes.map((p, i) => {
                      const active = p.start.getTime() <= nowMs && p.end.getTime() > nowMs;
                      const go = () => setDisplayTime(p.start);
                      return (
                        <tr
                          key={i}
                          onClick={go}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go()}
                          tabIndex={0}
                          role="button"
                          aria-label={`${fmtUtc(p.start)} – ${fmtHm(p.end)}: ${t('planner.setDisplayTime')}`}
                          title={t('planner.setDisplayTime')}
                          style={{
                            cursor: 'pointer',
                            color: active ? '#22c55e' : 'var(--text-primary)',
                            background: active
                              ? 'rgba(34,197,94,0.08)'
                              : i % 2
                                ? 'rgba(255,255,255,0.02)'
                                : 'transparent',
                          }}
                        >
                          <td style={cell}>
                            {fmtUtc(p.start)}
                            {p.open ? '*' : ''}
                          </td>
                          <td style={cell}>
                            {fmtHm(p.end)}
                            {p.truncated ? '+' : ''}
                          </td>
                          <td style={cell}>{formatDurationShort(p.end - p.start)}</td>
                          <td style={cell}>{Math.round(p.peakCommonEl)}°</td>
                          <td style={{ ...cell, color: DE_COLOR }}>
                            {fmtHm(p.de.aos)}–{fmtHm(p.de.los)}
                          </td>
                          <td style={{ ...cell, color: DX_COLOR }}>
                            {fmtHm(p.dx.aos)}–{fmtHm(p.dx.los)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SatPlannerPanel;
