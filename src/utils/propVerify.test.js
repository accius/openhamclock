import { describe, it, expect } from 'vitest';
import * as mod from './propVerify.js';
import {
  countObservedByBand,
  observedScore,
  maxAcrossContinents,
  verdictFor,
  verdictForScore,
  buildComparison,
  pickCellReliability,
  nearestContinent,
  VERIFY_BANDS,
  OBSERVED_CAP,
} from './propVerify.js';

const NOW = Date.parse('2026-08-28T12:00:00Z');
const MIN = 60 * 1000;

// Synthetic cluster-style spots. Real prefixes so getCallsignInfo resolves
// continents: W=NA, DL=EU, JA=AS, VK=OC.
const spot = (over = {}) => ({
  call: 'DL1AAA',
  spotter: 'W1AW',
  freq: 14025, // kHz → 20m
  timestamp: NOW - 5 * MIN,
  ...over,
});

describe('countObservedByBand', () => {
  it('counts spots involving the DE continent within the window, per band', () => {
    const spots = [
      spot(), // NA spotter hears EU → involves NA, 20m
      spot({ freq: 7012 }), // 40m
      spot({ spotter: 'JA1AAA', call: 'VK2AAA' }), // AS↔OC — does NOT involve NA
      spot({ timestamp: NOW - 20 * MIN }), // outside 15-min window
      spot({ freq: 144200 }), // 2m — not an HF verify band
    ];
    const counts = countObservedByBand(spots, { deContinent: 'NA', now: NOW });
    expect(counts['20m']).toBe(1);
    expect(counts['40m']).toBe(1);
    expect(counts['15m']).toBe(0);
  });

  it('trusts involvesDe for DE-centric feeds (PSKReporter) and accepts band directly', () => {
    const spots = [
      { band: '10m', timestamp: NOW - MIN, involvesDe: true },
      { band: '10m', timestamp: NOW - MIN, involvesDe: true },
      { band: 'other', timestamp: NOW - MIN, involvesDe: true },
    ];
    const counts = countObservedByBand(spots, { deContinent: 'NA', now: NOW });
    expect(counts['10m']).toBe(2);
  });

  it('handles empty/bad input', () => {
    const counts = countObservedByBand(null, { deContinent: 'EU', now: NOW });
    expect(Object.keys(counts)).toEqual(VERIFY_BANDS);
    expect(Object.values(counts).every((c) => c === 0)).toBe(true);
  });
});

describe('observedScore', () => {
  it('normalizes counts to the 0-99 reliability scale, capped', () => {
    expect(observedScore(0)).toBe(0);
    expect(observedScore(OBSERVED_CAP)).toBe(99);
    expect(observedScore(OBSERVED_CAP * 3)).toBe(99);
    expect(observedScore(Math.round(OBSERVED_CAP / 3))).toBeGreaterThan(20);
  });
});

describe('maxAcrossContinents', () => {
  it('takes the per-band max, ignoring non-finite entries', () => {
    const matrix = {
      '20m': { EU: 80, AS: 45, OC: null },
      '10m': { EU: null, AS: undefined },
    };
    const out = maxAcrossContinents(matrix);
    expect(out['20m']).toBe(80);
    expect(out['10m']).toBeNull();
    expect(maxAcrossContinents(null)).toEqual({});
  });
});

describe('verdictFor', () => {
  it('agrees when both say closed', () => {
    expect(verdictFor(5, 0)).toBe('agrees');
  });

  it('agrees within the tolerance band', () => {
    // predicted 60, 8 spots → observed ~53 → |diff| < 25
    expect(verdictFor(60, 8)).toBe('agrees');
  });

  it('flags better-than-predicted when a "closed" band is busy', () => {
    // predicted 10, 10 spots → observed 66 → diff +56
    expect(verdictFor(10, 10)).toBe('better');
  });

  it('flags worse-than-predicted when a "open" band is silent', () => {
    expect(verdictFor(80, 0)).toBe('worse');
    expect(verdictFor(80, 2)).toBe('worse'); // observed 13 vs predicted 80
  });

  it('returns nodata without a prediction', () => {
    expect(verdictFor(null, 5)).toBe('nodata');
    expect(verdictFor(undefined, 0)).toBe('nodata');
  });
});

describe('buildComparison', () => {
  it('produces one row per verify band, in order', () => {
    const rows = buildComparison({ '20m': 80, '40m': 5 }, { '20m': 12, '40m': 0 });
    expect(rows.map((r) => r.band)).toEqual(VERIFY_BANDS);
    const r20 = rows.find((r) => r.band === '20m');
    expect(r20).toMatchObject({ predicted: 80, count: 12, verdict: 'agrees' });
    const r40 = rows.find((r) => r.band === '40m');
    expect(r40.verdict).toBe('agrees'); // both closed
    const r15 = rows.find((r) => r.band === '15m');
    expect(r15).toMatchObject({ predicted: null, verdict: 'nodata' });
  });
});

describe('pickCellReliability', () => {
  const cells = [
    { lat: 50, lon: 10, r: 72 },
    { lat: -30, lon: -170, r: 33 },
  ];

  it('picks the nearest cell', () => {
    expect(pickCellReliability(cells, 51, 12)).toBe(72);
  });

  it('wraps longitude at the antimeridian', () => {
    expect(pickCellReliability(cells, -30, 175)).toBe(33);
  });

  it('handles empty input', () => {
    expect(pickCellReliability([], 0, 0)).toBeNull();
    expect(pickCellReliability(null, 0, 0)).toBeNull();
  });
});

describe('nearestContinent', () => {
  it('maps coordinates to the nearest continent point', () => {
    expect(nearestContinent(40.015, -105.27)).toBe('NA'); // Boulder
    expect(nearestContinent(52.5, 13.4)).toBe('EU'); // Berlin
    expect(nearestContinent(-33.9, 151.2)).toBe('OC'); // Sydney
  });
});

describe('verdictForScore / beacon third source', () => {
  it('applies the same ±25 tolerance to a normalized beacon score', () => {
    expect(verdictForScore(80, 70)).toBe('agrees');
    expect(verdictForScore(80, 20)).toBe('worse');
    expect(verdictForScore(10, 60)).toBe('better');
    expect(verdictForScore(5, 0)).toBe('agrees');
    expect(verdictForScore(null, 50)).toBe('nodata');
    expect(verdictForScore(50, undefined)).toBe('nodata');
  });

  it('buildComparison attaches beacon rows only for bands with measured data', () => {
    const rows = buildComparison(
      { '20m': 80, '10m': 10 },
      { '20m': 3 },
      { '20m': { maxSnr: 18, score: 69, n: 4 }, '15m': { maxSnr: null, score: null, n: 0 } },
    );
    const r20 = rows.find((r) => r.band === '20m');
    expect(r20.beacon).toEqual({ maxSnr: 18, score: 69, n: 4, verdict: 'agrees' });
    expect(rows.find((r) => r.band === '15m').beacon).toBeNull();
    expect(rows.find((r) => r.band === '10m').beacon).toBeNull();
    // Without the third argument nothing changes for existing callers.
    expect(buildComparison({ '20m': 80 }, {}).every((r) => r.beacon === null)).toBe(true);
  });
});

describe('DE → DX path mode', () => {
  const { continentOf, countPathSpotsByBand, pathStatus, buildPathComparison, measurementsNear } = mod;

  it('continentOf prefers the prefix, falls back to the nearest continent point, else null', () => {
    expect(continentOf('K0CJH')).toBe('NA');
    expect(continentOf('JA1XYZ')).toBe('AS');
    expect(continentOf(null, 50, 10)).toBe('EU');
    expect(continentOf(null, null, null)).toBe(null);
  });

  it('countPathSpotsByBand counts only spots whose ends sit on the two continents', () => {
    const now = 1_000_000_000;
    const spots = [
      { freq: 14.2, timestamp: now - 60_000, spotter: 'K1ABC', call: 'JA1XYZ' }, // NA→AS ✓
      { freq: 14.2, timestamp: now - 60_000, spotter: 'JA2DEF', call: 'W6XYZ' }, // AS→NA ✓ (either direction)
      { freq: 14.2, timestamp: now - 60_000, spotter: 'K1ABC', call: 'DL1AAA' }, // NA→EU ✗
      { freq: 7.1, timestamp: now - 60_000, spotter: null, call: 'JA1XYZ', spotterLat: 45, spotterLon: -93 }, // lat/lon end ✓
      { freq: 7.1, timestamp: now - 60_000, spotter: null, call: 'JA1XYZ' }, // unresolvable end — skipped
      { band: '20m', timestamp: now - 60_000, deContinentEnd: true, otherCall: 'JA3GHI' }, // PSK far end ✓
      { band: '20m', timestamp: now - 60_000, deContinentEnd: true, otherCall: 'G4AAA' }, // PSK far end ✗
      { freq: 14.2, timestamp: now - 20 * 60_000, spotter: 'K1ABC', call: 'JA1XYZ' }, // too old
    ];
    const c = countPathSpotsByBand(spots, { deContinent: 'NA', dxContinent: 'AS', now });
    expect(c['20m']).toBe(3);
    expect(c['40m']).toBe(1);
    expect(c['80m']).toBe(0);
    expect(countPathSpotsByBand(spots, { deContinent: null, dxContinent: 'AS', now })['20m']).toBe(0);
  });

  it('pathStatus gives plain-language verdicts', () => {
    expect(pathStatus(null, 5)).toBe('nodata');
    expect(pathStatus(80, 4)).toBe('open-confirmed');
    expect(pathStatus(80, 1)).toBe('open-confirmed'); // some evidence is enough when the model is confident
    expect(pathStatus(80, 0)).toBe('open-unconfirmed');
    expect(pathStatus(5, 0)).toBe('closed');
    expect(pathStatus(5, 1)).toBe('marginal');
    expect(pathStatus(5, 4)).toBe('open-surprise');
    expect(pathStatus(30, 0)).toBe('marginal');
    expect(pathStatus(30, 3)).toBe('open-confirmed');
    // a clearly heard beacon near DX counts as evidence
    expect(pathStatus(5, 0, 70)).toBe('open-surprise');
    expect(pathStatus(80, 0, 70)).toBe('open-confirmed');
  });

  it('buildPathComparison produces one row per band with status and optional beacon', () => {
    const rows = buildPathComparison({ '20m': 80, '40m': 5 }, { '20m': 4 }, { '40m': { maxSnr: 12, score: 60, n: 2 } });
    expect(rows.map((r) => r.band)).toEqual(['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m']);
    const r20 = rows.find((r) => r.band === '20m');
    expect(r20.status).toBe('open-confirmed');
    expect(r20.beacon).toBe(null);
    const r40 = rows.find((r) => r.band === '40m');
    expect(r40.beacon.score).toBe(60);
    expect(r40.status).toBe('open-surprise');
    expect(rows.find((r) => r.band === '80m').status).toBe('nodata');
  });

  it('measurementsNear keeps only beacons within range of the DX end', () => {
    const beacons = [
      { callsign: 'JA2IGY', lat: 34.5, lon: 136.5 },
      { callsign: '4U1UN', lat: 40.7, lon: -74 },
    ];
    const ms = [
      { beacon: 'JA2IGY', band: '20m', t: 1, snrDb: 10 },
      { beacon: '4U1UN', band: '20m', t: 1, snrDb: 20 },
    ];
    expect(measurementsNear(ms, beacons, 35.7, 139.7).map((m) => m.beacon)).toEqual(['JA2IGY']);
    expect(measurementsNear(ms, beacons, 0, -150)).toEqual([]);
    expect(measurementsNear(ms, beacons, null, null)).toEqual([]);
  });
});
