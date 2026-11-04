/**
 * Compact solar-system ephemeris — Sun, Moon and the seven other planets as
 * seen from an observer: RA/Dec, azimuth/elevation, rise/set, distance.
 *
 * Planets: Keplerian elements with linear rates from JPL's "Approximate
 * Positions of the Major Planets" (Standish, valid 1800–2050; ~1′ for the
 * inner planets, a few arcminutes for the outer ones). Light-time and
 * aberration are ignored (≤ 0.01°). The Earth set is the Earth–Moon
 * barycentre, which also gives the Sun's geocentric position.
 *
 * Moon: Schlyter's truncated series (≈ 2′ in longitude, 1′ in latitude,
 * ~0.5 % in distance) — enough for pointing, rise/set, and the eclipse
 * local-circumstance estimates in utils/eclipses.js, where the observer's
 * parallax (up to 1°) matters far more and IS applied.
 *
 * Conventions: degrees in and out, RA 0–360°, azimuth clockwise from north,
 * elevation geometric (no refraction) unless noted. Times are JS Dates (UT);
 * ΔT (≈ 70 s) is ignored — it moves the Moon ~0.001°.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6378.137;
const J2000 = 2451545.0;

export const PLANET_NAMES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
export const BODY_NAMES = ['Sun', 'Moon', ...PLANET_NAMES];

// a (AU), e, I (°), L (°), ϖ = longitude of perihelion (°), Ω (°); then
// per-Julian-century rates in the same order. Standish Table 1 (1800–2050).
const ELEMENTS = {
  Mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  Venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  Earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  ],
  Mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  Jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  Saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  Uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ],
  Neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ],
};

// Equatorial radii (km) for apparent-size work (eclipses use Sun + Moon).
export const BODY_RADIUS_KM = { Sun: 695700, Moon: 1737.4 };

const norm360 = (d) => ((d % 360) + 360) % 360;
const norm180 = (d) => {
  const n = norm360(d);
  return n > 180 ? n - 360 : n;
};

/** Julian Day (UT) for a Date. */
export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Solve Kepler's equation M = E − e sin E (all degrees). */
export function solveKepler(Mdeg, e) {
  const M = norm180(Mdeg) * DEG;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E * RAD;
}

/**
 * Heliocentric ecliptic (J2000) rectangular coordinates in AU for a planet
 * (or 'Earth' = EM barycentre) at Julian Day jd.
 */
export function heliocentric(name, jd) {
  const el = ELEMENTS[name];
  if (!el) throw new Error(`Unknown planet ${name}`);
  const T = (jd - J2000) / 36525;
  const [a, e, I, L, wbar, O] = el[0].map((v, i) => v + el[1][i] * T);
  const w = wbar - O; // argument of perihelion
  const M = L - wbar; // mean anomaly
  const E = solveKepler(M, e) * DEG;
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w * DEG);
  const sw = Math.sin(w * DEG);
  const cO = Math.cos(O * DEG);
  const sO = Math.sin(O * DEG);
  const cI = Math.cos(I * DEG);
  const sI = Math.sin(I * DEG);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}

/** Mean obliquity of the ecliptic (degrees) — Meeus 22.2, first terms. */
export function obliquity(jd) {
  const T = (jd - J2000) / 36525;
  return 23.439291 - 0.0130042 * T - 1.64e-7 * T * T;
}

/** Ecliptic rectangular → equatorial rectangular (same units). */
function eclToEq({ x, y, z }, jd) {
  const eps = obliquity(jd) * DEG;
  return { x, y: y * Math.cos(eps) - z * Math.sin(eps), z: y * Math.sin(eps) + z * Math.cos(eps) };
}

/** Rectangular → spherical: { ra, dec, r } (degrees). */
export function toSpherical({ x, y, z }) {
  const r = Math.sqrt(x * x + y * y + z * z);
  return { ra: norm360(Math.atan2(y, x) * RAD), dec: Math.asin(z / r) * RAD, r };
}

/** Spherical (degrees) → rectangular. */
function fromSpherical(ra, dec, r) {
  const a = ra * DEG;
  const d = dec * DEG;
  return { x: r * Math.cos(d) * Math.cos(a), y: r * Math.cos(d) * Math.sin(a), z: r * Math.sin(d) };
}

/**
 * Precess J2000 equatorial coordinates to the mean equinox of date
 * (Meeus 21.3–21.4). The planet elements are referred to J2000, but
 * sidereal time — and therefore every alt/az — is of date, and the Moon
 * series is of date too; without this the Sun would be ~0.3° off by 2024
 * and ~0.5° off by 2040, which matters for eclipse geometry.
 */
export function precessFromJ2000(ra0, dec0, jd) {
  const t = (jd - J2000) / 36525;
  const sec = 1 / 3600;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * sec * DEG;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * sec * DEG;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * sec * DEG;
  const a0 = ra0 * DEG + zeta;
  const d0 = dec0 * DEG;
  const A = Math.cos(d0) * Math.sin(a0);
  const B = Math.cos(theta) * Math.cos(d0) * Math.cos(a0) - Math.sin(theta) * Math.sin(d0);
  const C = Math.sin(theta) * Math.cos(d0) * Math.cos(a0) + Math.cos(theta) * Math.sin(d0);
  return { ra: norm360((Math.atan2(A, B) + z) * RAD), dec: Math.asin(Math.max(-1, Math.min(1, C))) * RAD };
}

/** Geocentric equatorial rectangular position of the Sun in AU. */
export function sunGeocentricVector(jd) {
  const e = heliocentric('Earth', jd);
  return eclToEq({ x: -e.x, y: -e.y, z: -e.z }, jd);
}

/** Geocentric equatorial rectangular position of a planet in AU. */
export function planetGeocentricVector(name, jd) {
  const e = heliocentric('Earth', jd);
  const p = heliocentric(name, jd);
  return eclToEq({ x: p.x - e.x, y: p.y - e.y, z: p.z - e.z }, jd);
}

/**
 * Geocentric equatorial rectangular position of the Moon in km
 * (Schlyter, "How to compute planetary positions").
 */
export function moonGeocentricVector(jd) {
  const d = jd - 2451543.5;
  const N = 125.1228 - 0.0529538083 * d; // ascending node
  const i = 5.1454; // inclination
  const w = 318.0634 + 0.1643573223 * d; // argument of perigee
  const a = 60.2666; // Earth radii
  const e = 0.0549;
  const M = 115.3654 + 13.0649929509 * d; // mean anomaly

  const Ms = 356.047 + 0.9856002585 * d; // Sun mean anomaly
  const ws = 282.9404 + 4.70935e-5 * d; // Sun arg. of perihelion
  const Ls = Ms + ws; // Sun mean longitude
  const Lm = M + w + N; // Moon mean longitude
  const D = Lm - Ls; // mean elongation
  const F = Lm - N; // argument of latitude

  const E = solveKepler(M, e) * DEG;
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv) * RAD;
  let r = Math.sqrt(xv * xv + yv * yv);

  const cN = Math.cos(N * DEG);
  const sN = Math.sin(N * DEG);
  const vw = (v + w) * DEG;
  const ci = Math.cos(i * DEG);
  const si = Math.sin(i * DEG);
  const xh = r * (cN * Math.cos(vw) - sN * Math.sin(vw) * ci);
  const yh = r * (sN * Math.cos(vw) + cN * Math.sin(vw) * ci);
  const zh = r * Math.sin(vw) * si;

  let lon = Math.atan2(yh, xh) * RAD;
  let lat = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * RAD;

  const s = (x) => Math.sin(x * DEG);
  const c = (x) => Math.cos(x * DEG);
  lon +=
    -1.274 * s(M - 2 * D) +
    0.658 * s(2 * D) -
    0.186 * s(Ms) -
    0.059 * s(2 * M - 2 * D) -
    0.057 * s(M - 2 * D + Ms) +
    0.053 * s(M + 2 * D) +
    0.046 * s(2 * D - Ms) +
    0.041 * s(M - Ms) -
    0.035 * s(D) -
    0.031 * s(M + Ms) -
    0.015 * s(2 * F - 2 * D) +
    0.011 * s(M - 4 * D);
  lat +=
    -0.173 * s(F - 2 * D) -
    0.055 * s(M - F - 2 * D) -
    0.046 * s(M + F - 2 * D) +
    0.033 * s(F + 2 * D) +
    0.017 * s(2 * M + F);
  r += -0.58 * c(M - 2 * D) - 0.46 * c(2 * D);

  const rKm = r * EARTH_RADIUS_KM;
  const ecl = {
    x: rKm * Math.cos(lon * DEG) * Math.cos(lat * DEG),
    y: rKm * Math.sin(lon * DEG) * Math.cos(lat * DEG),
    z: rKm * Math.sin(lat * DEG),
  };
  return eclToEq(ecl, jd);
}

/** Greenwich mean sidereal time in degrees. */
export function gmst(jd) {
  const T = (jd - J2000) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - J2000) + 0.000387933 * T * T - (T * T * T) / 38710000);
}

/** Observer's geocentric position (km) in the equatorial frame (spherical Earth). */
function observerVector(jd, lat, lon) {
  const lst = (gmst(jd) + lon) * DEG;
  const phi = lat * DEG;
  return {
    x: EARTH_RADIUS_KM * Math.cos(phi) * Math.cos(lst),
    y: EARTH_RADIUS_KM * Math.cos(phi) * Math.sin(lst),
    z: EARTH_RADIUS_KM * Math.sin(phi),
  };
}

/** Topocentric vector (km) from a geocentric equatorial vector (km). */
export function topocentricVector(geoKm, jd, lat, lon) {
  const o = observerVector(jd, lat, lon);
  return { x: geoKm.x - o.x, y: geoKm.y - o.y, z: geoKm.z - o.z };
}

/**
 * Equatorial (RA/Dec, degrees) → horizontal (az/el, degrees) for an observer.
 * Azimuth is measured clockwise from north.
 */
export function equatorialToAltAz(ra, dec, jd, lat, lon) {
  const H = (gmst(jd) + lon - ra) * DEG;
  const phi = lat * DEG;
  const d = dec * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H)) * RAD;
  const az = norm360(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) * RAD + 180);
  return { az, el };
}

/** Angular separation (degrees) between two RA/Dec directions. */
export function angularSeparation(ra1, dec1, ra2, dec2) {
  const a1 = ra1 * DEG;
  const d1 = dec1 * DEG;
  const a2 = ra2 * DEG;
  const d2 = dec2 * DEG;
  const cosSep = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, cosSep))) * RAD;
}

/**
 * Geocentric position of a body: { ra, dec, distanceKm, distanceAU } plus
 * the equatorial vector in km. Names: 'Sun', 'Moon', or a planet.
 */
export function bodyGeocentric(name, date) {
  const jd = julianDay(date);
  let vecKm;
  if (name === 'Moon') {
    vecKm = moonGeocentricVector(jd); // already equinox of date
  } else {
    const v = name === 'Sun' ? sunGeocentricVector(jd) : planetGeocentricVector(name, jd);
    const s0 = toSpherical(v);
    const p = precessFromJ2000(s0.ra, s0.dec, jd);
    vecKm = fromSpherical(p.ra, p.dec, s0.r * AU_KM);
  }
  const sph = toSpherical(vecKm);
  return { name, ra: sph.ra, dec: sph.dec, distanceKm: sph.r, distanceAU: sph.r / AU_KM, vecKm, jd };
}

/**
 * Topocentric position of a body for an observer: RA/Dec (parallax applied —
 * only matters for the Moon), az/el (geometric), distance, elongation from
 * the Sun (degrees, 0–180) and whether it is east ('evening') or west
 * ('morning') of the Sun.
 */
export function bodyTopocentric(name, date, lat, lon) {
  const geo = bodyGeocentric(name, date);
  const topo = topocentricVector(geo.vecKm, geo.jd, lat, lon);
  const sph = toSpherical(topo);
  const { az, el } = equatorialToAltAz(sph.ra, sph.dec, geo.jd, lat, lon);
  let elongation = null;
  let elongationDir = null;
  if (name !== 'Sun') {
    const sun = bodyGeocentric('Sun', date);
    elongation = angularSeparation(geo.ra, geo.dec, sun.ra, sun.dec);
    // East of the Sun (RA ahead by < 180°) = visible after sunset
    elongationDir = norm360(geo.ra - sun.ra) < 180 ? 'E' : 'W';
  }
  return {
    name,
    ra: sph.ra,
    dec: sph.dec,
    az,
    el,
    distanceKm: sph.r,
    distanceAU: sph.r / AU_KM,
    elongation,
    elongationDir,
  };
}

// Standard rise/set altitude: refraction (−0.566°) plus the upper limb for
// the Sun and Moon. The Moon's parallax is already in the topocentric
// elevation, so no +0.95° term.
const RISE_SET_ALT = { Sun: -0.833, Moon: -0.833 };

/**
 * Next rise and set of a body after `date` within 25 h, scanning
 * topocentric elevation in 10-minute steps and bisecting each horizon
 * crossing to the minute (same approach as geo.getMoonTimes). Either is
 * null when the body never crosses the horizon in the window.
 * @returns {{ rise: Date|null, set: Date|null, transit: Date|null, alwaysUp: boolean, alwaysDown: boolean }}
 */
export function riseSet(name, date, lat, lon) {
  const STEP_MS = 10 * 60 * 1000;
  const WINDOW_MS = 25 * 60 * 60 * 1000;
  const h0 = RISE_SET_ALT[name] ?? -0.566;
  const elAt = (t) => bodyTopocentric(name, new Date(t), lat, lon).el - h0;

  const refine = (lo, hi) => {
    while (hi - lo > 30 * 1000) {
      const mid = (lo + hi) / 2;
      if (elAt(lo) < 0 === elAt(mid) < 0) lo = mid;
      else hi = mid;
    }
    return new Date((lo + hi) / 2);
  };

  let rise = null;
  let set = null;
  let transit = null;
  let maxEl = -Infinity;
  let prevT = date.getTime();
  let prevEl = elAt(prevT);
  let crossings = 0;
  const end = date.getTime() + WINDOW_MS;
  for (let t = prevT + STEP_MS; t <= end; t += STEP_MS) {
    const el = elAt(t);
    if (el > maxEl) {
      maxEl = el;
      transit = new Date(t);
    }
    if (el >= 0 !== prevEl >= 0) {
      crossings++;
      if (el >= 0 && !rise) rise = refine(prevT, t);
      if (el < 0 && !set) set = refine(prevT, t);
    }
    prevT = t;
    prevEl = el;
  }
  return { rise, set, transit, alwaysUp: crossings === 0 && prevEl >= 0, alwaysDown: crossings === 0 && prevEl < 0 };
}

/**
 * One row per body for the Planets panel. Rise/set are computed relative to
 * `date` ("next rise", "next set"), which is what an operator planning a
 * session wants, and are the costliest part (~150 ephemeris evaluations per
 * body) — call once a minute, not per render.
 */
export function planetTable(date, lat, lon, names = BODY_NAMES) {
  return names.map((name) => {
    const pos = bodyTopocentric(name, date, lat, lon);
    const times = riseSet(name, date, lat, lon);
    return { ...pos, ...times };
  });
}

export default {
  PLANET_NAMES,
  BODY_NAMES,
  julianDay,
  heliocentric,
  bodyGeocentric,
  bodyTopocentric,
  riseSet,
  planetTable,
  angularSeparation,
  equatorialToAltAz,
};
