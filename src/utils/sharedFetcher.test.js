import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribe, peek, refreshIfStale, _resetSharedFetcher } from './sharedFetcher.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe('sharedFetcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetSharedFetcher();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches once for two subscribers and shares the result', async () => {
    const fetchImpl = vi.fn(async () => ok({ n: 1 }));
    const a = vi.fn();
    const b = vi.fn();
    const unA = subscribe('/api/x', 60000, a, { fetchImpl });
    const unB = subscribe('/api/x', 60000, b, { fetchImpl });
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ data: { n: 1 }, error: null }));
    expect(b).toHaveBeenCalledWith(expect.objectContaining({ data: { n: 1 } }));
    expect(peek('/api/x').data).toEqual({ n: 1 });
    unA();
    unB();
  });

  it('hands late subscribers the cached value immediately', async () => {
    const fetchImpl = vi.fn(async () => ok({ n: 2 }));
    const un1 = subscribe('/api/y', 60000, () => {}, { fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    const late = vi.fn();
    const un2 = subscribe('/api/y', 60000, late, { fetchImpl });
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ data: { n: 2 } }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    un1();
    un2();
  });

  it('reports errors without clobbering the last good data', async () => {
    let fail = false;
    const fetchImpl = vi.fn(async () => (fail ? { ok: false, status: 502 } : ok({ n: 3 })));
    const cb = vi.fn();
    const un = subscribe('/api/z', 1000, cb, { fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    refreshIfStale('/api/z', 0);
    await vi.advanceTimersByTimeAsync(0);
    const last = cb.mock.calls[cb.mock.calls.length - 1][0];
    expect(last.error).toBe('HTTP 502');
    expect(last.data).toEqual({ n: 3 });
    un();
  });

  it('stops polling when the last subscriber leaves', async () => {
    const fetchImpl = vi.fn(async () => ok({}));
    const un = subscribe('/api/w', 1000, () => {}, { fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    un();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
