import { describe, it, expect } from 'vitest';
import {
  makeObserver,
  satrecFor,
  relayGeometry,
  computeMutualPasses,
  rankRelayCandidates,
  hasRelay,
  dopplerCorrected,
  matchSatSpot,
  satShortName,
  findAmsatRow,
  computeElevationSeries,
} from './satRelay.js';

// ISS-like element set (mid-2026 epoch). Structural checks only — the tests
// never assert specific pass times.
const ISS_OMM = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  EPOCH: '2026-09-13T00:00:00.000000',
  MEAN_MOTION: 15.49,
  ECCENTRICITY: 0.0004,
  INCLINATION: 51.64,
  RA_OF_ASC_NODE: 120.5,
  ARG_OF_PERICENTER: 30.1,
  MEAN_ANOMALY: 330.0,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 50000,
  BSTAR: 0.0001,
  MEAN_MOTION_DOT: 0.00002,
  MEAN_MOTION_DDOT: 0,
};
const DE = { lat: 44.98, lon: -93.27, stationAlt: 260 };
const DX = { lat: 40.0, lon: -80.0, stationAlt: 300 }; // ~1,100 km away — shares ISS passes
const FAR = { lat: -33.87, lon: 151.21 }; // Sydney — never a common ISS pass with Minneapolis
const T0 = new Date('2026-09-13T00:00:00Z');

describe('makeObserver / satrecFor', () => {
  it('builds a geodetic observer in radians and km', () => {
    const o = makeObserver(DE);
    expect(o.latitude).toBeCloseTo((44.98 * Math.PI) / 180, 6);
    expect(o.height).toBeCloseTo(0.26, 6);
    expect(makeObserver(null)).toBeNull();
    expect(makeObserver({ lat: 'x' })).toBeNull();
  });
  it('memoises satrecs per element set', () => {
    expect(satrecFor(ISS_OMM)).toBe(satrecFor(ISS_OMM));
    expect(satrecFor(null)).toBeNull();
  });
});

describe('relayGeometry', () => {
  it('returns a LEO position and per-observer look angles', () => {
    const g = relayGeometry(satrecFor(ISS_OMM), T0, makeObserver(DE), makeObserver(DX));
    expect(g.altKm).toBeGreaterThan(350);
    expect(g.altKm).toBeLessThan(500);
    expect(Math.abs(g.lat)).toBeLessThanOrEqual(52);
    expect(g.de.azimuth).toBeGreaterThanOrEqual(0);
    expect(g.de.azimuth).toBeLessThan(360);
    expect(g.de.rangeKm).toBeGreaterThan(350);
    expect(g.dx.dopplerFactor).toBeGreaterThan(0.99);
    expect(g.dx.dopplerFactor).toBeLessThan(1.01);
  });
  it('omits dx when no DX observer is given', () => {
    const g = relayGeometry(satrecFor(ISS_OMM), T0, makeObserver(DE), null);
    expect(g.dx).toBeNull();
  });
});

describe('computeMutualPasses', () => {
  it('finds passes both nearby stations share, with consistent per-station edges', () => {
    const passes = computeMutualPasses(ISS_OMM, T0, DE, DX, { hours: 24, minElev: 5 });
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.end.getTime()).toBeGreaterThan(p.start.getTime());
      expect(p.end - p.start).toBeLessThan(15 * 60_000); // a LEO pass
      expect(p.peakCommonEl).toBeGreaterThanOrEqual(5);
      // Each station's own pass must contain the common window
      expect(p.de.aos.getTime()).toBeLessThanOrEqual(p.start.getTime() + 2000);
      expect(p.de.los.getTime()).toBeGreaterThanOrEqual(p.end.getTime() - 2000);
      expect(p.dx.aos.getTime()).toBeLessThanOrEqual(p.start.getTime() + 2000);
      expect(p.dx.los.getTime()).toBeGreaterThanOrEqual(p.end.getTime() - 2000);
    }
  });
  it('finds nothing for stations that can never share a footprint', () => {
    expect(computeMutualPasses(ISS_OMM, T0, DE, FAR, { hours: 24 })).toEqual([]);
  });
  it('returns [] without elements or an observer', () => {
    expect(computeMutualPasses(null, T0, DE, DX)).toEqual([]);
    expect(computeMutualPasses(ISS_OMM, T0, DE, null)).toEqual([]);
  });
});

describe('rankRelayCandidates / hasRelay', () => {
  const relaySat = {
    name: 'ISS',
    omm: ISS_OMM,
    relayTransmitters: [{ uplinkLowHz: 145990000, downlinkLowHz: 437800000 }],
  };
  const beaconOnly = { name: 'CUBE', omm: ISS_OMM, relayTransmitters: [] };
  it('puts relay-capable satellites first, ordered by next pass', () => {
    const rows = rankRelayCandidates([beaconOnly, relaySat], T0, DE, DX, { hours: 24 });
    expect(rows[0].sat.name).toBe('ISS');
    expect(rows[0].relay).toBe(true);
    expect(rows[0].nextPass).not.toBeNull();
    expect(rows[1].sat.name).toBe('CUBE');
    expect(rows[1].nextPass).toBeNull();
    expect(hasRelay(relaySat)).toBe(true);
    expect(hasRelay(beaconOnly)).toBe(false);
  });
});

describe('dopplerCorrected', () => {
  const tx = { uplinkLowHz: 145990000, uplinkHighHz: 145990000, downlinkLowHz: 437800000, downlinkHighHz: 437800000 };
  it('shifts the downlink by the factor and the uplink by its inverse', () => {
    const c = dopplerCorrected(tx, 1.00002); // approaching: received higher
    expect(c.downlinkHz).toBeCloseTo(437800000 * 1.00002, 0);
    expect(c.uplinkHz).toBeCloseTo(145990000 / 1.00002, 0);
    expect(c.downlinkShiftHz).toBeGreaterThan(0);
    expect(c.uplinkShiftHz).toBeLessThan(0);
  });
  it('handles missing data', () => {
    expect(dopplerCorrected(null, 1)).toBeNull();
    expect(dopplerCorrected(tx, 0)).toBeNull();
  });
});

describe('matchSatSpot / satShortName / findAmsatRow', () => {
  const tracked = ['ISS (ZARYA)', 'SO-50', 'AO-91 (Fox-1B)', 'RS-44 (DOSAAF)'];
  it('recognises satellite spots on satellite bands and names the tracked bird', () => {
    expect(matchSatSpot({ freq: '145.850', comment: 'via SO-50 FM 67.0' }, tracked)).toEqual({ satName: 'SO-50' });
    expect(matchSatSpot({ freq: '436.795', comment: 'AO-91 loud' }, tracked)).toEqual({ satName: 'AO-91 (Fox-1B)' });
    expect(matchSatSpot({ freq: '437.800', comment: 'ISS repeater' }, tracked)).toEqual({ satName: 'ISS (ZARYA)' });
    expect(matchSatSpot({ freq: '29.450', comment: 'AO-7 mode A' }, tracked)).toEqual({ satName: null });
  });
  it('rejects non-satellite VHF traffic and HF', () => {
    expect(matchSatSpot({ freq: '144.174', comment: 'FT8 tropo' }, tracked)).toBeNull();
    expect(matchSatSpot({ freq: '14.074', comment: 'via SO-50' }, tracked)).toBeNull();
    expect(matchSatSpot(null, tracked)).toBeNull();
  });
  it('shortens tracked names to their designator', () => {
    expect(satShortName('AO-91 (Fox-1B)')).toBe('AO-91');
    expect(satShortName('ISS (ZARYA)')).toBe('ISS');
  });
  it('pairs tracked satellites with AMSAT status rows, preferring the voice row for the ISS', () => {
    const rows = [
      { name: 'ISS [DATA]' },
      { name: 'ISS [FM]' },
      { name: 'SO-50 [FM]' },
      { name: 'AO-91 [FM]' },
      { name: 'FO-29 [V/u]' },
      { name: 'GRBBeta [UHF Digi]' },
    ];
    expect(findAmsatRow('ISS (ZARYA)', rows).name).toBe('ISS [FM]');
    expect(findAmsatRow('SO-50', rows).name).toBe('SO-50 [FM]');
    expect(findAmsatRow('AO-91 (Fox-1B)', rows).name).toBe('AO-91 [FM]');
    expect(findAmsatRow('FO-29 (JAS-2)', rows).name).toBe('FO-29 [V/u]');
    expect(findAmsatRow('RS-44 (DOSAAF)', rows)).toBeNull();
  });
});

describe('computeElevationSeries (satellite planner)', () => {
  it('samples both stations each minute for 24 h and matches relayGeometry', () => {
    const series = computeElevationSeries(ISS_OMM, T0, DE, DX, { hours: 24, stepSec: 60 });
    expect(series.length).toBe(24 * 60 + 1);
    const p = series[300];
    const g = relayGeometry(satrecFor(ISS_OMM), p.t, makeObserver(DE), makeObserver(DX));
    expect(p.de).toBeCloseTo(g.de.elevation, 9);
    expect(p.dx).toBeCloseTo(g.dx.elevation, 9);
    expect(p.lat).toBeCloseTo(g.lat, 9);
    expect(p.altKm).toBeGreaterThan(300);
    // LEO: the bird is below the horizon most of the time at both ends
    const upDE = series.filter((x) => x.de > 0).length;
    expect(upDE).toBeGreaterThan(0);
    expect(upDE).toBeLessThan(series.length / 3);
  });
  it('agrees with computeMutualPasses: every pass has common elevation ≥ minElev at its peak sample', () => {
    const passes = computeMutualPasses(ISS_OMM, T0, DE, DX, { hours: 24, minElev: 5 });
    const series = computeElevationSeries(ISS_OMM, T0, DE, DX, { hours: 24, stepSec: 60 });
    for (const pass of passes) {
      const inside = series.filter((x) => x.t >= pass.start && x.t <= pass.end);
      expect(inside.length).toBeGreaterThan(0);
      expect(Math.max(...inside.map((x) => Math.min(x.de, x.dx)))).toBeGreaterThanOrEqual(5 - 0.5);
    }
  });
  it('works with only one station and returns [] with none / bad OMM', () => {
    const only = computeElevationSeries(ISS_OMM, T0, DE, null, { hours: 1, stepSec: 600 });
    expect(only.length).toBe(7);
    expect(only[0].dx).toBeNull();
    expect(typeof only[0].de).toBe('number');
    const dxOnly = computeElevationSeries(ISS_OMM, T0, null, DX, { hours: 1, stepSec: 600 });
    expect(dxOnly[0].de).toBeNull();
    expect(typeof dxOnly[0].dx).toBe('number');
    expect(computeElevationSeries(ISS_OMM, T0, null, null)).toEqual([]);
    expect(computeElevationSeries(null, T0, DE, DX)).toEqual([]);
  });
});
