/**
 * useVOACAPHeatmap — Vitest + React 18
 *
 * The data fetch runs without a map, so the hook is rendered with map = null
 * and a stubbed fetch: a successful response must land in `data` without the
 * fetch path throwing (it used to call an undefined setLastFetch).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { useLayer } from './useVOACAPHeatmap.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let result;

function Harness() {
  result = useLayer({ map: null, enabled: true, opacity: 0.6, locator: 'KO11eg' });
  return null;
}

const heatmap = { mode: 'SSB', power: 100, cells: [], solarData: { sfi: 150, kIndex: 2 } };

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => heatmap });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('useVOACAPHeatmap data fetch', () => {
  it('stores a successful response without logging a fetch error', async () => {
    await act(async () => root.render(<Harness />));

    // The second argument carries an AbortSignal (the latest request wins).
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/propagation/heatmap?deLat=52&deLon=23'),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(result.data).toEqual(heatmap);
    expect(result.loading).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });
});
