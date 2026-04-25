/**
 * ng3k.js — NG3K DX/Contest Calendar source fetcher for the DX news aggregator.
 *
 * Reuses the existing ctx.dxpeditionCache populated by GET /api/dxpeditions
 * (server/routes/dxpeditions.js). Zero new HTTP traffic — this is the highest-
 * leverage architectural decision in Phase 02 (RESEARCH Pattern 4).
 *
 * Implements CONTEXT.md decisions:
 *   D-02 — NG3K freshness model is activity-window based (isActive || isUpcoming)
 *   D-05 — NG3K items bypass the 24h publish-date cutoff (handled in mergeNews)
 *   D-09 — publishDate = startDate for correct recency-sort ordering
 *   D-12 — sourceUrl = SOURCE_URLS.NG3K
 *
 * Cold-start behavior (RESEARCH Pitfall 3): if ctx.dxpeditionCache.data is null,
 * returns [] without throwing or triggering any HTTP fetch.
 */

'use strict';

const { SOURCE_URLS } = require('../../utils/dxNewsMerge.js');

/**
 * Trim a dxpedition `dates` string down to its leading date portion only.
 *
 * The upstream parser in dxpeditions.js is regex-based against NG3K's
 * plain-text page, and historically captured trailing noise like
 * "(...) Check here for pericontest activity too." or stray "Info: ..."
 * blocks. Even after the parser is tightened (see dxpeditions.js dateMatch),
 * keeping this defense in the consumer protects the news ticker against
 * future parser regressions.
 *
 * Recognized shapes:
 *   "Jan 5, 2026"
 *   "Jan 5-15, 2026"
 *   "Jan 5-Feb 16, 2026"
 *   "Apr 20 - May 4, 2026"
 *
 * @param {string|null|undefined} raw
 * @returns {string} the cleaned leading date, or '' if input was empty
 */
function cleanDateString(raw) {
  if (!raw) return '';
  const m = String(raw).match(/^([A-Za-z]{3}\s+\d{1,2}(?:\s*[-–]\s*(?:[A-Za-z]{3}\s+)?\d{1,2})?(?:,\s*\d{4})?)/);
  return m ? m[1].trim() : String(raw).trim();
}

/**
 * Reshape the dxpeditionCache data into normalized merged-feed items.
 * Pure function — no HTTP, no side effects.
 *
 * Only entries where isActive || isUpcoming are included (D-02).
 *
 * @param {{ dxpeditions: Array<object> }|null|undefined} cacheData — ctx.dxpeditionCache.data
 * @returns {Array<object>} Normalized items in merged-feed item shape
 */
function reshapeDxpeditionCache(cacheData) {
  const list = cacheData?.dxpeditions;
  if (!Array.isArray(list)) return [];

  const items = [];
  for (const d of list) {
    // D-02: only active and upcoming entries; skip past DXpeditions
    if (!(d.isActive || d.isUpcoming)) continue;

    // Build description: dates · bands · modes (filter out empty/falsy fields)
    const desc = [cleanDateString(d.dates), d.bands, d.modes].filter(Boolean).join(' · ');

    items.push({
      id: `ng3k:${d.callsign}`,
      title: `${d.callsign} — ${d.entity}`,
      description: desc,
      url: SOURCE_URLS.NG3K,
      publishDate: d.startDate, // D-09: use startDate for recency-sort ordering
      activityEndDate: d.endDate, // D-02: drives isFreshByActivityWindow in mergeNews
      callsign: d.callsign,
      source: 'NG3K',
      sourceUrl: SOURCE_URLS.NG3K,
    });
  }

  return items;
}

/**
 * Read ctx.dxpeditionCache.data and return reshaped items.
 * No HTTP fetch — delegates entirely to the cache populated by /api/dxpeditions.
 *
 * @param {object} [ctx] — server context object with ctx.dxpeditionCache
 * @returns {Promise<{ items: Array<object> }>}
 */
async function fetchNg3k(ctx) {
  const cacheData = ctx?.dxpeditionCache?.data;
  return { items: reshapeDxpeditionCache(cacheData) };
}

module.exports = { fetchNg3k, reshapeDxpeditionCache, cleanDateString };
