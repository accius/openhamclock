import { describe, it, expect } from 'vitest';
import { buildIndicatorPayload, deriveSatIndicators, getDisplayId } from './useHardwareIndicators.js';

const now = 1_000_000_000_000;

describe('deriveSatIndicators', () => {
  it('reports no satellite when nothing is tracked', () => {
    expect(deriveSatIndicators([], now)).toEqual({ satVisible: false, satAosInSec: null, satLosInSec: null });
    expect(deriveSatIndicators(null, now).satVisible).toBe(false);
  });

  it('seconds to the earliest upcoming AOS across satellites', () => {
    const sats = [
      { name: 'A', isVisible: false, nextPassStartTimes: [now - 1000, now + 90_000, now + 400_000] },
      { name: 'B', isVisible: false, nextPassStartTimes: [now + 45_000] },
    ];
    expect(deriveSatIndicators(sats, now)).toEqual({ satVisible: false, satAosInSec: 45, satLosInSec: null });
  });

  it('visible satellite: LOS from the first end time still ahead', () => {
    const sats = [
      { name: 'A', isVisible: true, nextPassStartTimes: [now - 300_000], nextPassEndTimes: [now - 10, now + 30_000] },
      { name: 'B', isVisible: false, nextPassStartTimes: [now + 20_000] },
    ];
    expect(deriveSatIndicators(sats, now)).toEqual({ satVisible: true, satAosInSec: 20, satLosInSec: 30 });
  });

  it('ignores unparsable times', () => {
    const sats = [{ name: 'A', isVisible: false, nextPassStartTimes: ['garbage', null] }];
    expect(deriveSatIndicators(sats, now).satAosInSec).toBeNull();
  });
});

describe('buildIndicatorPayload', () => {
  const sat = { satVisible: false, satAosInSec: null, satLosInSec: null };
  it('leaves the lightning fields out unless this display drives the relay', () => {
    expect(buildIndicatorPayload(sat, 'running', undefined)).toEqual({ ...sat, countdown: 'running', alarm: false });
    expect(buildIndicatorPayload(sat, 'off', { level: 'alarm', relay: null })).not.toHaveProperty('lightningRelay');
  });
  it('adds level and relay request when the relay is driven', () => {
    expect(buildIndicatorPayload(sat, 'expired', { level: 'alarm', relay: true })).toEqual({
      ...sat,
      countdown: 'expired',
      alarm: true,
      lightning: 'alarm',
      lightningRelay: true,
    });
    // With a display id, all-clear time and a manual override
    expect(
      buildIndicatorPayload(sat, 'off', { level: 'warn', relay: false, allClearMin: 20, override: 'off' }, 'abc12345'),
    ).toMatchObject({
      lightningRelay: false,
      lightningAllClearMin: 20,
      lightningOverride: 'off',
      displayId: 'abc12345',
    });
    expect(buildIndicatorPayload(sat, 'off', { level: 'warn', relay: false, override: 'auto' })).not.toHaveProperty(
      'lightningOverride',
    );
    // Guard settings + location for the bridge's headless guard ride along
    const guard = { lat: 45, lon: 7, warnKm: 50, alarmKm: 25, allClearMin: 30, relayOn: 'alarm' };
    expect(buildIndicatorPayload(sat, 'off', { level: 'clear', relay: false, guard }).lightningGuard).toEqual(guard);
    expect(buildIndicatorPayload(sat, 'off', { level: 'clear', relay: null, guard })).not.toHaveProperty(
      'lightningGuard',
    );
    // Relay switched off here: one explicit release, without a level
    expect(buildIndicatorPayload(sat, 'off', { level: 'off', relay: false })).toMatchObject({ lightningRelay: false });
    expect(buildIndicatorPayload(sat, 'off', { level: 'off', relay: false })).not.toHaveProperty('lightning');
  });
});

describe('getDisplayId', () => {
  it('is stable per browser', () => {
    localStorage.removeItem('ohc_display_id');
    const a = getDisplayId();
    expect(a).toMatch(/^[a-z0-9]{8,24}$/);
    expect(getDisplayId()).toBe(a);
  });
});
