/**
 * Settings persistence regressions (N3DD: VOACAP antenna reverting on refresh).
 *  - a change made inside the 2 s server-sync debounce must survive a refresh
 *  - loadConfig must keep the antenna saved in localStorage
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadConfig,
  saveConfig,
  installSettingsSyncInterceptor,
  flushSettingsSync,
  hasPendingSettingsSync,
  syncAllSettingsToServer,
} from './config.js';

describe('flushSettingsSync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: 1 }) })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pushes a pending debounced sync with sendBeacon so a quick refresh cannot lose it', async () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    expect(typeof navigator.sendBeacon).toBe('function');
    installSettingsSyncInterceptor();

    // A settings write arms the 2 s debounce (the interceptor routes
    // localStorage.setItem here; call it directly so the test does not depend
    // on jsdom's Storage accepting a patched setItem or on module-state
    // isolation between test files).
    localStorage.setItem('openhamclock_config', JSON.stringify({ propagation: { antenna: 'dipole' } }));
    syncAllSettingsToServer();
    expect(hasPendingSettingsSync()).toBe(true);

    expect(flushSettingsSync()).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0];
    expect(url).toBe('/api/settings');
    expect(body).toBeInstanceOf(Blob);
    expect(body.type).toBe('application/json');
    // jsdom's Blob cannot be read back under fake timers; a non-empty JSON
    // body is enough — collectSyncSettings() is what fills it.
    expect(body.size).toBeGreaterThan(20);

    // The debounced fetch was cancelled — nothing fires later
    vi.advanceTimersByTime(3000);
    expect(fetch).not.toHaveBeenCalled();
    // Nothing pending any more
    expect(flushSettingsSync()).toBe(false);
  });

  it('is a no-op when nothing is pending', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    expect(hasPendingSettingsSync()).toBe(false);
    expect(flushSettingsSync()).toBe(false);
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe('loadConfig antenna persistence', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the antenna saved in localStorage', () => {
    saveConfig({ ...loadConfig(), propagation: { mode: 'CW', power: 50, antenna: 'vert-qw' } });
    expect(loadConfig().propagation).toMatchObject({ mode: 'CW', power: 50, antenna: 'vert-qw' });
  });

  it('falls back to the default antenna only when the saved block has none', () => {
    localStorage.setItem('openhamclock_config', JSON.stringify({ propagation: { mode: 'SSB', power: 100 } }));
    expect(loadConfig().propagation.antenna).toBe('isotropic');
  });
});
