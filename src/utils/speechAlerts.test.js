import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechQueue, bandToSpeech, formatSpeechText, freqToSpeech, getSpeechSettings } from './speechAlerts.js';

describe('bandToSpeech / freqToSpeech', () => {
  it('expands band keys into spoken units', () => {
    expect(bandToSpeech('20m')).toBe('20 metres');
    expect(bandToSpeech('70cm')).toBe('70 centimetres');
    expect(bandToSpeech('')).toBe('');
    expect(bandToSpeech('other')).toBe('other');
  });
  it('normalizes MHz/kHz/Hz', () => {
    expect(freqToSpeech(14.074)).toBe('14.074 megahertz');
    expect(freqToSpeech(14074)).toBe('14.074 megahertz');
    expect(freqToSpeech(14074000)).toBe('14.074 megahertz');
    expect(freqToSpeech('x')).toBe('');
  });
});

describe('formatSpeechText', () => {
  it('speaks a watchlist hit phonetically with band and mode', () => {
    expect(formatSpeechText('watchlist', { call: 'VK9MA', band: '20m', mode: 'CW' })).toBe(
      'Watchlist: Victor Kilo Nine Mike Alfa on 20 metres CW',
    );
  });
  it('can spell without phonetics', () => {
    expect(formatSpeechText('watchlist', { call: 'K3LR', band: '40m' }, { phonetic: false })).toBe(
      'Watchlist: K 3 L R on 40 metres',
    );
  });
  it('falls back to frequency when no band is present', () => {
    expect(formatSpeechText('dxcluster', { call: 'ZL1A', freq: '21.025' })).toMatch(/on 21\.025 megahertz$/);
  });
  it('covers activation, band opening, swpc, lightning and opportunity feeds', () => {
    expect(formatSpeechText('pota', { call: 'W1AW', band: '20m', mode: 'SSB', ref: 'US-0001' })).toBe(
      'POTA: Whiskey One Alfa Whiskey on 20 metres SSB at US-0001',
    );
    expect(formatSpeechText('band-openings', { band: '10m', from_continent: 'EU', to_zone: 3 })).toBe(
      '10 metres opening from EU to zone 3',
    );
    expect(formatSpeechText('swpc', { scale: { band: 'G', level: 3 }, title: 'Geomagnetic storm' })).toBe(
      'Space weather: G 3 Geomagnetic storm',
    );
    expect(formatSpeechText('lightning', { distance: 12.4 })).toBe(''); // folded into the lightning guard
    expect(formatSpeechText('lightning-guard', { level: 'alarm', closer: true, distanceKm: 6, bearing: 'north' })).toBe(
      'Lightning closer. Strike 6 kilometres north.',
    );
    expect(
      formatSpeechText('lightning-guard', { level: 'alarm', distanceKm: 12.4, bearing: 'north-east', relay: true }),
    ).toBe('Lightning alarm. Strike 12 kilometres north-east. Antenna relay engaged.');
    expect(
      formatSpeechText('lightning-guard', { level: 'warn', distanceKm: 40, bearing: 'west', imperial: true }),
    ).toBe('Lightning warning. Strike 25 miles west.');
    expect(formatSpeechText('lightning-guard', { level: 'warn', downgraded: true, relay: false })).toBe(
      'Lightning alarm ended. Warning continues. Antenna relay released.',
    );
    expect(formatSpeechText('lightning-guard', { level: 'clear' })).toBe('Lightning all clear.');
    expect(formatSpeechText('lightning-guard', { level: 'nope' })).toBe('');
    expect(formatSpeechText('opportunity', { call: 'P5DX', band: '20m', mode: 'CW', needs: ['dxcc', 'zone'] })).toBe(
      'Opportunity: Papa Five Delta X-ray on 20 metres CW, new DXCC, new zone',
    );
  });
  it('is silent for unknown feeds and empty items', () => {
    expect(formatSpeechText('nope', { call: 'X' })).toBe('');
    expect(formatSpeechText('watchlist', null)).toBe('');
    expect(formatSpeechText('watchlist', {})).toBe('');
  });
});

describe('getSpeechSettings', () => {
  it('merges defaults with stored values', () => {
    expect(getSpeechSettings({})).toEqual({ enabled: false, voice: '', rate: 1, phonetic: true });
    expect(getSpeechSettings({ speech: { enabled: true, rate: 1.3 } }).rate).toBe(1.3);
  });
});

describe('SpeechQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('spaces utterances by the minimum gap and drops duplicates within the window', () => {
    const spoken = [];
    const q = new SpeechQueue({ speak: (t) => spoken.push([t, Date.now()]), minGapMs: 4000, dedupeMs: 60000 });
    const t0 = Date.now();
    expect(q.enqueue('one')).toBe(true);
    expect(q.enqueue('two')).toBe(true);
    expect(q.enqueue('one')).toBe(false); // duplicate within 60 s
    vi.advanceTimersByTime(0);
    expect(spoken.map((s) => s[0])).toEqual(['one']);
    vi.advanceTimersByTime(3999);
    expect(spoken).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(spoken.map((s) => s[0])).toEqual(['one', 'two']);
    expect(spoken[1][1] - t0).toBeGreaterThanOrEqual(4000);
  });

  it('allows the same text again after the dedupe window', () => {
    const spoken = [];
    const q = new SpeechQueue({ speak: (t) => spoken.push(t), minGapMs: 10, dedupeMs: 1000 });
    q.enqueue('again');
    vi.advanceTimersByTime(50);
    expect(q.enqueue('again')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(q.enqueue('again')).toBe(true);
    vi.advanceTimersByTime(50);
    expect(spoken).toEqual(['again', 'again']);
  });

  it('caps the pending queue, dropping the oldest', () => {
    const spoken = [];
    const q = new SpeechQueue({ speak: (t) => spoken.push(t), minGapMs: 1000, maxQueue: 2 });
    q.enqueue('a');
    vi.advanceTimersByTime(0); // 'a' spoken immediately
    q.enqueue('b');
    q.enqueue('c');
    q.enqueue('d');
    vi.advanceTimersByTime(5000);
    expect(spoken).toEqual(['a', 'c', 'd']);
  });

  it('ignores empty text', () => {
    const q = new SpeechQueue({ speak: () => {} });
    expect(q.enqueue('')).toBe(false);
    expect(q.enqueue(null)).toBe(false);
  });
});
