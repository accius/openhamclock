/**
 * useLightningGuard — the engine end to end with the strike feed and the
 * alert channels mocked: feed subscription only while enabled, alerts on
 * each transition (tone, speech, notification, push, EmComm log), the relay
 * request for the bridge, the manual override, simulated strikes.
 * Rendered with createRoot/act like the other hook tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const feed = vi.hoisted(() => ({ subscribers: new Set(), injected: [] }));
vi.mock('../utils/lightningFeed.js', () => ({
  subscribeStrikes: (fn) => {
    feed.subscribers.add(fn);
    return () => feed.subscribers.delete(fn);
  },
  injectStrike: (p) => {
    const s = { id: `sim${feed.injected.length}`, lat: p.lat, lon: p.lon, timestamp: Date.now(), simulated: true };
    feed.injected.push(s);
    for (const fn of feed.subscribers) fn([s]);
    return s;
  },
}));
const spies = vi.hoisted(() => ({
  playTone: vi.fn(),
  speakText: vi.fn(),
  showAlertNotification: vi.fn(),
  sendLightningPush: vi.fn(),
  setLightningPushPrefs: vi.fn(() => Promise.resolve({ ok: true })),
  recordEvent: vi.fn(),
}));
vi.mock('../utils/audioAlerts.js', async (orig) => ({ ...(await orig()), playTone: spies.playTone }));
vi.mock('../utils/speechAlerts.js', async (orig) => ({ ...(await orig()), speakText: spies.speakText }));
vi.mock('../utils/notifications.js', async (orig) => ({
  ...(await orig()),
  getNotificationPermission: () => 'granted',
  showAlertNotification: spies.showAlertNotification,
}));
vi.mock('../utils/push.js', () => ({
  sendLightningPush: spies.sendLightningPush,
  setLightningPushPrefs: spies.setLightningPushPrefs,
}));
vi.mock('../utils/emcommEventLog.js', () => ({ recordEvent: spies.recordEvent }));

import useLightningGuard, {
  acknowledgeRelayReport,
  getLightningGuardStatus,
  setRelayOverride,
  simulateStrike,
} from './useLightningGuard.js';
import { saveAlertSettings } from '../utils/audioAlerts.js';
import { destinationPoint } from '../utils/lightningGuard.js';

const DE = { lat: 51.5, lon: -0.12 };
const MIN = 60 * 1000;

let container;
let root;
let latest;
function Probe(props) {
  latest = useLightningGuard(props);
  return null;
}
const mount = (props = {}) =>
  act(() => root.render(<Probe location={DE} allUnits={{ dist: 'metric' }} layout="modern" {...props} />));
const configure = (guard) => act(() => saveAlertSettings({ lightningGuard: guard }));
const strike = (km, brg = 90) => {
  const p = destinationPoint(DE.lat, DE.lon, km, brg);
  act(() => {
    for (const fn of feed.subscribers) fn([{ id: `s${Math.random()}`, lat: p.lat, lon: p.lon, timestamp: Date.now() }]);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T15:00:00Z'));
  localStorage.clear();
  feed.subscribers.clear();
  feed.injected.length = 0;
  Object.values(spies).forEach((s) => s.mockClear());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useLightningGuard', () => {
  it('stays off (no feed subscription, no relay report) until enabled', () => {
    mount();
    expect(feed.subscribers.size).toBe(0);
    expect(latest).toMatchObject({ level: 'off', relay: null, allClearMin: 30, override: 'auto' });
    configure({ enabled: true });
    expect(feed.subscribers.size).toBe(1);
    expect(latest.level).toBe('clear');
  });

  it('needs a station location', () => {
    configure({ enabled: true });
    mount({ location: { lat: null, lon: null } });
    expect(feed.subscribers.size).toBe(0);
  });

  it('warn → alarm → all-clear fires every channel and drives the relay', () => {
    configure({ enabled: true, channels: { push: true }, relay: { enabled: true } });
    mount({ layout: 'emcomm' });
    expect(latest.relay).toBe(false);

    strike(80); // outside 50 km
    expect(latest.level).toBe('clear');

    strike(40);
    expect(latest.level).toBe('warn');
    expect(latest.relay).toBe(false);
    expect(spies.playTone).toHaveBeenCalledTimes(1);
    expect(spies.speakText.mock.calls[0][0]).toBe('Lightning warning. Strike 40 kilometres east.');
    expect(spies.showAlertNotification.mock.calls[0][0]).toMatchObject({ title: 'Lightning warning' });
    expect(spies.sendLightningPush.mock.calls[0][0]).toMatchObject({ level: 'warn', relay: null });
    expect(spies.recordEvent).toHaveBeenCalledWith(
      'lightning',
      expect.objectContaining({ summary: 'Lightning warning' }),
    );

    strike(12, 0);
    expect(latest.level).toBe('alarm');
    expect(latest.relay).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(spies.playTone).toHaveBeenCalledTimes(4); // 1 + three alarm beeps
    expect(spies.speakText.mock.calls[1][0]).toBe(
      'Lightning alarm. Strike 12 kilometres north. Antenna relay engaged.',
    );
    const st = getLightningGuardStatus();
    expect(st.nearest.distanceKm).toBeCloseTo(12, 1);
    expect(st.clearAt).toBe(st.nearest.timestamp + 30 * MIN);
    expect(st.clearAt - Date.now()).toBe(30 * MIN - 1000); // 1 s of the beeps already elapsed

    // 30 minutes of quiet → all-clear, relay released automatically
    act(() => vi.advanceTimersByTime(30 * MIN + 15000));
    expect(latest.level).toBe('clear');
    expect(latest.relay).toBe(false);
    expect(spies.speakText.mock.calls.at(-1)[0]).toBe('Lightning all clear. Antenna relay released.');
    expect(spies.sendLightningPush.mock.calls.at(-1)[0]).toMatchObject({ level: 'clear' });
    expect(spies.recordEvent).toHaveBeenCalledWith(
      'lightning',
      expect.objectContaining({ summary: 'Lightning all clear' }),
    );
  });

  it('channels can be switched off; no EmComm entry outside the EmComm layout', () => {
    configure({ enabled: true, channels: { tone: false, speech: false, notify: false } });
    mount();
    strike(10);
    expect(latest.level).toBe('alarm');
    expect(spies.playTone).not.toHaveBeenCalled();
    expect(spies.speakText).not.toHaveBeenCalled();
    expect(spies.showAlertNotification).not.toHaveBeenCalled();
    expect(spies.sendLightningPush).not.toHaveBeenCalled(); // push is opt-in
    expect(spies.recordEvent).not.toHaveBeenCalled();
    expect(latest.relay).toBeNull(); // relay not enabled → not reported
  });

  it('manual override: force protect, hold connected (lapses at all-clear)', () => {
    configure({ enabled: true, relay: { enabled: true } });
    mount();
    act(() => setRelayOverride('on'));
    expect(latest.relay).toBe(true);
    act(() => setRelayOverride('auto'));
    expect(latest.relay).toBe(false);

    strike(10);
    expect(latest.relay).toBe(true);
    act(() => setRelayOverride('off'));
    expect(latest.relay).toBe(false);
    expect(getLightningGuardStatus().override).toBe('off');
    act(() => vi.advanceTimersByTime(31 * MIN));
    expect(latest.level).toBe('clear');
    expect(getLightningGuardStatus().override).toBe('auto');
  });

  it('switching the relay off releases it once, until the bridge acknowledges', () => {
    configure({ enabled: true, relay: { enabled: true } });
    mount();
    strike(10);
    expect(latest.relay).toBe(true);
    configure({ enabled: true, relay: { enabled: false } });
    expect(latest.relay).toBe(false); // explicit release for the bridge
    act(() => acknowledgeRelayReport(false));
    expect(latest.relay).toBeNull(); // then silent, so other displays are not overridden
  });

  it('simulated strikes go through the feed relative to DE', () => {
    configure({ enabled: true });
    mount();
    act(() => simulateStrike(8, 180));
    expect(feed.injected).toHaveLength(1);
    expect(latest.level).toBe('alarm');
    const st = getLightningGuardStatus();
    expect(st.nearest.distanceKm).toBeCloseTo(8, 1);
    expect(st.nearest.bearingDeg).toBeCloseTo(180, 0);
    expect(st.nearest.simulated).toBe(true);
  });

  it('settings edits re-evaluate immediately (wider alarm radius)', () => {
    configure({ enabled: true });
    mount();
    strike(40);
    expect(latest.level).toBe('warn');
    configure({ enabled: true, alarmKm: 45 });
    expect(latest.level).toBe('alarm');
  });

  it('alerts again in an alarm when lightning comes markedly closer (throttled, switchable)', () => {
    configure({ enabled: true, channels: { push: true } });
    mount({ layout: 'emcomm' });
    strike(20, 0);
    expect(latest.level).toBe('alarm');
    const spoken = () => spies.speakText.mock.calls.map((c) => c[0]);
    act(() => vi.advanceTimersByTime(60 * 1000));
    strike(8, 0); // halved, but only a minute later
    expect(spoken().filter((t) => t.startsWith('Lightning closer'))).toHaveLength(0);
    act(() => vi.advanceTimersByTime(61 * 1000));
    strike(8, 0);
    expect(spoken().at(-1)).toBe('Lightning closer. Strike 8 kilometres north.');
    expect(spies.sendLightningPush.mock.calls.at(-1)[0]).toMatchObject({ level: 'alarm', closer: true });
    expect(spies.recordEvent).toHaveBeenCalledWith(
      'lightning',
      expect.objectContaining({ summary: 'Lightning closer' }),
    );

    configure({ enabled: true, repeatCloser: false });
    act(() => vi.advanceTimersByTime(3 * MIN));
    const before = spoken().length;
    strike(2, 0);
    expect(spoken()).toHaveLength(before);
  });

  it('announces warnings and alarms for screen readers', () => {
    const seen = [];
    const onProx = (e) => seen.push(e.detail);
    document.addEventListener('lightning:proximity', onProx);
    try {
      configure({ enabled: true });
      mount();
      strike(40, 180);
      expect(seen).toEqual([{ distanceKm: 40, distanceMiles: 24.9, direction: 'south' }]);
    } finally {
      document.removeEventListener('lightning:proximity', onProx);
    }
  });

  it('keeps the server push opt-in in step with location and radii (debounced), and opts out', async () => {
    configure({ enabled: true, channels: { push: true } });
    mount();
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(spies.setLightningPushPrefs).toHaveBeenLastCalledWith({
      lat: 51.5,
      lon: -0.12,
      warnKm: 50,
      alarmKm: 25,
      imperial: false,
    });
    await act(async () => {
      vi.advanceTimersByTime(5000); // unchanged → no second call
    });
    expect(spies.setLightningPushPrefs).toHaveBeenCalledTimes(1);
    configure({ enabled: true, channels: { push: false } });
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(spies.setLightningPushPrefs).toHaveBeenLastCalledWith(null);
  });

  it("exposes the guard settings and location for the bridge's headless guard", () => {
    configure({
      enabled: true,
      alarmKm: 15,
      hysteresisPct: 5,
      repeatCloser: false,
      relay: { enabled: true, on: 'warn' },
    });
    mount();
    expect(latest.guard).toEqual({
      lat: 51.5,
      lon: -0.12,
      warnKm: 50,
      alarmKm: 15,
      allClearMin: 30,
      minStrikes: 1,
      hysteresisPct: 5,
      repeatCloser: false,
      relayOn: 'warn',
    });
    const first = latest.guard;
    act(() => vi.advanceTimersByTime(20000));
    expect(latest.guard).toBe(first); // stable between renders (no needless re-posts)
    configure({ enabled: false });
    expect(latest.guard).toBeNull();
  });
});
