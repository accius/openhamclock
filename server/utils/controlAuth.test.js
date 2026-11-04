import { describe, it, expect } from 'vitest';
import {
  isValidControlSecret,
  hashSecret,
  safeEqual,
  secretMatches,
  extractClientToken,
  extractDisplaySecret,
  authorizeControl,
  authorizeDisplay,
} from './controlAuth.js';

const SECRET = 'abcdefghijklmnopqrstuvwxyz234567';
const OTHER = 'zyxwvutsrqponmlkjihgfedcba765432';
const MASTER = 'testkey';
const HASH = hashSecret(SECRET);

describe('secrets', () => {
  it('validates url-safe secrets of 24..128 chars', () => {
    expect(isValidControlSecret(SECRET)).toBe(true);
    expect(isValidControlSecret('a'.repeat(24))).toBe(true);
    expect(isValidControlSecret('a'.repeat(23))).toBe(false);
    expect(isValidControlSecret('a'.repeat(129))).toBe(false);
    expect(isValidControlSecret('has space'.padEnd(30, 'x'))).toBe(false);
    expect(isValidControlSecret(null)).toBe(false);
  });

  it('hashes deterministically and compares in constant time', () => {
    expect(hashSecret(SECRET)).toBe(HASH);
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual(SECRET, SECRET)).toBe(true);
    expect(safeEqual(SECRET, OTHER)).toBe(false);
    expect(safeEqual(SECRET, SECRET + 'x')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(SECRET, undefined)).toBe(false);
    expect(secretMatches(SECRET, HASH)).toBe(true);
    expect(secretMatches(OTHER, HASH)).toBe(false);
    expect(secretMatches(SECRET, null)).toBe(false);
    expect(secretMatches('', HASH)).toBe(false);
  });
});

describe('token extraction', () => {
  it('client: Bearer header, X-Control-Secret, ?key=', () => {
    expect(extractClientToken({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
    expect(extractClientToken({ headers: { authorization: 'bearer  abc ' } })).toBe('abc');
    expect(extractClientToken({ headers: { 'x-control-secret': 'xyz' } })).toBe('xyz');
    expect(extractClientToken({ headers: {}, query: { key: 'q' } })).toBe('q');
    expect(extractClientToken({ headers: { authorization: 'Basic abc' }, query: { key: 'q' } })).toBe('q');
    expect(extractClientToken({ headers: {}, query: { key: ['a', 'b'] } })).toBe('');
    expect(extractClientToken({})).toBe('');
  });

  it('display: body.secret, ?secret=, X-Control-Secret', () => {
    expect(extractDisplaySecret({ body: { secret: 's1' } })).toBe('s1');
    expect(extractDisplaySecret({ query: { secret: 's2' } })).toBe('s2');
    expect(extractDisplaySecret({ headers: { 'x-control-secret': 's3' } })).toBe('s3');
    expect(extractDisplaySecret({ body: { secret: 42 } })).toBe('');
    expect(extractDisplaySecret({})).toBe('');
  });
});

describe('authorizeControl', () => {
  it('global key is a master key for any target and for broadcast', () => {
    expect(authorizeControl({ token: MASTER, apiWriteKey: MASTER, target: 'ohc-aaaaaaaa', secretHash: HASH })).toEqual({
      ok: true,
      via: 'master',
    });
    expect(authorizeControl({ token: MASTER, apiWriteKey: MASTER, target: 'ohc-aaaaaaaa', secretHash: null })).toEqual({
      ok: true,
      via: 'master',
    });
    expect(authorizeControl({ token: MASTER, apiWriteKey: MASTER, target: null })).toEqual({ ok: true, via: 'master' });
  });

  it('pairing secret opens its own display even when a global key is set', () => {
    expect(authorizeControl({ token: SECRET, apiWriteKey: MASTER, target: 'ohc-aaaaaaaa', secretHash: HASH })).toEqual({
      ok: true,
      via: 'pairing',
    });
  });

  it('wrong secret is refused (403), missing token is 401', () => {
    const wrong = authorizeControl({ token: OTHER, apiWriteKey: MASTER, target: 'ohc-aaaaaaaa', secretHash: HASH });
    expect(wrong.ok).toBe(false);
    expect(wrong.status).toBe(403);
    const none = authorizeControl({ token: '', apiWriteKey: MASTER, target: 'ohc-aaaaaaaa', secretHash: HASH });
    expect(none.ok).toBe(false);
    expect(none.status).toBe(401);
  });

  it('unregistered display: only the master key works while a key is set', () => {
    const r = authorizeControl({ token: SECRET, apiWriteKey: MASTER, target: 'ohc-aaaaaaaa', secretHash: null });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/not paired/);
  });

  it('broadcast keeps the global rule: key when set, open when unset', () => {
    const noKey = authorizeControl({ token: '', apiWriteKey: MASTER, target: null });
    expect(noKey.ok).toBe(false);
    expect(noKey.status).toBe(401);
    // A pairing secret never authorizes a broadcast.
    const withSecret = authorizeControl({ token: SECRET, apiWriteKey: MASTER, target: null, secretHash: HASH });
    expect(withSecret.ok).toBe(false);
    expect(withSecret.status).toBe(403);
    expect(authorizeControl({ token: '', apiWriteKey: '', target: null })).toEqual({ ok: true, via: 'open' });
  });

  it('server without API_WRITE_KEY stays open, but still names pairing when it matches', () => {
    expect(authorizeControl({ token: '', apiWriteKey: '', target: 'ohc-aaaaaaaa', secretHash: HASH })).toEqual({
      ok: true,
      via: 'open',
    });
    expect(authorizeControl({ token: SECRET, apiWriteKey: '', target: 'ohc-aaaaaaaa', secretHash: HASH })).toEqual({
      ok: true,
      via: 'pairing',
    });
  });
});

describe('authorizeDisplay', () => {
  it('first valid secret claims an unpaired display', () => {
    expect(authorizeDisplay({ secret: SECRET, secretHash: null })).toEqual({ ok: true, claim: HASH });
  });

  it('an unpaired display without a secret is accepted but claims nothing', () => {
    expect(authorizeDisplay({ secret: '', secretHash: null })).toEqual({ ok: true, claim: null });
  });

  it('rejects a malformed secret on first registration', () => {
    const r = authorizeDisplay({ secret: 'short', secretHash: null });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('paired display: same secret ok, other or missing secret → 403', () => {
    expect(authorizeDisplay({ secret: SECRET, secretHash: HASH })).toEqual({ ok: true, claim: null });
    expect(authorizeDisplay({ secret: OTHER, secretHash: HASH })).toMatchObject({ ok: false, status: 403 });
    expect(authorizeDisplay({ secret: '', secretHash: HASH })).toMatchObject({ ok: false, status: 403 });
  });
});
