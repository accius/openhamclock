import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  formatAlertBody,
  showAlertNotification,
} from './notifications';

// jsdom has no Notification implementation — install/remove a stub per test.
function stubNotification({ permission = 'granted', requestResult = 'granted' } = {}) {
  const constructed = [];
  function FakeNotification(title, options) {
    constructed.push({ title, options });
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = vi.fn().mockResolvedValue(requestResult);
  window.Notification = FakeNotification;
  return { FakeNotification, constructed };
}

afterEach(() => {
  delete window.Notification;
  vi.restoreAllMocks();
});

describe('permission helpers', () => {
  it('reports unsupported when Notification is undefined (jsdom default)', () => {
    expect(isNotificationSupported()).toBe(false);
    expect(getNotificationPermission()).toBe('unsupported');
  });

  it('resolves to unsupported from requestNotificationPermission when API missing', async () => {
    await expect(requestNotificationPermission()).resolves.toBe('unsupported');
  });

  it('reflects the browser permission when the API exists', () => {
    stubNotification({ permission: 'denied' });
    expect(isNotificationSupported()).toBe(true);
    expect(getNotificationPermission()).toBe('denied');
  });

  it('requests permission only while in the default state', async () => {
    const { FakeNotification } = stubNotification({ permission: 'default', requestResult: 'granted' });
    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);

    FakeNotification.permission = 'granted';
    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1); // not called again
  });
});

describe('formatAlertBody', () => {
  it('handles null and non-object items', () => {
    expect(formatAlertBody('pota', null)).toBe('');
    expect(formatAlertBody('pota', 'oops')).toBe('');
    expect(formatAlertBody('pota', undefined)).toBe('');
  });

  it('formats activation spots (pota/sota/wwff/wwbota)', () => {
    expect(formatAlertBody('pota', { call: 'K5DZY', freq: '14.074', mode: 'FT8', ref: 'US-1234' })).toBe(
      '14.074 K5DZY FT8 · US-1234',
    );
    // Raw-API field names still work
    expect(formatAlertBody('sota', { activator: 'W1AW', frequency: '7.032' })).toBe('7.032 W1AW');
    expect(formatAlertBody('wwbota', {})).toBe('');
  });

  it('formats dx cluster spots', () => {
    expect(formatAlertBody('dxcluster', { call: 'ZL1ABC', freq: '14074.0', comment: 'FT8 loud' })).toBe(
      '14074.0 ZL1ABC · FT8 loud',
    );
    expect(formatAlertBody('dxcluster', { dxCall: 'VK9X', freq: '21025.0' })).toBe('21025.0 VK9X');
  });

  it('formats watchlist hits', () => {
    expect(formatAlertBody('watchlist', { call: '3Y0J', freq: '14.024', mode: 'CW', band: '20m' })).toBe(
      '3Y0J spotted: 14.024 CW',
    );
    expect(formatAlertBody('watchlist', { call: '3Y0J', freq: '14.024' })).toBe('3Y0J spotted: 14.024');
    expect(formatAlertBody('watchlist', { call: '3Y0J' })).toBe('3Y0J spotted');
    expect(formatAlertBody('watchlist', {})).toBe('');
  });

  it('formats contest starts with minutes until start', () => {
    const start = new Date(Date.now() + 12 * 60 * 1000 + 500).toISOString();
    expect(formatAlertBody('contest-start', { name: 'CQ WW DX CW', start })).toBe('CQ WW DX CW starts in 12 min');
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    expect(formatAlertBody('contest-start', { name: 'ARRL Sweepstakes', start: past })).toBe(
      'ARRL Sweepstakes starting now',
    );
    // Missing/invalid start degrades to the bare name
    expect(formatAlertBody('contest-start', { name: 'CQ WPX' })).toBe('CQ WPX');
    expect(formatAlertBody('contest-start', {})).toBe('');
  });

  it('formats satellite passes', () => {
    const aos = Date.now() + 4 * 60 * 1000 + 500;
    expect(formatAlertBody('sat-pass', { name: 'ISS', aos, maxElevation: 45.4 })).toBe(
      'ISS pass in 4 min · max el 45°',
    );
    expect(formatAlertBody('sat-pass', { name: 'AO-91', aos: Date.now() - 1000 })).toBe('AO-91 pass starting');
    // No AOS still yields something usable
    expect(formatAlertBody('sat-pass', { name: 'SO-50' })).toBe('SO-50 pass');
    expect(formatAlertBody('sat-pass', {})).toBe('');
  });

  it('formats band openings', () => {
    expect(
      formatAlertBody('band-openings', {
        band: '20m',
        from_continent: 'EU',
        to_continent: 'NA',
        shortCount: 12,
        factor: 4,
      }),
    ).toBe('20m opening EU→NA (12 spots, 4x baseline)');
    // Null factor (no baseline yet — brand-new path) omits the ratio
    expect(
      formatAlertBody('band-openings', {
        band: '10m',
        from_continent: 'EU',
        to_continent: 'NA',
        shortCount: 6,
        factor: null,
      }),
    ).toBe('10m opening EU→NA (6 spots)');
    // Zone-scoped opening (#1191): the hearing side is a CQ zone
    expect(
      formatAlertBody('band-openings', {
        band: '20m',
        from_continent: 'EU',
        to_zone: 3,
        shortCount: 12,
        factor: 4,
      }),
    ).toBe('20m opening EU→zone 3 (12 spots, 4x baseline)');
    expect(formatAlertBody('band-openings', {})).toBe('');
  });

  it('formats dxpeditions, contests, swpc', () => {
    expect(formatAlertBody('dxpeditions', { callsign: '3Y0J', entity: 'Bouvet' })).toBe('3Y0J · Bouvet');
    expect(formatAlertBody('contests', { name: 'CQ WW SSB' })).toBe('CQ WW SSB');
    expect(formatAlertBody('swpc', { title: 'Geomagnetic Storm Watch', scale: { band: 'G', level: 2 } })).toBe(
      'G2 Geomagnetic Storm Watch',
    );
    expect(formatAlertBody('swpc', { productId: 'K07A' })).toBe('K07A');
  });

  it('truncates long bodies to 120 chars', () => {
    const body = formatAlertBody('contests', { name: 'x'.repeat(300) });
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body.endsWith('…')).toBe(true);
  });

  it('returns empty string for unknown feeds', () => {
    expect(formatAlertBody('mystery', { foo: 'bar' })).toBe('');
  });
});

describe('showAlertNotification', () => {
  it('no-ops silently when Notification is undefined', async () => {
    await expect(showAlertNotification({ feedId: 'pota', title: 'POTA Spots', body: 'x' })).resolves.toBeUndefined();
  });

  it('no-ops when permission is not granted', async () => {
    const { constructed } = stubNotification({ permission: 'denied' });
    await showAlertNotification({ feedId: 'pota', title: 'POTA Spots', body: 'x' });
    expect(constructed).toHaveLength(0);
  });

  it('prefers the service worker registration when available', async () => {
    const { constructed } = stubNotification({ permission: 'granted' });
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const getRegistration = vi.fn().mockResolvedValue({ showNotification });
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { getRegistration } });

    await showAlertNotification({ feedId: 'dxcluster', title: 'DX Cluster', body: '14074.0 K5DZY' });

    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = showNotification.mock.calls[0];
    expect(title).toBe('DX Cluster');
    expect(options.body).toBe('14074.0 K5DZY');
    expect(options.tag).toBe('ohc-alert-dxcluster');
    expect(options.icon).toBe('/icon-192.png');
    expect(constructed).toHaveLength(0); // fallback not used

    vi.unstubAllGlobals();
  });

  it('falls back to new Notification when no registration exists', async () => {
    const { constructed } = stubNotification({ permission: 'granted' });
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { getRegistration } });

    await showAlertNotification({ feedId: 'swpc', title: 'Space Weather', body: 'G2 Watch' });

    expect(constructed).toHaveLength(1);
    expect(constructed[0].title).toBe('Space Weather');
    expect(constructed[0].options.tag).toBe('ohc-alert-swpc');

    vi.unstubAllGlobals();
  });

  it('never throws when the fallback constructor throws', async () => {
    stubNotification({ permission: 'granted' });
    window.Notification = Object.assign(
      function () {
        throw new Error('platform says no');
      },
      { permission: 'granted' },
    );
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: undefined });

    await expect(showAlertNotification({ feedId: 'pota', title: 'POTA Spots' })).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('ignores calls without a title', async () => {
    const { constructed } = stubNotification({ permission: 'granted' });
    await showAlertNotification({ feedId: 'pota' });
    expect(constructed).toHaveLength(0);
  });
});

describe('formatAlertBody sat-alerts (hams.at)', () => {
  it('names the operator, satellite, lead time and grids', () => {
    const aos = Date.now() + 12 * 60 * 1000;
    expect(formatAlertBody('sat-alerts', { name: 'RS-44', callsign: 'KB5FHK', aos, grids: ['CM96'] })).toBe(
      'KB5FHK on RS-44 in 12 min · CM96',
    );
    expect(formatAlertBody('sat-alerts', { name: 'AO-7', callsign: 'WH6WR', aos: Date.now() - 1000 })).toBe(
      'WH6WR on AO-7 now',
    );
    expect(formatAlertBody('sat-alerts', { name: 'SO-50' })).toBe('on SO-50');
    expect(formatAlertBody('sat-alerts', {})).toBe('');
  });
});

describe('formatAlertBody lightning-guard', () => {
  it('nearest strike, strike count and relay state', () => {
    expect(formatAlertBody('lightning-guard', { level: 'alarm', distance: '12 km NE', count: 4, relay: true })).toBe(
      'Nearest strike 12 km NE · 4 strikes in 10 min · antenna relay engaged',
    );
    expect(formatAlertBody('lightning-guard', { level: 'warn', distance: '41 km W', count: 1 })).toBe(
      'Nearest strike 41 km W · 1 strike in 10 min',
    );
    expect(formatAlertBody('lightning-guard', { level: 'clear', count: 9, relay: false })).toBe(
      'All clear · antenna relay released',
    );
  });
});
