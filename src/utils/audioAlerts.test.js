import { describe, it, expect, beforeEach } from 'vitest';
import { ALERT_FEEDS, getAlertSettings, migrateLegacyLightning } from './audioAlerts.js';

const LS_KEY = 'ohc_audio_alerts';

describe('Lightning Proximity feed → lightning guard migration', () => {
  beforeEach(() => localStorage.clear());

  it('the old feed is gone from the feed list', () => {
    expect(ALERT_FEEDS.lightning).toBeUndefined();
  });

  it('an enabled old feed turns the guard on with its tone, speech and notification choices', () => {
    const { settings, migrated } = migrateLegacyLightning({
      volume: 0.7,
      lightning: { enabled: true, tone: 'beep', notify: true, speak: false },
    });
    expect(migrated).toBe(true);
    expect(settings).toEqual({
      volume: 0.7,
      lightningGuard: {
        enabled: true,
        tone: 'beep',
        channels: { tone: true, speech: false, notify: true, push: false },
      },
    });
  });

  it('a disabled old feed is just dropped; an existing guard is never overwritten', () => {
    expect(migrateLegacyLightning({ lightning: { enabled: false } }).settings).toEqual({});
    const guard = { enabled: false, warnKm: 80 };
    expect(migrateLegacyLightning({ lightning: { enabled: true }, lightningGuard: guard }).settings).toEqual({
      lightningGuard: guard,
    });
    expect(migrateLegacyLightning({ volume: 1 })).toEqual({ settings: { volume: 1 }, migrated: false });
  });

  it('getAlertSettings migrates stored settings once and writes them back', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ lightning: { enabled: true, tone: 'chirp', notify: false } }));
    const s = getAlertSettings();
    expect(s.lightning).toBeUndefined();
    expect(s.lightningGuard.enabled).toBe(true);
    const stored = JSON.parse(localStorage.getItem(LS_KEY));
    expect(stored).not.toHaveProperty('lightning');
    expect(stored.lightningGuard.tone).toBe('chirp');
  });
});
