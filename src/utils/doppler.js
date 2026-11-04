/**
 * Doppler tuning math for satellite work.
 *
 * Pure functions only — no rig, no timers. Range rate follows the convention
 * used by useSatellites / satRelay: km/s, positive when the satellite is
 * receding, negative when approaching. satellite.js's dopplerFactor is
 * (1 - rangeRate / c), so a downlink is received at nominal × factor and an
 * uplink must be transmitted at nominal ÷ factor to arrive on frequency.
 *
 * Transmitter records are the SatNOGS-derived shape the server emits in
 * `transmitters` / `relayTransmitters`:
 *   { mode, type, description, downlinkLowHz, downlinkHighHz,
 *     uplinkLowHz, uplinkHighHz, invert, uuid }
 */

export const C_KM_S = 299792.458;
export const DEFAULT_DOPPLER_STEP_HZ = 20;
export const MIN_DOPPLER_STEP_HZ = 1;
export const MAX_DOPPLER_STEP_HZ = 1000;

/** Doppler factor (1 - v/c) from a range rate in km/s. */
export function dopplerFactorFromRangeRate(rangeRateKmS) {
  const rr = Number(rangeRateKmS);
  if (!Number.isFinite(rr)) return 1;
  return 1 - rr / C_KM_S;
}

/** Frequency we hear a satellite downlink on, given its nominal frequency. */
export function correctedDownlinkHz(nominalHz, rangeRateKmS) {
  const f = Number(nominalHz);
  if (!Number.isFinite(f) || f <= 0) return null;
  return f * dopplerFactorFromRangeRate(rangeRateKmS);
}

/** Frequency we must transmit on so the satellite hears the nominal uplink. */
export function correctedUplinkHz(nominalHz, rangeRateKmS) {
  const f = Number(nominalHz);
  if (!Number.isFinite(f) || f <= 0) return null;
  const k = dopplerFactorFromRangeRate(rangeRateKmS);
  return k > 0 ? f / k : null;
}

/** Signed Doppler shift in Hz for a downlink at `nominalHz`. */
export function dopplerShiftHz(nominalHz, rangeRateKmS) {
  const corrected = correctedDownlinkHz(nominalHz, rangeRateKmS);
  return corrected == null ? null : corrected - Number(nominalHz);
}

/** Clamp the retune threshold to a sane range; non-numeric → default. */
export function clampDopplerStep(hz) {
  const n = Number(hz);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DOPPLER_STEP_HZ;
  return Math.min(MAX_DOPPLER_STEP_HZ, Math.max(MIN_DOPPLER_STEP_HZ, n));
}

/**
 * Should a new frequency be sent to the rig? True when nothing has been sent
 * yet, or when the change exceeds the threshold.
 */
export function shouldRetune(lastSentHz, nextHz, stepHz = DEFAULT_DOPPLER_STEP_HZ) {
  if (!Number.isFinite(nextHz)) return false;
  if (!Number.isFinite(lastSentHz)) return true;
  return Math.abs(nextHz - lastSentHz) >= clampDopplerStep(stepHz);
}

/** True for linear/inverting transponders with a passband on both links. */
export function isLinearTransponder(tx) {
  if (!tx) return false;
  const dl = Number(tx.downlinkLowHz);
  const dh = Number(tx.downlinkHighHz);
  const ul = Number(tx.uplinkLowHz);
  const uh = Number(tx.uplinkHighHz);
  return dl > 0 && dh > 0 && dh !== dl && ul > 0 && uh > 0 && uh !== ul;
}

/**
 * Nominal uplink/downlink pair for a transmitter. For a linear transponder
 * the caller may pick any downlink inside the passband (default: centre);
 * the matching uplink is derived, honouring inverting transponders.
 * @returns {{downlinkHz:number|null, uplinkHz:number|null}}
 */
export function nominalPair(tx, downlinkHz = null) {
  if (!tx) return { downlinkHz: null, uplinkHz: null };
  const dl = Number(tx.downlinkLowHz) || null;
  const dh = Number(tx.downlinkHighHz) || dl;
  const ul = Number(tx.uplinkLowHz) || null;
  const uh = Number(tx.uplinkHighHz) || ul;

  if (!isLinearTransponder(tx)) {
    return { downlinkHz: dl, uplinkHz: ul };
  }

  const lo = Math.min(dl, dh);
  const hi = Math.max(dl, dh);
  let down = Number(downlinkHz);
  if (!Number.isFinite(down) || down < lo || down > hi) down = (lo + hi) / 2;
  const offset = down - lo;
  const ulo = Math.min(ul, uh);
  const uhi = Math.max(ul, uh);
  const up = tx.invert ? uhi - offset : ulo + offset;
  return { downlinkHz: down, uplinkHz: Math.min(uhi, Math.max(ulo, up)) };
}

/**
 * Map a SatNOGS mode string onto the modes rig-bridge understands.
 * Returns null when there is no sensible rig mode (digital telemetry etc.),
 * in which case the caller should leave the rig's mode alone.
 */
export function rigModeForTransmitter(tx) {
  const m = String(tx?.mode || '')
    .trim()
    .toUpperCase();
  if (!m) return null;
  if (m.includes('LINEAR')) return 'USB';
  if (m.startsWith('USB') || m === 'SSB') return 'USB';
  if (m.startsWith('LSB')) return 'LSB';
  if (m.startsWith('CW')) return 'CW';
  if (m.startsWith('FM') || m.includes('AFSK') || m.includes('DUV') || m.includes('SSTV') || m.includes('APRS'))
    return 'FM';
  return null;
}

/** Stable identifier for a transmitter so the pick can be remembered per satellite. */
export function transmitterKey(tx, index = 0) {
  if (!tx) return String(index);
  return String(tx.uuid || `${tx.description || tx.mode || 'tx'}|${tx.downlinkLowHz || ''}|${tx.uplinkLowHz || ''}`);
}

/** Human label for the dropdown: "V/U FM · 145.960 ↓ 435.350 ↑". */
export function transmitterLabel(tx) {
  if (!tx) return '';
  const mhz = (hz) => (Number(hz) > 0 ? (Number(hz) / 1e6).toFixed(3) : null);
  const parts = [];
  const desc = String(tx.description || '').trim();
  const mode = String(tx.mode || tx.type || '').trim();
  parts.push(desc && desc.length <= 28 ? desc : mode || 'TX');
  const dl = mhz(tx.downlinkLowHz);
  const ul = mhz(tx.uplinkLowHz);
  if (dl) parts.push(`${dl}↓`);
  if (ul) parts.push(`${ul}↑`);
  return parts.join(' ');
}

/**
 * Choose a transmitter by remembered key, falling back to the first entry
 * (the server already sorts by usefulness: transponders first).
 */
export function pickTransmitter(transmitters, rememberedKey = null) {
  const list = Array.isArray(transmitters) ? transmitters : [];
  if (list.length === 0) return null;
  if (rememberedKey) {
    const idx = list.findIndex((tx, i) => transmitterKey(tx, i) === rememberedKey);
    if (idx >= 0) return list[idx];
  }
  return list[0];
}

/**
 * Everything the UI shows and the tuner sends for one tick.
 * @param {object} tx transmitter record
 * @param {number} rangeRateKmS
 * @param {number|null} downlinkHz chosen downlink inside a linear passband
 */
export function computeDopplerState(tx, rangeRateKmS, downlinkHz = null) {
  const { downlinkHz: dNom, uplinkHz: uNom } = nominalPair(tx, downlinkHz);
  const down = dNom ? correctedDownlinkHz(dNom, rangeRateKmS) : null;
  const up = uNom ? correctedUplinkHz(uNom, rangeRateKmS) : null;
  return {
    downlinkNominalHz: dNom,
    downlinkCorrectedHz: down == null ? null : Math.round(down),
    downlinkShiftHz: down == null ? null : Math.round(down - dNom),
    uplinkNominalHz: uNom,
    uplinkCorrectedHz: up == null ? null : Math.round(up),
    uplinkShiftHz: up == null ? null : Math.round(up - uNom),
    mode: rigModeForTransmitter(tx),
    rangeRateKmS: Number.isFinite(Number(rangeRateKmS)) ? Number(rangeRateKmS) : 0,
  };
}

/** "145.960.000" style readout used by the panels. */
export function formatHz(hz) {
  const n = Number(hz);
  if (!Number.isFinite(n) || n <= 0) return '---.---.---';
  const s = String(Math.round(n)).padStart(9, '0');
  return `${s.slice(0, -6)}.${s.slice(-6, -3)}.${s.slice(-3)}`;
}

export default {
  correctedDownlinkHz,
  correctedUplinkHz,
  dopplerShiftHz,
  shouldRetune,
  nominalPair,
  rigModeForTransmitter,
  pickTransmitter,
  computeDopplerState,
  formatHz,
};
