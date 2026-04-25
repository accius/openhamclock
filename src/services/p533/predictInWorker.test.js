import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { predictInWorker, terminateWorker } from './predictInWorker.js';

// We don't spin up a real Worker in unit tests — that's covered by the
// browser-only smoke path later. Here we validate the message-routing glue:
// each call gets a unique id, resolves/rejects match incoming messages, and
// crashing the worker cleans up pending promises.

class FakeWorker {
  constructor() {
    this.sent = [];
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
  }
  postMessage(msg) {
    this.sent.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    this.onmessage?.({ data });
  }
  crash(message) {
    this.onerror?.({ message });
  }
}

let fake;
beforeEach(() => {
  // Ensure every test starts from a clean singleton state.
  terminateWorker();
  fake = new FakeWorker();
  vi.stubGlobal(
    'Worker',
    vi.fn(function () {
      return fake;
    }),
  );
});

afterEach(() => {
  terminateWorker();
  vi.unstubAllGlobals();
});

describe('predictInWorker', () => {
  it('posts a message with a fresh id + the provided params + wasmUrl', async () => {
    const promise = predictInWorker({ month: 3, hour: 12 }, { wasmUrl: '/custom/p533.mjs' });
    expect(fake.sent).toHaveLength(1);
    const msg = fake.sent[0];
    expect(msg.type).toBe('predict');
    expect(msg.params).toEqual({ month: 3, hour: 12 });
    expect(msg.wasmUrl).toBe('/custom/p533.mjs');
    expect(msg.id).toBeGreaterThan(0);

    // Resolve the pending promise.
    fake.emit({ id: msg.id, type: 'result', data: { engine: 'wasm-p533' } });
    await expect(promise).resolves.toEqual({ engine: 'wasm-p533' });
  });

  it('rejects when the worker replies with type: error', async () => {
    const promise = predictInWorker({ month: 1 }, { wasmUrl: '/w.mjs' });
    const { id } = fake.sent[0];
    fake.emit({ id, type: 'error', message: 'callMain returned 2' });
    await expect(promise).rejects.toThrow(/callMain returned 2/);
  });

  it('assigns unique ids so concurrent callers do not collide', async () => {
    const p1 = predictInWorker({ month: 1 }, { wasmUrl: '/w.mjs' });
    const p2 = predictInWorker({ month: 2 }, { wasmUrl: '/w.mjs' });
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[0].id).not.toBe(fake.sent[1].id);

    // Respond out of order — promises should still route correctly.
    fake.emit({ id: fake.sent[1].id, type: 'result', data: { month: 2 } });
    fake.emit({ id: fake.sent[0].id, type: 'result', data: { month: 1 } });
    await expect(p1).resolves.toEqual({ month: 1 });
    await expect(p2).resolves.toEqual({ month: 2 });
  });

  it('worker onerror fails every pending call and resets the singleton', async () => {
    const p1 = predictInWorker({ month: 1 }, { wasmUrl: '/w.mjs' });
    const p2 = predictInWorker({ month: 2 }, { wasmUrl: '/w.mjs' });
    fake.crash('worker exploded');
    await expect(p1).rejects.toThrow(/worker exploded/);
    await expect(p2).rejects.toThrow(/worker exploded/);

    // Next call should create a FRESH worker (not reuse the crashed one).
    const freshFake = new FakeWorker();
    global.Worker = vi.fn(function () {
      return freshFake;
    });
    const p3 = predictInWorker({ month: 3 }, { wasmUrl: '/w.mjs' });
    expect(freshFake.sent).toHaveLength(1);
    freshFake.emit({ id: freshFake.sent[0].id, type: 'result', data: { month: 3 } });
    await expect(p3).resolves.toEqual({ month: 3 });
  });

  it('terminateWorker rejects pending calls and clears the singleton', async () => {
    const p1 = predictInWorker({ month: 1 }, { wasmUrl: '/w.mjs' });
    terminateWorker();
    expect(fake.terminated).toBe(true);
    await expect(p1).rejects.toThrow(/terminated/);
  });

  it('silently drops responses for ids we no longer care about', () => {
    // Terminate mid-flight, then a stale response arrives.
    const p = predictInWorker({ month: 1 }, { wasmUrl: '/w.mjs' });
    p.catch(() => {}); // swallow rejection from terminate
    const { id } = fake.sent[0];
    terminateWorker();
    expect(() => fake.emit({ id, type: 'result', data: {} })).not.toThrow();
  });
});
