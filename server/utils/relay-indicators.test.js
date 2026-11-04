import { describe, it, expect } from 'vitest';

const { sanitizeRelayIndicators, queueRelayCommand, MAX_QUEUED_COMMANDS } = require('./relay-indicators.js');

describe('cloud relay indicators', () => {
  it('whitelists the indicator fields, including the lightning relay', () => {
    expect(
      sanitizeRelayIndicators({
        satVisible: true,
        countdown: 'running',
        lightning: 'alarm',
        lightningRelay: true,
        lightningAllClearMin: 999,
        lightningOverride: 'off',
        displayId: 'abc_123',
        evil: '<script>',
      }),
    ).toEqual({
      satVisible: true,
      satAosInSec: null,
      satLosInSec: null,
      alarm: false,
      countdown: 'running',
      lightning: 'alarm',
      lightningRelay: true,
      lightningAllClearMin: 240,
      lightningOverride: 'off',
      displayId: 'abc_123',
    });
    const plain = sanitizeRelayIndicators({ lightningRelay: 'yes', displayId: 'bad id!' });
    expect(plain).not.toHaveProperty('lightningRelay');
    expect(plain).not.toHaveProperty('displayId');
    expect(sanitizeRelayIndicators(null)).toBeNull();
    expect(sanitizeRelayIndicators([1])).toBeNull();
  });

  it('keeps only the newest indicators command queued; other commands append', () => {
    let q = queueRelayCommand([], 'setFreq', { freq: 14074000 }, 1);
    q = queueRelayCommand(q, 'indicators', { lightningRelay: true }, 2);
    q = queueRelayCommand(q, 'indicators', { lightningRelay: false }, 3);
    q = queueRelayCommand(q, 'indicators', 'garbage', 4);
    expect(q.map((c) => c.type)).toEqual(['setFreq', 'indicators']);
    expect(q[1].payload.lightningRelay).toBe(false);
    for (let i = 0; i < 80; i++) q = queueRelayCommand(q, 'setPTT', { ptt: false }, 10 + i);
    expect(q).toHaveLength(MAX_QUEUED_COMMANDS);
  });

  it('carries the lightning guard settings for the headless guard, whitelisted', () => {
    const out = sanitizeRelayIndicators({
      lightningRelay: false,
      lightningGuard: { lat: 45, lon: 7, warnKm: 40, repeatCloser: false, relayOn: 'warn', evil: 'x', alarmKm: '9' },
    });
    expect(out.lightningGuard).toEqual({ lat: 45, lon: 7, warnKm: 40, repeatCloser: false, relayOn: 'warn' });
  });
});

describe('signed relay commands through the queue', () => {
  const auth = { v: 1, ts: 1, nonce: 'a'.repeat(24), sig: 'b'.repeat(64) };

  it('forwards a signed indicators payload byte-for-byte so the bridge can verify the HMAC', () => {
    const payload = { satVisible: false, countdown: 'off', alarm: false, lightningRelay: true, extra: 'kept' };
    const [cmd] = queueRelayCommand([], 'indicators', payload, 5, auth);
    expect(cmd.payload).toBe(payload);
    expect(cmd.auth).toEqual(auth);
  });

  it('still sanitizes unsigned indicators and keeps only the newest', () => {
    let q = queueRelayCommand([], 'indicators', { lightningRelay: true, extra: 'x' }, 1);
    q = queueRelayCommand(q, 'indicators', { lightningRelay: false }, 2);
    expect(q).toHaveLength(1);
    expect(q[0].payload.lightningRelay).toBe(false);
    expect(q[0].payload.extra).toBeUndefined();
    expect(q[0].auth).toBeUndefined();
  });

  it('carries the signature on other command types', () => {
    const [cmd] = queueRelayCommand([], 'setFreq', { freq: 14074000 }, 3, auth);
    expect(cmd).toMatchObject({ type: 'setFreq', payload: { freq: 14074000 }, auth });
  });
});
