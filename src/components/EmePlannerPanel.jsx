/**
 * EmePlannerPanel — moon elevation at DE and DX for the next 48 h with the
 * mutual-visibility windows shaded, a table of the next windows (start,
 * end, duration, best path-loss delta) and a click-a-point readout (az/el
 * at both ends, distance, echo delay). Dockable panel `eme-planner`, and
 * embedded in the EME layout's rail. All math in utils/eme.js; "now" is the
 * display time so the Time Shift scrubber re-plans it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  computeElevationSeries,
  computeMutualWindows,
  emePointReadout,
  withWindowDegradation,
  formatDurationShort,
} from '../utils/eme.js';
import { displayNow, displayNowMs, subscribeDisplayTime, setDisplayTime } from '../utils/displayTime.js';
import { ElevationChart, DE_COLOR, DX_COLOR } from './ElevationChart.jsx';

const HOURS = 48;
const MIN_ELEV_KEY = 'openhamclock_emePlannerMinElev';

const pad = (n) => String(n).padStart(2, '0');
const fmtUtc = (d) =>
  `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z`;
const fmtHm = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z`;
const deg = (v) => (Number.isFinite(v) ? `${Math.round(v)}°` : '—');

const readMinElev = () => {
  try {
    const v = Number(localStorage.getItem(MIN_ELEV_KEY));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
};

const cell = { padding: '2px 4px', whiteSpace: 'nowrap' };

export function EmePlannerPanel({ deLocation, dxLocation, dxCallsign, embedded = false }) {
  const { t } = useTranslation();
  const [minElev, setMinElevState] = useState(readMinElev);
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

  const setMinElev = (v) => {
    setMinElevState(v);
    try {
      localStorage.setItem(MIN_ELEV_KEY, String(v));
    } catch {}
  };

  const deLat = deLocation?.lat;
  const deLon = deLocation?.lon;
  const dxLat = dxLocation?.lat;
  const dxLon = dxLocation?.lon;
  const hasDE = Number.isFinite(deLat) && Number.isFinite(deLon);
  const hasDX = Number.isFinite(dxLat) && Number.isFinite(dxLon);

  // Heavy scans every 5 min / on DX or threshold change — not every render.
  const { start, series, windows } = useMemo(() => {
    const s = displayNow();
    const series = computeElevationSeries(s, deLocation, dxLocation, { hours: HOURS, stepMin: 10 });
    const windows = withWindowDegradation(computeMutualWindows(s, deLocation, dxLocation, { hours: HOURS, minElev }));
    return { start: s, series, windows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deLat, deLon, dxLat, dxLon, minElev, tick]);

  const nowMs = displayNowMs();
  const readout = useMemo(
    () => (picked ? emePointReadout(picked, deLocation, dxLocation) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, deLat, deLon, dxLat, dxLon],
  );
  const nextWindow = windows.find((w) => w.end.getTime() > nowMs) || null;

  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', marginBottom: '4px' }}>
        <span style={{ color: DE_COLOR }}>━━ DE</span>
        <span style={{ color: DX_COLOR }}>┄┄ {dxCallsign ? `DX · ${dxCallsign}` : 'DX'}</span>
        <span style={{ color: '#22c55e' }}>▮ {t('emePlanner.mutual')}</span>
        <span style={{ flex: 1 }} />
        <label style={{ color: 'var(--text-muted)' }}>
          {t('emePlanner.minElev')}{' '}
          <select
            value={minElev}
            onChange={(e) => setMinElev(Number(e.target.value))}
            aria-label={t('emePlanner.minElev')}
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              fontSize: '10px',
            }}
          >
            {[0, 5, 10, 15, 20, 30].map((v) => (
              <option key={v} value={v}>
                ≥ {v}°
              </option>
            ))}
          </select>
        </label>
      </div>

      {!hasDE ? (
        <div style={{ color: 'var(--text-muted)', padding: '8px', textAlign: 'center' }}>{t('emePlanner.noDE')}</div>
      ) : (
        <ElevationChart
          series={series}
          windows={windows}
          minElev={minElev}
          nowMs={nowMs}
          pickedMs={picked ? picked.getTime() : null}
          onPick={setPicked}
          height={embedded ? 110 : 130}
          ariaLabel={t('emePlanner.chartAria')}
        />
      )}

      {readout && (
        <div
          style={{
            margin: '6px 0',
            padding: '6px 8px',
            background: 'var(--bg-tertiary)',
            borderRadius: '4px',
            border: `1px solid ${readout.mutual ? '#22c55e' : 'var(--border-color)'}`,
            fontSize: '10px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '2px 10px',
          }}
          aria-live="polite"
        >
          <div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)', display: 'flex', gap: '8px' }}>
            <b>{fmtUtc(readout.t)}</b>
            <button
              type="button"
              onClick={() => setDisplayTime(readout.t)}
              aria-label={t('planner.setDisplayTime')}
              title={t('planner.setDisplayTime')}
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
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setPicked(null)}
              aria-label={t('planner.clearPick')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              ×
            </button>
          </div>
          <div>
            <span style={{ color: DE_COLOR }}>DE</span> az {deg(readout.de?.azimuth)} · el{' '}
            <b style={{ color: readout.de?.elevation >= 0 ? '#4ade80' : 'var(--text-muted)' }}>
              {deg(readout.de?.elevation)}
            </b>
          </div>
          <div>
            <span style={{ color: DX_COLOR }}>DX</span> az {deg(readout.dx?.azimuth)} · el{' '}
            <b style={{ color: readout.dx?.elevation >= 0 ? '#4ade80' : 'var(--text-muted)' }}>
              {deg(readout.dx?.elevation)}
            </b>
          </div>
          <div>
            {t('emePlanner.distance')} {Math.round(readout.distanceKm).toLocaleString()} km
          </div>
          <div>
            {t('emePlanner.delay')} {readout.delayS.toFixed(3)} s ·{' '}
            <span style={{ color: readout.pathDeltaDb <= 0 ? '#4ade80' : '#fbbf24' }}>
              {readout.pathDeltaDb >= 0 ? '+' : ''}
              {readout.pathDeltaDb.toFixed(1)} dB
            </span>
          </div>
        </div>
      )}

      {hasDE && !hasDX ? (
        <div style={{ color: 'var(--text-muted)', padding: '6px', textAlign: 'center' }}>{t('emePlanner.noDX')}</div>
      ) : hasDE && windows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '6px', textAlign: 'center' }}>
          {t('emePlanner.none', { minElev })}
        </div>
      ) : hasDE ? (
        <>
          {nextWindow && (
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: '4px 0' }}>
              {nextWindow.start.getTime() <= nowMs
                ? t('emePlanner.openNow', { left: formatDurationShort(nextWindow.end.getTime() - nowMs) })
                : t('emePlanner.nextIn', { in: formatDurationShort(nextWindow.start.getTime() - nowMs) })}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={cell}>{t('planner.start')}</th>
                <th style={cell}>{t('planner.end')}</th>
                <th style={cell}>{t('planner.duration')}</th>
                <th style={cell}>{t('emePlanner.peak')}</th>
                <th style={cell}>{t('emePlanner.minDeg')}</th>
              </tr>
            </thead>
            <tbody>
              {windows.map((w, i) => {
                const active = w.start.getTime() <= nowMs && w.end.getTime() > nowMs;
                return (
                  <tr
                    key={i}
                    onClick={() => setPicked(w.peakAt)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPicked(w.peakAt)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${fmtUtc(w.start)} – ${fmtHm(w.end)}, ${formatDurationShort(w.end - w.start)}`}
                    style={{
                      cursor: 'pointer',
                      color: active ? '#22c55e' : 'var(--text-primary)',
                      borderLeft: `2px solid ${active ? '#22c55e' : 'transparent'}`,
                      background: active ? 'rgba(34,197,94,0.08)' : i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent',
                    }}
                  >
                    <td style={cell}>
                      {fmtUtc(w.start)}
                      {w.open ? '*' : ''}
                    </td>
                    <td style={cell}>
                      {fmtHm(w.end)}
                      {w.truncated ? '+' : ''}
                    </td>
                    <td style={cell}>{formatDurationShort(w.end - w.start)}</td>
                    <td style={cell}>{Math.round(w.peakMinEl)}°</td>
                    <td style={{ ...cell, color: w.minDegradationDb <= 0 ? '#4ade80' : '#fbbf24' }}>
                      {w.minDegradationDb == null
                        ? '—'
                        : `${w.minDegradationDb >= 0 ? '+' : ''}${w.minDegradationDb.toFixed(1)} dB`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
    </>
  );

  if (embedded) {
    return <div style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{body}</div>;
  }

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
          fontWeight: 700,
        }}
      >
        <span>{t('emePlanner.title')}</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '9px' }}>
          {t('planner.from', { when: fmtUtc(start) })}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{body}</div>
    </div>
  );
}

export default EmePlannerPanel;
