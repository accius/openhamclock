/**
 * Dst index interpretation for the Dst panel and Solar Indices view.
 *
 * Dst (nT) measures the ring current: near zero is quiet, strongly
 * negative is a geomagnetic storm. HamClock's rule of thumb for low-band
 * operators: beyond about ±10 nT the 160 m path starts to suffer, and a
 * positive spike usually means a CME has just compressed the
 * magnetosphere (sudden commencement) — the storm follows.
 */

export const DST_BANDS = [
  {
    min: 10,
    color: '#fbbf24',
    label: 'Compressed',
    text: 'Positive Dst — sudden commencement; a CME may have arrived, storm may follow',
  },
  {
    min: -10,
    color: '#4ade80',
    label: 'Quiet',
    text: 'Near zero — quiet ring current, good for 160 m and the low bands',
  },
  { min: -30, color: '#a3e635', label: 'Unsettled', text: 'Beyond −10 nT — 160 m and polar paths may be disturbed' },
  { min: -50, color: '#fbbf24', label: 'Minor storm', text: 'Minor storm — high-latitude HF noisy, aurora possible' },
  {
    min: -100,
    color: '#ff9632',
    label: 'Moderate storm',
    text: 'Moderate storm — low bands degraded, aurora at mid-latitudes',
  },
  {
    min: -250,
    color: '#ef4444',
    label: 'Intense storm',
    text: 'Intense storm — HF widely degraded, aurora far from the poles',
  },
  {
    min: -Infinity,
    color: '#b91c1c',
    label: 'Super storm',
    text: 'Super storm — HF blackout likely, auroral displays at low latitudes',
  },
];

/** @returns {{ color, label, text }} */
export function interpretDst(nT) {
  if (!Number.isFinite(nT)) return { color: 'var(--text-muted)', label: '—', text: 'Dst unavailable' };
  if (nT > 10) return DST_BANDS[0];
  for (let i = 1; i < DST_BANDS.length; i++) {
    if (nT >= DST_BANDS[i].min) return DST_BANDS[i];
  }
  return DST_BANDS[DST_BANDS.length - 1];
}

/** Trend over the last `hours` of an hourly series: 'rising' | 'falling' | 'steady' | null. */
export function dstTrend(series, hours = 3) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const last = series[series.length - 1];
  const cutoff = last.t - hours * 3600e3;
  const ref = series.find((p) => p.t >= cutoff) || series[0];
  const delta = last.dst - ref.dst;
  if (delta >= 10) return 'rising';
  if (delta <= -10) return 'falling';
  return 'steady';
}

/** Lowest value in the series (storm minimum) with its time, or null. */
export function dstMinimum(series) {
  if (!Array.isArray(series) || !series.length) return null;
  return series.reduce((min, p) => (p.dst < min.dst ? p : min), series[0]);
}
