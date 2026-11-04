/**
 * Smoke tests for the weather / marine / hazard panels: each renders its
 * data from a mocked server response, handles empty states, and routes
 * clicks to the DX / tune callbacks. Plain react-dom (no testing-library),
 * like DXNewsTicker.test.jsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { _resetSharedFetcher } from '../utils/sharedFetcher.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => opts?.defaultValue ?? key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }) => children,
}));
vi.mock('../utils/mapFocus.js', () => ({ requestMapFocus: vi.fn() }));

import { TropicalPanel } from './TropicalPanel.jsx';
import { FireWeatherPanel } from './FireWeatherPanel.jsx';
import { MarinePanel } from './MarinePanel.jsx';
import { WindyPanel } from './WindyPanel.jsx';
import { WefaxPanel } from './WefaxPanel.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const json = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 502, json: async () => body });

const STORMS = {
  storms: [
    {
      id: 'ep212026',
      source: 'NHC',
      name: 'Trudy',
      basin: 'EP',
      classificationLabel: 'Tropical Storm',
      category: { code: 'TS', label: 'Tropical Storm' },
      windKt: 55,
      gustKt: 65,
      pressureMb: 997,
      lat: 11.9,
      lon: -100,
      movementDeg: 300,
      movementKt: 9,
      movementText: 'WNW',
      lastUpdate: new Date().toISOString(),
      advisoryNum: 6,
      advisoryUrl: 'https://www.nhc.noaa.gov/text/MIATCPEP1.shtml',
      track: [[11.9, -100]],
      forecast: [{ hour: 12, validAt: '2026-10-15T06:00:00Z', lat: 12.5, lon: -100.8, windKt: 60 }],
      cone: [],
      bestTrack: [],
    },
  ],
  fetchedAt: new Date().toISOString(),
  sources: { nhc: 'ok', jtwc: 'ok' },
};

const FIRE = {
  alerts: [
    {
      id: 'a1',
      event: 'Red Flag Warning',
      headline: 'Red Flag Warning until 6 PM',
      areaDesc: 'Cuyama Valley',
      senderName: 'NWS Los Angeles/Oxnard CA',
      onset: '2026-10-16T10:00:00Z',
      ends: '2026-10-17T01:00:00Z',
      description: 'Gusty winds and low humidity.',
      zones: ['CAZ238'],
      zoneNames: ['Cuyama Valley'],
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-120, 35],
            [-119.9, 35],
            [-119.9, 35.1],
            [-120, 35],
          ],
        ],
      },
      centroid: { lat: 35.0, lon: -119.95 },
    },
  ],
  fetchedAt: new Date().toISOString(),
  zonesPending: 0,
};

const BUOYS = {
  stations: [
    {
      id: '44013',
      name: 'BOSTON 16 NM East of Boston, MA',
      type: '3-meter discus buoy',
      lat: 42.346,
      lon: -70.651,
      time: new Date(Date.now() - 20 * 60000).toISOString(),
      wdir: 280,
      wspd: 4,
      gst: 6,
      wvht: 0.7,
      dpd: 8,
      apd: 5.3,
      mwd: 82,
      pres: 1009.4,
      ptdy: null,
      atmp: 16.8,
      wtmp: 14.8,
      dewp: 14.8,
      km: 36.2,
      bearing: 92,
    },
    {
      id: 'BHBM3',
      name: 'Boston, MA',
      type: 'Water Level Observation Network',
      lat: 42.355,
      lon: -71.05,
      pres: 1009.4,
      km: 1,
      bearing: 120,
    },
  ],
  total: 2,
  fetchedAt: new Date().toISOString(),
};

const CATALOG = {
  stations: [
    {
      id: 'NMF',
      name: 'Boston',
      label: 'Boston, MA — USCG NMF',
      frequenciesKHz: [4235, 6340.5],
      dialKHz: [4233.1, 6338.6],
      scheduleUrl: 'https://tgftp.nws.noaa.gov/fax/rfaxatl.txt',
      charts: [
        { id: 'PYAA12', group: 'Surface', title: 'Surface analysis part 2' },
        { id: 'PWAM99', group: 'Surface', title: '96 h surface forecast' },
      ],
    },
  ],
};

let fetchMock;
let container;
let root;

beforeEach(() => {
  _resetSharedFetcher();
  localStorage.clear();
  fetchMock = vi.fn((url) => {
    if (url.startsWith('/api/tropical/storms')) return json(STORMS);
    if (url.startsWith('/api/fire-weather/alerts')) return json(FIRE);
    if (url.startsWith('/api/ndbc/latest')) return json(BUOYS);
    if (url.startsWith('/api/wefax/catalog')) return json(CATALOG);
    return json({ error: 'nope' }, false);
  });
  globalThis.fetch = fetchMock;
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

const mount = async (el) => {
  root = createRoot(container);
  await act(async () => root.render(el));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return container;
};
const click = async (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const byText = (re) =>
  [...container.querySelectorAll('*')].find((el) => el.children.length === 0 && re.test(el.textContent));
const byLabel = (label) => container.querySelector(`[aria-label="${label}"]`);

const de = { lat: 42.36, lon: -71.06 };

describe('TropicalPanel', () => {
  it('lists storms and sets DX on click', async () => {
    const onSetDX = vi.fn();
    await mount(<TropicalPanel deLocation={de} onSetDX={onSetDX} />);
    expect(container.textContent).toContain('Trudy');
    expect(container.textContent).toContain('55 kt');
    await click(byLabel('Trudy: Tropical Storm'));
    expect(onSetDX).toHaveBeenCalledWith({ lat: 11.9, lon: -100 });
    expect(container.textContent).toContain('+12'); // expanded forecast table
    expect(container.textContent).toContain('997 mb');
  });
  it('shows the empty state', async () => {
    fetchMock.mockImplementation(() => json({ storms: [], sources: { nhc: 'ok', jtwc: 'ok' } }));
    await mount(<TropicalPanel deLocation={de} />);
    expect(container.textContent).toContain('No active tropical cyclones');
  });
});

describe('FireWeatherPanel', () => {
  it('lists alerts with distance and sets DX on the centroid', async () => {
    const onSetDX = vi.fn();
    await mount(<FireWeatherPanel deLocation={{ lat: 34.4, lon: -119.7 }} onSetDX={onSetDX} />);
    expect(container.textContent).toContain('RFW');
    expect(container.textContent).toContain('Cuyama Valley');
    await click(byLabel('Red Flag Warning: Cuyama Valley'));
    expect(onSetDX).toHaveBeenCalledWith({ lat: 35, lon: -119.95 });
    expect(container.textContent).toContain('Gusty winds');
  });
  it('filters by distance from DE', async () => {
    await mount(<FireWeatherPanel deLocation={{ lat: 42.36, lon: -71.06 }} />);
    // default radius 1000 km: the California alert is ~4,000 km from Boston
    expect(container.textContent).toContain('widen the filter');
  });
});

describe('MarinePanel', () => {
  it('shows the nearest buoy with wind, seas and temperatures', async () => {
    const onSetDX = vi.fn();
    await mount(<MarinePanel deLocation={de} onSetDX={onSetDX} />);
    expect(container.textContent).toContain('44013');
    expect(container.textContent).toContain('280° 8 kt G12');
    expect(container.textContent).toContain('0.7 m @ 8 s from 082°');
    // Buoys-only hides the water-level station by default
    expect(container.textContent).not.toContain('BHBM3');
    await click(byLabel('44013 BOSTON 16 NM East of Boston, MA'));
    expect(onSetDX).toHaveBeenCalledWith({ lat: 42.346, lon: -70.651 });
    await click(byLabel('Buoys only'));
    expect(container.textContent).toContain('BHBM3');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ndbc/latest?lat=42.36&lon=-71.06&limit=75');
  });
  it('asks for a location when DE is unset', async () => {
    await mount(<MarinePanel deLocation={null} />);
    expect(container.textContent).toContain('Set your location');
  });
});

describe('WindyPanel', () => {
  it('embeds windy centred on DE and switches overlay / centre', async () => {
    await mount(<WindyPanel deLocation={de} dxLocation={{ lat: 51.5, lon: -0.12 }} />);
    const iframe = () => container.querySelector('iframe');
    expect(iframe().src).toContain('embed.windy.com/embed.html');
    expect(iframe().src).toContain('lat=42.360');
    expect(iframe().src).toContain('overlay=wind');
    await click(byText(/^Waves$/));
    expect(iframe().src).toContain('overlay=waves');
    await click(byLabel('Centre on DX'));
    expect(iframe().src).toContain('lat=51.500');
    expect(localStorage.getItem('ohc_windy_overlay')).toBe('waves');
  });
  it('renders no iframe without a location', async () => {
    await mount(<WindyPanel deLocation={null} />);
    expect(container.querySelector('iframe')).toBeNull();
  });
});

describe('WefaxPanel', () => {
  it('loads the catalogue, shows the chart image and tunes on frequency click', async () => {
    const onTune = vi.fn();
    await mount(<WefaxPanel onTune={onTune} rigEnabled />);
    expect(byLabel('Station').value).toBe('NMF');
    expect(container.querySelector('img').src).toMatch(/\/api\/wefax\/chart\/PYAA12\?t=\d+/);
    const chartSelect = byLabel('Chart');
    await act(async () => {
      chartSelect.value = 'PWAM99';
      chartSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('img').src).toContain('/api/wefax/chart/PWAM99');
    await click(byLabel('4233.1 kHz'));
    expect(onTune).toHaveBeenCalledWith({ freq: 4.2331, mode: 'USB' });
  });
  it('disables tuning without rig control', async () => {
    await mount(<WefaxPanel onTune={vi.fn()} rigEnabled={false} />);
    expect(byLabel('4233.1 kHz').disabled).toBe(true);
  });
});
