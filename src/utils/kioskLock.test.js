import { describe, it, expect, beforeEach } from 'vitest';
import {
  sha256Hex,
  isValidPin,
  makePinRecord,
  verifyPinRecord,
  setPin,
  clearPin,
  lock,
  unlock,
  isLocked,
  hasPin,
  applyUrlParams,
  PIN_KEY,
  LOCKED_KEY,
} from './kioskLock.js';

describe('sha256Hex', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });
  it('handles multi-block input and UTF-8', () => {
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
    expect(sha256Hex('Grüße')).toHaveLength(64);
  });
});

describe('PIN records', () => {
  it('validates 4–8 digit PINs', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin(1234)).toBe(false);
  });
  it('hashes with a salt and verifies', () => {
    const rec = makePinRecord('2468', 'saltsalt');
    expect(rec.hash).toBe(sha256Hex('saltsalt:2468'));
    expect(verifyPinRecord(rec, '2468')).toBe(true);
    expect(verifyPinRecord(rec, '2469')).toBe(false);
    expect(verifyPinRecord(null, '2468')).toBe(false);
    expect(() => makePinRecord('12')).toThrow();
  });
});

describe('lock state', () => {
  beforeEach(() => {
    localStorage.removeItem(PIN_KEY);
    localStorage.removeItem(LOCKED_KEY);
  });

  it('cannot lock without a PIN', () => {
    expect(lock()).toBe(false);
    expect(isLocked()).toBe(false);
  });

  it('set → lock → wrong PIN stays locked → right PIN unlocks', () => {
    expect(setPin('1357')).toBe(true);
    expect(hasPin()).toBe(true);
    expect(localStorage.getItem(PIN_KEY)).not.toContain('1357'); // stored hashed
    expect(lock()).toBe(true);
    expect(isLocked()).toBe(true);
    expect(unlock('0000')).toBe(false);
    expect(isLocked()).toBe(true);
    expect(unlock('1357')).toBe(true);
    expect(isLocked()).toBe(false);
  });

  it('clearPin needs the current PIN and also unlocks', () => {
    setPin('9999');
    lock();
    expect(clearPin('1111')).toBe(false);
    expect(isLocked()).toBe(true);
    expect(clearPin('9999')).toBe(true);
    expect(hasPin()).toBe(false);
    expect(isLocked()).toBe(false);
  });

  it('applyUrlParams sets a PIN and locks', () => {
    expect(applyUrlParams('?lock=1')).toEqual({ setPin: false, locked: false }); // no PIN yet
    expect(applyUrlParams('?lockpin=4321&lock=1')).toEqual({ setPin: true, locked: true });
    expect(isLocked()).toBe(true);
    expect(unlock('4321')).toBe(true);
    expect(applyUrlParams('?lock=true')).toEqual({ setPin: false, locked: true });
    expect(applyUrlParams('?lockpin=12')).toEqual({ setPin: false, locked: false });
  });
});
