/**
 * useWinlink — Vitest + React 18
 *
 * The panel shows "Loading..." while `loading` is true. It must clear when
 * /api/winlink/status fails (404/5xx) or apiFetch returns null (shared 429
 * backoff) — not only on success — or the Winlink panel never leaves
 * "Loading...".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({ fetch: null }));
vi.mock('../utils/apiFetch', () => ({
  apiFetch: (...args) => api.fetch(...args),
}));

import { useWinlink } from './useWinlink.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let latest;

function Harness({ opts }) {
  latest = useWinlink(opts);
  return null;
}

async function mount(opts) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness opts={opts} />);
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

describe('useWinlink loading state', () => {
  it('stops loading when the status endpoint returns an error', async () => {
    api.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await mount();
    expect(latest.loading).toBe(false);
    expect(latest.status).toEqual({ enabled: false, running: false });
  });

  it('stops loading when apiFetch is backed off (returns null)', async () => {
    api.fetch = vi.fn(async () => null);
    await mount();
    expect(latest.loading).toBe(false);
  });

  it('stores the status and stops loading on success', async () => {
    api.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true, running: true, patEnabled: false }),
    }));
    await mount();
    expect(latest.loading).toBe(false);
    expect(latest.status).toMatchObject({ enabled: true, running: true });
  });
});

// #1281: on a local install the Pat routes live only on Rig Bridge — the
// OHC server's /api/winlink/status has no patEnabled, so the Pat tabs never
// appeared. With a direct bridge URL every Pat call goes to the bridge.
describe('useWinlink with a direct Rig Bridge', () => {
  const RIG = 'http://localhost:5555';

  function bridge() {
    return vi.fn(async (url, opts = {}) => {
      if (url === `${RIG}/api/winlink/status`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ enabled: true, running: true, patEnabled: true, patReachable: true }),
        };
      }
      if (url === `${RIG}/winlink/inbox`) return { ok: true, status: 200, json: async () => [{ id: 'in1' }] };
      if (url === `${RIG}/winlink/outbox`) return { ok: true, status: 200, json: async () => [] };
      if (url === `${RIG}/winlink/compose`) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      if (url.startsWith(`${RIG}/winlink/gateways`)) {
        return { ok: true, status: 200, json: async () => ({ gateways: [{ callsign: 'W1AW-10' }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}), opts };
    });
  }

  it('reads Pat status and mail from the bridge, not the server', async () => {
    api.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ apiKeyConfigured: true }) }));
    globalThis.fetch = bridge();
    await mount({ rigUrl: RIG });
    expect(latest.status).toMatchObject({ patEnabled: true, patReachable: true });
    expect(latest.inbox).toEqual([{ id: 'in1' }]);
    const urls = api.fetch.mock.calls.map((c) => c[0]);
    expect(urls).not.toContain('/api/winlink/status');
    expect(urls).not.toContain('/winlink/inbox');
  });

  it('sends compose to the bridge with the API token', async () => {
    api.fetch = vi.fn(async () => null);
    globalThis.fetch = bridge();
    await mount({ rigUrl: RIG, apiToken: 'secret' });
    let result;
    await act(async () => {
      result = await latest.compose({ to: 'N0CALL', subject: 'test', body: 'hi' });
    });
    expect(result).toEqual({ ok: true });
    const call = globalThis.fetch.mock.calls.find((c) => c[0] === `${RIG}/winlink/compose`);
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['X-RigBridge-Token']).toBe('secret');
    // status polls stay header-free (no CORS preflight every 10 s)
    const statusCall = globalThis.fetch.mock.calls.find((c) => c[0] === `${RIG}/api/winlink/status`);
    expect(statusCall[1].headers['X-RigBridge-Token']).toBeUndefined();
  });

  it('falls back to the bridge gateway list when the server has no route', async () => {
    api.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    globalThis.fetch = bridge();
    await mount({ rigUrl: RIG });
    let list;
    await act(async () => {
      list = await latest.searchGateways('FN31', '500');
    });
    expect(list).toEqual([{ callsign: 'W1AW-10' }]);
    expect(api.fetch.mock.calls.map((c) => c[0])).toContain('/api/winlink/gateways?grid=FN31&range=500');
  });
});
