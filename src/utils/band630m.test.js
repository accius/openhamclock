import { describe, expect, it } from 'vitest';
import { getBandFromFreq, normalizeFrequencyToMHz } from './callsign.js';
import { getBandColorForFreq } from './bandColors.js';
import * as gridModule from '../../server/utils/grid.js';

const grid = gridModule.default || gridModule;
const { getBandFromHz, getBandFromKHz, normalizeFrequencyToMHz: normalizeServerFrequencyToMHz } = grid;

describe('630m band support', () => {
  it('classifies MHz, kHz, and Hz inputs', () => {
    expect(getBandFromFreq(0.472)).toBe('630m');
    expect(getBandFromFreq(0.479)).toBe('630m');
    expect(getBandFromFreq(474.2)).toBe('630m');
    expect(getBandFromFreq(474200)).toBe('630m');
  });

  it('keeps exact allocation boundaries', () => {
    expect(getBandFromFreq(0.471999)).not.toBe('630m');
    expect(getBandFromFreq(0.479001)).not.toBe('630m');
    expect(getBandFromHz(471999)).toBe('Unknown');
    expect(getBandFromHz(472000)).toBe('630m');
    expect(getBandFromHz(479000)).toBe('630m');
    expect(getBandFromHz(479001)).toBe('Unknown');
    expect(getBandFromKHz(471.999)).toBe('Unknown');
    expect(getBandFromKHz(472)).toBe('630m');
    expect(getBandFromKHz(479)).toBe('630m');
    expect(getBandFromKHz(479.001)).toBe('Unknown');
  });

  it('does not turn 474.2 kHz into 474.2 MHz', () => {
    expect(normalizeFrequencyToMHz(474.2)).toBeCloseTo(0.4742, 8);
    expect(normalizeFrequencyToMHz(474200)).toBeCloseTo(0.4742, 8);
    expect(normalizeServerFrequencyToMHz(474.2)).toBeCloseTo(0.4742, 8);
    expect(normalizeServerFrequencyToMHz(474200)).toBeCloseTo(0.4742, 8);
  });

  it('uses the default 630m color for all supported units', () => {
    expect(getBandColorForFreq(0.4742)).toBe('#cc4455');
    expect(getBandColorForFreq(474.2)).toBe('#cc4455');
    expect(getBandColorForFreq(474200)).toBe('#cc4455');
  });
});
