const { find } = require('geo-tz/all');

/**
 * Get IANA timezone for a lat/lon coordinate.
 * Returns a single timezone string (e.g., "America/New_York") or null.
 * Falls back to "Etc/UTC" for ocean coordinates.
 */
function getTimezoneForLocation(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try {
    const timezones = find(lat, lon);
    if (!timezones || timezones.length === 0) {
      // Ocean or unclaimed territory — default to UTC
      return 'Etc/UTC';
    }

    // Prefer the first non-Etc/GMT* result (Etc/GMT appears at sea or terra nullius)
    const preferred = timezones.find((tz) => !tz.startsWith('Etc/GMT'));
    return preferred ?? timezones[0];
  } catch (err) {
    console.error(`[geoTz] Failed to lookup timezone for ${lat}, ${lon}:`, err.message);
    return null;
  }
}

module.exports = { getTimezoneForLocation };
