import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { ServerLightningFeed, cellsAround, MAX_STRIKES } = require('./lightning-feed.js');
const core = require('./lightning-guard-logic.js');

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

const HOME = { lat: 40, lon: -105 };
const at = (km, brg) => core.destinationPoint(HOME.lat, HOME.lon, km, brg);
const msg = (p, t) => ({ data: JSON.stringify({ time: t * 1e6, lat: p.lat, lon: p.lon, pol: -5 }) });

let feed;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
  FakeSocket.instances = [];
  feed = new ServerLightningFeed({ WebSocketImpl: FakeSocket });
  feed.setWatchAreas([{ ...HOME, radiusKm: 50 }]);
});
afterEach(() => {
  feed.setActive(false);
  vi.useRealTimers();
});

describe('ServerLightningFeed', () => {
  it('opens one socket only while active, sends the key, closes when inactive', () => {
    expect(FakeSocket.instances).toHaveLength(0);
    feed.setActive(true);
    feed.setActive(true);
    expect(FakeSocket.instances).toHaveLength(1);
    const ws = FakeSocket.instances[0];
    ws.onopen();
    expect(JSON.parse(ws.sent[0])).toEqual({ a: core.BLITZORTUNG_KEY });
    expect(feed.getStatus()).toMatchObject({ active: true, connected: true });
    feed.setActive(false);
    expect(ws.closed).toBe(true);
    expect(feed.getStatus().connected).toBe(false);
  });

  it('keeps only strikes near watched areas', () => {
    feed.setActive(true);
    const ws = FakeSocket.instances[0];
    ws.onmessage(msg(at(20, 0), Date.now()));
    ws.onmessage(msg({ lat: 51.5, lon: -0.1 }, Date.now())); // London: not watched
    expect(feed.getStatus()).toMatchObject({ received: 2, stored: 1 });
    // Dropping the area forgets its strikes
    feed.setWatchAreas([]);
    expect(feed.getStatus().stored).toBe(0);
  });

  it('matches a report within 5 km and 30 s, nothing else', () => {
    feed.setActive(true);
    const p = at(20, 90);
    const t = Date.now();
    feed.add({ ...p, timestamp: t });
    expect(feed.match({ ...p, timestamp: t + 1000 })).toMatchObject({ timestamp: t });
    const shifted = core.destinationPoint(p.lat, p.lon, 3, 0);
    expect(feed.match({ ...shifted, timestamp: t })).not.toBeNull(); // 3 km off
    const far = core.destinationPoint(p.lat, p.lon, 8, 0);
    expect(feed.match({ ...far, timestamp: t })).toBeNull(); // 8 km off
    expect(feed.match({ ...p, timestamp: t - 60000 })).toBeNull(); // a minute off
  });

  it('verify waits for a strike the server has not seen yet, and gives up', async () => {
    feed.setActive(true);
    const ws = FakeSocket.instances[0];
    const p = at(15, 180);
    const t = Date.now();
    const pending = feed.verify({ ...p, timestamp: t });
    vi.advanceTimersByTime(2000);
    ws.onmessage(msg(p, t));
    await expect(pending).resolves.toMatchObject({ timestamp: t });

    const fake = feed.verify({ ...at(10, 0), timestamp: t });
    vi.advanceTimersByTime(8000);
    await expect(fake).resolves.toBeNull();
  });

  it('verify is null at once while inactive', async () => {
    await expect(feed.verify({ ...at(10, 0), timestamp: Date.now() })).resolves.toBeNull();
  });

  it('reconnects with exponential backoff, rotating servers', () => {
    feed.setActive(true);
    FakeSocket.instances[0].onclose();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toBe(core.BLITZORTUNG_SERVERS[1]);
    FakeSocket.instances[1].onclose();
    vi.advanceTimersByTime(9999);
    expect(FakeSocket.instances).toHaveLength(2); // second wait is 10 s
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
    FakeSocket.instances[2].onopen(); // a good connection resets the backoff
    FakeSocket.instances[2].onclose();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it('is bounded: old strikes expire and the total is capped', () => {
    feed.setActive(true);
    const p = at(5, 0);
    feed.add({ ...p, timestamp: Date.now() });
    vi.advanceTimersByTime(16 * 60 * 1000);
    feed.add({ ...p, timestamp: Date.now() });
    expect(feed.getStatus().stored).toBe(1);
    for (let i = 0; i < MAX_STRIKES + 50; i++) feed.add({ ...p, timestamp: Date.now() + i });
    expect(feed.getStatus().stored).toBe(MAX_STRIKES);
  });

  it('cellsAround covers the radius plus margin, and wraps longitude', () => {
    const cells = cellsAround(40.5, -105.5, 50);
    expect(cells.has('40,74')).toBe(true); // lon -106 → index 74
    const wrap = cellsAround(0, 179.9, 50);
    expect(wrap.has('0,0')).toBe(true); // across the antimeridian
  });
});
