/**
 * Integration test for the /api/dxnews route in server/routes/dxpeditions.js.
 *
 * Mounts the route module against a minimal stub app and verifies end-to-end
 * behaviour with all 3 source fetchers injected via ctx._dxNewsFetchers:
 *   - all-success: items from all 3 sources merged
 *   - partial failure (one source throws): remaining 2 sources still returned
 *   - total failure: empty items, 200 status (not 500 — cachedFetch absorbs errors)
 *   - 20-cap: > 20 input items → exactly 20 output
 *   - response shape: { items, fetched } preserved for existing client
 *
 * ctx._dxNewsFetchers is a test-only hook in dxpeditions.js that lets tests
 * inject mock fetchers without needing vi.mock to intercept CJS require() chains.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const route = require('./dxpeditions.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal Express-like stub that captures route handlers.
 * Supports app.get(path, handler) — matches what dxpeditions.js registers.
 */
function makeApp() {
  const handlers = {};
  return {
    get: (path, handler) => {
      handlers[`GET ${path}`] = handler;
    },
    handlers,
  };
}

/**
 * Calls a registered route handler and captures the response.
 */
async function callRoute(app, method, path) {
  const handler = app.handlers[`${method} ${path}`];
  if (!handler) throw new Error(`No handler registered for ${method} ${path}`);
  let captured;
  const res = {
    json: (body) => {
      captured = { status: 200, body };
      return res;
    },
    status: (code) => ({
      json: (body) => {
        captured = { status: code, body };
        return res;
      },
    }),
  };
  await handler({}, res);
  return captured;
}

// Build a ctx with injected fetchers for the dxnews route.
// Each test calls route(app, ctx) which creates a fresh sourceCaches Map.
function makeCtx({ fetchDxnewsImpl, fetchDxWorldImpl, fetchNg3kImpl } = {}) {
  return {
    fetch: vi.fn(),
    logDebug: vi.fn(),
    logErrorOnce: vi.fn(),
    _dxNewsFetchers: {
      fetchDxnews: vi.fn(fetchDxnewsImpl || (() => Promise.resolve({ items: [] }))),
      fetchDxWorld: vi.fn(fetchDxWorldImpl || (() => Promise.resolve({ items: [] }))),
      fetchNg3k: vi.fn(fetchNg3kImpl || (() => Promise.resolve({ items: [] }))),
    },
  };
}

// ─── Item factory ─────────────────────────────────────────────────────────────

const BASE_DATE = new Date('2026-04-24T12:00:00Z');

function makeItem(overrides = {}) {
  return {
    id: 'test:1',
    title: 'Test DXpedition',
    description: 'Test description',
    url: 'https://example.com/1',
    publishDate: BASE_DATE.toISOString(),
    callsign: null,
    source: 'DXNEWS',
    sourceUrl: 'https://dxnews.com/',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('/api/dxnews integration', () => {
  // Pin time to BASE_DATE: mergeNews's freshness filter (24h cutoff vs `new Date()`)
  // would otherwise discard the fixture items once wall-clock drifts past the fixture
  // by > 24h, making the suite spuriously fail with the passage of time.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_DATE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns items merged from all 3 sources when all succeed', async () => {
    const ctx = makeCtx({
      fetchDxnewsImpl: () => Promise.resolve({ items: [makeItem({ id: 'd1', source: 'DXNEWS' })] }),
      fetchDxWorldImpl: () => Promise.resolve({ items: [makeItem({ id: 'w1', source: 'DX-WORLD' })] }),
      fetchNg3kImpl: () =>
        Promise.resolve({
          items: [makeItem({ id: 'n1', source: 'NG3K', activityEndDate: '2026-05-01T00:00:00Z' })],
        }),
    });

    const app = makeApp();
    route(app, ctx);

    const result = await callRoute(app, 'GET', '/api/dxnews');
    expect(result.status).toBe(200);
    expect(result.body.items.length).toBe(3);
    expect(result.body.items.map((i) => i.source).sort()).toEqual(['DXNEWS', 'DX-WORLD', 'NG3K'].sort());
    expect(typeof result.body.fetched).toBe('string');
  });

  it('survives one source throwing (returns items from the other two)', async () => {
    const ctx = makeCtx({
      fetchDxnewsImpl: () => Promise.resolve({ items: [makeItem({ id: 'd1', source: 'DXNEWS' })] }),
      fetchDxWorldImpl: () => Promise.reject(new Error('network error')),
      fetchNg3kImpl: () =>
        Promise.resolve({
          items: [makeItem({ id: 'n1', source: 'NG3K', activityEndDate: '2026-05-01T00:00:00Z' })],
        }),
    });

    const app = makeApp();
    route(app, ctx);

    const result = await callRoute(app, 'GET', '/api/dxnews');
    expect(result.status).toBe(200);
    expect(result.body.items.length).toBe(2);
    expect(result.body.items.find((i) => i.source === 'DX-WORLD')).toBeUndefined();
  });

  it('returns 200 with empty items when all sources fail and there is no cache', async () => {
    const ctx = makeCtx({
      fetchDxnewsImpl: () => Promise.reject(new Error('fail')),
      fetchDxWorldImpl: () => Promise.reject(new Error('fail')),
      fetchNg3kImpl: () => Promise.reject(new Error('fail')),
    });

    const app = makeApp();
    route(app, ctx);

    const result = await callRoute(app, 'GET', '/api/dxnews');
    expect(result.status).toBe(200);
    expect(result.body.items).toEqual([]);
  });

  it('caps merged output at 20 items even when sources return many more', async () => {
    const manyItems = Array.from({ length: 30 }, (_, i) =>
      makeItem({
        id: `d${i}`,
        publishDate: new Date(BASE_DATE.getTime() - i * 60_000).toISOString(),
      }),
    );
    const ctx = makeCtx({
      fetchDxnewsImpl: () => Promise.resolve({ items: manyItems }),
      fetchDxWorldImpl: () => Promise.resolve({ items: [] }),
      fetchNg3kImpl: () => Promise.resolve({ items: [] }),
    });

    const app = makeApp();
    route(app, ctx);

    const result = await callRoute(app, 'GET', '/api/dxnews');
    expect(result.body.items.length).toBe(20);
  });

  it('preserves the response shape { items, fetched } that the existing client expects', async () => {
    const ctx = makeCtx();
    const app = makeApp();
    route(app, ctx);

    const result = await callRoute(app, 'GET', '/api/dxnews');
    expect(result.body).toHaveProperty('items');
    expect(result.body).toHaveProperty('fetched');
    expect(Array.isArray(result.body.items)).toBe(true);
  });
});
