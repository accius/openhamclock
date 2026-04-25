/**
 * dxnews.js — dxnews.com source fetcher for the DX news multi-source aggregator.
 *
 * Lifts the dxnews.com HTML scrape out of server/routes/dxpeditions.js:288-339
 * into a standalone module that returns the normalized merged-feed item shape.
 *
 * The original block-splitting regex logic is preserved verbatim (production-tested).
 * Normalization additions: id, callsign, source, sourceUrl, ISO publishDate.
 *
 * NOTE: The original inline scrape in dxpeditions.js is intentionally left untouched
 * until Plan 03 performs the cutover to the multi-source aggregator.
 */

'use strict';

const { extractCallsign, SOURCE_URLS } = require('../../utils/dxNewsMerge.js');

const DXNEWS_BASE = 'https://dxnews.com';

/**
 * Parse dxnews.com homepage HTML into normalized merged-feed items.
 * Pure function — no HTTP, no side effects.
 *
 * @param {string|null|undefined} html
 * @returns {Array<object>} Normalized items in merged-feed item shape
 */
function parseDxnewsHtml(html) {
  if (!html || typeof html !== 'string') return [];

  const items = [];

  // Split on the article block delimiter used in production (dxpeditions.js:302)
  const blocks = html.split(/<h3[^>]*>\s*<a\s+href="/);

  for (let i = 1; i < blocks.length && items.length < 20; i++) {
    try {
      const block = blocks[i];

      // Extract URL (everything before the closing quote)
      const urlMatch = block.match(/^([^"]+)"/);
      // Extract title (from title="..." attribute)
      const titleMatch = block.match(/title="([^"]+)"/);
      // Extract date (YYYY-MM-DD HH:MM:SS format used by dxnews.com)
      const dateMatch = block.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
      // Extract description — text after the date, before view/comment stats
      const descParts = block.split(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);

      let desc = '';
      if (descParts[1]) {
        desc = descParts[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/Views\s*\d+.*/i, '')
          .replace(/Comments\s*\d+.*/i, '')
          .replace(/\d+%/, '')
          .replace(/More\.\.\..*/i, '')
          .trim()
          .substring(0, 200);
      }

      if (titleMatch && urlMatch) {
        const rawUrl = urlMatch[1];
        // Handle both absolute (https://dxnews.com/...) and relative (path/...) URLs
        const absoluteUrl = rawUrl.startsWith('http') ? rawUrl : DXNEWS_BASE + '/' + rawUrl;

        // Normalize publish date to ISO 8601 UTC
        // dxnews.com dates are "YYYY-MM-DD HH:MM:SS" — treat as UTC per RESEARCH Pitfall 1
        const publishDate = dateMatch ? new Date(dateMatch[1].replace(' ', 'T') + 'Z').toISOString() : null;

        if (!publishDate) continue; // skip items with no parseable date

        const title = titleMatch[1];

        items.push({
          id: `dxnews:${absoluteUrl}`,
          title,
          description: desc || title,
          url: absoluteUrl,
          publishDate,
          callsign: extractCallsign(`${title} ${desc}`),
          source: 'DXNEWS',
          sourceUrl: SOURCE_URLS.DXNEWS,
        });
      }
    } catch (_e) {
      // Skip malformed entries — mirrors dxpeditions.js:336 silent catch
    }
  }

  return items;
}

/**
 * Fetch dxnews.com homepage and return normalized items.
 * Uses ctx.fetch (server convention from dxpeditions.js:7,29,288).
 *
 * @param {{ fetch: Function }} ctx  — server context object with fetch method
 * @returns {Promise<{ items: Array<object> }>}
 */
async function fetchDxnews(ctx) {
  const response = await ctx.fetch(DXNEWS_BASE + '/', {
    headers: { 'User-Agent': 'OpenHamClock/3.13.1 (amateur radio dashboard)' },
  });
  const html = await response.text();
  return { items: parseDxnewsHtml(html) };
}

module.exports = { fetchDxnews, parseDxnewsHtml };
