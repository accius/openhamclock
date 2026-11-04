import { describe, expect, it } from 'vitest';
import {
  activityScore,
  aggregateSpots,
  bandOf,
  bandOpeningScore,
  evaluateNeeds,
  mergeCandidates,
  nearestFrequencyReliability,
  rankOpportunities,
  reliabilityFactor,
  scoreOpportunity,
  selectForPrediction,
  spotAgeMs,
  stateFromLocationDesc,
  toMHz,
} from './opportunityScore.js';

const NOW = Date.parse('2026-10-14T12:30:00Z');

// Minimal awards object shaped like computeAwards() output
const awardsWith = ({ dxcc = [], waz = [], was = [], vucc = [], total = 10, withState = 0 } = {}) => {
  const rec = (bands) => ({ bands: new Set(bands), modes: new Set(), bandModes: new Set(), count: 1 });
  return {
    totalQsos: total,
    dxcc: { worked: new Map(dxcc.map(([k, bands]) => [k, rec(bands)])), total: 340, unresolved: 0 },
    waz: { worked: new Map(waz.map((z) => [z, rec([])])), total: 40 },
    was: { worked: new Map(was.map((s) => [s, rec([])])), total: 50, qsosWithState: withState },
    vucc: { worked: new Map(vucc.map((g) => [g, rec([])])), threshold: 100 },
  };
};
const resolve = (call) =>
  ({
    P5DX: { dxcc: 'P5', entity: 'North Korea', cq: 25 },
    DL1ABC: { dxcc: 'DL', entity: 'Germany', cq: 14 },
    W1AW: { dxcc: 'K', entity: 'United States', cq: 5 },
  })[call] || null;

describe('frequency helpers', () => {
  it('normalizes MHz / kHz / Hz and resolves bands', () => {
    expect(toMHz('14074.0')).toBeCloseTo(14.074);
    expect(toMHz(14.074)).toBeCloseTo(14.074);
    expect(toMHz(14074000)).toBeCloseTo(14.074);
    expect(toMHz('x')).toBeNull();
    expect(bandOf(14.074)).toBe('20m');
    expect(bandOf(7.1)).toBe('40m');
    expect(bandOf(99)).toBeNull();
  });
});

describe('spotAgeMs', () => {
  it('uses absolute timestamps when present', () => {
    expect(spotAgeMs({ timestamp: NOW - 60_000 }, NOW)).toBe(60_000);
    expect(spotAgeMs({ timestamp: '2026-10-14T12:00:00Z' }, NOW)).toBe(30 * 60_000);
  });
  it('derives age from HH:MMz strings with midnight wraparound', () => {
    expect(spotAgeMs({ time: '12:25z' }, NOW)).toBe(5 * 60_000);
    const justAfterMidnight = Date.parse('2026-10-15T00:05:00Z');
    expect(spotAgeMs({ time: '23:58z' }, justAfterMidnight)).toBe(7 * 60_000);
  });
  it('is Infinity without any time info', () => {
    expect(spotAgeMs({}, NOW)).toBe(Infinity);
  });
});

describe('aggregateSpots', () => {
  const cluster = [
    { dxCall: 'P5DX', freq: '14025.0', spotter: 'W3LPL', timestamp: NOW - 2 * 60_000, dxLat: 39, dxLon: 125 },
    { dxCall: 'P5DX', freq: '14025.1', spotter: 'K3LR', timestamp: NOW - 5 * 60_000 },
    { dxCall: 'P5DX', freq: '14025.0', spotter: 'W3LPL', timestamp: NOW - 9 * 60_000 }, // same spotter again
    { dxCall: 'P5DX', freq: '7025.0', spotter: 'W3LPL', timestamp: NOW - 1 * 60_000 }, // other band
    { dxCall: 'DL1ABC', freq: '21025.0', spotter: 'W3LPL', timestamp: NOW - 20 * 60_000 }, // too old
  ];
  it('groups by station+band, counting distinct spotters and newest age', () => {
    const rows = aggregateSpots(cluster, { now: NOW });
    const p20 = rows.find((r) => r.key === 'P5DX|20m');
    expect(p20.spotters).toBe(2);
    expect(p20.ageMs).toBe(2 * 60_000);
    expect(p20.lat).toBe(39);
    expect(rows.find((r) => r.key === 'P5DX|40m').spotters).toBe(1);
    expect(rows.find((r) => r.call === 'DL1ABC')).toBeUndefined();
  });
  it('accepts activation spots with MHz strings, HH:MMz times and US states', () => {
    const rows = aggregateSpots(
      [
        {
          call: 'W1AW',
          freq: '14.285',
          mode: 'SSB',
          ref: 'US-0001',
          lat: 41,
          lon: -72,
          time: '12:20z',
          locationDesc: 'US-CT',
        },
      ],
      { now: NOW, source: 'pota' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ call: 'W1AW', band: '20m', mode: 'SSB', state: 'CT', source: 'pota', spotters: 1 });
  });
  it('merges candidate lists across sources', () => {
    const a = aggregateSpots(cluster, { now: NOW });
    const b = aggregateSpots([{ call: 'P5DX', freq: '14.025', time: '12:29z', grid: 'PM39' }], {
      now: NOW,
      source: 'sota',
    });
    const merged = mergeCandidates(a, b);
    const p20 = merged.find((r) => r.key === 'P5DX|20m');
    expect(p20.spotters).toBe(3);
    expect(p20.grid).toBe('PM39');
    expect(p20.ageMs).toBe(60_000);
  });
});

describe('evaluateNeeds', () => {
  const cand = { call: 'P5DX', band: '20m', grid: 'PM39', state: null };
  it('flags a new DXCC entity and new zone', () => {
    const awards = awardsWith({ dxcc: [['DL', ['20m']]], waz: [14] });
    const r = evaluateNeeds(cand, { awards, resolve });
    expect(r.needs).toEqual(['dxcc', 'zone']);
    expect(r.weight).toBe(1 + 10 + 6);
    expect(r.entity).toBe('North Korea');
  });
  it('flags a new band slot when the entity is worked elsewhere', () => {
    const awards = awardsWith({ dxcc: [['P5', ['40m']]], waz: [25] });
    expect(evaluateNeeds(cand, { awards, resolve }).needs).toEqual(['band']);
  });
  it('flags new state / grid only when the log carries that data', () => {
    const w = { call: 'W1AW', band: '20m', grid: 'FN31', state: 'CT' };
    const noStateData = awardsWith({ dxcc: [['K', ['20m']]], waz: [5] });
    expect(evaluateNeeds(w, { awards: noStateData, resolve }).needs).toEqual([]);
    const withData = awardsWith({ dxcc: [['K', ['20m']]], waz: [5], was: ['NY'], vucc: ['FN20'], withState: 3 });
    expect(evaluateNeeds(w, { awards: withData, resolve }).needs).toEqual(['state', 'grid']);
  });
  it('is quiet with an empty log or an unresolvable call', () => {
    expect(evaluateNeeds(cand, { awards: awardsWith({ total: 0 }), resolve }).needs).toEqual([]);
    expect(evaluateNeeds({ call: 'XX9XX', band: '20m' }, { awards: awardsWith(), resolve }).weight).toBe(1);
  });
  it('stays quiet when nothing in the log resolved (cty not loaded at index time)', () => {
    const awards = awardsWith({ total: 5 });
    awards.dxcc.unresolved = 5;
    expect(evaluateNeeds(cand, { awards, resolve }).needs).toEqual([]);
  });
});

describe('scoring', () => {
  it('activity grows with spotters and decays with age (7 min half-life)', () => {
    expect(activityScore({ spotters: 1, ageMs: 0 })).toBe(1);
    expect(activityScore({ spotters: 4, ageMs: 0 })).toBe(3);
    expect(activityScore({ spotters: 1, ageMs: 7 * 60_000 })).toBeCloseTo(0.5);
  });
  it('reliability factor is clamped with a floor', () => {
    expect(reliabilityFactor(80)).toBe(0.8);
    expect(reliabilityFactor(0)).toBe(0.05);
    expect(reliabilityFactor(150)).toBe(1);
    expect(reliabilityFactor(null)).toBeNull();
  });
  it('band-opening fallback rises with the surge factor towards my zone/continent', () => {
    const payload = {
      openings: [{ band: '20m', to_continent: 'NA', factor: 4 }],
      zone_openings: [{ band: '15m', to_zone: 5, factor: 7 }],
    };
    expect(bandOpeningScore(payload, '20m', { myContinent: 'NA' })).toBeCloseTo(0.7);
    expect(bandOpeningScore(payload, '15m', { myZone: 5 })).toBeCloseTo(1);
    expect(bandOpeningScore(payload, '10m', { myZone: 5, myContinent: 'NA' })).toBe(0.3);
    expect(bandOpeningScore(payload, '20m', { myContinent: 'EU' })).toBe(0.3);
    expect(bandOpeningScore(null, '20m')).toBe(0.3);
  });
  it('score multiplies need × activity × reliability, falling back to openings', () => {
    expect(scoreOpportunity({ weight: 11, activity: 2, reliability: 50 })).toBeCloseTo(11);
    expect(scoreOpportunity({ weight: 11, activity: 2, reliability: null, fallback: 0.3 })).toBeCloseTo(6.6);
  });
});

describe('rankOpportunities / selectForPrediction', () => {
  const cands = [
    {
      key: 'P5DX|20m',
      call: 'P5DX',
      band: '20m',
      spotters: 2,
      ageMs: 60_000,
      weight: 17,
      needs: ['dxcc', 'zone'],
      lat: 39,
      lon: 125,
    },
    { key: 'DL1ABC|20m', call: 'DL1ABC', band: '20m', spotters: 10, ageMs: 0, weight: 1, needs: [], lat: 50, lon: 10 },
    { key: 'W1AW|40m', call: 'W1AW', band: '40m', spotters: 3, ageMs: 0, weight: 5, needs: ['band'] },
  ];
  it('ranks a rare needed entity above a busy worked one even on a poorer path', () => {
    const rel = { P5DX: 50, DL1ABC: 90 }; // W1AW has no location → no prediction
    const rows = rankOpportunities(cands, { reliabilityFor: (c) => rel[c.call] ?? null });
    expect(rows[0].call).toBe('P5DX');
    expect(rows[0].reliability).toBe(50);
    expect(rows[0].reliabilitySource).toBe('p533');
    expect(rows.find((r) => r.call === 'W1AW').reliabilitySource).toBe('openings');
  });
  it('honours the limit', () => {
    expect(rankOpportunities(cands, { limit: 2 })).toHaveLength(2);
  });
  it('selects only located candidates for prediction, best need×activity first, capped', () => {
    const sel = selectForPrediction(cands, { max: 1 });
    expect(sel.map((c) => c.call)).toEqual(['P5DX']);
    expect(selectForPrediction(cands)).toHaveLength(2);
  });
});

describe('misc', () => {
  it('nearestFrequencyReliability picks the closest P.533 row within 2 MHz', () => {
    const freqs = [
      { freq: 7.1, reliability: 60 },
      { freq: 14.1, reliability: 85 },
    ];
    expect(nearestFrequencyReliability(freqs, 14.025)).toBe(85);
    expect(nearestFrequencyReliability(freqs, 50.1)).toBeNull();
    expect(nearestFrequencyReliability(null, 14)).toBeNull();
  });
  it('extracts a US state from a location descriptor', () => {
    expect(stateFromLocationDesc('US-CO')).toBe('CO');
    expect(stateFromLocationDesc('US-CO,US-WY')).toBe('CO');
    expect(stateFromLocationDesc('DE-BY')).toBeNull();
  });
});
