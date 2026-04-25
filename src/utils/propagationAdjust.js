// Mirror of the signal-margin / status helpers in
// server/utils/propagationPhysics.js, kept pure + ESM so the browser engine
// (src/services/p533/engineBrowser.js) can apply the same post-processing
// the REST endpoint does. Server-side and browser-side results have to line
// up cell-for-cell — the unit tests in propagationAdjust.test.js pin both
// engines to the same golden values. If you touch one file, touch both.

export const MODE_ADVANTAGE_DB = {
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

export const ANTENNA_PROFILES = {
  isotropic: { name: 'Isotropic', gain: 0 },
  dipole: { name: 'Dipole', gain: 2.15 },
  'vert-qw': { name: 'Vertical 1/4λ', gain: 1.5 },
  'vert-5/8': { name: 'Vertical 5/8λ', gain: 3.2 },
  invv: { name: 'Inverted V', gain: 1.8 },
  ocfd: { name: 'OCFD / Windom', gain: 2.5 },
  efhw: { name: 'EFHW', gain: 2.0 },
  g5rv: { name: 'G5RV', gain: 2.0 },
  yagi2: { name: 'Yagi 2-el', gain: 5.5 },
  yagi3: { name: 'Yagi 3-el', gain: 8.0 },
  yagi5: { name: 'Yagi 5-el', gain: 10.5 },
  hexbeam: { name: 'Hex Beam', gain: 5.0 },
  cobweb: { name: 'Cobweb', gain: 4.0 },
  loop: { name: 'Magnetic Loop', gain: -1.0 },
  longwire: { name: 'Long Wire / Random', gain: 0.5 },
};

export function calculateSignalMargin(mode, powerWatts, antGain) {
  const modeAdv = MODE_ADVANTAGE_DB[mode] || 0;
  const power = Math.max(0.01, powerWatts || 100);
  const powerOffset = 10 * Math.log10(power / 100);
  return modeAdv + powerOffset + (antGain || 0);
}

export function adjustReliability(baseRel, signalMarginDb) {
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

export function calculateSNR(reliability) {
  if (reliability >= 80) return '+20dB';
  if (reliability >= 60) return '+10dB';
  if (reliability >= 40) return '0dB';
  if (reliability >= 20) return '-10dB';
  return '-20dB';
}

export function getStatus(reliability) {
  if (reliability >= 70) return 'EXCELLENT';
  if (reliability >= 50) return 'GOOD';
  if (reliability >= 30) return 'FAIR';
  if (reliability >= 15) return 'POOR';
  return 'CLOSED';
}
