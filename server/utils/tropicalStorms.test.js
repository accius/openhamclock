import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractKml } from './kmz.js';
import { parseNhcTrack, parseNhcCone, parseJtwcKml } from './tropicalKml.js';
import { parseJtwcRss, parseJtwcWarningText } from './jtwcWarning.js';
import {
  categoryFromWind,
  basinFromNhcId,
  compassText,
  normalizeNhcStorm,
  normalizeJtwcStorm,
  dedupeStorms,
  ddhhmmZToIso,
} from './tropicalStorms.js';

const fxPath = (n) => path.join(__dirname, '__fixtures__', n);
const kml = (n) => extractKml(fs.readFileSync(fxPath(n)));

describe('categoryFromWind', () => {
  it('follows Saffir–Simpson thresholds', () => {
    expect(categoryFromWind(30).code).toBe('TD');
    expect(categoryFromWind(34).code).toBe('TS');
    expect(categoryFromWind(63).code).toBe('TS');
    expect(categoryFromWind(64).code).toBe('1');
    expect(categoryFromWind(83).code).toBe('2');
    expect(categoryFromWind(96).code).toBe('3');
    expect(categoryFromWind(113).code).toBe('4');
    expect(categoryFromWind(137).code).toBe('5');
    expect(categoryFromWind(137).saffirSimpson).toBe(5);
    expect(categoryFromWind(null).code).toBe('?');
  });
  it('says Cyclone in the southern hemisphere', () => {
    expect(categoryFromWind(100, true).label).toBe('Category 3 Cyclone');
  });
});

describe('helpers', () => {
  it('basinFromNhcId', () => {
    expect(basinFromNhcId('ep212026')).toBe('EP');
    expect(basinFromNhcId(null, 'AL3')).toBe('AL');
  });
  it('compassText', () => {
    expect(compassText(300)).toBe('WNW');
    expect(compassText(0)).toBe('N');
    expect(compassText(null)).toBeNull();
  });
  it('ddhhmmZToIso resolves within the current month, wrapping to last month when needed', () => {
    const now = new Date('2026-10-14T23:00:00Z');
    expect(ddhhmmZToIso('141800Z', now)).toBe('2026-10-14T18:00:00.000Z');
    expect(ddhhmmZToIso('301200Z', new Date('2026-11-02T00:00:00Z'))).toBe('2026-10-30T12:00:00.000Z');
    expect(ddhhmmZToIso('bogus', now)).toBeNull();
  });
});

describe('normalizeNhcStorm', () => {
  const json = JSON.parse(fs.readFileSync(fxPath('nhc-current-storms.json'), 'utf8'));
  const trudy = json.activeStorms.find((s) => s.name === 'Trudy');
  const storm = normalizeNhcStorm(trudy, parseNhcTrack(kml('nhc-track.kmz')), parseNhcCone(kml('nhc-cone.kmz')));

  it('produces the common storm shape', () => {
    expect(storm).toMatchObject({
      id: 'ep212026',
      source: 'NHC',
      name: 'Trudy',
      basin: 'EP',
      classification: 'TS',
      classificationLabel: 'Tropical Storm',
      windKt: 55,
      gustKt: 65,
      pressureMb: 997,
      lat: 11.9,
      lon: -100,
      movementDeg: 300,
      movementKt: 9,
      movementText: 'WNW',
      advisoryNum: 6,
    });
    expect(storm.category.code).toBe('TS');
    expect(storm.advisoryUrl).toMatch(/^https:\/\/www\.nhc\.noaa\.gov\//);
  });

  it('carries track, forecast and cone geometry', () => {
    expect(storm.track[0]).toEqual([11.9, -100]);
    expect(storm.track.length).toBe(9);
    expect(storm.forecast.length).toBe(9);
    expect(storm.cone.length).toBeGreaterThan(100);
  });

  it('works without any GIS products', () => {
    const bare = normalizeNhcStorm(trudy);
    expect(bare.track).toEqual([[11.9, -100]]);
    expect(bare.forecast).toEqual([]);
    expect(bare.cone).toEqual([]);
  });
});

describe('normalizeJtwcStorm', () => {
  const entries = parseJtwcRss(fs.readFileSync(fxPath('jtwc.rss'), 'utf8'));
  const entry = entries.find((e) => e.id === 'wp2826');
  const warning = parseJtwcWarningText(fs.readFileSync(fxPath('jtwc-wp2826web.txt'), 'utf8'));
  const now = new Date('2026-10-14T23:30:00Z');
  const storm = normalizeJtwcStorm(entry, warning, parseJtwcKml(kml('jtwc-wp28.kmz')), now);

  it('merges RSS, warning text and KML', () => {
    expect(storm).toMatchObject({
      id: 'jtwc-wp2826',
      source: 'JTWC',
      name: 'Twentyeight',
      designation: '28W',
      basin: 'WP',
      classification: 'TD',
      windKt: 30,
      gustKt: 40,
      pressureMb: 1007,
      lat: 22.7,
      lon: 141.1,
      movementDeg: 305,
      movementKt: 12,
      movementText: 'NW',
      advisoryNum: 12,
      lastUpdate: '2026-10-14T18:00:00.000Z',
    });
    expect(storm.forecast.map((f) => f.hour)).toEqual([12, 24, 36]);
    expect(storm.forecast[0].validAt).toBe('2026-10-15T06:00:00.000Z');
    expect(storm.track.length).toBe(4);
    expect(storm.cone.length).toBeGreaterThan(20);
    expect(storm.bestTrack.length).toBeGreaterThan(10);
  });

  it('falls back to the warning text when there is no KML', () => {
    const s = normalizeJtwcStorm(entry, warning, null, now);
    expect(s.track).toEqual([
      [22.7, 141.1],
      [23.4, 139.4],
      [23.9, 137.5],
      [23.8, 135.6],
    ]);
    expect(s.cone).toEqual([]);
  });

  it('still yields a storm from the RSS entry alone', () => {
    const s = normalizeJtwcStorm(entry, null, null, now);
    expect(s.name).toBe('Twentyeight');
    expect(s.lat).toBeNull();
    expect(s.category.code).toBe('?');
  });
});

describe('dedupeStorms', () => {
  it('drops JTWC copies of NHC/CPHC basins and same-named storms', () => {
    const nhc = [{ name: 'Trudy', basin: 'EP' }];
    const jtwc = [
      { name: 'Trudy', basin: 'EP' },
      { name: 'Twentyeight', basin: 'WP' },
      { name: 'Trudy', basin: 'WP' },
    ];
    expect(dedupeStorms(nhc, jtwc).map((s) => `${s.basin}:${s.name}`)).toEqual(['EP:Trudy', 'WP:Twentyeight']);
  });
});
