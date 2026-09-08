import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestMapFocus, nearestWrappedLon, isInView, MAP_FOCUS_EVENT } from './mapFocus.js';

afterEach(() => vi.restoreAllMocks());

describe('requestMapFocus', () => {
  it('dispatches a window event carrying normalised coordinates', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    expect(requestMapFocus({ lat: '41.5', lon: -81.2, zoom: 10, force: true })).toBe(true);
    const ev = spy.mock.calls[0][0];
    expect(ev.type).toBe(MAP_FOCUS_EVENT);
    expect(ev.detail).toEqual({ lat: 41.5, lon: -81.2, zoom: 10, force: true });
  });

  it('omits zoom when not given and defaults force to false', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    requestMapFocus({ lat: 1, lon: 2 });
    expect(spy.mock.calls[0][0].detail).toEqual({ lat: 1, lon: 2, force: false });
  });

  it('drops requests without usable coordinates (roster entries never heard on APRS)', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    expect(requestMapFocus({ lat: null, lon: null })).toBe(false);
    expect(requestMapFocus({})).toBe(false);
    expect(requestMapFocus({ lat: 'x', lon: 5 })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('nearestWrappedLon', () => {
  it('keeps the longitude when it is already the closest copy', () => {
    expect(nearestWrappedLon(-80, -85)).toBe(-85);
  });
  it('picks the wrapped copy across the antimeridian', () => {
    expect(nearestWrappedLon(-150, 170)).toBe(-190);
    expect(nearestWrappedLon(150, -170)).toBe(190);
  });
});

describe('isInView', () => {
  const bounds = (w, e) => ({ contains: ([, lo]) => lo >= w && lo <= e });
  it('is true when the point is inside the bounds', () => {
    expect(isInView(bounds(-100, -60), 40, -80)).toBe(true);
  });
  it('is true when a wrapped world copy of the point is inside', () => {
    expect(isInView(bounds(-200, -160), 60, 170)).toBe(true);
  });
  it('is false when no copy is visible, or without bounds', () => {
    expect(isInView(bounds(-100, -60), 40, 10)).toBe(false);
    expect(isInView(null, 40, 10)).toBe(false);
  });
});
