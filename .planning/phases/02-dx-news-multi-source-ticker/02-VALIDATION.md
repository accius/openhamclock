---
phase: 2
slug: dx-news-multi-source-ticker
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                             |
| ---------------------- | ------------------------------------------------- |
| **Framework**          | Vitest 2.1.8 + jsdom (existing)                   |
| **Config file**        | `vitest.config.js` at repo root                   |
| **Setup file**         | `src/test/setup.js` (currently empty — fine)      |
| **Quick run command**  | `npx vitest run server/utils/dxNewsMerge.test.js` |
| **Full suite command** | `npm run test:run` (`npx vitest run`)             |
| **Coverage command**   | `npm run test:coverage`                           |
| **Estimated runtime**  | ~5 seconds quick, ~30 seconds full                |

Vitest already powers all existing `.test.js` files (e.g. `src/utils/dxClusterFilters.test.js`, `server/utils/dxClusterPathIdentity.test.js`). No new framework needed.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/utils/dxNewsMerge.test.js` (fast, covers the merge pipeline — most phase logic lives here)
- **After every plan wave:** Run `npm run test:run` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green; plus manual smoke test against live `/api/dxnews` in dev (`npm run dev` + `curl http://localhost:5173/api/dxnews | jq '.items | length'` should return a number 1-20).
- **Max feedback latency:** ~5 seconds for quick run; ~30 seconds for full suite.

---

## Per-Task Verification Map

| CONTEXT ID                    | Behavior                                                                                               | Test Type         | Automated Command                                                              | File Exists | Status     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------ | ----------- | ---------- |
| D-01 (3-source merge)         | Merge fetches from 3 sources concurrently; one failure doesn't break others                            | unit (mock fetch) | `npx vitest run server/utils/dxNewsMerge.test.js -t "fault tolerance"`         | ❌ W0       | ⬜ pending |
| D-02 (NG3K activity window)   | NG3K item with endDate in past → filtered; endDate in future → kept                                    | unit              | `npx vitest run server/utils/dxNewsMerge.test.js -t "activity window"`         | ❌ W0       | ⬜ pending |
| D-04 (24h cutoff)             | publish-date 23h ago → kept; 25h ago → dropped                                                         | unit              | `npx vitest run server/utils/dxNewsMerge.test.js -t "freshness 24h"`           | ❌ W0       | ⬜ pending |
| D-05 (NG3K exception)         | NG3K item 2 weeks old publishDate but endDate in future → kept                                         | unit              | `npx vitest run server/utils/dxNewsMerge.test.js -t "ng3k exception"`          | ❌ W0       | ⬜ pending |
| D-07 (hide when empty)        | Ticker renders null when merged items array is empty                                                   | component (RTL)   | `npx vitest run src/components/DXNewsTicker.test.jsx -t "hide when empty"`     | ❌ W0       | ⬜ pending |
| D-08 (callsign de-dup)        | Two items same callsign, different sources → freshest kept                                             | unit              | `npx vitest run server/utils/dxNewsMerge.test.js -t "dedup by callsign"`       | ❌ W0       | ⬜ pending |
| D-08 (no callsign)            | Item with no extractable callsign → kept, no dedup applied                                             | unit              | `npx vitest run server/utils/dxNewsMerge.test.js -t "no callsign passthrough"` | ❌ W0       | ⬜ pending |
| D-09 (recency sort)           | Merged array is sorted by publishDate DESC                                                             | unit              | `npx vitest run server/utils/dxNewsMerge.test.js -t "recency sort"`            | ❌ W0       | ⬜ pending |
| D-10 (20 cap)                 | 50 input items → 20 output items                                                                       | unit              | `npx vitest run server/utils/dxNewsMerge.test.js -t "20 cap"`                  | ❌ W0       | ⬜ pending |
| D-11 (dynamic label)          | As ticker scrolls past items, label reflects source of currently-visible item                          | component         | `npx vitest run src/components/DXNewsTicker.test.jsx -t "dynamic label"`       | ❌ W0       | ⬜ pending |
| D-12 (dynamic link)           | Clicking label opens current source's homepage URL                                                     | component         | `npx vitest run src/components/DXNewsTicker.test.jsx -t "dynamic link"`        | ❌ W0       | ⬜ pending |
| D-13 (hover pause)            | mouseenter on scroll area sets pause-state; mouseleave resumes                                         | component         | `npx vitest run src/components/DXNewsTicker.test.jsx -t "hover pause"`         | ❌ W0       | ⬜ pending |
| D-13 (click navigate)         | Clicking an item opens item.url in new tab (not pause-toggle)                                          | component         | `npx vitest run src/components/DXNewsTicker.test.jsx -t "click navigate"`      | ❌ W0       | ⬜ pending |
| Callsign extraction           | Regex correctness across edge cases (W1AW, 3D2JK, VP8/G3ABC, W1AW/M, false-positive English words)     | unit              | `npx vitest run server/utils/dxNewsMerge.test.js -t "extractCallsign"`         | ❌ W0       | ⬜ pending |
| Per-source fetch (DX-World)   | Given a recorded RSS XML fixture, returns normalized items with correct fields                         | unit (fixture)    | `npx vitest run server/routes/dxNewsSources/dxWorld.test.js`                   | ❌ W0       | ⬜ pending |
| Per-source fetch (dxnews.com) | Given a recorded HTML fixture, returns current shape                                                   | unit (fixture)    | `npx vitest run server/routes/dxNewsSources/dxnews.test.js`                    | ❌ W0       | ⬜ pending |
| Per-source fetch (NG3K)       | Given a populated `ctx.dxpeditionCache`, returns reshaped items with activity-window dates             | unit (mock cache) | `npx vitest run server/routes/dxNewsSources/ng3k.test.js`                      | ❌ W0       | ⬜ pending |
| End-to-end /api/dxnews        | Mocked upstreams → response has ≤20 items, sorted, deduped, all 3 sources represented when all succeed | integration       | `npx vitest run server/routes/dxNewsRoute.test.js`                             | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `server/utils/dxNewsMerge.js` — pure-function merge module (callsign extract, freshness filter, dedup, sort, cap)
- [ ] `server/utils/dxNewsMerge.test.js` — covers D-02, D-04, D-05, D-07, D-08, D-09, D-10, callsign edge cases
- [ ] `server/routes/dxNewsSources/dxnews.js` — existing scrape lifted out of `dxpeditions.js`
- [ ] `server/routes/dxNewsSources/dxnews.test.js` — recorded HTML fixture + parse assertion
- [ ] `server/routes/dxNewsSources/dxWorld.js` — RSS fetcher using `rss-parser@3.13.0`
- [ ] `server/routes/dxNewsSources/dxWorld.test.js` — recorded RSS fixture
- [ ] `server/routes/dxNewsSources/ng3k.js` — reads `ctx.dxpeditionCache`, reshapes to merged-feed item format
- [ ] `server/routes/dxNewsSources/ng3k.test.js` — mock cache fixture + reshape assertion
- [ ] `server/routes/dxNewsRoute.test.js` — integration test with all 3 sources mocked
- [ ] `src/components/DXNewsTicker.test.jsx` — component tests for D-07, D-11, D-12, D-13
- [ ] Fixture dir: `server/utils/__fixtures__/dx-news/` with recorded samples (`dx-world.rss`, `dxnews-homepage.html`, `ng3k-cache.json`)
- [ ] npm install: `rss-parser@3.13.0`

---

## Manual-Only Verifications

| Behavior                  | Why Manual                                                                | Test Instructions                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live ticker visual smoke  | CSS animation timing + dynamic label dwell                                | `npm run dev` → load app → enable DX news layer → confirm ticker scrolls, label changes per source, hover pauses, click opens article in new tab |
| Per-IP rate-limit absence | Open-Meteo / DX-World / dxnews.com don't 429 our server                   | Watch server logs for 30 minutes during normal use; no 429 entries should accumulate                                                             |
| Empty-state hide          | Hard to seed in tests; cleaner to verify by sliding the 24h cutoff in dev | Temporarily set freshness cutoff to 1ms in dev → reload → confirm ticker disappears                                                              |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
