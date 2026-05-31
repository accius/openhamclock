/**
 * Grid locator (Maidenhead) and frequency/band utilities.
 */

/**
 * Validate Maidenhead grid locator, can be 2, 4, 6, or 8 characters long, e.g. DM, DM12, DM12kv, or DM12kv99 are all valid locators.
 * @param gridLocator Maidenhead grid locator
 * @returns true if the grid locator is valid, else false
 */
const validateGridLocator = (gridLocator) => {
  if (!gridLocator || typeof gridLocator !== 'string') return false;
  if (gridLocator.length < 2 || gridLocator.length > 8) return false;
  if (gridLocator.length % 2 !== 0) return false;
  const regex = /^[A-R]{2}([0-9]{2}([A-Xa-x]{2}([0-9]{2})?)?)?$/;
  return regex.test(gridLocator);
};

/**
 * Convert Maidenhead grid locator to latitude/longitude coordinates
 * @param grid Maidenhead grid locator
 * @returns Latitude and longitude coordinates
 */
const maidenheadToLatLon = (grid) => {
  const bbox = maidenheadToBoundingBox(grid);
  if (!bbox || bbox.length !== 2 || bbox[0].length !== 2 || bbox[1].length !== 2) return null;
  const lat = (bbox[0][0] + bbox[1][0]) / 2;
  const lon = (bbox[0][1] + bbox[1][1]) / 2;
  return { lat, lon };
};

/**
 * Convert Maidenhead grid square to lat/lon bounding box coordinates, [SW, NE] corners
 * @param grid Maidenhead grid locator
 * @returns A two-dimensional array containing two diagonal coordinates of bounds
 */
const maidenheadToBoundingBox = (grid) => {
  if (!grid || !validateGridLocator(grid)) return null;

  const gridUpper = grid.toUpperCase();
  let minLat = -90;
  let maxLat = 90;
  let minLon = -180;
  let maxLon = 180;

  // Field (2 chars): 20° lon x 10° lat
  if (gridUpper.length >= 2) {
    const fieldLat = gridUpper.charCodeAt(1) - 65; // A-R
    const fieldLon = gridUpper.charCodeAt(0) - 65; // A-R

    minLat += fieldLat * 10;
    maxLat = minLat + 10;
    minLon += fieldLon * 20;
    maxLon = minLon + 20;
  }

  // Square (2 digits): 2° lon x 1° lat
  if (gridUpper.length >= 4) {
    const sqLon = parseInt(gridUpper[2]);
    const sqLat = parseInt(gridUpper[3]);

    minLon += sqLon * 2;
    maxLon = minLon + 2;
    minLat += sqLat * 1;
    maxLat = minLat + 1;
  }

  // Subsquare (2 chars): 5' lon x 2.5' lat
  if (gridUpper.length >= 6) {
    const subLat = gridUpper.charCodeAt(5) - 65; // A thru X
    const subLon = gridUpper.charCodeAt(4) - 65; // A thru X

    minLat += (subLat * 2.5) / 60;
    maxLat = minLat + 2.5 / 60;
    minLon += (subLon * 5) / 60;
    maxLon = minLon + 5 / 60;
  }

  // Extended square (2 digits): 0.5' lon x 0.25' lat
  if (gridUpper.length >= 8) {
    const subLat = parseInt(gridUpper[7]);
    const subLon = parseInt(gridUpper[6]);

    minLat += (subLat * 0.25) / 60;
    maxLat = minLat + 0.25 / 60;
    minLon += (subLon * 0.5) / 60;
    maxLon = minLon + 0.5 / 60;
  }

  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
};

/**
 * Convert latitude/longitude coordinates to Maidenhead grid locator of specified precision (character length)
 * @param Latitude and longitude coordinates
 * @param precision Precision (character length) of the grid locator returned, can be 2, 4, 6, or 8. (default if not specified is 6)
 * @returns Maidenhead grid locator
 */
const latLonToMaidenhead = ({ lat, lon }, precision = 6) => {
  if (lat < -90 || lat > 90) throw new Error('invalid latitude, it should be between -90 and 90');
  if (lon < -180 || lon > 180) throw new Error('invalid longitude, it should be between -180 and 180');

  const latNorm = lat + 90;

  // Handle case where longitude is given as +180, which should be treated as -180,
  // by normalizing to 0-360 range first then applying modulus again to get back to -180..180 range.
  const lonNorm = (((lon + 180) % 360) + 360) % 360;

  // Field (2 chars): 20° lon x 10° lat
  const field1 = String.fromCharCode(65 + Math.floor(lonNorm / 20)); // A-R
  const field2 = String.fromCharCode(65 + Math.floor(latNorm / 10)); // A-R

  if (precision === 2) {
    return `${field1}${field2}`;
  } else {
    // Square (2 digits): 2° lon x 1° lat
    const square1 = Math.floor((lonNorm % 20) / 2);
    const square2 = Math.floor((latNorm % 10) / 1);

    if (precision === 4) {
      return `${field1}${field2}${square1}${square2}`;
    } else {
      // Subsquare (2 chars): 5' lon x 2.5' lat
      const subsq1 = String.fromCharCode(97 + Math.floor(((lonNorm % 2) * 60) / 5)); // a-x
      const subsq2 = String.fromCharCode(97 + Math.floor(((latNorm % 1) * 60) / 2.5)); // a-x

      if (precision === 6) {
        return `${field1}${field2}${square1}${square2}${subsq1}${subsq2}`;
      } else if (precision === 8) {
        // Extended square (2 digits): 0.5' lon x 0.25' lat
        const extSq1 = Math.floor((((lonNorm % 2) * 60) % 5) / 0.5);
        const extSq2 = Math.floor((((latNorm % 1) * 60) % 2.5) / 0.25);

        return `${field1}${field2}${square1}${square2}${subsq1}${subsq2}${extSq1}${extSq2}`;
      } else return null; // Invalid precision
    }
  }
};

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

module.exports = {
  validateGridLocator,
  maidenheadToLatLon,
  latLonToMaidenhead,
  maidenheadToBoundingBox,
  getBandFromHz,
  getBandFromKHz,
  haversineDistance,
};
