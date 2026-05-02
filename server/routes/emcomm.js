/**
 * EmComm routes — NWS Alerts, FEMA Shelters, FEMA Disaster Declarations.
 * Zero-config public APIs for emergency communications dashboard.
 */

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce } = ctx;

  const maintainCache = (cache, ttlMs, maxEntries, label = 'Cache') => {
    const now = Date.now();
    let purged = 0;

    // Remove stale entries
    for (const key of Object.keys(cache)) {
      if (now - cache[key].timestamp > ttlMs * 2) {
        delete cache[key];
        purged++;
      }
    }

    // Enforce max size by evicting oldest
    const remaining = Object.keys(cache);
    if (remaining.length > maxEntries) {
      remaining
        .sort((a, b) => cache[a].timestamp - cache[b].timestamp)
        .slice(0, remaining.length - maxEntries)
        .forEach((key) => {
          delete cache[key];
          purged++;
        });
    }

    if (purged > 0) {
      logDebug(`[${label}] purged ${purged} stale entries, ${Object.keys(cache).length} remaining`);
    }
  };

  // --- NWS Alerts ---
  // Cache keyed on rounded lat/lon, 3 minute TTL
  const alertsCache = {};
  const ALERTS_CACHE_TTL = 3 * 60 * 1000;
  const ALERTS_CACHE_MAX_ENTRIES = 200; // Hard cap on cache entries

  // Periodic cleanup: purge expired cache entries every 10 minutes
  setInterval(
    () => {
      maintainCache(alertsCache, ALERTS_CACHE_TTL, ALERTS_CACHE_MAX_ENTRIES, 'Alerts cache');
    },
    10 * 60 * 1000,
  );

  app.get('/api/emcomm/alerts', async (req, res) => {
    try {
      const { lat, lon } = req.query;
      if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

      // Round to 2 decimals for cache key
      const key = `${parseFloat(lat).toFixed(2)},${parseFloat(lon).toFixed(2)}`;

      if (alertsCache[key] && Date.now() - alertsCache[key].timestamp < ALERTS_CACHE_TTL) {
        res.set('Cache-Control', 'no-store');
        return res.json(alertsCache[key].data);
      }

      const response = await fetch(
        `https://api.weather.gov/alerts/active?point=${encodeURIComponent(lat)},${encodeURIComponent(lon)}`,
        {
          headers: {
            'User-Agent': `OpenHamClock/${ctx.CONFIG?.version || '1.0'}`,
            Accept: 'application/geo+json',
          },
        },
      );
      const json = await response.json();

      const alerts = (json.features || []).map((f) => ({
        id: f.properties.id,
        event: f.properties.event,
        severity: f.properties.severity,
        urgency: f.properties.urgency,
        headline: f.properties.headline,
        description: f.properties.description,
        instruction: f.properties.instruction,
        areaDesc: f.properties.areaDesc,
        onset: f.properties.onset,
        expires: f.properties.expires,
        geometry: f.geometry,
      }));

      logDebug(`[EmComm] NWS alerts: ${alerts.length} for ${key}`);
      alertsCache[key] = { data: alerts, timestamp: Date.now() };
      res.json(alerts);
    } catch (error) {
      logErrorOnce('EmComm-Alerts', error.message);
      // Return stale cache if available
      const key = `${parseFloat(req.query.lat || 0).toFixed(2)},${parseFloat(req.query.lon || 0).toFixed(2)}`;
      if (alertsCache[key] && Date.now() - alertsCache[key].timestamp < 10 * 60 * 1000) {
        return res.json(alertsCache[key].data);
      }
      res.status(500).json({ error: 'Failed to fetch NWS alerts' });
    }
  });

  // --- FEMA Open Shelters ---
  const sheltersCache = {};
  const SHELTERS_CACHE_TTL = 10 * 60 * 1000;
  const SHELTERS_MAX_ENTRIES = 200; // Hard cap on cache entries

  // Periodic cleanup: purge expired cache entries every 10 minutes
  setInterval(
    () => {
      maintainCache(sheltersCache, SHELTERS_CACHE_TTL, SHELTERS_MAX_ENTRIES, 'Shelters cache');
    },
    10 * 60 * 1000,
  );

  app.get('/api/emcomm/shelters', async (req, res) => {
    try {
      const { lat, lon, radius = 200 } = req.query;
      if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

      const latF = parseFloat(lat);
      const lonF = parseFloat(lon);
      const radiusKm = parseFloat(radius);
      const key = `${latF.toFixed(1)},${lonF.toFixed(1)},${radiusKm}`;

      if (sheltersCache[key] && Date.now() - sheltersCache[key].timestamp < SHELTERS_CACHE_TTL) {
        res.set('Cache-Control', 'no-store');
        return res.json(sheltersCache[key].data);
      }

      // Convert radius to approximate bounding box
      const latDelta = radiusKm / 111;
      const lonDelta = radiusKm / (111 * Math.cos((latF * Math.PI) / 180));
      const bbox = `${lonF - lonDelta},${latF - latDelta},${lonF + lonDelta},${latF + latDelta}`;

      const params = new URLSearchParams({
        where: '1=1',
        geometry: bbox,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        outFields: '*',
        f: 'json',
      });

      const response = await fetch(
        `https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/MapServer/0/query?${params}`,
      );
      const json = await response.json();

      const shelters = (json.features || []).map((f) => {
        const a = f.attributes;
        return {
          id: a.OBJECTID || a.SHELTER_ID,
          name: a.SHELTER_NAME,
          address: a.ADDRESS,
          city: a.CITY,
          state: a.STATE,
          lat: f.geometry?.y,
          lon: f.geometry?.x,
          status: a.SHELTER_STATUS,
          evacuationCapacity: a.EVACUATION_CAPACITY,
          currentPopulation: a.TOTAL_POPULATION || 0,
          wheelchairAccessible: a.WHEELCHAIR_ACCESSIBLE === 'Y',
          petFriendly: a.ACCEPTING_PETS === 'Y',
        };
      });

      logDebug(`[EmComm] FEMA shelters: ${shelters.length} within ${radiusKm}km of ${key}`);
      sheltersCache[key] = { data: shelters, timestamp: Date.now() };
      res.json(shelters);
    } catch (error) {
      logErrorOnce('EmComm-Shelters', error.message);
      const key = `${parseFloat(req.query.lat || 0).toFixed(1)},${parseFloat(req.query.lon || 0).toFixed(1)},${req.query.radius || 200}`;
      if (sheltersCache[key] && Date.now() - sheltersCache[key].timestamp < 10 * 60 * 1000) {
        return res.json(sheltersCache[key].data);
      }
      res.status(500).json({ error: 'Failed to fetch FEMA shelters' });
    }
  });

  // --- FEMA Disaster Declarations ---
  const disastersCache = {};
  const DISASTERS_CACHE_TTL = 30 * 60 * 1000;
  const DISASTERS_MAX_ENTRIES = 200; // Hard cap on cache entries

  // Periodic cleanup: purge expired cache entries every 10 minutes
  setInterval(
    () => {
      maintainCache(disastersCache, DISASTERS_CACHE_TTL, DISASTERS_MAX_ENTRIES, 'Disasters cache');
    },
    10 * 60 * 1000,
  );

  app.get('/api/emcomm/disasters', async (req, res) => {
    try {
      const { state } = req.query;
      if (!state) return res.status(400).json({ error: 'state parameter required (2-letter code)' });

      const st = state.toUpperCase();
      if (disastersCache[st] && Date.now() - disastersCache[st].timestamp < DISASTERS_CACHE_TTL) {
        res.set('Cache-Control', 'no-store');
        return res.json(disastersCache[st].data);
      }

      // Last 30 days
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const filter = `state eq '${st}' and declarationDate ge '${since}'`;

      const response = await fetch(
        `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=${encodeURIComponent(filter)}&$orderby=declarationDate desc&$top=50`,
      );
      const json = await response.json();

      const disasters = (json.DisasterDeclarationsSummaries || []).map((d) => ({
        id: d.id,
        disasterNumber: d.disasterNumber,
        state: d.state,
        declarationType: d.declarationType,
        declarationTitle: d.declarationTitle,
        declarationDate: d.declarationDate,
        incidentType: d.incidentType,
      }));

      logDebug(`[EmComm] FEMA disasters: ${disasters.length} for ${st}`);
      disastersCache[st] = { data: disasters, timestamp: Date.now() };
      res.json(disasters);
    } catch (error) {
      logErrorOnce('EmComm-Disasters', error.message);
      const st = (req.query.state || '').toUpperCase();
      if (disastersCache[st] && Date.now() - disastersCache[st].timestamp < 10 * 60 * 1000) {
        return res.json(disastersCache[st].data);
      }
      res.status(500).json({ error: 'Failed to fetch FEMA disasters' });
    }
  });
};
