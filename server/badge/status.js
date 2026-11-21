/**
 * Ham-radio status scales for the solar badge.
 *
 * Indicator colors are semantic (green / yellow / red) on every theme.
 * The theme only paints the background, wordmark, and frame.
 *
 * Thresholds:
 *   SFI   <70 poor, 70–90 fair, 90–120 good, >120 excellent
 *   SSN   <50 poor, 50–99 fair, 100–149 good, ≥150 excellent
 *   Kp/K  <3 quiet, 3–<5 unsettled, ≥5 storm with NOAA G-scale (G1 at 5 … G5 at 9)
 *   A     <8 quiet, 8–15 unsettled, 16–29 active, ≥30 storm
 *   X-ray A/B quiet, C active, M minor, X major
 */

const { relativeLuminance } = require('./color');

const SEMANTIC = {
  poor: '#e23b3b',
  fair: '#f08a24',
  good: '#c6d63a',
  excellent: '#2fbf6a',
  quiet: '#2fbf6a',
  unsettled: '#f0c014',
  active: '#f08a24',
  storm: '#e23b3b',
};

const BAND_COLORS = {
  GOOD: '#2fbf6a',
  FAIR: '#f0c014',
  POOR: '#e23b3b',
};

function status(tone, label) {
  return { tone, label, color: SEMANTIC[tone] || SEMANTIC.fair };
}

function rateSfi(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 70) return status('poor', 'Poor');
  if (value < 90) return status('fair', 'Fair');
  if (value <= 120) return status('good', 'Good');
  return status('excellent', 'Excellent');
}

function rateSsn(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 50) return status('poor', 'Poor');
  if (value < 100) return status('fair', 'Fair');
  if (value < 150) return status('good', 'Good');
  return status('excellent', 'Excellent');
}

/** NOAA G-scale: Kp 5 → G1, Kp 6 → G2, … Kp ≥9 → G5. */
function gScale(value) {
  if (value == null || !Number.isFinite(value) || value < 5) return null;
  return `G${Math.min(5, Math.max(1, Math.floor(value) - 4))}`;
}

function rateKp(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 3) return status('quiet', 'Quiet');
  if (value < 5) return status('unsettled', 'Unsettled');
  return status('storm', `Storm ${gScale(value)}`);
}

function rateA(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 8) return status('quiet', 'Quiet');
  if (value < 16) return status('unsettled', 'Unsettled');
  if (value < 30) return status('active', 'Active');
  return status('storm', 'Storm');
}

function rateXrayLetter(letter) {
  const L = String(letter || '').toUpperCase();
  if (L === 'A' || L === 'B') return status('quiet', 'Quiet');
  if (L === 'C') return status('unsettled', 'Active');
  if (L === 'M') return status('active', 'Minor');
  if (L === 'X') return status('storm', 'Major');
  return null;
}

/** GOES 0.1–0.8 nm flux (W/m²) → "C2.1". */
function xrayFromFlux(flux) {
  if (!Number.isFinite(flux) || flux <= 0) return null;
  let letter = 'A';
  let scale = 1e-8;
  if (flux >= 1e-4) {
    letter = 'X';
    scale = 1e-4;
  } else if (flux >= 1e-5) {
    letter = 'M';
    scale = 1e-5;
  } else if (flux >= 1e-6) {
    letter = 'C';
    scale = 1e-6;
  } else if (flux >= 1e-7) {
    letter = 'B';
    scale = 1e-7;
  }
  const mag = flux / scale;
  const magText = mag >= 10 ? String(Math.round(mag)) : (Math.round(mag * 10) / 10).toFixed(1);
  return { letter, text: letter + magText, status: rateXrayLetter(letter) };
}

/** N0NBH class string, e.g. "B7.3" or "C1.2". */
function parseXrayText(text) {
  const m = String(text || '')
    .trim()
    .match(/^([ABCMX])\s*([0-9]*\.?[0-9]*)/i);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const mag = m[2] ? m[2] : '';
  return { letter, text: letter + mag, status: rateXrayLetter(letter) };
}

function bandColor(condition) {
  return BAND_COLORS[condition] || null;
}

/** Ink that stays readable on a semantic chip. */
function inkOn(fill) {
  const lum = relativeLuminance(fill);
  return lum != null && lum > 0.45 ? '#1a1206' : '#ffffff';
}

/** Which bucket a value falls in, for a 4-segment meter. */
function sfiBucket(value) {
  if (value < 70) return 0;
  if (value < 90) return 1;
  if (value <= 120) return 2;
  return 3;
}

function ssnBucket(value) {
  if (value < 50) return 0;
  if (value < 100) return 1;
  if (value < 150) return 2;
  return 3;
}

function aBucket(value) {
  if (value < 8) return 0;
  if (value < 16) return 1;
  if (value < 30) return 2;
  return 3;
}

function xrayBucket(letter) {
  const L = String(letter || '').toUpperCase();
  if (L === 'A' || L === 'B') return 0;
  if (L === 'C') return 1;
  if (L === 'M') return 2;
  if (L === 'X') return 3;
  return 0;
}

const SEGMENT_COLORS = [SEMANTIC.poor, SEMANTIC.fair, SEMANTIC.good, SEMANTIC.excellent];
const A_SEGMENT_COLORS = [SEMANTIC.quiet, SEMANTIC.unsettled, SEMANTIC.active, SEMANTIC.storm];
const XRAY_SEGMENT_COLORS = [SEMANTIC.quiet, SEMANTIC.unsettled, SEMANTIC.active, SEMANTIC.storm];

function segments(bucket, colors) {
  return colors.map((color, i) => ({ color, filled: i <= bucket }));
}

module.exports = {
  SEMANTIC,
  BAND_COLORS,
  rateSfi,
  rateSsn,
  rateKp,
  rateA,
  rateXrayLetter,
  gScale,
  xrayFromFlux,
  parseXrayText,
  bandColor,
  inkOn,
  sfiBucket,
  ssnBucket,
  aBucket,
  xrayBucket,
  segments,
  SEGMENT_COLORS,
  A_SEGMENT_COLORS,
  XRAY_SEGMENT_COLORS,
};
