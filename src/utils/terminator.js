/**
 * Custom day/night terminator for Leaflet
 * Based on @joergdietrich/leaflet.terminator math, extended to span
 * multiple world copies (-540..540° longitude) so the gray line renders
 * correctly when users pan past the International Date Line.
 *
 * Removes CDN dependency on L.Terminator.js
 */

const PI = Math.PI;
const RAD = PI / 180;

/** Julian day number from Date */
function jday(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Greenwich Mean Sidereal Time (in radians) */
function gmst(date) {
  const jd = jday(date);
  const d = jd - 2451545.0;
  return ((280.46061837 + 360.98564736629 * d) % 360) * RAD;
}

/** Sun's ecliptic position */
function sunEclipticPosition(jd) {
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  return { lambda };
}

/** Ecliptic obliquity (radians) */
function eclipticObliquity(jd) {
  const n = jd - 2451545.0;
  return (23.439 - 0.0000004 * n) * RAD;
}

/** Sun's equatorial position (right ascension + declination) */
function sunEquatorialPosition(lambda, epsilon) {
  const alpha = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  return { alpha, delta };
}

/** Hour angle at a given longitude */
function hourAngle(gmstVal, sunPos, longitude) {
  return gmstVal + longitude * RAD - sunPos.alpha;
}

/**
 * Compute the night polygon for a given time
 * Returns array of coordinate rings (3 world copies)
 */
function computeNightPolygon(time, resolution) {
  const date = time || new Date();
  const jd = jday(date);
  const eclPos = sunEclipticPosition(jd);
  const obliq = eclipticObliquity(jd);
  const sunPos = sunEquatorialPosition(eclPos.lambda, obliq);
  const gmstVal = gmst(date);
  const ha0 = hourAngle(gmstVal, sunPos, -180);

  const steps = Math.ceil(360 / resolution);
  const baseLine = [];

  for (let i = 0; i <= steps; i++) {
    const lon = -180 + (i * 360) / steps;
    const ha = ha0 + ((i * 360) / steps) * RAD;

    let lat;
    const tanDelta = Math.tan(sunPos.delta);
    if (Math.abs(tanDelta) < 1e-10) {
      // Near equinox: terminator approaches a meridian
      lat = Math.cos(ha) > 0 ? -89.9 : 89.9;
    } else {
      lat = Math.atan(-Math.cos(ha) / tanDelta) / RAD;
    }

    baseLine.push([lat, lon]);
  }

  // Close the polygon through the dark pole
  // delta > 0 (northern summer): south pole is in darkness
  // delta < 0 (northern winter): north pole is in darkness
  const nightPole = sunPos.delta >= 0 ? -90 : 90;

  const baseRing = [...baseLine];
  baseRing.push([nightPole, 180]);
  baseRing.push([nightPole, -180]);

  // Create 3 world copies so terminator is visible past the dateline
  const rings = [];
  for (const offset of [-360, 0, 360]) {
    rings.push(baseRing.map(([lat, lon]) => [lat, lon + offset]));
  }

  return rings;
}

/**
 * Create a Leaflet terminator layer
 * Drop-in replacement for L.terminator()
 *
 * @param {Object} options - Leaflet polygon style options + resolution
 * @returns {L.Polygon} Polygon with setTime() method
 */
export function createTerminator(options = {}) {
  const {
    resolution = 2,
    fillOpacity = 0.35,
    fillColor = '#000020',
    color = '#ffaa00',
    weight = 2,
    dashArray = '5, 5',
    time,
    ...otherOptions
  } = options;

  const rings = computeNightPolygon(time || new Date(), resolution);

  const polygon = L.polygon(rings, {
    fillOpacity,
    fillColor,
    color,
    weight,
    dashArray,
    interactive: false,
    bubblingMouseEvents: false,
    ...otherOptions,
  });

  polygon._terminatorResolution = resolution;

  /**
   * Update the terminator to a new time
   * @param {Date} [newTime] - Time to compute for (default: now)
   */
  polygon.setTime = function (newTime) {
    const t = newTime || new Date();
    const newRings = computeNightPolygon(t, this._terminatorResolution);
    this.setLatLngs(newRings);
  };

  return polygon;
}

export default createTerminator;
