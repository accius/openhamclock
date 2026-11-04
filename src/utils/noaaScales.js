/**
 * NOAA Space Weather Scales helpers — R (radio blackouts), S (solar
 * radiation storms), G (geomagnetic storms), levels 0–5.
 *
 * normalizeNoaaScales() turns the raw noaa-scales.json object (keys "-1",
 * "0".."3") into { now, days } for the NOAA Scales panel; the colour ramp
 * mirrors swpc.noaa.gov (data-driven severity colours, not theme colours).
 */

export const SCALE_BANDS = ['R', 'S', 'G'];

export const SCALE_TITLES = {
  R: 'Radio blackout',
  S: 'Solar radiation',
  G: 'Geomagnetic storm',
};

const LEVEL_WORDS = ['none', 'minor', 'moderate', 'strong', 'severe', 'extreme'];

// swpc.noaa.gov scale colours: grey/green for none, then the familiar
// green → yellow → orange → red → dark red ramp.
const LEVEL_COLORS = ['#7f8c8d', '#92d050', '#ffd600', '#ff9632', '#ef4444', '#b91c1c'];

/** Clamp a raw scale value ("0".."5", number, null) to an integer level or null. */
export function scaleLevel(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(5, n));
}

export const scaleColor = (level) => LEVEL_COLORS[scaleLevel(level) ?? 0];
export const scaleWord = (level) => LEVEL_WORDS[scaleLevel(level) ?? 0];

/** Plain-language impact for a band at a level (HamClock-style one-liners). */
export function scaleImpact(band, level) {
  const l = scaleLevel(level) ?? 0;
  if (l === 0) return 'no effect';
  switch (band) {
    case 'R':
      return [
        '',
        'weak HF fade on sunlit side',
        'HF loss ~1 h on sunlit side',
        'wide-area HF blackout ~1 h',
        'HF blackout 1–2 h, GPS degraded',
        'complete HF blackout for hours',
      ][l];
    case 'S':
      return [
        '',
        'minor polar HF effects',
        'polar HF/nav slightly degraded',
        'polar HF degraded, nav errors',
        'polar HF blackout for days',
        'polar HF blackout, nav useless',
      ][l];
    case 'G':
      return [
        '',
        'weak Kp5 — aurora at high lat',
        'Kp6 — HF fades at high lat',
        'Kp7 — HF intermittent, aurora mid-lat',
        'Kp8 — HF sporadic, aurora to 45°',
        'Kp9 — HF out 1–2 days',
      ][l];
    default:
      return '';
  }
}

const prob = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};

const dayEntry = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  return {
    date: raw.DateStamp || null,
    time: raw.TimeStamp || null,
    R: {
      level: scaleLevel(raw.R?.Scale),
      text: raw.R?.Text || null,
      minorProb: prob(raw.R?.MinorProb),
      majorProb: prob(raw.R?.MajorProb),
    },
    S: { level: scaleLevel(raw.S?.Scale), text: raw.S?.Text || null, prob: prob(raw.S?.Prob) },
    G: { level: scaleLevel(raw.G?.Scale), text: raw.G?.Text || null },
  };
};

/**
 * @param {object} raw noaa-scales.json object
 * @returns {{ now: object|null, yesterday: object|null, days: object[] }}
 *   now = key "0" (observed today), days = keys "1".."3" (forecast)
 */
export function normalizeNoaaScales(raw) {
  if (!raw || typeof raw !== 'object') return { now: null, yesterday: null, days: [] };
  const days = [];
  for (const key of ['1', '2', '3']) {
    const d = dayEntry(raw[key]);
    if (d) days.push(d);
  }
  return { now: dayEntry(raw['0']), yesterday: dayEntry(raw['-1']), days };
}

/** Compact "R0 S0 G1" summary of the current levels. */
export function scalesSummary(now) {
  if (!now) return '';
  return SCALE_BANDS.map((b) => `${b}${now[b]?.level ?? '–'}`).join(' ');
}

/** Highest current level across the three bands (for a header badge colour). */
export function maxScaleLevel(now) {
  if (!now) return 0;
  return Math.max(0, ...SCALE_BANDS.map((b) => now[b]?.level ?? 0));
}

/**
 * Forecast-day display value for a band: G has a predicted level, R and S
 * come as probabilities. Returns { level, label } where level drives colour.
 */
export function forecastCell(band, day) {
  if (!day) return { level: null, label: '—' };
  const v = day[band];
  if (!v) return { level: null, label: '—' };
  if (band === 'G') return { level: v.level, label: v.level == null ? '—' : `G${v.level}` };
  if (band === 'R') {
    if (v.level != null) return { level: v.level, label: `R${v.level}` };
    if (v.minorProb == null && v.majorProb == null) return { level: null, label: '—' };
    // Colour by the most likely outcome: major ≥ 25% → R3-ish, minor ≥ 50% → R1
    const level = (v.majorProb ?? 0) >= 25 ? 3 : (v.minorProb ?? 0) >= 50 ? 1 : (v.minorProb ?? 0) >= 25 ? 1 : 0;
    return { level, label: `${v.minorProb ?? 0}% / ${v.majorProb ?? 0}%` };
  }
  // S
  if (v.level != null) return { level: v.level, label: `S${v.level}` };
  if (v.prob == null) return { level: null, label: '—' };
  return { level: v.prob >= 50 ? 1 : 0, label: `${v.prob}%` };
}
