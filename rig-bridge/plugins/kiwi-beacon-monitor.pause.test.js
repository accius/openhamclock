// @vitest-environment node
/**
 * Beacon monitor pause/resume — the receiver slot is handed to the Decoder
 * panel's KiwiSDR audio and taken back afterwards (one Kiwi slot in total).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import plugin from './kiwi-beacon-monitor.js';
import { encodeMsgFrame } from '../lib/kiwi-protocol.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await wait(10);
  }
};

function startMockKiwi() {
  const wss = new WebSocketServer({ port: 0 });
  const mock = { wss, sockets: new Set(), opened: 0 };
  wss.on('connection', (ws) => {
    mock.opened++;
    mock.sockets.add(ws);
    ws.on('close', () => mock.sockets.delete(ws));
    ws.on('message', (data) => {
      const text = data.toString();
      if (text.startsWith('SET auth')) {
        ws.send(encodeMsgFrame({ badp: 0 }));
        ws.send(encodeMsgFrame({ audio_rate: 12000 }));
      } else if (text.startsWith('SET AR OK')) ws.send(encodeMsgFrame({ sample_rate: '12000' }));
    });
  });
  return new Promise((resolve) =>
    wss.on('listening', () => resolve(Object.assign(mock, { port: wss.address().port }))),
  );
}

describe('kiwi-beacon-monitor pause/resume', () => {
  let mock;
  let inst;
  afterEach(async () => {
    if (inst) inst.disconnect();
    inst = null;
    if (mock) {
      for (const s of mock.sockets) s.terminate();
      await new Promise((r) => mock.wss.close(r));
    }
    mock = null;
  });

  it('releases the receiver slot while paused and reconnects on resume', async () => {
    mock = await startMockKiwi();
    inst = plugin.create(
      { beaconMonitor: { enabled: true, host: '127.0.0.1', port: mock.port, serverForward: false } },
      {},
    );
    expect(inst.pause('test')).toBe(false); // not running yet
    inst.connect();
    expect(plugin.getActive()).toBe(inst);
    await until(() => inst.getStatus().connected);
    expect(inst.pause('Decoder panel is listening')).toBe(true);
    expect(inst.getStatus().paused).toMatchObject({ reason: 'Decoder panel is listening' });
    await until(() => mock.sockets.size === 0);
    expect(inst.pause('again')).toBe(false); // already paused
    expect(inst.resume()).toBe(true);
    await until(() => inst.getStatus().connected);
    expect(inst.getStatus().paused).toBeNull();
    expect(mock.opened).toBe(2);
  });
});
