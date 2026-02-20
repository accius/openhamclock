import bandPlan from './bandplan.json';

/**
 * Band Plan Utilities
 * Determines default mode based on frequency using bandplan.json
 */

/**
 * Get recommended mode from frequency (Hz)
 * @param {number} hz - Frequency in Hz
 * @returns {string} - 'LSB', 'USB', 'CW', 'FM', 'AM'
 */
export const getModeFromFreq = (hz) => {
  if (!hz) return 'USB'; // Default safe fallback

  const khz = hz / 1000;
  const mhz = hz / 1000000;

  // Check specific ranges from JSON
  for (const range of bandPlan) {
    if (khz >= range.min && khz <= range.max) {
      return range.mode;
    }
  }

  // Generic Rules if outside specific ham bands
  // < 10 MHz -> LSB
  // >= 10 MHz -> USB
  if (mhz < 10) return 'LSB';
  return 'USB';
};

/**
 * Get the base sideband (USB/LSB) for a given frequency
 * @param {number} hz - Frequency in Hz
 * @returns {string} - 'USB' or 'LSB'
 */
export const getSideband = (hz) => {
  if (!hz) return 'USB';
  const mhz = hz / 1000000;

  // Check for 60m exception (always USB)
  if (mhz >= 5.3 && mhz <= 5.405) return 'USB';

  // Standard rule: < 10MHz is LSB, >= 10MHz is USB
  return mhz < 10 ? 'LSB' : 'USB';
};

/**
 * Map a generic mode (e.g. 'FT8', 'DATA', 'SSB') to a rig-specific mode
 * (e.g. 'DATA-USB', 'USB') based on frequency conventions.
 *
 * CW is passed through unchanged — the rig-listener protocol layer (Yaesu MD03;,
 * Kenwood MD3;, Icom 0x03) handles it correctly for all supported radios.
 *
 * @param {string} mode - The mode string (e.g. 'FT8', 'CW', 'SSB', 'DATA')
 * @param {number} freq - The frequency in Hz
 * @returns {string} - The mapped mode string
 */
export const mapModeToRig = (mode, freq) => {
  if (!mode) return '';
  const m = mode.toUpperCase();
  const sb = getSideband(freq);

  // CW: pass through as-is — rig-listener translates to MD03; (Yaesu),
  // MD3; (Kenwood/Elecraft), or CI-V 0x03 (Icom) for all supported radios.
  if (m === 'CW' || m === 'CW-R') return m;

  // FM and AM: always pass through unchanged
  if (m === 'FM' || m === 'AM' || m === 'WFM') return m;

  // Already a fully-qualified mode: USB, LSB, DATA-USB, DATA-LSB, etc.
  if (m === 'USB' || m === 'LSB') return m;
  if (m === 'DATA-USB' || m === 'DATA-LSB') return m;

  // Digital/data modes → DATA-USB or DATA-LSB based on band convention
  const digitalModes = ['DATA', 'FT8', 'FT4', 'JS8', 'WSPR', 'JT65', 'JT9', 'PSK31', 'PSK63', 'RTTY', 'PKT'];
  if (digitalModes.includes(m)) {
    return sb === 'USB' ? 'DATA-USB' : 'DATA-LSB';
  }

  // Generic SSB → resolved sideband
  if (m === 'SSB') return sb;

  // Unknown modes: pass through so the rig can decide
  return m;
};
