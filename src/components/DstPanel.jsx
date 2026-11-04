/**
 * DstPanel Component
 * Kyoto Dst index — the ring-current storm measure: current value in nT,
 * a 24 h (or 72 h) hourly sparkline with the zero line, and a one-line
 * reading for low-band operators (near zero good; beyond ±10 nT 160 m may
 * suffer). Data via the useDst hook (Kyoto WDC, SWPC fallback).
 */
import { useState } from 'react';
import { interpretDst, dstTrend, dstMinimum } from '../utils/dst.js';

const WINDOWS = [24, 72];

const Sparkline = ({ points, color, width = 260, height = 44 }) => {
  if (points.length < 2) {
    return <div style={{ height, color: 'var(--text-muted)', fontSize: '9px', paddingTop: '14px' }}>no data</div>;
  }
  const vals = points.map((p) => p.dst);
  let min = Math.min(...vals, -10);
  let max = Math.max(...vals, 10);
  if (max - min < 1) max = min + 1;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * width;
  const y = (v) => height - ((v - min) / (max - min)) * (height - 4) - 2;
  const path = points.map((p) => `${x(p.t).toFixed(1)},${y(p.dst).toFixed(1)}`).join(' ');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {/* ±10 nT comfort band for 160 m */}
      <rect x="0" y={y(10)} width={width} height={Math.max(0, y(-10) - y(10))} fill="rgba(74, 222, 128, 0.08)" />
      <line x1="0" y1={y(0)} x2={width} y2={y(0)} stroke="var(--text-muted)" strokeWidth="0.5" strokeDasharray="3 3" />
      {min <= -50 && (
        <line x1="0" y1={y(-50)} x2={width} y2={y(-50)} stroke="#fbbf24" strokeWidth="0.5" strokeDasharray="2 4" />
      )}
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const fmtTime = (t) => {
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00z`;
};

export const DstPanel = ({ data, loading, error }) => {
  const [hours, setHours] = useState(24);
  const series = Array.isArray(data?.series) ? data.series : [];
  const windowed = series.length ? series.filter((p) => p.t >= series[series.length - 1].t - hours * 3600e3) : [];
  const current = data?.current?.dst ?? null;
  const info = interpretDst(current);
  const trend = dstTrend(series);
  const minimum = dstMinimum(windowed);

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
        <span>🧲 DST INDEX</span>
        <div style={{ display: 'flex', gap: '2px' }}>
          {WINDOWS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHours(h)}
              aria-label={`Show last ${h} hours`}
              aria-pressed={hours === h}
              style={{
                background: hours === h ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                color: hours === h ? '#000' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '3px',
                padding: '1px 5px',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !data ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {error ? 'Dst unavailable' : 'No Dst data'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
              <span style={{ fontSize: '26px', fontWeight: 700, color: info.color, fontFamily: 'Orbitron, monospace' }}>
                {current == null ? '—' : current > 0 ? `+${current}` : current}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>nT</span>
              <span
                style={{
                  marginLeft: 'auto',
                  background: info.color,
                  color: '#000',
                  padding: '1px 6px',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontWeight: 700,
                }}
              >
                {info.label.toUpperCase()}
              </span>
              {trend && (
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }} title="3-hour trend">
                  {trend === 'rising' ? '↗ recovering' : trend === 'falling' ? '↘ falling' : '→ steady'}
                </span>
              )}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', lineHeight: 1.35, marginBottom: '6px' }}>
              {info.text}
            </div>
            <Sparkline points={windowed} color={info.color} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '8px',
                color: 'var(--text-muted)',
                marginTop: '1px',
              }}
            >
              <span>−{hours}h</span>
              {minimum && (
                <span>
                  min {minimum.dst} nT @ {fmtTime(minimum.t)}
                </span>
              )}
              <span>now</span>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '8px', marginTop: '6px', lineHeight: 1.3 }}>
              Green band = ±10 nT, the comfort zone for 160 m. −50 nT minor storm · −100 moderate · −250 intense.
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
        {data?.source || 'Kyoto WDC'}
        {data?.updatedAt ? ` · ${data.updatedAt.slice(11, 16)}z` : ''}
      </div>
    </div>
  );
};

export default DstPanel;
