import { describe, it, expect } from 'vitest';
import { validateGridLocator, latLonToMaidenhead, maidenheadToLatLon, maidenheadToBoundingBox } from './geo.js';
import { getSunPosition, getMoonPosition, getMoonPhase } from './geo.js';
import { normalizeLon } from './geo.js';

// normalize to [−π, +π)
const normalizeRadians = (r) => {
  const twoPi = 2 * Math.PI;
  const x = ((r % twoPi) + twoPi) % twoPi; // now in [0, 2π)
  return x >= Math.PI ? x - twoPi : x; // map [π, 2π) → [−π, 0)
};
const normalizeDegrees360 = (d) => {
  return ((d % 360) + 360) % 360;
};
const normalizeDegrees180 = (d) => {
  return ((((d + 180) % 360) + 360) % 360) - 180;
};
const deg2rad = (d) => {
  return (d * Math.PI) / 180;
};
const rad2deg = (r) => {
  return (r * 180) / Math.PI;
};
// Convert H:M:S → radians
const hmsToRad = (h, m, s) => {
  const hours = h + m / 60 + s / 3600;
  return (hours / 24) * 2 * Math.PI;
};
// Convert D:M:S → radians
const dmsToRad = (d, m, s) => {
  const sign = d < 0 ? -1 : 1;
  const deg = Math.abs(d) + m / 60 + s / 3600;
  return sign * deg * (Math.PI / 180);
};

describe('Maidenhead Grid tests', () => {
  const gridCases = [
    // note that 'grid' fields entered in the test cases are all 8 characters long,
    // as tests will also validate the first 2, 4, 6 and 8 characters.

    // location in San Diego, CA, USA
    {
      grid: 'DM12kv99',
      actualLatLon: { lat: 32.91254, lon: -117.08409 },
      latLonSWCornerGrid6: [32.875, -117.167],
      latLonNECornerGrid6: [32.917, -117.083],
    },

    // location in Sydney, Australia
    {
      grid: 'QF56od55',
      actualLatLon: { lat: -33.8519, lon: 151.210886 },
    },

    // location at equator / prime meridian
    {
      grid: 'JJ00aa00',
      actualLatLon: { lat: 0, lon: 0 },
    },

    // location at equator just west of antimeridian
    {
      grid: 'RJ90XA90',
      actualLatLon: { lat: 0, lon: 179.999 },
    },

    // location at equator on antimeridian
    // note that this is not strictly valid as longitude should be given as -180 rather than +180,
    // however some sources may expected +180 to be functional so it should be tested
    {
      grid: 'AJ00AA00',
      actualLatLon: { lat: 0, lon: 180.0 },
    },

    // location at equator on antimeridian
    {
      grid: 'AJ00AA00',
      actualLatLon: { lat: 0, lon: -180.0 },
    },
  ];

  it('should invalidate empty grid locator', () => {
    expect(validateGridLocator('')).toBe(false);
  });

  it('should invalidate grid locator with invalid length', () => {
    expect(validateGridLocator('DM1')).toBe(false);
  });

  it('should invalidate grid locator with invalid characters', () => {
    expect(validateGridLocator('DM12zz')).toBe(false);
  });

  for (const { grid, actualLatLon, latLonSWCornerGrid6, latLonNECornerGrid6 } of gridCases) {
    it(
      ('should validate test case grid locator has size 8',
      () => {
        expect(grid.length).toEqual(8);
      }),
    );

    const defaultSize = 6;
    const sizes = [2, 4, 6, 8];
    for (const size of sizes) {
      it("should validate grid locator '" + grid.substring(0, size) + "'", () => {
        const subGrid = grid.substring(0, size);
        expect(validateGridLocator(subGrid)).toBe(true);
      });
    }

    for (const size of sizes) {
      it('should convert Lat/Lon to Maidenhead Grid of requested size ' + size, () => {
        const result = latLonToMaidenhead(actualLatLon, size);
        expect(result.toUpperCase()).toBe(grid.substring(0, size).toUpperCase());
      });
    }

    it('should convert Lat/Lon to Maidenhead Grid with default size 6 when no size is specified', () => {
      const result = latLonToMaidenhead(actualLatLon);
      expect(result.toUpperCase()).toBe(grid.substring(0, defaultSize).toUpperCase());
    });

    for (const size of sizes) {
      it("should convert Maidenhead Grid '" + grid.substring(0, size) + "' to Lat/Lon", () => {
        const { lat, lon } = maidenheadToLatLon(grid.substring(0, size));
        // handle case where longitude is given as +180 or -180, although +180 is strictly invalid it can sometimes be used so should be tested
        const { lat: expectedLat, lon: rawLon } = actualLatLon,
          expectedLon = ((rawLon + 180) % 360) - 180;
        let latBucketSize, lonBucketSize, latBucketStart, latBucketEnd, lonBucketStart, lonBucketEnd;

        switch (size) {
          case 2:
            latBucketSize = 10; // degrees
            latBucketStart = Math.floor(expectedLat / latBucketSize) * latBucketSize;
            latBucketEnd = latBucketStart + latBucketSize;

            lonBucketSize = 20; // degrees
            lonBucketStart = Math.floor(expectedLon / lonBucketSize) * lonBucketSize;
            lonBucketEnd = lonBucketStart + lonBucketSize;
            break;

          case 4:
            latBucketSize = 1; // degrees
            latBucketStart = Math.floor(expectedLat / latBucketSize) * latBucketSize;
            latBucketEnd = latBucketStart + latBucketSize;

            lonBucketSize = 2; // degrees
            lonBucketStart = Math.floor(expectedLon / lonBucketSize) * lonBucketSize;
            lonBucketEnd = lonBucketStart + lonBucketSize;
            break;

          case 6:
            latBucketSize = 2.5; // minutes
            latBucketStart = (Math.floor((60 * expectedLat) / latBucketSize) * latBucketSize) / 60;
            latBucketEnd = latBucketStart + latBucketSize / 60;

            lonBucketSize = 5; // minutes
            lonBucketStart = (Math.floor((60 * expectedLon) / lonBucketSize) * lonBucketSize) / 60;
            lonBucketEnd = lonBucketStart + lonBucketSize / 60;
            break;

          case 8:
            latBucketSize = 0.25; // minutes
            latBucketStart = (Math.floor((10 * 60 * expectedLat) / latBucketSize) * latBucketSize) / 60 / 10;
            latBucketEnd = latBucketStart + latBucketSize / 60;

            lonBucketSize = 0.5; // minutes
            lonBucketStart = (Math.floor((60 * expectedLon) / lonBucketSize) * lonBucketSize) / 60;
            lonBucketEnd = lonBucketStart + lonBucketSize / 60;
            break;

          default:
            throw new Error('invalid size');
        }

        expect(lat).toBeGreaterThanOrEqual(latBucketStart);
        expect(lat).toBeLessThan(latBucketEnd);
        expect(lon).toBeGreaterThanOrEqual(lonBucketStart);
        expect(lon).toBeLessThan(lonBucketEnd);
      });
    }

    if (latLonSWCornerGrid6 && latLonNECornerGrid6) {
      it(
        "should convert Maidenhead Grid '" + grid.substring(0, defaultSize) + "' to Lat/Lon bounding box coordinates",
        () => {
          const result = maidenheadToBoundingBox(grid.substring(0, defaultSize));
          expect(result).toHaveLength(2);
          expect(result[0]).toHaveLength(2);
          expect(result[1]).toHaveLength(2);

          expect(result[0][0]).toBeCloseTo(latLonSWCornerGrid6[0], 3);
          expect(result[0][1]).toBeCloseTo(latLonSWCornerGrid6[1], 3);
          expect(result[1][0]).toBeCloseTo(latLonNECornerGrid6[0], 3);
          expect(result[1][1]).toBeCloseTo(latLonNECornerGrid6[1], 3);
        },
      );
    }
  }
});

describe('Sun tests', () => {
  const sunEphemerisCases = [
    // based on https://eclipse.gsfc.nasa.gov/TYPE/sun1.html#su2000
    {
      date: '1999-12-22T00:00:00.000Z',
      gast: 6 + 0 / 60 + 26.7 / 3600,
      dec: -(23 + 26 / 60 + 14.1 / 3600),
      ra: 17 + 58 / 60 + 34.03 / 3600,
    },

    // based on https://eclipse.gsfc.nasa.gov/TYPE/sun1.html#su2000
    {
      date: '2000-01-01T00:00:00.000Z',
      gast: 6 + 39 / 60 + 52.3 / 3600,
      dec: -(23 + 4 / 60 + 16.2 / 3600),
      ra: 18 + 42 / 60 + 54.05 / 3600,
    },

    // based on https://eclipse.gsfc.nasa.gov/TYPE/sun1.html#su2000
    {
      date: '2000-06-21T00:00:00.000Z',
      gast: 17 + 57 / 60 + 59.8 / 3600,
      dec: 23 + 26 / 60 + 16.2 / 3600,
      ra: 5 + 59 / 60 + 41.15 / 3600,
    },

    // based on https://www.astropixels.com/ephemeris/sun/sun2026.html
    {
      date: '2026-01-01T00:00:00.000Z',
      gast: 6 + 42 / 60 + 38.8 / 3600,
      dec: -(23 + 1 / 60 + 2.1 / 3600),
      ra: 18 + 45 / 60 + 58.74 / 3600,
    },

    // based on https://www.astropixels.com/ephemeris/sun/sun2026.html
    {
      date: '2026-04-29T00:00:00.000Z',
      gast: 14 + 27 / 60 + 52.3 / 3600,
      dec: 14 + 24 / 60 + 3.3 / 3600,
      ra: 2 + 25 / 60 + 16.69 / 3600,
    },
  ];

  for (const ephemeris of sunEphemerisCases) {
    it('should validate getSunPosition() for known position', () => {
      const date = new Date(ephemeris.date);

      const subSolarPointFromGST = (raHours, decDeg, gstHours) => {
        // Hours → radians
        const TWO_PI = 2 * Math.PI;
        const ra = (raHours * TWO_PI) / 24;
        const gast = (gstHours * TWO_PI) / 24;

        // Latitude = Dec (unchanged)
        const lat = decDeg;

        // Longitude = RA - GAST (radians → degrees)
        let lon = normalizeDegrees180(((ra - gast) * 180) / Math.PI);

        return { lat, lon };
      };

      const sunPosition = getSunPosition(date); // target code
      const point = subSolarPointFromGST(ephemeris.ra, ephemeris.dec, ephemeris.gast);

      // check absolute difference in tested and calculated values does not exceed maximum allowed
      const maxAllowedDeltaLat = 0.75;
      const maxAllowedDeltaLon = 1.0;
      expect(Math.abs(normalizeDegrees180(sunPosition.lat - point.lat))).toBeLessThan(maxAllowedDeltaLat);
      expect(Math.abs(normalizeDegrees180(sunPosition.lon - point.lon))).toBeLessThan(maxAllowedDeltaLon);
    });
  }
});

describe('Moon tests', () => {
  // with reference to ephereris https://ssd.jpl.nasa.gov/horizons/app.html#/
  // sampled over a 28-day period
  const moonEphemerisCases = [
    {
      date: '2026-05-27T00:00:00Z',
      raRad: hmsToRad(12, 57, 13.11),
      decRad: dmsToRad(-9, 48, 29.6),
    },
    {
      date: '2026-06-03T00:00:00Z',
      raRad: hmsToRad(18, 48, 36.77),
      decRad: dmsToRad(-26, 55, 51.1),
    },
    {
      date: '2026-06-10T00:00:00Z',
      raRad: hmsToRad(0, 25, 53.25),
      decRad: dmsToRad(6, 1, 4.2),
    },
    {
      date: '2026-06-17T00:00:00Z',
      raRad: hmsToRad(7, 38, 4.91),
      decRad: dmsToRad(24, 47, 13.9),
    },
    {
      date: '2026-06-24T00:00:00Z',
      raRad: hmsToRad(13, 31, 1.59),
      decRad: dmsToRad(-13, 58, 59.0),
    },
  ];

  // Convert JS Date → Julian Date
  function julianDate(date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate() + (date.getUTCHours() + (date.getUTCMinutes() + date.getUTCSeconds() / 60) / 60) / 24;

    let Y = year;
    let M = month;
    if (M <= 2) {
      Y -= 1;
      M += 12;
    }

    const A = Math.floor(Y / 100);
    const B = 2 - A + Math.floor(A / 4);

    return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + day + B - 1524.5;
  }

  // Compute GMST (radians)
  function gmstFromJD(jd) {
    const T = (jd - 2451545.0) / 36525.0;
    const gmstSec = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
    return (((gmstSec * (Math.PI / 43200)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  }

  // Main function: RA/Dec + UTC → sublunar lat/lon
  function sublunarPoint(dateUTC, raRad, decRad) {
    const jd = julianDate(dateUTC);
    const gmst = gmstFromJD(jd);

    // Approximate sublunar point
    const lonRad = normalizeRadians(raRad - gmst);
    const latRad = decRad;

    return {
      lat: rad2deg(latRad),
      lon: rad2deg(lonRad),
    };
  }

  for (const ephemeris of moonEphemerisCases) {
    it('should validate getMoonPosition() for known position', () => {
      const date = new Date(ephemeris.date);
      const targetFunctionResult = getMoonPosition(date); // target function
      const ephemerisResult = sublunarPoint(date, ephemeris.raRad, ephemeris.decRad); // internal calculation from ephemeris

      // check absolute difference in tested and calculated values does not exceed maximum allowed
      const maxAllowedDeltaLat = 0.25;
      const maxAllowedDeltaLon = 0.45;
      expect(Math.abs(normalizeDegrees180(targetFunctionResult.lat - ephemerisResult.lat))).toBeLessThan(
        maxAllowedDeltaLat,
      );
      expect(Math.abs(normalizeDegrees180(targetFunctionResult.lon - ephemerisResult.lon))).toBeLessThan(
        maxAllowedDeltaLon,
      );
    });
  }
});

describe('miscellaneous functionality tests', () => {
  for (const [lon, expected] of [
    [-720, 0],
    [-360, 0],
    [-180, -180],
    [-90, -90],
    [0, 0],
    [90, 90],
    [180, -180],
    [360, 0],
    [720, 0],
  ]) {
    it('should validate normalizeLon()', () => {
      expect(normalizeLon(lon)).toBe(expected);
    });
  }
});
