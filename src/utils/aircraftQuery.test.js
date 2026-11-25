import { describe, expect, it } from 'vitest';
import { aircraftCell, aircraftUrl } from './aircraftQuery.js';

const route = require('../../server/routes/aircraft.js');

describe('aircraftQuery (#1284)', () => {
  it('snaps to the same cell the server uses', () => {
    for (const [lat, lon] of [
      [44.93, -93.24],
      [-33.8, 151.2],
      [10, 179.9],
      [10, -179.9],
      [64.1, -21.9],
      [0.24, 0.26],
    ]) {
      expect(aircraftCell(lat, lon).key).toBe(route.cellFor(lat, lon).key);
    }
  });

  it('builds a URL with only the cell centre', () => {
    expect(aircraftUrl(44.9312, -93.2471)).toBe('/api/aircraft?lat=45.0&lon=-93.0');
    expect(aircraftUrl(null, 1)).toBeNull();
  });
});
