/**
 * Spots routes — POTA, WWFF, SOTA.
 * Lines ~2657-2830 of original server.js
 */

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce } = ctx;

  // POTA Spots
  // POTA cache (1 minute)
  let potaCache = { data: null, timestamp: 0 };
  const POTA_CACHE_TTL = 90 * 1000; // 90 seconds (longer than 60s frontend poll to maximize cache hits)

  app.get('/api/pota/spots', async (req, res) => {
    try {
      // Return cached data if fresh
      if (potaCache.data && Date.now() - potaCache.timestamp < POTA_CACHE_TTL) {
        res.set('Cache-Control', 'no-store');
        return res.json(potaCache.data);
      }

      const response = await fetch('https://api.pota.app/spot/activator');
      const data = await response.json();

      // Log diagnostic info about the response
      if (Array.isArray(data) && data.length > 0) {
        logDebug(`[POTA] API returned ${data.length} spots.`);

        // Count coordinate coverage
        const withLatLon = data.filter((s) => s.latitude && s.longitude).length;
        const withGrid6 = data.filter((s) => s.grid6).length;
        const withGrid4 = data.filter((s) => s.grid4).length;
        const noCoords = data.filter((s) => !s.latitude && !s.longitude && !s.grid6 && !s.grid4).length;
        logDebug(`[POTA] Coords: ${withLatLon} lat/lon, ${withGrid6} grid6, ${withGrid4} grid4, ${noCoords} no coords`);
      }

      // Cache the response
      potaCache = { data, timestamp: Date.now() };

      res.json(data);
    } catch (error) {
      logErrorOnce('POTA', error.message);
      // Return stale cache on error, but only if less than 10 minutes old
      if (potaCache.data && Date.now() - potaCache.timestamp < 10 * 60 * 1000) return res.json(potaCache.data);
      res.status(500).json({ error: 'Failed to fetch POTA spots' });
    }
  });
  // WWFF Spots
  // WWFF cache (1 minute)
  let wwffCache = { data: null, timestamp: 0 };
  const WWFF_CACHE_TTL = 90 * 1000; // 90 seconds (longer than 60s frontend poll to maximize cache hits)

  app.get('/api/wwff/spots', async (req, res) => {
    try {
      // Return cached data if fresh
      if (wwffCache.data && Date.now() - wwffCache.timestamp < WWFF_CACHE_TTL) {
        res.set('Cache-Control', 'no-store');
        return res.json(wwffCache.data);
      }

      const response = await fetch('https://spots.wwff.co/static/spots.json');
      const data = await response.json();

      // Log diagnostic info about the response
      if (Array.isArray(data) && data.length > 0) {
        logDebug(`[WWFF] API returned ${data.length} spots.`);
      }

      // Cache the response
      wwffCache = { data, timestamp: Date.now() };

      res.json(data);
    } catch (error) {
      logErrorOnce('WWFF', error.message);
      // Return stale cache on error, but only if less than 10 minutes old
      if (wwffCache.data && Date.now() - wwffCache.timestamp < 10 * 60 * 1000) return res.json(wwffCache.data);
      res.status(500).json({ error: 'Failed to fetch WWFF spots' });
    }
  });

  // SOTA cache (2 minutes)
  let sotaCache = { data: null, timestamp: 0 };
  const SOTA_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
  let sotaSummits = { data: null, timestamp: 0 };
  const SOTASUMMITS_CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day
  let sotaEpoch = '';

  // SOTA Summits
  // SOTA publishes a CSV of the Summit detail every day. Save this into
  // a cache so we can look it up when loading the spots.

  async function checkSummitCache() {
    const now = Date.now();
    try {
      if (sotaSummits.data && now - sotaSummits.timestamp < SOTASUMMITS_CACHE_TTL) {
        return;
      }
      logDebug('[SOTA] Refreshing sotaSummits');
      const response = await fetch('https://storage.sota.org.uk/summitslist.csv');
      const data = await response.text();
      const Papa = require('papaparse');
      const csvresults = Papa.parse(data, {
        skipFirstNLines: 1,
        header: true,
        skipEmptyLines: true,
      });

      let summit = {};

      csvresults.data.forEach((obj) => {
        summit[obj['SummitCode']] = {
          latitude: obj['Latitude'],
          longitude: obj['Longitude'],
          name: obj['SummitName'],
          altM: obj['AltM'],
          points: obj['Points'],
        };
      });

      sotaSummits = {
        data: summit,
        timestamp: now,
      };
    } catch (error) {
      logErrorOnce('[SOTA]', error.message);
    }
  }
  checkSummitCache(); // Prime the sotaSummits cache

  // SOTA Spots
  app.get('/api/sota/spots', async (req, res) => {
    try {
      // Return cached data if fresh
      if (sotaCache.data && Date.now() - sotaCache.timestamp < SOTA_CACHE_TTL) {
        res.set('Cache-Control', 'no-store');
        return res.json(sotaCache.data);
      }

      // Check epoch to avoid unnecessary refetch (wrapped in try/catch so
      // a failing epoch endpoint doesn't 500 the whole spots route)
      let epoch = '';
      try {
        const ep = await fetch('https://api-db2.sota.org.uk/api/spots/epoch');
        epoch = await ep.text();
        if (epoch === sotaEpoch && sotaCache.data) {
          res.set('Cache-Control', 'no-store');
          return res.json(sotaCache.data);
        }
      } catch (e) {
        // Epoch check failed — fall through to normal spots fetch
      }

      checkSummitCache(); // Updates sotaSummits if required

      const response = await fetch('https://api-db2.sota.org.uk/api/spots/50/all/all');
      const data = await response.json();

      if (sotaSummits.data) {
        // If we have data in the sotaSummits cache, use it to populate summitDetails.
        // The SOTA API returns summitCode as the full reference (e.g. "W6/NS-288")
        data.forEach((s) => {
          s.summitDetails = sotaSummits.data[s.summitCode];
        });
      } else {
        logDebug('[SOTA] Summits Cache empty');
      }
      if (Array.isArray(data) && data.length > 0) {
        sotaEpoch = data[0].epoch;
        logDebug(`[SOTA] API returned ${data.length} spots.`);
      }

      // Cache the response
      sotaCache = { data, timestamp: Date.now() };

      res.json(data);
    } catch (error) {
      logErrorOnce('SOTA', error.message);
      // Return stale cache on error, but only if less than 10 minutes old
      if (sotaCache.data && Date.now() - sotaCache.timestamp < 10 * 60 * 1000) return res.json(sotaCache.data);
      res.status(500).json({ error: 'Failed to fetch SOTA spots' });
    }
  });
};
