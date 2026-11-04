/**
 * NOAAScalesPanel Component
 * The three NOAA space weather scales — R (radio blackout), S (solar
 * radiation storm), G (geomagnetic storm) — as swpc.noaa.gov shows them:
 * today's observed level per scale, then the 1/2/3-day forecast (G as a
 * predicted level, R and S as probabilities), colour-coded 0–5.
 * Data via the useNOAAScales hook (5-minute refresh).
 */
import { SCALE_BANDS, SCALE_TITLES, scaleColor, scaleWord, scaleImpact, forecastCell } from '../utils/noaaScales.js';

const fmtDay = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
};

const LevelChip = ({ band, level, label, size = 'md' }) => {
  const known = level != null;
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: size === 'lg' ? '44px' : '34px',
        padding: size === 'lg' ? '4px 6px' : '2px 5px',
        borderRadius: '4px',
        background: known ? scaleColor(level) : 'var(--bg-tertiary)',
        color: known && level >= 2 ? '#000' : known ? '#111' : 'var(--text-muted)',
        fontWeight: 700,
        fontSize: size === 'lg' ? '15px' : '10px',
        textAlign: 'center',
        fontFamily: 'var(--font-mono)',
      }}
      title={known ? `${band}${level} — ${scaleWord(level)}` : 'no data'}
    >
      {label ?? (known ? `${band}${level}` : '—')}
    </span>
  );
};

export const NOAAScalesPanel = ({ data, loading, error }) => {
  const now = data?.now;
  const days = data?.days || [];

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
        <span>📶 NOAA SCALES</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '9px' }}>
          {now?.date ? `${now.date} ${now.time?.slice(0, 5) || ''}z` : ''}
          {data?.stale && <span style={{ color: '#fbbf24' }}> · stale</span>}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !now ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {error ? 'NOAA scales unavailable' : 'No scale data'}
          </div>
        ) : (
          <>
            {/* Current levels */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '8px' }}>
              {SCALE_BANDS.map((band) => {
                const level = now[band]?.level;
                return (
                  <div
                    key={band}
                    style={{
                      background: 'var(--bg-tertiary)',
                      borderRadius: '6px',
                      padding: '6px',
                      textAlign: 'center',
                      border: `1px solid ${level >= 1 ? scaleColor(level) : 'transparent'}`,
                    }}
                  >
                    <LevelChip band={band} level={level} size="lg" />
                    <div style={{ fontSize: '9px', color: 'var(--text-primary)', marginTop: '4px', fontWeight: 600 }}>
                      {SCALE_TITLES[band]}
                    </div>
                    <div style={{ fontSize: '8px', color: 'var(--text-muted)', lineHeight: 1.3, marginTop: '2px' }}>
                      {level != null ? scaleImpact(band, level) : 'no data'}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Forecast table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: '9px' }}>
                  <th style={{ textAlign: 'left', fontWeight: 400, padding: '2px 0' }}>Forecast</th>
                  {days.map((d) => (
                    <th key={d.date} style={{ fontWeight: 400, padding: '2px 0' }} title={d.date}>
                      {fmtDay(d.date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SCALE_BANDS.map((band) => (
                  <tr key={band} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '4px 0', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {band}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '8px' }}>
                        {band === 'G' ? ' level' : band === 'R' ? ' minor/major' : ' S1+'}
                      </span>
                    </td>
                    {days.map((d) => {
                      const cell = forecastCell(band, d);
                      return (
                        <td key={d.date} style={{ textAlign: 'center', padding: '4px 0' }}>
                          <LevelChip band={band} level={cell.level} label={cell.label} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ color: 'var(--text-muted)', fontSize: '8px', marginTop: '6px', lineHeight: 1.3 }}>
              R/S forecasts are the probability of reaching R1/R3 and S1; G is the predicted level. 0 none · 1 minor · 2
              moderate · 3 strong · 4 severe · 5 extreme.
            </div>
          </>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border-color)', textAlign: 'right' }}>
        <a
          href="https://www.swpc.noaa.gov/noaa-scales-explanation"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '9px', color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          NOAA SWPC scales
        </a>
      </div>
    </div>
  );
};

export default NOAAScalesPanel;
