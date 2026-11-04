import { describe, expect, it } from 'vitest';
import { spellPhonetic, speakableCallsign, ITU_LETTERS } from './phonetics.js';

describe('spellPhonetic', () => {
  it('spells a plain callsign with ITU words and digit words', () => {
    expect(spellPhonetic('VK9MA')).toBe('Victor Kilo Nine Mike Alfa');
  });

  it('handles lower case, zero, stroke and SSID dash', () => {
    expect(spellPhonetic('n0call/p')).toBe('November Zero Charlie Alfa Lima Lima stroke Papa');
    expect(spellPhonetic('W1AW-9')).toBe('Whiskey One Alfa Whiskey dash Nine');
  });

  it('drops characters it cannot spell and tolerates empty input', () => {
    expect(spellPhonetic('K3 LR!')).toBe('Kilo Three Lima Romeo');
    expect(spellPhonetic('')).toBe('');
    expect(spellPhonetic(null)).toBe('');
  });

  it('covers all 26 letters', () => {
    expect(Object.keys(ITU_LETTERS)).toHaveLength(26);
    expect(spellPhonetic('ABCDEFGHIJKLMNOPQRSTUVWXYZ').split(' ')).toHaveLength(26);
  });
});

describe('speakableCallsign', () => {
  it('uses phonetics by default and spaced letters otherwise', () => {
    expect(speakableCallsign('K3LR')).toBe('Kilo Three Lima Romeo');
    expect(speakableCallsign('K3LR', { phonetic: false })).toBe('K 3 L R');
    expect(speakableCallsign('PJ2/W9WI', { phonetic: false })).toBe('P J 2 stroke W 9 W I');
  });
});
