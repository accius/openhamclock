---
phase: 02-dx-news-multi-source-ticker
plan: '03'
subsystem: server/routes
tags: [dx-news, aggregator, integration, promise.all, cached-fetch, merge-pipeline, vitest, tdd]
dependency_graph:
  requires:
    - server/utils/dxNewsMerge.js (mergeNews — from Plan 02-01)
    - server/routes/dxNewsSources/dxnews.js (fetchDxnews — from Plan 02-01)
    - server/routes/dxNewsSources/dxWorld.js (fetchDxWorld — from Plan 02-02)
    - server/routes/dxNewsSources/ng3k.js (fetchNg3k — from Plan 02-02)
  provides:
    - server/routes/dxpeditions.js — /api/dxnews route now uses Promise.all over 3 source fetchers + mergeNews
    - server/routes/dxNewsRoute.test.js — integration test with 5 scenarios
  affects:
    - Plan 02-04 (client-side ticker rewire reads new merged-feed item shape from this route)
tech_stack:
  added: []
  patterns:
    - Per-source 30-min TTL cache with stale fallback (sourceCaches Map inside factory)
    - ctx._dxNewsFetchers test injection hook — avoids CJS module mock issues in Vitest
    - Promise.all over cachedFetch (cachedFetch absorbs per-source errors, so outer Promise.all never rejects)
    - TDD RED → GREEN cycle for integration test
key_files:
  created:
    - server/routes/dxNewsRoute.test.js
  modified:
    - server/routes/dxpeditions.js
decisions:
  - 'sourceCaches Map placed inside module.exports factory (not at module top level) so each test invocation of route(app, ctx) gets isolated per-source caches with no cross-test contamination'
  - 'ctx._dxNewsFetchers test injection hook added instead of vi.mock — Vitest cannot reliably intercept CJS require() calls in transitive dependencies; dependency injection via ctx is simpler and does not pollute production API'
  - 'Promise.all used (not Promise.allSettled) because cachedFetch already absorbs per-source errors and returns stale-or-empty; the outer Promise.all never rejects, and allSettled would add indirection with no benefit'
metrics:
  duration_seconds: 420
  completed: '2026-04-25'
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 1
  tests_added: 5
  test_runtime_seconds: 0.002
---

# Phase 02 Plan 03: Integration — /api/dxnews multi-source aggregator cutover

**One-liner:** Replaced single-source inline dxnews.com scrape with Promise.all over 3 per-source-cached fetchers + mergeNews pipeline, preserving `{ items, fetched }` API shape.

---

## Final Route Shape

```javascript
// server/routes/dxpeditions.js (relevant section)

const { fetchDxnews } = require('./dxNewsSources/dxnews.js');
const { fetchDxWorld } = require('./dxNewsSources/dxWorld.js');
const { fetchNg3k } = require('./dxNewsSources/ng3k.js');
const { mergeNews } = require('../utils/dxNewsMerge.js');

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce } = ctx;

  const SOURCE_TTL = 30 * 60 * 1000;
  const sourceCaches = new Map();

  async function cachedFetch(name, fetcher) {
    /* stale-fallback per source */
  }

  // ctx.dxpeditionCache = dxpeditionCache;  ← unchanged

  // /api/dxpeditions handler ← untouched

  const _fetchers = ctx._dxNewsFetchers || {};
  const _fetchDxnews = _fetchers.fetchDxnews || fetchDxnews;
  const _fetchDxWorld = _fetchers.fetchDxWorld || fetchDxWorld;
  const _fetchNg3k = _fetchers.fetchNg3k || fetchNg3k;

  app.get('/api/dxnews', async (req, res) => {
    const [dxnews, dxWorld, ng3k] = await Promise.all([
      cachedFetch('dxnews', () => _fetchDxnews(ctx)),
      cachedFetch('dxWorld', () => _fetchDxWorld(ctx)),
      cachedFetch('ng3k', () => _fetchNg3k(ctx)),
    ]);
    const items = mergeNews({ dxnews: dxnews.items, dxWorld: dxWorld.items, ng3k: ng3k.items });
    res.json({ items, fetched: new Date().toISOString() });
  });
};
```

---

## API Shape Preservation

Response shape `{ items: Item[], fetched: ISO }` is unchanged. `DXNewsTicker.jsx:68` reads `data.items` and uses `item.title` + `item.description`. Both fields are present in the merged-feed item shape from all 3 source fetchers. No client changes required until Plan 04.

---

## TDD Deviation: vi.mock → ctx injection

The plan specified using `vi.mock` + CJS `require()` to mock the source fetcher modules. During RED phase, this approach was attempted in 3 variations:

1. `vi.mock` + `require` at module top-level: `fetchDxnews.mockReset is not a function` — mock factory vi.fn() instances not shared with require() result.
2. `vi.hoisted` + `vi.mock` factory + `vi.resetModules` in beforeEach: mock was not intercepting the CJS `require()` calls inside `dxpeditions.js` — live HTTP calls were made (~400ms per test, real DX-World data returned).
3. `vi.doMock` + `vi.resetModules` + dynamic `await import()`: same result — CJS transitive `require()` in `dxpeditions.js` bypassed mock intercept.

**Root cause:** Vitest 2.x mock intercept reliably works for ESM imports but not for CJS transitive `require()` calls when the consuming module is loaded via CJS `require()`. The mock system operates on the module registry used by ESM import resolution, which is a different path than the Node.js CJS `require()` cache.

**Fix (Rule 1 — Bug):** Added `ctx._dxNewsFetchers` optional override object to `dxpeditions.js`. Tests pass `{ fetchDxnews, fetchDxWorld, fetchNg3k }` via `ctx._dxNewsFetchers`; production code falls back to the imported real functions. This is idiomatic dependency injection and adds zero runtime overhead in production (the `||` check is O(1)).

---

## Integration Test Coverage

| Test                                         | Scenario                        | Result                       |
| -------------------------------------------- | ------------------------------- | ---------------------------- |
| `merged from all 3 sources`                  | All succeed, 1 item each        | 3 items, all sources present |
| `survives one source throwing`               | DX-World throws, others succeed | 2 items, no DX-WORLD         |
| `returns 200 with empty items when all fail` | All reject, no cache            | `[]`, status 200             |
| `caps merged output at 20 items`             | 30 dxnews items, others empty   | 20 items                     |
| `response shape { items, fetched }`          | All return empty                | `items` + `fetched` present  |

Test runtime: 2ms (all 5 tests).

---

## Test Runtime

- `npx vitest run server/routes/dxNewsRoute.test.js` — **~2ms** (5 tests)
- `npx vitest run` (full suite, 241 tests across 14 files) — **~890ms**
- No regressions from Waves 1 and 2 (236 → 241 tests, all passing).

---

## Acceptance Criteria Verification

- `grep -E "require\\(['\"]\\./dxNewsSources/dxnews"` matches — PASS
- `grep -E "require\\(['\"]\\./dxNewsSources/dxWorld"` matches — PASS
- `grep -E "require\\(['\"]\\./dxNewsSources/ng3k"` matches — PASS
- `grep -E "require\\(['\"]\\.\\./utils/dxNewsMerge"` matches — PASS
- `grep -E "Promise\\.all\\("` matches — PASS
- `grep -E "mergeNews\\("` matches — PASS
- `grep -E "cachedFetch"` matches — PASS
- `grep -E "ctx\\.dxpeditionCache\\s*=\\s*dxpeditionCache"` matches — PASS
- `! grep -E "let dxNewsCache"` — PASS (old cache removed)
- `! grep -E "DXNEWS_CACHE_TTL"` — PASS (old TTL removed)
- `grep -cE "https://dxnews\\.com" server/routes/dxpeditions.js` returns 0 — PASS
- `grep -cE "articleRegex|blocks\\.split\\(/<h3"` returns 0 — PASS
- `test -f server/routes/dxNewsRoute.test.js` — PASS
- `npx vitest run server/routes/dxNewsRoute.test.js` exits 0 — PASS
- `npm run test:run` exits 0, 241/241 passing — PASS
- `npx vite build` exits 0 — PASS

---

## Smoke Test Note

Live smoke test was not run (no dev server started) to avoid live HTTP traffic during plan execution. All integration test scenarios are covered by the injected-fetcher tests which run offline in <3ms. Plan 04 (DXNewsTicker.jsx rewire) should include a manual smoke test of the live endpoint after the client-side changes are in place.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CJS mock intercept failure — vi.mock → ctx injection**

- **Found during:** TDD RED phase, attempts 1-3
- **Issue:** `vi.mock` with hoisted factory, `vi.doMock` with dynamic import, and `vi.hoisted` all failed to intercept the CJS `require()` calls made by `dxpeditions.js` when loading its source fetcher dependencies. Real HTTP calls were made during tests (~400ms per test).
- **Fix:** Added `ctx._dxNewsFetchers` optional override object to `dxpeditions.js`. Tests inject mock implementations via ctx; production falls back to imported real functions. This required moving the fetcher selection out of the `require()` call sites into closure-captured variables.
- **Files modified:** `server/routes/dxpeditions.js`, `server/routes/dxNewsRoute.test.js`
- **Commit:** `042f401`

**2. [Rule 2 - Missing functionality] sourceCaches Map moved into module.exports factory**

- **Found during:** Initial refactor — realized module-level Map would be shared across test invocations
- **Issue:** Placing `sourceCaches` at module top-level means all tests sharing the same `require('./dxpeditions.js')` instance would share the same cache, causing test contamination (cached data from test 1 serving test 2).
- **Fix:** Moved `SOURCE_TTL`, `sourceCaches`, and `cachedFetch` inside the `module.exports = function(app, ctx)` factory. Each `route(app, ctx)` call creates a fresh Map — isolated per test and matches how the server uses it (called once on boot).
- **Files modified:** `server/routes/dxpeditions.js`
- **Commit:** `042f401`

---

## Known Stubs

None. The route is fully wired. `ctx._dxNewsFetchers` falls back to the real module imports in production — no stub code paths remain active outside tests.

---

## Self-Check: PASSED

Files verified:

- `server/routes/dxpeditions.js` — FOUND, contains Promise.all + cachedFetch + mergeNews, no inline scrape
- `server/routes/dxNewsRoute.test.js` — FOUND (5 tests)

Commits verified:

- `042f401` feat(02-03): refactor /api/dxnews to multi-source aggregator + integration test — FOUND

Test suite: 241/241 passing, 0 regressions.
