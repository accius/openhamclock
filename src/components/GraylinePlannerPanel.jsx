/**
 * GraylinePlannerPanel — when are DE and DX both on the gray line?
 *
 * Seven-day timeline (one row per UTC day): DE twilight windows in blue, DX
 * in cyan, overlaps in green; a countdown to the next mutual window; and a
 * table of upcoming windows in UTC and DE local time. Margin (minutes either
 * side of sunrise/sunset) is configurable and remembered. Math in
 * utils/graylinePlanner.js; "now" follows the display time.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeGraylinePlan, nextMutualWindow, formatSpan, DAY_MS, utcDayStart } from '../utils/graylinePlanner.js';
import { displayNowMs, subscribeDisplayTime, setDisplayTime } from '../utils/displayTime.js';
import { DE_COLOR, DX_COLOR } from './ElevationChart.jsx';

const MARGIN_KEY = 'openhamclock_graylineMargin';
const MARGINS = [15, 30, 45, 60, 90];
const MUTUAL = '#22c55e';
const MAX_ROWS = 20;

const pad = (n) => String(n).padStart(2, '0');
const fmtUtc = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z`;
};
const fmtDay = (ms) => {
  const d = new Date(ms);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const fmtLocal = (ms, tz) => {
  try {
    const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
    if (tz && tz !== 'auto') opts.timeZone = tz;
    return new Intl.DateTimeFormat(undefined, opts).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
};

const readMargin = () => {
  try {
    const v = Number(localStorage.getItem(MARGIN_KEY));
    return MARGINS.includes(v) ? v : 30;
  } catch {
    return 30;
  }
};

const cell = { padding: '2px 4px', whiteSpace: 'nowrap' };

/** One 24 h row per UTC day. */
function Timeline({ plan, nowMs, onPick }) {
  const W = 600;
  const ROW = 14;
  const LABEL = 58;
  const dayStart = utcDayStart(plan.startMs);
  const rows = [];
  for (let d = dayStart; d < plan.endMs; d += DAY_MS) rows.push(d);
  const H = rows.length * ROW + 12;
  const x = (ms, day) => LABEL + (Math.max(0, Math.min(DAY_MS, ms - day)) / DAY_MS) * (W - LABEL - 4);
  const bar = (list, color, yOff, h, key) =>
    rows.flatMap((day, r) =>
      list
        .filter((w) => w.end > day && w.start < day + DAY_MS)
        .map((w, i) => (
          <rect
            key={`${key}-${r}-${i}`}
            x={x(w.start, day)}
            y={r * ROW + yOff}
            width={Math.max(1, x(w.end, day) - x(w.start, day))}
            height={h}
            fill={color}
            opacity={key === 'm' ? 0.85 : 0.45}
            style={key === 'm' ? { cursor: 'pointer' } : undefined}
            onClick={key === 'm' && onPick ? () => onPick(w) : undefined}
          >
            <title>
              {key === 'm' ? 'Mutual ' : key === 'de' ? 'DE ' : 'DX '}
              {fmtUtc(w.start)}–{fmtUtc(w.end)}
            </title>
          </rect>
        )),
    );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label="Gray-line timeline"
    >
      {rows.map((day, r) => (
        <g key={day}>
          <rect x={LABEL} y={r * ROW} width={W - LABEL - 4} height={ROW - 2} fill="var(--bg-tertiary)" />
          <text x={LABEL - 4} y={r * ROW + ROW - 4} textAnchor="end" fontSize="8" fill="var(--text-muted)">
            {fmtDay(day)}
          </text>
        </g>
      ))}
      {[6, 12, 18].map((h) => (
        <line
          key={h}
          x1={x(dayStart + h * 3_600_000, dayStart)}
          x2={x(dayStart + h * 3_600_000, dayStart)}
          y1={0}
          y2={rows.length * ROW - 2}
          stroke="var(--border-color)"
          strokeWidth="0.5"
        />
      ))}
      {bar(plan.de, DE_COLOR, 1, 5, 'de')}
      {bar(plan.dx, DX_COLOR, 6, 5, 'dx')}
      {bar(plan.mutual, MUTUAL, 1, 10, 'm')}
      {rows.map((day) =>
        nowMs >= day && nowMs < day + DAY_MS ? (
          <line
            key={`now-${day}`}
            x1={x(nowMs, day)}
            x2={x(nowMs, day)}
            y1={rows.indexOf(day) * ROW - 1}
            y2={rows.indexOf(day) * ROW + ROW - 1}
            stroke="#ff4d4d"
            strokeWidth="1.5"
          />
        ) : null,
      )}
      {[0, 6, 12, 18, 24].map((h) => (
        <text
          key={`t${h}`}
          x={x(dayStart + h * 3_600_000, dayStart)}
          y={H - 2}
          textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}
          fontSize="8"
          fill="var(--text-muted)"
        >
          {pad(h % 24)}z
        </text>
      ))}
    </svg>
  );
}

export function GraylinePlannerPanel({ deLocation, dxLocation, dxCallsign, timeZone }) {
  const { t } = useTranslation();
  const [marginMin, setMarginState] = useState(readMargin);
  const [, setTick] = useState(0); // minute re-render for the countdown
  const [shiftTick, setShiftTick] = useState(0); // display-time shift → re-plan

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    const unsub = subscribeDisplayTime(() => setShiftTick((n) => n + 1));
    return () => {
      clearInterval(id);
      unsub();
    };
  }, []);

  const setMargin = (v) => {
    setMarginState(v);
    try {
      localStorage.setItem(MARGIN_KEY, String(v));
    } catch {}
  };

  const deLat = deLocation?.lat;
  const deLon = deLocation?.lon;
  const dxLat = dxLocation?.lat;
  const dxLon = dxLocation?.lon;
  const hasDE = Number.isFinite(deLat) && Number.isFinite(deLon);
  const hasDX = Number.isFinite(dxLat) && Number.isFinite(dxLon);
  const nowMs = displayNowMs();
  // Re-plan once per UTC hour (or on margin / station / time-shift change), not every minute.
  const hourKey = Math.floor(nowMs / 3_600_000);

  const plan = useMemo(
    () => computeGraylinePlan(deLocation, dxLocation, displayNowMs(), { days: 7, marginMin }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deLat, deLon, dxLat, dxLon, marginMin, hourKey, shiftTick],
  );
  const next = nextMutualWindow(plan.mutual, nowMs);
  const upcoming = plan.mutual.filter((w) => w.end > nowMs).slice(0, MAX_ROWS);

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
        <span>{t('graylinePlanner.title')}</span>
        <label style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '10px' }}>
          ±
          <select
            value={marginMin}
            onChange={(e) => setMargin(Number(e.target.value))}
            aria-label={t('graylinePlanner.margin')}
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              fontSize: '10px',
              margin: '0 2px',
            }}
          >
            {MARGINS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {t('graylinePlanner.minutes')}
        </label>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {!hasDE ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px', textAlign: 'center' }}>{t('emePlanner.noDE')}</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px', color: 'var(--text-muted)' }}>
              <span style={{ color: DE_COLOR }}>▮ DE</span>
              <span style={{ color: DX_COLOR }}>▮ {dxCallsign ? `DX · ${dxCallsign}` : 'DX'}</span>
              <span style={{ color: MUTUAL }}>▮ {t('graylinePlanner.mutual')}</span>
            </div>
            <Timeline plan={plan} nowMs={nowMs} onPick={(w) => setDisplayTime(w.start)} />
            <div
              style={{
                margin: '6px 0',
                padding: '6px 8px',
                borderRadius: '4px',
                background: 'var(--bg-tertiary)',
                border: `1px solid ${next?.open ? MUTUAL : 'var(--border-color)'}`,
                color: next ? (next.open ? MUTUAL : 'var(--text-primary)') : 'var(--text-muted)',
                fontWeight: next ? 600 : 400,
              }}
              aria-live="polite"
            >
              {!hasDX
                ? t('graylinePlanner.noDX')
                : !next
                  ? t('graylinePlanner.none')
                  : next.open
                    ? t('graylinePlanner.openNow', { left: formatSpan(next.end - nowMs) })
                    : t('graylinePlanner.nextIn', { in: formatSpan(next.start - nowMs), at: fmtUtc(next.start) })}
            </div>
            {upcoming.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={cell}>{t('graylinePlanner.day')}</th>
                    <th style={cell}>UTC</th>
                    <th style={cell}>{t('graylinePlanner.deLocal')}</th>
                    <th style={cell}>{t('planner.duration')}</th>
                    <th style={cell}>DE / DX</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((w, i) => {
                    const active = w.start <= nowMs && w.end > nowMs;
                    const go = () => setDisplayTime(w.start);
                    return (
                      <tr
                        key={w.start}
                        onClick={go}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go()}
                        tabIndex={0}
                        role="button"
                        title={t('planner.setDisplayTime')}
                        aria-label={`${fmtDay(w.start)} ${fmtUtc(w.start)}–${fmtUtc(w.end)}: ${t('planner.setDisplayTime')}`}
                        style={{
                          cursor: 'pointer',
                          color: active ? MUTUAL : 'var(--text-primary)',
                          background: active
                            ? 'rgba(34,197,94,0.08)'
                            : i % 2
                              ? 'rgba(255,255,255,0.02)'
                              : 'transparent',
                        }}
                      >
                        <td style={cell}>{fmtDay(w.start)}</td>
                        <td style={cell}>
                          {fmtUtc(w.start)}–{fmtUtc(w.end)}
                        </td>
                        <td style={cell}>
                          {fmtLocal(w.start, timeZone)}–{fmtLocal(w.end, timeZone)}
                        </td>
                        <td style={cell}>{w.durationMin} min</td>
                        <td style={{ ...cell, color: 'var(--text-muted)' }}>
                          {w.deKind === 'sunrise' ? '☀↑' : '☀↓'} / {w.dxKind === 'sunrise' ? '☀↑' : '☀↓'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default GraylinePlannerPanel;
