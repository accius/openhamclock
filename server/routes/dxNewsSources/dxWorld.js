/**
 * dxWorld.js — DX-World RSS source fetcher for the DX news multi-source aggregator.
 *
 * Fetches https://www.dx-world.net/feed/ using rss-parser@3.13.0 and returns
 * normalized merged-feed items with callsigns extracted from titles.
 *
 * DX-World title convention: "CALLSIGN – Location" (callsign at position 0,
 * en-dash separator) — makes callsign extraction trivial and reliable.
 *
 * Implements CONTEXT.md decisions:
 *   D-04 — 24h freshness cutoff (applied by mergeNews, not this fetcher)
 *   D-08 — callsign extracted from title-first (RESEARCH Pitfall 2)
 *   D-12 — sourceUrl = SOURCE_URLS['DX-WORLD']
 */

'use strict';

const Parser = require('rss-parser');
const { extractCallsign, SOURCE_URLS } = require('../../utils/dxNewsMerge.js');

const parser = new Parser({
  timeout: 10_000,
  headers: { 'User-Agent': 'OpenHamClock/3.13.1 (amateur radio dashboard)' },
});

// The live feed URL redirects to https://www.dx-world.net/feed/ — follow redirect
const DX_WORLD_FEED_URL = 'https://dx-world.net/feed/';

/**
 * Parse an rss-parser feed object into normalized merged-feed items.
 * Pure function — no HTTP, no side effects.
 *
 * @param {object|null} feed — the parsed feed object from rss-parser.parseURL/parseString
 * @returns {Array<object>} Normalized items in merged-feed item shape
 */
function parseDxWorldFeed(feed) {
  if (!feed || !Array.isArray(feed.items)) return [];

  const items = [];
  for (const raw of feed.items) {
    // Skip items with unparseable pubDate — cannot freshness-check without a date
    const dt = new Date(raw.pubDate);
    if (isNaN(dt.getTime())) continue;

    items.push({
      id: `dxworld:${raw.guid || raw.link}`,
      title: raw.title || '',
      // Prefer plain-text snippet; fall back to HTML content with tags stripped
      description: (raw.contentSnippet || raw.content || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
      url: raw.link,
      publishDate: dt.toISOString(),
      // Title-first extraction per RESEARCH Pitfall 2 (highest signal — callsign at pos 0)
      callsign: extractCallsign(raw.title),
      source: 'DX-WORLD',
      sourceUrl: SOURCE_URLS['DX-WORLD'],
    });
  }

  return items;
}

/**
 * Fetch the DX-World RSS feed and return normalized items.
 *
 * @param {object} [ctx] — server context object (unused for DX-World, included for API symmetry)
 * @returns {Promise<{ items: Array<object> }>}
 */
async function fetchDxWorld(ctx) {
  const feed = await parser.parseURL(DX_WORLD_FEED_URL);
  return { items: parseDxWorldFeed(feed) };
}

module.exports = { fetchDxWorld, parseDxWorldFeed };
