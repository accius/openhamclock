/**
 * Logged QSOs (API) layer — #1285: the dot and callsign label must be drawn
 * in every world copy like the path is, or a VK station's contacts in the
 * Americas lose their labels once the map is panned across the date line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { useLayer } from './useQsoApiLayer.js';

const makeLayer = (kind, latlng) => {
  const layer = {
    kind,
    latlng,
    addTo(map) {
      map.live.add(layer);
      return layer;
    },
    bindPopup() {
      return layer;
    },
  };
  return layer;
};
const makeMap = (crsCode) => {
  const map = {
    options: crsCode ? { crs: { code: crsCode } } : {},
    live: new Set(),
    removeLayer(layer) {
      map.live.delete(layer);
    },
  };
  return map;
};

let root;
let container;
const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.L = {
    polyline: (pts) => makeLayer('line', pts),
    circleMarker: (latlng) => makeLayer('dot', latlng),
    marker: (latlng) => makeLayer('label', latlng),
    divIcon: () => ({}),
  };
  localStorage.setItem('openhamclock_config', JSON.stringify({ location: { lat: -35.3, lon: 149.1 } }));
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ retention_minutes: 60, qsos: [{ call: 'W1AW', lat: 41.7, lon: -72.7, band: '20m' }] }),
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete globalThis.L;
  localStorage.removeItem('openhamclock_config');
  globalThis.fetch = realFetch;
});

function Harness(props) {
  useLayer(props);
  return null;
}

async function mount(map) {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness enabled map={map} showLabels />);
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const of = (map, kind) => [...map.live].filter((l) => l.kind === kind);

describe('useQsoApiLayer world copies (#1285)', () => {
  it('draws the dot and label in all three world copies', async () => {
    const map = makeMap();
    await mount(map);
    const qsoDots = of(map, 'dot').filter((d) => d.latlng[0] === 41.7);
    expect(qsoDots.map((d) => d.latlng[1]).sort((a, b) => a - b)).toEqual([-432.7, -72.7, 287.3]);
    expect(
      of(map, 'label')
        .map((l) => l.latlng[1])
        .sort((a, b) => a - b),
    ).toEqual([-432.7, -72.7, 287.3]);
  });

  it('draws a single copy on the azimuthal map', async () => {
    const map = makeMap('AzimuthalEquidistant');
    await mount(map);
    expect(of(map, 'label')).toHaveLength(1);
    expect(of(map, 'dot').filter((d) => d.latlng[0] === 41.7)).toHaveLength(1);
  });
});
