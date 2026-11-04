import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractKml } from './kmz.js';
import {
  parseCoordinates,
  parsePlacemarks,
  parseNhcTrack,
  parseNhcCone,
  parseJtwcKml,
  parseJtwcTau,
} from './tropicalKml.js';

const kml = (name) => extractKml(fs.readFileSync(path.join(__dirname, '__fixtures__', name)));

describe('parseCoordinates', () => {
  it('converts lon,lat,alt tuples to [lat, lon]', () => {
    expect(parseCoordinates(' -100.0,11.9,0 -100.8,12.5,0 ')).toEqual([
      [11.9, -100],
      [12.5, -100.8],
    ]);
  });
  it('ignores malformed tokens', () => {
    expect(parseCoordinates('abc 1,2,0')).toEqual([[2, 1]]);
    expect(parseCoordinates(null)).toEqual([]);
  });
});

describe('parseNhcTrack', () => {
  const track = parseNhcTrack(kml('nhc-track.kmz'));

  it('picks the longest LineString as the track (120 h)', () => {
    expect(track.track.length).toBe(9);
    expect(track.track[0]).toEqual([11.9, -100]);
    expect(track.track[8]).toEqual([19.4, -107.2]);
  });

  it('extracts forecast points with hour, wind and gusts', () => {
    const hours = track.forecast.map((p) => p.hour);
    expect(hours).toEqual([0, 12, 24, 36, 48, 60, 72, 96, 120]);
    const last = track.forecast[track.forecast.length - 1];
    expect(last).toMatchObject({ hour: 120, lat: 19.4, lon: -107.2, windKt: 65, gustKt: 80 });
    expect(last.validAt).toContain('October 19, 2026');
  });

  it('collects storm metadata from ExtendedData', () => {
    expect(track.meta).toMatchObject({
      stormName: 'Trudy',
      atcfId: 'EP212026',
      advisoryNum: 6,
      windKt: 55,
      gustKt: 65,
      pressureMb: 997,
      movement: 'WNW',
    });
  });
});

describe('parseNhcCone', () => {
  it('returns the outer ring of the cone polygon', () => {
    const cone = parseNhcCone(kml('nhc-cone.kmz'));
    expect(cone.length).toBeGreaterThan(100);
    expect(cone[0][0]).toBeCloseTo(11.63, 1);
    expect(cone[0][1]).toBeCloseTo(-100.01, 1);
  });
  it('returns [] when there is no polygon', () => {
    expect(parseNhcCone('<kml><Placemark><Point><coordinates>1,2,0</coordinates></Point></Placemark></kml>')).toEqual(
      [],
    );
  });
});

describe('parseJtwcKml', () => {
  const j = parseJtwcKml(kml('jtwc-wp28.kmz'));

  it('reads the storm track line', () => {
    expect(j.track).toEqual([
      [22.7, 141.1],
      [23.4, 139.4],
      [23.9, 137.5],
      [23.8, 135.6],
    ]);
  });

  it('reads forecast points from TAU descriptions', () => {
    expect(j.forecast.map((f) => f.hour)).toEqual([0, 12, 24, 36]);
    expect(j.forecast[1]).toMatchObject({ hour: 12, validAt: '2026-10-15T06:00Z', lat: 23.4, lon: 139.4, windKt: 25 });
  });

  it('reads the 34 kt danger swath polygon and best-track posits', () => {
    expect(j.swath.length).toBeGreaterThan(20);
    expect(j.bestTrack.length).toBeGreaterThan(10);
    expect(j.bestTrack[0]).toEqual({ time: '2026-10-10T00:00Z', lat: 13.7, lon: 145.8, windKt: 20 });
  });
});

describe('parseJtwcTau', () => {
  it('parses TAU strings', () => {
    expect(parseJtwcTau('TAU 24 - 2026101518Z')).toEqual({ hour: 24, validAt: '2026-10-15T18:00Z' });
    expect(parseJtwcTau('nope')).toEqual({ hour: null, validAt: null });
  });
});

describe('parsePlacemarks', () => {
  it('handles CDATA names and ExtendedData', () => {
    const pms = parsePlacemarks(
      '<Placemark><name><![CDATA[A <b>b</b>]]></name><ExtendedData><Data name="x"><value>1</value></Data></ExtendedData></Placemark>',
    );
    expect(pms[0].name).toBe('A b');
    expect(pms[0].data.x).toBe('1');
  });
});
