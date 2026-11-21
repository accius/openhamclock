/**
 * LUF from the same P.533 band results the panel shows.
 *
 * The Propagation panel used to take its LUF from the server's quick estimate
 * (server/utils/propagationPhysics.js calculateLUF), which knows nothing about
 * mode, power or antenna, while the band bars come from the ITU-R P.533 engine
 * run at the selected mode's decode threshold. With FT8 selected the two could
 * disagree outright: W3AAX saw "LUF 2.4 MHz" above a 160m bar at 75%. Taking
 * the LUF from the band results keeps the numbers on screen consistent.
 *
 * LUF here = the lowest modelled band whose reliability reaches
 * `minReliability` percent (the usual 50% "usable" line), in MHz to one
 * decimal. 160m is the lowest band modelled, so an open 160m reads as its own
 * frequency (the true LUF may be lower). Null when no band reaches the line —
 * callers fall back to the estimate then.
 */
export function lufFromBands(bands, minReliability = 50) {
  let lowest = null;
  for (const b of Array.isArray(bands) ? bands : []) {
    const f = Number(b?.freq);
    if (!Number.isFinite(f) || f <= 0) continue;
    if (!(Number(b?.reliability) >= minReliability)) continue;
    if (lowest == null || f < lowest) lowest = f;
  }
  return lowest == null ? null : Math.round(lowest * 10) / 10;
}
