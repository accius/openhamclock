/**
 * Grid locator (Maidenhead) and frequency/band utilities.
 * Consolidates duplicate grid conversion functions that were scattered across server.js.
 */

/**
 * Convert Maidenhead grid locator to lat/lon.
 * Supports 4-char and 6-char grids. Case-insensitive.
 * @param {string} grid - Grid locator (e.g., 'DM79' or 'DM79lv')
 * @returns {{ lat: number, lon: number } | null}
 */
function gridToLatLon(grid) {
  if (!grid) return null;
  const g = String(grid).trim().toUpperCase();
  if (g.length < 4) return null;

  const A = 'A'.charCodeAt(0);

  const lonField = g.charCodeAt(0) - A;
  const latField = g.charCodeAt(1) - A;
  const lonSquare = parseInt(g[2], 10);
  const latSquare = parseInt(g[3], 10);
  if (!Number.isFinite(lonSquare) || !Number.isFinite(latSquare)) return null;

  let lon = -180 + lonField * 20 + lonSquare * 2;
  let lat = -90 + latField * 10 + latSquare * 1;

  if (g.length >= 6) {
    const lonSub = g.charCodeAt(4) - A;
    const latSub = g.charCodeAt(5) - A;
    lon += lonSub * (2 / 24);
    lat += latSub * (1 / 24);
    lon += 1 / 24;
    lat += 0.5 / 24;
  } else {
    lon += 1.0;
    lat += 0.5;
  }

  return { lat, lon };
}

/**
 * Convert lat/lon to Maidenhead grid locator (6-character).
 */
function latLonToGrid(lat, lon) {
  if (!isFinite(lat) || !isFinite(lon)) return null;

  let adjLon = lon + 180;
  let adjLat = lat + 90;

  const field1 = String.fromCharCode(65 + Math.floor(adjLon / 20));
  const field2 = String.fromCharCode(65 + Math.floor(adjLat / 10));
  const square1 = Math.floor((adjLon % 20) / 2);
  const square2 = Math.floor((adjLat % 10) / 1);
  const subsq1 = String.fromCharCode(65 + Math.floor(((adjLon % 2) * 60) / 5));
  const subsq2 = String.fromCharCode(65 + Math.floor(((adjLat % 1) * 60) / 2.5));

  return `${field1}${field2}${square1}${square2}${subsq1}${subsq2}`.toUpperCase();
}

/**
 * Get amateur radio band name from frequency in Hz.
 */
function getBandFromHz(freqHz) {
  const freq = freqHz / 1000000;
  if (freq >= 1.8 && freq <= 2) return '160m';
  if (freq >= 3.5 && freq <= 4) return '80m';
  if (freq >= 5.3 && freq <= 5.4) return '60m';
  if (freq >= 7 && freq <= 7.3) return '40m';
  if (freq >= 10.1 && freq <= 10.15) return '30m';
  if (freq >= 14 && freq <= 14.35) return '20m';
  if (freq >= 18.068 && freq <= 18.168) return '17m';
  if (freq >= 21 && freq <= 21.45) return '15m';
  if (freq >= 24.89 && freq <= 24.99) return '12m';
  if (freq >= 28 && freq <= 29.7) return '10m';
  if (freq >= 40 && freq <= 42) return '8m';
  if (freq >= 50 && freq <= 54) return '6m';
  if (freq >= 70 && freq <= 70.5) return '4m';
  if (freq >= 144 && freq <= 148) return '2m';
  if (freq >= 420 && freq <= 450) return '70cm';
  return 'Unknown';
}

/**
 * Get amateur radio band name from frequency in kHz.
 */
function getBandFromKHz(freqKHz) {
  return getBandFromHz(freqKHz * 1000);
}

/**
 * Calculate great-circle distance using Haversine formula.
 * @returns {number} Distance in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { gridToLatLon, latLonToGrid, getBandFromHz, getBandFromKHz, haversineDistance };
