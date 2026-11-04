/**
 * EnvSensorsPanel — temperature / humidity / dew point / pressure from the
 * Rig Bridge `env-sensors` plugin (BME280 / BMP280 on I2C, or any HTTP JSON
 * sensor), with the two-sensor side-by-side split HamClock uses and a 24 h
 * history graph (temperature, humidity or pressure; one line per sensor).
 *
 * Units follow Settings → Station (temperature °C/°F, pressure hPa/inHg).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnvSensors } from '../hooks/useEnvSensors.js';

const SERIES_COLORS = ['var(--accent-cyan)', 'var(--accent-amber)', 'var(--accent-green)'];
const METRICS = ['temp', 'hum', 'pres'];

const cToF = (c) => (c * 9) / 5 + 32;
const hpaToInHg = (p) => p / 33.8639;

const fmtTemp = (c, imperial, digits = 1) =>
  Number.isFinite(c) ? `${(imperial ? cToF(c) : c).toFixed(digits)}°${imperial ? 'F' : 'C'}` : '—';
const fmtPres = (hpa, imperial) =>
  Number.isFinite(hpa) ? (imperial ? `${hpaToInHg(hpa).toFixed(2)} inHg` : `${hpa.toFixed(1)} hPa`) : '—';
const fmtHum = (h) => (Number.isFinite(h) ? `${Math.round(h)}%` : '—');

const convert = (metric, v, { tempImperial, presImperial }) => {
  if (!Number.isFinite(v)) return null;
  if (metric === 'temp') return tempImperial ? cToF(v) : v;
  if (metric === 'pres') return presImperial ? hpaToInHg(v) : v;
  return v;
};

/** Minimal multi-series line chart over the last 24 h. */
const HistoryChart = ({ history, metric, unitOpts, height = 90 }) => {
  const width = 300;
  const padL = 34;
  const padR = 6;
  const padT = 6;
  const padB = 14;
  const now = Date.now();
  const start = now - 24 * 3600 * 1000;

  const series = useMemo(() => {
    const out = [];
    let min = Infinity;
    let max = -Infinity;
    Object.entries(history).forEach(([id, src], i) => {
      const pts = (src.samples || [])
        .map((s) => ({ t: s.t, v: convert(metric, s[metric], unitOpts) }))
        .filter((p) => p.v != null && p.t >= start);
      pts.forEach((p) => {
        if (p.v < min) min = p.v;
        if (p.v > max) max = p.v;
      });
      out.push({ id, name: src.name, pts, color: SERIES_COLORS[i % SERIES_COLORS.length] });
    });
    if (!Number.isFinite(min)) return { out, min: 0, max: 1 };
    if (max - min < 0.5) {
      min -= 0.5;
      max += 0.5;
    }
    const pad = (max - min) * 0.08;
    return { out, min: min - pad, max: max + pad };
  }, [history, metric, unitOpts, start]);

  const x = (t) => padL + ((t - start) / (now - start)) * (width - padL - padR);
  const y = (v) => padT + (1 - (v - series.min) / (series.max - series.min)) * (height - padT - padB);
  const hasData = series.out.some((s) => s.pts.length > 1);
  const fmtTick = (v) =>
    metric === 'pres' && unitOpts.presImperial ? v.toFixed(2) : metric === 'hum' ? Math.round(v) : v.toFixed(1);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {[0, 0.5, 1].map((f) => {
        const v = series.min + (series.max - series.min) * f;
        return (
          <g key={f}>
            <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke="var(--border-color)" strokeWidth="0.5" />
            <text
              x={padL - 3}
              y={y(v) + 3}
              fontSize="7"
              textAnchor="end"
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {fmtTick(v)}
            </text>
          </g>
        );
      })}
      {[-24, -18, -12, -6, 0].map((h) => (
        <text
          key={h}
          x={x(now + h * 3600 * 1000)}
          y={height - 3}
          fontSize="7"
          textAnchor="middle"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
        >
          {h === 0 ? 'now' : `${h}h`}
        </text>
      ))}
      {series.out.map((s) => {
        // break the line at gaps > 10 min
        const segs = [];
        let cur = [];
        let prevT = null;
        for (const p of s.pts) {
          if (prevT != null && p.t - prevT > 10 * 60 * 1000 && cur.length) {
            segs.push(cur);
            cur = [];
          }
          cur.push(`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
          prevT = p.t;
        }
        if (cur.length) segs.push(cur);
        return segs.map((seg, i) => (
          <polyline
            key={`${s.id}-${i}`}
            points={seg.join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        ));
      })}
      {!hasData && (
        <text x={width / 2} y={height / 2} fontSize="9" textAnchor="middle" fill="var(--text-muted)">
          collecting…
        </text>
      )}
    </svg>
  );
};

export const EnvSensorsPanel = ({ allUnits }) => {
  const { t } = useTranslation();
  const { sources, stale, history, available, at } = useEnvSensors();
  const [metric, setMetric] = useState('temp');
  const tempImperial = allUnits?.temp !== 'metric';
  const presImperial = allUnits?.press !== 'metric';
  const unitOpts = useMemo(() => ({ tempImperial, presImperial }), [tempImperial, presImperial]);

  const metricLabel = {
    temp: t('envSensorsPanel.temperature'),
    hum: t('envSensorsPanel.humidity'),
    pres: t('envSensorsPanel.pressure'),
  };

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
        <span>🌡️ {t('envSensorsPanel.title')}</span>
        <span
          style={{
            color: stale ? 'var(--accent-amber)' : 'var(--text-muted)',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {!available
            ? t('envSensorsPanel.noBridge')
            : stale
              ? t('envSensorsPanel.stale')
              : at
                ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''}
        </span>
      </div>

      {!available && (
        <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.5 }}>
          <div>{t('envSensorsPanel.setup')}</div>
          <div style={{ marginTop: '6px' }}>{t('envSensorsPanel.setupHint')}</div>
        </div>
      )}

      {available && (
        <>
          {/* Two-sensor split (HamClock style): one column per source */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, Math.min(sources.length, 3))}, 1fr)`,
              gap: '6px',
              marginBottom: '8px',
            }}
          >
            {sources.map((s, i) => (
              <div
                key={s.id}
                style={{
                  background: 'var(--bg-tertiary)',
                  borderRadius: '4px',
                  padding: '6px',
                  borderTop: `2px solid ${SERIES_COLORS[i % SERIES_COLORS.length]}`,
                  opacity: stale ? 0.6 : 1,
                }}
              >
                <div
                  style={{
                    fontSize: '9px',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    marginBottom: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.name} <span style={{ opacity: 0.6 }}>{s.type}</span>
                </div>
                {s.error ? (
                  <div style={{ fontSize: '10px', color: 'var(--accent-red)' }}>{s.error}</div>
                ) : (
                  <>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '20px',
                        color: 'var(--text-primary)',
                        lineHeight: 1.1,
                      }}
                    >
                      {fmtTemp(s.temperature, tempImperial)}
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono)',
                        lineHeight: 1.5,
                      }}
                    >
                      {s.humidity != null && (
                        <div>
                          {t('envSensorsPanel.rh')} {fmtHum(s.humidity)} · {t('envSensorsPanel.dew')}{' '}
                          {fmtTemp(s.dewPoint, tempImperial, 0)}
                        </div>
                      )}
                      <div>{fmtPres(s.pressure, presImperial)}</div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* History */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', flex: 1 }}>
              {t('envSensorsPanel.history24h')}
            </span>
            {METRICS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                aria-pressed={metric === m}
                aria-label={metricLabel[m]}
                style={{
                  background: metric === m ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                  color: metric === m ? 'var(--bg-primary)' : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  fontSize: '9px',
                  padding: '1px 6px',
                  cursor: 'pointer',
                }}
              >
                {metricLabel[m]}
              </button>
            ))}
          </div>
          <HistoryChart history={history} metric={metric} unitOpts={unitOpts} />
          <div
            style={{
              display: 'flex',
              gap: '10px',
              fontSize: '9px',
              color: 'var(--text-muted)',
              marginTop: '2px',
              flexWrap: 'wrap',
            }}
          >
            {Object.entries(history).map(([id, src], i) => (
              <span key={id}>
                <span style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>■</span> {src.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default EnvSensorsPanel;
