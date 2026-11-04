/**
 * SolarOutlookPanel — SWPC's 27-day Space Weather Outlook: predicted 10.7 cm
 * flux, planetary A index and largest Kp per UTC day, as sparklines plus a
 * compact table. Weekends are tinted so contest planning is a glance.
 */
import { useTranslation } from 'react-i18next';
import { useSolarOutlook } from '../hooks/useSolarOutlook.js';
import { KP_CATEGORIES, kpCategory } from '../utils/solarOutlook.js';

const W = 260;
const H = 36;

const Spark = ({ values, color, max, min, bars = false, markers = [] }) => {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return <div style={{ height: H, color: 'var(--text-muted)', fontSize: '9px' }}>no data</div>;
  const lo = min ?? Math.min(...vals);
  const hi = Math.max(max ?? Math.max(...vals), lo + 1);
  const n = values.length;
  const x = (i) => (i / Math.max(1, n - 1)) * (W - 4) + 2;
  const y = (v) => H - ((v - lo) / (hi - lo)) * (H - 6) - 3;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {markers.map((i) => (
        <rect key={i} x={x(i) - (W / n) * 0.5} y={0} width={W / n} height={H} fill="rgba(255,255,255,0.05)" />
      ))}
      {bars
        ? values.map((v, i) =>
            Number.isFinite(v) ? (
              <rect
                key={i}
                x={x(i) - (W / n) * 0.35}
                y={y(v)}
                width={(W / n) * 0.7}
                height={H - 3 - y(v)}
                fill={KP_CATEGORIES[kpCategory(v)]?.color || color}
                opacity={0.9}
              />
            ) : null,
          )
        : null}
      {!bars && (
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          points={values.map((v, i) => (Number.isFinite(v) ? `${x(i)},${y(v)}` : '')).join(' ')}
        />
      )}
    </svg>
  );
};

const isWeekend = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

const dayLabel = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

export const SolarOutlookPanel = () => {
  const { t } = useTranslation();
  const { days, issued, loading, error, data } = useSolarOutlook();
  const today = new Date().toISOString().slice(0, 10);
  const weekendIdx = days.map((d, i) => (isWeekend(d.date) ? i : -1)).filter((i) => i >= 0);

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
        <span>{t('solarOutlook.title')}</span>
        {issued && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '9px' }}>
            {t('solarOutlook.issued', { date: issued.slice(0, 10) })}
            {data?.stale ? ' · stale' : ''}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !days.length ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {error ? t('solarOutlook.error') : t('solarOutlook.empty')}
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>{t('solarOutlook.sfi')}</span>
                <span>
                  {Math.min(...days.map((d) => d.sfi))}–{Math.max(...days.map((d) => d.sfi))}
                </span>
              </div>
              <Spark values={days.map((d) => d.sfi)} color="var(--accent-amber)" markers={weekendIdx} />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>{t('solarOutlook.kp')}</span>
                <span>
                  {Object.entries(KP_CATEGORIES).map(([k, c]) => (
                    <span key={k} style={{ color: c.color, marginLeft: '6px' }}>
                      ■ {c.label}
                    </span>
                  ))}
                </span>
              </div>
              <Spark
                values={days.map((d) => d.kp)}
                color="var(--accent-cyan)"
                min={0}
                max={9}
                bars
                markers={weekendIdx}
              />
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', fontWeight: 400, padding: '2px 4px' }}>{t('solarOutlook.date')}</th>
                  <th style={{ fontWeight: 400, padding: '2px 4px' }}>SFI</th>
                  <th style={{ fontWeight: 400, padding: '2px 4px' }}>A</th>
                  <th style={{ fontWeight: 400, padding: '2px 4px' }}>Kp</th>
                  <th style={{ fontWeight: 400, padding: '2px 4px' }} />
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const cat = kpCategory(d.kp);
                  const c = KP_CATEGORIES[cat];
                  const isToday = d.date === today;
                  return (
                    <tr
                      key={d.date}
                      style={{
                        background: isToday
                          ? 'rgba(68, 136, 255, 0.18)'
                          : isWeekend(d.date)
                            ? 'rgba(255,255,255,0.05)'
                            : 'transparent',
                        color: isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
                        textAlign: 'right',
                      }}
                    >
                      <td style={{ textAlign: 'left', padding: '2px 4px', whiteSpace: 'nowrap' }}>
                        {dayLabel(d.date)}
                      </td>
                      <td style={{ padding: '2px 4px' }}>{d.sfi}</td>
                      <td style={{ padding: '2px 4px' }}>{d.ap}</td>
                      <td style={{ padding: '2px 4px', color: c?.color, fontWeight: 600 }}>{d.kp}</td>
                      <td style={{ padding: '2px 4px' }}>
                        <span
                          style={{
                            color: c?.color,
                            border: `1px solid ${c?.color}`,
                            borderRadius: '3px',
                            padding: '0 4px',
                            fontSize: '8px',
                            fontWeight: 700,
                          }}
                        >
                          {c?.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border-color)', textAlign: 'right', fontSize: '9px' }}>
        <a
          href="https://www.swpc.noaa.gov/products/27-day-outlook-107-cm-radio-flux-and-geomagnetic-indices"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          NOAA SWPC 27-day outlook
        </a>
      </div>
    </div>
  );
};

export default SolarOutlookPanel;
