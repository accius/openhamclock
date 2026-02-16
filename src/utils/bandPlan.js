import bandPlan from "./bandplan.json";

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
  if (!hz) return "USB"; // Default safe fallback

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
  if (mhz < 10) return "LSB";
  return "USB";
};

/**
 * Get the base sideband (USB/LSB) for a given frequency
 * @param {number} hz - Frequency in Hz
 * @returns {string} - 'USB' or 'LSB'
 */
export const getSideband = (hz) => {
  if (!hz) return "USB";
  const mhz = hz / 1000000;

  // Check for 60m exception (always USB)
  if (mhz >= 5.3 && mhz <= 5.405) return "USB";

  // Standard rule: < 10MHz is LSB, >= 10MHz is USB
  return mhz < 10 ? "LSB" : "USB";
};

/**
 * Map a generic mode (e.g. 'FT8', 'CW') to a rig-specific mode (e.g. 'DATA-USB', 'CW-LSB')
 * based on frequency conventions.
 * @param {string} mode - The mode string (e.g. 'FT8', 'CW', 'SSB')
 * @param {number} freq - The frequency in Hz
 * @returns {string} - The mapped mode string
 */
export const mapModeToRig = (mode, freq) => {
  if (!mode) return "";
  const m = mode.toUpperCase();
  const sb = getSideband(freq);

  const suffix = sb === "USB" ? "U" : "L";

  // List of digital modes to map to sideband
  const digitalModes = [
    "FT8",
    "FT4",
    "JS8",
    "WSPR",
    "JT65",
    "JT9",
    "PSK31",
    "PSK63",
    "RTTY",
    "DATA",
    "PKT",
  ];

  // Map Digital, CW, and generic SSB to specific sideband
  if (digitalModes.includes(m) || m === "CW" || m === "SSB") {
    return sb;
  }

  // Pass through others (USB, LSB, AM, FM)
  return m;
};
