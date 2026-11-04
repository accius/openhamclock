/**
 * spotLabel — what text (if any) a spot marker carries on the map.
 *
 * HamClock offers "Spot labels: none / call / prefix / frequency" plus a
 * "Min label dist" below which labels are suppressed so the cloud of local
 * spots around DE does not bury the map in text. Pure helpers; the map
 * components call them per marker.
 */
import { calculateDistance } from './geo.js';
import { normalizeFrequencyToMHz } from './callsign.js';
import { wpxPrefix } from './watchlistSpec.js';

export const SPOT_LABEL_MODES = ['none', 'call', 'prefix', 'freq'];
export const DEFAULT_SPOT_LABEL_MODE = 'call';

/**
 * Label text for a spot, or null when labels are off.
 * @param {'none'|'call'|'prefix'|'freq'} mode
 * @param {{ call?: string, freq?: number|string }} spot freq in MHz, kHz or Hz
 */
export const spotLabelText = (mode, spot = {}) => {
  const call = String(spot.call || '').trim();
  switch (mode) {
    case 'none':
      return null;
    case 'prefix':
      return wpxPrefix(call) || call || null;
    case 'freq': {
      const mhz = normalizeFrequencyToMHz(spot.freq);
      return mhz != null ? mhz.toFixed(3) : call || null;
    }
    case 'call':
    default:
      return call || null;
  }
};

/**
 * Should the label be hidden because the spot is closer to DE than minKm?
 * @param {{lat:number, lon:number}|null} de
 * @param {number} lat spot latitude
 * @param {number} lon spot longitude
 * @param {number} minKm 0 (or non-finite) disables the rule
 */
export const spotLabelSuppressed = (de, lat, lon, minKm) => {
  const min = Number(minKm);
  if (!(min > 0)) return false;
  if (!de || !Number.isFinite(de.lat) || !Number.isFinite(de.lon)) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return calculateDistance(de.lat, de.lon, lat, lon) < min;
};

export default { SPOT_LABEL_MODES, spotLabelText, spotLabelSuppressed };
