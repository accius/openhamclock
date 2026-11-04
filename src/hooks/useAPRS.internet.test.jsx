/**
 * useAPRS — per-viewer internet APRS. The poll asks for this viewer's area
 * (station location + radius) or for RF only, and the setting persists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({ fetch: null }));
vi.mock('../utils/apiFetch', () => ({
  apiFetch: (...args) => api.fetch(...args),
}));

import { useAPRS } from './useAPRS.js';
import { INTERNET_KEY } from '../utils/aprsInternet.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let latest;
const LOCATION = { lat: 41.4993, lon: -81.6944 };

function Harness() {
  latest = useAPRS({ enabled: true, location: LOCATION });
  return null;
}

const now = Date.now();
const SERVER_STATIONS = [
  { call: 'K8OHI', ssid: 'K8OHI-9', lat: 41.5, lon: -81.6, timestamp: now, source: null },
  { call: 'G4LON', ssid: 'G4LON', lat: 51.5, lon: -0.1, timestamp: now, source: null },
  { call: 'VK2RF', ssid: 'VK2RF', lat: -33.8, lon: 151.2, timestamp: now, source: 'local-tnc' },
];

const stationUrls = () => api.fetch.mock.calls.map(([u]) => u).filter((u) => u.startsWith('/api/aprs/stations'));

const render = () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now });
  localStorage.clear();
  api.fetch = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.startsWith('/api/aprs/stations')
        ? { enabled: true, connected: true, tncActive: true, stations: SERVER_STATIONS }
        : { connected: false },
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useAPRS internet area', () => {
  it('asks for the area around the station and hides retained stations outside it', async () => {
    render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stationUrls()[0]).toBe('/api/aprs/stations?lat=41.5&lon=-81.69&radius=250');
    expect(latest.internetArea).toEqual({ lat: 41.5, lon: -81.69, radius: 250 });
    expect(latest.serverInternetEnabled).toBe(true);
    // The fake server ignores the area; the hook still drops London
    expect(latest.stations.map((s) => s.ssid).sort()).toEqual(['K8OHI-9', 'VK2RF']);
  });

  it('"Local RF only" polls without an area, shows RF only, and is remembered', async () => {
    render();
    await act(async () => {
      latest.setInternetAprs({ enabled: false });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stationUrls().at(-1)).toBe('/api/aprs/stations?internet=0');
    expect(latest.stations.map((s) => s.ssid)).toEqual(['VK2RF']);
    expect(JSON.parse(localStorage.getItem(INTERNET_KEY))).toEqual({ enabled: false, radiusKm: 250 });
  });

  it('a new radius re-polls at once with it; unknown radii are ignored', async () => {
    render();
    await act(async () => {
      latest.setInternetAprs({ radiusKm: 50 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stationUrls().at(-1)).toBe('/api/aprs/stations?lat=41.5&lon=-81.69&radius=50');
    act(() => latest.setInternetAprs({ radiusKm: 77 }));
    expect(latest.internetAprs.radiusKm).toBe(50);
  });
});
