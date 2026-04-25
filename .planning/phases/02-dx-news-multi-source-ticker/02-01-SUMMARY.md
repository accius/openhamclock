---
phase: 02-dx-news-multi-source-ticker
plan: '01'
subsystem: server/utils + server/routes/dxNewsSources
tags: [dx-news, aggregator, merge-pipeline, callsign, freshness, dedup, rss-parser, vitest]
dependency_graph:
  requires: []
  provides:
    - server/utils/dxNewsMerge.js — pure merge pipeline (extractCallsign, isFreshByPublishDate, isFreshByActivityWindow, dedupByCallsign, mergeNews, SOURCE_URLS, CALLSIGN_RE)
    - server/routes/dxNewsSources/dxnews.js — dxnews.com fetcher (parseDxnewsHtml, fetchDxnews)
    - server/utils/__fixtures__/dx-news/dxnews-homepage.html — offline fixture for parse tests
  affects:
    - Plans 02-02 (dxWorld.js + ng3k.js use SOURCE_URLS, CALLSIGN_RE from merge module)
    - Plan 02-03 (route orchestrator imports all source modules + mergeNews)
tech_stack:
  added:
    - rss-parser@3.13.0 (npm)
  patterns:
    - Pure-function merge pipeline with injectable clock (now param) for deterministic testing
    - Fixture-backed parse test using real captured HTML
    - CommonJS module pattern (module.exports = {...}) matching server/ convention
key_files:
  created:
    - server/utils/dxNewsMerge.js
    - server/utils/dxNewsMerge.test.js
    - server/routes/dxNewsSources/dxnews.js
    - server/routes/dxNewsSources/dxnews.test.js
    - server/utils/__fixtures__/dx-news/dxnews-homepage.html
  modified:
    - package.json (rss-parser@^3.13.0 added to dependencies)
    - package-lock.json (lock updated)
decisions:
  - "Extended CALLSIGN_RE from dxpeditions.js:124 to handle digit-prefix ITU callsigns (3D2JK) and slash-portable prefix format (VP8/G3ABC) — original regex only matched the suffix half of VP8/G3ABC and excluded all digit-leading prefixes. New pattern: /\\b((?:[A-Z0-9]+\\/)?\\d?[A-Z]{1,2}\\d[A-Z0-9]*[A-Z](?:\\/[A-Z0-9]+)?)\\b/"
  - 'isFreshByPublishDate boundary: exactly-24h items are KEPT (uses <= not <), items older than 24h are dropped. Documented in test name.'
  - "dxnews.com URLs in fixture are absolute (https://dxnews.com/...) — parseDxnewsHtml checks rawUrl.startsWith('http') and skips base-URL prepending for absolute paths. Production code prepended unconditionally."
  - 'Skip items with no parseable date in parseDxnewsHtml (continue if publishDate is null) — unknown-age items should not appear in a freshness-filtered feed.'
metrics:
  duration_seconds: 349
  completed: '2026-04-25'
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 2
  tests_added: 44
  test_runtime_seconds: 0.31
---

# Phase 02 Plan 01: Foundation — dxNewsMerge module + dxnews.com source fetcher

**One-liner:** Pure-function merge pipeline with full Vitest coverage (D-04/D-05/D-07/D-08/D-09/D-10) plus relocated, normalized dxnews.com HTML scrape with fixture-backed parse test.

---

## Exported Function Signatures

### `server/utils/dxNewsMerge.js`

```javascript
// All exported for use by Plans 02-03 and source fetchers

extractCallsign(text: string | null | undefined): string | null
// Extracts first valid ham callsign from text. Handles digit-prefix (3D2JK),
// slash-portable prefix (VP8/G3ABC), and portable suffix (W1AW/M).
// Returns null for deny-list matches: DXCC, QSL, INFO, SOURCE, THE, AND, FOR, BUT, DAY, ARE, GMT, UTC

isFreshByPublishDate(item: Item, now: Date, hoursCutoff: number = 24): boolean
// Returns true iff now - new Date(item.publishDate) <= hoursCutoff * 3600 * 1000
// Returns false for missing/invalid publishDate. Boundary: exactly 24h is KEPT.

isFreshByActivityWindow(item: Item, now: Date): boolean
// Returns true iff new Date(item.activityEndDate) >= now
// Returns false if activityEndDate is missing or invalid.

dedupByCallsign(items: Item[]): Item[]
// Keeps one item per callsign (freshest publishDate wins).
// Items with callsign === null pass through without dedup.

mergeNews(buckets: { dxnews: Item[], dxWorld: Item[], ng3k: Item[] }, now?: Date): Item[]
// Pipeline: filter dxnews+dxWorld by isFreshByPublishDate; filter ng3k by isFreshByActivityWindow;
// concat; dedupByCallsign; sort DESC by publishDate; slice(0, 20).
// now defaults to new Date() but is ALWAYS injectable for testing.

SOURCE_URLS: { DXNEWS: string, 'DX-WORLD': string, NG3K: string }
// Canonical homepage URLs for D-12 source-label navigation.
// { DXNEWS: 'https://dxnews.com/', 'DX-WORLD': 'https://dx-world.net/', NG3K: 'https://www.ng3k.com/Misc/adxo.html' }

CALLSIGN_RE: RegExp
// Exported for source fetchers. Pattern:
// /\b((?:[A-Z0-9]+\/)?\d?[A-Z]{1,2}\d[A-Z0-9]*[A-Z](?:\/[A-Z0-9]+)?)\b/
```

### `server/routes/dxNewsSources/dxnews.js`

```javascript
parseDxnewsHtml(html: string): Item[]
// Pure function. Parses dxnews.com homepage HTML into normalized items.
// Returns [] for null/empty/garbage input. Caps at 20 items.

fetchDxnews(ctx: { fetch: Function }): Promise<{ items: Item[] }>
// Fetches https://dxnews.com/ via ctx.fetch (server convention) and calls parseDxnewsHtml.
```

---

## Merged-Feed Item Shape

Every source fetcher in this phase (and Plans 02-03) must return items conforming to this shape:

```javascript
{
  id: 'dxnews:https://dxnews.com/4l5a-dxnews/',  // "source:<url>" — stable dedup key
  title: '4L5A DX News',
  description: 'Due to Alexander Teimurazov\'s, 4L5A serious health condition...',
  url: 'https://dxnews.com/4l5a-dxnews/',
  publishDate: '2026-04-11T10:23:26.000Z',         // ISO 8601 UTC; dxnews treats site dates as UTC
  callsign: '4L5A',                                // null if no valid callsign extractable
  source: 'DXNEWS',                                // exactly 'DXNEWS' | 'DX-WORLD' | 'NG3K'
  sourceUrl: 'https://dxnews.com/',               // SOURCE_URLS.DXNEWS
  // activityEndDate: string,                      // NG3K only — ISO 8601 UTC; drives D-02/D-05
}
```

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Extended CALLSIGN_RE to handle digit-prefix and slash-prefix callsigns**

- **Found during:** Task 1, GREEN phase (2 tests failed)
- **Issue:** The production regex at `dxpeditions.js:124` — `\b([A-Z]{1,2}\d[A-Z0-9]*[A-Z](?:\/[A-Z0-9]+)?)\b` — does not match callsigns like `3D2JK` (ITU prefix starts with a digit, not a letter) or `VP8/G3ABC` (the regex matched only `G3ABC`, the suffix after the slash). The plan listed both as required accepts.
- **Fix:** Extended to `\b((?:[A-Z0-9]+\/)?\d?[A-Z]{1,2}\d[A-Z0-9]*[A-Z](?:\/[A-Z0-9]+)?)\b` — optional country-prefix group before the slash, optional leading digit in the core body.
- **Files modified:** `server/utils/dxNewsMerge.js`
- **Commit:** `1f13e27`

**2. [Rule 1 - Bug] Fixed URL doubling in parseDxnewsHtml for absolute-URL sites**

- **Found during:** Task 2, analysis of fixture
- **Issue:** The production code at `dxpeditions.js:332` unconditionally does `'https://dxnews.com/' + urlMatch[1]`. The live site returns absolute URLs (`https://dxnews.com/4l5a-dxnews/`), so this would produce `https://dxnews.com/https://dxnews.com/4l5a-dxnews/`.
- **Fix:** Added `rawUrl.startsWith('http') ? rawUrl : DXNEWS_BASE + '/' + rawUrl` conditional in `parseDxnewsHtml`.
- **Files modified:** `server/routes/dxNewsSources/dxnews.js`
- **Commit:** `f82588e`

**3. [Rule 2 - Missing functionality] Skip items with no parseable date in parseDxnewsHtml**

- **Found during:** Task 2, implementation review
- **Issue:** Items with no extractable date (null publishDate) should not enter the freshness-filtered feed — they have unknown age and `isFreshByPublishDate` would return false for them anyway, but letting them through with a null publishDate would break ISO sort in `mergeNews`.
- **Fix:** Added `if (!publishDate) continue;` in the parse loop.
- **Files modified:** `server/routes/dxNewsSources/dxnews.js`
- **Commit:** `f82588e`

---

## Test Runtime

- `npx vitest run server/utils/dxNewsMerge.test.js` — **~310ms** (36 tests)
- `npx vitest run server/routes/dxNewsSources/dxnews.test.js` — **~315ms** (8 tests)
- `npx vitest run` (full suite, 214 tests across 11 files) — **~520ms**

Sampling-rate implication: per-task quick run is well under 5s. Full-suite gating before Plan 03 integration adds ~0.5s. No bottleneck.

---

## VALIDATION.md Test Coverage

All required `-t "..."` labels from VALIDATION.md resolve to passing tests:

| VALIDATION.md label       | Tests    | Status |
| ------------------------- | -------- | ------ |
| `extractCallsign`         | 16 tests | ✅     |
| `freshness 24h`           | 6 tests  | ✅     |
| `activity window`         | 4 tests  | ✅     |
| `ng3k exception`          | 1 test   | ✅     |
| `dedup by callsign`       | 2 tests  | ✅     |
| `no callsign passthrough` | 1 test   | ✅     |
| `recency sort`            | 1 test   | ✅     |
| `20 cap`                  | 2 tests  | ✅     |
| `fault tolerance`         | 3 tests  | ✅     |

No deviations from VALIDATION.md test names.

---

## Known Stubs

None. All exported functions are fully implemented and verified against live data / fixtures. No placeholder values, hardcoded empty returns, or TODO markers in production code paths.

## Self-Check: PASSED

Files verified:

- `server/utils/dxNewsMerge.js` — FOUND
- `server/utils/dxNewsMerge.test.js` — FOUND
- `server/routes/dxNewsSources/dxnews.js` — FOUND
- `server/routes/dxNewsSources/dxnews.test.js` — FOUND
- `server/utils/__fixtures__/dx-news/dxnews-homepage.html` — FOUND (46KB)

Commits verified:

- `1f13e27` feat(02-01): install rss-parser and build pure-function dxNewsMerge module — FOUND
- `f82588e` feat(02-01): lift dxnews.com scrape into standalone source module with fixture tests — FOUND

Test suite: 214/214 passing, 0 regressions.
