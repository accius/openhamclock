/**
 * Minimal QR Code encoder — byte mode, versions 1–10, error-correction
 * level M, automatic mask selection by ISO 18004 penalty scoring.
 *
 * Zero dependencies (~300 lines). Used for the "scan to open the phone
 * remote" code in Settings → Station and the `?` keyboard overlay. Capacity
 * at level M is 213 bytes (version 10), far more than a remote URL needs.
 *
 *   const qr = encodeQR('https://example.com/remote?target=abc');
 *   qr.size            // 25 (modules per side)
 *   qr.modules[r][c]   // 1 = dark, 0 = light
 *   qrToSvg(qr, { margin: 4 })  // '<svg …>' string
 */

// ── Tables (EC level M only) ───────────────────────────────────────────
// [totalCodewords, ecCodewordsPerBlock, [ [blockCount, dataCodewordsPerBlock], ... ]]
const EC_M = [
  null,
  [26, 10, [[1, 16]]],
  [44, 16, [[1, 28]]],
  [70, 26, [[1, 44]]],
  [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]],
  [196, 18, [[4, 31]]],
  [
    242,
    22,
    [
      [2, 38],
      [2, 39],
    ],
  ],
  [
    292,
    22,
    [
      [3, 36],
      [2, 37],
    ],
  ],
  [
    346,
    26,
    [
      [4, 43],
      [1, 44],
    ],
  ],
];

const ALIGNMENT = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 52],
];
const REMAINDER_BITS = [null, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

export const MAX_VERSION = 10;
export const EC_LEVEL = 'M';

// ── GF(256) arithmetic (primitive polynomial 0x11D) ────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial coefficients for `n` EC codewords (highest degree first, leading 1). */
export function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** Reed–Solomon EC codewords for `data` (array of bytes). */
export function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const rem = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

// ── BCH format / version information ───────────────────────────────────
function bchRemainder(value, poly, polyBits) {
  let v = value;
  for (let i = polyBits - 1; i >= 0; i--) {
    if ((v >>> (i + polyBits - 1)) & 1) v ^= poly << i;
  }
  return v;
}

/** 15-bit format information for EC level M and `mask` (0–7), pre-XORed. */
export function formatBits(mask) {
  const data = (0b00 << 3) | mask; // M = 00
  const rem = bchRemainder(data << 10, 0x537, 11);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version information (versions 7+). */
export function versionBits(version) {
  const rem = bchRemainder(version << 12, 0x1f25, 13);
  return (version << 12) | rem;
}

// ── Capacity / version choice ──────────────────────────────────────────
const dataCodewords = (v) => EC_M[v][2].reduce((n, [count, len]) => n + count * len, 0);
const countBits = (v) => (v <= 9 ? 8 : 16);

/** Max byte-mode payload length for a version at level M. */
export function byteCapacity(version) {
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits(version)) / 8);
}

export function minVersionFor(byteLength) {
  for (let v = 1; v <= MAX_VERSION; v++) if (byteCapacity(v) >= byteLength) return v;
  return -1;
}

// ── Bit buffer ─────────────────────────────────────────────────────────
class BitBuffer {
  constructor() {
    this.bits = [];
  }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
  toBytes() {
    const out = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      out.push(b);
    }
    return out;
  }
}

/** Build the final interleaved codeword sequence for `bytes` at `version`. */
export function buildCodewords(bytes, version) {
  const [, ecPerBlock, groups] = EC_M[version];
  const dataLen = dataCodewords(version);
  const bb = new BitBuffer();
  bb.push(0b0100, 4);
  bb.push(bytes.length, countBits(version));
  for (const b of bytes) bb.push(b, 8);
  const capacityBits = dataLen * 8;
  bb.push(0, Math.min(4, capacityBits - bb.length)); // terminator
  while (bb.length % 8 !== 0) bb.push(0, 1);
  const data = bb.toBytes();
  for (let i = 0; data.length < dataLen; i++) data.push(i % 2 === 0 ? 0xec : 0x11);

  // Split into blocks, compute EC, interleave.
  const blocks = [];
  let offset = 0;
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      const d = data.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: d, ec: rsEncode(d, ecPerBlock) });
    }
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

// ── Matrix construction ────────────────────────────────────────────────
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function makeMatrix(size) {
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));
  return { modules, reserved };
}

function setFunction(m, r, c, dark) {
  m.modules[r][c] = dark ? 1 : 0;
  m.reserved[r][c] = 1;
}

function drawFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.modules.length || cc >= m.modules.length) continue;
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      setFunction(m, rr, cc, inOuter && (ring || core));
    }
  }
}

function drawAlignment(m, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      setFunction(m, row + r, col + c, dark);
    }
  }
}

function drawFunctionPatterns(m, version) {
  const size = m.modules.length;
  drawFinder(m, 0, 0);
  drawFinder(m, 0, size - 7);
  drawFinder(m, size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    setFunction(m, 6, i, i % 2 === 0);
    setFunction(m, i, 6, i % 2 === 0);
  }
  const centers = ALIGNMENT[version];
  const inFinder = (r, c) => (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
  for (const r of centers) {
    for (const c of centers) {
      if (inFinder(r, c)) continue; // the three finder corners have no alignment pattern
      drawAlignment(m, r, c);
    }
  }
  setFunction(m, size - 8, 8, true); // dark module
  // Reserve format areas (filled in later).
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setFunction(m, 8, i, false);
      setFunction(m, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunction(m, 8, size - 1 - i, false);
    if (i < 7) setFunction(m, size - 1 - i, 8, false);
  }
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunction(m, a, b, bit);
      setFunction(m, b, a, bit);
    }
  }
}

function drawFormat(m, mask) {
  const size = m.modules.length;
  const bits = formatBits(mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  // First copy around the top-left finder (ISO 18004 fig. 25): bits 0–5 down
  // column 8, bit 6 at (7,8), bit 7 at (8,8), bit 8 at (8,7), bits 9–14 along
  // row 8 towards column 0.
  for (let i = 0; i <= 5; i++) m.modules[i][8] = bit(i) ? 1 : 0;
  m.modules[7][8] = bit(6) ? 1 : 0;
  m.modules[8][8] = bit(7) ? 1 : 0;
  m.modules[8][7] = bit(8) ? 1 : 0;
  for (let i = 9; i < 15; i++) m.modules[8][14 - i] = bit(i) ? 1 : 0;
  // Second copy: bits 0–7 along row 8 under the top-right finder (from the
  // right edge inwards), bits 8–14 down column 8 beside the bottom-left finder.
  for (let i = 0; i < 8; i++) m.modules[8][size - 1 - i] = bit(i) ? 1 : 0;
  for (let i = 8; i < 15; i++) m.modules[size - 15 + i][8] = bit(i) ? 1 : 0;
  m.modules[size - 8][8] = 1; // dark module stays dark
}

function placeData(m, codewords, version) {
  const size = m.modules.length;
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  for (let i = 0; i < REMAINDER_BITS[version]; i++) bits.push(0);
  let idx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k++) {
      const r = upward ? size - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (m.reserved[r][c]) continue;
        m.modules[r][c] = idx < bits.length ? bits[idx] : 0;
        idx += 1;
      }
    }
    upward = !upward;
  }
}

function applyMask(m, mask) {
  const size = m.modules.length;
  const fn = MASKS[mask];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!m.reserved[r][c] && fn(r, c)) m.modules[r][c] ^= 1;
    }
  }
}

/** ISO 18004 §7.8.3 penalty score for a module matrix (array of rows, 1 = dark). */
export function penaltyScore(modules) {
  const size = modules.length;
  let score = 0;
  const at = (r, c) => modules[r][c] === 1;

  // Rule 1: runs of ≥5 identical modules in rows and columns.
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j <= size; j++) {
        const cur = j < size ? (horizontal ? at(i, j) : at(j, i)) : null;
        const prev = horizontal ? at(i, j - 1) : at(j - 1, i);
        if (j < size && cur === prev) {
          run += 1;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
    }
  }
  // Rule 2: 2×2 blocks of the same colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (at(r, c + 1) === v && at(r + 1, c) === v && at(r + 1, c + 1) === v) score += 3;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 pattern with 4 light modules on either side.
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const matches = (get, start) => {
    for (let k = 0; k < 7; k++) if ((get(start + k) ? 1 : 0) !== pattern[k]) return false;
    const before = start >= 4 && [1, 2, 3, 4].every((d) => !get(start - d));
    const after = start + 10 < size && [7, 8, 9, 10].every((d) => !get(start + d));
    return before || after;
  };
  for (let i = 0; i < size; i++) {
    const row = (j) => at(i, j);
    const col = (j) => at(j, i);
    for (let j = 0; j <= size - 7; j++) {
      if (matches(row, j)) score += 40;
      if (matches(col, j)) score += 40;
    }
  }
  // Rule 4: dark-module proportion.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += modules[r][c];
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

const utf8 = (text) => {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
  const out = [];
  for (const ch of unescape(encodeURIComponent(text))) out.push(ch.charCodeAt(0));
  return out;
};

/**
 * Encode text (UTF-8, byte mode) → { version, size, mask, modules }.
 * @param {string|number[]} input  text or raw bytes
 * @param {{ mask?: number }} [opts]  force a mask (0–7) instead of auto-selecting
 */
export function encodeQR(input, opts = {}) {
  const bytes = typeof input === 'string' ? utf8(input) : Array.from(input);
  const version = minVersionFor(bytes.length);
  if (version < 0)
    throw new Error(
      `QR payload too long: ${bytes.length} bytes > ${byteCapacity(MAX_VERSION)} (version ${MAX_VERSION}-M)`,
    );
  const size = version * 4 + 17;
  const codewords = buildCodewords(bytes, version);

  const candidates =
    Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask <= 7 ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  let best = null;
  for (const mask of candidates) {
    const m = makeMatrix(size);
    drawFunctionPatterns(m, version);
    placeData(m, codewords, version);
    applyMask(m, mask);
    drawFormat(m, mask);
    const score = penaltyScore(m.modules);
    if (!best || score < best.score) best = { mask, score, modules: m.modules };
  }
  return {
    version,
    size,
    mask: best.mask,
    ecLevel: EC_LEVEL,
    modules: best.modules.map((row) => Array.from(row)),
  };
}

/** Render a QR matrix as an SVG string (one <path> for all dark modules). */
export function qrToSvg(qr, { margin = 4, dark = '#000', light = '#fff', size } = {}) {
  const dim = qr.size + margin * 2;
  let d = '';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const px = size ? ` width="${size}" height="${size}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}"${px} shape-rendering="crispEdges" role="img">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`
  );
}

/** Convenience: data: URL for an <img src>. */
export function qrToDataUrl(text, opts = {}) {
  const svg = qrToSvg(encodeQR(text), opts);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default encodeQR;
