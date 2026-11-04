import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tryLease, releaseLease, withOutboxLock, LEASE_KEY, LEASE_MS } from './outboxLock.js';

describe('outbox lock', () => {
  beforeEach(() => localStorage.clear());

  it('lease: one holder at a time; expires; owner can renew and release', () => {
    expect(tryLease(localStorage, 'tab-a', 1000)).toBe(true);
    expect(tryLease(localStorage, 'tab-b', 1000)).toBe(false);
    expect(tryLease(localStorage, 'tab-a', 2000)).toBe(true); // renew
    expect(tryLease(localStorage, 'tab-b', 2000 + LEASE_MS + 1)).toBe(true); // holder gone quiet
    releaseLease(localStorage, 'tab-a'); // not the holder any more: no effect
    expect(JSON.parse(localStorage.getItem(LEASE_KEY)).owner).toBe('tab-b');
    releaseLease(localStorage, 'tab-b');
    expect(localStorage.getItem(LEASE_KEY)).toBeNull();
  });

  it('lease fallback: a second tab cannot flush while the first is flushing', async () => {
    let inside = 0;
    let maxInside = 0;
    let release;
    const gate = new Promise((r) => (release = r));
    const flush = async () => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      await gate;
      inside--;
    };
    const a = withOutboxLock(flush, { storage: localStorage, owner: 'a' });
    const b = await withOutboxLock(flush, { storage: localStorage, owner: 'b' });
    expect(b).toBe(false);
    release();
    expect(await a).toBe(true);
    expect(maxInside).toBe(1);
    expect(await withOutboxLock(flush, { storage: localStorage, owner: 'b' })).toBe(true); // free again
  });

  it('uses navigator.locks when present, skipping when the lock is taken', async () => {
    const held = new Set();
    const locks = {
      request: async (name, opts, cb) => {
        if (held.has(name)) return cb(null);
        held.add(name);
        try {
          return await cb({ name });
        } finally {
          held.delete(name);
        }
      },
    };
    let release;
    const gate = new Promise((r) => (release = r));
    const a = withOutboxLock(() => gate, { locks });
    expect(await withOutboxLock(async () => {}, { locks })).toBe(false);
    release();
    expect(await a).toBe(true);
  });

  it('lease fallback: a send slower than the lease keeps it (heartbeat), and frees it when done or failed', async () => {
    vi.useFakeTimers();
    try {
      let finish;
      const slow = withOutboxLock(() => new Promise((r) => (finish = r)), {
        storage: localStorage,
        owner: 'a',
        now: () => Date.now(),
      });
      // 40 s into a send: well past the 15 s lease, another tab still can't take it.
      await vi.advanceTimersByTimeAsync(40_000);
      expect(tryLease(localStorage, 'b', Date.now())).toBe(false);
      finish();
      expect(await slow).toBe(true);
      expect(localStorage.getItem(LEASE_KEY)).toBeNull(); // released on completion
      // a failing send releases too
      await expect(
        withOutboxLock(() => Promise.reject(new Error('network')), { storage: localStorage, owner: 'a' }),
      ).rejects.toThrow('network');
      expect(localStorage.getItem(LEASE_KEY)).toBeNull();
      // and the heartbeat stops: nothing re-takes the lease afterwards
      await vi.advanceTimersByTimeAsync(20_000);
      expect(localStorage.getItem(LEASE_KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
