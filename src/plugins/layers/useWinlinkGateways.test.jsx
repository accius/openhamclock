/**
 * Winlink Gateways layer — reachability colouring with a minimal fake Leaflet.
 *
 * Checks that markers are mode-coloured until reachability exists, that the
 * layer's own Reachability filter requests predictions from the shared store
 * (no Winlink panel open), that markers then take status colours (grey,
 * faded dots for unpredicted gateways), and that the filter hides gateways.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const mocks = vi.hoisted(() => ({ fetch: null, predict: null }));
vi.mock('../../utils/apiFetch.js', () => ({
  apiFetch: (...args) => mocks.fetch(...args),
}));
vi.mock('../../services/p533/predictInWorker.js', () => ({
  predictInWorker: (...args) => mocks.predict(...args),
}));
vi.mock('./makeDraggable.js', () => ({ makeDraggable: () => {} }));
vi.mock('./addMinimizeToggle.js', () => ({ addMinimizeToggle: () => {} }));

import { useLayer } from './useWinlinkGateways.js';
import { __resetWinlinkReachStoreForTests, getReachState } from '../../services/winlinkReachStore.js';
import { STATUS_COLORS } from '../../utils/winlinkReach.js';
import { WINLINK_MODE_FAMILIES } from '../../utils/winlinkModes.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GATEWAYS = [
  { callsign: 'K0GOOD', gridsquare: 'DM79', frequency: 7101200, mode: 43, hours: '00-23' },
  { callsign: 'K0NIGHT', gridsquare: 'DM78', frequency: 3590000, mode: 16, hours: '00-11' },
  { callsign: 'JA1FAR', gridsquare: 'PM95', frequency: 7101200, mode: 50, hours: '00-23' },
];

// ── Fake Leaflet ──────────────────────────────────────────────────────────
let markers = [];
let controlEl = null;
function installFakeLeaflet() {
  markers = [];
  globalThis.L = {
    layerGroup: () => {
      const g = { layers: [], addLayer: (m) => g.layers.push(m), addTo: () => g };
      return g;
    },
    circleMarker: (latlng, opts) => {
      const m = { latlng, opts, bindPopup: () => m };
      markers.push(m);
      return m;
    },
    Control: {
      extend: (proto) =>
        function Control() {
          this.onAdd = proto.onAdd;
          this.getContainer = () => controlEl;
        },
    },
    DomUtil: {
      create: (tag, cls, parent) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (parent) parent.appendChild(el);
        return el;
      },
    },
    DomEvent: { disableClickPropagation: () => {}, disableScrollPropagation: () => {} },
  };
}
const fakeMap = {
  addControl(c) {
    controlEl = c.onAdd();
    document.body.appendChild(controlEl);
  },
  removeControl() {
    controlEl?.remove();
    controlEl = null;
  },
  removeLayer() {},
};
// The render effect rebuilds every marker; only the latest group counts.
const latestColours = () => {
  const byLat = new Map();
  for (const m of markers) byLat.set(m.latlng.join(','), m.opts);
  return [...byLat.values()];
};

let root;
let container;
function Harness(props) {
  useLayer(props);
  return null;
}
function render(props) {
  act(() => {
    root.render(<Harness enabled map={fakeMap} opacity={1} deLat={39.75} deLon={-104.99} {...props} />);
  });
}
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-15T15:20:00Z'));
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  __resetWinlinkReachStoreForTests();
  installFakeLeaflet();
  mocks.fetch = vi.fn(async (url) => {
    if (url === '/api/winlink/gateways') return { ok: true, status: 200, json: async () => ({ gateways: GATEWAYS }) };
    if (url === '/api/solar-indices') return { ok: true, status: 200, json: async () => ({ ssn: { current: 120 } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  mocks.predict = vi.fn(async (params) => ({
    frequencies: params.frequencies.map((f) => ({ freq: f, snr: 12, reliability: 85 })),
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __resetWinlinkReachStoreForTests();
  vi.useRealTimers();
  delete globalThis.L;
});

describe('Winlink Gateways layer reachability', () => {
  it('colours by mode family until reachability is requested', async () => {
    render();
    await settle();
    const modeColours = new Set(WINLINK_MODE_FAMILIES.map((f) => f.color));
    const cols = latestColours();
    expect(cols).toHaveLength(9); // 3 gateways × 3 world copies (replicatePoint)
    for (const o of cols) expect(modeColours.has(o.fillColor)).toBe(true);
    expect(getReachState().active).toBe(false);
    expect(mocks.predict).not.toHaveBeenCalled();
  });

  it('requests predictions on its own when the filter is not "All", then colours and filters', async () => {
    render();
    await settle();
    const sel = controlEl.querySelector('#winlink-reach');
    act(() => {
      sel.value = 'reachable';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(40);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100); // coalesced redraw
    });
    await settle();
    expect(getReachState().active).toBe(true);
    expect(mocks.predict).toHaveBeenCalledTimes(1); // K0GOOD only: K0NIGHT off air, JA1FAR out of range
    // Filter "reachable": only K0GOOD drawn, in the Good colour.
    const drawn = markers.slice(-1)[0];
    expect(drawn.opts.fillColor).toBe(STATUS_COLORS.good);
    expect(drawn.opts.radius).toBe(5);
    expect(controlEl.querySelector('#winlink-reach-hint').textContent).toMatch(/15:00z/);

    // Back to "All" with no other consumer: the layer releases its request,
    // the store goes idle and markers return to mode colours.
    act(() => {
      sel.value = 'all';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(getReachState().active).toBe(false);
  });

  it('keeps colouring with filter "All" while another consumer (the panel) has results', async () => {
    const { requestReach } = await import('../../services/winlinkReachStore.js');
    requestReach('panel', { priority: 3, deLocation: { lat: 39.75, lon: -104.99 }, ssn: 120 });
    render();
    await settle(40);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await settle();
    const fills = latestColours().map((o) => o.fillColor);
    expect(fills).toContain(STATUS_COLORS.good);
    expect(fills).toContain(STATUS_COLORS.offair);
    const grey = latestColours().find((o) => o.fillColor === STATUS_COLORS.unknown);
    expect(grey).toMatchObject({ radius: 3 });
    expect(grey.fillOpacity).toBeLessThan(0.5);
  });
});
