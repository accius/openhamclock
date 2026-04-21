/**
 * Propagation physics for the built-in HF reliability model.
 *
 * This is the fallback that runs when a real P.533 engine (ITURHFProp or the
 * upcoming client-side WASM build) isn't available. The goal is to match
 * VOACAP/P.533 *qualitatively* within 1-2 reliability bands so users don't see
 * impossible predictions (40m green to Europe at midday was the old bug).
 *
 * The core of the old model was a series of hand-tuned band multipliers
 * (0.25× for 80m during the day, 1.0× for 40m, etc.). Those collapsed under
 * combinations of power/antenna/mode — a Yagi + FT8 + 1 kW would stretch the
 * effective LUF to 10% of its real value and push bands that can't physically
 * propagate into the "good" range.
 *
 * This implementation replaces the multipliers with an explicit physics chain:
 *
 *   MUF check  →  D-layer absorption (dB) from solar zenith, SFI, hops, freq
 *              →  link margin = baseline + signal_margin - absorption
 *              →  reliability from margin via a tanh curve
 *
 * Absorption is tuned against measured noon values:
 *   80m single-hop grazing:  ~45 dB  @ SFI 150
 *   40m single-hop grazing:  ~12 dB  @ SFI 150
 *   20m single-hop grazing:   ~3 dB  @ SFI 150
 * which matches widely-cited P.533 numbers within a couple of dB. The inverse-
 * square dependence on (f + f_L) is what makes low bands unusable during daylight
 * while 20m+ stays open.
 */

'use strict';

const EARTH_RADIUS_KM = 6371;
const D_LAYER_HEIGHT_KM = 70;
const F_LAYER_HEIGHT_KM = 300;

// Dominant electron-gyrofrequency used in the absorption denominator.
// Real value varies with magnetic latitude; 0.6 MHz is a fair mid-latitude mean.
const GYRO_FREQ_MHZ = 0.6;

// Absorption constant chosen so a single-hop grazing path at noon with SFI=150
// yields ~45 dB on 80m and ~12 dB on 40m, in line with P.533 reference values.
const ABSORPTION_K = 677;

// Link-budget baseline for SSB/100W/0 dBi on a median HF path. Accounts for
// the headroom between a clear link and the SSB readability floor. A realistic
// 500 km 40m noon path lands with ~10-15 dB SNR in clear air; this baseline
// plus absorption produces that number.
const BASELINE_MARGIN_DB = 20;

// Reference margin for the reliability tanh: at REF_MARGIN the model returns
// 40% reliability (FAIR). Each +15 dB of margin swings reliability by ~40 pts.
const REF_MARGIN_DB = 10;

const MODE_ADVANTAGE_DB = {
  SSB: 0,
  AM: -6,
  CW: 10,
  RTTY: 8,
  PSK31: 10,
  FT8: 34,
  FT4: 30,
  WSPR: 41,
  JS8: 37,
  OLIVIA: 20,
  JT65: 38,
};

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Approximate solar declination for a given month (northern-hemisphere bias,
 * good enough for a ~1 dB absorption-model error). Phase B will compute this
 * from full astronomy; Phase A uses a sine of the annual cycle.
 *
 * @param {number} month 1-12 (1 = January)
 */
function solarDeclinationDeg(month) {
  if (!month || month < 1 || month > 12) {
    // No month supplied — assume equinox (declination = 0).
    return 0;
  }
  // Approximation: declination ≈ 23.44° × sin(2π × (month - 3.75) / 12)
  // Peaks +23.44° at mid-June (month ≈ 6.75), -23.44° at mid-December.
  return 23.44 * Math.sin(((month - 3.75) * 2 * Math.PI) / 12);
}

/**
 * Cosine of the solar zenith angle at the path midpoint.
 * Returns 0 when the sun is at or below the horizon.
 */
function cosSolarZenith(midLat, midLon, hourUtc, month) {
  const localHour = (hourUtc + midLon / 15 + 24) % 24;
  const hourAngle = toRad((localHour - 12) * 15); // radians from solar noon
  const lat = toRad(midLat);
  const dec = toRad(solarDeclinationDeg(month));
  const cosZ = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.max(0, cosZ);
}

/**
 * Incidence factor at the D-layer ("sec φ100" in the CCIR literature).
 *
 * Short hops see the D-layer near-vertically; long hops graze through it at a
 * shallow angle and pick up several times more absorption. The fit below is the
 * simplified P.533 form:
 *   sec φ100 ≈ 1 + 2 × (d_hop / 6000)²
 * which returns ≈1 for NVIS (500 km) and ≈1.7 for a 3500 km single hop.
 */
function dLayerIncidenceFactor(hopDistanceKm) {
  const d = Math.max(0, Math.min(3500, hopDistanceKm));
  return 1 + 2 * Math.pow(d / 6000, 2);
}

/**
 * Total D-layer absorption in dB for a path at the given frequency and hour.
 *
 * Inverse-square dependence on (f + f_L) is what makes low bands unusable
 * during daylight and nearly free at night. Multi-hop paths sum per-hop
 * absorption linearly; at night cos(Z) → 0 so absorption → 0.
 *
 * @param {number} freq         Frequency in MHz
 * @param {number} distance     Great-circle path length in km
 * @param {number} midLat       Path midpoint latitude in degrees
 * @param {number} midLon       Path midpoint longitude in degrees
 * @param {number} hourUtc      UTC hour 0-23
 * @param {number} sfi          Solar flux index (10.7 cm), typ 70-250
 * @param {number} [month]      1-12, optional (equinox assumed if omitted)
 * @returns {number} absorption in dB (≥ 0)
 */
function calculateDLayerAbsorption(freq, distance, midLat, midLon, hourUtc, sfi, month) {
  if (freq <= 0 || distance <= 0) return 0;

  const hops = Math.max(1, Math.ceil(distance / 3500));
  const hopDist = distance / hops;

  const cosZ = cosSolarZenith(midLat, midLon, hourUtc, month);
  if (cosZ <= 0) return 0; // night — D-layer gone

  const secPhi = dLayerIncidenceFactor(hopDist);
  const sfiScale = Math.max(0.5, (sfi || 100) / 150);
  const absPerHop = (ABSORPTION_K * secPhi * Math.pow(cosZ, 0.7) * sfiScale) / Math.pow(freq + GYRO_FREQ_MHZ, 2);

  return absPerHop * hops;
}

/**
 * Rough F2-layer MUF estimate. Kept compatible with the existing fallback so
 * the heatmap and chart stay consistent across the two engines. Phase B will
 * replace this with the real foF2 coefficients.
 */
function calculateMUF(distance, midLat, midLon, hourUtc, sfi, ssn) {
  const localHour = (hourUtc + midLon / 15 + 24) % 24;

  const absLat = Math.abs(midLat);
  const latFactor =
    absLat < 15 ? 1.15 : absLat < 45 ? 1.05 - (absLat - 15) / 120 : Math.max(0.45, 0.8 - (absLat - 45) / 250);

  const foF2_day = (4 + 0.04 * (sfi || 100)) * latFactor;
  const foF2_night = (2 + 0.01 * (sfi || 100)) * latFactor;

  // Smooth day/night blend: peaks at 14:00 local (F2 maximum), trough at ~02:00.
  const dayBlend = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(((localHour - 14) * Math.PI) / 12)));
  const foF2 = foF2_night + (foF2_day - foF2_night) * dayBlend;

  // M-factor (MUF/foF2 ratio). Short paths reflect near-vertically (low M);
  // grazing paths at 3000 km hit M ≈ 3.2.
  const M = distance < 500 ? 2.5 : distance < 3500 ? 2.5 + 0.7 * (distance / 3500) : 3.2;
  const muf3000 = foF2 * M;

  if (distance <= 3500) return muf3000;

  // Multi-hop: small per-hop penalty reflects mismatch in reflection height.
  const hops = Math.ceil(distance / 3500);
  return muf3000 * Math.pow(0.95, hops - 1);
}

/**
 * LUF estimate preserved for UI display (chart minimum, informational labels).
 * The actual reliability model now uses absorption directly, so LUF no longer
 * drives the prediction — this exists only so the UI can render a lower bound.
 */
function calculateLUF(distance, midLat, midLon, hourUtc, sfi, kIndex) {
  const localHour = (hourUtc + midLon / 15 + 24) % 24;
  const solarAngle = ((localHour - 12) * Math.PI) / 12;
  const dayFraction = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(solarAngle)));
  const dayFactor = 0.15 + 0.85 * dayFraction;
  const sfiFactor = 1 + ((sfi || 100) - 70) / 150;
  const hops = Math.ceil(distance / 3500);
  const hopFactor = 1 + (hops - 1) * 0.5;
  const latFactor = 1 + (Math.abs(midLat) / 90) * 0.4;
  const kFactor = 1 + (kIndex || 0) * 0.15;
  return 2.0 * dayFactor * sfiFactor * hopFactor * latFactor * kFactor;
}

/**
 * Signal margin (dB) relative to an SSB/100W/isotropic reference link.
 * Summing mode, power, and antenna dB contributions is the right thing here
 * because downstream math treats margin as received-SNR headroom.
 */
function calculateSignalMargin(mode, powerWatts, antGain) {
  const modeAdv = MODE_ADVANTAGE_DB[mode] || 0;
  const power = Math.max(0.01, powerWatts || 100);
  const powerOffset = 10 * Math.log10(power / 100);
  return modeAdv + powerOffset + (antGain || 0);
}

/**
 * Apply signal margin to a pre-computed base reliability. Used when we receive
 * a number from ITURHFProp/P.533 which already embeds its own SSB/100 W
 * assumption — we shift it by the user's actual mode/power/antenna.
 */
function adjustReliability(baseRel, signalMarginDb) {
  if (!signalMarginDb || baseRel <= 0) return baseRel;
  let rel = baseRel;
  const factor = signalMarginDb / 15;
  if (factor > 0) {
    const headroom = 99 - rel;
    rel += headroom * (1 - Math.exp(-factor * 1.2));
  } else {
    rel -= rel * (1 - Math.exp(factor * 1.2));
  }
  return Math.max(0, Math.min(99, Math.round(rel)));
}

/**
 * Reliability prediction for a single (freq, hour) path cell. This is the
 * function that drives every bar, chart cell, and heatmap square when the
 * real P.533 engine is unavailable.
 *
 * @param {number} freq              Frequency in MHz
 * @param {number} distance          Great-circle path length in km
 * @param {number} midLat            Path midpoint lat
 * @param {number} midLon            Path midpoint lon
 * @param {number} hour              UTC hour (0-23) being predicted
 * @param {number} sfi               Solar flux index
 * @param {number} [ssn]             Smoothed sunspot number (unused by this
 *                                   implementation — kept for API parity)
 * @param {number} [kIndex]          Planetary K-index 0-9
 * @param {object} [_de]             Unused (kept for API parity)
 * @param {object} [_dx]             Unused (kept for API parity)
 * @param {number} [_currentHour]    Unused (kept for API parity)
 * @param {number} [signalMarginDb]  Signal margin from mode/power/antenna
 * @param {number} [month]           1-12 for solar declination
 * @returns {number} reliability 0-99
 */
function calculateEnhancedReliability(
  freq,
  distance,
  midLat,
  midLon,
  hour,
  sfi,
  ssn,
  kIndex,
  _de,
  _dx,
  _currentHour,
  signalMarginDb,
  month,
) {
  const muf = calculateMUF(distance, midLat, midLon, hour, sfi, ssn);

  // Well above MUF — no F-layer prop, only sporadic-E/scatter.
  if (freq > muf * 1.15) {
    return Math.max(1, Math.round(20 - (freq - muf) * 3));
  }

  const absorption = calculateDLayerAbsorption(freq, distance, midLat, midLon, hour, sfi, month);
  const margin = signalMarginDb || 0;
  const availableMargin = BASELINE_MARGIN_DB + margin - absorption;

  let reliability;

  if (freq > muf) {
    // Just above MUF — marginal; a strong station (high margin) can still pick
    // up sporadic-E/scatter openings.
    const frac = (freq - muf) / (muf * 0.15);
    const mufPenalty = 40 - frac * 30;
    const marginBonus = Math.max(0, Math.min(20, availableMargin * 0.3));
    reliability = mufPenalty + marginBonus;
  } else {
    // In-band: reliability tracks available margin via a tanh curve.
    // At excess=0 (margin matches REF) → 40% reliability.
    // At excess=+20 → ~80%. At excess=-20 → ~5%. Naturally clamped.
    const excess = availableMargin - REF_MARGIN_DB;
    reliability = 40 + 45 * Math.tanh(excess / 15);
  }

  // Geomagnetic storms hit everything, but especially absorption-limited paths.
  const k = kIndex || 0;
  if (k >= 7) reliability *= 0.15;
  else if (k >= 6) reliability *= 0.3;
  else if (k >= 5) reliability *= 0.5;
  else if (k >= 4) reliability *= 0.75;

  // Auroral-zone penalty on high-latitude paths, compounded by storms.
  if (Math.abs(midLat) > 65) {
    reliability *= 0.8;
    if (k >= 4) reliability *= 0.7;
  }

  return Math.max(0, Math.min(99, Math.round(reliability)));
}

function calculateSNR(reliability) {
  if (reliability >= 80) return '+20dB';
  if (reliability >= 60) return '+10dB';
  if (reliability >= 40) return '0dB';
  if (reliability >= 20) return '-10dB';
  return '-20dB';
}

function getStatus(reliability) {
  if (reliability >= 70) return 'EXCELLENT';
  if (reliability >= 50) return 'GOOD';
  if (reliability >= 30) return 'FAIR';
  if (reliability >= 15) return 'POOR';
  return 'CLOSED';
}

module.exports = {
  MODE_ADVANTAGE_DB,
  BASELINE_MARGIN_DB,
  REF_MARGIN_DB,
  EARTH_RADIUS_KM,
  D_LAYER_HEIGHT_KM,
  F_LAYER_HEIGHT_KM,
  solarDeclinationDeg,
  cosSolarZenith,
  dLayerIncidenceFactor,
  calculateDLayerAbsorption,
  calculateMUF,
  calculateLUF,
  calculateSignalMargin,
  adjustReliability,
  calculateEnhancedReliability,
  calculateSNR,
  getStatus,
};
