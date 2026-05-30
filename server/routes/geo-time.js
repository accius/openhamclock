const { getTimezoneForLocation } = require('../utils/geoTz');
const { latLonToMaidenhead, maidenheadToLatLon } = require('../utils/grid');

/**
 * Register geo-time API routes.
 *
 * GET /api/geo-time?lat=X&lon=Y → { timezone, localTime, utcTime, grid }
 * GET /api/geo-time?grid=IM58   → same (lat/lon takes precedence if both given)
 */
module.exports = function (app) {
  app.get('/api/geo-time', (req, res) => {
    let lat = parseFloat(req.query.lat);
    let lon = parseFloat(req.query.lon);

    // If lat/lon provided, use them (grid param ignored)
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return respondWithCoords(res, lat, lon);
    }

    // If grid provided, convert to lat/lon
    const grid = (req.query.grid || '').toUpperCase().trim();
    if (grid) {
      let coords;
      try {
        coords = maidenheadToLatLon(grid);
      } catch {
        return res.status(400).json({ error: `Invalid grid locator: ${req.query.grid}` });
      }
      lat = coords.lat;
      lon = coords.lon;
    } else {
      return res.status(400).json({ error: 'lat+lon or grid is required' });
    }

    return respondWithCoords(res, lat, lon);
  });
};

function respondWithCoords(res, lat, lon) {
  const tz = getTimezoneForLocation(lat, lon);

  const now = new Date();
  const utcTime = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(now);

  const grid = latLonToMaidenhead({ lat, lon }, 6);

  if (!tz) {
    return res.json({
      timezone: null,
      localTime: utcTime,
      utcTime,
      grid,
    });
  }

  const localTime = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(now);

  res.json({
    timezone: tz,
    localTime,
    utcTime,
    grid,
  });
}
