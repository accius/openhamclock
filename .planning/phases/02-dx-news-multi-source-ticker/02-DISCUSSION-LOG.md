# Phase 2: DX news multi-source ticker — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `02-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 02-dx-news-multi-source-ticker
**Areas discussed:** Source list, Staleness threshold, Rotation strategy, Source attribution

---

## Area 1: Source list

### Q1.1 — Which sources to aggregate?

| Letter | Source                               | Selected |
| ------ | ------------------------------------ | -------- |
| a      | dxnews.com (existing)                | ✓        |
| b      | DX-World                             | ✓        |
| c      | ARRL News                            |          |
| d      | 425 DX News                          |          |
| e      | OPDX Bulletin                        | ✓        |
| f      | NG3K DX/Contest Calendar             | ✓        |
| g      | POTA news                            |          |
| h      | SOTA news                            |          |
| i      | QRZ.com news                         |          |
| j      | eHam.net news                        |          |
| k      | Reverse Beacon Network announcements |          |

**User's choice:** a, b, e, f
**Notes:** Four sources locked. Mix of one HTML scrape (existing dxnews), one RSS-likely (DX-World), one weekly text bulletin (OPDX), one structured calendar (NG3K).

### Q1.2 — NG3K freshness handling for future-dated activity announcements

| Option | Description                                                                        | Selected |
| ------ | ---------------------------------------------------------------------------------- | -------- |
| a      | Include while activity end-date hasn't passed (treat as live "what to listen for") | ✓        |
| b      | Only include items where activity has started                                      |          |
| c      | Only filter by publish date, ignore activity dates                                 |          |
| d      | Drop NG3K from list                                                                |          |

**User's choice:** a
**Notes:** NG3K gets activity-window freshness, distinct from the standard publish-date freshness used by the other sources.

### Q1.3 — OPDX bulletin handling (weekly digest of 30-50 items)

| Option | Description                                                               | Selected |
| ------ | ------------------------------------------------------------------------- | -------- |
| a      | One ticker item per bulletin, links to full bulletin                      |          |
| b      | Parse out individual items from the bulletin, each becomes a ticker entry | ✓        |
| c      | Drop OPDX                                                                 |          |

**User's choice:** b
**Notes:** Adds parser complexity (per-item extraction from text bulletins) but yields much higher information density in the ticker.

---

## Area 2: Staleness threshold

### Q2.1 — Cutoff for "stale"

| Option | Description                 | Selected |
| ------ | --------------------------- | -------- |
| a      | 24 hours — strictly current | ✓        |
| b      | 3 days                      |          |
| c      | 7 days                      |          |
| d      | 14 days                     |          |
| e      | Per-source threshold        |          |

**User's choice:** a
**Notes:** Aggressive cutoff. Doesn't apply uniformly — NG3K uses activity-window per Q1.2a; OPDX-parsed items use their extracted per-item dates against the 24h rule when extractable.

### Q2.2 — Behavior when nothing is fresh

| Option | Description                             | Selected |
| ------ | --------------------------------------- | -------- |
| a      | Hide the ticker entirely                | ✓        |
| b      | Show "📰 No recent DX news" placeholder |          |
| c      | Show stale items as fallback            |          |
| d      | Extend the cache fallback window        |          |

**User's choice:** a
**Notes:** Consistent with the strict "no stale content" principle. Reclaim the space rather than show a "nothing here" placeholder.

### Q2.3 — Cross-source de-duplication

| Option | Description                                      | Selected |
| ------ | ------------------------------------------------ | -------- |
| a      | Show everything (no de-dup)                      |          |
| b      | Title fuzzy-match                                |          |
| c      | Callsign-based clustering, freshest version wins | ✓        |
| d      | De-dup with "(also covered by: X, Y)" badge      |          |

**User's choice:** c
**Notes:** Smart but requires reliable callsign extraction. Items with no extractable callsign pass through without de-dup.

---

## Area 3: Rotation strategy

### Q3.1 — Item interleaving

| Option | Description                                   | Selected |
| ------ | --------------------------------------------- | -------- |
| a      | Round-robin (A1, B1, C1, D1, A2...)           |          |
| b      | Per-source segments (all A, then all B, ...)  |          |
| c      | Recency-sorted, source-agnostic, newest first | ✓        |
| d      | Weighted by source volume                     |          |

**User's choice:** c
**Notes:** Soft tension with user's original "rotate through sources" framing was flagged. User confirmed by moving on. Interpretation: rotation emerges as different sources publish at different times rather than via forced cycling.

### Q3.2 — Total item cap

| Option | Description    | Selected |
| ------ | -------------- | -------- |
| a      | 20 items total | ✓        |
| b      | 40 items total |          |
| c      | No cap         |          |
| d      | Per-source cap |          |

**User's choice:** a
**Notes:** Same magnitude as current ticker. Predictable scroll-cycle length.

---

## Area 4: Source attribution

### Q4.1 — How each item shows its source

| Option | Description                                            | Selected |
| ------ | ------------------------------------------------------ | -------- |
| a      | Inline prefix: "[DX-WORLD] Title — desc"               |          |
| b      | Color-coded by source                                  |          |
| c      | Section-header sync — label updates per current source | ✓        |
| d      | No attribution                                         |          |

**User's choice:** c
**Notes:** Replaces the static "📰 DX NEWS" label with one that follows the current source. Will change frequently with recency-sorted ordering — dwell-period tuning left to planner.

### Q4.2 — Section-header link target

| Option | Description                                | Selected |
| ------ | ------------------------------------------ | -------- |
| a      | Link to current source                     | ✓        |
| b      | Link to a static "all sources" page        |          |
| c      | Drop the link                              |          |
| d      | Single static link (e.g., dxnews.com only) |          |

**User's choice:** a
**Notes:** Pairs with Q4.1c — header text and link both follow current source.

### Q4.3 — Item click behavior

| Option | Description                                                     | Selected |
| ------ | --------------------------------------------------------------- | -------- |
| a      | Click anywhere pauses (current behavior)                        |          |
| b      | Click item opens URL; click empty space pauses                  |          |
| c      | Hover pauses, click opens article                               | ✓        |
| d      | Add a "↗" icon per item that opens URL; text-click still pauses |          |

**User's choice:** c
**Notes:** Replaces `onClick={() => setPaused(!paused)}` at `DXNewsTicker.jsx:218`. Pause becomes a hover affordance, click becomes navigation.

---

## Claude's Discretion

- Exact callsign-extraction regex (D-08)
- Whether to add a dwell/hold period to dynamic header label changes (D-11) if flickering becomes problematic
- Canonical homepage URLs for each source (D-12)
- Hover-pause implementation tuning (full pause vs. slow scroll, transition timing) (D-13)
- Internal merged-feed item shape (must include source name, sourceUrl, optional activityEndDate, stable id)
- Whether to expose per-source last-fetched timestamps in API response for debugging
- Server-side per-source error isolation (existing dxpeditions.js pattern continues to apply)

## Deferred Ideas

- Settings UI to enable/disable individual sources — future phase
- Real-time RBN-style spot/announcement feed — explicitly rejected
- Section-header dwell/hold period as a user-visible option — Claude's discretion
- "Also covered by: X, Y" callsign de-dup badge — rejected as too complex
- Color-coded source labels — rejected as accessibility-questionable
- Per-source last-fetched timestamps in API response — observability addition
- Translations for new English-only i18n keys — same pattern as Phase 1
