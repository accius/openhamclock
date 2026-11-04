import { describe, it, expect } from 'vitest';
import {
  encodeQR,
  qrToSvg,
  qrToDataUrl,
  rsGenerator,
  rsEncode,
  formatBits,
  versionBits,
  byteCapacity,
  minVersionFor,
  buildCodewords,
  penaltyScore,
  MAX_VERSION,
} from './qrcode.js';

// ── Independent GF(256) helpers for syndrome checking ──────────────────
const EXP = [];
const LOG = [];
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
}
const mul = (a, b) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);
/** Evaluate codeword polynomial at α^i; all zero ⇔ valid RS codeword. */
const syndromes = (codeword, ecCount) =>
  Array.from({ length: ecCount }, (_, i) => codeword.reduce((acc, c) => mul(acc, EXP[i]) ^ c, 0));

// ── Independent (test-side) reader: format → mask → unmask → bits ──────
const MASK_FN = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 10: [6, 28, 52] };

function functionMask(size, version) {
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const block = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++)
      for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < size && c < size) f[r][c] = true;
  };
  block(0, 0, 9, 9); // finder + separator + format
  block(0, size - 8, 9, 8);
  block(size - 8, 0, 8, 9);
  for (let i = 0; i < size; i++) {
    f[6][i] = true;
    f[i][6] = true;
  }
  const centers = ALIGN[version] || [];
  for (const r of centers)
    for (const c of centers) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      block(r - 2, c - 2, 5, 5);
    }
  if (version >= 7) {
    block(0, size - 11, 6, 3);
    block(size - 11, 0, 3, 6);
  }
  return f;
}

function readFormat(modules) {
  const size = modules.length;
  // Second copy, which is independent of the first: bits 0–7 along row 8 from the right edge.
  let bits = 0;
  for (let i = 0; i < 8; i++) bits |= modules[8][size - 1 - i] << i;
  for (let i = 8; i < 15; i++) bits |= modules[size - 15 + i][8] << i;
  return bits ^ 0x5412;
}

function readCodewords(qr) {
  const { size, version, modules } = qr;
  const fmt = readFormat(modules);
  const mask = (fmt >> 10) & 0x7;
  const ecLevel = (fmt >> 13) & 0x3;
  const f = functionMask(size, version);
  const bits = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k++) {
      const r = upward ? size - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (f[r][c]) continue;
        bits.push(modules[r][c] ^ (MASK_FN[mask](r, c) ? 1 : 0));
      }
    }
    upward = !upward;
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes.push(b);
  }
  return { mask, ecLevel, bytes };
}

const EC_INFO = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  10: [
    26,
    [
      [4, 43],
      [1, 44],
    ],
  ],
};

/** De-interleave + syndrome-check every block, return the concatenated data bytes. */
function verifyAndExtract(qr) {
  const { bytes, ecLevel } = readCodewords(qr);
  expect(ecLevel).toBe(0); // M
  const [ecPer, groups] = EC_INFO[qr.version];
  const blocks = [];
  for (const [count, len] of groups) for (let i = 0; i < count; i++) blocks.push({ len, data: [], ec: [] });
  const maxLen = Math.max(...blocks.map((b) => b.len));
  let idx = 0;
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.len) b.data.push(bytes[idx++]);
  for (let i = 0; i < ecPer; i++) for (const b of blocks) b.ec.push(bytes[idx++]);
  const data = [];
  for (const b of blocks) {
    expect(syndromes([...b.data, ...b.ec], ecPer).every((s) => s === 0)).toBe(true);
    data.push(...b.data);
  }
  return data;
}

function decodeByteMode(data, version) {
  const bits = data.flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1));
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bits.shift();
    return v;
  };
  expect(take(4)).toBe(0b0100);
  const len = take(version <= 9 ? 8 : 16);
  const out = [];
  for (let i = 0; i < len; i++) out.push(take(8));
  return new TextDecoder().decode(new Uint8Array(out));
}

// ── Tests ──────────────────────────────────────────────────────────────
describe('Reed–Solomon', () => {
  it('generator polynomial for 7 EC codewords matches the standard table', () => {
    // ISO 18004 Annex A: α exponents 0,87,229,146,149,238,102,21
    expect(rsGenerator(7).map((c) => LOG[c])).toEqual([0, 87, 229, 146, 149, 238, 102, 21]);
  });
  it('generator polynomial for 10 EC codewords matches the standard table', () => {
    expect(rsGenerator(10).map((c) => LOG[c])).toEqual([0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
  });
  it('reproduces the canonical 1-M "HELLO WORLD" EC codewords', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsEncode(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
});

describe('format / version information', () => {
  it('format bits for level M match the published table', () => {
    const table = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
    table.forEach((v, mask) => expect(formatBits(mask)).toBe(v));
  });
  it('version bits match the published table', () => {
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(8)).toBe(0x085bc);
    expect(versionBits(10)).toBe(0x0a4d3);
  });
});

describe('capacity', () => {
  it('byte-mode capacities for level M', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(byteCapacity)).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  });
  it('picks the smallest version that fits', () => {
    expect(minVersionFor(0)).toBe(1);
    expect(minVersionFor(14)).toBe(1);
    expect(minVersionFor(15)).toBe(2);
    expect(minVersionFor(213)).toBe(10);
    expect(minVersionFor(214)).toBe(-1);
  });
  it('throws beyond version 10', () => {
    expect(() => encodeQR('x'.repeat(214))).toThrow(/too long/);
    expect(MAX_VERSION).toBe(10);
  });
});

describe('codeword assembly', () => {
  it('pads with 0xEC/0x11 and yields the full codeword count', () => {
    const cw = buildCodewords([0x41], 1);
    expect(cw).toHaveLength(26);
    // mode 0100 + count 00000001 + 'A' 01000001 + terminator 0000 → 0x40 0x14 0x10 then pads
    expect(cw.slice(0, 3)).toEqual([0x40, 0x14, 0x10]);
    expect(cw.slice(3, 16)).toEqual([0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec]);
  });
  it('interleaves multi-block versions', () => {
    const bytes = Array.from({ length: 80 }, (_, i) => i);
    const cw = buildCodewords(bytes, 5); // 2 blocks × 43 data, 24 EC each
    expect(cw).toHaveLength(134);
    // First data codeword of block 1 is the mode/count header, block 2 starts 43 bytes in
    expect(cw[0]).toBe(0x45); // 0100 + high nibble of count 80 (0x50) → 0x45
  });
});

describe('penalty score', () => {
  it('scores an all-light 21×21 matrix per the four rules', () => {
    const m = Array.from({ length: 21 }, () => new Array(21).fill(0));
    // Rule 1: 21 rows + 21 cols, each a run of 21 → 3 + 16 = 19 → 798
    // Rule 2: 20×20 blocks × 3 = 1200; Rule 3: none; Rule 4: 0% dark → 10 × 10 = 100
    expect(penaltyScore(m)).toBe(798 + 1200 + 100);
  });
  it('a checkerboard scores only the proportion rule', () => {
    const m = Array.from({ length: 20 }, (_, r) => Array.from({ length: 20 }, (_, c) => (r + c) % 2));
    expect(penaltyScore(m)).toBe(0);
  });
});

describe('encodeQR', () => {
  it('produces a version-1 symbol with correct function patterns', () => {
    const qr = encodeQR('HELLO');
    expect(qr.version).toBe(1);
    expect(qr.size).toBe(21);
    expect(qr.ecLevel).toBe('M');
    // Finder pattern rows
    expect(qr.modules[0].slice(0, 7)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(qr.modules[1].slice(0, 7)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(qr.modules[3].slice(0, 7)).toEqual([1, 0, 1, 1, 1, 0, 1]);
    expect(qr.modules[0].slice(14)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(qr.modules[20].slice(0, 7)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    // Separators are light
    expect(qr.modules[7].slice(0, 8).every((v) => v === 0)).toBe(true);
    // Timing pattern alternates, starting dark at (6,8)
    expect(qr.modules[6].slice(8, 13)).toEqual([1, 0, 1, 0, 1]);
    // Dark module
    expect(qr.modules[13][8]).toBe(1);
  });

  it('writes identical format information in both copies', () => {
    const qr = encodeQR('format check');
    const size = qr.size;
    const expected = formatBits(qr.mask);
    let first = 0;
    for (let i = 0; i <= 5; i++) first |= qr.modules[i][8] << i;
    first |= qr.modules[7][8] << 6;
    first |= qr.modules[8][8] << 7;
    first |= qr.modules[8][7] << 8;
    for (let i = 9; i < 15; i++) first |= qr.modules[8][14 - i] << i;
    expect(first).toBe(expected);
    expect(readFormat(qr.modules) ^ 0x5412).toBe(expected);
    void size;
  });

  it('round-trips text through an independent reader (v1, v2, v4, v5, v6, v7, v10)', () => {
    const samples = [
      'Hi',
      'http://ohc.local/r?t=1',
      'https://openhamclock.com/remote?target=abc123',
      'https://openhamclock.com/remote?target=abcdefghijklmnop&key=0123456789abcdef0123',
      'https://openhamclock.com/remote?target=abcdefghijklmnop&key=0123456789abcdef0123456789abcdef',
      'x'.repeat(110),
      'The quick brown fox jumps over the lazy dog. ' + 'y'.repeat(150),
    ];
    const versions = [1, 2, 4, 5, 6, 7, 10];
    samples.forEach((text, i) => {
      const qr = encodeQR(text);
      expect(qr.version).toBe(versions[i]);
      const data = verifyAndExtract(qr);
      expect(decodeByteMode(data, qr.version)).toBe(text);
    });
  });

  it('encodes UTF-8 bytes', () => {
    const qr = encodeQR('Grüße 73 ✓');
    expect(decodeByteMode(verifyAndExtract(qr), qr.version)).toBe('Grüße 73 ✓');
  });

  it('draws alignment patterns, including the one in the timing row for v7', () => {
    const qr = encodeQR('x'.repeat(110)); // v7, centres 6/22/38
    const ring = (r, c) => [qr.modules[r][c], qr.modules[r - 1][c - 1], qr.modules[r - 2][c - 2]];
    expect(ring(22, 22)).toEqual([1, 0, 1]);
    expect(ring(6, 22)).toEqual([1, 0, 1]);
    expect(ring(22, 6)).toEqual([1, 0, 1]);
    // Version info present (v ≥ 7): bit 0 at (0, size-11)
    expect(qr.modules[0][qr.size - 11]).toBe(versionBits(7) & 1);
  });

  it('honours a forced mask and auto-selects the lowest penalty otherwise', () => {
    const text = 'mask selection';
    const forced = encodeQR(text, { mask: 3 });
    expect(forced.mask).toBe(3);
    const auto = encodeQR(text);
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => penaltyScore(encodeQR(text, { mask: m }).modules));
    expect(penaltyScore(auto.modules)).toBe(Math.min(...scores));
  });

  it('renders SVG and data URLs', () => {
    const qr = encodeQR('svg');
    const svg = qrToSvg(qr, { margin: 2, size: 200 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 25 25"');
    expect(svg).toContain('width="200"');
    expect(qrToDataUrl('svg').startsWith('data:image/svg+xml')).toBe(true);
  });
});
