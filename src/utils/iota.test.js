import { describe, it, expect } from 'vitest';
import { extractIota, iotaName, iotaLocation, spotIota, IOTA_REF_COUNT } from './iota.js';

describe('iota', () => {
  it('bundles the full reference list', () => {
    expect(IOTA_REF_COUNT).toBeGreaterThan(1100);
    expect(iotaName('EU-005')).toMatch(/Great Britain/i);
    expect(iotaName('NA-067')).toBeTruthy();
    expect(iotaName('XX-001')).toBeNull();
    expect(iotaName(null)).toBeNull();
  });

  it('extracts and normalises references from comments', () => {
    expect(extractIota('IOTA EU-005 73')).toBe('EU-005');
    expect(extractIota('eu005 lighthouse')).toBe('EU-005');
    expect(extractIota('up 2 NA 067')).toBe('NA-067');
    expect(extractIota('CQ OC-001 FT8')).toBe('OC-001');
  });

  it('ignores lookalikes and unknown references', () => {
    expect(extractIota('NA1SA CQ')).toBeNull(); // callsign fragment, no 3 digits
    expect(extractIota('EU-0051')).toBeNull(); // 4 digits
    expect(extractIota('AS-999')).toBeNull(); // not in the list
    expect(extractIota('')).toBeNull();
    expect(extractIota(null)).toBeNull();
    expect(extractIota(42)).toBeNull();
  });

  it('spotIota reads DX cluster and activation shapes', () => {
    expect(spotIota({ comment: 'SOTA + IOTA EU-005' })).toBe('EU-005');
    expect(spotIota({ comments: 'na067 park' })).toBe('NA-067');
    expect(spotIota({ comment: 'FT8 -12 dB' })).toBeNull();
    expect(spotIota(null)).toBeNull();
  });

  it('gives an approximate group location', () => {
    const loc = iotaLocation('EU-005');
    expect(loc.lat).toBeGreaterThan(49);
    expect(loc.lat).toBeLessThan(61);
    expect(loc.lon).toBeGreaterThan(-9);
    expect(loc.lon).toBeLessThan(3);
    expect(iotaLocation('nope')).toBeNull();
  });
});
