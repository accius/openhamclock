/**
 * Tests for server/utils/incidentAuth.js — incident ids, join keys, hashing.
 */
import { describe, expect, it } from 'vitest';

const {
  ALPHABET,
  ID_LENGTH,
  KEY_LENGTH,
  makeIncidentId,
  makeJoinKey,
  normaliseToken,
  isValidIncidentId,
  hashJoinKey,
  verifyJoinKey,
  isValidCallsign,
  makeTicket,
  sealJoinKey,
  openJoinKey,
} = require('./incidentAuth.js');

describe('incidentAuth', () => {
  it('generates ids and keys from the lookalike-free alphabet at the right lengths', () => {
    const re = new RegExp(`^[${ALPHABET}]+$`);
    for (let i = 0; i < 50; i++) {
      const id = makeIncidentId();
      const key = makeJoinKey();
      expect(id).toHaveLength(ID_LENGTH);
      expect(key).toHaveLength(KEY_LENGTH);
      expect(id).toMatch(re);
      expect(key).toMatch(re);
      expect(id).not.toMatch(/[ILO01]/);
    }
  });

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 200 }, makeIncidentId));
    expect(ids.size).toBe(200);
  });

  it('normalises typed tokens: case, whitespace and separators', () => {
    expect(normaliseToken(' ab cd-ef.gh ')).toBe('ABCDEFGH');
    expect(normaliseToken(null)).toBe('');
  });

  it('validates incident ids', () => {
    expect(isValidIncidentId(makeIncidentId())).toBe(true);
    expect(isValidIncidentId('ABCDEFG')).toBe(false);
    expect(isValidIncidentId('ABCDEFG1')).toBe(false); // 1 is not in the alphabet
    expect(isValidIncidentId(123)).toBe(false);
  });

  it('hashes keys with a random salt and never stores the key itself', () => {
    const key = makeJoinKey();
    const a = hashJoinKey(key);
    const b = hashJoinKey(key);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a)).not.toContain(key);
  });

  it('verifies the right key, tolerating how it was typed, and rejects wrong ones', () => {
    const key = makeJoinKey();
    const { salt, hash } = hashJoinKey(key);
    expect(verifyJoinKey(key, salt, hash)).toBe(true);
    expect(verifyJoinKey(key.toLowerCase(), salt, hash)).toBe(true);
    expect(verifyJoinKey(`${key.slice(0, 4)}-${key.slice(4)}`, salt, hash)).toBe(true);
    expect(verifyJoinKey(makeJoinKey(), salt, hash)).toBe(false);
    expect(verifyJoinKey('', salt, hash)).toBe(false);
    expect(verifyJoinKey(key, salt, 'nothex')).toBe(false);
    expect(verifyJoinKey(key, undefined, hash)).toBe(false);
  });

  it('accepts real-looking callsigns and refuses placeholders', () => {
    for (const c of ['W1AW', 'k0cjh', 'VE3ABC', '2E0XYZ', 'W1AW/P', 'JA1ABC/1'])
      expect(isValidCallsign(c), c).toBe(true);
    for (const c of ['', 'N0CALL', 'NOCALL', 'HELLO', '12345', 'W1', 'W1AWXYZ'])
      expect(isValidCallsign(c), c).toBe(false);
  });

  it('makes url-safe, distinct tickets', () => {
    const a = makeTicket();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(makeTicket()).not.toBe(a);
  });

  it('seals the join key so only the admin key opens it', () => {
    const join = makeJoinKey();
    const admin = makeJoinKey();
    const sealed = sealJoinKey(join, admin);
    expect(JSON.stringify(sealed)).not.toContain(join);
    expect(openJoinKey(sealed, admin)).toBe(join);
    expect(openJoinKey(sealed, admin.toLowerCase())).toBe(join);
    expect(openJoinKey(sealed, join)).toBeNull();
    expect(openJoinKey({ ...sealed, ct: sealed.ct.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) }, admin)).toBeNull();
    expect(openJoinKey(null, admin)).toBeNull();
    expect(sealJoinKey(join, admin).ct).not.toBe(sealed.ct); // fresh salt and iv each time
  });
});
