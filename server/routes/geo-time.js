const { getTimezoneForLocation } = require('../utils/geoTz');

/**
 * Register geo-time API routes.
 * GET /api/geo-time?lat=X&lon=Y → { timezone, localTime, utcTime }
 */
module.exports = function (app) {
  app.get('/api/geo-time', (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'lat and lon are required and must be numbers' });
    }

    const tz = getTimezoneForLocation(lat, lon);

    const now = new Date();
    const utcTime = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(now);

    if (!tz) {
      return res.json({
        timezone: null,
        localTime: utcTime,
        utcTime,
      });
    }

    const localTime = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    }).format(now);

    res.json({ timezone: tz, localTime, utcTime });
  });
};
