// @vitest-environment node
/**
 * Cloud relay — KiwiSDR audio commands. kiwiAudioStart opens a receiver, so
 * Rig Bridge only accepts it with a valid end-to-end signature: never
 * unsigned, and (unlike setFreq/setMode) not during the unsigned grace
 * period either. A fake KiwiConnection stands in for the receiver.
 */
import { describe, it, expect, afterEach } from 'vitest';
import EventEmitter from 'events';
import relay from './cloud-relay.js';
import kiwiAudio from './kiwi-audio.js';
import signLib from '../lib/relay-sign.js';

const KEY = 'd'.repeat(64);
const signed = (cmd, key = KEY) => ({ ...cmd, auth: signLib.signCommand(key, 's1', cmd.type, cmd.payload) });
const START = { type: 'kiwiAudioStart', payload: { freqKHz: 7030, mode: 'cw' } };

class FakeKiwi extends EventEmitter {
  constructor(opts) {
    super();
    FakeKiwi.last = this;
    this.tuning = opts.tuning;
    this.connected = false;
  }
  connect() {
    this.connecting = true;
  }
  tune() {
    return true;
  }
  close() {
    this.closed = true;
  }
}

let insts = [];
afterEach(() => {
  for (const i of insts.splice(0)) i.disconnect();
  FakeKiwi.last = null;
});

function setup(cloudRelay) {
  const kiwi = kiwiAudio.create(
    { kiwiAudio: { enabled: true, host: '127.0.0.1', port: 1 } },
    { KiwiConnection: FakeKiwi, beaconMonitor: null },
  );
  kiwi.connect();
  const inst = relay.create(
    {
      cloudRelay: {
        url: 'http://127.0.0.1:9', // never contacted: we do not call connect()
        apiKey: 'k',
        session: 's1',
        relayAudio: true,
        ...cloudRelay,
      },
    },
    { state: {}, pluginBus: new EventEmitter(), kiwiAudio: kiwi },
  );
  insts.push(inst, kiwi);
  return { inst, kiwi };
}

describe('cloud relay — KiwiSDR audio commands', () => {
  it('starts the Kiwi for a correctly signed kiwiAudioStart (tuned for a 600 Hz CW pitch)', () => {
    const { inst, kiwi } = setup({ commandKey: KEY });
    inst._executeCommand(signed(START));
    expect(kiwi.getStatus().streaming).toBe(true);
    expect(FakeKiwi.last.tuning).toMatchObject({ freqKHz: 7029.4, mode: 'cw' });
    expect(inst.getStatus().audio.active).toBe(true);
  });

  it('refuses an unsigned or forged kiwiAudioStart on a paired bridge', () => {
    const { inst, kiwi } = setup({ commandKey: KEY });
    inst._executeCommand({ ...START });
    const forged = signed(START);
    forged.payload = { freqKHz: 14025, mode: 'cw' };
    inst._executeCommand(forged);
    inst._executeCommand(signed(START, 'e'.repeat(64))); // someone else's key
    expect(kiwi.getStatus().streaming).toBe(false);
    expect(FakeKiwi.last).toBeNull();
    expect(inst.getStatus().refusedCommands).toBe(3);
  });

  it('refuses an unsigned kiwiAudioStart on an unpaired bridge — no grace period, unlike tuning', () => {
    const { inst, kiwi } = setup({ unsignedGraceUntil: '2099-01-01' });
    inst._executeCommand({ ...START });
    expect(kiwi.getStatus().streaming).toBe(false);
    expect(inst.getStatus().refusedCommands).toBe(1);
  });

  it('does nothing with relayAudio off, even when signed', () => {
    const { inst, kiwi } = setup({ commandKey: KEY, relayAudio: false });
    inst._executeCommand(signed(START));
    expect(kiwi.getStatus().streaming).toBe(false);
    expect(inst.getStatus().audio).toEqual({ enabled: false });
  });

  it('retunes and stops only with signed commands', () => {
    const { inst, kiwi } = setup({ commandKey: KEY });
    inst._executeCommand(signed(START));
    inst._executeCommand({ type: 'kiwiAudioStop' }); // unsigned stop: refused
    expect(kiwi.getStatus().streaming).toBe(true);
    inst._executeCommand(signed({ type: 'kiwiAudioStop' }));
    expect(kiwi.getStatus().streaming).toBe(false);
    expect(FakeKiwi.last.closed).toBe(true);
  });
});
