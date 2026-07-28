import { describe, expect, it } from 'vitest';

import { detectMode } from './callsign.js';

// FTx signals occupy dial + 0–3 kHz (audio passband above the dial), so the
// island window is asymmetric: [dial − 0.5 kHz, dial + 3.1 kHz]. These tests
// pin the boundaries — especially FT4 vs FT2, whose dials are only 4 kHz
// apart, which is why a symmetric ±5 kHz window can never work.
describe('detectMode frequency islands (asymmetric window)', () => {
  it('classifies spots in the audio passband above the dial', () => {
    expect(detectMode(null, '14.074')).toBe('FT8'); // 20m FT8 dial itself
    expect(detectMode(null, '14.077')).toBe('FT8'); // near top of passband
    expect(detectMode(null, '14.081')).toBe('FT4'); // FT4 dial + 1 kHz
    expect(detectMode(null, '14.085')).toBe('FT2'); // FT2 dial + 1 kHz
    expect(detectMode(null, '24.916')).toBe('FT8'); // 12m FT8 dial + 1 kHz
    expect(detectMode(null, '24.924')).toBe('FT2'); // 12m FT2 dial + 1 kHz
  });

  it('does not classify below-dial spots as FTx — signals are never below the dial', () => {
    // 24.911 is 4 kHz below the 12m FT8 dial (24.915). The old ±5 kHz window
    // matched it (see the retired comment in callsign.js), but such spots are
    // busted: the FT8 audio passband sits entirely above the dial.
    expect(detectMode(null, '24.911')).not.toBe('FT8');
  });

  it('separates FT4 and FT2 islands only 4 kHz apart', () => {
    expect(detectMode(null, '14.083')).toBe('FT4'); // FT4 dial + 3.0 kHz
    expect(detectMode(null, '14.0835')).toBe('FT2'); // FT2 dial − 0.5 kHz (rounded-down allowance)
  });

  it('160m FT8/FT2 dial adjacency: FT8 wins bare dial quotes, comments win everything', () => {
    // FT2's 1.843 dial sits exactly at the top of FT8 1.840's passband — the
    // documented, inherent ambiguity. A bare spot at exactly the FT2 dial
    // classifies FT8; anything above it is FT2; a comment overrides both.
    expect(detectMode(null, '1.8430')).toBe('FT8');
    expect(detectMode(null, '1.8432')).toBe('FT2');
    expect(detectMode('FT2 -12dB from JN44 1489Hz', '1.843')).toBe('FT2');
  });

  it('normalizes spots arriving in kHz', () => {
    expect(detectMode(null, '14085')).toBe('FT2');
  });
});
