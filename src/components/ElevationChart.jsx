/**
 * ElevationChart — two elevation-vs-time curves (DE and DX) with the mutual
 * windows shaded, a "now" cursor and click-to-pick. Shared by the EME planner
 * (moon, 48 h) and the satellite planner (bird, 24 h). Pure SVG, theme
 * colours via CSS variables; DE/DX colours match the EME layout.
 *
 * @param {object} props
 * @param {Array<{t:Date, de:number|null, dx:number|null}>} props.series
 * @param {Array<{start:Date|number, end:Date|number}>} [props.windows]
 * @param {number} [props.minElev=0]      threshold line
 * @param {number} [props.nowMs]          cursor
 * @param {number|null} [props.pickedMs]  highlighted sample
 * @param {(t:Date)=>void} [props.onPick]
 * @param {number} [props.height=120]
 * @param {string} [props.ariaLabel]
 */
import { useId, useRef } from 'react';

export const DE_COLOR = '#4488ff';
export const DX_COLOR = '#00ddff';
const WINDOW_COLOR = '#22c55e';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z`;
};

export function ElevationChart({
  series = [],
  windows = [],
  minElev = 0,
  nowMs,
  pickedMs = null,
  onPick,
  height = 120,
  minY = -30,
  maxY = 90,
  ariaLabel = 'Elevation chart',
}) {
  const svgRef = useRef(null);
  const clipId = useId();
  const W = 600;
  const H = height;
  const PAD = { l: 26, r: 6, t: 6, b: 16 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  if (!series.length) return null;
  const t0 = series[0].t.getTime();
  const t1 = series[series.length - 1].t.getTime();
  const span = Math.max(1, t1 - t0);
  const x = (ms) => PAD.l + ((ms - t0) / span) * iw;
  const y = (el) => PAD.t + ((maxY - Math.max(minY, Math.min(maxY, el))) / (maxY - minY)) * ih;

  const path = (key) => {
    let d = '';
    let pen = false;
    for (const p of series) {
      const v = p[key];
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.t.getTime()).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  // Hour ticks: every 6 h for long spans, 3 h otherwise
  const hours = span / 3_600_000;
  const tickEvery = hours > 30 ? 6 : hours > 12 ? 3 : 1;
  const ticks = [];
  const firstTick = Math.ceil(t0 / 3_600_000) * 3_600_000;
  for (let t = firstTick; t <= t1; t += 3_600_000) {
    if (new Date(t).getUTCHours() % tickEvery === 0) ticks.push(t);
  }

  const pick = (evt) => {
    if (!onPick || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const ms = t0 + ((px - PAD.l) / iw) * span;
    if (ms < t0 || ms > t1) return;
    // Snap to the nearest sample
    let best = series[0];
    for (const p of series) if (Math.abs(p.t.getTime() - ms) < Math.abs(best.t.getTime() - ms)) best = p;
    onPick(best.t);
  };

  const onKey = (e) => {
    if (!onPick) return;
    const cur = pickedMs ?? nowMs ?? t0;
    const step = series.length > 1 ? series[1].t - series[0].t : 60_000;
    if (e.key === 'ArrowRight') onPick(new Date(Math.min(t1, cur + step)));
    else if (e.key === 'ArrowLeft') onPick(new Date(Math.max(t0, cur - step)));
    else return;
    e.preventDefault();
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      tabIndex={onPick ? 0 : -1}
      onClick={pick}
      onKeyDown={onKey}
      style={{ display: 'block', cursor: onPick ? 'crosshair' : 'default', outline: 'none' }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={PAD.l} y={PAD.t} width={iw} height={ih} />
        </clipPath>
      </defs>
      <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="var(--bg-tertiary)" />
      {/* Mutual windows */}
      <g clipPath={`url(#${clipId})`}>
        {windows.map((w, i) => {
          const a = x(+new Date(w.start));
          const b = x(+new Date(w.end));
          return (
            <rect key={i} x={a} y={PAD.t} width={Math.max(1, b - a)} height={ih} fill={WINDOW_COLOR} opacity="0.18" />
          );
        })}
      </g>
      {/* Elevation grid */}
      {[0, 30, 60].map((el) => (
        <g key={el}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(el)}
            y2={y(el)}
            stroke="var(--border-color)"
            strokeWidth={el === 0 ? 1 : 0.5}
            strokeDasharray={el === 0 ? '' : '3,3'}
          />
          <text x={PAD.l - 3} y={y(el) + 3} textAnchor="end" fontSize="8" fill="var(--text-muted)">
            {el}°
          </text>
        </g>
      ))}
      {minElev > 0 && (
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(minElev)}
          y2={y(minElev)}
          stroke={WINDOW_COLOR}
          strokeWidth="0.75"
          strokeDasharray="4,2"
          opacity="0.7"
        />
      )}
      {/* Time ticks */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--border-color)" strokeWidth="0.5" />
          <text x={x(t)} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--text-muted)">
            {hhmm(t)}
          </text>
        </g>
      ))}
      {/* Curves */}
      <g clipPath={`url(#${clipId})`}>
        <path d={path('de')} fill="none" stroke={DE_COLOR} strokeWidth="1.5" />
        <path d={path('dx')} fill="none" stroke={DX_COLOR} strokeWidth="1.5" strokeDasharray="4,2" />
      </g>
      {/* Now cursor */}
      {nowMs != null && nowMs >= t0 && nowMs <= t1 && (
        <line x1={x(nowMs)} x2={x(nowMs)} y1={PAD.t} y2={PAD.t + ih} stroke="#ff4d4d" strokeWidth="1" />
      )}
      {/* Picked sample */}
      {pickedMs != null && pickedMs >= t0 && pickedMs <= t1 && (
        <line
          x1={x(pickedMs)}
          x2={x(pickedMs)}
          y1={PAD.t}
          y2={PAD.t + ih}
          stroke="var(--text-primary)"
          strokeWidth="1"
          strokeDasharray="2,2"
        />
      )}
    </svg>
  );
}

export default ElevationChart;
