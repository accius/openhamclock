/**
 * Smoke test: the Mobile layout mounts with the compact header, map and
 * card row; remembers the card; opens a card full screen and comes back.
 * The map and panels are stubbed — they have their own tests.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../components', () => {
  const stub = (name) => () => <div data-stub={name}>{name}</div>;
  return {
    WorldMap: stub('WorldMap'),
    DXClusterPanel: stub('DXClusterPanel'),
    PotaSotaPanel: stub('PotaSotaPanel'),
    PropagationPanel: stub('PropagationPanel'),
    SolarPanel: stub('SolarPanel'),
    SatellitePassesPanel: stub('SatellitePassesPanel'),
    WeatherPanel: stub('WeatherPanel'),
    PSKReporterPanel: stub('PSKReporterPanel'),
    APRSPanel: stub('APRSPanel'),
  };
});
vi.mock('../components/LogbookPanel.jsx', () => ({ default: () => <div data-stub="LogbookPanel">LogbookPanel</div> }));
vi.mock('../components/MobileEmcommCard.jsx', () => ({
  default: () => <div data-stub="MobileEmcommCard">MobileEmcommCard</div>,
}));
vi.mock('../contexts/RigContext.jsx', () => ({ useRig: () => ({ tuneTo: () => {} }) }));

import MobileLayout from './MobileLayout.jsx';
import { MOBILE_CARD_KEY, MOBILE_CARD_PREFS_KEY, PREVIOUS_LAYOUT_KEY } from '../utils/mobileLayout.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setViewport = (w, h) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
};

const baseProps = {
  config: { callsign: 'K0CJH', location: { lat: 39, lon: -94 }, allUnits: { temp: 'metric' } },
  utcTime: '15:04:05',
  localTime: '10:04:05',
  solarIndices: { data: { sfi: { current: 151 }, kp: { current: 5 }, ssn: { current: 120 } } },
  bandConditions: { extras: { aIndex: '12' } },
  localWeather: { data: { rawTempC: 18, icon: '☀️' } },
  mapLayers: {},
  setShowSettings: vi.fn(),
};

function mount(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MobileLayout {...baseProps} {...props} />));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  localStorage.clear();
  setViewport(1024, 768);
});

describe('MobileLayout', () => {
  it('portrait: compact header, map, and the card row with dots', () => {
    setViewport(390, 844);
    const { container, unmount } = mount();
    const root = container.querySelector('.ohc-mobile-layout');
    expect(root).not.toBeNull();
    expect(root.classList.contains('is-landscape')).toBe(false);
    const text = container.textContent;
    expect(text).toContain('K0CJH');
    expect(text).toContain('15:04:05');
    expect(text).toContain('10:04:05');
    expect(text).toContain('SFI151');
    expect(text).toContain('K5');
    expect(text).toContain('SSN120');
    expect(text).toContain('A12');
    expect(container.querySelector('[data-stub="WorldMap"]')).not.toBeNull();

    const ids = [...container.querySelectorAll('.ohc-mobile-card')].map((c) => c.dataset.card);
    expect(ids[0]).toBe('dx-cluster');
    expect(ids).toContain('logbook');
    expect(ids).not.toContain('aprs'); // APRS layer is off
    expect(container.querySelectorAll('.ohc-mobile-dot')).toHaveLength(ids.length);

    // Each name appears once: panels with their own header get no card title,
    // plain cards (weather, satellites) keep a tappable title bar.
    const heads = [...container.querySelectorAll('.ohc-mobile-card-head')].map((b) => b.textContent);
    expect(heads.some((h) => h.includes('DX Cluster'))).toBe(false);
    expect(heads.some((h) => h.includes('Weather'))).toBe(true);
    expect(container.querySelector('.ohc-mobile-expand-btn')).not.toBeNull(); // full screen for the active card

    // Only the first card and its neighbour are mounted
    expect(container.querySelector('[data-stub="DXClusterPanel"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="PotaSotaPanel"]')).not.toBeNull();
    expect(container.querySelector('[data-stub="LogbookPanel"]')).toBeNull();
    unmount();
  });

  it('remembers the card picked with the dots', () => {
    setViewport(390, 844);
    const first = mount();
    const dots = first.container.querySelectorAll('.ohc-mobile-dot');
    act(() => dots[5].click()); // Logbook
    expect(localStorage.getItem(MOBILE_CARD_KEY)).toBe('logbook');
    expect(first.container.querySelector('[data-stub="LogbookPanel"]')).not.toBeNull();
    first.unmount();

    const again = mount();
    const active = again.container.querySelector('.ohc-mobile-dot.is-active');
    expect(active.getAttribute('title')).toBe('Logbook');
    again.unmount();
  });

  it('opens a card full screen and Back returns', async () => {
    setViewport(390, 844);
    const { container, unmount } = mount();
    act(() => container.querySelector('.ohc-mobile-expand-btn').click());
    const dlg = container.querySelector('.ohc-mobile-fullscreen');
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('aria-label')).toBe('DX Cluster');
    expect(dlg.querySelector('.ohc-mobile-card-title')).toBeNull(); // the panel names itself
    expect(dlg.querySelector('[data-stub="DXClusterPanel"]')).not.toBeNull();
    // Not mounted twice while expanded
    expect(container.querySelectorAll('[data-stub="DXClusterPanel"]')).toHaveLength(1);

    await act(async () => {
      container.querySelector('.ohc-mobile-back').click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(container.querySelector('.ohc-mobile-fullscreen')).toBeNull();

    // A plain card's own title bar still opens it, and shows its name
    act(() => container.querySelectorAll('.ohc-mobile-dot')[6].click()); // Weather
    act(() => container.querySelector('.ohc-mobile-card[data-card="weather"] .ohc-mobile-card-head').click());
    expect(container.querySelector('.ohc-mobile-fullscreen .ohc-mobile-card-title').textContent).toContain('Weather');
    unmount();
  });

  it('landscape: one header row, map left and the card column right', () => {
    setViewport(844, 390);
    const { container, unmount } = mount({ mapLayers: { showAPRS: true } });
    expect(container.querySelector('.ohc-mobile-layout.is-landscape')).not.toBeNull();
    expect(container.querySelector('.ohc-mobile-header--row')).not.toBeNull();
    const row = container.querySelector('.ohc-mobile-body-row');
    expect(row.firstElementChild.classList.contains('ohc-mobile-map')).toBe(true);
    expect(row.querySelector('.ohc-mobile-side .ohc-mobile-strip')).not.toBeNull();
    const ids = [...container.querySelectorAll('.ohc-mobile-card')].map((c) => c.dataset.card);
    expect(ids).toContain('aprs');
    unmount();
  });

  it('EmComm card is opt-in through the card picker and saved', () => {
    setViewport(390, 844);
    const { container, unmount } = mount();
    const ids = () => [...container.querySelectorAll('.ohc-mobile-card')].map((c) => c.dataset.card);
    expect(ids()).not.toContain('emcomm');
    expect(container.querySelector('[data-stub="MobileEmcommCard"]')).toBeNull();

    act(() => container.querySelector('button[aria-label="Choose cards"]').click());
    const sheet = container.querySelector('.ohc-mobile-picker');
    expect(sheet).not.toBeNull();
    const emcommRow = [...sheet.querySelectorAll('label')].find((l) => l.textContent.includes('EmComm'));
    expect(emcommRow.querySelector('input').checked).toBe(false);
    act(() => emcommRow.querySelector('input').click());
    expect(ids()[0]).toBe('emcomm');
    expect(JSON.parse(localStorage.getItem(MOBILE_CARD_PREFS_KEY)).enabled.emcomm).toBe(true);

    // Switching a regular card off removes it
    const solarRow = [...sheet.querySelectorAll('label')].find((l) => l.textContent.includes('Solar'));
    act(() => solarRow.querySelector('input').click());
    expect(ids()).not.toContain('solar');
    unmount();
  });

  it('EmComm card defaults on for an operator arriving from the EmComm layout', () => {
    setViewport(390, 844);
    localStorage.setItem(PREVIOUS_LAYOUT_KEY, 'emcomm');
    const { container, unmount } = mount();
    expect(container.querySelector('.ohc-mobile-card').dataset.card).toBe('emcomm');
    // Its data component is mounted because it is the visible card
    expect(container.querySelector('[data-stub="MobileEmcommCard"]')).not.toBeNull();
    // ...and the default is saved so a later layout hop can't flip it
    expect(JSON.parse(localStorage.getItem(MOBILE_CARD_PREFS_KEY)).enabled.emcomm).toBe(true);
    unmount();
  });

  it('header gear opens Settings and hides the placeholder callsign', () => {
    setViewport(390, 844);
    const setShowSettings = vi.fn();
    const { container, unmount } = mount({ config: { callsign: 'N0CALL' }, setShowSettings });
    expect(container.textContent).not.toContain('N0CALL');
    act(() => container.querySelector('button[aria-label="Settings"]').click());
    expect(setShowSettings).toHaveBeenCalledWith(true);
    unmount();
  });
});
