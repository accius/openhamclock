/**
 * useDigitalModes — Vitest + React 18
 *
 * #1279: on a local install the OHC server doesn't proxy /api/{id}/status,
 * so every 5 s poll failed and replaced the state the SSE status events had
 * set — the panel flipped between JS8Call and "No Digital Modes Enabled".
 * Failed polls must keep the previous state, and with a direct Rig Bridge
 * URL the polls and control actions go to the bridge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({ fetch: null }));
vi.mock('../utils/apiFetch', () => ({
  apiFetch: (...args) => api.fetch(...args),
}));

import { useDigitalModes } from './useDigitalModes.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RIG = 'http://localhost:5555';
const realFetch = globalThis.fetch;
let root;
let container;
let latest;

function Harness({ opts }) {
  latest = useDigitalModes(opts);
  return null;
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(opts) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness opts={opts} />);
  });
  await flush();
}

function sseStatus(source, data) {
  act(() => {
    window.dispatchEvent(new CustomEvent('rig-plugin-data', { detail: { event: 'status', source, data } }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

describe('useDigitalModes', () => {
  it('keeps the SSE status when a later poll fails (#1279)', async () => {
    api.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await mount();
    sseStatus('js8call', { dialFrequency: 7078000, mode: 'JS8' });
    expect(latest.statuses.js8call).toMatchObject({ enabled: true, connected: true });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await flush();
    expect(latest.statuses.js8call).toMatchObject({ enabled: true, connected: true, dialFrequency: 7078000 });
    expect(latest.loading).toBe(false);
  });

  it('polls the bridge directly and picks up decodeCount', async () => {
    api.fetch = vi.fn(async () => null);
    globalThis.fetch = vi.fn(async (url) => {
      if (url === `${RIG}/api/js8call/status`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ enabled: true, running: true, connected: true, decodeCount: 42 }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ enabled: false, running: false }) };
    });
    await mount({ rigUrl: RIG });
    expect(latest.statuses.js8call).toMatchObject({ enabled: true, decodeCount: 42 });
    expect(latest.statuses.mshv.enabled).toBe(false);
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('a bridge reporting the plugin off clears SSE leftovers', async () => {
    let on = true;
    api.fetch = vi.fn(async () => null);
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith('/js8call/status') && on
          ? { enabled: true, running: true, connected: true }
          : { enabled: false, running: false },
    }));
    await mount({ rigUrl: RIG });
    expect(latest.statuses.js8call.connected).toBe(true);
    on = false;
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await flush();
    expect(latest.statuses.js8call).toEqual({ enabled: false, running: false, connected: false });
  });

  it('sends control actions to the bridge with the API token', async () => {
    api.fetch = vi.fn(async () => null);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    await mount({ rigUrl: RIG, apiToken: 'secret' });
    let result;
    await act(async () => {
      result = await latest.haltTx('js8call');
    });
    expect(result).toEqual({ success: true });
    const call = globalThis.fetch.mock.calls.find((c) => c[0] === `${RIG}/api/js8call/halt`);
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['X-RigBridge-Token']).toBe('secret');
  });

  it('reports a rejected token clearly', async () => {
    api.fetch = vi.fn(async () => null);
    globalThis.fetch = vi.fn(async (url, opts = {}) =>
      opts.method === 'POST'
        ? { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }
        : { ok: true, status: 200, json: async () => ({ enabled: false }) },
    );
    await mount({ rigUrl: RIG });
    let result;
    await act(async () => {
      result = await latest.sendFreeText('js8call', 'CQ');
    });
    expect(result.error).toMatch(/API token/);
  });
});
