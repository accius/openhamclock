import { describe, it, expect } from 'vitest';
import { chooseDemoAction, DEMO_LAYERS, DEMO_PANELS } from './useDemoMode.js';

const seq = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('chooseDemoAction', () => {
  it('only offers layer + basemap outside the dockable layout without spots', () => {
    const kinds = new Set();
    for (let r = 0; r < 1; r += 0.05) kinds.add(chooseDemoAction({ layout: 'modern', random: () => r }).kind);
    expect([...kinds].sort()).toEqual(['basemap', 'layer']);
  });

  it('adds panels for the dockable layout and DX when located spots exist', () => {
    const spots = [
      { dxLat: 35.6, dxLon: 139.6, dxCall: 'JA1ABC' },
      { dxLat: null, dxLon: 1 },
    ];
    const kinds = new Set();
    for (let r = 0; r < 1; r += 0.05) kinds.add(chooseDemoAction({ layout: 'dockable', spots, random: () => r }).kind);
    expect([...kinds].sort()).toEqual(['basemap', 'dx', 'layer', 'panel']);
  });

  it('picks a located spot for the DX action', () => {
    const spots = [
      { dxLat: 1, dxLon: 2, dxCall: 'A1A' },
      { dxLat: 'x', dxLon: 2 },
      { dxLat: 3, dxLon: 4, dxCall: 'B2B' },
    ];
    // options = ['layer','basemap','dx'] → index 2 picks dx; second random picks the 2nd located spot
    const a = chooseDemoAction({ layout: 'modern', spots, random: seq([0.9, 0.9]) });
    expect(a).toEqual({ kind: 'dx', lat: 3, lon: 4, callsign: 'B2B' });
  });

  it('rotates the basemap to the next non-legacy style', () => {
    const a = chooseDemoAction({ layout: 'modern', basemap: 'dark', random: seq([0.5]) }); // index 1 → basemap
    expect(a.kind).toBe('basemap');
    expect(a.basemap).not.toBe('dark');
    expect(a.basemap).not.toBe('azimuthal');
  });

  it('chooses from the harmless layer and panel lists', () => {
    const l = chooseDemoAction({ layout: 'modern', random: seq([0, 0.99]) });
    expect(l.kind).toBe('layer');
    expect(DEMO_LAYERS).toContain(l.layerId);
    const p = chooseDemoAction({ layout: 'dockable', random: seq([0.9, 0]) }); // options layer,basemap,panel → panel
    expect(p.kind).toBe('panel');
    expect(DEMO_PANELS).toContain(p.panelId);
  });
});
