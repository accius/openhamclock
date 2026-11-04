/**
 * IBP beacon measurement routes — SNR of the NCDXF/IARU beacons as measured
 * by Rig Bridge KiwiSDR beacon monitors (rig-bridge/plugins/kiwi-beacon-monitor.js).
 *
 *   POST /api/ibp/measurements   ingest a batch (requireWriteAuth + write limiter)
 *        body: { station: { callsign, grid, lat, lon }, kiwi: { id, name },
 *                measurements: [{ beacon, band, t, snrDb, levelDbm, noiseDbm, n }] }
 *   GET  /api/ibp/measurements?station=<call>&band=20m&hours=24[&since=<ms>]
 *   GET  /api/ibp/stations       who has posted recently
 *
 * Storage is in-memory and bounded (72 h, 20k per station, 50 stations) —
 * see server/utils/ibpMeasurements.js. Nothing here calls upstream.
 */

const { IbpMeasurementStore, MAX_BATCH } = require('../utils/ibpMeasurements');

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

module.exports = function (app, ctx) {
  const { logDebug, requireWriteAuth, writeLimiter } = ctx;
  const store = new IbpMeasurementStore();

  const sweeper = setInterval(() => store.sweep(), SWEEP_INTERVAL_MS);
  if (sweeper.unref) sweeper.unref();

  app.post('/api/ibp/measurements', requireWriteAuth, writeLimiter, (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'JSON body required' });
    if (!Array.isArray(body.measurements)) return res.status(400).json({ error: 'measurements array required' });
    if (body.measurements.length > MAX_BATCH) {
      return res.status(400).json({ error: `At most ${MAX_BATCH} measurements per request` });
    }
    const result = store.ingest(body);
    if (result.error) return res.status(400).json({ error: result.error });
    logDebug(`[IBP] ${result.station}: +${result.accepted} measurements (${result.rejected} rejected)`);
    res.json({ ok: true, ...result });
  });

  app.get('/api/ibp/stations', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ stations: store.listStations() });
  });

  app.get('/api/ibp/measurements', (req, res) => {
    const station = typeof req.query.station === 'string' ? req.query.station.trim() : '';
    if (!station) return res.status(400).json({ error: 'station query parameter required' });
    const result = store.query({
      station,
      band: typeof req.query.band === 'string' ? req.query.band : null,
      hours: req.query.hours,
      since: req.query.since,
    });
    res.set('Cache-Control', 'no-store');
    if (!result) return res.json({ station: station.toUpperCase(), measurements: [], known: false });
    res.json({ ...result, known: true });
  });

  return { store };
};
