import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BLITZORTUNG_SERVERS,
  _resetFeedForTests,
  getFeedStatus,
  injectStrike,
  lzwDecode,
  parseStrikeMessage,
  subscribeStrikes,
} from './lightningFeed.js';

class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeSocket.instances.push(this);
  }
  send(m) {
    this.sent.push(m);
  }
  close() {
    this.closed = true;
  }
}

const realWebSocket = globalThis.WebSocket;
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  globalThis.WebSocket = FakeSocket;
  _resetFeedForTests();
});
afterEach(() => {
  _resetFeedForTests();
  globalThis.WebSocket = realWebSocket;
  vi.useRealTimers();
});

describe('parsing', () => {
  it('lzwDecode passes plain text through', () => {
    expect(lzwDecode('{"a":1}')).toBe('{"a":1}');
  });
  it('turns a Blitzortung message into a strike', () => {
    const s = parseStrikeMessage({ time: 1_700_000_000_000_000_000, lat: 40.1, lon: -105.2, pol: -12, alt: 0, mds: 5 });
    expect(s).toMatchObject({
      lat: 40.1,
      lon: -105.2,
      intensity: 12,
      polarity: 'negative',
      timestamp: 1_700_000_000_000,
    });
    expect(parseStrikeMessage({ lat: 1, lon: 2 })).toBeNull();
    expect(parseStrikeMessage({ time: 1, lat: 'x', lon: 2 })).toBeNull();
  });
});

describe('shared socket', () => {
  it('opens one socket for many subscribers and closes after the last', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ua = subscribeStrikes(a);
    const ub = subscribeStrikes(b);
    expect(FakeSocket.instances).toHaveLength(1);
    const ws = FakeSocket.instances[0];
    expect(ws.url).toBe(BLITZORTUNG_SERVERS[0]);
    ws.onopen();
    expect(JSON.parse(ws.sent[0])).toEqual({ a: 111 });
    expect(getFeedStatus()).toMatchObject({ connected: true, subscribers: 2 });

    ws.onmessage({ data: JSON.stringify({ time: 1e18, lat: 10, lon: 20, pol: 5 }) });
    ws.onmessage({ data: JSON.stringify({ time: 2e18, lat: 11, lon: 21, pol: 5 }) });
    expect(a).not.toHaveBeenCalled(); // batched
    vi.advanceTimersByTime(1000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toHaveLength(2);
    expect(b.mock.calls[0][0]).toHaveLength(2);

    ua();
    expect(ws.closed).toBe(false);
    ub();
    expect(ws.closed).toBe(true);
    expect(getFeedStatus().subscribers).toBe(0);
  });

  it('reconnects after a drop and rotates servers after repeated failures', () => {
    subscribeStrikes(() => {});
    for (let i = 0; i < 3; i++) {
      const ws = FakeSocket.instances.at(-1);
      ws.onclose();
      vi.advanceTimersByTime(5000);
    }
    expect(FakeSocket.instances).toHaveLength(4);
    expect(FakeSocket.instances[3].url).toBe(BLITZORTUNG_SERVERS[1]);
  });

  it('injectStrike reaches every subscriber at once, socket or not', () => {
    const a = vi.fn();
    subscribeStrikes(a);
    const s = injectStrike({ lat: 1, lon: 2 });
    expect(s.simulated).toBe(true);
    expect(a).toHaveBeenCalledWith([s]);
    expect(injectStrike({ lat: 'x', lon: 2 })).toBeNull();
  });
});
