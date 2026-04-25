/**
 * DXNewsTicker component tests — Vitest + jsdom + React 18
 *
 * Proves decisions D-07, D-11, D-12, D-13 from Phase 02 CONTEXT.md.
 * Uses react-dom/client.createRoot + react.act (React 18 idiom) — no @testing-library/react needed.
 *
 * Test names mirror VALIDATION.md per-task verify labels exactly so the -t filter works:
 *   "hide when empty"   → D-07
 *   "dynamic label"     → D-11
 *   "dynamic link"      → D-12
 *   "hover pause"       → D-13
 *   "click navigate"    → D-13
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DXNewsTicker } from './DXNewsTicker.jsx';

// React 18 requires IS_REACT_ACT_ENVIRONMENT for act() to work in test environments.
// Without this, act() is a no-op and state updates don't flush synchronously.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock react-i18next so t() returns the defaultValue or the key (no i18n setup needed in tests)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts && opts.defaultValue) || key,
  }),
}));

// jsdom in this project runs without a URL which means the WebStorage API is unavailable.
// Provide a minimal localStorage stub so DXNewsTicker's isDXNewsEnabled() and textScale
// persistence work correctly during tests.
const localStorageStore = {};
const localStorageMock = {
  getItem: (key) => localStorageStore[key] ?? null,
  setItem: (key, value) => {
    localStorageStore[key] = String(value);
  },
  removeItem: (key) => {
    delete localStorageStore[key];
  },
  clear: () => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Set up fetch mock and mount a fresh DXNewsTicker into a new container.
 * Returns { container, root } for teardown.
 */
function setup(items) {
  localStorageMock.clear();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items, fetched: new Date().toISOString() }),
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

function teardown(container, root) {
  act(() => root.unmount());
  document.body.removeChild(container);
}

/**
 * Factory for a minimal merged-feed item. All required fields present.
 */
function makeItem(overrides = {}) {
  return {
    id: 'i1',
    title: 'Title',
    description: 'Desc',
    url: 'https://example.com/article-1',
    publishDate: '2026-04-24T12:00:00Z',
    callsign: null,
    source: 'DXNEWS',
    sourceUrl: 'https://dxnews.com/',
    ...overrides,
  };
}

/**
 * Render the component and flush the fetch + setState microtask queue.
 * Must be called inside act() for state updates to flush.
 */
async function renderAndFlush(root) {
  root.render(<DXNewsTicker />);
  // Two microtask cycles: fetch resolves → setNews/setLoading state commits
  await Promise.resolve();
  await Promise.resolve();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DXNewsTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── D-07 ─────────────────────────────────────────────────────────────────

  it('hide when empty: returns null when items array is empty (D-07)', async () => {
    const { container, root } = setup([]);
    await act(async () => {
      await renderAndFlush(root);
    });
    // No source label rendered — component returned null (news.length === 0)
    expect(container.querySelector('[data-testid="dxnews-source-label"]')).toBeNull();
    teardown(container, root);
  });

  // ─── D-11 ─────────────────────────────────────────────────────────────────

  it('dynamic label: label reflects the source of the current item (D-11)', async () => {
    const items = [
      makeItem({ id: 'a', source: 'DXNEWS', sourceUrl: 'https://dxnews.com/' }),
      makeItem({ id: 'b', source: 'DX-WORLD', sourceUrl: 'https://dx-world.net/' }),
      makeItem({ id: 'c', source: 'NG3K', sourceUrl: 'https://www.ng3k.com/Misc/adxo.html' }),
    ];
    const { container, root } = setup(items);
    await act(async () => {
      await renderAndFlush(root);
      // Extra cycle so the animDuration useEffect (which depends on news) fires and
      // calls setAnimDuration. In jsdom, scrollWidth=0 so animDuration becomes 20.
      await Promise.resolve();
    });

    // Initial label should be the first item's source
    const label = container.querySelector('[data-testid="dxnews-source-label"]');
    expect(label).not.toBeNull();
    expect(label.getAttribute('data-source')).toBe('DXNEWS');

    // In jsdom, scrollWidth=0 so animDuration = Math.max(20, 0/90) = 20.
    // With 3 items: dwellMs = Math.max(5000, 20000/3) = Math.max(5000, 6667) = 6667ms.
    // Advance 7001ms — guaranteed to fire the interval exactly once, rotating to DX-WORLD.
    await act(async () => {
      vi.advanceTimersByTime(7001);
      await Promise.resolve();
    });

    const after = container.querySelector('[data-testid="dxnews-source-label"]');
    expect(after.getAttribute('data-source')).toBe('DX-WORLD');
    teardown(container, root);
  });

  // ─── D-12 ─────────────────────────────────────────────────────────────────

  it('dynamic link: clicking the label opens the current source homepage in a new tab (D-12)', async () => {
    const items = [makeItem({ source: 'DX-WORLD', sourceUrl: 'https://dx-world.net/' })];
    const { container, root } = setup(items);
    await act(async () => {
      await renderAndFlush(root);
    });
    const label = container.querySelector('[data-testid="dxnews-source-label"]');
    expect(label).not.toBeNull();
    expect(label.getAttribute('href')).toBe('https://dx-world.net/');
    expect(label.getAttribute('target')).toBe('_blank');
    expect(label.getAttribute('rel')).toContain('noopener');
    teardown(container, root);
  });

  // ─── D-13 (hover-pause) ───────────────────────────────────────────────────

  it('hover pause: mouseenter sets hovered=true, mouseleave sets hovered=false (D-13)', async () => {
    const items = [makeItem()];
    const { container, root } = setup(items);
    await act(async () => {
      await renderAndFlush(root);
    });

    const scroll = container.querySelector('[data-testid="dxnews-scroll"]');
    expect(scroll).not.toBeNull();
    // Initially not hovered
    expect(scroll.getAttribute('data-hovered')).toBe('false');

    // React 18 translates onMouseEnter from mouseover events on the element.
    // We call the underlying event handler directly by reading from React's internal
    // fiber. As a simpler and more reliable alternative, we verify the data-hovered
    // attribute by simulating what the handler does: dispatch mouseover to the element
    // (React listens for mouseover on the root container and synthesizes onMouseEnter).
    act(() => {
      scroll.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(scroll.getAttribute('data-hovered')).toBe('true');

    act(() => {
      scroll.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });
    expect(scroll.getAttribute('data-hovered')).toBe('false');
    teardown(container, root);
  });

  // ─── D-13 (click-navigate) ────────────────────────────────────────────────

  it('click navigate: each ticker item is an anchor opening its url in a new tab (D-13)', async () => {
    const items = [
      makeItem({ id: 'a', url: 'https://example.com/aaa' }),
      makeItem({ id: 'b', url: 'https://example.com/bbb' }),
    ];
    const { container, root } = setup(items);
    await act(async () => {
      await renderAndFlush(root);
    });

    const itemAnchors = container.querySelectorAll('[data-testid="dxnews-item"]');
    // Component duplicates items for the seamless infinite-scroll loop → 2 × items.length
    expect(itemAnchors.length).toBe(items.length * 2);

    const first = itemAnchors[0];
    expect(first.tagName).toBe('A');
    expect(first.getAttribute('href')).toBe('https://example.com/aaa');
    expect(first.getAttribute('target')).toBe('_blank');
    expect(first.getAttribute('rel')).toContain('noopener');

    // Scroll container must NOT have an onClick attribute (old pause-toggle is gone)
    const scroll = container.querySelector('[data-testid="dxnews-scroll"]');
    expect(scroll.onclick).toBeNull();
    teardown(container, root);
  });
});
