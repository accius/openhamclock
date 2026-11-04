import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseLatestObs, parseStationTable, nearestStations, haversineKm } from './ndbcLatestObs.js';

const fx = fs.readFileSync(path.join(__dirname, '__fixtures__', 'ndbc-latest-obs.txt'), 'utf8');

describe('parseLatestObs', () => {
  const rows = parseLatestObs(fx);

  it('skips the two header lines and parses every station row', () => {
    expect(rows.length).toBe(19);
    expect(rows[0].id).toBe('41004');
  });

  it('maps columns to named fields with MM → null', () => {
    const b = rows.find((r) => r.id === '41004');
    expect(b).toMatchObject({
      lat: 32.502,
      lon: -79.099,
      wdir: 230,
      wspd: 3,
      gst: 4,
      wvht: 0.6,
      dpd: 7,
      apd: 6,
      mwd: 103,
      pres: 1018.4,
      ptdy: null,
      atmp: 26.2,
      wtmp: 28.1,
      dewp: 20.2,
      vis: null,
      tide: null,
    });
    expect(b.time).toBe('2026-10-14T22:50:00.000Z');
  });

  it('keeps rows whose wind is missing but waves are present', () => {
    const b = rows.find((r) => r.id === '44025');
    expect(b.wspd).toBeNull();
    expect(b.wvht).toBe(1);
  });

  it('handles alphanumeric station ids and eastern longitudes', () => {
    expect(rows.find((r) => r.id === 'LONF1').pres).toBe(1013.9);
    expect(rows.find((r) => r.id === '46070').lon).toBe(175.246);
  });

  it('returns [] for bad input', () => {
    expect(parseLatestObs(null)).toEqual([]);
    expect(parseLatestObs('#only\n#headers\n')).toEqual([]);
  });
});

describe('parseStationTable', () => {
  it('maps station id to name/owner/type', () => {
    const t = parseStationTable(
      '# STATION_ID | OWNER | TTYPE | HULL | NAME | PAYLOAD | LOCATION | TIMEZONE | FORECAST | NOTE\n#\n' +
        '0y2w3|CG|Weather Station||Sturgeon Bay CG Station, WI||44.794 N 87.313 W|C| |\n' +
        '44013|NDBC|3-meter discus buoy|SCOOP|BOSTON 16 NM East of Boston, MA|AMPS|42.346 N 70.651 W|E| |\n',
    );
    expect(t.get('44013').name).toBe('BOSTON 16 NM East of Boston, MA');
    expect(t.get('0Y2W3').type).toBe('Weather Station');
    expect(t.size).toBe(2);
  });
});

describe('nearestStations', () => {
  it('sorts by distance from the given point and annotates km/bearing', () => {
    const rows = parseLatestObs(fx);
    const near = nearestStations(rows, 42.36, -71.06, 3); // Boston
    expect(near[0].id).toBe('44013');
    expect(near[0].km).toBeGreaterThan(30);
    expect(near[0].km).toBeLessThan(40);
    expect(near[0].bearing).toBeGreaterThan(80);
    expect(near[0].bearing).toBeLessThan(110);
    expect(near.length).toBe(3);
    expect(near[1].km).toBeGreaterThanOrEqual(near[0].km);
  });
  it('returns [] without a location', () => {
    expect(nearestStations([{ lat: 0, lon: 0 }], NaN, 0)).toEqual([]);
  });
});

describe('haversineKm', () => {
  it('matches a known distance', () => {
    expect(haversineKm(51.5, -0.12, 48.86, 2.35)).toBeCloseTo(343, -1);
  });
});
