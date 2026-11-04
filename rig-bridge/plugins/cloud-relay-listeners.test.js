/**
 * Cloud relay — plugin-bus listeners are removed on disconnect, so
 * reconnecting (a settings save, a restart of the integration) never piles
 * up duplicate subscriptions or duplicate pushes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';
import relay from './cloud-relay.js';

const EVENTS = ['decode', 'aprs', 'meshcom', 'hamalert', 'fldigi', 'fldigi-rx', 'nbems-form', 'fldigi-cmd-result'];
const counts = (bus) => Object.fromEntries(EVENTS.map((e) => [e, bus.listenerCount(e)]));
const zero = Object.fromEntries(EVENTS.map((e) => [e, 0]));
const one = Object.fromEntries(EVENTS.map((e) => [e, 1]));

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const config = () => ({
  // Port 9 (discard) on loopback: requests fail fast, nothing is listening
  cloudRelay: { url: 'http://127.0.0.1:9', apiKey: 'k', session: 's1', pushInterval: 60000 },
});

describe('cloud relay listeners', () => {
  it('a new instance per restart (what the registry does) leaves exactly one set', () => {
    const bus = new EventEmitter();
    const changeListeners = new Set();
    const services = {
      state: {},
      pluginBus: bus,
      onStateChange: (fn) => changeListeners.add(fn),
      removeStateChangeListener: (fn) => changeListeners.delete(fn),
    };
    let inst = null;
    for (let i = 0; i < 5; i++) {
      if (inst) inst.disconnect();
      inst = relay.create(config(), services);
      inst.connect();
      expect(counts(bus)).toEqual(one);
      expect(changeListeners.size).toBe(1);
    }
    inst.disconnect();
    expect(counts(bus)).toEqual(zero);
    expect(changeListeners.size).toBe(0);
  });

  it('the same instance can disconnect and connect again, and connect twice is a no-op', () => {
    const bus = new EventEmitter();
    const inst = relay.create(config(), { state: {}, pluginBus: bus });
    for (let i = 0; i < 5; i++) {
      inst.connect();
      inst.connect();
      expect(counts(bus)).toEqual(one);
      inst.disconnect();
      expect(counts(bus)).toEqual(zero);
    }
  });
});
