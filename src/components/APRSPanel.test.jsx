/**
 * APRSPanel — per-viewer internet APRS settings (gear button): on / "Local
 * RF only", radius presets, centre = station location, and the note shown
 * when the server has APRS-IS off.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import '../lang/i18n.js';

vi.mock('./CallsignPopupManager.jsx', () => ({ useCallsignPopup: () => ({ showPopup: () => {} }) }));

import APRSPanel from './APRSPanel.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;

const render = (aprsData) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<APRSPanel aprsData={{ aprsEnabled: true, loading: false, ...aprsData }} units="metric" />);
  });
};
const button = (pred) => [...container.querySelectorAll('button')].find(pred);
const openSettings = () => act(() => button((b) => b.getAttribute('aria-expanded') !== null).click());

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('APRSPanel internet APRS settings', () => {
  it('shows the centre and radius and switches to Local RF only', () => {
    const setInternetAprs = vi.fn();
    render({
      setInternetAprs,
      internetAprs: { enabled: true, radiusKm: 250 },
      internetArea: { lat: 41.5, lon: -81.69, radius: 250 },
      radiusOptions: [50, 100, 250, 500, 1000],
      serverInternetEnabled: true,
    });
    expect(container.textContent).not.toContain('Internet APRS');
    openSettings();
    expect(container.textContent).toContain('Centre: your station location (41.50, -81.69)');
    const select = container.querySelector('select[aria-label="Radius:"]');
    expect([...select.options].map((o) => o.value)).toEqual(['50', '100', '250', '500', '1000']);
    expect(select.value).toBe('250');
    act(() => button((b) => b.textContent.includes('Local RF only')).click());
    expect(setInternetAprs).toHaveBeenCalledWith({ enabled: false });
  });

  it('explains when the server has APRS-IS off', () => {
    render({ setInternetAprs: vi.fn(), serverInternetEnabled: false });
    openSettings();
    expect(container.textContent).toContain('turned off on this server');
    expect(container.querySelector('select[aria-label="Radius:"]')).toBeNull();
  });

  it('says when the server is off for want of a real callsign', () => {
    render({ setInternetAprs: vi.fn(), serverInternetEnabled: false, serverInternetReason: 'no-callsign' });
    openSettings();
    expect(container.textContent).toContain('until it has a real callsign');
  });

  it('asks for a station location when there is none', () => {
    render({ setInternetAprs: vi.fn(), internetArea: null, serverInternetEnabled: true });
    openSettings();
    expect(container.textContent).toContain('Set your station location in Settings');
  });
});
