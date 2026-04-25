---
phase: 02-dx-news-multi-source-ticker
plan: '02'
subsystem: server/routes/dxNewsSources + server/utils/__fixtures__/dx-news
tags: [dx-news, rss-parser, dx-world, ng3k, fetcher, fixture, vitest, tdd]
dependency_graph:
  requires:
    - server/utils/dxNewsMerge.js (extractCallsign, SOURCE_URLS — from Plan 02-01)
    - rss-parser@3.13.0 (installed in Plan 02-01)
  provides:
    - server/routes/dxNewsSources/dxWorld.js — DX-World RSS fetcher (parseDxWorldFeed, fetchDxWorld)
    - server/routes/dxNewsSources/ng3k.js — NG3K cache reshaper (reshapeDxpeditionCache, fetchNg3k)
    - server/utils/__fixtures__/dx-news/dx-world.rss — 20-item live RSS fixture
    - server/utils/__fixtures__/dx-news/ng3k-cache.json — 3-entry cache fixture (upcoming/active/past)
  affects:
    - Plan 02-03 (route orchestrator imports fetchDxWorld + fetchNg3k alongside fetchDxnews)
tech_stack:
  added: []
  patterns:
    - rss-parser.parseString() in tests for fixture-backed RSS parse without live HTTP
    - ctx.dxpeditionCache reuse pattern — zero-HTTP NG3K source by piggybacking existing route cache
    - TDD RED → GREEN → REFACTOR per-task cycle using Vitest
key_files:
  created:
    - server/routes/dxNewsSources/dxWorld.js
    - server/routes/dxNewsSources/dxWorld.test.js
    - server/routes/dxNewsSources/ng3k.js
    - server/routes/dxNewsSources/ng3k.test.js
    - server/utils/__fixtures__/dx-news/dx-world.rss
    - server/utils/__fixtures__/dx-news/ng3k-cache.json
  modified: []
decisions:
  - 'DX-World feed URL uses redirect — curl -L follows https://dx-world.net/feed/ → https://www.dx-world.net/feed/; rss-parser also follows redirects so the production code can keep using the shorter URL'
  - 'NG3K cold-start returns [] without triggering any HTTP warm-up (RESEARCH Pitfall 3 recommendation A: accept one empty frame, avoid coupling)'
  - 'parseDxWorldFeed title-first callsign extraction matches RESEARCH Pitfall 2 guidance — DX-World puts callsign at position 0 in every title, making extraction trivial and high-signal'
metrics:
  duration_seconds: 178
  completed: '2026-04-25'
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 0
  tests_added: 22
  test_runtime_seconds: 0.02
---

# Phase 02 Plan 02: DX-World RSS Fetcher + NG3K Cache Reshaper

**One-liner:** DX-World RSS fetcher via rss-parser with 20-item live fixture, plus zero-HTTP NG3K reshaper piggybacking the existing ctx.dxpeditionCache from /api/dxpeditions.

---

## Exported Function Signatures

### `server/routes/dxNewsSources/dxWorld.js`

```javascript
parseDxWorldFeed(feed: object | null): Item[]
// Pure function. Accepts an rss-parser feed object ({ items: [...] }) and returns
// normalized merged-feed items. Filters out items with unparseable pubDate.
// Returns [] for null feed or feed with no items.

fetchDxWorld(ctx?: object): Promise<{ items: Item[] }>
// Calls parser.parseURL('https://dx-world.net/feed/') with 10s timeout +
// OpenHamClock User-Agent, then delegates to parseDxWorldFeed.
```

### `server/routes/dxNewsSources/ng3k.js`

```javascript
reshapeDxpeditionCache(cacheData: { dxpeditions: Array } | null | undefined): Item[]
// Pure function. Filters isActive||isUpcoming entries from the dxpeditionCache.data
// object, reshapes each entry into a merged-feed item with activityEndDate for D-02.
// Returns [] for null/undefined/missing-dxpeditions input (cold-start safe).

fetchNg3k(ctx?: object): Promise<{ items: Item[] }>
// Reads ctx?.dxpeditionCache?.data and delegates to reshapeDxpeditionCache.
// Zero HTTP calls — pure cache reuse.
```

---

## Merged-Feed Item Shapes

### DX-World item

```javascript
{
  id: 'dxworld:https://www.dx-world.net/?p=12345',  // guid preferred, link fallback
  title: 'HF0PAS – South Shetland Islands',
  description: 'Plain text body up to 200 chars...',
  url: 'https://www.dx-world.net/hf0pas/',
  publishDate: '2026-04-24T16:17:05.000Z',          // from RFC 822 pubDate → ISO UTC
  callsign: 'HF0PAS',                               // extracted from title (pos 0)
  source: 'DX-WORLD',
  sourceUrl: 'https://dx-world.net/',               // SOURCE_URLS['DX-WORLD']
}
```

### NG3K item

```javascript
{
  id: 'ng3k:3D2JK',
  title: '3D2JK — Yasawa Is.',
  description: 'May 5-15, 2026 · 160-10m · CW SSB FT8',
  url: 'https://www.ng3k.com/Misc/adxo.html',
  publishDate: '2026-05-05T00:00:00.000Z',          // = startDate (D-09 sort ordering)
  activityEndDate: '2026-05-15T00:00:00.000Z',      // drives D-02/D-05 in mergeNews
  callsign: '3D2JK',
  source: 'NG3K',
  sourceUrl: 'https://www.ng3k.com/Misc/adxo.html',
}
```

---

## Fixture File Paths

For Plan 03 integration tests and any future fixture reuse:

- `server/utils/__fixtures__/dx-news/dx-world.rss` — 20-item RSS 2.0 snapshot from https://www.dx-world.net/feed/, captured 2026-04-25. Load with `rss-parser.parseString(xml)` in tests.
- `server/utils/__fixtures__/dx-news/ng3k-cache.json` — 3-entry cache shape: 3D2JK (upcoming), TX9W (active), K4OLD (past). Load with `JSON.parse(readFileSync(...))` in tests. The past entry is intentional — tests verify it is dropped.

---

## NG3K HTTP Work Confirmation

`fetchNg3k` makes **zero HTTP calls**. It only reads `ctx?.dxpeditionCache?.data`. The cache is populated asynchronously by `GET /api/dxpeditions` (server/routes/dxpeditions.js:14). This means:

- Merged route worst-case latency = max(fetchDxnews, fetchDxWorld) only
- NG3K cold-start returns `[]` gracefully — mergeNews still works with other sources
- No NG3K parser to maintain or drift from the existing /api/dxpeditions parser

---

## Test Runtime

- `npx vitest run server/routes/dxNewsSources/dxWorld.test.js` — **~14ms** (9 tests)
- `npx vitest run server/routes/dxNewsSources/ng3k.test.js` — **~2ms** (13 tests)
- `npx vitest run server/routes/dxNewsSources/` — **~21ms** (30 tests across 3 source modules)
- `npx vitest run` (full suite, 236 tests across 13 files) — **~580ms**

---

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written. The live fixture capture followed the 301 redirect to https://www.dx-world.net/feed/ (curl -L flag). rss-parser follows redirects internally so the production fetchDxWorld can keep using the undirected URL.

---

## Known Stubs

None. Both fetchers are fully implemented and verified against fixtures. No placeholder values, hardcoded empty returns, or TODO markers in production code paths.

---

## Self-Check: PASSED

Files verified:

- `server/routes/dxNewsSources/dxWorld.js` — FOUND
- `server/routes/dxNewsSources/dxWorld.test.js` — FOUND
- `server/routes/dxNewsSources/ng3k.js` — FOUND
- `server/routes/dxNewsSources/ng3k.test.js` — FOUND
- `server/utils/__fixtures__/dx-news/dx-world.rss` — FOUND (20KB, 20 items)
- `server/utils/__fixtures__/dx-news/ng3k-cache.json` — FOUND

Commits verified:

- `4c47e0e` feat(02-02): build DX-World RSS fetcher with rss-parser and fixture-backed tests
- `cc8cc4c` feat(02-02): build NG3K fetcher reusing ctx.dxpeditionCache (zero new HTTP)

Test suite: 236/236 passing, 0 regressions.
