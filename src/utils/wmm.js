/**
 * World Magnetic Model (WMM2025) — magnetic declination for any point.
 *
 * A straight implementation of the spherical-harmonic model described in
 * the NOAA/NCEI–BGS WMM technical report: geodetic → geocentric
 * conversion on the WGS84 ellipsoid, Schmidt semi-normalised associated
 * Legendre functions by recursion, the three geocentric field components,
 * then rotation back into the geodetic frame. Degree/order 12, secular
 * variation applied linearly from the 2025.0 epoch (valid 2025.0–2030.0).
 *
 * Exports declination (D, degrees east of true north) plus the full
 * vector, which the test suite checks against the published WMM2025 test
 * values (WMM2025_TEST_VALUES.txt, NCEI, Feb 2025).
 *
 * Coefficients are the official WMM2025.COF release (11/13/2024).
 */

const EPOCH = 2025.0;
const MAX_DEGREE = 12;

const WGS84_A = 6378.137; // km, semi-major axis
const WGS84_B = 6356.7523142; // km, semi-minor axis
const RE = 6371.2; // km, geomagnetic reference radius

// [n, m, g (nT), h (nT), g-dot (nT/yr), h-dot (nT/yr)] — WMM2025.COF
const COEFFICIENTS = [
  [1, 0, -29351.8, 0.0, 12.0, 0.0],
  [1, 1, -1410.8, 4545.4, 9.7, -21.5],
  [2, 0, -2556.6, 0.0, -11.6, 0.0],
  [2, 1, 2951.1, -3133.6, -5.2, -27.7],
  [2, 2, 1649.3, -815.1, -8.0, -12.1],
  [3, 0, 1361.0, 0.0, -1.3, 0.0],
  [3, 1, -2404.1, -56.6, -4.2, 4.0],
  [3, 2, 1243.8, 237.5, 0.4, -0.3],
  [3, 3, 453.6, -549.5, -15.6, -4.1],
  [4, 0, 895.0, 0.0, -1.6, 0.0],
  [4, 1, 799.5, 278.6, -2.4, -1.1],
  [4, 2, 55.7, -133.9, -6.0, 4.1],
  [4, 3, -281.1, 212.0, 5.6, 1.6],
  [4, 4, 12.1, -375.6, -7.0, -4.4],
  [5, 0, -233.2, 0.0, 0.6, 0.0],
  [5, 1, 368.9, 45.4, 1.4, -0.5],
  [5, 2, 187.2, 220.2, 0.0, 2.2],
  [5, 3, -138.7, -122.9, 0.6, 0.4],
  [5, 4, -142.0, 43.0, 2.2, 1.7],
  [5, 5, 20.9, 106.1, 0.9, 1.9],
  [6, 0, 64.4, 0.0, -0.2, 0.0],
  [6, 1, 63.8, -18.4, -0.4, 0.3],
  [6, 2, 76.9, 16.8, 0.9, -1.6],
  [6, 3, -115.7, 48.8, 1.2, -0.4],
  [6, 4, -40.9, -59.8, -0.9, 0.9],
  [6, 5, 14.9, 10.9, 0.3, 0.7],
  [6, 6, -60.7, 72.7, 0.9, 0.9],
  [7, 0, 79.5, 0.0, -0.0, 0.0],
  [7, 1, -77.0, -48.9, -0.1, 0.6],
  [7, 2, -8.8, -14.4, -0.1, 0.5],
  [7, 3, 59.3, -1.0, 0.5, -0.8],
  [7, 4, 15.8, 23.4, -0.1, 0.0],
  [7, 5, 2.5, -7.4, -0.8, -1.0],
  [7, 6, -11.1, -25.1, -0.8, 0.6],
  [7, 7, 14.2, -2.3, 0.8, -0.2],
  [8, 0, 23.2, 0.0, -0.1, 0.0],
  [8, 1, 10.8, 7.1, 0.2, -0.2],
  [8, 2, -17.5, -12.6, 0.0, 0.5],
  [8, 3, 2.0, 11.4, 0.5, -0.4],
  [8, 4, -21.7, -9.7, -0.1, 0.4],
  [8, 5, 16.9, 12.7, 0.3, -0.5],
  [8, 6, 15.0, 0.7, 0.2, -0.6],
  [8, 7, -16.8, -5.2, -0.0, 0.3],
  [8, 8, 0.9, 3.9, 0.2, 0.2],
  [9, 0, 4.6, 0.0, -0.0, 0.0],
  [9, 1, 7.8, -24.8, -0.1, -0.3],
  [9, 2, 3.0, 12.2, 0.1, 0.3],
  [9, 3, -0.2, 8.3, 0.3, -0.3],
  [9, 4, -2.5, -3.3, -0.3, 0.3],
  [9, 5, -13.1, -5.2, 0.0, 0.2],
  [9, 6, 2.4, 7.2, 0.3, -0.1],
  [9, 7, 8.6, -0.6, -0.1, -0.2],
  [9, 8, -8.7, 0.8, 0.1, 0.4],
  [9, 9, -12.9, 10.0, -0.1, 0.1],
  [10, 0, -1.3, 0.0, 0.1, 0.0],
  [10, 1, -6.4, 3.3, 0.0, 0.0],
  [10, 2, 0.2, 0.0, 0.1, -0.0],
  [10, 3, 2.0, 2.4, 0.1, -0.2],
  [10, 4, -1.0, 5.3, -0.0, 0.1],
  [10, 5, -0.6, -9.1, -0.3, -0.1],
  [10, 6, -0.9, 0.4, 0.0, 0.1],
  [10, 7, 1.5, -4.2, -0.1, 0.0],
  [10, 8, 0.9, -3.8, -0.1, -0.1],
  [10, 9, -2.7, 0.9, -0.0, 0.2],
  [10, 10, -3.9, -9.1, -0.0, -0.0],
  [11, 0, 2.9, 0.0, 0.0, 0.0],
  [11, 1, -1.5, 0.0, -0.0, -0.0],
  [11, 2, -2.5, 2.9, 0.0, 0.1],
  [11, 3, 2.4, -0.6, 0.0, -0.0],
  [11, 4, -0.6, 0.2, 0.0, 0.1],
  [11, 5, -0.1, 0.5, -0.1, -0.0],
  [11, 6, -0.6, -0.3, 0.0, -0.0],
  [11, 7, -0.1, -1.2, -0.0, 0.1],
  [11, 8, 1.1, -1.7, -0.1, -0.0],
  [11, 9, -1.0, -2.9, -0.1, 0.0],
  [11, 10, -0.2, -1.8, -0.1, 0.0],
  [11, 11, 2.6, -2.3, -0.1, 0.0],
  [12, 0, -2.0, 0.0, 0.0, 0.0],
  [12, 1, -0.2, -1.3, 0.0, -0.0],
  [12, 2, 0.3, 0.7, -0.0, 0.0],
  [12, 3, 1.2, 1.0, -0.0, -0.1],
  [12, 4, -1.3, -1.4, -0.0, 0.1],
  [12, 5, 0.6, -0.0, -0.0, -0.0],
  [12, 6, 0.6, 0.6, 0.1, -0.0],
  [12, 7, 0.5, -0.1, -0.0, -0.0],
  [12, 8, -0.1, 0.8, 0.0, 0.0],
  [12, 9, -0.4, 0.1, 0.0, -0.0],
  [12, 10, -0.2, -1.0, -0.1, -0.0],
  [12, 11, -1.3, 0.1, -0.0, 0.0],
  [12, 12, -0.7, 0.2, -0.1, -0.1],
];

// Index coefficients as g[n][m], h[n][m] once at module load.
const G = [];
const H = [];
const GDOT = [];
const HDOT = [];
for (let n = 0; n <= MAX_DEGREE; n++) {
  G.push(new Array(n + 1).fill(0));
  H.push(new Array(n + 1).fill(0));
  GDOT.push(new Array(n + 1).fill(0));
  HDOT.push(new Array(n + 1).fill(0));
}
for (const [n, m, g, h, gd, hd] of COEFFICIENTS) {
  G[n][m] = g;
  H[n][m] = h;
  GDOT[n][m] = gd;
  HDOT[n][m] = hd;
}

const DEG = Math.PI / 180;

/** Decimal year (e.g. 2026.45) for a Date. */
export function decimalYear(date = new Date()) {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

/**
 * Full magnetic field vector at a point.
 *
 * @param {number} lat   geodetic latitude, degrees (+N)
 * @param {number} lon   longitude, degrees (+E)
 * @param {number} altKm height above the WGS84 ellipsoid, km (default 0)
 * @param {number|Date} when decimal year or Date (default now)
 * @returns {{ x:number, y:number, z:number, h:number, f:number, declination:number, inclination:number }}
 *   nT components (x north, y east, z down), horizontal intensity h, total
 *   intensity f, declination and inclination in degrees.
 */
export function magneticField(lat, lon, altKm = 0, when = new Date()) {
  const t = typeof when === 'number' ? when : decimalYear(when);
  const dt = t - EPOCH;

  // ── Geodetic → geocentric spherical ──────────────────────────────────
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const e2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
  const rc = WGS84_A / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const p = (rc + altKm) * cosPhi;
  const zc = (rc * (1 - e2) + altKm) * sinPhi;
  const r = Math.sqrt(p * p + zc * zc);
  const phiPrime = Math.asin(zc / r); // geocentric latitude
  // Colatitude θ for the Legendre recursion
  const cosTheta = Math.sin(phiPrime);
  const sinTheta = Math.cos(phiPrime);

  // ── Schmidt semi-normalised P(n,m) and dP/dθ by recursion ───────────
  const P = [];
  const dP = [];
  for (let n = 0; n <= MAX_DEGREE; n++) {
    P.push(new Array(n + 1).fill(0));
    dP.push(new Array(n + 1).fill(0));
  }
  P[0][0] = 1;
  dP[0][0] = 0;
  for (let n = 1; n <= MAX_DEGREE; n++) {
    for (let m = 0; m <= n; m++) {
      if (m === n) {
        const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
        P[n][n] = k * sinTheta * P[n - 1][n - 1];
        dP[n][n] = k * (sinTheta * dP[n - 1][n - 1] + cosTheta * P[n - 1][n - 1]);
      } else {
        const denom = Math.sqrt(n * n - m * m);
        const a = (2 * n - 1) / denom;
        const b = n - 1 >= m ? Math.sqrt((n - 1) * (n - 1) - m * m) / denom : 0;
        const pPrev2 = n - 2 >= m ? P[n - 2][m] : 0;
        const dpPrev2 = n - 2 >= m ? dP[n - 2][m] : 0;
        P[n][m] = a * cosTheta * P[n - 1][m] - b * pPrev2;
        dP[n][m] = a * (cosTheta * dP[n - 1][m] - sinTheta * P[n - 1][m]) - b * dpPrev2;
      }
    }
  }

  // ── Field components in the geocentric frame ────────────────────────
  // X' =  Σ (a/r)^(n+2) Σ (g cos mλ + h sin mλ) dP/dθ   (dP/dφ' = −dP/dθ)
  // Y' = (1/sinθ) Σ (a/r)^(n+2) Σ m (g sin mλ − h cos mλ) P
  // Z' = -Σ (n+1)(a/r)^(n+2) Σ (g cos mλ + h sin mλ) P
  let xP = 0;
  let yP = 0;
  let zP = 0;
  const ar = RE / r;
  let arn = ar * ar; // becomes (a/r)^(n+2) after the multiply at the top of each n
  for (let n = 1; n <= MAX_DEGREE; n++) {
    arn *= ar;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let m = 0; m <= n; m++) {
      const g = G[n][m] + dt * GDOT[n][m];
      const h = H[n][m] + dt * HDOT[n][m];
      const cosML = Math.cos(m * lambda);
      const sinML = Math.sin(m * lambda);
      const gc = g * cosML + h * sinML;
      sx += gc * dP[n][m];
      sy += m * (g * sinML - h * cosML) * P[n][m];
      sz += gc * P[n][m];
    }
    xP += arn * sx;
    yP += arn * sy;
    zP += -arn * (n + 1) * sz;
  }
  // Y' divides by sinθ; at the exact pole the horizontal field is
  // undefined anyway — guard so callers always get finite numbers.
  yP = Math.abs(sinTheta) < 1e-10 ? 0 : yP / sinTheta;

  // ── Rotate geocentric → geodetic ────────────────────────────────────
  const psi = phiPrime - phi;
  const x = xP * Math.cos(psi) - zP * Math.sin(psi);
  const z = xP * Math.sin(psi) + zP * Math.cos(psi);
  const y = yP;

  const hIntensity = Math.sqrt(x * x + y * y);
  const f = Math.sqrt(hIntensity * hIntensity + z * z);
  return {
    x,
    y,
    z,
    h: hIntensity,
    f,
    declination: Math.atan2(y, x) / DEG,
    inclination: Math.atan2(z, hIntensity) / DEG,
  };
}

/**
 * Magnetic declination (variation) in degrees, positive east of true north.
 * Returns null for invalid input.
 */
export function declination(lat, lon, altKm = 0, when = new Date()) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  return magneticField(lat, lon, Number.isFinite(altKm) ? altKm : 0, when).declination;
}

/** Convert a true bearing to a magnetic bearing (0–360) using the local declination. */
export function trueToMagnetic(trueDeg, lat, lon, altKm = 0, when = new Date()) {
  const d = declination(lat, lon, altKm, when);
  if (d == null || !Number.isFinite(trueDeg)) return trueDeg;
  return (((trueDeg - d) % 360) + 360) % 360;
}

export const WMM_EPOCH = EPOCH;
export const WMM_VALID_UNTIL = EPOCH + 5;
