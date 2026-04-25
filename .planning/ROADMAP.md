# Internal Planning Roadmap

This file tracks internal / backlog items managed via the `/gsd:` workflow.
The customer-facing roadmap lives at [/ROADMAP.md](../ROADMAP.md).

## Milestone: v26.x polish

### Phase 1: Weather load time — reduce time-to-first-weather for DX/DE

**Goal:** Reduce perceived latency for DX/DE weather without breaking Open-Meteo rate-limit safety. Weather already fetches direct browser-to-Open-Meteo (no OHC proxy). Suspected client-side delays: 30s debounce in `src/hooks/useWeather.js:254`, 550ms hover delay in `src/components/CallsignWeatherOverlay.jsx:88`, exponential backoff on 429s (15s→300s in `useWeather.js:173`), and no batching of DE+DX fetches.
**Requirements:** TBD
**Depends on:** —
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 1 to break down)

### Phase 2: DX news multi-source ticker

**Goal:** Expand the DX news ticker from a single source (`dxnews.com`, scraped server-side in `server/routes/dxpeditions.js:282-349`) to 3 sources (dxnews.com + DX-World RSS + NG3K calendar reuse), filter out stale content, dedup by callsign, and rewire the ticker UI for dynamic per-source labels, hover-pause, and click-to-open. Per CONTEXT.md decisions D-01 through D-13.
**Requirements:** D-01, D-02, D-04, D-05, D-07, D-08, D-09, D-10, D-11, D-12, D-13 (CONTEXT.md decision IDs — this project has no REQ-XX taxonomy)
**Depends on:** —
**Plans:** 4 plans

Plans:

- [ ] 02-01-PLAN.md — Foundation: install rss-parser, build pure-function dxNewsMerge module + tests, lift dxnews.com scrape into its own source module + test
- [ ] 02-02-PLAN.md — Two new source fetchers (parallel): DX-World RSS via rss-parser, NG3K via ctx.dxpeditionCache reuse
- [ ] 02-03-PLAN.md — Refactor /api/dxnews route to multi-source aggregator with per-source caches + integration test; remove inline scrape from dxpeditions.js
- [ ] 02-04-PLAN.md — Frontend: rewire DXNewsTicker.jsx for D-07/D-11/D-12/D-13 + component tests + i18n keys

## Backlog

### Phase 999.1: Winlink Express CSV ingestion for EmComm dashboard (BACKLOG)

**Goal:** [Captured for future planning]
**Requirements:** TBD
**Plans:** 0 plans

Origin: suggested by Lor W3QA (Winlink Team) via email 2026-04-24, during the #297 Winlink gateway discussion.

Context captured (verbatim from Lor's message):

> You might consider a high-demand feature for EOCs and other emergency locations. Winlink Express HTML forms are used across the country and in Europe. Many forms have geo-location data embedded from the sending site. Particularly, the Field Situation Report and Damage Assessment forms, are sent from operators in the field to coordination points (typically command posts or EOCs) needing ground-truth information. An EOC running Express and receiving these reports will have a continuously-updated CSV file that is used to update dashboards and group displays. That would be a great application and addition to your EmComm display as well. Unfortunately, no API is supported by the Express client receiving these reports, but the CSV can be set to be continuously available anywhere on a shared or native drive to pull from.

Feature sketch:

- Point OpenHamClock's EmComm dashboard at a watched CSV path (local or network share)
- Parse new rows (Field Situation Report, Damage Assessment, other Express forms)
- Render incident pins on the EmComm map using embedded geo-location data
- Live feed panel of arriving reports with timestamps + originating station
- Field parsing for ICS-213 / Field Sitrep schemas

Dependencies / open questions before planning:

- Mirror Express's CSV schema precisely — loop Lor back in when ready to design
- Watch mechanism — fs.watch on a drive, polling fallback
- Security: the CSV path is a file-system read from user config, not internet data

Not blocking #297 — different data source entirely. Likely slots into a post-WASM EmComm phase.

Plans:

- [ ] TBD (promote with /gsd:review-backlog when ready)
