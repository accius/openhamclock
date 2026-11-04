// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { trimQueue, takeBatch, requeue, MAX_QUEUE, MAX_BATCH } from './relay-queue.js';

const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);

describe('trimQueue', () => {
  it('leaves a queue within the limit alone', () => {
    const q = range(0, 3);
    expect(trimQueue(q, 5)).toBe(0);
    expect(q).toEqual([0, 1, 2]);
  });

  it('drops the oldest messages beyond the limit', () => {
    const q = range(0, 8);
    expect(trimQueue(q, 5)).toBe(3);
    expect(q).toEqual([3, 4, 5, 6, 7]);
  });

  it('defaults to MAX_QUEUE', () => {
    const q = range(0, MAX_QUEUE + 10);
    trimQueue(q);
    expect(q.length).toBe(MAX_QUEUE);
    expect(q[0]).toBe(10);
  });
});

describe('takeBatch', () => {
  it('takes the oldest messages up to the limit', () => {
    const q = range(0, 5);
    expect(takeBatch(q, 2)).toEqual([0, 1]);
    expect(q).toEqual([2, 3, 4]);
  });

  it('takes everything from a short queue', () => {
    const q = range(0, 2);
    expect(takeBatch(q, 10)).toEqual([0, 1]);
    expect(q).toEqual([]);
  });

  it('defaults to MAX_BATCH', () => {
    expect(takeBatch(range(0, MAX_BATCH * 3)).length).toBe(MAX_BATCH);
  });
});

describe('requeue', () => {
  it('puts the failed batch ahead of messages queued since', () => {
    const { queue, dropped } = requeue([5, 6], [3, 4], 10);
    expect(queue).toEqual([3, 4, 5, 6]);
    expect(dropped).toBe(0);
  });

  it('keeps the newest messages when the result exceeds the limit', () => {
    const { queue, dropped } = requeue([4, 5, 6], [1, 2, 3], 4);
    expect(queue).toEqual([3, 4, 5, 6]);
    expect(dropped).toBe(2);
  });

  it('handles a batch far larger than the call-stack argument limit', () => {
    const big = range(0, 500_000);
    expect(() => requeue([], big, 600_000)).not.toThrow();
    expect(requeue([], big).queue.length).toBe(MAX_QUEUE);
  });
});
