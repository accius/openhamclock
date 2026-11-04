/**
 * SpaceWxTrendsPanel — 24 h sparklines for solar wind speed, IMF Bz, and
 * GOES ≥10 MeV proton flux, from /api/swpc/trends. The SWPC Alerts panel
 * says what happened; this one shows where conditions are heading —
 * southward Bz + rising wind speed = aurora/geomagnetic trouble incoming.
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';

const POLL_MS = 10 * 60 * 1000;

/** Inline sparkline. `points` = [{ t, v }] with possible null v (gaps). */
const Sparkline = ({ points, width = 260, height = 34, color, zeroLine = false, logScale = false }) => {
  const vals = points.filter((p) => p.v != null).map((p) => (logScale ? Math.log10(Math.max(p.v, 1e-3)) : p.v));
  if (vals.length < 2) {
    return <div style={{ height, color: 'var(--text-muted)', fontSize: '9px', paddingTop: '10px' }}>no data</div>;
  }
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (zeroLine) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (max - min < 1e-6) max = min + 1;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * width;
  const y = (v) => height - ((v - min) / (max - min)) * (height - 4) - 2;

  // Break the polyline at null gaps
  const segments = [];
  let current = [];
  for (const p of points) {
    if (p.v == null) {
      if (current.length > 1) segments.push(current);
      current = [];
      continue;
    }
    const v = logScale ? Math.log10(Math.max(p.v, 1e-3)) : p.v;
    current.push(`${x(p.t).toFixed(1)},${y(v).toFixed(1)}`);
  }
  if (current.length > 1) segments.push(current);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {zeroLine && (
        <line
          x1="0"
          y1={y(0)}
          x2={width}
          y2={y(0)}
          stroke="var(--border-color)"
          strokeWidth="1"
          strokeDasharray="3,3"
        />
      )}
      {segments.map((seg, i) => (
        <polyline key={i} points={seg.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      ))}
    </svg>
  );
};

const TrendBlock = ({ title, value, unit, valueColor, children }) => (
  <div style={{ marginBottom: '8px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: 700 }}>{title}</span>
      <span style={{ color: valueColor, fontSize: '12px', fontWeight: 700 }}>
        {value != null ? value : '—'}
        <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: 400 }}> {unit}</span>
      </span>
    </div>
    {children}
  </div>
);

export const SpaceWxTrendsPanel = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchTrends = async () => {
      try {
        const response = await apiFetch('/api/swpc/trends');
        if (response?.ok) setData(await response.json());
      } catch (err) {
        console.error('Space Wx trends error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTrends();
    fetchRef.current = fetchTrends;
    const id = setInterval(fetchTrends, POLL_MS);
    return () => clearInterval(id);
  }, []);
  useVisibilityRefresh(() => fetchRef.current?.(), 60000);

  const latest = data?.latest || {};
  const bzColor = latest.bz != null && latest.bz < -5 ? '#ef4444' : latest.bz < 0 ? '#fbbf24' : '#4ade80';
  const speedColor = latest.speed > 600 ? '#ef4444' : latest.speed > 450 ? '#fbbf24' : 'var(--accent-cyan)';
  const protonColor = latest.proton10 >= 10 ? '#ef4444' : latest.proton10 >= 1 ? '#fbbf24' : '#4ade80';
  // GOES ≥2 MeV electrons: 1000 is NOAA's satellite-charging alert threshold
  const electronColor = latest.electron2 >= 1000 ? '#ef4444' : latest.electron2 >= 100 ? '#fbbf24' : '#4ade80';

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
        <span>SPACE WX TRENDS</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '9px' }}>last 24h</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !data ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            Space weather data unavailable
          </div>
        ) : (
          <>
            <TrendBlock
              title="SOLAR WIND SPEED"
              value={latest.speed && Math.round(latest.speed)}
              unit="km/s"
              valueColor={speedColor}
            >
              <Sparkline points={(data.wind || []).map((p) => ({ t: p.t, v: p.speed }))} color={speedColor} />
            </TrendBlock>

            <TrendBlock title="IMF Bz (GSM)" value={latest.bz} unit="nT" valueColor={bzColor}>
              <Sparkline points={(data.mag || []).map((p) => ({ t: p.t, v: p.bz }))} color={bzColor} zeroLine />
            </TrendBlock>

            <TrendBlock
              title="PROTON FLUX ≥10 MeV"
              value={
                latest.proton10 != null
                  ? latest.proton10 < 10
                    ? latest.proton10.toFixed(2)
                    : Math.round(latest.proton10)
                  : null
              }
              unit="pfu"
              valueColor={protonColor}
            >
              <Sparkline
                points={(data.protons || []).map((p) => ({ t: p.t, v: p.flux }))}
                color={protonColor}
                logScale
              />
            </TrendBlock>

            <TrendBlock
              title="ELECTRON FLUX ≥2 MeV"
              value={
                latest.electron2 != null
                  ? latest.electron2 >= 1000
                    ? `${(latest.electron2 / 1000).toFixed(1)}k`
                    : Math.round(latest.electron2)
                  : null
              }
              unit="e/cm²·s·sr"
              valueColor={electronColor}
            >
              <Sparkline
                points={(data.electrons || []).map((p) => ({ t: p.t, v: p.flux }))}
                color={electronColor}
                logScale
              />
            </TrendBlock>

            <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginTop: '2px' }}>
              Density {latest.density != null ? `${latest.density} p/cc` : '—'} · Bt{' '}
              {latest.bt != null ? `${latest.bt} nT` : '—'}
              {data.stale && <span style={{ color: '#fbbf24' }}> · stale</span>}
            </div>
          </>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
        }}
      >
        NOAA SWPC
      </div>
    </div>
  );
};

export default SpaceWxTrendsPanel;
