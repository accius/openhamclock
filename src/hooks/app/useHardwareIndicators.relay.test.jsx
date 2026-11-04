/**
 * useHardwareIndicators over the Cloud Relay: a lightning-relay report is
 * acknowledged only when Rig Bridge answers that it applied it — not when the
 * server merely queued the command, not on a refusal, not on a timeout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../utils/relaySession.js', () => ({
  isRelayConfigured: () => true,
  getRelaySessionId: () => 'sess0000000001',
}));

import useHardwareIndicators, { RELAY_ACK_TIMEOUT_MS } from './useHardwareIndicators.js';

let container;
let root;
let fetchMock;
let onAck;

function Probe({ relay }) {
  useHardwareIndicators({
    satellites: [],
    rigConfig: { enabled: true, host: 'http://localhost', port: 5555 },
    lightning: { level: 'clear', relay, allClearMin: 30, override: 'auto' },
    onLightningAck: onAck,
  });
  return null;
}

const sentCommands = () =>
  fetchMock.mock.calls
    .filter(([u]) => String(u).startsWith('/api/rig-bridge/relay/command'))
    .map(([, o]) => JSON.parse(o.body));

const emit = (event, data) =>
  act(() => {
    window.dispatchEvent(
      new CustomEvent('rig-plugin-data', { detail: { type: 'plugin', event, source: 'cloud-relay', data } }),
    );
  });

async function mountAndPush(relay = false) {
  act(() => root.render(<Probe relay={relay} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100); // change debounce → first push
  });
  const cmds = sentCommands();
  expect(cmds.length).toBe(1);
  return cmds[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  onAck = vi.fn();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('relayed lightning-relay acknowledgement', () => {
  it('a queued command alone is not acknowledged; the bridge’s result is', async () => {
    const cmd = await mountAndPush(false);
    expect(cmd).toMatchObject({ type: 'indicators', payload: { lightningRelay: false } });
    expect(cmd.payload.requestId).toMatch(/^ind-/);
    expect(onAck).not.toHaveBeenCalled(); // server said OK — not enough
    emit('relay-cmd-result', { requestId: 'someone-else', ok: true });
    await act(async () => {});
    expect(onAck).not.toHaveBeenCalled();
    emit('relay-cmd-result', { requestId: cmd.payload.requestId, type: 'indicators', ok: true, status: 200 });
    await act(async () => {});
    expect(onAck).toHaveBeenCalledWith(false);
  });

  it('a refusal is not acknowledged', async () => {
    const cmd = await mountAndPush(false);
    emit('relay-cmd-refused', { requestId: cmd.payload.requestId, type: 'indicators', reason: 'bad-signature' });
    await act(async () => {});
    expect(onAck).not.toHaveBeenCalled();
  });

  it('a failed apply on the bridge is not acknowledged', async () => {
    const cmd = await mountAndPush(true);
    emit('relay-cmd-result', { requestId: cmd.payload.requestId, type: 'indicators', ok: false, status: 429 });
    await act(async () => {});
    expect(onAck).not.toHaveBeenCalled();
  });

  it('no answer within the timeout is not acknowledged', async () => {
    const cmd = await mountAndPush(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELAY_ACK_TIMEOUT_MS + 10);
    });
    emit('relay-cmd-result', { requestId: cmd.payload.requestId, ok: true }); // too late
    await act(async () => {});
    expect(onAck).not.toHaveBeenCalled();
  });

  it('without a lightning report nothing waits and no requestId is sent', async () => {
    act(() =>
      root.render(
        (() => {
          function NoRelay() {
            useHardwareIndicators({
              satellites: [],
              rigConfig: { enabled: true },
              lightning: undefined,
              onLightningAck: onAck,
            });
            return null;
          }
          return <NoRelay />;
        })(),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const [cmd] = sentCommands();
    expect(cmd.payload.requestId).toBeUndefined();
  });
});
