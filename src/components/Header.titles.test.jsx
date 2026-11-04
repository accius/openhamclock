/**
 * Header — rotating titles, kiosk padlock and demo-mode indicator.
 * Rendered with createRoot/act, same pattern as useIdleClock.test.jsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Header } from './Header.jsx';
import { setFlag, resetFlags } from '../utils/sessionFlags.js';
import { PIN_KEY, LOCKED_KEY } from '../utils/kioskLock.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}));

const baseProps = {
  config: { callsign: 'K0CJH', headerSize: 1 },
  utcTime: '12:00:00',
  utcDate: 'Oct 14',
  localTime: '06:00:00',
  localDate: 'Oct 14',
  use12Hour: false,
  onTimeFormatToggle: () => {},
  onSettingsClick: () => {},
  onFullscreenToggle: () => {},
  isFullscreen: false,
};

let container;
let root;
const render = (props) => act(() => root.render(<Header {...props} />));
const textOf = (sel) => Array.from(container.querySelectorAll(sel)).map((n) => n.textContent);

beforeEach(() => {
  resetFlags();
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(LOCKED_KEY);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('Header — rotating titles, kiosk padlock, demo indicator', () => {
  it('shows the callsign when no titles are configured', () => {
    render(baseProps);
    expect(container.textContent).toContain('K0CJH');
    expect(container.textContent).not.toContain('🏃');
    expect(container.querySelector('[aria-label="header.kiosk.locked"]')).toBeNull();
  });

  it('rotates configured titles every 10 s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const props = { ...baseProps, config: { ...baseProps.config, callsignTitles: 'Alpha;Bravo' } };
    render(props);
    expect(textOf('span')).toContain('Alpha');
    vi.setSystemTime(10_000);
    render({ ...props, utcTime: '12:00:10' });
    expect(textOf('span')).toContain('Bravo');
    expect(textOf('span')).not.toContain('K0CJH');
  });

  it('a remote title override wins and carries colours; clearing restores the callsign', () => {
    render(baseProps);
    act(() => setFlag('titleOverride', { text: 'Field Day', fg: 'rgb(0, 0, 0)', bg: 'rgb(255, 176, 0)' }));
    const el = Array.from(container.querySelectorAll('span')).find((n) => n.textContent === 'Field Day');
    expect(el).toBeTruthy();
    expect(el.style.color).toBe('rgb(0, 0, 0)');
    expect(el.style.background).toContain('rgb(255, 176, 0)');
    act(() => setFlag('titleOverride', null));
    expect(textOf('span')).toContain('K0CJH');
  });

  it('shows the padlock when locked and the running man in demo mode', () => {
    render(baseProps);
    act(() => {
      setFlag('kioskLocked', true);
      setFlag('demoMode', true);
    });
    expect(container.querySelector('button[aria-label="header.kiosk.locked"]')).toBeTruthy();
    expect(container.querySelector('[role="img"][aria-label="header.demo.running"]')).toBeTruthy();
  });
});
