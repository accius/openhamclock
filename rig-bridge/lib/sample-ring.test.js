import { describe, it, expect } from 'vitest';
import { MinuteRing } from './sample-ring.js';

const MIN = 60000;

describe('MinuteRing', () => {
  it('keeps one sample per minute (newest wins)', () => {
    const r = new MinuteRing(10);
    expect(r.push({ t: 0, v: 1 })).toBe(true);
    expect(r.push({ t: 10000, v: 2 })).toBe(false);
    expect(r.push({ t: 59999, v: 3 })).toBe(false);
    expect(r.push({ t: MIN, v: 4 })).toBe(true);
    expect(r.toArray().map((s) => s.v)).toEqual([3, 4]);
    expect(r.latest().v).toBe(4);
    expect(r.length).toBe(2);
  });

  it('drops samples older than the capacity window', () => {
    const r = new MinuteRing(3);
    for (let m = 0; m < 6; m++) r.push({ t: m * MIN, v: m });
    expect(r.toArray().map((s) => s.v)).toEqual([3, 4, 5]);
  });

  it('prunes by time, not just by count (gap in samples)', () => {
    const r = new MinuteRing(5);
    r.push({ t: 0, v: 0 });
    r.push({ t: 100 * MIN, v: 1 });
    expect(r.toArray().map((s) => s.v)).toEqual([1]);
  });

  it('ignores out-of-order and malformed samples', () => {
    const r = new MinuteRing(5);
    r.push({ t: 5 * MIN, v: 1 });
    expect(r.push({ t: 2 * MIN, v: 0 })).toBe(false);
    expect(r.push({ v: 9 })).toBe(false);
    expect(r.push(null)).toBe(false);
    expect(r.length).toBe(1);
  });

  it('explicit prune relative to a later now', () => {
    const r = new MinuteRing(2);
    r.push({ t: 0, v: 0 });
    r.prune(10 * MIN);
    expect(r.length).toBe(0);
    expect(r.latest()).toBeNull();
  });
});
