/**
 * Small WCAG helpers for badge palettes. Mirrors the math in
 * src/utils/contrast.js (that module is ESM; the server is CommonJS).
 */

function parseHex(color) {
  const m = String(color || '')
    .trim()
    .match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function toHex(rgb) {
  return `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function relativeLuminance(color) {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mixHex(a, b, t) {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return a;
  return toHex(ra.map((v, i) => v + (rb[i] - v) * t));
}

/** Darken or lighten `color` until it clears `minRatio` against `bg`. */
function ensureTextContrast(color, bg, minRatio = 4.5) {
  const current = contrastRatio(color, bg);
  if (current == null || current >= minRatio) return color;
  const bgLum = relativeLuminance(bg);
  const target = bgLum > 0.5 ? '#000000' : '#ffffff';
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if ((contrastRatio(mixHex(color, target, mid), bg) ?? 0) >= minRatio) hi = mid;
    else lo = mid;
  }
  const result = mixHex(color, target, hi);
  return (contrastRatio(result, bg) ?? 0) >= minRatio ? result : target;
}

module.exports = { parseHex, toHex, mixHex, contrastRatio, relativeLuminance, ensureTextContrast };
