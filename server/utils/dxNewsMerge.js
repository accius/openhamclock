/**
 * dxNewsMerge.js
 * Pure-function merge pipeline for the multi-source DX news aggregator.
 *
 * Implements CONTEXT.md decisions:
 *   D-04 — 24h freshness cutoff for publish-date sources
 *   D-05 / D-02 — NG3K uses activity-window freshness, not 24h cutoff
 *   D-07 — hide ticker when merged array is empty (enforced by returning [])
 *   D-08 — deduplicate by extracted callsign; freshest wins; null callsigns pass through
 *   D-09 — recency sort (newest first)
 *   D-10 — 20-item total cap
 *   D-12 — canonical source homepage URLs
 */

'use strict';

// ─── Callsign extraction ──────────────────────────────────────────────────────

/**
 * Callsign regex based on the in-production pattern at server/routes/dxpeditions.js:124,
 * extended to handle:
 *   - Digit-leading ITU prefixes: 3D2JK, 5B4AHJ, 4U1UN
 *   - Country-prefix/callsign format: VP8/G3ABC (prefix before slash + callsign after)
 *   - Callsign/suffix portable format: W1AW/M (callsign before slash + suffix after)
 *
 * Pattern: optional `PREFIX/` anchor + core callsign + optional `/SUFFIX`
 *   (?:[A-Z0-9]+\/)? — optional country prefix with slash (e.g. "VP8/")
 *   \d?[A-Z]{1,2}\d[A-Z0-9]*[A-Z] — core callsign body
 *   (?:\/[A-Z0-9]+)? — optional portable suffix (e.g. "/M", "/P")
 *
 * We match greedily from the outermost `\b` so VP8/G3ABC is captured as a whole token.
 * Requires at least one trailing letter in the core to avoid bare prefixes (W3, G4).
 * Matches: W1AW, 3D2JK, VP8/G3ABC, W1AW/M, OH2BH, ZS6CCY, 4U1UN, 5B4AGN
 */
const CALLSIGN_RE = /\b((?:[A-Z0-9]+\/)?\d?[A-Z]{1,2}\d[A-Z0-9]*[A-Z](?:\/[A-Z0-9]+)?)\b/;

/**
 * Words that structurally match CALLSIGN_RE but are not callsigns.
 * Checked case-insensitively after uppercasing the matched string.
 */
const CALLSIGN_DENY_LIST = new Set([
  'DXCC',
  'QSL',
  'INFO',
  'SOURCE',
  'THE',
  'AND',
  'FOR',
  'BUT',
  'DAY',
  'ARE',
  'GMT',
  'UTC',
]);

/**
 * Extract the first valid ham callsign from a text string.
 *
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
function extractCallsign(text) {
  if (!text) return null;
  const m = String(text).toUpperCase().match(CALLSIGN_RE);
  if (!m) return null;
  const call = m[1];
  if (CALLSIGN_DENY_LIST.has(call)) return null;
  return call;
}

// ─── Freshness filters ────────────────────────────────────────────────────────

/**
 * Returns true iff the item's publishDate is within `hoursCutoff` hours of `now`.
 * Items with missing or invalid publishDate return false (unknown age → exclude).
 * Implements D-04.
 *
 * Boundary: exactly at the cutoff is kept (< not <=), so a 24h-old item is included
 * but a 24h-1ms-old item is also included; a 24h+1ms-old item is excluded.
 *
 * @param {{ publishDate?: string }} item
 * @param {Date} now
 * @param {number} [hoursCutoff=24]
 * @returns {boolean}
 */
function isFreshByPublishDate(item, now, hoursCutoff = 24) {
  if (!item || !item.publishDate) return false;
  const pub = new Date(item.publishDate);
  if (isNaN(pub.getTime())) return false;
  return now - pub <= hoursCutoff * 3600 * 1000;
}

/**
 * Returns true iff the item's activityEndDate is >= now (today still within window = kept).
 * Items missing activityEndDate return false.
 * Implements D-02 + D-05 (NG3K activity-window freshness rule).
 *
 * @param {{ activityEndDate?: string }} item
 * @param {Date} now
 * @returns {boolean}
 */
function isFreshByActivityWindow(item, now) {
  if (!item || !item.activityEndDate) return false;
  const end = new Date(item.activityEndDate);
  if (isNaN(end.getTime())) return false;
  return end >= now;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Deduplicates items by callsign, keeping the item with the freshest publishDate.
 * Items with callsign === null always pass through (no dedup applied).
 * Ties broken by first occurrence in the array (deterministic source-order tiebreak:
 * callers should pass dxnews → dxworld → ng3k so earlier = higher-priority source).
 * Implements D-08.
 *
 * @param {Array<object>} items
 * @returns {Array<object>}
 */
function dedupByCallsign(items) {
  const best = new Map(); // callsign → item with freshest publishDate
  const nullItems = [];

  for (const item of items) {
    if (item.callsign === null || item.callsign === undefined) {
      nullItems.push(item);
      continue;
    }
    const existing = best.get(item.callsign);
    if (!existing) {
      best.set(item.callsign, item);
    } else {
      const existingDate = new Date(existing.publishDate).getTime();
      const itemDate = new Date(item.publishDate).getTime();
      if (itemDate > existingDate) {
        best.set(item.callsign, item);
      }
    }
  }

  return [...best.values(), ...nullItems];
}

// ─── Merge pipeline ───────────────────────────────────────────────────────────

/**
 * Merge items from all sources into a single freshness-filtered, deduped,
 * recency-sorted, 20-item-capped array.
 *
 * Pipeline (D-04 + D-05 + D-08 + D-09 + D-10):
 *   1. Filter dxnews + dxWorld by isFreshByPublishDate (24h cutoff)
 *   2. Filter ng3k by isFreshByActivityWindow (activity-window rule)
 *   3. Concatenate all filtered items
 *   4. dedupByCallsign (freshest wins per callsign)
 *   5. Sort by publishDate DESC (newest first)
 *   6. slice(0, 20)
 *
 * @param {{ dxnews: object[], dxWorld: object[], ng3k: object[] }} buckets
 * @param {Date} [now=new Date()] — injectable for testing; do NOT call new Date() inside
 * @returns {object[]}
 */
function mergeNews(buckets, now = new Date()) {
  const { dxnews = [], dxWorld = [], ng3k = [] } = buckets || {};

  const publishDateFiltered = [
    ...dxnews.filter((item) => isFreshByPublishDate(item, now)),
    ...dxWorld.filter((item) => isFreshByPublishDate(item, now)),
  ];

  const activityWindowFiltered = ng3k.filter((item) => isFreshByActivityWindow(item, now));

  const all = [...publishDateFiltered, ...activityWindowFiltered];
  const deduped = dedupByCallsign(all);
  deduped.sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());
  return deduped.slice(0, 20);
}

// ─── Source URL constants (D-12) ──────────────────────────────────────────────

/**
 * Canonical homepage URLs for each source, used as the click-target for the
 * dynamic section-header label (D-12) and as the sourceUrl field on every item.
 */
const SOURCE_URLS = {
  DXNEWS: 'https://dxnews.com/',
  'DX-WORLD': 'https://dx-world.net/',
  NG3K: 'https://www.ng3k.com/Misc/adxo.html',
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  extractCallsign,
  isFreshByPublishDate,
  isFreshByActivityWindow,
  dedupByCallsign,
  mergeNews,
  SOURCE_URLS,
  CALLSIGN_RE, // exported for source fetchers' use
};
