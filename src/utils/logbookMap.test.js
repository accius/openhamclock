import { describe, expect, it } from 'vitest';

import { buildLogbookMapPoints } from './logbookMap.js';

const qso = (over = {}) => ({ call: 'OZ1ABC', band: '20m', mode: 'SSB', gridsquare: 'JO65', ...over });

// Stand-in for cty.dat: only Japan resolves.
const lookup = (call) => (call.startsWith('JA') ? { lat: 36, lon: 138, entity: 'Japan' } : null);

describe('buildLogbookMapPoints', () => {
  it('places a QSO at the centre of its grid square', () => {
    const [p] = buildLogbookMapPoints([qso({ gridsquare: 'jo65' })], { lookup });
    expect(p.lat).toBeCloseTo(55.5);
    expect(p.lon).toBeCloseTo(13);
    expect(p.approx).toBe(false);
    expect(p.place).toBe('JO65');
    expect(p.band).toBe('20m');
  });

  it('falls back to the country position when there is no usable grid', () => {
    const points = buildLogbookMapPoints(
      [qso({ call: 'JA1XYZ', gridsquare: '' }), qso({ call: 'JA2XYZ', gridsquare: 'ZZ99' })],
      {
        lookup,
      },
    );
    expect(points).toHaveLength(1); // same position + band → one point
    expect(points[0]).toMatchObject({ lat: 36, lon: 138, approx: true, place: 'Japan' });
    expect(points[0].qsos).toHaveLength(2);
  });

  it('leaves out QSOs it cannot place', () => {
    expect(buildLogbookMapPoints([qso({ call: 'W1AW', gridsquare: '' })], { lookup })).toEqual([]);
  });

  it('keeps one point per band at the same position', () => {
    const points = buildLogbookMapPoints([qso(), qso({ call: 'OZ2DEF' }), qso({ band: '40m' })], { lookup });
    expect(points.map((p) => [p.band, p.qsos.length]).sort()).toEqual([
      ['20m', 2],
      ['40m', 1],
    ]);
  });

  it('takes the band from the frequency when the QSO has no band tag', () => {
    const [p] = buildLogbookMapPoints([qso({ band: '', freq: 7.03 })], { lookup });
    expect(p.band).toBe('40m');
  });

  it('applies the Logbook panel filter', () => {
    const log = [qso(), qso({ call: 'OZ2DEF', mode: 'CW' }), qso({ call: 'DL1AA', band: '40m', gridsquare: 'JO40' })];
    const count = (filter) => buildLogbookMapPoints(log, { filter, lookup }).reduce((n, p) => n + p.qsos.length, 0);
    expect(count(undefined)).toBe(3);
    expect(count({ band: '20m' })).toBe(2);
    expect(count({ mode: 'cw' })).toBe(1);
    expect(count({ search: 'dl1' })).toBe(1);
  });
});
