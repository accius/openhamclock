import { describe, expect, it } from 'vitest';
import { Mutex, MutexValue, MutexCounter } from './mutex.js';

describe('Mutex', () => {
  it('should lock and unlock properly', async () => {
    const mutex = new Mutex();
    await mutex.lock();
    expect(mutex.locked).toBe(true);
    await mutex.unlock();
    expect(mutex.locked).toBe(false);
  });

  it('should queue locks properly', async () => {
    const mutex = new Mutex();
    let order = [];

    const func1 = async () => {
      await mutex.lock();
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      order.push(2);
      mutex.unlock();
    };

    const func2 = async () => {
      await mutex.lock();
      order.push(3);
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push(4);
      mutex.unlock();
    };

    await Promise.all([func1(), func2()]);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});

describe('MutexValue', () => {
  it('should update and get value properly', async () => {
    const mutexValue = new MutexValue(0);
    await mutexValue.update(() => 5);
    expect(await mutexValue.get()).toBe(5);
  });
});

describe('MutexCounter', () => {
  it('should increment and get count properly', async () => {
    const counter = new MutexCounter(0);
    await counter.increment();
    await counter.increment();
    expect(await counter.get()).toBe(2);
  });
});
