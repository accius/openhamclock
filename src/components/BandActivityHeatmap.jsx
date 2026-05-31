import { useEffect, useMemo, useState } from 'react';
import { getBandFromFreq, getCallsignInfo } from '../utils/callsign.js';

const CONTINENTS = ['EU', 'NA', 'SA', 'AS', 'AF', 'OC'];

// Bands shown top→bottom, matching the DX-Heat layout (shortest wavelength at top).
const BANDS = ['6m', '10m', '12m', '15m', '17m', '20m', '30m', '40m', '80m', '160m'];

const WINDOW_OPTIONS = [
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '60m' },
];

const STORAGE_PERSPECTIVE_KEY = 'openhamclock_bandActivity_perspective';
const STORAGE_WINDOW_KEY = 'openhamclock_bandActivity_window';

const COLOR_MIN_COUNT = 1;
const COLOR_MAX_COUNT = 20;

// Color stops (count → rgba). Stops chosen to mirror DX-Heat's legend ticks
// (0, 9, 11, 13, 19, 20) so the visual reads the same.
const COLOR_STOPS = [
  { v: 0, r: 72, g: 80, b: 200 },
  { v: 9, r: 80, g: 170, b: 230 },
  { v: 11, r: 80, g: 220, b: 130 },
  { v: 13, r: 240, g: 220, b: 60 },
  { v: 19, r: 240, g: 140, b: 50 },
  { v: 20, r: 230, g: 60, b: 50 },
];

function colorForCount(count) {
  if (count <= 0) return 'rgba(0,0,0,0)';
  const c = Math.min(COLOR_MAX_COUNT, count);
  let lo = COLOR_STOPS[0];
  let hi = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    if (c <= COLOR_STOPS[i].v) {
      lo = COLOR_STOPS[i - 1];
      hi = COLOR_STOPS[i];
      break;
    }
  }
  const t = hi.v === lo.v ? 0 : (c - lo.v) / (hi.v - lo.v);
  const r = Math.round(lo.r + (hi.r - lo.r) * t);
  const g = Math.round(lo.g + (hi.g - lo.g) * t);
  const b = Math.round(lo.b + (hi.b - lo.b) * t);
  // Heavier alpha for higher counts so the blob "pops" through the blur
  const a = 0.45 + 0.45 * Math.min(1, c / COLOR_MAX_COUNT);
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

// Layout constants for the SVG matrix.
const CELL_W = 38;
const CELL_H = 28;
const LEFT_GUTTER = 32;
const TOP_GUTTER = 18;
const MATRIX_W = LEFT_GUTTER + CELL_W * CONTINENTS.length;
const MATRIX_H = TOP_GUTTER + CELL_H * BANDS.length;
const BLOB_R = 18;

export default function BandActivityHeatmap({ dxSpots = [], userCallsign = '' }) {
  const defaultPerspective = useMemo(() => {
    const info = getCallsignInfo(userCallsign);
    return info?.continent && CONTINENTS.includes(info.continent) ? info.continent : 'EU';
  }, [userCallsign]);

  const [perspective, setPerspective] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PERSPECTIVE_KEY);
      if (saved && CONTINENTS.includes(saved)) return saved;
    } catch {}
    return defaultPerspective;
  });

  const [windowMin, setWindowMin] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem(STORAGE_WINDOW_KEY) || '60', 10);
      return WINDOW_OPTIONS.some((o) => o.value === saved) ? saved : 60;
    } catch {
      return 60;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PERSPECTIVE_KEY, perspective);
    } catch {}
  }, [perspective]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_WINDOW_KEY, String(windowMin));
    } catch {}
  }, [windowMin]);

  const matrix = useMemo(() => {
    const cutoff = Date.now() - windowMin * 60 * 1000;
    const m = {};
    BANDS.forEach((b) => {
      m[b] = {};
      CONTINENTS.forEach((c) => {
        m[b][c] = 0;
      });
    });

    for (const spot of dxSpots) {
      if (!spot) continue;
      if (spot.timestamp && spot.timestamp < cutoff) continue;
      const band = getBandFromFreq(spot.freq);
      if (!band || !BANDS.includes(band)) continue;

      // Spot list shape from useDXClusterData uses `call` for the DX side;
      // accept `dxCall` too in case the panel is fed from a different source.
      const sCont = getCallsignInfo(spot.spotter)?.continent;
      const dCont = getCallsignInfo(spot.call || spot.dxCall)?.continent;

      // Only count spots where at least one party is on the perspective continent.
      // The "other" party determines which column the spot lands in. If both are on
      // the perspective continent the spot is counted as intra-continental.
      let otherCont = null;
      if (sCont === perspective && dCont === perspective) {
        otherCont = perspective;
      } else if (sCont === perspective && CONTINENTS.includes(dCont)) {
        otherCont = dCont;
      } else if (dCont === perspective && CONTINENTS.includes(sCont)) {
        otherCont = sCont;
      }

      if (otherCont) m[band][otherCont]++;
    }
    return m;
  }, [dxSpots, perspective, windowMin]);

  const totalSpotsInView = useMemo(() => {
    let n = 0;
    for (const band of BANDS) for (const cont of CONTINENTS) n += matrix[band][cont];
    return n;
  }, [matrix]);

  const continentName = {
    EU: 'Europe',
    NA: 'North America',
    SA: 'South America',
    AS: 'Asia',
    AF: 'Africa',
    OC: 'Oceania',
  }[perspective];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        padding: '8px',
        gap: '8px',
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '11px' }}>
        <span style={{ fontWeight: 600 }}>Your continent</span>
        <select
          value={perspective}
          onChange={(e) => setPerspective(e.target.value)}
          style={{
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '3px',
            fontSize: '11px',
            padding: '2px 6px',
          }}
        >
          {CONTINENTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>window</span>
        <div style={{ display: 'flex', gap: '2px' }}>
          {WINDOW_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setWindowMin(o.value)}
              aria-pressed={windowMin === o.value}
              style={{
                background: windowMin === o.value ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                color: windowMin === o.value ? '#000' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                fontSize: '10px',
                padding: '2px 6px',
                cursor: 'pointer',
                fontWeight: windowMin === o.value ? 600 : 400,
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${MATRIX_W} ${MATRIX_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ maxWidth: '360px' }}
        >
          <defs>
            <filter id="heatBlur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>

          {CONTINENTS.map((cont, i) => (
            <text
              key={`col-${cont}`}
              x={LEFT_GUTTER + i * CELL_W + CELL_W / 2}
              y={TOP_GUTTER - 4}
              textAnchor="middle"
              fontSize="9"
              fontWeight="600"
              fill="var(--text-primary)"
            >
              {cont}
            </text>
          ))}

          {BANDS.map((band, j) => (
            <text
              key={`row-${band}`}
              x={LEFT_GUTTER - 4}
              y={TOP_GUTTER + j * CELL_H + CELL_H / 2 + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--text-primary)"
            >
              {band.replace('m', '')}
            </text>
          ))}

          <g filter="url(#heatBlur)">
            {BANDS.flatMap((band, j) =>
              CONTINENTS.map((cont, i) => {
                const count = matrix[band][cont];
                if (count < COLOR_MIN_COUNT) return null;
                return (
                  <circle
                    key={`blob-${band}-${cont}`}
                    cx={LEFT_GUTTER + i * CELL_W + CELL_W / 2}
                    cy={TOP_GUTTER + j * CELL_H + CELL_H / 2}
                    r={BLOB_R}
                    fill={colorForCount(count)}
                  />
                );
              }),
            )}
          </g>

          {[...Array(CONTINENTS.length + 1).keys()].map((i) => (
            <line
              key={`v${i}`}
              x1={LEFT_GUTTER + i * CELL_W}
              y1={TOP_GUTTER}
              x2={LEFT_GUTTER + i * CELL_W}
              y2={TOP_GUTTER + CELL_H * BANDS.length}
              stroke="var(--border-color)"
              strokeWidth="1"
            />
          ))}
          {[...Array(BANDS.length + 1).keys()].map((j) => (
            <line
              key={`h${j}`}
              x1={LEFT_GUTTER}
              y1={TOP_GUTTER + j * CELL_H}
              x2={LEFT_GUTTER + CELL_W * CONTINENTS.length}
              y2={TOP_GUTTER + j * CELL_H}
              stroke="var(--border-color)"
              strokeWidth="1"
            />
          ))}

          {BANDS.flatMap((band, j) =>
            CONTINENTS.map((cont, i) => {
              const count = matrix[band][cont];
              if (count < COLOR_MIN_COUNT) return null;
              return (
                <text
                  key={`lbl-${band}-${cont}`}
                  x={LEFT_GUTTER + i * CELL_W + CELL_W / 2}
                  y={TOP_GUTTER + j * CELL_H + CELL_H / 2 + 3}
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="600"
                  fill="rgba(0,0,0,0.75)"
                  style={{ pointerEvents: 'none' }}
                >
                  {count}
                </text>
              );
            }),
          )}
        </svg>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <svg width="100%" height="14" viewBox={`0 0 ${MATRIX_W} 14`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="bandActivityLegend" x1="0" y1="0" x2="1" y2="0">
              {COLOR_STOPS.map((s, i) => (
                <stop
                  key={i}
                  offset={`${((s.v - COLOR_STOPS[0].v) / (COLOR_MAX_COUNT - COLOR_STOPS[0].v)) * 100}%`}
                  stopColor={`rgb(${s.r},${s.g},${s.b})`}
                />
              ))}
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={MATRIX_W} height="10" fill="url(#bandActivityLegend)" />
        </svg>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '9px',
            color: 'var(--text-muted)',
            padding: '0 1px',
          }}
        >
          {[0, 9, 11, 13, 19, 20].map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.3 }}>
          Based on {totalSpotsInView} DX spot{totalSpotsInView === 1 ? '' : 's'} from/of stations in {continentName}{' '}
          over the last {windowMin} minutes, by continent and band.
        </div>
      </div>
    </div>
  );
}
