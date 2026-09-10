import { describe, it, expect, vi } from 'vitest';
import { makeCallLabel } from './callLabel.js';

// Minimal Leaflet stand-in: records what the helper asked for.
function fakeL() {
  const calls = { divIcon: [], marker: [] };
  return {
    calls,
    divIcon: vi.fn((o) => (calls.divIcon.push(o), { __icon: o })),
    marker: vi.fn((latlng, o) => (calls.marker.push({ latlng, o }), { latlng, options: o })),
  };
}

describe('makeCallLabel', () => {
  it('builds a non-interactive marker with an escaped callsign pill in the layer colour', () => {
    const L = fakeL();
    const m = makeCallLabel(L, [10, 20], 'VK4ACZ', '#00ccff', { opacity: 0.9 });
    expect(m.latlng).toEqual([10, 20]);
    expect(m.options.interactive).toBe(false);
    const icon = L.calls.divIcon[0];
    expect(icon.html).toContain('VK4ACZ');
    expect(icon.html).toContain('background:#00ccff');
    expect(icon.html).toContain('opacity:0.9');
    // anchored off the dot so it never covers the marker
    expect(icon.iconAnchor).toEqual([-8, 8]);
  });

  it('escapes markup in the callsign text', () => {
    const L = fakeL();
    makeCallLabel(L, [0, 0], '<img src=x onerror=alert(1)>', '#fff');
    const html = L.calls.divIcon[0].html;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('clamps opacity into 0..1', () => {
    const L = fakeL();
    makeCallLabel(L, [0, 0], 'X', '#fff', { opacity: 4 });
    expect(L.calls.divIcon[0].html).toContain('opacity:1;');
  });
});
