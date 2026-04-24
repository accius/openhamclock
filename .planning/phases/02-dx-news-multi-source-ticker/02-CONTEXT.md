# Phase 2: DX news multi-source ticker — Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Expand the DX news ticker from a single source to four, filter out stale content, and surface source attribution as the ticker rotates. Server-side aggregation in `server/routes/dxpeditions.js` (existing `/api/dxnews` route) and client-side rendering in `src/components/DXNewsTicker.jsx`.

Server-proxied stays — HTML scraping plus mixed-format feeds rule out client-side fetching (CORS, parser complexity, per-user load duplication).

**In scope:** add 3 new sources, per-source freshness filtering, callsign-based de-duplication, recency-sorted merging, dynamic section-header label, hover-to-pause + click-to-open UX.

**Out of scope:** redesigning the ticker visual style, settings UI to enable/disable specific sources, changing the 30-min server cache TTL, real-time spot/announcement feeds (RBN-style), translating the ticker chrome.

</domain>

<decisions>
## Implementation Decisions

### Source list

- **D-01:** Aggregate **4 sources**:
  - **dxnews.com** (existing) — keep current HTML scrape in `server/routes/dxpeditions.js:288-339`. Single-item daily news.
  - **DX-World** (`dx-world.net`) — RSS feed preferred (cleaner than scraping). Daily DX/DXpedition coverage.
  - **OPDX Bulletin** (`papays.com/opdx.html` or canonical source TBD by researcher) — weekly text bulletin. Items are parsed _individually_ out of each bulletin (D-03), not shown as one bundle.
  - **NG3K DX/Contest Calendar** (`ng3k.com`) — HTML, structured. Treats activity end-date as the freshness anchor (D-02).
- **D-02:** **NG3K freshness model is activity-window based**, not publish-date. An NG3K item is shown if today's date ≤ activity-end-date. This means future-dated DXpedition announcements ("3D2JK Yasawa Is. May 5-15, 2026") appear before the activity starts and disappear when it ends.
- **D-03:** **OPDX bulletins are exploded into individual items** before merging. The bulletin's weekly text format contains 30-50 mini-items (one per DXpedition); each becomes its own ticker entry. Per-item dates come from the bulletin text where extractable; fall back to bulletin publish date.

### Freshness filter

- **D-04:** **24-hour cutoff for standard publish-date sources** (dxnews.com, DX-World, OPDX-derived items where per-item date is the bulletin publish date). Items with publish date older than 24h are filtered out before reaching the ticker.
- **D-05:** **NG3K uses its own activity-window rule (D-02), not the 24h cutoff.**
- **D-06:** **OPDX-parsed items use their extracted per-item dates against the 24h rule when extractable**; fall back to bulletin publish date when not.
- **D-07:** **Hide the ticker entirely when no fresh items remain** across all sources. The component returns null and reclaims the screen space — no "no recent news" placeholder.

### De-duplication

- **D-08:** **De-dup by extracted DXpedition callsign**, freshest version wins. When the same callsign appears in items from multiple sources, only the most recent item is kept. Implementation hint: standard amateur callsign regex (1-2 letters + digit + 1-3 letters, with optional `/` prefix or suffix); callsigns extracted from titles primarily, descriptions as fallback. Items with no extractable callsign pass through without de-dup.

### Rotation / merging

- **D-09:** **Recency-sorted, source-agnostic, newest first.** No explicit per-source cycling — items merge into a single timeline by date and the ticker scrolls them in chronological order. The "rotation through sources" the user originally asked for emerges naturally as different sources publish at different times.
- **D-10:** **20-item total cap** across the merged set (not 20 per source). After freshness filter + de-dup + recency sort, take top 20.

### Source attribution

- **D-11:** **Dynamic section-header label.** Replace the static "📰 DX NEWS" label in `DXNewsTicker.jsx:188` with one that reflects the current source (e.g., "📰 DX-WORLD", "📰 OPDX", "📰 NG3K", "📰 DXNEWS"). Header updates as ticker scrolls past each source's item. With recency-sorted ordering (D-09), this means the label changes frequently — Claude's discretion to add a small dwell/hold period if flickering becomes a problem.
- **D-12:** **Header link follows current source.** Clicking the section-header label opens that source's homepage in a new tab. Each source needs a canonical homepage URL stored alongside the item data.
- **D-13:** **Hover pauses the scroll; click on a ticker item opens that item's URL in a new tab.** Replaces the current `onClick={() => setPaused(!paused)}` behavior at `DXNewsTicker.jsx:218`. Pausing on hover gives users time to read; click is now a navigation action, not a pause toggle.

### Claude's Discretion

- Exact regex for callsign extraction (D-08) — standard ham callsign formats with country prefixes
- Whether and how to add a dwell period to dynamic header changes (D-11) — implementation tuning
- Per-source homepage URL constants (D-12) — pick canonical URLs during implementation
- Exact UX of hover-pause (D-13) — full pause vs. slow-scroll, transition timing
- Server-side cache strategy when individual sources fail — keep returning items from working sources, never break ticker for one upstream outage (existing pattern at `dxpeditions.js:346`)
- Whether to expose per-source last-fetched timestamps in the API response for debugging
- Internal data shape for the merged feed (each item must carry: title, description, url, publishDate, source name, source homepage url, optional activity-end-date for NG3K)

</decisions>

<canonical_refs>

## Canonical References

**No external specs** — OHC has no PROJECT.md, REQUIREMENTS.md, or ADRs.

External documentation researcher should consult during implementation:

- DX-World RSS feed location — `dx-world.net/feed/` is the conventional WordPress path; verify before relying
- OPDX Bulletin canonical source — historically distributed via email and `papays.com`; researcher should confirm the most stable URL and parse format
- NG3K calendar HTML — `ng3k.com/Misc/adxo.html` (or current equivalent) — structure documented at the page's top
- Open-Meteo-style approach to caching/staleness reused conceptually (see `01-CONTEXT.md` for related caching pattern)
- Amateur radio callsign formats — ITU prefix table (e.g., `https://www.itu.int/en/ITU-R/terrestrial/fmd/Pages/call_sign_series.aspx`)

</canonical_refs>

<code_context>

## Existing Code Insights

### Files in scope

- `server/routes/dxpeditions.js:278-349` — current `/api/dxnews` endpoint. Contains the dxnews.com HTML scraper with regex-based parsing, 30-minute cache (`DXNEWS_CACHE_TTL`), and stale-cache fallback on upstream failure. The new aggregator extends this route.
- `src/components/DXNewsTicker.jsx` — the rendering component. Fetches from `/api/dxnews` (line 68), refreshes every 30 minutes (line 84), scrolls via CSS keyframes at ~90px/sec (line 95), pauses on click (line 218). Also handles per-user text scaling (line 37-48) and visibility toggling via `mapLayers.showDXNews` (line 14-24).

### Reusable assets

- **Server cache pattern** (`dxpeditions.js:279-285`): 30-min TTL with stale fallback on fetch failure. Apply same pattern to each new source's fetch and to the merged result.
- **Per-source error isolation** (`dxpeditions.js:346`): existing route returns cached data on upstream failure rather than 500. Keep this resilience for each individual source so one broken source doesn't kill the ticker.
- **Server `User-Agent` header** (`dxpeditions.js:289-291`): `OpenHamClock/3.13.1 (amateur radio dashboard)` — keep using this for new fetches.
- **i18n keys** (`app.dxNews.pauseTooltip`, `app.dxNews.resumeTooltip` at `DXNewsTicker.jsx:219`) — add new keys for source labels and click-to-open hint as needed; English-only with `defaultValue` fallback per Phase 1 precedent.
- **Visibility toggle** (`localStorage.openhamclock_mapLayers.showDXNews`) — keep as-is. No new settings needed.

### Established patterns

- **Server-side scraping with regex blocks** (`dxpeditions.js:302-339`) is the established pattern. Extend it for OPDX. Use proper RSS parsing for DX-World (consider `rss-parser` or built-in `xml2js`).
- **Cache-first with stale fallback on error** (`dxpeditions.js:267-272, 346`) — apply per-source.
- **Item shape** currently: `{ title, url, date, description }`. New shape needs to add `source` (display name), `sourceUrl` (homepage), `activityEndDate` (NG3K only), and a stable `id` for de-dup.

### Integration points

- `App.jsx` mounts `DXNewsTicker` somewhere — check its current placement and prop wiring (likely passed through from layout context).
- The existing static link to `dxnews.com` (`DXNewsTicker.jsx:169`) becomes dynamic in D-12.

### Architecture verification (binding for downstream agents)

- The `/api/dxnews` route runs server-side via `server/routes/dxpeditions.js`. The Vite dev proxy (`vite.config.mjs:9-14`) routes `/api/*` to the OHC server. **This stays server-proxied** — see Phase Boundary above for rationale.

</code_context>

<specifics>
## Specific Ideas

- User's vision is "rotate through the sources and only show up to date information." Recency-sort emerged as the right interpretation because the user repeatedly chose simpler, less-engineered options over forced rotation.
- 24h freshness is aggressive but reflects user's strong "no stale content" preference. Hiding the ticker on dry days (D-07) is consistent with this — better to show nothing than to lower the bar.
- De-dup by callsign (D-08) was chosen specifically to handle the case where multiple sources cover the same DXpedition. User wants information density, not duplication.

</specifics>

<deferred>
## Deferred Ideas

- **Settings UI to toggle individual sources on/off** — out of scope for this phase. Would belong in a future "DX news settings panel" phase. Per-source defaults are baked in for now.
- **Real-time RBN-style spot/announcement feed** — qualitatively different from "news"; rejected during source list (Q1.1).
- **Section header dwell/hold period** — left to Claude's discretion within D-11; if flickering becomes a problem in execution, add it.
- **"Also covered by: X, Y" badge after callsign de-dup** — option (d) on Q2.3 was rejected; user picked simpler de-dup.
- **Color-coded source labels** — option (b) on Q4.1 was rejected as accessibility-questionable.
- **Per-source last-fetched timestamps in API response** — observability win, not requested. Add if execution surfaces a need.
- **Translations for new English-only i18n keys** — same pattern as Phase 1; English defaults via i18next `defaultValue`, locales translated later.

</deferred>

---

_Phase: 02-dx-news-multi-source-ticker_
_Context gathered: 2026-04-24_
