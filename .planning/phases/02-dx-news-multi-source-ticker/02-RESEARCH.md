# Phase 2: DX news multi-source ticker — Research

**Researched:** 2026-04-24
**Domain:** Server-side feed aggregation (Node/Express) + React ticker UI
**Confidence:** HIGH (with one CONTEXT-level decision needing human input — see Blocker below)

---

## Blocker to surface before planning

**OPDX Bulletin (CONTEXT D-01, D-03) has been discontinued.**

Verified from three independent sources:

- **papays.com/opdx.html** — index page. Most recent bulletin is **#1586, dated October 31, 2022**, explicitly labeled **"FINAL EDITION"**.
- **ng3k.com/Ohpadx/** — secondary archive. Explicit banner: _"NG3K is no longer putting up issues of OPDX."_ Last issue on that mirror: **#724, August 2005**.
- **ICQ Podcast news item (Nov 2022)** — confirms Tedd Mirgliotta KB8NW retired from publishing after ~32 years due to age and health; the final bulletin was Oct 31, 2022. The mailing list continues with _ad-hoc_ press releases but **not in bulletin format** — i.e., there is no longer a weekly parseable artifact to scrape.

CONTEXT.md D-01 was written assuming OPDX still publishes weekly; it does not. D-03 ("explode each weekly bulletin into individual items") cannot execute against OPDX because there are no new bulletins to explode.

**Recommended replacement: 425 DX News.**

- Active, weekly, from Italy since 1991 — issue **#1825 published 2026-04-25** (verified on 425dxn.org).
- Same format philosophy as OPDX: plain-text, DXpedition entries prefixed by **country prefix in CAPS**, blank line between items (identical to OPDX parse strategy — D-03 approach transfers intact).
- Official site (`425dxn.org`) publishes **PDF-only** — not parseable in Node without heavy PDF deps.
- **swarl.org** mirrors each bulletin as HTML-wrapped plain text in a `<pre>` block, with a predictable URL pattern: `https://swarl.org/news/YYYY-MM-DD/425-dx-news-NNNN`. This is the parseable source. Scraping a third-party mirror does add fragility — if swarl goes down, so does this source, but per CONTEXT's existing "per-source error isolation" pattern that's acceptable.

**Planner decision required:** Accept 425 DX News + swarl.org mirror as the OPDX replacement, or defer the third-source slot (ship with 3 sources: dxnews.com, DX-World, NG3K). If accepted, D-01, D-03, D-06 carry over unchanged with `OPDX` → `425 DX News` as a label swap; the per-item parse logic is the same pattern (country-prefix-caps + blank-line delimiter).

This is a user-facing scope question; marking it as Claude's discretion would overstep. Everything below assumes **425 DX News substitutes cleanly for OPDX**; if the planner/user defers that source instead, skip the "Source B" sections.

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Source list**

- **D-01:** Aggregate **4 sources**:
  - **dxnews.com** (existing) — keep current HTML scrape in `server/routes/dxpeditions.js:288-339`. Single-item daily news.
  - **DX-World** (`dx-world.net`) — RSS feed preferred (cleaner than scraping). Daily DX/DXpedition coverage.
  - **OPDX Bulletin** (`papays.com/opdx.html` or canonical source TBD by researcher) — weekly text bulletin. Items are parsed _individually_ out of each bulletin (D-03), not shown as one bundle. ⚠️ **See Blocker above — OPDX discontinued Oct 2022; proposed replacement: 425 DX News via swarl.org mirror.**
  - **NG3K DX/Contest Calendar** (`ng3k.com`) — HTML, structured. Treats activity end-date as the freshness anchor (D-02).
- **D-02:** **NG3K freshness model is activity-window based**, not publish-date. An NG3K item is shown if today's date ≤ activity-end-date.
- **D-03:** **OPDX bulletins are exploded into individual items** before merging. Per-item dates come from the bulletin text where extractable; fall back to bulletin publish date.

**Freshness filter**

- **D-04:** **24-hour cutoff for standard publish-date sources** (dxnews.com, DX-World, OPDX-derived items where per-item date is the bulletin publish date).
- **D-05:** **NG3K uses its own activity-window rule (D-02), not the 24h cutoff.**
- **D-06:** **OPDX-parsed items use their extracted per-item dates against the 24h rule when extractable**; fall back to bulletin publish date when not.
- **D-07:** **Hide the ticker entirely when no fresh items remain** across all sources. The component returns null — no "no recent news" placeholder.

**De-duplication**

- **D-08:** **De-dup by extracted DXpedition callsign**, freshest version wins. Items with no extractable callsign pass through without de-dup.

**Rotation / merging**

- **D-09:** **Recency-sorted, source-agnostic, newest first.**
- **D-10:** **20-item total cap** across the merged set (not 20 per source). After freshness filter + de-dup + recency sort, take top 20.

**Source attribution**

- **D-11:** **Dynamic section-header label.** Replace static "📰 DX NEWS" label with one that reflects the current source. Header updates as ticker scrolls past each source's item. Claude's discretion to add a small dwell/hold period.
- **D-12:** **Header link follows current source.** Clicking the section-header label opens that source's homepage in a new tab.
- **D-13:** **Hover pauses the scroll; click on a ticker item opens that item's URL in a new tab.** Replaces the current `onClick={() => setPaused(!paused)}` behavior at `DXNewsTicker.jsx:218`.

### Claude's Discretion

- Exact regex for callsign extraction (D-08) — standard ham callsign formats with country prefixes
- Whether and how to add a dwell period to dynamic header changes (D-11) — implementation tuning
- Per-source homepage URL constants (D-12) — pick canonical URLs during implementation
- Exact UX of hover-pause (D-13) — full pause vs. slow-scroll, transition timing
- Server-side cache strategy when individual sources fail — keep returning items from working sources, never break ticker for one upstream outage (existing pattern at `dxpeditions.js:346`)
- Whether to expose per-source last-fetched timestamps in the API response for debugging
- Internal data shape for the merged feed (each item must carry: title, description, url, publishDate, source name, source homepage url, optional activity-end-date for NG3K)

### Deferred Ideas (OUT OF SCOPE)

- **Settings UI to toggle individual sources on/off**
- **Real-time RBN-style spot/announcement feed**
- **Section header dwell/hold period** (left to Claude's discretion within D-11; if flickering becomes a problem in execution, add it)
- **"Also covered by: X, Y" badge after callsign de-dup**
- **Color-coded source labels**
- **Per-source last-fetched timestamps in API response**
- **Translations for new English-only i18n keys** — English defaults via i18next `defaultValue`, locales translated later
  </user_constraints>

---

## Summary

The phase extends `GET /api/dxnews` in `server/routes/dxpeditions.js` from a single HTML scrape to a **4-source aggregator** (confirmed verified: dxnews.com, DX-World RSS, [425 DX News via swarl.org — pending user accept; see Blocker], NG3K HTML) with per-source caches, freshness filters, callsign-based de-dup, and a merged item shape. The client `DXNewsTicker.jsx` gains dynamic source labels, hover-to-pause, and click-to-open navigation.

Three significant research findings drive the plan:

1. **OPDX is dead** (final edition 2022-10-31). 425 DX News is the natural 1:1 format replacement — same plain-text, country-prefix-caps-plus-blank-line structure OPDX used — but published-PDF-only on its canonical site. swarl.org mirrors it as HTML-wrapped plain text at a predictable URL, so parse logic stays identical to what D-03 envisioned.

2. **DX-World RSS is production-quality**: RSS 2.0 at `https://dx-world.net/feed/`, hourly updates, callsign-at-start-of-title convention (`"HF0PAS – South Shetland Islands"` format). `rss-parser@3.13.0` is the de-facto Node library — stable since April 2023, 5MB, zero fuss. Add one dep.

3. **NG3K has two URLs we already use**: `adxo.html` (HTML table) is the user-facing view; `adxoplain.html` is the machine-friendly text version the codebase **already scrapes successfully** in `server/routes/dxpeditions.js:29` for `/api/dxpeditions`. The existing parser there (lines 69-227) already extracts callsign + startDate + endDate + entity + bands + modes with working regexes. Phase 2 should **reuse that existing `dxpeditionCache.data`** rather than reparsing — NG3K is already aggregated, just pipe it into the news merge.

**Primary recommendation:** Extend existing `/api/dxnews` handler in place (don't split into per-source routes); use `rss-parser` for DX-World; reuse `ctx.dxpeditionCache` for NG3K; introduce a stand-alone `server/utils/dxNewsMerge.js` module with pure functions (freshness filter, callsign extract, de-dup, sort, cap) that Vitest can unit-test without touching Express.

---

## Standard Stack

### Core

| Library      | Version                                   | Purpose                          | Why Standard                                                                                                                                       |
| ------------ | ----------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rss-parser` | **3.13.0** (latest, published 2023-04-11) | Parse DX-World RSS 2.0 feed      | De-facto Node RSS parser; 479 dependents on npm; handles RSS 2.0, Atom, Media RSS, custom fields. Works with `node-fetch` already in package.json. |
| `express`    | ^4.21.2 (already installed)               | HTTP routing                     | Existing stack; `/api/dxnews` already lives in Express.                                                                                            |
| `node-fetch` | ^2.7.0 (already installed)                | HTTP client for upstream scrapes | Already used by every scraper in `server/routes/`.                                                                                                 |
| `vitest`     | ^2.1.8 (already installed)                | Unit tests for merge logic       | Matches project convention; config at `/vitest.config.js`.                                                                                         |

### Supporting

| Library | Version | Purpose                                        | When to Use                                                                                                                                  |
| ------- | ------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)  | —       | HTML parsing for dxnews.com + swarl 425 + NG3K | Existing code uses regex-based extraction; Phase 2 should stay consistent. **Don't add cheerio** — it's 400KB and we only need 3-4 patterns. |

**No new deps beyond `rss-parser`.** Cheerio is overkill for 3 regex blocks. Keep the codebase lean.

### Alternatives Considered

| Instead of                              | Could Use                                           | Tradeoff                                                                                                                                |
| --------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `rss-parser`                            | `feedparser` (danmactough)                          | More stream-oriented, harder to use, 5-year-stale. rss-parser is simpler for our 1-URL case.                                            |
| `rss-parser`                            | Raw `xml2js` + manual RSS field mapping             | Saves one dep but adds ~30 lines of item-unwrapping logic. Not worth it for one feed.                                                   |
| Regex HTML parse                        | `cheerio`                                           | Cheerio is 400KB + 9 transitive deps; our scrapes are <50 lines of regex total. Sticking with regex matches dxpeditions.js conventions. |
| Split aggregator into per-source routes | Single `/api/dxnews` with internal per-source fetch | Per-source routes would need a merge endpoint anyway. Keep one route, hide complexity server-side.                                      |

**Installation:**

```bash
npm install rss-parser@3.13.0
```

**Version verified:** `npm view rss-parser version` → `3.13.0`, published 2023-04-11. Bundle size ~5KB minified. No security advisories as of research date.

---

## Architecture Patterns

### Recommended File Structure

```
server/
├── routes/
│   └── dxpeditions.js           # /api/dxnews handler stays here; wire in new fetchers
├── utils/
│   └── dxNewsMerge.js           # NEW — pure functions: extractCallsign, isFresh, dedup, merge, cap
│   └── dxNewsMerge.test.js      # NEW — Vitest unit tests
│   └── dxNewsSources/           # NEW — one file per source fetcher
│       ├── dxnews.js            # existing scrape logic, lifted out
│       ├── dxWorld.js           # new — rss-parser against dx-world.net/feed/
│       ├── ng3k.js              # reads ctx.dxpeditionCache, reshapes into news items
│       └── four25DxNews.js      # new — swarl.org scrape (if user accepts OPDX replacement)
src/
└── components/
    └── DXNewsTicker.jsx         # dynamic label + hover-pause + click-navigate
```

Per-source fetcher modules let tests mock one source at a time and let a broken source fail independently (per the CONTEXT error-isolation requirement). Each exports `async function fetch(ctx) → { items, sourceMeta }`.

### Pattern 1: Per-source fetch with error isolation

The existing `/api/dxpeditions` and `/api/dxnews` routes each have a single try/catch that returns cached data on failure. For a multi-source aggregator, wrap **each** source fetch in its own try/catch so one failure doesn't kill the others.

```javascript
// Source: adapted from server/routes/dxpeditions.js:267-275
const sources = [fetchDxnews, fetchDxWorld, fetchNg3k, fetchFour25DxNews];
const results = await Promise.allSettled(sources.map((f) => f(ctx)));
const items = results.flatMap((r, i) => {
  if (r.status === 'fulfilled') return r.value.items;
  logErrorOnce(`dxnews-source-${i}`, r.reason?.message || 'fetch failed');
  return perSourceStaleCache[i]?.items || [];
});
```

`Promise.allSettled` is the right primitive here — `Promise.all` would short-circuit on any reject, and a sequential loop wastes ~4× latency.

### Pattern 2: Per-source cache with stale fallback

Current `/api/dxnews` has one cache for the whole response (`dxpeditions.js:279-280`). For 4 sources, maintain **4 per-source caches** + an optional merged-response cache. Per-source is important because it lets a source recover independently.

```javascript
const sourceCaches = {
  dxnews: { data: null, timestamp: 0 },
  dxWorld: { data: null, timestamp: 0 },
  ng3k: { data: null, timestamp: 0 },
  four25: { data: null, timestamp: 0 },
};
const TTL = 30 * 60 * 1000; // 30 min, matches existing DXNEWS_CACHE_TTL

async function cachedFetch(name, fetcher) {
  const c = sourceCaches[name];
  if (c.data && Date.now() - c.timestamp < TTL) return c.data;
  try {
    const fresh = await fetcher();
    c.data = fresh;
    c.timestamp = Date.now();
    return fresh;
  } catch (e) {
    logErrorOnce(`dxnews:${name}`, e.message);
    return c.data || { items: [] }; // stale if we have it, empty if we don't
  }
}
```

### Pattern 3: Pure-function merge pipeline

Keep the merge logic **side-effect free** so Vitest can test it without mocks. Input: arrays of raw items from each source. Output: final 20-item array ready to serialize.

```javascript
// server/utils/dxNewsMerge.js
function mergeNews({ dxnews, dxWorld, ng3k, four25 }, now = new Date()) {
  const publishDateSources = [...dxnews, ...dxWorld, ...four25].filter((item) => isFreshByPublishDate(item, now, 24)); // D-04, D-06
  const activityWindowSources = ng3k.filter((item) => isFreshByActivityWindow(item, now)); // D-02, D-05
  const all = [...publishDateSources, ...activityWindowSources];
  const deduped = dedupByCallsign(all); // D-08 — freshest wins
  const sorted = deduped.sort(
    (
      a,
      b, // D-09
    ) => new Date(b.publishDate) - new Date(a.publishDate),
  );
  return sorted.slice(0, 20); // D-10
}
```

### Pattern 4: Reuse NG3K from existing route

`server/routes/dxpeditions.js` already parses NG3K (`/api/dxpeditions`) into `{ callsign, entity, dates, startDate, endDate, isActive, isUpcoming }` — and exposes that cache via `ctx.dxpeditionCache` (line 14, explicitly: _"Expose cache so dxcluster.js can cross-reference spotted callsigns…"_). **Reuse it.**

```javascript
// server/routes/dxNewsSources/ng3k.js
module.exports = async function fetchNg3k(ctx) {
  // Piggyback on existing cache. If empty, trigger warm-up by calling /api/dxpeditions
  // internally or skip — one stale frame is acceptable.
  const cached = ctx.dxpeditionCache?.data?.dxpeditions || [];
  const items = cached
    .filter((d) => d.isActive || d.isUpcoming)
    .map((d) => ({
      id: `ng3k:${d.callsign}`,
      title: `${d.callsign} — ${d.entity}`,
      description: `${d.dates}${d.bands ? ' · ' + d.bands : ''}${d.modes ? ' · ' + d.modes : ''}`,
      url: 'https://www.ng3k.com/Misc/adxo.html',
      publishDate: d.startDate, // for sort ordering (D-09)
      activityEndDate: d.endDate, // for freshness filter (D-02)
      callsign: d.callsign,
      source: 'NG3K',
      sourceUrl: 'https://www.ng3k.com/Misc/adxo.html',
    }));
  return { items };
};
```

No new HTTP fetch. Zero duplicate work. This is the highest-leverage architectural decision in the phase.

### Anti-Patterns to Avoid

- **Don't re-scrape NG3K** — the code already does it for `/api/dxpeditions`. Two parsers drift.
- **Don't use `Promise.all` for multi-source fetches** — any rejection kills all sources. Use `Promise.allSettled`.
- **Don't put freshness/dedup logic inside the route handler** — keep it in pure-function modules so it's testable. The route handler orchestrates; the merge module decides.
- **Don't regex-extract callsigns inline in 4 places** — put `extractCallsign(text)` in `dxNewsMerge.js` and import.
- **Don't cache the _merged_ response as the primary cache** — cache per-source. If one source fails, merging still runs with the other three's cached data.

---

## Source-by-source Fetch Details

### Source A: dxnews.com (existing, keep as-is)

- URL: `https://dxnews.com/`
- Parse: existing regex block at `server/routes/dxpeditions.js:298-339`. No change needed except output-shape alignment.
- Publish date format: `2026-04-24 15:32:00` (extracted from HTML, local time — treat as UTC for simplicity unless testing reveals a problem).
- Typical item count: ~10-20 (page shows top news on homepage).
- Homepage URL for D-12: `https://dxnews.com/`

### Source B: DX-World RSS (verified HIGH confidence)

- URL: `https://dx-world.net/feed/`
- Format: RSS 2.0 (verified 2026-04-24). Latest item 2026-04-24 16:17 UTC, second-latest 15:20 UTC — confirms hourly cadence.
- Feed fields: `title`, `link`, `pubDate`, `description` (summary text), `creator` (dc:creator), `guid`, `category[]`.
- Title convention: `"CALLSIGN – Location"` — callsign at the very start, followed by en-dash and location (e.g., `"HF0PAS – South Shetland Islands"`, `"TX9W – Marquesas Islands"`). **This makes callsign extraction trivial** — regex on the first token before the en-dash.
- Parse: `rss-parser` one-liner:
  ```javascript
  const Parser = require('rss-parser');
  const parser = new Parser({ timeout: 10000 });
  const feed = await parser.parseURL('https://dx-world.net/feed/');
  // feed.items = [{ title, link, pubDate, contentSnippet, creator, guid, ... }]
  ```
- `pubDate` format: RFC 822 (`Fri, 24 Apr 2026 16:17:05 +0000`). `new Date(pubDate)` handles it natively.
- Description is plain text / light markup, 1-3 sentences, some end with `"[…]"` truncation marker — fine for ticker use.
- Homepage URL for D-12: `https://dx-world.net/`

### Source C: 425 DX News (OPDX replacement — pending user acceptance)

- URL (to scrape): `https://swarl.org/news/YYYY-MM-DD/425-dx-news-NNNN` (e.g., `/news/2026-04-17/425-dx-news-1824`)
- Discovery problem: we need the **latest** bulletin, but the URL encodes date + number. Two approaches:
  1. **Scrape the listing page** `https://swarl.org/forum/` or search page — adds a 2-step fetch.
  2. **Pattern-based guess**: bulletin NNNN increments weekly; date is always a Saturday. Guess the next URL from last known (NNNN+1, this coming Saturday). On 404, fall back to cached bulletin.
  3. **Simplest: scrape 425dxn.org's HTML listing page at `/index.php?op=wbull`** to get `{bulletin_number, date}` for the latest issue, then hit swarl.org at the derived URL.
  - **Recommend approach 3** — one extra HTTP round trip (cheap with 30-min cache) for correctness.
- Format at swarl.org: HTML page with the bulletin body in a `<pre>` block. Content is plain text with:
  - Header: `\=============================` + `*** 4 2 5 D X N E W S ***` title banner
  - Items prefixed by **country prefix in ALL CAPS at line start** (e.g., `3B9 -`, `BY -`, `F -`, `I -`)
  - Hyphen separator after prefix
  - **Blank line** separates entries
  - Typical item: 60-120 words, 3-6 lines of ASCII-wrapped text
- Parse strategy:
  1. Fetch swarl.org URL, extract `<pre>…</pre>` content (single regex).
  2. Strip ASCII banner headers (lines matching `/^[=\*\s]+$/` or containing `4 2 5 D X N E W S`).
  3. Split on `/\n\s*\n/` (blank line) for item boundaries.
  4. For each chunk, regex-match `^([A-Z0-9]{1,4})\s*-\s*(.+)$` at line start to extract prefix + body.
  5. Extract callsign from body using the Claude's-discretion regex (see Pattern section below).
  6. Each item: `{ id, title: firstSentence, description: first ~150 chars, url: bulletin URL + anchor if available, publishDate: bulletin date (Saturday), callsign, source: '425 DX News', sourceUrl: 'https://www.425dxn.org/' }`.
- Per D-06: use **bulletin date** as the publish date (per-item dates are rarely embedded reliably in 425 DX News format either).
- Homepage URL for D-12: `https://www.425dxn.org/`

**If user rejects this source**, drop `four25DxNews.js` and ship with 3 sources. The merge pipeline doesn't care about source count.

### Source D: NG3K (reuse existing cache)

- URL (already fetched by existing route): `https://www.ng3k.com/Misc/adxoplain.html`
- **No new HTTP fetch.** Read `ctx.dxpeditionCache.data.dxpeditions` (see Pattern 4 above).
- Fields available: `callsign`, `entity`, `dates` (string), `qsl`, `info`, `bands`, `modes`, `startDate` (ISO), `endDate` (ISO), `isActive`, `isUpcoming`.
- Freshness rule (D-02, D-05): keep items where `new Date(d.endDate) >= now`. The existing parser already filters on this at line 198-202 (`isActive`, `isUpcoming`).
- Homepage URL for D-12: `https://www.ng3k.com/Misc/adxo.html`

**Edge case**: on first request after server start, `ctx.dxpeditionCache.data` is null. Options:

1. Return empty items for NG3K (merge still works with other 3 sources) — recommend.
2. Call the existing handler internally. Too much coupling.

---

## Don't Hand-Roll

| Problem                           | Don't Build                                  | Use Instead                                                                                        | Why                                                                                                                                     |
| --------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| RSS 2.0 / Atom parsing            | Custom `xml2js` + field mapping              | `rss-parser@3.13.0`                                                                                | Handles namespace-prefixed fields (dc:creator, media:content, wfw:commentRss), date parsing, malformed-XML recovery. 5KB.               |
| HTTP fetch with timeout           | Custom `http.request` setup                  | `node-fetch` (already installed) — pass `{ signal: AbortSignal.timeout(10000) }`                   | Already the project convention.                                                                                                         |
| Callsign regex                    | "Simple" 2-line regex                        | A **specified, tested** regex in `dxNewsMerge.js` with a test file covering the 8 edge cases below | Naive `[A-Z]\d[A-Z]+` matches English words ("A1", "E7") and misses prefixes. Test it properly once.                                    |
| Promise-all with error recovery   | `for (…) await` sequential fetch             | `Promise.allSettled([…])` — native, parallel, fault-tolerant                                       | Parallel is ~4× faster; `allSettled` preserves partial success semantics CONTEXT explicitly requires.                                   |
| Tracking "current item" in ticker | `setInterval` with item-index math           | IntersectionObserver on each item span, or scroll-listener with bounding-client-rect polling       | IntersectionObserver is cheaper than scroll listeners and directly answers "which item is visible right now". See Client Section below. |
| HTML entity decoding              | Hand-rolled `.replace(/&amp;/g, '&')` chains | Existing block at `server/routes/dxpeditions.js:54-64` (copy/paste pattern)                        | Codebase already does this. Stay consistent.                                                                                            |

---

## Runtime State Inventory

Not applicable — this is a new-feature phase, not a rename/refactor. No stored data, live service config, OS state, secrets, or build artifacts reference anything this phase changes.

**Verified:** no collections/DB tables, no registered OS services, no SOPS/env keys, no build artifacts scoped to the DX News ticker. Existing localStorage key `openhamclock_dxNewsTextScale` is preserved unchanged; `openhamclock_mapLayers.showDXNews` is preserved unchanged.

---

## Common Pitfalls

### Pitfall 1: RSS pubDate timezone confusion

**What goes wrong:** DX-World pubDate is `Fri, 24 Apr 2026 16:17:05 +0000` (UTC). dxnews.com's date is `2026-04-24 15:32:00` (unspecified timezone, likely site-local). Naive `new Date(str)` parses the first as UTC and the second as **local time** (the browser's/server's local TZ).
**Why it happens:** ISO-8601 without TZ is treated as local; RFC 822 always has a TZ.
**How to avoid:** Normalize everything to UTC at ingestion. For dxnews.com, either (a) trust that the site publishes UTC and append `Z`, or (b) treat "within 24h" as a loose filter and don't sweat a 5-hour TZ skew.
**Warning signs:** Items showing as "23h ago" on one refresh and "1d 5h ago" on the next = TZ reparse drift.

### Pitfall 2: Callsign regex false positives in free text

**What goes wrong:** Naive `[A-Z]{1,2}\d[A-Z0-9]*` matches `"W3"`, `"A1"`, `"E7"`, and many English/German words (`"IN1"`, `"OH2"`, `"FOR1"`, `"ON4"` happen to be real prefixes but also fragments).
**Why it happens:** Ham callsigns overlap with common word-like strings when pulled out of prose.
**How to avoid:**

- Anchor on word boundaries: `\b([A-Z]{1,2}\d[A-Z]{1,3}(?:\/[A-Z0-9]+)?)\b` and require **at least one trailing letter** (eliminates bare "W3", "G4" etc. which aren't valid standalone calls).
- Extract from **titles first** (high signal — DX-World puts callsign at position 0), description as fallback.
- Match the existing pattern at `server/routes/dxpeditions.js:124`: `/\b([A-Z]{1,2}\d[A-Z0-9]*[A-Z](?:\/[A-Z0-9]+)?)\b/` — already requires at least one trailing letter (`[A-Z]` after `[A-Z0-9]*`). **Reuse this regex.** It's tested in production.
- For items with no extractable callsign, CONTEXT D-08 explicitly says "pass through without de-dup" — keep the item, set `callsign: null`, skip dedup for it.
  **Warning signs:** Dedup collapsing items that aren't the same DXpedition; items dropped that shouldn't be.

### Pitfall 3: NG3K cache cold-start

**What goes wrong:** On first request after `server.js` starts, `ctx.dxpeditionCache.data` is `null` — merge returns `{items: []}` for NG3K until `/api/dxpeditions` is called for the first time.
**Why it happens:** The cache only populates when its own route is hit by the client.
**How to avoid:** Either (a) accept it — the ticker will fill in within a few seconds once `DxpeditionPanel.jsx` renders and calls `/api/dxpeditions`; or (b) kick off a warm-up on server start (add a one-liner `fetchNg3k()` on boot). Recommend (a) for minimum coupling.
**Warning signs:** Fresh server, no DX pedition panel mounted, ticker shows 3 sources' worth of news but no NG3K activity-window items.

### Pitfall 4: swarl.org bulletin URL drift

**What goes wrong:** The URL pattern `swarl.org/news/YYYY-MM-DD/425-dx-news-NNNN` requires knowing the current bulletin number. If the slug format changes (swarl redesigns), scraping breaks silently.
**Why it happens:** Third-party mirror we don't control.
**How to avoid:**

- Treat 425 DX News as a second-tier source; if its fetch fails, log-once and continue with 3 sources.
- Add a scrape of `425dxn.org/index.php?op=wbull` as the **source of truth for "latest bulletin number + date"**, then derive the swarl URL from that. If 425dxn's listing breaks too, fall back to cached.
- Cache the last successfully-parsed bulletin for up to 7 days (weekly cadence + 30-min normal TTL) — a bulletin from 5 days ago is still within the week's freshness window for many items.
  **Warning signs:** Zero items from 425 DX News for >2 days; look for HTML structure changes at swarl.

### Pitfall 5: Ticker dynamic label flicker (D-11)

**What goes wrong:** With recency-sorted ordering (D-09), adjacent items often differ by source. The section header could change every 2-3 seconds as the ticker scrolls. Feels broken to users.
**Why it happens:** No debouncing between label changes.
**How to avoid:** Apply a **minimum dwell of ~5 seconds** — don't change the label even if the current item's source differs until 5s have elapsed since last change. If the user pauses on hover, let the label update immediately (they're reading it). Worth a Claude-discretion implementation note per D-11.
**Warning signs:** Reviewer says "the header is distracting" — bump dwell to 8s.

### Pitfall 6: Hover-pause with mouse events on a scrolling element

**What goes wrong:** The current ticker relies on a CSS keyframe animation with `animationPlayState`. Switching on `onMouseEnter` / `onMouseLeave` works, **but** if the user's cursor is hovering when the page reflows (layout change, window resize), hover state can desync and leave the ticker paused.
**Why it happens:** React's mouse-event propagation doesn't always fire on layout changes.
**How to avoid:** Compute `paused` from a state that resets on a timer if no further `mouseleave` fires within N seconds, or use `onMouseMove` to re-arm. Simpler fix: use CSS-only `:hover` selector on the scroll container: `&:hover { animation-play-state: paused; }` — browsers handle this reliably. React state only for click-pause, if we keep it.
**Warning signs:** User reports ticker "just stops sometimes."

### Pitfall 7: Click-through on scrolling items

**What goes wrong:** The ticker scrolls at ~90px/sec; a user clicks what they think is item X but the click registers on item X+1 because the position shifted between mousedown and mouseup.
**Why it happens:** `click` fires only if mousedown and mouseup target the same element; during animation the element under the cursor changes.
**How to avoid:** On `onMouseEnter` of a ticker item, pause the animation (D-13's hover-pause already achieves this). User reads paused → click lands on what they see.
**Warning signs:** Analytics show click-throughs opening URLs for items adjacent to the intended target.

---

## Code Examples

### Callsign extraction (verified pattern from this codebase)

```javascript
// Source: adapted from server/routes/dxpeditions.js:124 (in-production regex)
// Matches: W1AW, 3D2JK, VP8/G3ABC, W1AW/M
// Does not match: W3 (bare prefix), XX (no digit), "for" (English word)
const CALLSIGN_RE = /\b([A-Z]{1,2}\d[A-Z0-9]*[A-Z](?:\/[A-Z0-9]+)?)\b/;

function extractCallsign(text) {
  if (!text) return null;
  // Try title first (highest signal — DX-World puts call at start)
  const m = String(text).toUpperCase().match(CALLSIGN_RE);
  if (!m) return null;
  const call = m[1];
  // Filter out obviously-not-a-callsign matches
  if (/^(DXCC|QSL|INFO|SOURCE|THE|AND|FOR|BUT|DAY|ARE|GMT|UTC)$/i.test(call)) return null;
  return call;
}
```

### RSS fetch with rss-parser

```javascript
// Source: https://www.npmjs.com/package/rss-parser (3.13.0 README)
const Parser = require('rss-parser');
const parser = new Parser({
  timeout: 10_000,
  headers: { 'User-Agent': 'OpenHamClock/3.13.1 (amateur radio dashboard)' },
});

async function fetchDxWorld() {
  const feed = await parser.parseURL('https://dx-world.net/feed/');
  return {
    items: feed.items.map((item) => ({
      id: `dxworld:${item.guid || item.link}`,
      title: item.title,
      description: (item.contentSnippet || item.content || '').slice(0, 200),
      url: item.link,
      publishDate: new Date(item.pubDate).toISOString(),
      callsign: extractCallsign(item.title),
      source: 'DX-World',
      sourceUrl: 'https://dx-world.net/',
    })),
  };
}
```

### Per-source cache + stale fallback (adapted from existing pattern)

```javascript
// Source: server/routes/dxpeditions.js:279-285, 344-347
const sourceCaches = new Map();
const TTL = 30 * 60 * 1000;

async function cachedFetch(name, fetcher) {
  const entry = sourceCaches.get(name) || { data: null, ts: 0 };
  if (entry.data && Date.now() - entry.ts < TTL) return entry.data;
  try {
    const fresh = await fetcher();
    sourceCaches.set(name, { data: fresh, ts: Date.now() });
    return fresh;
  } catch (e) {
    logErrorOnce(`dxnews:${name}`, e.message);
    return entry.data || { items: [] };
  }
}
```

### Aggregator route skeleton

```javascript
// Source: new code, following conventions from server/routes/dxpeditions.js
app.get('/api/dxnews', async (req, res) => {
  const [dxnews, dxWorld, ng3k, four25] = await Promise.all([
    cachedFetch('dxnews', () => fetchDxnews()),
    cachedFetch('dxWorld', () => fetchDxWorld()),
    cachedFetch('ng3k', () => fetchNg3k(ctx)), // reads ctx.dxpeditionCache
    cachedFetch('four25', () => fetchFour25DxNews()),
  ]);

  const items = mergeNews({
    dxnews: dxnews.items,
    dxWorld: dxWorld.items,
    ng3k: ng3k.items,
    four25: four25.items,
  });

  res.json({ items, fetched: new Date().toISOString() });
});
```

### Client: IntersectionObserver to track current-source for dynamic label (D-11)

```javascript
// Source: https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver
// Adapted for ticker (horizontal scroll) — use root margin to define "visible center"
useEffect(() => {
  if (!contentRef.current) return;
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting);
      if (visible.length > 0) {
        const item = news[parseInt(visible[0].target.dataset.index)];
        if (item) setCurrentSource(item.source); // triggers label update
      }
    },
    { root: tickerRef.current, threshold: 0.5 },
  );
  contentRef.current.querySelectorAll('[data-index]').forEach((el) => observer.observe(el));
  return () => observer.disconnect();
}, [news]);
```

Alternative (simpler, no observer): drive current-source from a timer matched to `animDuration / news.length`. Cheaper and accurate enough if you don't care about visual precision.

### Client: CSS-only hover pause (reliable)

```javascript
// Replace the JS-driven `animationPlayState: paused ? 'paused' : 'running'`
// with a CSS rule + one inline style toggle. Hover is handled in CSS, click
// pause is tracked in React state.
<style>
  .dxnews-scroll:hover { animation-play-state: paused !important; }
</style>
<div
  className="dxnews-scroll"
  style={{ animationPlayState: clickPaused ? 'paused' : 'running', /* … */ }}
/>
```

---

## State of the Art

| Old Approach                                | Current Approach                                          | When Changed          | Impact                                                                              |
| ------------------------------------------- | --------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| OPDX Bulletin as DX news reference          | **425 DX News** + DX-World RSS                            | OPDX ended 2022-10-31 | CONTEXT D-01 source list needs replacement — see Blocker.                           |
| NG3K only as "upcoming DXpedition calendar" | NG3K items merged into general news ticker (CONTEXT D-09) | This phase            | First time NG3K data appears alongside dxnews.com headlines.                        |
| Single-source `/api/dxnews` scrape          | Multi-source aggregator with per-source caches            | This phase            | Existing API shape (`{ items, fetched }`) is preserved — clients don't break.       |
| Callsign regex scattered across route files | `extractCallsign()` util                                  | This phase            | Factor out the in-production regex from `dxpeditions.js:124` into `dxNewsMerge.js`. |

**Deprecated/outdated:**

- **OPDX Bulletin polling** — do not implement; source is dead. Replace with 425 DX News or drop.
- **`onClick={() => setPaused(!paused)}` on ticker body** (`DXNewsTicker.jsx:218`) — replaced by D-13 hover-pause + item-click-navigate.
- **Static `<a href="https://dxnews.com">` label** (`DXNewsTicker.jsx:169`) — replaced by D-11/D-12 dynamic label+link.

---

## Open Questions

1. **OPDX replacement (BLOCKER): does the user accept 425 DX News via swarl.org mirror as the third source?**
   - What we know: OPDX is definitively dead since 2022-10-31. 425 DX News has the same format, is active, and can be parsed from swarl.org's HTML mirror.
   - What's unclear: whether the user is comfortable with (a) scraping a third-party mirror (not the official 425dxn.org, which is PDF-only) and (b) replacing "OPDX" with "425 DX News" in UI labels.
   - **Recommendation:** Planner should surface this question to the user explicitly in the plan's discussion before implementation tasks are authored. If rejected, ship with 3 sources (dxnews.com, DX-World, NG3K) and note the missing fourth in a CHANGELOG entry.

2. **NG3K cold-start: warm up cache proactively on server boot?**
   - What we know: `ctx.dxpeditionCache.data` is null until `/api/dxpeditions` is first called. NG3K items won't appear in the ticker until then.
   - What's unclear: how much this matters in production (does `DxpeditionPanel` mount on every user visit? probably yes — so cache is warm within seconds).
   - **Recommendation:** Ship without warm-up. If testing reveals ticker starts empty too often, add a one-line call on server start.

3. **Merge cache: do we cache the final merged output, or only per-source?**
   - What we know: per-source caching is definitively correct for fault isolation. A merged cache would save ~1ms of array work per request.
   - What's unclear: whether 30-min fresh-responses-per-user is acceptable (low-traffic site = essentially per-user). Probably yes.
   - **Recommendation:** Skip the merged cache. Re-merge on each request against per-source caches. Simpler and has zero observable downside.

---

## Validation Architecture

### Test Framework

| Property           | Value                                             |
| ------------------ | ------------------------------------------------- |
| Framework          | Vitest 2.1.8 + jsdom (existing)                   |
| Config file        | `vitest.config.js` at repo root                   |
| Setup file         | `src/test/setup.js` (currently empty — fine)      |
| Quick run command  | `npx vitest run server/utils/dxNewsMerge.test.js` |
| Full suite command | `npm run test:run` (`npx vitest run`)             |
| Coverage command   | `npm run test:coverage`                           |

Vitest already powers all existing `.test.js` files (see `src/utils/dxClusterFilters.test.js`, `server/utils/dxClusterPathIdentity.test.js`). No new framework needed.

### Phase Requirements → Test Map

| Req / CONTEXT ID                     | Behavior                                                                                                 | Test Type                     | Automated Command                                                              | File Exists? |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------ | ------------ |
| D-01 (source list)                   | Merge fetches from 4 sources concurrently; one failure doesn't break others                              | unit (mock `fetch`)           | `npx vitest run server/utils/dxNewsMerge.test.js -t "fault tolerance"`         | ❌ Wave 0    |
| D-02 (NG3K activity window)          | NG3K item with `endDate` in past → filtered out; `endDate` in future → kept                              | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "activity window"`         | ❌ Wave 0    |
| D-03 (OPDX/425 explode per-item)     | Single bulletin text → N individual items with extracted callsigns                                       | unit (text fixture)           | `npx vitest run server/utils/dxNewsMerge.test.js -t "bulletin parse"`          | ❌ Wave 0    |
| D-04 (24h cutoff)                    | publish-date 23h ago → kept; 25h ago → dropped                                                           | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "freshness 24h"`           | ❌ Wave 0    |
| D-05 (NG3K exception)                | NG3K item 2 weeks old publishDate but endDate in future → kept                                           | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "ng3k exception"`          | ❌ Wave 0    |
| D-06 (OPDX per-item date extraction) | Item with in-text date → uses extracted; without → falls back to bulletin date                           | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "per-item date"`           | ❌ Wave 0    |
| D-07 (hide when empty)               | Ticker renders `null` when merged items array is empty                                                   | component (RTL)               | `npx vitest run src/components/DXNewsTicker.test.jsx -t "hide when empty"`     | ❌ Wave 0    |
| D-08 (callsign de-dup)               | Two items same callsign, different sources → freshest kept                                               | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "dedup by callsign"`       | ❌ Wave 0    |
| D-08 (no callsign)                   | Item with no extractable callsign → kept, no dedup applied                                               | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "no callsign passthrough"` | ❌ Wave 0    |
| D-09 (recency sort)                  | Merged array is sorted by publishDate DESC                                                               | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "recency sort"`            | ❌ Wave 0    |
| D-10 (20 cap)                        | 50 input items → 20 output items                                                                         | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "20 cap"`                  | ❌ Wave 0    |
| D-11 (dynamic label)                 | As ticker scrolls past items, label reflects source of currently-visible item                            | component                     | `npx vitest run src/components/DXNewsTicker.test.jsx -t "dynamic label"`       | ❌ Wave 0    |
| D-12 (dynamic link)                  | Clicking label opens currentSource.sourceUrl                                                             | component                     | `npx vitest run src/components/DXNewsTicker.test.jsx -t "dynamic link"`        | ❌ Wave 0    |
| D-13 (hover pause)                   | `mouseenter` on scroll area sets pause-state; `mouseleave` resumes                                       | component                     | `npx vitest run src/components/DXNewsTicker.test.jsx -t "hover pause"`         | ❌ Wave 0    |
| D-13 (click navigate)                | Clicking an item opens `item.url` in new tab (not pause-toggle)                                          | component                     | `npx vitest run src/components/DXNewsTicker.test.jsx -t "click navigate"`      | ❌ Wave 0    |
| Callsign extraction                  | Regex correctness across ~8 edge cases (W1AW, 3D2JK, VP8/G3ABC, W1AW/M, false-positive English words)    | unit                          | `npx vitest run server/utils/dxNewsMerge.test.js -t "extractCallsign"`         | ❌ Wave 0    |
| Per-source fetch (DX-World)          | Given a recorded RSS XML fixture, returns normalized items with correct fields                           | unit (fixture)                | `npx vitest run server/routes/dxNewsSources/dxWorld.test.js`                   | ❌ Wave 0    |
| Per-source fetch (425 DX News)       | Given a recorded swarl HTML fixture, returns N items                                                     | unit (fixture)                | `npx vitest run server/routes/dxNewsSources/four25DxNews.test.js`              | ❌ Wave 0    |
| Per-source fetch (dxnews.com)        | Given a recorded HTML fixture, returns current shape                                                     | unit (fixture)                | `npx vitest run server/routes/dxNewsSources/dxnews.test.js`                    | ❌ Wave 0    |
| End-to-end `/api/dxnews`             | Mocked upstream → response has ≤20 items, sorted, deduped, all four sources represented when all succeed | integration (supertest-style) | `npx vitest run server/routes/dxNewsRoute.test.js`                             | ❌ Wave 0    |

### Sampling Rate

- **Per task commit:** `npx vitest run server/utils/dxNewsMerge.test.js` (fast, covers the merge pipeline — most phase logic lives here)
- **Per wave merge:** `npm run test:run` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`; plus manual smoke test against live `/api/dxnews` in dev (`npm run dev` + `curl http://localhost:5173/api/dxnews | jq '.items | length'` should return a number 1-20).

### Wave 0 Gaps

- [ ] `server/utils/dxNewsMerge.js` — pure-function merge module (callsign extract, freshness filter, dedup, sort, cap, bulletin parse)
- [ ] `server/utils/dxNewsMerge.test.js` — covers D-02 through D-10, callsign edge cases
- [ ] `server/routes/dxNewsSources/dxnews.js` — existing scrape lifted out
- [ ] `server/routes/dxNewsSources/dxnews.test.js` — recorded HTML fixture + parse assertion
- [ ] `server/routes/dxNewsSources/dxWorld.js` — RSS fetcher
- [ ] `server/routes/dxNewsSources/dxWorld.test.js` — recorded RSS fixture
- [ ] `server/routes/dxNewsSources/ng3k.js` — cache reader + reshape
- [ ] `server/routes/dxNewsSources/four25DxNews.js` — swarl scraper (if accepted)
- [ ] `server/routes/dxNewsSources/four25DxNews.test.js` — recorded HTML fixture
- [ ] `server/routes/dxNewsRoute.test.js` — integration test with all sources mocked
- [ ] `src/components/DXNewsTicker.test.jsx` — component tests for D-07, D-11, D-12, D-13
- [ ] Fixture dir: `server/utils/__fixtures__/dx-news/` with recorded samples (dx-world.rss, 425-dx-news-1824.html, dxnews-homepage.html)
- [ ] npm install: `rss-parser@3.13.0`

---

## Sources

### Primary (HIGH confidence)

- Existing codebase: `server/routes/dxpeditions.js` — authoritative for scrape patterns, cache patterns, and regex (`:124`, `:279-285`, `:289-291`, `:346`)
- Existing codebase: `src/components/DXNewsTicker.jsx` — authoritative for ticker rendering, keyframe animation, textScale persistence
- Existing codebase: `src/utils/callsign.js` — prefix map and cty.dat usage pattern
- Existing codebase: `server/utils/*.test.js` — Vitest conventions used throughout the project
- `package.json` — confirmed no existing RSS/XML parser deps
- `npm view rss-parser version` → **3.13.0** (published 2023-04-11), verified via local `npm` on 2026-04-24
- `https://dx-world.net/feed/` — verified RSS 2.0, hourly cadence, callsign-at-start-of-title convention (2026-04-24)
- `https://www.ng3k.com/Misc/adxo.html` — verified HTML table structure, columns (Start Date, End Date, DXCC Entity, Call, QSL via, Reported by, Info), ~45-50 current entries (2026-04-24)
- `https://www.papays.com/opdx.html` — verified FINAL EDITION #1586 2022-10-31 (2026-04-24)

### Secondary (MEDIUM confidence)

- `https://swarl.org/news/2026-04-17/425-dx-news-1824` — verified URL pattern + `<pre>`-block format + country-prefix-caps delimiter (2026-04-24); third-party mirror, format could change
- `https://www.425dxn.org/index.php?op=wbull` — verified weekly cadence, PDF-only on canonical site, issue #1825 on 2026-04-25 (2026-04-24)
- ICQ Podcast Nov 2022 — confirms OPDX retirement circumstances (Tedd KB8NW age/health)

### Tertiary (LOW confidence — validate on implementation)

- IntersectionObserver approach to D-11 label tracking — not empirically tested against this specific ticker; CSS-only hover pause is preferred as the higher-confidence D-13 approach
- 5-second default dwell for D-11 label debounce — intuition-based; tune in execution
- `swarl.org` will stay stable for 30-min polling — unvalidated assumption; mitigated by per-source error isolation

---

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — one new dep (rss-parser), verified version and maintenance status; all else already in project.
- Architecture: **HIGH** — patterns lifted from in-production `dxpeditions.js` (same file we're extending). Reuse of `ctx.dxpeditionCache` is explicit and documented.
- Callsign extraction: **HIGH** — regex is already running in production at `dxpeditions.js:124`; we're factoring it out, not inventing it.
- Source verification — dxnews.com: **HIGH** (existing working scrape).
- Source verification — DX-World: **HIGH** (RSS feed live-verified 2026-04-24).
- Source verification — NG3K: **HIGH** (both `adxo.html` and `adxoplain.html` verified; plain version already in production use).
- Source verification — 425 DX News / OPDX: **MEDIUM** (OPDX death verified HIGH; 425 DX News as replacement + swarl mirror format verified MEDIUM — one-page-sample basis, format could vary across bulletins).
- Client label-tracking approach (D-11): **MEDIUM** — two viable approaches (IntersectionObserver, timer-based); choose during implementation.
- Client hover-pause (D-13): **HIGH** — CSS-only `:hover { animation-play-state: paused }` is a well-established pattern.
- Validation test plan: **HIGH** — Vitest is the project's single test framework; all patterns verified from existing test files.
- Pitfalls: **HIGH** — 5 of the 7 pitfalls are problems already visible in `server/routes/dxpeditions.js` or `src/components/DXNewsTicker.jsx`.

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days — stable ecosystem, but 425 DX News mirror URL is the weakest point; re-verify swarl.org pattern if more than 4 weeks pass before implementation).
