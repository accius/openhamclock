/**
 * Tests for server/routes/hams-at.js — the per-key alert cache.
 */
import { describe, expect, it, vi } from 'vitest';

const route = require('./hams-at.js');
const { createAlertCache, hashKey, KEY_RE } = route;

describe('createAlertCache', () => {
  it('fetches once per key inside the TTL and shares in-flight requests', async () => {
    let t = 1000;
    const cache = createAlertCache({ ttlMs: 5000, maxKeys: 3, now: () => t });
    const fetchFn = vi.fn(async () => [{ id: 'a' }]);

    const [r1, r2] = await Promise.all([cache.get('k1', fetchFn), cache.get('k1', fetchFn)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(r1.data).toEqual([{ id: 'a' }]);
    expect(r2.data).toBe(r1.data);

    t += 4000;
    await cache.get('k1', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    t += 2000; // past TTL
    await cache.get('k1', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('keeps separate entries per key and evicts the oldest beyond maxKeys', async () => {
    const cache = createAlertCache({ ttlMs: 60000, maxKeys: 2, now: () => 0 });
    const mk = (id) => vi.fn(async () => [{ id }]);
    await cache.get('a', mk('a'));
    await cache.get('b', mk('b'));
    await cache.get('c', mk('c'));
    expect(cache.size()).toBe(2);
    expect(cache._entries.has('a')).toBe(false);
    expect(cache._entries.has('b')).toBe(true);
    expect(cache._entries.has('c')).toBe(true);
  });

  it('serves stale data when the upstream fails, and rethrows when nothing is cached', async () => {
    let t = 0;
    const cache = createAlertCache({ ttlMs: 10, maxKeys: 5, now: () => t });
    await cache.get('k', async () => [{ id: 'x' }]);
    t = 100;
    const r = await cache.get('k', async () => {
      throw new Error('boom');
    });
    expect(r.stale).toBe(true);
    expect(r.data).toEqual([{ id: 'x' }]);

    await expect(
      cache.get('fresh', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(cache._entries.has('fresh')).toBe(false);
  });
});

describe('key handling', () => {
  it('hashes keys so the raw key is never a cache key', () => {
    expect(hashKey('secret')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashKey('secret')).not.toContain('secret');
    expect(hashKey('a')).not.toBe(hashKey('b'));
  });
  it('accepts plausible keys and rejects junk', () => {
    expect(KEY_RE.test('abcdefgh12345678')).toBe(true);
    expect(KEY_RE.test('short')).toBe(false);
    expect(KEY_RE.test('has space in it')).toBe(false);
    expect(KEY_RE.test('x'.repeat(200))).toBe(false);
  });
});
