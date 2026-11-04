/**
 * Lightning guard UI smoke test: header bolt + popover, banner and the
 * Settings → Alerts card render from the live engine state, and the
 * popover's override buttons drive the relay. Strike feed and alert
 * channels are mocked; rendered with createRoot/act.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (k, o) => String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_, v) => (o && o[v] != null ? o[v] : '')),
  }),
}));
const feed = vi.hoisted(() => ({ subscribers: new Set() }));
vi.mock('../utils/lightningFeed.js', () => ({
  subscribeStrikes: (fn) => {
    feed.subscribers.add(fn);
    return () => feed.subscribers.delete(fn);
  },
  injectStrike: (p) => {
    const s = { id: `sim${Math.random()}`, lat: p.lat, lon: p.lon, timestamp: Date.now(), simulated: true };
    for (const fn of feed.subscribers) fn([s]);
    return s;
  },
}));
vi.mock('../utils/audioAlerts.js', async (orig) => ({ ...(await orig()), playTone: vi.fn() }));
vi.mock('../utils/speechAlerts.js', async (orig) => ({ ...(await orig()), speakText: vi.fn() }));
const pushMock = vi.hoisted(() => ({
  status: { configured: false },
  subscription: null,
  subscribeToPush: null,
}));
vi.mock('../utils/push.js', () => ({
  sendLightningPush: vi.fn(),
  setLightningPushPrefs: vi.fn(() => Promise.resolve({ ok: true })),
  getServerPushStatus: () => Promise.resolve(pushMock.status),
  isPushSupported: () => true,
  getPushSubscription: () => Promise.resolve(pushMock.subscription),
  subscribeToPush: (...a) => pushMock.subscribeToPush(...a),
}));

import useLightningGuard from '../hooks/useLightningGuard.js';
import { LightningGuardIndicator, LightningGuardBanner } from './LightningGuardIndicator.jsx';
import { LightningGuardSettings, bridgeNeedsUpdate } from './LightningGuardSettings.jsx';
import { getAlertSettings, saveAlertSettings } from '../utils/audioAlerts.js';

const DE = { lat: 40.015, lon: -105.2705 };
let container;
let root;
let guard;

function Harness() {
  guard = useLightningGuard({ location: DE, allUnits: { dist: 'metric' }, layout: 'modern' });
  const settings = getAlertSettings();
  return (
    <>
      <LightningGuardIndicator />
      <LightningGuardBanner />
      <LightningGuardSettings alertSettings={settings} updateSettings={saveAlertSettings} />
    </>
  );
}
const render = () => act(() => root.render(<Harness />));
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const button = (text) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent.includes(text));

beforeEach(() => {
  localStorage.clear();
  feed.subscribers.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('lightning guard UI', () => {
  it('renders nothing in the header while off; the settings card offers ON', () => {
    render();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="Lightning guard —"]')).toBeNull();
    expect(container.textContent).toContain('Lightning guard');
    expect(container.textContent).not.toContain('Warning radius');
  });

  it('simulated alarm strike: bolt, banner, details, relay override', () => {
    saveAlertSettings({ lightningGuard: { enabled: true, relay: { enabled: true } } });
    render();
    expect(container.textContent).toContain('Warning radius');
    expect(container.textContent).toContain('Not a safety device.');
    expect(container.querySelector('input[aria-label="Hysteresis"]').value).toBe('20');
    expect(container.textContent).toContain('held by strikes out to 60 km (warning) and 30 km (alarm)');
    expect(container.textContent).toContain('Alert again during an alarm when lightning comes much closer');
    expect(container.textContent).toContain('No strikes within 50 km');

    click(button('Simulate alarm strike'));
    render();
    expect(guard).toMatchObject({ level: 'alarm', relay: true, allClearMin: 30, override: 'auto' });
    const banner = container.querySelector('[role="alert"]');
    expect(banner.textContent).toContain('LIGHTNING ALARM');
    expect(banner.textContent).toContain('Nearest strike 15 km NE');
    expect(banner.textContent).toContain('All-clear in 30:00');
    expect(banner.textContent).toContain('antenna relay engaged');

    const bolt = container.querySelector('button[aria-label="Lightning guard — LIGHTNING ALARM"]');
    expect(bolt).not.toBeNull();
    click(bolt);
    const popover = container.querySelector('[role="dialog"]');
    expect(popover.textContent).toContain('Antenna relay ENGAGED');
    click(Array.from(popover.querySelectorAll('button')).find((b) => b.textContent === 'Hold connected'));
    expect(guard.relay).toBe(false);
    expect(container.textContent).toContain('ends by itself at the next all-clear');

    click(button('Hide'));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('Web Push: unavailable without server support; ticking it subscribes this browser first', async () => {
    saveAlertSettings({ lightningGuard: { enabled: true } });
    pushMock.status = { configured: false };
    render();
    await act(async () => {});
    expect(container.textContent).toContain('Web Push is not available here');

    act(() => root.unmount());
    root = createRoot(container);
    pushMock.status = { configured: true, lightning: true, lightningBroadcast: false };
    pushMock.subscription = null;
    pushMock.subscribeToPush = vi.fn(async () => {
      pushMock.subscription = { endpoint: 'https://push.example/1' };
      return { ok: true };
    });
    render();
    await act(async () => {});
    const box = Array.from(container.querySelectorAll('label')).find((l) => l.textContent.includes('Web Push (also'));
    const input = box.querySelector('input');
    expect(input.disabled).toBe(false);
    await act(async () => {
      input.click();
    });
    expect(pushMock.subscribeToPush).toHaveBeenCalledTimes(1);
    expect(getAlertSettings().lightningGuard.channels.push).toBe(true);
    render();
    expect(container.textContent).toContain('rounded to about 1 km');

    // A failed subscribe leaves the box unticked and says why
    saveAlertSettings({ lightningGuard: { enabled: true } });
    pushMock.subscription = null;
    pushMock.subscribeToPush = vi.fn(async () => ({ ok: false, reason: 'no-permission' }));
    render();
    await act(async () => {
      Array.from(container.querySelectorAll('label'))
        .find((l) => l.textContent.includes('Web Push (also'))
        .querySelector('input')
        .click();
    });
    expect(!!getAlertSettings().lightningGuard.channels?.push).toBe(false);
    expect(container.textContent).toContain('Could not subscribe this browser to push (no-permission)');
  });

  it('recognises a Rig Bridge that predates the multi-display relay rules', () => {
    expect(bridgeNeedsUpdate(null)).toBe(true); // no GPIO status at all
    expect(bridgeNeedsUpdate({ enabled: false, running: false })).toBe(true); // first lightning release
    expect(bridgeNeedsUpdate({ features: ['lightning-relay', 'lightning-arbiter'] })).toBe(true);
    expect(bridgeNeedsUpdate({ features: ['lightning-relay', 'lightning-arbiter', 'lightning-guard-settings'] })).toBe(
      false,
    );
  });
});
