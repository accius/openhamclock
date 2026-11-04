import { describe, it, expect } from 'vitest';
import { spotLabelText, spotLabelSuppressed, SPOT_LABEL_MODES } from './spotLabel.js';

describe('spotLabelText', () => {
  it('knows the four HamClock modes', () => {
    expect(SPOT_LABEL_MODES).toEqual(['none', 'call', 'prefix', 'freq']);
  });

  it('none → no label', () => {
    expect(spotLabelText('none', { call: 'K0CJH', freq: 14.074 })).toBeNull();
  });

  it('call → the callsign', () => {
    expect(spotLabelText('call', { call: 'K0CJH' })).toBe('K0CJH');
    expect(spotLabelText(undefined, { call: 'K0CJH' })).toBe('K0CJH');
    expect(spotLabelText('call', {})).toBeNull();
  });

  it('prefix → the WPX prefix', () => {
    expect(spotLabelText('prefix', { call: 'K0CJH' })).toBe('K0');
    expect(spotLabelText('prefix', { call: 'VP2E/K0CJH' })).toBe('VP2E');
  });

  it('freq → MHz with three decimals from MHz or kHz', () => {
    expect(spotLabelText('freq', { call: 'K0CJH', freq: 14.074 })).toBe('14.074');
    expect(spotLabelText('freq', { call: 'K0CJH', freq: '7025.5' })).toBe('7.026');
    expect(spotLabelText('freq', { call: 'K0CJH' })).toBe('K0CJH'); // no frequency → fall back to call
  });
});

describe('spotLabelSuppressed', () => {
  const de = { lat: 40.0, lon: -105.0 };

  it('hides labels closer than the minimum distance', () => {
    expect(spotLabelSuppressed(de, 40.5, -105.2, 500)).toBe(true); // ~58 km away
    expect(spotLabelSuppressed(de, 51.5, -0.1, 500)).toBe(false); // London
  });

  it('is off with 0, negative or missing distance and with no DE', () => {
    expect(spotLabelSuppressed(de, 40.5, -105.2, 0)).toBe(false);
    expect(spotLabelSuppressed(de, 40.5, -105.2, -10)).toBe(false);
    expect(spotLabelSuppressed(de, 40.5, -105.2, undefined)).toBe(false);
    expect(spotLabelSuppressed(null, 40.5, -105.2, 500)).toBe(false);
    expect(spotLabelSuppressed(de, NaN, -105.2, 500)).toBe(false);
  });
});
