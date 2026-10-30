/**
 * voacapHeatmap — shared by the VOACAP Propagation Map on the flat/azimuthal
 * map (plugins/layers/useVOACAPHeatmap.js) and on the 3D globe
 * (paintVoacapHeatmap in utils/globeOverlays.js + Globe3D's fetch, with its
 * settings panel components/VoacapGlobeControl.jsx), so both projections ask
 * the same server URL and draw the same colours.
 *
 * Settings (band, grid, mode, power) live where the flat layer always kept
 * them — `voacap-heatmap-band` / `voacap-heatmap-grid` and
 * openhamclock_config.propagation — and changes are announced with
 * VOACAP_SETTINGS_EVENT so both panels stay in step.
 */

// HF bands: label, frequency in MHz
export const BANDS = [
  { label: '160m', freq: 1.8 },
  { label: '80m', freq: 3.5 },
  { label: '40m', freq: 7 },
  { label: '30m', freq: 10 },
  { label: '20m', freq: 14 },
  { label: '17m', freq: 18 },
  { label: '15m', freq: 21 },
  { label: '12m', freq: 24 },
  { label: '10m', freq: 28 },
];
export const GRID_SIZES = [5, 10, 15, 20];
export const MODES = ['SSB', 'CW', 'FT8', 'FT4', 'FT2', 'RTTY', 'AM', 'FM'];
export const POWERS = [5, 10, 25, 50, 100, 200, 400, 500, 750, 1000, 1500];

export const DEFAULT_BAND_INDEX = 4; // 20m
export const DEFAULT_GRID = 5;

/** Fired on window when a panel changes a setting; detail = full settings. */
export const VOACAP_SETTINGS_EVENT = 'openhamclock-voacap-settings';
/** Fired on window by the globe when a heatmap response lands; detail = { mode, power, solarData }. */
export const VOACAP_DATA_EVENT = 'openhamclock-voacap-data';

// Cubic smoothstep — smooth interpolation between edge0 and edge1, with zero
// first-derivative at both ends. Eliminates the visible "step" you'd get from
// a linear ramp between bands.
export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Reliability to color: HamClock-style wide spectrum
// magenta (0%) → red → orange → yellow → green (100%)
export function reliabilityColor(r) {
  if (r >= 99) return { color: 'rgb(0,220,0)', alpha: 0.85 };

  let red, green, blue;
  if (r < 25) {
    // Below VOACAP's usefully-modelled range. Color stays as a dim
    // red-purple but the alpha will be tapered to ~0 (see below), so the
    // exact RGB barely matters — it just sets the hue you see at the very
    // edge of the predicted region.
    const t = r / 25;
    red = 40 + Math.round(t * 180);
    green = 30;
    blue = 80 - Math.round(t * 80);
  } else if (r < 40) {
    // Low: Red → Orange
    const t = (r - 25) / 15;
    red = 220 + Math.round(t * 35);
    green = Math.round(t * 120);
    blue = 0;
  } else if (r < 60) {
    // Fair: Orange → Yellow
    const t = (r - 40) / 20;
    red = 255;
    green = 120 + Math.round(t * 135);
    blue = 0;
  } else if (r < 80) {
    // Good: Yellow → Yellow-Green
    const t = (r - 60) / 20;
    red = 255 - Math.round(t * 140);
    green = 255;
    blue = 0;
  } else {
    // Excellent: Yellow-Green → Green
    const t = (r - 80) / 20;
    red = 115 - Math.round(t * 115);
    green = 220 + Math.round(t * 35);
    blue = 0;
  }

  // Smooth alpha taper from 0 → 0.85 across r=0..40 (#990 round 3).
  // Previously the alpha jumped from 0.25 at r<10 to 0.75 at r=40 in
  // discrete bands, which read as a hard vertical cliff at VOACAP's
  // useful-range boundary. A cubic smoothstep makes the edge fade
  // gradually into the base map — visually a real propagation map rather
  // than a stamped-out region.
  const alpha = smoothstep(0, 40, r) * 0.85;
  return { color: `rgb(${red},${green},${blue})`, alpha };
}

/**
 * Spatial blur of the reliability grid (#990 round 4): a 3×3 box average per
 * cell. VOACAP's output has a real discontinuity where the short-path
 * prediction gives up and long-path becomes shorter — adjacent cells can jump
 * from r=5 to r=52, which renders as a visual cliff regardless of how smooth
 * the alpha taper is. Averaging feathers that over a couple of cells without
 * claiming the underlying physics is wrong. Longitude wraps at ±180;
 * latitude doesn't.
 * @returns {Map<object, number>} cell → smoothed reliability
 */
export function smoothReliability(data) {
  const cells = Array.isArray(data?.cells) ? data.cells : [];
  const grid = data?.gridSize || 10;
  const cellMap = new Map();
  for (const c of cells) cellMap.set(`${c.lat},${c.lon}`, c);
  const wrapLon = (lon) => ((lon + 540) % 360) - 180;
  const smoothed = new Map();
  for (const c of cells) {
    let sum = 0;
    let count = 0;
    for (const dlat of [-grid, 0, grid]) {
      for (const dlon of [-grid, 0, grid]) {
        const n = cellMap.get(`${c.lat + dlat},${wrapLon(c.lon + dlon)}`);
        if (n) {
          sum += n.r || 0;
          count++;
        }
      }
    }
    smoothed.set(c, count > 0 ? sum / count : c.r);
  }
  return smoothed;
}

/** Centre of a locator's 4-character square, or null. */
export function deFromLocator(locator) {
  if (!locator || locator.length < 4) return null;
  const g = locator.toUpperCase();
  const lon = (g.charCodeAt(0) - 65) * 20 - 180;
  const lat = (g.charCodeAt(1) - 65) * 10 - 90;
  const lonMin = parseInt(g[2]) * 2;
  const latMin = parseInt(g[3]) * 1;
  return { lat: lat + latMin + 0.5, lon: lon + lonMin + 1 };
}

/**
 * Heatmap request URL. DE is rounded to whole degrees — propagation doesn't
 * differ within 1°, and identical URLs share server + browser + CDN caches
 * (the flat map and the globe ask for the same one).
 */
export function heatmapUrl({ deLat, deLon, freq, grid, mode, power }) {
  return `/api/propagation/heatmap?deLat=${Math.round(deLat)}&deLon=${Math.round(deLon)}&freq=${freq}&grid=${grid}&mode=${mode}&power=${power}`;
}

const readConfig = () => {
  try {
    return JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
  } catch {
    return {};
  }
};

/** Current settings: { bandIndex, grid, mode, power }. */
export function getVoacapSettings() {
  let bandIndex = DEFAULT_BAND_INDEX;
  let grid = DEFAULT_GRID;
  try {
    const b = parseInt(localStorage.getItem('voacap-heatmap-band'));
    if (Number.isInteger(b) && BANDS[b]) bandIndex = b;
    const g = parseInt(localStorage.getItem('voacap-heatmap-grid'));
    if (GRID_SIZES.includes(g)) grid = g;
  } catch {
    /* storage unavailable — defaults */
  }
  const cfg = readConfig();
  return {
    bandIndex,
    grid,
    mode: cfg.propagation?.mode || 'SSB',
    power: cfg.propagation?.power || 100,
  };
}

/**
 * Change settings (any of bandIndex, grid, mode, power), persist them where
 * the flat layer always kept them, and announce the change.
 */
export function setVoacapSettings(partial = {}) {
  const next = { ...getVoacapSettings(), ...partial };
  try {
    localStorage.setItem('voacap-heatmap-band', String(next.bandIndex));
    localStorage.setItem('voacap-heatmap-grid', String(next.grid));
    if (partial.mode !== undefined || partial.power !== undefined) {
      const cfg = readConfig();
      cfg.propagation = { ...(cfg.propagation || {}), mode: next.mode, power: next.power };
      // No openhamclock-config-change here: the panels sync through
      // VOACAP_SETTINGS_EVENT, as the flat layer always did.
      localStorage.setItem('openhamclock_config', JSON.stringify(cfg));
    }
  } catch {
    /* storage unavailable — the event still updates open panels */
  }
  try {
    window.dispatchEvent(new CustomEvent(VOACAP_SETTINGS_EVENT, { detail: next }));
  } catch {
    /* no window (SSR) */
  }
  return next;
}

/** Subscribe to settings changes; fn(settings). Returns an unsubscribe fn. */
export function subscribeVoacapSettings(fn) {
  const handler = (e) => fn(e.detail || getVoacapSettings());
  window.addEventListener(VOACAP_SETTINGS_EVENT, handler);
  return () => window.removeEventListener(VOACAP_SETTINGS_EVENT, handler);
}
