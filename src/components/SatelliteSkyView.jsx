/**
 * SatelliteSkyView — polar sky plot of one pass (HamClock style): zenith at
 * the centre, horizon on the rim, N/E/S/W around the edge, the pass drawn
 * AOS → LOS with its max-elevation point marked. Optionally shows where the
 * satellite is right now.
 */
import { useMemo } from 'react';
import { polarXY, skyPathToSvgPoints } from '../utils/satelliteSkyPath.js';

const fmtTime = (ms) =>
  Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';

export default function SatelliteSkyView({
  sky, // { points, aos, los, max } from computePassSkyPath
  now = null, // { az, el } current position (optional)
  size = 180,
  color = 'var(--accent-cyan)',
  title = '',
  dashed = false,
}) {
  const r = size / 2 - 14; // leave room for the cardinal labels
  const c = size / 2;

  const geometry = useMemo(() => {
    if (!sky?.points?.length) return null;
    return {
      path: skyPathToSvgPoints(sky.points, r, c, c),
      aos: polarXY(sky.aos.az, 0, r, c, c),
      los: polarXY(sky.los.az, 0, r, c, c),
      max: polarXY(sky.max.az, sky.max.el, r, c, c),
    };
  }, [sky, r, c]);

  const nowXY =
    now && Number.isFinite(now.az) && Number.isFinite(now.el) && now.el >= 0 ? polarXY(now.az, now.el, r, c, c) : null;

  const ring = (el) => (
    <circle
      key={el}
      cx={c}
      cy={c}
      r={r * (1 - el / 90)}
      fill="none"
      stroke="var(--border-color)"
      strokeWidth={el === 0 ? 1.5 : 0.8}
      strokeDasharray={el === 0 ? undefined : '2 3'}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={title || 'Satellite pass sky view'}
        style={{ fontFamily: 'var(--font-mono)', display: 'block', maxWidth: '100%' }}
      >
        {[0, 30, 60].map(ring)}
        <line x1={c} y1={c - r} x2={c} y2={c + r} stroke="var(--border-color)" strokeWidth={0.8} />
        <line x1={c - r} y1={c} x2={c + r} y2={c} stroke="var(--border-color)" strokeWidth={0.8} />
        {[
          ['N', c, c - r - 4],
          ['E', c + r + 7, c + 3.5],
          ['S', c, c + r + 11],
          ['W', c - r - 7, c + 3.5],
        ].map(([label, x, y]) => (
          <text key={label} x={x} y={y} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text-secondary)">
            {label}
          </text>
        ))}
        <text x={c + 2} y={c - r * (1 - 30 / 90) - 2} fontSize={7} fill="var(--text-muted)">
          30°
        </text>
        <text x={c + 2} y={c - r * (1 - 60 / 90) - 2} fontSize={7} fill="var(--text-muted)">
          60°
        </text>

        {geometry && (
          <>
            <polyline
              points={geometry.path}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={dashed ? '4 4' : undefined}
              opacity={0.95}
            />
            <circle cx={geometry.aos.x} cy={geometry.aos.y} r={3.5} fill="var(--accent-green)" />
            <circle cx={geometry.los.x} cy={geometry.los.y} r={3.5} fill="var(--accent-red)" />
            <circle cx={geometry.max.x} cy={geometry.max.y} r={3} fill="none" stroke={color} strokeWidth={1.5} />
            <text x={geometry.aos.x} y={geometry.aos.y - 6} textAnchor="middle" fontSize={8} fill="var(--accent-green)">
              AOS {fmtTime(sky.aos.t)}
            </text>
            <text x={geometry.los.x} y={geometry.los.y + 13} textAnchor="middle" fontSize={8} fill="var(--accent-red)">
              LOS {fmtTime(sky.los.t)}
            </text>
            <text x={geometry.max.x + 6} y={geometry.max.y - 4} fontSize={8} fill="var(--text-primary)">
              {Math.round(sky.max.el)}° {fmtTime(sky.max.t)}
            </text>
          </>
        )}
        {nowXY && (
          <g>
            <circle cx={nowXY.x} cy={nowXY.y} r={5} fill={color} opacity={0.25} />
            <circle cx={nowXY.x} cy={nowXY.y} r={2.5} fill="var(--text-primary)" />
          </g>
        )}
      </svg>
      {title && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{title}</div>}
    </div>
  );
}
