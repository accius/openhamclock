// @vitest-environment node
/**
 * Parity guard: rig-bridge/lib/ibp-schedule.js is a CommonJS mirror of
 * src/utils/ibp.js (the bridge cannot import ESM frontend code). If anyone
 * edits one table and not the other, this fails.
 */
import { describe, it, expect } from 'vitest';
import * as cjs from './ibp-schedule.js';
import * as esm from '../../src/utils/ibp.js';

describe('ibp-schedule parity with src/utils/ibp.js', () => {
  it('has identical beacon and band tables', () => {
    expect(cjs.IBP_BEACONS).toEqual(esm.IBP_BEACONS);
    expect(cjs.IBP_BANDS).toEqual(esm.IBP_BANDS);
    expect(cjs.CYCLE_SECONDS).toBe(esm.CYCLE_SECONDS);
    expect(cjs.SLOT_SECONDS).toBe(esm.SLOT_SECONDS);
  });

  it('computes the same slot, cycle start and active beacon for arbitrary times', () => {
    const times = [
      Date.UTC(2026, 9, 14, 0, 0, 0),
      Date.UTC(2026, 9, 14, 12, 34, 56, 789),
      Date.UTC(2027, 2, 14, 23, 59, 59),
    ];
    for (const ms of times) {
      const d = new Date(ms);
      expect(cjs.slotAt(ms)).toBe(esm.getCurrentSlot(d));
      expect(cjs.cycleStartMs(ms)).toBe(esm.getCycleStartMs(d));
      for (const { band, beacon } of esm.getSchedule(d)) {
        expect(cjs.beaconFor(cjs.slotAt(ms), band.label).callsign).toBe(beacon.callsign);
      }
    }
  });

  it('slotStartMs floors to the 10-second boundary and findBand resolves labels and MHz', () => {
    const ms = Date.UTC(2026, 9, 14, 12, 0, 17, 500);
    expect(cjs.slotStartMs(ms)).toBe(Date.UTC(2026, 9, 14, 12, 0, 10));
    expect(cjs.findBand('17M').label).toBe('17m');
    expect(cjs.findBand(24.93).label).toBe('12m');
    expect(cjs.findBand('60m')).toBeNull();
  });
});
