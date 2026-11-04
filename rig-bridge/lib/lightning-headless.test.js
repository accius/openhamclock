import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { HeadlessLightningGuard } = require('./lightning-headless.js');
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

const DE = { lat: 45, lon: 7 };
const strikeMsg = (km, brg, t) => {
  const p = core.destinationPoint(DE.lat, DE.lon, km, brg);
  return { data: JSON.stringify({ time: t * 1e6, lat: p.lat, lon: p.lon, pol: -10 }) };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
  FakeSocket.instances = [];
});
afterEach(() => vi.useRealTimers());

describe('HeadlessLightningGuard', () => {
  it('connects, parses Blitzortung messages and reports level + relay', () => {
    const seen = [];
    const g = new HeadlessLightningGuard({
      settings: { lat: DE.lat, lon: DE.lon, relayOn: 'alarm' },
      WebSocketImpl: FakeSocket,
      onStatus: (st, ev) => seen.push({ level: st.level, relay: st.relay, ...ev }),
    });
    g.start();
    const ws = FakeSocket.instances[0];
    expect(ws.url).toBe(core.BLITZORTUNG_SERVERS[0]);
    ws.onopen();
    expect(JSON.parse(ws.sent[0])).toEqual({ a: core.BLITZORTUNG_KEY });
    expect(g.getStatus()).toMatchObject({ running: true, watching: true, connected: true, level: 'clear' });

    ws.onmessage(strikeMsg(40, 0, Date.now()));
    vi.advanceTimersByTime(1000);
    expect(seen.at(-1)).toMatchObject({ level: 'warn', relay: false, transition: 'escalate' });
    ws.onmessage(strikeMsg(12, 90, Date.now()));
    vi.advanceTimersByTime(1000);
    expect(seen.at(-1)).toMatchObject({ level: 'alarm', relay: true });
    expect(g.getStatus().nearest).toBe('12 km E');
    g.stop();
    expect(ws.closed).toBe(true);
  });

  it('relayOn "warn" engages already at the warning; reconnects after a drop', () => {
    const g = new HeadlessLightningGuard({
      settings: { lat: DE.lat, lon: DE.lon, relayOn: 'warn' },
      WebSocketImpl: FakeSocket,
      onStatus: () => {},
    });
    g.start();
    expect(g.injectStrike({ distanceKm: 40, bearingDeg: 0 })).toMatchObject({ simulated: true });
    expect(g.getStatus()).toMatchObject({ level: 'warn', relay: true });
    FakeSocket.instances[0].onclose();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(2);
    g.stop();
  });

  it('without a location it does not connect and stays clear', () => {
    const g = new HeadlessLightningGuard({ settings: {}, WebSocketImpl: FakeSocket, onStatus: () => {} });
    g.start();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(g.getStatus()).toMatchObject({ watching: false, level: 'clear', relay: false });
    expect(g.injectStrike({ distanceKm: 5 })).toBeNull();
    g.stop();
  });
});
