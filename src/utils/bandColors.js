/**
 * Band color utilities
 * Local-first user customization for band colors.
 */

export const BAND_COLOR_STORAGE_KEY = 'openhamclock_bandColors';
export const BAND_COLORS_CHANGE_EVENT = 'openhamclock-band-colors-change';

export const BAND_LEGEND_ORDER = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm'];

export const DEFAULT_BAND_COLORS = {
  '160m': '#ff6666',
  '80m': '#ff9966',
  '60m': '#ffcc66',
  '40m': '#ffcc66',
  '30m': '#99ff66',
  '20m': '#66ff99',
  '17m': '#66ffcc',
  '15m': '#66ccff',
  '12m': '#6699ff',
  '11m': '#8866ff',
  '10m': '#9966ff',
  '6m': '#ff66ff',
  '2m': '#44ddff',
  '70cm': '#4488ff',
};

const BAND_RANGES_MHZ = [
  { min: 1.8, max: 2, band: '160m' },
  { min: 3.5, max: 4, band: '80m' },
  { min: 5.3, max: 5.5, band: '60m' },
  { min: 7, max: 7.5, band: '40m' },
  { min: 10, max: 10.5, band: '30m' },
  { min: 14, max: 14.5, band: '20m' },
  { min: 18, max: 18.5, band: '17m' },
  { min: 21, max: 21.5, band: '15m' },
  { min: 24, max: 25, band: '12m' },
  { min: 26, max: 28, band: '11m' },
  { min: 28, max: 30, band: '10m' },
  { min: 50, max: 54, band: '6m' },
  { min: 144, max: 148, band: '2m' },
  { min: 420, max: 450, band: '70cm' },
];

const DEFAULT_FALLBACK_COLOR = '#4488ff';
const HEX6_PATTERN = /^#[0-9a-fA-F]{6}$/;

const normalizeBand = (band) => {
  if (!band) return '';
  const raw = String(band).trim().toLowerCase();
  if (!raw) return '';
  if (raw.endsWith('m')) return raw;
  if (raw.endsWith('cm')) return raw;
  if (/^\d+(\.\d+)?$/.test(raw)) return `${raw}m`;
  return raw;
};

const normalizeHex = (value) => {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return HEX6_PATTERN.test(v) ? v.toLowerCase() : null;
};

const emitBandColorChange = (detail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BAND_COLORS_CHANGE_EVENT, { detail }));
};

export const getBandTextColor = (bgColor) => {
  const hex = normalizeHex(bgColor);
  if (!hex) return '#000000';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness >= 150 ? '#000000' : '#ffffff';
};

export const loadBandColorOverrides = () => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BAND_COLOR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const out = {};
    for (const [band, color] of Object.entries(parsed)) {
      const normalizedBand = normalizeBand(band);
      const normalizedColor = normalizeHex(color);
      if (DEFAULT_BAND_COLORS[normalizedBand] && normalizedColor) {
        out[normalizedBand] = normalizedColor;
      }
    }
    return out;
  } catch {
    return {};
  }
};

export const saveBandColorOverrides = (overrides) => {
  if (typeof localStorage === 'undefined') return;
  const safe = {};
  if (overrides && typeof overrides === 'object') {
    for (const [band, color] of Object.entries(overrides)) {
      const normalizedBand = normalizeBand(band);
      const normalizedColor = normalizeHex(color);
      if (DEFAULT_BAND_COLORS[normalizedBand] && normalizedColor) {
        safe[normalizedBand] = normalizedColor;
      }
    }
  }
  if (Object.keys(safe).length === 0) {
    localStorage.removeItem(BAND_COLOR_STORAGE_KEY);
  } else {
    localStorage.setItem(BAND_COLOR_STORAGE_KEY, JSON.stringify(safe));
  }
  emitBandColorChange(safe);
};

export const getEffectiveBandColors = (overrides) => ({
  ...DEFAULT_BAND_COLORS,
  ...(overrides || loadBandColorOverrides()),
});

export const getBandColorForBand = (band, palette) => {
  const key = normalizeBand(band);
  const colors = palette || getEffectiveBandColors();
  return colors[key] || DEFAULT_FALLBACK_COLOR;
};

export const getBandColorForFreq = (freqMHz, palette) => {
  const raw = parseFloat(freqMHz);
  if (Number.isNaN(raw)) return DEFAULT_FALLBACK_COLOR;

  // Accept MHz, kHz, or Hz input transparently.
  let f = raw;
  if (f >= 1000000) {
    f = f / 1000000;
  } else if (f >= 1000) {
    f = f / 1000;
  }

  for (const range of BAND_RANGES_MHZ) {
    if (f >= range.min && f < range.max) {
      return getBandColorForBand(range.band, palette);
    }
  }
  return DEFAULT_FALLBACK_COLOR;
};
