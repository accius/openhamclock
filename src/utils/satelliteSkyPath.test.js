import { describe, it, expect } from 'vitest';
import * as satellite from 'satellite.js';
import Orbit from './orbit.js';
import {
  observerFromLocation,
  lookAnglesAt,
  computePassSkyPath,
  polarXY,
  skyPathToSvgPoints,
} from './satelliteSkyPath.js';

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
const T0 = new Date('2026-09-13T00:00:00Z');

describe('observerFromLocation / lookAnglesAt', () => {
  it('builds an observer and returns finite look angles', () => {
    const obs = observerFromLocation(DE);
    expect(obs.height).toBeCloseTo(0.26, 6);
    expect(observerFromLocation(null)).toBeNull();
    const la = lookAnglesAt(satellite.json2satrec(ISS_OMM), obs, T0);
    expect(la.azimuth).toBeGreaterThanOrEqual(0);
    expect(la.azimuth).toBeLessThan(360);
    expect(la.elevation).toBeGreaterThan(-90);
    expect(la.rangeKm).toBeGreaterThan(300);
    expect(Math.abs(la.rangeRateKmS)).toBeLessThan(8);
    expect(lookAnglesAt(null, obs, T0)).toBeNull();
  });
});

describe('computePassSkyPath', () => {
  const satrec = satellite.json2satrec(ISS_OMM);
  const obs = observerFromLocation(DE);
  const orbit = new Orbit('ISS', ISS_OMM);
  const passes = orbit.computePassesElevation(
    { latitude: DE.lat, longitude: DE.lon, height: DE.stationAlt },
    T0,
    new Date(T0.getTime() + 2 * 24 * 3600 * 1000),
    5,
    3,
  );

  it('samples a real pass from AOS to LOS with the apex in between', () => {
    expect(passes.length).toBeGreaterThan(0);
    const p = passes[0];
    const sky = computePassSkyPath(satrec, obs, p.start, p.end, 10);
    expect(sky).not.toBeNull();
    expect(sky.points.length).toBeGreaterThan(10);
    // Elevation profile: rises then falls; apex matches the Orbit predictor
    expect(sky.max.el).toBeCloseTo(p.maxElevation, 0);
    expect(sky.max.t).toBeGreaterThanOrEqual(sky.aos.t);
    expect(sky.max.t).toBeLessThanOrEqual(sky.los.t);
    expect(sky.points[0].el).toBeLessThan(sky.max.el);
    expect(sky.points[sky.points.length - 1].el).toBeLessThan(sky.max.el);
    // AOS / LOS azimuths agree with the predictor to within a few degrees
    expect(Math.abs((((sky.aos.az - p.azimuthStart) % 360) + 540) % 360) - 180).toBeLessThan(6);
    expect(Math.abs((((sky.los.az - p.azimuthEnd) % 360) + 540) % 360) - 180).toBeLessThan(6);
  });

  it('bounds the sample count and rejects bad windows', () => {
    const p = passes[0];
    const sky = computePassSkyPath(satrec, obs, p.start, p.end, 0.001);
    expect(sky.points.length).toBeLessThanOrEqual(602);
    expect(computePassSkyPath(satrec, obs, 10, 5)).toBeNull();
    expect(computePassSkyPath(null, obs, 0, 10)).toBeNull();
  });
});

describe('polar projection', () => {
  it('puts zenith at the centre and the horizon on the rim, north up', () => {
    expect(polarXY(0, 90, 100)).toEqual({ x: 100, y: 100 });
    const n = polarXY(0, 0, 100);
    expect(n.x).toBeCloseTo(100, 6);
    expect(n.y).toBeCloseTo(0, 6);
    const e = polarXY(90, 0, 100);
    expect(e.x).toBeCloseTo(200, 6);
    expect(e.y).toBeCloseTo(100, 6);
    const s45 = polarXY(180, 45, 100);
    expect(s45.x).toBeCloseTo(100, 6);
    expect(s45.y).toBeCloseTo(150, 6);
  });
  it('clamps elevation and serialises SVG points', () => {
    expect(polarXY(0, -10, 100).y).toBeCloseTo(0, 6);
    expect(polarXY(0, 120, 100)).toEqual({ x: 100, y: 100 });
    const pts = skyPathToSvgPoints(
      [
        { az: 0, el: 0 },
        { az: 90, el: 90 },
      ],
      50,
    );
    expect(pts).toBe('50.0,0.0 50.0,50.0');
    expect(skyPathToSvgPoints(null, 50)).toBe('');
  });
});
