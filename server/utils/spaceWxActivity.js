/**
 * Reductions of the two big space-weather map products to the single
 * numbers the "Auto space-weather layer" feature keys on:
 *   - OVATION aurora: peak probability (%) anywhere on the grid
 *   - D-RAP: highest affected frequency (MHz) anywhere on the grid
 *
 * Kept pure so the thresholds/hysteresis can be unit-tested against
 * synthetic grids without a server.
 */

/**
 * Peak aurora probability from an OVATION coordinates array
 * ([[lon, lat, prob], ...]). Returns { max, lat, lon } or max = 0 for empty.
 */
function auroraPeak(coordinates) {
  let max = 0;
  let lat = null;
  let lon = null;
  if (!Array.isArray(coordinates)) return { max, lat, lon };
  for (const c of coordinates) {
    const p = Array.isArray(c) ? Number(c[2]) : NaN;
    if (Number.isFinite(p) && p > max) {
      max = p;
      lon = c[0];
      lat = c[1];
    }
  }
  return { max, lat, lon };
}

/**
 * Highest affected frequency in a D-RAP global frequencies text product.
 * Data rows look like " 89 |  0.4  0.4 ..."; comment lines start with '#'.
 * Returns { maxFreq, validAt }.
 */
function drapMaxFreq(text) {
  let maxFreq = 0;
  let validAt = null;
  if (typeof text !== 'string') return { maxFreq, validAt };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = line.match(/Product Valid At\s*:\s*(.+)$/i);
      if (m) validAt = m[1].trim();
      continue;
    }
    const bar = line.indexOf('|');
    if (bar < 0) continue;
    for (const tok of line
      .slice(bar + 1)
      .trim()
      .split(/\s+/)) {
      const f = parseFloat(tok);
      if (Number.isFinite(f) && f > maxFreq) maxFreq = f;
    }
  }
  return { maxFreq: Math.round(maxFreq * 10) / 10, validAt };
}

module.exports = { auroraPeak, drapMaxFreq };
