---
phase: 02-dx-news-multi-source-ticker
plan: '04'
subsystem: src/components
tags: [dx-news, react, ticker, dynamic-label, hover-pause, click-navigate, vitest, d11, d12, d13, d07]
dependency_graph:
  requires:
    - plan: '02-03'
      provides: '/api/dxnews merged-feed returning { items: [{ source, sourceUrl, url, ... }] }'
  provides:
    - src/components/DXNewsTicker.jsx — rewired to consume merged-feed shape with dynamic D-11 label, D-12 label-link, D-13 hover-pause + click-navigate
    - src/components/DXNewsTicker.test.jsx — 5 component tests covering D-07/D-11/D-12/D-13
  affects:
    - Any UI that renders DXNewsTicker (App.jsx, sidebar layouts)
tech_stack:
  added: []
  patterns:
    - CSS-only :hover animation-play-state for hover-pause — reliable across layout reflows (D-13)
    - React state mirrored for testability alongside CSS-driven behavior (data-hovered attribute)
    - setInterval driven source rotation with min-dwell clamp (max 5000ms, animDuration/count)
    - IS_REACT_ACT_ENVIRONMENT=true + localStorage stub for jsdom component testing without URL
    - mouseover/mouseout events to test React onMouseEnter/onMouseLeave in jsdom
key_files:
  created:
    - src/components/DXNewsTicker.test.jsx
  modified:
    - src/components/DXNewsTicker.jsx
    - src/lang/en.json
key_decisions:
  - 'jsdom scrollWidth=0 → animDuration becomes Math.max(20, 0/90)=20 → dwell=max(5000, 20000/3)=6667ms in tests. Timer-advance tests use 7001ms (1 rotation) rather than 41000ms (6 rotations wrapping back to start) to avoid false-pass on index=0 after wrapping.'
  - 'CSS-only hover-pause via .dxnews-scroll-content:hover { animation-play-state: paused !important } is reliable across layout reflows; React hovered state (data-hovered) mirrors it purely for test observability.'
  - 'React onMouseEnter/onMouseLeave tested via mouseover/mouseout DOM events — React 18 event delegation translates mouseover → synthetic onMouseEnter on the root container.'
  - 'localStorage stub (not jsdom WebStorage) provided inline in test file — jsdom in this project runs without a URL, so WebStorage API is unavailable. Stub provides getItem/setItem/removeItem/clear.'
  - 'Removed paused/setPaused state entirely — click-pause toggle replaced by per-item anchor navigation; hover-pause by CSS. Old animationPlayState: paused ? "paused" : "running" also removed.'
requirements_completed:
  - D-07
  - D-11
  - D-12
  - D-13
metrics:
  duration_seconds: 9377
  completed: '2026-04-25'
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
  tests_added: 5
  test_runtime_ms: 34
---

# Phase 02 Plan 04: DXNewsTicker Rewire — Dynamic Label, Hover-Pause, Click-Navigate

**Dynamic per-source label (D-11), label-to-homepage link (D-12), CSS hover-pause + per-item click-navigate (D-13), and D-07 empty-state hide — all wired to the multi-source merged feed with 5 component tests green.**

---

## Performance

- **Duration:** ~156 min (9377 seconds)
- **Started:** 2026-04-25T01:16:56Z
- **Completed:** 2026-04-25T03:53Z
- **Tasks:** 2 completed
- **Files modified:** 3 (DXNewsTicker.jsx, DXNewsTicker.test.jsx, en.json)

---

## Accomplishments

- `DXNewsTicker.jsx` fully rewired to consume `{ source, sourceUrl, url }` fields from the merged feed
- D-11: `currentSourceIndex` state rotates via `setInterval` at `max(5s, animDuration/count)` dwell — label shows `📰 DXNEWS`, `📰 DX-WORLD`, `📰 NG3K` dynamically
- D-12: source label `<a href={currentSourceUrl} target="_blank">` opens that source's homepage
- D-13: CSS-only `:hover { animation-play-state: paused !important }` — reliable hover-pause with React hovered state mirrored for testability; each ticker item is an `<a href={item.url}>` for click-to-navigate; old click-pause toggle entirely removed
- D-07: empty-state guard preserved — component returns null when merged items array is empty
- 5 Vitest component tests added covering all 4 CONTEXT decisions, full suite green (246/246)

---

## Task Commits

1. **Task 1: Refactor DXNewsTicker.jsx** - `a4991e5` (feat)
2. **Task 2: Add Vitest component tests** - `d4a5f14` (test)

---

## Files Created/Modified

- `src/components/DXNewsTicker.jsx` — Rewired ticker with D-11/D-12/D-13/D-07; removed paused/setPaused state and click-pause toggle; added currentSourceIndex + hovered state; CSS hover-pause injected via style element; per-item anchor elements
- `src/components/DXNewsTicker.test.jsx` — 5 component tests (hide when empty, dynamic label, dynamic link, hover pause, click navigate) with localStorage stub and IS_REACT_ACT_ENVIRONMENT
- `src/lang/en.json` — Added `app.dxNews.openInNewTab` and `app.dxNews.currentSource` keys

---

## Ticker Behavior (Post-Rewire)

The ticker now:

1. Fetches `/api/dxnews` → receives `{ items: [{ title, description, url, source, sourceUrl, ... }] }`
2. Shows `📰 DXNEWS` / `📰 DX-WORLD` / `📰 NG3K` in the orange label as items scroll — the label rotates via a `setInterval` with 5-second minimum dwell
3. Clicking the orange label opens the current source's homepage in a new tab
4. Hovering over the scrolling content pauses the animation (CSS-driven, no JS desync risk)
5. Clicking any news item opens that article's URL in a new tab (not a pause toggle)
6. When `items.length === 0`, the ticker returns null and disappears from screen

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] jsdom localStorage unavailable — added inline stub**

- **Found during:** Task 2, initial test run
- **Issue:** `localStorage.removeItem is not a function` — the project's jsdom environment runs without a URL (`--localstorage-file was provided without a valid path` warning), meaning the WebStorage API is unavailable. The plan's prescribed `setup()` function called `localStorage.removeItem()` directly.
- **Fix:** Added an inline `localStorageMock` object in the test file (`getItem/setItem/removeItem/clear` backed by a plain object) and bound it to `globalThis.localStorage`. No changes to vitest.config.js (attempted adding `environmentOptions.jsdom.url` but it had no effect — the stub approach is cleaner).
- **Files modified:** `src/components/DXNewsTicker.test.jsx`
- **Verification:** Tests run without localStorage errors.
- **Committed in:** `d4a5f14`

**2. [Rule 1 - Bug] Timer advance amount caused false-pass by wrapping index back to 0**

- **Found during:** Task 2, test debugging of `dynamic label` test
- **Issue:** The plan prescribed `vi.advanceTimersByTime(6000)` to advance past a 5-second dwell. In jsdom, `scrollWidth=0` so `animDuration = Math.max(20, 0/90) = 20`. With 3 items: `dwellMs = Math.max(5000, 20000/3) = 6667ms`. Advancing 6000ms didn't fire the interval (too early). The plan's fallback of 41000ms fires 6 rotations, wrapping the index from 0→1→2→0→1→2→0 — landing back on DXNEWS, failing the assertion for DX-WORLD.
- **Fix:** Advance 7001ms — fires exactly once (past 6667ms dwell), rotating to DX-WORLD without wrapping. Added an explanatory comment in the test explaining the jsdom animDuration math.
- **Files modified:** `src/components/DXNewsTicker.test.jsx`
- **Verification:** `dynamic label` test passes.
- **Committed in:** `d4a5f14`

**3. [Rule 1 - Bug] React 18 act() no-op without IS_REACT_ACT_ENVIRONMENT**

- **Found during:** Task 2, initial test run — `hover pause` test was not picking up state changes from event dispatch
- **Issue:** React 18 requires `globalThis.IS_REACT_ACT_ENVIRONMENT = true` to enable `act()` in test environments. Without it, `act()` is silently skipped and state updates don't flush synchronously, causing tests to see stale DOM.
- **Fix:** Added `globalThis.IS_REACT_ACT_ENVIRONMENT = true` at module top level in the test file.
- **Files modified:** `src/components/DXNewsTicker.test.jsx`
- **Verification:** `act()` warning disappears; state updates flush correctly.
- **Committed in:** `d4a5f14`

**4. [Rule 1 - Bug] React onMouseEnter/onMouseLeave not triggered by mouseenter DOM events**

- **Found during:** Task 2, `hover pause` test still failing after IS_REACT_ACT_ENVIRONMENT fix
- **Issue:** React 18 synthesizes `onMouseEnter`/`onMouseLeave` from `mouseover`/`mouseout` DOM events (event delegation to the root container). Dispatching `new MouseEvent('mouseenter', { bubbles: false })` doesn't pass through React's delegation layer.
- **Fix:** Changed test to dispatch `mouseover` (enters element) and `mouseout` (leaves element) with `bubbles: true` — React's delegated listener on the root container synthesizes the `onMouseEnter`/`onMouseLeave` synthetic events from these.
- **Files modified:** `src/components/DXNewsTicker.test.jsx`
- **Verification:** `hover pause` test passes — data-hovered transitions false → true → false correctly.
- **Committed in:** `d4a5f14`

---

**Total deviations:** 4 auto-fixed (1 blocking, 3 bugs)
**Impact on plan:** All 4 auto-fixes were test-infrastructure issues, not component logic changes. The component itself was implemented exactly as planned. The test file required 4 iterations to navigate jsdom + React 18 environment constraints that the plan's prescribed test code didn't account for.

---

## Test Runtime

- `npx vitest run src/components/DXNewsTicker.test.jsx` — **~34ms** (5 tests)
- Individual `-t` filters: each ~25ms (1 test)
- `npm run test:run` (full suite, 246 tests across 15 files) — **~926ms**
- `npx vite build` — **~1.07s** (exits 0)

---

## VALIDATION.md Test Coverage

All required `-t "..."` labels from VALIDATION.md resolve to passing tests:

| VALIDATION.md label | Test                                 | Status |
| ------------------- | ------------------------------------ | ------ |
| `hide when empty`   | D-07 guard returns null when empty   | ✅     |
| `dynamic label`     | data-source rotates after 1 dwell    | ✅     |
| `dynamic link`      | label href/target/\_blank/rel proved | ✅     |
| `hover pause`       | data-hovered true/false on events    | ✅     |
| `click navigate`    | items are `<a>` with correct href    | ✅     |

---

## Phase-Completion Checklist (from PLAN.md must_haves)

1. `/api/dxnews` returns merged items from all 3 sources — verified by Plan 03 integration tests (241 tests)
2. `DXNewsTicker.jsx` renders with dynamic per-source header label — verified by "dynamic label" test
3. Hover pauses scroll; click on item opens its URL in new tab — verified by "hover pause" + "click navigate" tests
4. Ticker hides entirely when merged items array is empty — verified by "hide when empty" test
5. All VALIDATION.md per-task tests green — verified by `npm run test:run` (246/246)
6. Manual `npm run dev` smoke test — not run (live HTTP avoided during plan execution; all behaviors verified by component tests and build pass)
7. `npx vite build` exits 0 — verified

---

## Known Stubs

None. All component behaviors are fully implemented. No placeholder values, hardcoded empty states, or TODO markers in production code paths. The `app.dxNews.currentSource` i18n key is added to `en.json` and used via `t()` fallback in the component.

---

## Self-Check: PASSED

Files verified:

- `src/components/DXNewsTicker.jsx` — FOUND (contains D-11/D-12/D-13/D-07)
- `src/components/DXNewsTicker.test.jsx` — FOUND (5 tests)
- `src/lang/en.json` — FOUND (contains openInNewTab + currentSource keys)

Commits verified:

- `a4991e5` feat(02-04): refactor DXNewsTicker for D-11/D-12/D-13 — FOUND
- `d4a5f14` test(02-04): add Vitest component tests — FOUND

Test suite: 246/246 passing, 0 regressions.
