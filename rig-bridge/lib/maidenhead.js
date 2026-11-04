'use strict';
/**
 * maidenhead.js — lat/lon → Maidenhead grid locator (CommonJS twin of
 * src/utils/geo.js latLonToMaidenhead, used by the GPS plugin).
 *
 * @param {number} lat  decimal degrees, -90..90
 * @param {number} lon  decimal degrees, -180..180
 * @param {2|4|6|8} [precision=6]
 * @returns {string|null} e.g. 'DN70la', or null for invalid input
 */
function latLonToGrid(lat, lon, precision = 6) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  const latNorm = Math.min(lat + 90, 179.999999);
  const lonNorm = (((lon + 180) % 360) + 360) % 360;

  const field1 = String.fromCharCode(65 + Math.floor(lonNorm / 20));
  const field2 = String.fromCharCode(65 + Math.floor(latNorm / 10));
  if (precision === 2) return `${field1}${field2}`;

  const square1 = Math.floor((lonNorm % 20) / 2);
  const square2 = Math.floor(latNorm % 10);
  if (precision === 4) return `${field1}${field2}${square1}${square2}`;

  const subsq1 = String.fromCharCode(97 + Math.floor(((lonNorm % 2) * 60) / 5));
  const subsq2 = String.fromCharCode(97 + Math.floor(((latNorm % 1) * 60) / 2.5));
  if (precision === 6) return `${field1}${field2}${square1}${square2}${subsq1}${subsq2}`;

  if (precision === 8) {
    const ext1 = Math.floor((((lonNorm % 2) * 60) % 5) / 0.5);
    const ext2 = Math.floor((((latNorm % 1) * 60) % 2.5) / 0.25);
    return `${field1}${field2}${square1}${square2}${subsq1}${subsq2}${ext1}${ext2}`;
  }
  return null;
}

module.exports = { latLonToGrid };
