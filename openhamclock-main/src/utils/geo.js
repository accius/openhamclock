/**
 * Geographic Calculation Utilities
 * Grid squares, bearings, distances, sun/moon positions
 */

/**
 * Calculate Maidenhead grid square from coordinates
 */
export const calculateGridSquare = (lat, lon) => {
  const lonNorm = lon + 180;
  const latNorm = lat + 90;
  const field1 = String.fromCharCode(65 + Math.floor(lonNorm / 20));
  const field2 = String.fromCharCode(65 + Math.floor(latNorm / 10));
  const square1 = Math.floor((lonNorm % 20) / 2);
  const square2 = Math.floor(latNorm % 10);
  const subsq1 = String.fromCharCode(97 + Math.floor((lonNorm % 2) * 12));
  const subsq2 = String.fromCharCode(97 + Math.floor((latNorm % 1) * 24));
  return `${field1}${field2}${square1}${square2}${subsq1}${subsq2}`;
};

/**
 * Calculate bearing between two points
 */
export const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

/**
 * Calculate distance between two points in km
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

/**
 * Format a distance value based on unit preference
 * @param {number} km - Distance in kilometers
 * @param {string} units - 'metric' or 'imperial'
 * @returns {string} Formatted distance with unit label (e.g. "1,234 km" or "767 mi")
 */
export const formatDistance = (km, units) => {
  if (units === 'imperial') {
    const mi = km * 0.621371;
    return `${Math.round(mi).toLocaleString()} mi`;
  }
  return `${Math.round(km).toLocaleString()} km`;
};

/**
 * Get subsolar point (position where sun is directly overhead)
 */
export const getSunPosition = (date) => {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const declination = -23.45 * Math.cos((360/365) * (dayOfYear + 10) * Math.PI / 180);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const longitude = (12 - hours) * 15;
  return { lat: declination, lon: longitude };
};

/**
 * Calculate sublunar point (position where moon is directly overhead)
 */
export const getMoonPosition = (date) => {
  // Julian date calculation
  const JD = date.getTime() / 86400000 + 2440587.5;
  const T = (JD - 2451545.0) / 36525; // Julian centuries from J2000
  
  // Moon's mean longitude
  const L0 = (218.316 + 481267.8813 * T) % 360;
  
  // Moon's mean anomaly
  const M = (134.963 + 477198.8676 * T) % 360;
  const MRad = M * Math.PI / 180;
  
  // Moon's mean elongation
  const D = (297.850 + 445267.1115 * T) % 360;
  const DRad = D * Math.PI / 180;
  
  // Sun's mean anomaly
  const Ms = (357.529 + 35999.0503 * T) % 360;
  const MsRad = Ms * Math.PI / 180;
  
  // Moon's argument of latitude
  const F = (93.272 + 483202.0175 * T) % 360;
  const FRad = F * Math.PI / 180;
  
  // Longitude corrections (simplified)
  const dL = 6.289 * Math.sin(MRad)
           + 1.274 * Math.sin(2 * DRad - MRad)
           + 0.658 * Math.sin(2 * DRad)
           + 0.214 * Math.sin(2 * MRad)
           - 0.186 * Math.sin(MsRad)
           - 0.114 * Math.sin(2 * FRad);
  
  // Moon's ecliptic longitude
  const moonLon = ((L0 + dL) % 360 + 360) % 360;
  
  // Moon's ecliptic latitude (simplified)
  const moonLat = 5.128 * Math.sin(FRad)
                + 0.281 * Math.sin(MRad + FRad)
                + 0.278 * Math.sin(MRad - FRad);
  
  // Convert ecliptic to equatorial coordinates
  const obliquity = 23.439 - 0.0000004 * (JD - 2451545.0);
  const oblRad = obliquity * Math.PI / 180;
  const moonLonRad = moonLon * Math.PI / 180;
  const moonLatRad = moonLat * Math.PI / 180;
  
  // Right ascension
  const RA = Math.atan2(
    Math.sin(moonLonRad) * Math.cos(oblRad) - Math.tan(moonLatRad) * Math.sin(oblRad),
    Math.cos(moonLonRad)
  ) * 180 / Math.PI;
  
  // Declination
  const dec = Math.asin(
    Math.sin(moonLatRad) * Math.cos(oblRad) + 
    Math.cos(moonLatRad) * Math.sin(oblRad) * Math.sin(moonLonRad)
  ) * 180 / Math.PI;
  
  // Greenwich Mean Sidereal Time
  const GMST = (280.46061837 + 360.98564736629 * (JD - 2451545.0)) % 360;
  
  // Sublunar point longitude
  const sublunarLon = ((RA - GMST) % 360 + 540) % 360 - 180;
  
  return { lat: dec, lon: sublunarLon };
};

/**
 * Calculate moon phase (0-1, 0=new, 0.5=full)
 */
export const getMoonPhase = (date) => {
  const JD = date.getTime() / 86400000 + 2440587.5;
  const T = (JD - 2451545.0) / 36525;
  const D = (297.850 + 445267.1115 * T) % 360; // Mean elongation: 0=new, 180=full
  // Normalize to 0-1 range (0=new, 0.5=full)
  const phase = (((D % 360) + 360) % 360) / 360;
  return phase;
};

/**
 * Get moon phase emoji
 */
export const getMoonPhaseEmoji = (phase) => {
  if (phase < 0.0625) return '🌑'; // New moon
  if (phase < 0.1875) return '🌒'; // Waxing crescent
  if (phase < 0.3125) return '🌓'; // First quarter
  if (phase < 0.4375) return '🌔'; // Waxing gibbous
  if (phase < 0.5625) return '🌕'; // Full moon
  if (phase < 0.6875) return '🌖'; // Waning gibbous
  if (phase < 0.8125) return '🌗'; // Last quarter
  if (phase < 0.9375) return '🌘'; // Waning crescent
  return '🌑'; // New moon
};

/**
 * Calculate sunrise and sunset times (UTC)
 * Uses NOAA solar calculator algorithm for accuracy
 */
export const calculateSunTimes = (lat, lon, date) => {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  // Julian date calculation
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jd = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;

  // Julian century from J2000.0
  const jc = (jd - 2451545) / 36525;

  // Sun's geometric mean longitude (degrees)
  const L0 = (280.46646 + jc * (36000.76983 + 0.0003032 * jc)) % 360;

  // Sun's mean anomaly (degrees)
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);

  // Earth's orbit eccentricity
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

  // Sun's equation of center
  const C = Math.sin(toRad(M)) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
          + Math.sin(toRad(2 * M)) * (0.019993 - 0.000101 * jc)
          + Math.sin(toRad(3 * M)) * 0.000289;

  // Sun's true longitude
  const sunLon = L0 + C;

  // Sun's apparent longitude
  const omega = 125.04 - 1934.136 * jc;
  const lambda = sunLon - 0.00569 - 0.00478 * Math.sin(toRad(omega));

  // Mean obliquity of the ecliptic
  const obliq0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = obliq0 + 0.00256 * Math.cos(toRad(omega));

  // Sun's declination
  const declination = toDeg(Math.asin(Math.sin(toRad(obliq)) * Math.sin(toRad(lambda))));

  // Equation of time (minutes)
  const y2 = Math.tan(toRad(obliq / 2)) ** 2;
  const eqTime = 4 * toDeg(
    y2 * Math.sin(2 * toRad(L0))
    - 2 * e * Math.sin(toRad(M))
    + 4 * e * y2 * Math.sin(toRad(M)) * Math.cos(2 * toRad(L0))
    - 0.5 * y2 * y2 * Math.sin(4 * toRad(L0))
    - 1.25 * e * e * Math.sin(2 * toRad(M))
  );

  // Hour angle for sunrise/sunset (accounting for atmospheric refraction and sun's radius)
  // Standard altitude is -0.833 degrees (refraction + sun radius)
  const latRad = toRad(lat);
  const decRad = toRad(declination);
  const cosHA = (Math.cos(toRad(90.833)) - Math.sin(latRad) * Math.sin(decRad)) / (Math.cos(latRad) * Math.cos(decRad));

  if (cosHA > 1) return { sunrise: 'Polar night', sunset: '' };
  if (cosHA < -1) return { sunrise: 'Midnight sun', sunset: '' };

  const ha = toDeg(Math.acos(cosHA));

  // Solar noon in UTC (minutes from midnight)
  const solarNoon = 720 - 4 * lon - eqTime;

  // Sunrise and sunset in UTC (minutes from midnight)
  const sunriseMin = solarNoon - ha * 4;
  const sunsetMin = solarNoon + ha * 4;

  const fmt = (minutes) => {
    const totalMin = ((minutes % 1440) + 1440) % 1440;
    const hr = Math.floor(totalMin / 60);
    const mn = Math.round(totalMin % 60);
    return `${hr.toString().padStart(2, '0')}:${mn.toString().padStart(2, '0')}`;
  };

  return { sunrise: fmt(sunriseMin), sunset: fmt(sunsetMin) };
};

/**
 * Normalize longitude to -180..180 range
 */
export const normalizeLon = (lon) => {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
};

/**
 * World copy offsets — render overlays at -360, 0, +360 so they appear on
 * every visible copy of the map. Same approach as the GrayLine plugin.
 */
export const WORLD_COPY_OFFSETS = [-360, 0, 360];

/**
 * Calculate great circle path points for Leaflet
 * Returns unwrapped (continuous) coordinates for smooth rendering.
 * Use replicatePath() to create copies for all visible world copies.
 */
export const getGreatCirclePoints = (lat1, lon1, lat2, lon2, n = 100) => {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  
  const φ1 = toRad(lat1), λ1 = toRad(lon1);
  const φ2 = toRad(lat2), λ2 = toRad(lon2);
  
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ1-φ2)/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin((λ1-λ2)/2)**2
  ));
  
  // If distance is essentially zero, return just the two points
  if (d < 0.0001) {
    return [[lat1, lon1], [lat2, lon2]];
  }
  
  const rawPoints = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1-f)*d) / Math.sin(d);
    const B = Math.sin(f*d) / Math.sin(d);
    const x = A*Math.cos(φ1)*Math.cos(λ1) + B*Math.cos(φ2)*Math.cos(λ2);
    const y = A*Math.cos(φ1)*Math.sin(λ1) + B*Math.cos(φ2)*Math.sin(λ2);
    const z = A*Math.sin(φ1) + B*Math.sin(φ2);
    rawPoints.push([toDeg(Math.atan2(z, Math.sqrt(x*x+y*y))), toDeg(Math.atan2(y, x))]);
  }
  
  // Unwrap longitudes to be continuous (no jumps > 180°)
  // This lets Leaflet draw smoothly across the antimeridian and world copies
  for (let i = 1; i < rawPoints.length; i++) {
    while (rawPoints[i][1] - rawPoints[i-1][1] > 180) rawPoints[i][1] -= 360;
    while (rawPoints[i][1] - rawPoints[i-1][1] < -180) rawPoints[i][1] += 360;
  }
  
  return rawPoints;
};

/**
 * Replicate an unwrapped polyline path across 3 world copies (-360, 0, +360).
 * Returns an array of 3 coordinate arrays, one per world copy.
 * Each copy can be passed directly to L.polyline().
 * Returns an array of coordinate segments, Detect Date Line jumps and split into separate line segments to prevent horizontal streaks.
 */
export const replicatePath = (path) => {
  if (!path || path.length === 0) return [];

  const segments = [[]];
  
  // 1. Detect Date Line jumps and split into separate line segments
  for (let i = 0; i < path.length; i++) {
    const current = path[i];
    const prev = path[i - 1];
    
    // If the longitude jump is > 180 degrees, the satellite crossed the edge.
    if (prev && Math.abs(current[1] - prev[1]) > 180) {
      segments.push([]); 
    }
    segments[segments.length - 1].push(current);
  }

  // 2. Wrap each segment for the "3-world" view (-360, 0, +360)
  const wrappedWorlds = [];
  const offsets = [0, 360, -360];

  segments.forEach(segment => {
    if (segment.length < 2) return;
    
    offsets.forEach(offset => {
      wrappedWorlds.push(segment.map(p => [p[0], p[1] + offset]));
    });
  });

  return wrappedWorlds;
};

/**
 * Replicate a single [lat, lon] point across 3 world copies.
 * Returns an array of 3 [lat, lon] pairs for use with L.circleMarker etc.
 */
export const replicatePoint = (lat, lon) => {
  const nLon = normalizeLon(lon);
  return WORLD_COPY_OFFSETS.map(offset => [lat, nLon + offset]);
};

export default {
  calculateGridSquare,
  calculateBearing,
  calculateDistance,
  getSunPosition,
  getMoonPosition,
  getMoonPhase,
  getMoonPhaseEmoji,
  calculateSunTimes,
  getGreatCirclePoints,
  replicatePath,
  replicatePoint,
  normalizeLon,
  WORLD_COPY_OFFSETS
};
