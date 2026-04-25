---
phase: 02-dx-news-multi-source-ticker
verified: 2026-04-24T23:57:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 2: DX News Multi-Source Ticker — Verification Report

**Phase Goal:** Build a multi-source DX news ticker that aggregates dxnews.com (existing scrape), DX-World RSS, and NG3K (from existing dxpedition cache) into a single merged feed served at /api/dxnews. Frontend ticker shows source label per item, allows clicking the label to open the source homepage, hover pauses the ticker, and click on item navigates to the article URL.

**Verified:** 2026-04-24T23:57:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                              | Status   | Evidence                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------- | --- | -------------------------------- |
| 1   | /api/dxnews route uses Promise.all across 3 source fetchers with per-source caches | VERIFIED | dxpeditions.js:310-316 — Promise.all over cachedFetch('dxnews'), cachedFetch('dxWorld'), cachedFetch('ng3k')                                            |
| 2   | mergeNews pipeline applies filter → dedup → sort → cap                             | VERIFIED | dxNewsMerge.js:163-176 — explicit pipeline with isFreshByPublishDate, isFreshByActivityWindow, dedupByCallsign, sort DESC, slice(0,20)                  |
| 3   | DX-World RSS fetcher uses rss-parser                                               | VERIFIED | dxWorld.js:18 — `const Parser = require('rss-parser')` with 10s timeout + User-Agent header                                                             |
| 4   | NG3K fetcher reuses ctx.dxpeditionCache (zero new HTTP)                            | VERIFIED | ng3k.js:66-68 — reads `ctx?.dxpeditionCache?.data` only; no fetch() call present anywhere in file                                                       |
| 5   | DXNewsTicker frontend consumes merged-feed shape, implements D-11/D-12/D-13        | VERIFIED | DXNewsTicker.jsx implements currentSourceIndex rotation (D-11), href={currentSourceUrl} target=\_blank (D-12), CSS hover-pause + per-item anchor (D-13) |
| 6   | Ticker hides entirely when merged items array is empty (D-07)                      | VERIFIED | DXNewsTicker.jsx:142 — `if (!visible                                                                                                                    |     | loading |     | news.length === 0) return null;` |
| 7   | All Vitest tests pass                                                              | VERIFIED | `npm run test:run` — 246/246 tests pass across 15 files, 0 failures, 926ms runtime                                                                      |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact                                                 | Expected                                      | Status   | Details                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `server/utils/dxNewsMerge.js`                            | Pure-function merge pipeline, 5 exported fns  | VERIFIED | Exports extractCallsign, isFreshByPublishDate, isFreshByActivityWindow, dedupByCallsign, mergeNews, SOURCE_URLS, CALLSIGN_RE |
| `server/utils/dxNewsMerge.test.js`                       | Vitest tests for D-04/D-07/D-08/D-09/D-10     | VERIFIED | 36 tests, all VALIDATION.md -t labels present and passing                                                                    |
| `server/routes/dxNewsSources/dxnews.js`                  | dxnews.com fetcher with normalized item shape | VERIFIED | Exports fetchDxnews, parseDxnewsHtml; imports SOURCE_URLS from dxNewsMerge                                                   |
| `server/routes/dxNewsSources/dxnews.test.js`             | Fixture-backed parse test                     | VERIFIED | 8 tests against dxnews-homepage.html fixture                                                                                 |
| `server/routes/dxNewsSources/dxWorld.js`                 | DX-World RSS fetcher using rss-parser         | VERIFIED | Exports fetchDxWorld, parseDxWorldFeed; uses rss-parser with User-Agent                                                      |
| `server/routes/dxNewsSources/dxWorld.test.js`            | Fixture-backed RSS parse test                 | VERIFIED | 9 tests against dx-world.rss fixture                                                                                         |
| `server/routes/dxNewsSources/ng3k.js`                    | NG3K cache reshaper, zero HTTP                | VERIFIED | Exports fetchNg3k, reshapeDxpeditionCache; no fetch() calls; reads ctx.dxpeditionCache                                       |
| `server/routes/dxNewsSources/ng3k.test.js`               | Mock-cache reshape test                       | VERIFIED | 13 tests covering active/upcoming filter, cold-start, description format                                                     |
| `server/routes/dxNewsRoute.test.js`                      | Integration test with all 3 sources mocked    | VERIFIED | 5 tests: all-success, partial failure, total failure, 20-cap, response shape                                                 |
| `src/components/DXNewsTicker.jsx`                        | Refactored ticker with D-07/D-11/D-12/D-13    | VERIFIED | currentSourceIndex rotation, dynamic href/label, CSS hover-pause, per-item anchors, paused state removed                     |
| `src/components/DXNewsTicker.test.jsx`                   | Component tests for D-07/D-11/D-12/D-13       | VERIFIED | 5 tests matching all VALIDATION.md -t labels                                                                                 |
| `server/utils/__fixtures__/dx-news/dx-world.rss`         | Recorded RSS fixture (20KB)                   | VERIFIED | 20KB, live-captured from dx-world.net/feed/                                                                                  |
| `server/utils/__fixtures__/dx-news/dxnews-homepage.html` | Recorded HTML fixture (45KB)                  | VERIFIED | 45KB, live-captured from dxnews.com/                                                                                         |
| `server/utils/__fixtures__/dx-news/ng3k-cache.json`      | NG3K cache fixture (924B)                     | VERIFIED | 3 entries (upcoming/active/past)                                                                                             |
| `src/lang/en.json`                                       | New i18n keys openInNewTab + currentSource    | VERIFIED | Both keys present at lines 27, 30                                                                                            |

---

### Key Link Verification

| From                                     | To                            | Via                                     | Status | Details                                                                         |
| ---------------------------------------- | ----------------------------- | --------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `server/routes/dxpeditions.js`           | `dxNewsSources/dxnews.js`     | require('./dxNewsSources/dxnews.js')    | WIRED  | Line 6 — `const { fetchDxnews } = require('./dxNewsSources/dxnews.js')`         |
| `server/routes/dxpeditions.js`           | `dxNewsSources/dxWorld.js`    | require('./dxNewsSources/dxWorld.js')   | WIRED  | Line 7 — `const { fetchDxWorld } = require('./dxNewsSources/dxWorld.js')`       |
| `server/routes/dxpeditions.js`           | `dxNewsSources/ng3k.js`       | require('./dxNewsSources/ng3k.js')      | WIRED  | Line 8 — `const { fetchNg3k } = require('./dxNewsSources/ng3k.js')`             |
| `server/routes/dxpeditions.js`           | `server/utils/dxNewsMerge.js` | require('../utils/dxNewsMerge')         | WIRED  | Line 9 — `const { mergeNews } = require('../utils/dxNewsMerge.js')`             |
| `server/routes/dxNewsSources/dxWorld.js` | `rss-parser`                  | require('rss-parser')                   | WIRED  | Line 18 — `const Parser = require('rss-parser')`                                |
| `server/routes/dxNewsSources/ng3k.js`    | `ctx.dxpeditionCache`         | ctx.dxpeditionCache.data.dxpeditions    | WIRED  | Line 67 — `const cacheData = ctx?.dxpeditionCache?.data`                        |
| `src/components/DXNewsTicker.jsx`        | `/api/dxnews`                 | fetch('/api/dxnews') reading data.items | WIRED  | Line 76 — `const res = await fetch('/api/dxnews')` with `data.items` read at 79 |
| `src/components/DXNewsTicker.test.jsx`   | `DXNewsTicker.jsx`            | import { DXNewsTicker }                 | WIRED  | Line 19 — `import { DXNewsTicker } from './DXNewsTicker.jsx'`                   |

---

### Requirements Coverage

| Decision ID | Description                                             | Status    | Evidence                                                                                                |
| ----------- | ------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| D-04        | 24h freshness cutoff for publish-date sources           | SATISFIED | isFreshByPublishDate in dxNewsMerge.js; 6 passing "freshness 24h" tests                                 |
| D-07        | Hide ticker entirely when no fresh items remain         | SATISFIED | DXNewsTicker.jsx:142 returns null; "hide when empty" test passing                                       |
| D-08        | De-dup by extracted DXpedition callsign                 | SATISFIED | dedupByCallsign in dxNewsMerge.js; 3 passing dedup tests                                                |
| D-09        | Recency-sorted, source-agnostic, newest first           | SATISFIED | mergeNews sorts DESC by publishDate; "recency sort" test passing                                        |
| D-10        | 20-item total cap                                       | SATISFIED | mergeNews slices to 20; "20 cap" test + integration cap test passing                                    |
| D-11        | Dynamic section-header label reflecting current source  | SATISFIED | currentSourceIndex state + setInterval in DXNewsTicker.jsx; "dynamic label" test passing                |
| D-12        | Header link follows current source                      | SATISFIED | href={currentSourceUrl} target=\_blank on label element; "dynamic link" test passing                    |
| D-13        | Hover pauses scroll; click on item opens URL in new tab | SATISFIED | CSS :hover rule + onMouseEnter/Leave + per-item anchors; "hover pause" + "click navigate" tests passing |

Note: D-01 (3-source list), D-02 (NG3K activity window), D-05 (NG3K exception to 24h rule) are implemented and tested but not listed as top-level plan requirements — all covered transitively by the merge module tests ("activity window", "ng3k exception", "fault tolerance").

---

### Anti-Patterns Found

None. Scan of all phase-modified files found:

- No TODO/FIXME/PLACEHOLDER/XXX markers in any production code path
- No stub patterns (return null, return {}, return [], empty handlers)
- No hardcoded empty data that flows to user-visible output
- Old `paused`/`setPaused` state confirmed removed from DXNewsTicker.jsx (grep found zero matches)
- Old inline scrape confirmed removed from dxpeditions.js (grep for `let dxNewsCache`, `DXNEWS_CACHE_TTL`, `articleRegex`, `blocks.split.*h3` returned zero matches)
- Old dxnews.com URL in dxpeditions.js: `grep -c "https://dxnews\.com" dxpeditions.js` returns 0 — URL now lives only in the source module

---

### Human Verification Required

| Test                                   | What to Do                                                                                         | Expected                                                                                                                                  | Why Human                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Live ticker visual smoke               | `npm run dev` → load app → enable DX News layer                                                    | Ticker scrolls, label rotates among DXNEWS/DX-WORLD/NG3K, hover pauses, click opens article in new tab, click label opens source homepage | CSS animation timing and real-time label rotation dwell cannot be verified by automated tests |
| Empty-state hide under real 24h cutoff | Let the server run during a quiet news period, or temporarily lower freshness cutoff to 1ms in dev | Ticker disappears from screen                                                                                                             | Seeding a truly empty response from live sources is not testable offline                      |

These are observability checks, not blockers. All automated checks passed.

---

### Notable Implementation Decisions (Deviations from Plan)

The following deviations were discovered and fixed during execution. None affect correctness at the time of verification.

1. **CALLSIGN_RE extended** — Plan referenced the production regex at dxpeditions.js:124. The extended regex in dxNewsMerge.js correctly handles digit-prefix ITU callsigns (3D2JK) and slash-prefix format (VP8/G3ABC) that the original regex missed. 16 passing extractCallsign tests confirm this.

2. **ctx.\_dxNewsFetchers injection hook** — vi.mock cannot intercept CJS transitive require() in Vitest 2.x. The route uses dependency injection via ctx.\_dxNewsFetchers for tests; production falls through to the real imports. This is the correct pattern for the project's CJS server module.

3. **sourceCaches Map inside factory** — Placed inside module.exports = function(app, ctx) to give each test invocation an isolated cache. Correct decision; avoids test contamination.

4. **i18n file is src/lang/en.json** — Plan referenced public/locales/en/translation.json, but the project uses src/lang/en.json. Keys were added to the correct file.

---

## Summary

Phase 2 goal fully achieved. The `/api/dxnews` route aggregates 3 sources (dxnews.com, DX-World RSS, NG3K) via Promise.all with per-source caches and stale-fallback isolation. The merge pipeline (filter → dedup → sort → cap) is implemented as pure functions with exhaustive test coverage. The DXNewsTicker frontend consumes the merged-feed shape with all four user-facing decisions (D-07/D-11/D-12/D-13) implemented and test-verified. The full Vitest suite is green at 246/246. All artifacts exist, are substantive, and are wired.

---

_Verified: 2026-04-24T23:57:00Z_
_Verifier: Claude (gsd-verifier)_
