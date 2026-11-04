import { describe, it, expect } from 'vitest';
import {
  parseWatchlist,
  compileWatchlist,
  matchWatchlist,
  applyWatchlist,
  watchlistDecision,
  splitPortableCall,
  wpxPrefix,
  evaluateAdifKeyword,
  buildWatchlistLogIndex,
  migrateLegacyWatchlist,
  WATCHLIST_BAND_PLAN,
} from './watchlistSpec.js';

const matches = (text, spot, ctx) => matchWatchlist(parseWatchlist(text), spot, ctx);

describe('watchlistSpec — band plan', () => {
  it('lists the HF/VHF bands HamClock knows, each with a CW and FT8 window inside the band', () => {
    const names = WATCHLIST_BAND_PLAN.map((b) => b.name);
    expect(names).toEqual(['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm']);
    for (const b of WATCHLIST_BAND_PLAN) {
      for (const mode of ['CW', 'FT8', 'FT4', 'DATA', 'RTTY']) {
        expect(b[mode][0]).toBeGreaterThanOrEqual(b.lo);
        expect(b[mode][1]).toBeLessThanOrEqual(b.hi);
      }
    }
    expect(WATCHLIST_BAND_PLAN.find((b) => b.name === '30m').SSB).toBeNull();
  });
});

describe('watchlistSpec — parsing', () => {
  it('parses a single band', () => {
    const { specs, errors } = parseWatchlist('40M');
    expect(errors).toEqual([]);
    expect(specs).toHaveLength(1);
    expect(specs[0].freqs).toEqual([[7000, 7300]]);
  });

  it('parses band ranges in either order', () => {
    const a = parseWatchlist('20-10M').specs[0].freqs;
    const b = parseWatchlist('10-20M').specs[0].freqs;
    expect(a).toEqual(b);
    expect(a.map(([lo]) => lo)).toEqual([14000, 18068, 21000, 24890, 28000]);
  });

  it('parses sub-band modes as frequency windows', () => {
    expect(parseWatchlist('40CW').specs[0].freqs).toEqual([[7000, 7040]]);
    expect(parseWatchlist('20SSB').specs[0].freqs).toEqual([[14112, 14350]]);
    expect(parseWatchlist('30FT8').specs[0].freqs).toEqual([[10136, 10139]]);
    expect(parseWatchlist('70CM').specs[0].freqs).toEqual([[420000, 450000]]);
    expect(parseWatchlist('2M').specs[0].freqs).toEqual([[144000, 148000]]);
  });

  it('parses sub-band modes over a band range (160-10CW, 10-20DATA)', () => {
    const cw = parseWatchlist('160-10CW').specs[0].freqs;
    expect(cw).toHaveLength(10); // 160 80 60 40 30 20 17 15 12 10
    expect(cw[0]).toEqual([1800, 1840]);
    expect(cw[cw.length - 1]).toEqual([28000, 28070]);
    const data = parseWatchlist('10-20DATA').specs[0].freqs;
    expect(data).toHaveLength(5);
    expect(data[0]).toEqual([14070, 14112]);
  });

  it('skips bands with no window for the mode instead of failing (30SSB)', () => {
    const { specs, errors } = parseWatchlist('30SSB, 40M');
    expect(errors).toEqual([]);
    expect(specs).toHaveLength(1); // 30SSB contributes nothing → spec dropped
    expect(specs[0].text).toBe('40M');
  });

  it('parses MHz frequency ranges and single frequencies', () => {
    expect(parseWatchlist('14-14.02MHZ').specs[0].freqs).toEqual([[14000, 14020]]);
    expect(parseWatchlist('14.074mhz').specs[0].freqs).toEqual([[14073.5, 14074.5]]);
  });

  it('parses ADIF keywords and prefixes, lower case too', () => {
    const { specs } = parseWatchlist('nadxcc 3y, k1 vp2e/');
    expect(specs[0].adif).toEqual(['NADXCC']);
    expect(specs[0].prefixes).toEqual([{ prefix: '3Y', dxOnly: false }]);
    expect(specs[1].prefixes).toEqual([
      { prefix: 'K1', dxOnly: false },
      { prefix: 'VP2E', dxOnly: true },
    ]);
  });

  it('reports bad tokens and drops only the offending spec', () => {
    const { specs, errors } = parseWatchlist('40M, 999M, foo!bar, 20M');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/999M/);
    expect(specs.map((s) => s.text)).toEqual(['40M', '20M']);
  });

  it('ignores empty specs and whitespace', () => {
    expect(parseWatchlist(' , ,40M,, ').specs).toHaveLength(1);
    expect(parseWatchlist('').specs).toEqual([]);
    expect(parseWatchlist(null).specs).toEqual([]);
  });
});

describe('watchlistSpec — portable calls', () => {
  it('splits DX and home portions', () => {
    expect(splitPortableCall('VP2E/K0CJH')).toEqual({ dx: 'VP2E', home: 'K0CJH' });
    expect(splitPortableCall('K0CJH/VP2E')).toEqual({ dx: 'VP2E', home: 'K0CJH' });
    expect(splitPortableCall('PJ2/W9WI')).toEqual({ dx: 'PJ2', home: 'W9WI' });
    expect(splitPortableCall('DL/W1ABC/P')).toEqual({ dx: 'DL', home: 'W1ABC' });
  });

  it('ignores /MM, /AM, single characters, digit-only and 3+ letter suffixes', () => {
    expect(splitPortableCall('OZ6ABL/MM')).toEqual({ dx: 'OZ6ABL', home: 'OZ6ABL' });
    expect(splitPortableCall('W1AW/AM')).toEqual({ dx: 'W1AW', home: 'W1AW' });
    expect(splitPortableCall('W1AW/7')).toEqual({ dx: 'W1AW', home: 'W1AW' });
    expect(splitPortableCall('W1AW/P')).toEqual({ dx: 'W1AW', home: 'W1AW' });
    expect(splitPortableCall('W1AW/QRP')).toEqual({ dx: 'W1AW', home: 'W1AW' });
  });

  it('treats a plain call as both portions and strips SSIDs', () => {
    expect(splitPortableCall('k0cjh')).toEqual({ dx: 'K0CJH', home: 'K0CJH' });
    expect(splitPortableCall('K0CJH-3')).toEqual({ dx: 'K0CJH', home: 'K0CJH' });
    expect(splitPortableCall('')).toEqual({ dx: '', home: '' });
  });

  it('computes WPX prefixes', () => {
    expect(wpxPrefix('K0CJH')).toBe('K0');
    expect(wpxPrefix('KA1ABC')).toBe('KA1');
    expect(wpxPrefix('3DA0XX')).toBe('3DA0');
    expect(wpxPrefix('4U1ITU')).toBe('4U1');
    expect(wpxPrefix('VP2E/K0CJH')).toBe('VP2E');
    expect(wpxPrefix('PA/N8BJQ')).toBe('PA0');
    expect(wpxPrefix('')).toBe('');
  });
});

describe('watchlistSpec — matching', () => {
  it('matches bands, sub-bands and frequency ranges from freq in MHz or kHz', () => {
    expect(matches('40M', { call: 'W1AW', freq: 7.025 })).toBe(true);
    expect(matches('40M', { call: 'W1AW', freq: 7025 })).toBe(true);
    expect(matches('40CW', { call: 'W1AW', freq: 7.025 })).toBe(true);
    expect(matches('40CW', { call: 'W1AW', freq: 7.2 })).toBe(false);
    expect(matches('40SSB', { call: 'W1AW', freq: 7.2 })).toBe(true);
    expect(matches('14-14.02MHZ', { call: 'W1AW', freq: 14.01 })).toBe(true);
    expect(matches('14-14.02MHZ', { call: 'W1AW', freq: 14.074 })).toBe(false);
    expect(matches('20M', { call: 'W1AW' })).toBe(false); // no frequency → cannot match a band spec
  });

  it('matches prefixes against the DX portion or the home portion', () => {
    expect(matches('VP2E', { call: 'VP2E/K0CJH' })).toBe(true);
    expect(matches('K0', { call: 'VP2E/K0CJH' })).toBe(true); // home portion
    expect(matches('K0/', { call: 'VP2E/K0CJH' })).toBe(false); // trailing slash: DX portion only
    expect(matches('VP2E/', { call: 'K0CJH/VP2E' })).toBe(true);
    expect(matches('3Y', { call: '3Y0J' })).toBe(true);
    expect(matches('3Y', { call: 'W3YA' })).toBe(false);
  });

  it('requires every token of a spec but any spec of the list', () => {
    expect(matches('20M 3Y', { call: '3Y0J', freq: 14.2 })).toBe(true);
    expect(matches('20M 3Y', { call: '3Y0J', freq: 7.2 })).toBe(false);
    expect(matches('20M 3Y, 40M', { call: 'W1AW', freq: 7.2 })).toBe(true);
    expect(matches('20M 3Y, 40M', { call: 'W1AW', freq: 14.2 })).toBe(false);
  });

  it('ORs several prefixes and bands inside one spec', () => {
    expect(matches('40M 20M', { call: 'W1AW', freq: 14.2 })).toBe(true);
    expect(matches('K1 W1', { call: 'W1AW', freq: 14.2 })).toBe(true);
  });
});

describe('watchlistSpec — ADIF keywords', () => {
  const resolve = (call) => {
    const c = String(call || '').toUpperCase();
    if (c.startsWith('3Y')) return { dxcc: '3Y/B' };
    if (c.startsWith('K') || c.startsWith('W')) return { dxcc: 'K' };
    return null;
  };
  const logIndex = buildWatchlistLogIndex(
    [
      { call: 'W1AW', freq: 14.2, gridsquare: 'FN31pr' },
      { call: 'K0CJH', band: '40m' },
    ],
    { resolve },
  );

  it('builds the log index from calls, bands and grids', () => {
    expect(logIndex.count).toBe(2);
    expect([...logIndex.dxcc]).toEqual(['K']);
    expect([...logIndex.prefixes].sort()).toEqual(['K0', 'W1']);
    expect([...logIndex.grids]).toEqual(['FN31']);
    expect([...logIndex.bands].sort()).toEqual(['20m', '40m']);
  });

  it('NADXCC: entity not in the log; unresolvable entities never match', () => {
    const ctx = { logIndex, resolve };
    expect(evaluateAdifKeyword('NADXCC', { call: '3Y0J' }, ctx)).toBe(true);
    expect(evaluateAdifKeyword('NADXCC', { call: 'W2XYZ' }, ctx)).toBe(false);
    expect(evaluateAdifKeyword('NADXCC', { call: 'ZZ9ZZ' }, ctx)).toBe(false);
  });

  it('NAPREF, NAGRID, NABAND', () => {
    const ctx = { logIndex, resolve };
    expect(evaluateAdifKeyword('NAPREF', { call: 'W1XYZ' }, ctx)).toBe(false);
    expect(evaluateAdifKeyword('NAPREF', { call: 'W2XYZ' }, ctx)).toBe(true);
    expect(evaluateAdifKeyword('NAGRID', { call: 'W1XYZ', grid: 'FN31' }, ctx)).toBe(false);
    expect(evaluateAdifKeyword('NAGRID', { call: 'W1XYZ', grid: 'EM12ab' }, ctx)).toBe(true);
    expect(evaluateAdifKeyword('NAGRID', { call: 'W1XYZ' }, ctx)).toBe(false); // no grid → unknown
    expect(evaluateAdifKeyword('NABAND', { call: 'W1XYZ', freq: 14.2 }, ctx)).toBe(false);
    expect(evaluateAdifKeyword('NABAND', { call: 'W1XYZ', freq: 21.2 }, ctx)).toBe(true);
  });

  it('ANDs keywords with the other tokens of a spec', () => {
    const ctx = { logIndex, resolve };
    expect(matches('20M NADXCC', { call: '3Y0J', freq: 14.2 }, ctx)).toBe(true);
    expect(matches('20M NADXCC', { call: 'W2XYZ', freq: 14.2 }, ctx)).toBe(false);
    expect(matches('NADXCC NABAND', { call: '3Y0J', freq: 21.2 }, ctx)).toBe(true);
    expect(matches('NADXCC NABAND', { call: '3Y0J', freq: 14.2 }, ctx)).toBe(false);
  });

  it('with an empty log everything resolvable is "not yet worked"', () => {
    expect(evaluateAdifKeyword('NADXCC', { call: 'W1AW' }, { resolve })).toBe(true);
    expect(evaluateAdifKeyword('NABAND', { call: 'W1AW', freq: 14.2 }, {})).toBe(true);
  });
});

describe('watchlistSpec — modes and application', () => {
  it('watchlistDecision', () => {
    expect(watchlistDecision('off', true)).toBe('show');
    expect(watchlistDecision('red', true)).toBe('red');
    expect(watchlistDecision('red', false)).toBe('show');
    expect(watchlistDecision('only', true)).toBe('show');
    expect(watchlistDecision('only', false)).toBe('hide');
    expect(watchlistDecision('not', true)).toBe('hide');
    expect(watchlistDecision('not', false)).toBe('show');
  });

  it('compileWatchlist returns no matcher when off or empty', () => {
    expect(compileWatchlist({ mode: 'off', text: '40M' }).matcher).toBeNull();
    expect(compileWatchlist({ mode: 'red', text: '' }).matcher).toBeNull();
    expect(compileWatchlist({ mode: 'bogus', text: '40M' }).mode).toBe('off');
    expect(compileWatchlist({ mode: 'red', text: '40M' }).matcher).toBeTypeOf('function');
  });

  it('applyWatchlist filters for only/not and flags red matches', () => {
    const spots = [
      { call: 'W1AW', freq: 7.2 },
      { call: '3Y0J', freq: 14.2 },
    ];
    const red = applyWatchlist(spots, compileWatchlist({ mode: 'red', text: '3Y' }));
    expect(red.items).toHaveLength(2);
    expect(red.red.has(spots[1])).toBe(true);
    expect(red.red.has(spots[0])).toBe(false);

    const only = applyWatchlist(spots, compileWatchlist({ mode: 'only', text: '3Y' }));
    expect(only.items).toEqual([spots[1]]);

    const not = applyWatchlist(spots, compileWatchlist({ mode: 'not', text: '3Y' }));
    expect(not.items).toEqual([spots[0]]);

    const off = applyWatchlist(spots, compileWatchlist({ mode: 'off', text: '3Y' }));
    expect(off.items).toBe(spots);
  });

  it('applyWatchlist maps items through toSpot', () => {
    const rows = [
      { dxCall: '3Y0J', freq: '14.200' },
      { dxCall: 'W1AW', freq: '7.200' },
    ];
    const r = applyWatchlist(rows, compileWatchlist({ mode: 'only', text: '20M' }), (row) => ({
      call: row.dxCall,
      freq: row.freq,
    }));
    expect(r.items).toEqual([rows[0]]);
  });
});

describe('watchlistSpec — legacy migration', () => {
  it('turns the old call list into prefix specs in Red mode', () => {
    expect(migrateLegacyWatchlist({ watchlist: ['3Y', 'vp2e'] })).toEqual({ mode: 'red', text: '3Y, VP2E' });
  });

  it('keeps "show only watchlist" as Only mode', () => {
    expect(migrateLegacyWatchlist({ watchlist: ['3Y'], watchlistOnly: true })).toEqual({ mode: 'only', text: '3Y' });
  });

  it('returns null when there is nothing to migrate', () => {
    expect(migrateLegacyWatchlist({})).toBeNull();
    expect(migrateLegacyWatchlist({ watchlist: [] })).toBeNull();
    expect(migrateLegacyWatchlist(null)).toBeNull();
  });
});
