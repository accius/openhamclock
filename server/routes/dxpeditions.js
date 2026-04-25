/**
 * DXpeditions + DX News routes.
 * Lines ~2297-2655 of original server.js
 */

const { fetchDxnews } = require('./dxNewsSources/dxnews.js');
const { fetchDxWorld } = require('./dxNewsSources/dxWorld.js');
const { fetchNg3k } = require('./dxNewsSources/ng3k.js');
const { mergeNews } = require('../utils/dxNewsMerge.js');

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce } = ctx;

  // DX News - per-source caches with 30-min TTL and stale-fallback so one upstream
  // outage doesn't break the ticker. See .planning/phases/02-... for the full
  // design rationale (D-01 through D-10). Kept inside the factory so tests that
  // call route(app, ctx) get a fresh cache per invocation.
  const SOURCE_TTL = 30 * 60 * 1000;
  const sourceCaches = new Map();

  async function cachedFetch(name, fetcher) {
    const entry = sourceCaches.get(name) || { data: null, ts: 0 };
    if (entry.data && Date.now() - entry.ts < SOURCE_TTL) return entry.data;
    try {
      const fresh = await fetcher();
      sourceCaches.set(name, { data: fresh, ts: Date.now() });
      return fresh;
    } catch (e) {
      logErrorOnce(`dxnews:${name}`, e?.message || 'fetch failed');
      return entry.data || { items: [] };
    }
  }

  // DXpedition Calendar - fetches from NG3K ADXO plain text version
  const dxpeditionCache = { data: null, timestamp: 0, maxAge: 30 * 60 * 1000 }; // 30 min cache

  // Expose cache so dxcluster.js can cross-reference spotted callsigns
  // against active DXpeditions for accurate entity coordinates
  ctx.dxpeditionCache = dxpeditionCache;

  app.get('/api/dxpeditions', async (req, res) => {
    try {
      const now = Date.now();
      logDebug('[DXpeditions] API called');

      // Return cached data if fresh
      if (dxpeditionCache.data && now - dxpeditionCache.timestamp < dxpeditionCache.maxAge) {
        logDebug('[DXpeditions] Returning cached data:', dxpeditionCache.data.dxpeditions?.length, 'entries');
        return res.json(dxpeditionCache.data);
      }

      // Fetch NG3K ADXO plain text version
      logDebug('[DXpeditions] Fetching from NG3K...');
      const response = await fetch('https://www.ng3k.com/Misc/adxoplain.html');
      if (!response.ok) {
        logDebug('[DXpeditions] NG3K fetch failed:', response.status);
        throw new Error('Failed to fetch NG3K: ' + response.status);
      }

      let text = await response.text();
      logDebug('[DXpeditions] Received', text.length, 'bytes raw');

      // Strip HTML tags and decode entities - the "plain" page is actually HTML!
      // Remove script/style blocks repeatedly to handle nested/malformed tags
      let prev;
      do {
        prev = text;
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script(?:\s[^>]*)?>/gi, '');
      } while (text !== prev);
      do {
        prev = text;
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style(?:\s[^>]*)?>/gi, '');
      } while (text !== prev);
      // Strip any remaining opening script/style tags (malformed HTML)
      do {
        prev = text;
        text = text.replace(/<script[^>]*>/gi, '').replace(/<style[^>]*>/gi, '');
      } while (text !== prev);
      text = text
        .replace(/<br\s*\/?>/gi, '\n') // Convert br to newlines
        .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&') // Decode ampersand LAST to avoid double-unescaping
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      logDebug('[DXpeditions] Cleaned text length:', text.length);
      logDebug('[DXpeditions] First 500 chars:', text.substring(0, 500));

      const dxpeditions = [];

      // Each entry starts with a date pattern like "Jan 1-Feb 16, 2026 DXCC:"
      // Split on date patterns that are followed by DXCC
      const entryPattern =
        /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}[^D]*?DXCC:[^·]+?)(?=(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}|$)/gi;
      const entries = text.match(entryPattern) || [];

      logDebug('[DXpeditions] Found', entries.length, 'potential entries');

      // Log first 3 entries for debugging
      entries.slice(0, 3).forEach((e, i) => {
        logDebug(`[DXpeditions] Entry ${i}:`, e.substring(0, 150));
      });

      for (const entry of entries) {
        if (!entry.trim()) continue;

        // Skip header/footer/legend content
        if (
          entry.includes('ADXB=') ||
          entry.includes('OPDX=') ||
          entry.includes('425DX=') ||
          entry.includes('Last updated') ||
          entry.includes('Copyright') ||
          entry.includes('Expired Announcements') ||
          entry.includes('Table Version') ||
          entry.includes('About ADXO') ||
          entry.includes('Search ADXO') ||
          entry.includes('GazDX=') ||
          entry.includes('LNDX=') ||
          entry.includes('TDDX=') ||
          entry.includes('DXW.Net=') ||
          entry.includes('DXMB=')
        )
          continue;

        // Try multiple parsing strategies
        let callsign = null;
        let entity = null;
        let qsl = null;
        let info = null;
        let dateStr = null;

        // Strategy 1: "DXCC: xxx Callsign: xxx" format
        const dxccMatch = entry.match(/DXCC:\s*([^C\n]+?)(?=Callsign:|QSL:|Source:|Info:|$)/i);
        const callMatch = entry.match(/Callsign:\s*([A-Z0-9\/]+)/i);

        if (callMatch && dxccMatch) {
          callsign = callMatch[1].trim().toUpperCase();
          entity = dxccMatch[1].trim();
        }

        // Strategy 2: Look for callsign patterns directly (like "3Y0K" or "VP8/G3ABC")
        if (!callsign) {
          const directCallMatch = entry.match(/\b([A-Z]{1,2}\d[A-Z0-9]*[A-Z](?:\/[A-Z0-9]+)?)\b/);
          if (directCallMatch) {
            callsign = directCallMatch[1];
          }
        }

        // Strategy 3: Parse "Entity - Callsign" or similar patterns
        if (!callsign) {
          const altMatch = entry.match(/([A-Za-z\s&]+?)\s*[-–:]\s*([A-Z]{1,2}\d[A-Z0-9]*)/);
          if (altMatch) {
            entity = altMatch[1].trim();
            callsign = altMatch[2].trim();
          }
        }

        // Extract other fields
        const qslMatch = entry.match(/QSL:\s*([A-Za-z0-9]+)/i);
        const infoMatch = entry.match(/Info:\s*(.+)/i);
        // Date is at the start of entry: "Jan 1-Feb 16, 2026". Capture ONLY the
        // leading date — NG3K interleaves parenthetical reminders ("Check here
        // for pericontest activity too") between entries that the old greedy
        // `[^D]*?(?=DXCC:)` would sweep into the dates field.
        const dateMatch = entry.match(
          /^([A-Za-z]{3}\s+\d{1,2}(?:\s*[-–]\s*(?:[A-Za-z]{3}\s+)?\d{1,2})?(?:,\s*\d{4})?)/i,
        );

        qsl = qslMatch ? qslMatch[1].trim() : '';
        info = infoMatch ? infoMatch[1].trim() : '';
        dateStr = dateMatch ? dateMatch[1].trim() : '';

        // Skip if we couldn't find a callsign
        if (!callsign || callsign.length < 3) continue;

        // Skip obviously wrong matches
        if (/^(DXCC|QSL|INFO|SOURCE|THE|AND|FOR)$/i.test(callsign)) continue;

        // Log first few successful parses
        if (dxpeditions.length < 3) {
          logDebug(`[DXpeditions] Parsed: ${callsign} - ${entity} - ${dateStr}`);
        }

        // Try to extract entity from context if not found
        if (!entity && info) {
          // Look for "from Entity" or "fm Entity" patterns
          const fromMatch = info.match(/(?:from|fm)\s+([A-Za-z\s]+?)(?:;|,|$)/i);
          if (fromMatch) entity = fromMatch[1].trim();
        }

        // Parse dates
        let startDate = null;
        let endDate = null;
        let isActive = false;
        let isUpcoming = false;

        if (dateStr) {
          const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
          const datePattern =
            /([A-Za-z]{3})\s+(\d{1,2})(?:,?\s*(\d{4}))?(?:\s*[-–]\s*([A-Za-z]{3})?\s*(\d{1,2})(?:,?\s*(\d{4}))?)?/i;
          const dateParsed = dateStr.match(datePattern);

          if (dateParsed) {
            const currentYear = new Date().getFullYear();
            const startMonth = monthNames.indexOf(dateParsed[1].toLowerCase());
            const startDay = parseInt(dateParsed[2]);
            const startYear = dateParsed[3] ? parseInt(dateParsed[3]) : currentYear;

            const endMonthStr = dateParsed[4] || dateParsed[1];
            const endMonth = monthNames.indexOf(endMonthStr.toLowerCase());
            const endDay = parseInt(dateParsed[5]) || startDay + 14;
            const endYear = dateParsed[6] ? parseInt(dateParsed[6]) : startYear;

            if (startMonth >= 0) {
              startDate = new Date(startYear, startMonth, startDay);
              endDate = new Date(endYear, endMonth >= 0 ? endMonth : startMonth, endDay);

              if (endDate < startDate && !dateParsed[6]) {
                endDate.setFullYear(endYear + 1);
              }

              const today = new Date();
              today.setHours(0, 0, 0, 0);

              isActive = startDate <= today && endDate >= today;
              isUpcoming = startDate > today;
            }
          }
        }

        // Extract bands and modes
        const bandsMatch = entry.match(/(\d+(?:-\d+)?m)/g);
        const bands = bandsMatch ? [...new Set(bandsMatch)].join(' ') : '';

        const modesMatch = entry.match(/\b(CW|SSB|FT8|FT4|RTTY|PSK|FM|AM|DIGI)\b/gi);
        const modes = modesMatch ? [...new Set(modesMatch.map((m) => m.toUpperCase()))].join(' ') : '';

        dxpeditions.push({
          callsign,
          entity: entity || 'Unknown',
          dates: dateStr,
          qsl,
          info: (info || '').substring(0, 100),
          bands,
          modes,
          startDate: startDate?.toISOString(),
          endDate: endDate?.toISOString(),
          isActive,
          isUpcoming,
        });
      }

      // Remove duplicates by callsign
      const seen = new Set();
      const uniqueDxpeditions = dxpeditions.filter((d) => {
        if (seen.has(d.callsign)) return false;
        seen.add(d.callsign);
        return true;
      });

      // Sort: active first, then upcoming by start date
      uniqueDxpeditions.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        if (a.isUpcoming && !b.isUpcoming) return -1;
        if (!a.isUpcoming && b.isUpcoming) return 1;
        if (a.startDate && b.startDate) return new Date(a.startDate) - new Date(b.startDate);
        return 0;
      });

      logDebug('[DXpeditions] Parsed', uniqueDxpeditions.length, 'unique entries');
      if (uniqueDxpeditions.length > 0) {
        logDebug('[DXpeditions] First entry:', JSON.stringify(uniqueDxpeditions[0]));
      }

      const result = {
        dxpeditions: uniqueDxpeditions.slice(0, 50),
        active: uniqueDxpeditions.filter((d) => d.isActive).length,
        upcoming: uniqueDxpeditions.filter((d) => d.isUpcoming).length,
        source: 'NG3K ADXO',
        timestamp: new Date().toISOString(),
      };

      logDebug('[DXpeditions] Result:', result.active, 'active,', result.upcoming, 'upcoming');

      dxpeditionCache.data = result;
      dxpeditionCache.timestamp = now;

      res.json(result);
    } catch (error) {
      logErrorOnce('DXpeditions', error.message);

      if (dxpeditionCache.data) {
        logDebug('[DXpeditions] Returning stale cache');
        return res.json({ ...dxpeditionCache.data, stale: true });
      }

      res.status(500).json({ error: 'Failed to fetch DXpedition data' });
    }
  });

  // DX News - multi-source aggregator (dxnews.com + DX-World RSS + NG3K).
  // ctx._dxNewsFetchers allows tests to inject mock fetchers without module mocking.
  const _fetchers = ctx._dxNewsFetchers || {};
  const _fetchDxnews = _fetchers.fetchDxnews || fetchDxnews;
  const _fetchDxWorld = _fetchers.fetchDxWorld || fetchDxWorld;
  const _fetchNg3k = _fetchers.fetchNg3k || fetchNg3k;

  app.get('/api/dxnews', async (req, res) => {
    try {
      const [dxnews, dxWorld, ng3k] = await Promise.all([
        cachedFetch('dxnews', () => _fetchDxnews(ctx)),
        cachedFetch('dxWorld', () => _fetchDxWorld(ctx)),
        cachedFetch('ng3k', () => _fetchNg3k(ctx)),
      ]);

      const items = mergeNews({
        dxnews: dxnews.items || [],
        dxWorld: dxWorld.items || [],
        ng3k: ng3k.items || [],
      });

      res.json({ items, fetched: new Date().toISOString() });
    } catch (error) {
      logErrorOnce('DX News merge', error.message);
      res.status(500).json({ error: 'Failed to fetch DX news', items: [] });
    }
  });
};
