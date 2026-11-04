import { describe, expect, it } from 'vitest';
import { decideLayer, decideAutoLayers, activityMetrics, AUTO_SPACE_WX_THRESHOLDS } from './autoSpaceWx.js';

describe('decideLayer (hysteresis)', () => {
  const th = { on: 50, off: 25 };
  it('turns on at or above the on-threshold when off', () => {
    expect(decideLayer(50, false, th)).toBe(true);
    expect(decideLayer(49, false, th)).toBeNull();
  });
  it('keeps an enabled layer on until the value drops below the off-threshold', () => {
    expect(decideLayer(40, true, th)).toBeNull(); // between thresholds: hold
    expect(decideLayer(25, true, th)).toBeNull();
    expect(decideLayer(24, true, th)).toBe(false);
  });
  it('does nothing without a value', () => {
    expect(decideLayer(null, false, th)).toBeNull();
    expect(decideLayer(NaN, true, th)).toBeNull();
  });
});

describe('decideAutoLayers', () => {
  it('enables aurora at ≥50 % and D-RAP at ≥25 MHz', () => {
    const out = decideAutoLayers({ aurora: 62, drap: 30 }, { aurora: false, drap: false });
    expect(out).toEqual([
      { id: 'aurora', enabled: true },
      { id: 'drap', enabled: true },
    ]);
  });

  it('disables only below the off-thresholds', () => {
    expect(decideAutoLayers({ aurora: 30, drap: 20 }, { aurora: true, drap: true })).toEqual([]);
    expect(decideAutoLayers({ aurora: 10, drap: 5 }, { aurora: true, drap: true })).toEqual([
      { id: 'aurora', enabled: false },
      { id: 'drap', enabled: false },
    ]);
  });

  it('never touches pinned layers', () => {
    const out = decideAutoLayers({ aurora: 90, drap: 40 }, { aurora: false, drap: false }, new Set(['aurora']));
    expect(out).toEqual([{ id: 'drap', enabled: true }]);
    expect(decideAutoLayers({ aurora: 90 }, {}, ['aurora', 'drap'])).toEqual([]);
  });

  it('uses the documented default thresholds', () => {
    expect(AUTO_SPACE_WX_THRESHOLDS.aurora).toEqual({ on: 50, off: 25 });
    expect(AUTO_SPACE_WX_THRESHOLDS.drap).toEqual({ on: 25, off: 15 });
  });
});

describe('activityMetrics', () => {
  it('extracts the two numbers and nulls missing halves', () => {
    expect(activityMetrics({ aurora: { max: 55 }, drap: { maxFreq: 12.5 } })).toEqual({ aurora: 55, drap: 12.5 });
    expect(activityMetrics({ aurora: null, drap: null })).toEqual({ aurora: null, drap: null });
    expect(activityMetrics(undefined)).toEqual({ aurora: null, drap: null });
  });
});
