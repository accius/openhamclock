import { describe, it, expect } from 'vitest';
import * as browser from './solarCycleSsn.js';
import * as server from '../../server/utils/solarCycleSsn.js';

const CYCLE = {
  observed: [
    { t: '2026-03', ssn: 140, smoothed: 121.4 },
    { t: '2026-04', ssn: 150, smoothed: null }, // not yet smoothed
  ],
  predicted: [
    { t: '2026-04', min: 100, max: 130 },
    { t: '2026-11', min: 90.2, max: 121.8 },
    { t: '2027-01', min: 80, max: 110 },
  ],
};

for (const [name, mod] of [
  ['browser', browser],
  ['server', server],
]) {
  describe(`solarCycleSsn (${name})`, () => {
    it('prefers the observed smoothed SSN, then the predicted midpoint, else null', () => {
      expect(mod.ssnForMonth(CYCLE, '2026-03')).toBe(121);
      expect(mod.ssnForMonth(CYCLE, '2026-04')).toBe(115); // smoothed not published → predicted midpoint
      expect(mod.ssnForMonth(CYCLE, '2026-11')).toBe(106);
      expect(mod.ssnForMonth(CYCLE, '2030-01')).toBe(null);
      expect(mod.ssnForMonth(null, '2026-03')).toBe(null);
      expect(mod.ssnForMonth(CYCLE, undefined)).toBe(null);
    });

    it('resolves a bare month to its nearest occurrence (year wrap)', () => {
      const oct = new Date('2026-10-15T12:00:00Z');
      expect(mod.ymForMonth(11, oct)).toBe('2026-11');
      expect(mod.ymForMonth(9, oct)).toBe('2026-09');
      expect(mod.ymForMonth(1, new Date('2026-12-20T00:00:00Z'))).toBe('2027-01');
      expect(mod.ymForMonth(12, new Date('2027-01-05T00:00:00Z'))).toBe('2026-12');
      expect(mod.ymForMonth(13, oct)).toBe(null);
      expect(mod.ymOf(oct)).toBe('2026-10');
    });
  });
}

describe('resolveMonthSsn (server /api/propagation)', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const ok = async () => CYCLE;
  const call = (over) =>
    server.resolveMonthSsn({ month: 11, realMonth: 10, currentSsn: 140, getSolarCycle: ok, now, ...over });

  it('keeps the current SSN for the current month and when the feed has nothing for that month', async () => {
    expect(await call({ month: 10 })).toEqual({ ssn: 140, source: 'current' });
    expect(await call({ month: 12 })).toEqual({ ssn: 140, source: 'current' });
  });

  it('uses the solar-cycle SSN for a shifted month and survives a failing or missing feed', async () => {
    expect(await call({})).toEqual({ ssn: 106, source: 'solar-cycle' });
    const boom = async () => {
      throw new Error('down');
    };
    expect(await call({ getSolarCycle: boom })).toEqual({ ssn: 140, source: 'current' });
    expect(await call({ getSolarCycle: undefined })).toEqual({ ssn: 140, source: 'current' });
  });
});
