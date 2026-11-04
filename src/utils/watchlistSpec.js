/**
 * watchlistSpec — HamClock-style watch lists.
 *
 * A watch list is a comma-separated list of *specs*. A spot matches the list
 * when it satisfies ANY spec; it satisfies a spec when it meets ALL of that
 * spec's requirements. Each spec is a whitespace-separated set of tokens:
 *
 *   40M          band                       20-10M      band range (inclusive)
 *   40CW         sub-band mode              160-10CW    sub-band mode over a range
 *   14-14.02MHZ  frequency range in MHz     14.074MHZ   single frequency (±0.5 kHz)
 *   NADXCC       DXCC entity not yet in the native logbook
 *   NAPREF       WPX prefix not yet in the logbook
 *   NAGRID       4-character grid not yet in the logbook (spot needs a grid)
 *   NABAND       band not yet in the logbook
 *   VP2E  K1  3Y/ prefixes; a trailing "/" matches the DX portion only
 *
 * Within one spec the band / frequency tokens OR together (a spot can only be
 * on one frequency), the prefixes OR together, and the ADIF keywords AND —
 * so "20M NADXCC 3Y" means "a 3Y call on 20 m whose entity I still need".
 *
 * Sub-band modes (CW, DATA, FT4, FT8, RTTY, SSB) are plain frequency windows
 * from the band plan table below, exactly like HamClock — a spot comment is
 * never consulted. DATA covers the whole digital segment (FT8/FT4/RTTY/PSK).
 *
 * Portable calls are split into a DX portion (the operating-entity prefix)
 * and a home portion, following HamClock's rules: "/MM", "/AM", single
 * characters, digit-only parts and 3+ letter parts without a digit are
 * ignored; of what remains the non-callsign (or shorter) part is the DX
 * portion.
 *
 * Every list carries a mode: off (ignored), red (highlight matches), only
 * (show only matches), not (hide matches).
 */
import { normalizeFrequencyToMHz } from './callsign.js';

export const WATCHLIST_MODES = ['off', 'red', 'only', 'not'];
export const WATCHLIST_ADIF_KEYWORDS = ['NADXCC', 'NAPREF', 'NAGRID', 'NABAND'];
export const WATCHLIST_SUBBAND_MODES = ['CW', 'DATA', 'FT4', 'FT8', 'RTTY', 'SSB'];
export const WATCHLIST_MAX_LENGTH = 1000;

/**
 * Band plan used for band and sub-band tokens — edges in kHz. The mode
 * windows follow common IARU / WSJT-X practice; they are deliberately a
 * little generous because spots sit a few hundred Hz off the dial frequency.
 * 30 m has no SSB window; "30SSB" simply never matches.
 */
export const WATCHLIST_BAND_PLAN = [
  {
    name: '160m',
    meters: 160,
    lo: 1800,
    hi: 2000,
    CW: [1800, 1840],
    RTTY: [1800, 1840],
    FT8: [1840, 1843],
    FT4: [1840, 1843],
    DATA: [1838, 1843],
    SSB: [1843, 2000],
  },
  {
    name: '80m',
    meters: 80,
    lo: 3500,
    hi: 4000,
    CW: [3500, 3600],
    RTTY: [3570, 3600],
    FT8: [3573, 3576],
    FT4: [3575, 3578],
    DATA: [3570, 3600],
    SSB: [3600, 4000],
  },
  {
    name: '60m',
    meters: 60,
    lo: 5330,
    hi: 5405,
    CW: [5330, 5405],
    RTTY: [5330, 5405],
    FT8: [5357, 5360],
    FT4: [5357, 5360],
    DATA: [5357, 5360],
    SSB: [5330, 5405],
  },
  {
    name: '40m',
    meters: 40,
    lo: 7000,
    hi: 7300,
    CW: [7000, 7040],
    RTTY: [7040, 7070],
    FT8: [7074, 7077],
    FT4: [7047.5, 7050.5],
    DATA: [7040, 7080],
    SSB: [7080, 7300],
  },
  {
    name: '30m',
    meters: 30,
    lo: 10100,
    hi: 10150,
    CW: [10100, 10130],
    RTTY: [10130, 10150],
    FT8: [10136, 10139],
    FT4: [10140, 10143],
    DATA: [10130, 10150],
    SSB: null,
  },
  {
    name: '20m',
    meters: 20,
    lo: 14000,
    hi: 14350,
    CW: [14000, 14070],
    RTTY: [14070, 14099],
    FT8: [14074, 14077],
    FT4: [14080, 14083],
    DATA: [14070, 14112],
    SSB: [14112, 14350],
  },
  {
    name: '17m',
    meters: 17,
    lo: 18068,
    hi: 18168,
    CW: [18068, 18095],
    RTTY: [18095, 18110],
    FT8: [18100, 18103],
    FT4: [18104, 18107],
    DATA: [18095, 18110],
    SSB: [18110, 18168],
  },
  {
    name: '15m',
    meters: 15,
    lo: 21000,
    hi: 21450,
    CW: [21000, 21070],
    RTTY: [21070, 21100],
    FT8: [21074, 21077],
    FT4: [21140, 21143],
    DATA: [21070, 21150],
    SSB: [21150, 21450],
  },
  {
    name: '12m',
    meters: 12,
    lo: 24890,
    hi: 24990,
    CW: [24890, 24915],
    RTTY: [24915, 24930],
    FT8: [24915, 24918],
    FT4: [24919, 24922],
    DATA: [24915, 24930],
    SSB: [24930, 24990],
  },
  {
    name: '10m',
    meters: 10,
    lo: 28000,
    hi: 29700,
    CW: [28000, 28070],
    RTTY: [28070, 28150],
    FT8: [28074, 28077],
    FT4: [28180, 28183],
    DATA: [28070, 28190],
    SSB: [28300, 29700],
  },
  {
    name: '6m',
    meters: 6,
    lo: 50000,
    hi: 54000,
    CW: [50000, 50100],
    RTTY: [50300, 50400],
    FT8: [50313, 50316],
    FT4: [50318, 50321],
    DATA: [50300, 50400],
    SSB: [50100, 50300],
  },
  {
    name: '2m',
    meters: 2,
    lo: 144000,
    hi: 148000,
    CW: [144000, 144100],
    RTTY: [144100, 144200],
    FT8: [144174, 144177],
    FT4: [144170, 144173],
    DATA: [144100, 144200],
    SSB: [144200, 144275],
  },
  {
    name: '70cm',
    meters: 0.7,
    lo: 420000,
    hi: 450000,
    CW: [432000, 432100],
    RTTY: [432100, 432200],
    FT8: [432174, 432177],
    FT4: [432170, 432173],
    DATA: [432100, 432200],
    SSB: [432100, 432400],
  },
];

const bandByToken = (num, unit) => {
  const n = parseFloat(num);
  if (!Number.isFinite(n)) return null;
  if (unit === 'CM') return WATCHLIST_BAND_PLAN.find((b) => b.meters < 1 && Math.round(b.meters * 100) === n) || null;
  return WATCHLIST_BAND_PLAN.find((b) => b.meters >= 1 && b.meters === n) || null;
};

/** Band plan entry (or null) for a frequency in MHz, kHz or Hz. */
export const watchlistBandForFreq = (freq) => {
  const mhz = normalizeFrequencyToMHz(freq);
  if (mhz == null) return null;
  const khz = mhz * 1000;
  return WATCHLIST_BAND_PLAN.find((b) => khz >= b.lo && khz <= b.hi) || null;
};

// ─── Portable-call parsing ──────────────────────────────────────────────────

const FULL_CALL_RE = /^[A-Z0-9]{1,3}\d[A-Z]{1,4}$/;

/** HamClock rule: parts that never count as a DX or home portion. */
const isIgnoredPortablePart = (p) =>
  p === 'MM' || p === 'AM' || p.length <= 1 || /^\d+$/.test(p) || (p.length >= 3 && /^[A-Z]+$/.test(p));

/**
 * Split a (possibly portable) call into its DX and home portions.
 *   VP2E/K0CJH → { dx: 'VP2E', home: 'K0CJH' }
 *   K0CJH/VP2E → { dx: 'VP2E', home: 'K0CJH' }
 *   K0CJH/7    → { dx: 'K0CJH', home: 'K0CJH' }   (digit-only part ignored)
 *   OZ6ABL/MM  → { dx: 'OZ6ABL', home: 'OZ6ABL' }
 * A plain call is both its own DX and home portion.
 */
export const splitPortableCall = (raw) => {
  const call = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/-\d+$/, '');
  if (!call) return { dx: '', home: '' };
  const parts = call.split('/').filter(Boolean);
  if (parts.length <= 1) return { dx: call, home: call };
  const kept = parts.filter((p) => !isIgnoredPortablePart(p));
  if (kept.length === 0) return { dx: parts[0], home: parts[0] };
  if (kept.length === 1) return { dx: kept[0], home: kept[0] };
  const full = kept.filter((p) => FULL_CALL_RE.test(p));
  const notFull = kept.filter((p) => !FULL_CALL_RE.test(p));
  if (notFull.length >= 1 && full.length >= 1) return { dx: notFull[0], home: full[0] };
  // All (or none) look like full calls — the shorter one is the DX designator.
  const sorted = [...kept].sort((a, b) => a.length - b.length || kept.indexOf(a) - kept.indexOf(b));
  const dx = sorted[0];
  const home = kept.find((p) => p !== dx) || dx;
  return { dx, home };
};

/**
 * WPX-style prefix of a call: letters up to and including the last digit of
 * the prefix part (K0CJH → K0, KA1ABC → KA1, 3DA0XX → 3DA0). Portable
 * designators are used whole (VP2E/K0CJH → VP2E); one without a digit gets a
 * zero appended (PA/N8BJQ → PA0), per the WPX rules.
 */
export const wpxPrefix = (raw) => {
  const { dx, home } = splitPortableCall(raw);
  if (!dx) return '';
  if (dx !== home) return /\d/.test(dx) ? dx : `${dx}0`;
  const m = dx.match(/^([A-Z0-9]*?\d)([A-Z]+)$/);
  if (m) return m[1];
  return /\d/.test(dx) ? dx : `${dx}0`;
};

// ─── Parsing ────────────────────────────────────────────────────────────────

const FREQ_TOKEN_RE = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?MHZ$/;
const BAND_TOKEN_RE = /^(\d+)(?:-(\d+))?(M|CM)?(CW|DATA|FT4|FT8|RTTY|SSB)?$/;
const PREFIX_TOKEN_RE = /^[A-Z0-9]{1,8}\/?$/;

const bandsInRange = (a, b) => {
  // Range order is free: "20-10M" and "10-20M" mean the same thing.
  const order = WATCHLIST_BAND_PLAN;
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  return order.slice(lo, hi + 1);
};

/**
 * Parse watch-list text into specs.
 * @returns {{ specs: Array<{ text, freqs:Array<[lo,hi]>, prefixes:Array<{prefix,dxOnly}>, adif:string[] }>, errors: string[] }}
 */
export const parseWatchlist = (text) => {
  const specs = [];
  const errors = [];
  const source = String(text || '')
    .toUpperCase()
    .slice(0, WATCHLIST_MAX_LENGTH);
  for (const rawSpec of source.split(',')) {
    const specText = rawSpec.trim();
    if (!specText) continue;
    const spec = { text: specText, freqs: [], prefixes: [], adif: [] };
    let ok = true;
    for (const token of specText.split(/\s+/)) {
      if (!token) continue;
      let m;
      if ((m = token.match(FREQ_TOKEN_RE))) {
        const lo = parseFloat(m[1]) * 1000;
        const hi = m[2] != null ? parseFloat(m[2]) * 1000 : lo;
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
          errors.push(`${token}: bad frequency`);
          ok = false;
          continue;
        }
        spec.freqs.push(m[2] != null ? [Math.min(lo, hi), Math.max(lo, hi)] : [lo - 0.5, lo + 0.5]);
      } else if (WATCHLIST_ADIF_KEYWORDS.includes(token)) {
        if (!spec.adif.includes(token)) spec.adif.push(token);
      } else if ((m = token.match(BAND_TOKEN_RE)) && (m[3] || m[4] || m[2] || bandByToken(m[1], 'M'))) {
        const unit = m[3] || 'M';
        const a = bandByToken(m[1], unit);
        const b = m[2] != null ? bandByToken(m[2], unit) : a;
        if (!a || !b) {
          errors.push(`${token}: unknown band`);
          ok = false;
          continue;
        }
        const mode = m[4] || null;
        for (const band of bandsInRange(a, b)) {
          if (!mode) spec.freqs.push([band.lo, band.hi]);
          else if (band[mode]) spec.freqs.push([band[mode][0], band[mode][1]]);
          // A band with no window for that mode (30SSB) contributes nothing.
        }
      } else if (PREFIX_TOKEN_RE.test(token)) {
        const dxOnly = token.endsWith('/');
        spec.prefixes.push({ prefix: dxOnly ? token.slice(0, -1) : token, dxOnly });
      } else {
        errors.push(`${token}: not a band, frequency, keyword or prefix`);
        ok = false;
      }
    }
    if (ok && (spec.freqs.length || spec.prefixes.length || spec.adif.length)) specs.push(spec);
  }
  return { specs, errors };
};

// ─── Matching ───────────────────────────────────────────────────────────────

const spotFreqKHz = (spot) => {
  const mhz = normalizeFrequencyToMHz(spot?.freqKHz != null ? spot.freqKHz * 1000 : spot?.freq);
  return mhz == null ? null : mhz * 1000;
};

const spotGrid4 = (spot) => {
  const g = String(spot?.grid || spot?.dxGrid || spot?.gridsquare || '')
    .trim()
    .toUpperCase();
  return /^[A-R]{2}[0-9]{2}/.test(g) ? g.slice(0, 4) : null;
};

const spotBandName = (spot) => {
  const band = watchlistBandForFreq(spot?.freqKHz != null ? spot.freqKHz * 1000 : spot?.freq);
  if (band) return band.name;
  const hint = String(spot?.band || '')
    .trim()
    .toLowerCase();
  return /^\d+c?m$/.test(hint) ? hint : null;
};

/**
 * Evaluate one ADIF keyword for a spot.
 * @param {string} keyword NADXCC | NAPREF | NAGRID | NABAND
 * @param {object} spot    { call, freq | freqKHz, grid?, band? }
 * @param {object} ctx     { logIndex, resolve }
 *   logIndex: { dxcc:Set, prefixes:Set, grids:Set, bands:Set } (see buildWatchlistLogIndex)
 *   resolve:  call → { dxcc } | null (cty.dat lookup)
 * Unknowns never match: an unresolvable entity or a spot without a grid is
 * not "needed", it is simply unknown.
 */
export const evaluateAdifKeyword = (keyword, spot, ctx = {}) => {
  const idx = ctx.logIndex || { dxcc: new Set(), prefixes: new Set(), grids: new Set(), bands: new Set() };
  switch (keyword) {
    case 'NADXCC': {
      const resolved = typeof ctx.resolve === 'function' ? ctx.resolve(spot?.call) : null;
      if (!resolved?.dxcc) return false;
      return !idx.dxcc.has(resolved.dxcc);
    }
    case 'NAPREF': {
      const prefix = wpxPrefix(spot?.call);
      if (!prefix) return false;
      return !idx.prefixes.has(prefix);
    }
    case 'NAGRID': {
      const grid = spotGrid4(spot);
      if (!grid) return false;
      return !idx.grids.has(grid);
    }
    case 'NABAND': {
      const band = spotBandName(spot);
      if (!band) return false;
      return !idx.bands.has(band);
    }
    default:
      return false;
  }
};

/** Does a spot satisfy every requirement of one parsed spec? */
export const matchSpec = (spec, spot, ctx = {}) => {
  if (!spec) return false;
  if (spec.freqs.length) {
    const khz = spotFreqKHz(spot);
    if (khz == null || !spec.freqs.some(([lo, hi]) => khz >= lo && khz <= hi)) return false;
  }
  if (spec.prefixes.length) {
    const { dx, home } = splitPortableCall(spot?.call || spot?.dxCall);
    if (!dx) return false;
    const hit = spec.prefixes.some(({ prefix, dxOnly }) =>
      dxOnly ? dx.startsWith(prefix) : dx.startsWith(prefix) || home.startsWith(prefix),
    );
    if (!hit) return false;
  }
  for (const keyword of spec.adif) {
    if (!evaluateAdifKeyword(keyword, spot, ctx)) return false;
  }
  return true;
};

/** Does a spot match any spec of a parsed list? */
export const matchWatchlist = (parsed, spot, ctx = {}) =>
  !!parsed?.specs?.length && parsed.specs.some((spec) => matchSpec(spec, spot, ctx));

/**
 * Compile a list ({ mode, text }) into a matcher. With mode 'off' or no
 * specs the matcher is null — callers skip all watch-list work.
 * @returns {{ mode, matcher: ((spot) => boolean) | null, errors: string[] }}
 */
export const compileWatchlist = (list, ctx = {}) => {
  const mode = WATCHLIST_MODES.includes(list?.mode) ? list.mode : 'off';
  const parsed = parseWatchlist(list?.text || '');
  if (mode === 'off' || parsed.specs.length === 0) return { mode, matcher: null, errors: parsed.errors };
  return { mode, matcher: (spot) => matchWatchlist(parsed, spot, ctx), errors: parsed.errors };
};

/**
 * What a list mode does with a spot given whether it matched:
 *   'hide' — drop it; 'red' — show highlighted; 'show' — show normally.
 */
export const watchlistDecision = (mode, matched) => {
  if (mode === 'only') return matched ? 'show' : 'hide';
  if (mode === 'not') return matched ? 'hide' : 'show';
  if (mode === 'red') return matched ? 'red' : 'show';
  return 'show';
};

/**
 * Apply a compiled list to an array: filters for only/not and returns the
 * surviving items plus a Set of items to paint red.
 * @param {Array} items
 * @param {{mode, matcher}} compiled  from compileWatchlist
 * @param {(item) => object} [toSpot] maps an item to { call, freq, grid }
 */
export const applyWatchlist = (items, compiled, toSpot = (x) => x) => {
  const red = new Set();
  if (!Array.isArray(items) || !compiled?.matcher) return { items: items || [], red };
  const out = [];
  for (const item of items) {
    const decision = watchlistDecision(compiled.mode, compiled.matcher(toSpot(item)));
    if (decision === 'hide') continue;
    if (decision === 'red') red.add(item);
    out.push(item);
  }
  return { items: out, red };
};

// ─── Logbook index for the ADIF keywords ────────────────────────────────────

/**
 * Build the "already worked" sets the NA* keywords test against.
 * @param {Array}    qsos  native logbook records ({ call, freq (MHz), band?, gridsquare? })
 * @param {object}   [opts] { resolve: call → { dxcc } | null }
 */
export const buildWatchlistLogIndex = (qsos, { resolve } = {}) => {
  const index = { dxcc: new Set(), prefixes: new Set(), grids: new Set(), bands: new Set(), count: 0 };
  for (const q of Array.isArray(qsos) ? qsos : []) {
    if (!q || !q.call) continue;
    index.count += 1;
    const resolved = typeof resolve === 'function' ? resolve(q.call) : null;
    if (resolved?.dxcc) index.dxcc.add(resolved.dxcc);
    const prefix = wpxPrefix(q.call);
    if (prefix) index.prefixes.add(prefix);
    const grid = spotGrid4(q);
    if (grid) index.grids.add(grid);
    const band = spotBandName(q);
    if (band) index.bands.add(band);
  }
  return index;
};

// ─── Migration from the legacy simple watchlist ─────────────────────────────

/**
 * Turn the old DX-filter watchlist (array of call prefixes + watchlistOnly
 * flag) into a list spec: entries become prefix specs, Red mode by default,
 * Only mode when "show only watchlist" was on.
 */
export const migrateLegacyWatchlist = (filters) => {
  const entries = Array.isArray(filters?.watchlist)
    ? filters.watchlist
        .map((w) =>
          String(w || '')
            .trim()
            .toUpperCase(),
        )
        .filter((w) => PREFIX_TOKEN_RE.test(w))
    : [];
  if (entries.length === 0) return null;
  return { mode: filters?.watchlistOnly ? 'only' : 'red', text: entries.join(', ') };
};

export default {
  WATCHLIST_MODES,
  WATCHLIST_BAND_PLAN,
  parseWatchlist,
  compileWatchlist,
  matchSpec,
  matchWatchlist,
  applyWatchlist,
  watchlistDecision,
  splitPortableCall,
  wpxPrefix,
  evaluateAdifKeyword,
  buildWatchlistLogIndex,
  migrateLegacyWatchlist,
};
