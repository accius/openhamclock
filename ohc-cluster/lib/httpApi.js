/**
 * HTTP API — what OpenHamClock instances actually consume.
 *
 * GET  /health                    liveness + feed status
 * GET  /api/stats                 ingest/server counters
 * GET  /api/dxcluster/spots       spots, dxspider-proxy-compatible shape
 *                                 ?limit=50&band=20m&mode=CW&humanOnly=1
 * POST /api/dxcluster/spot        submit a human spot from an OHC instance
 *                                 { spotter, call, freqKhz, comment? }
 */

const express = require('express');
const cors = require('cors');
const { isValidCallsign, baseCallsign } = require('./callsign.js');

const SUBMIT_WINDOW_MS = 60 * 1000;
const SUBMIT_MAX_PER_WINDOW = 10; // per IP — an OHC instance may proxy a few users
const submitTimesByIp = new Map();

function buildHttpApi({ store, feeds, telnetServer, hamqth, pollers = [], log, startTime, nodeCall }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '8kb' }));

  // Periodic sweep so the rate-limit map can't grow forever
  setInterval(
    () => {
      const cutoff = Date.now() - SUBMIT_WINDOW_MS;
      for (const [ip, times] of submitTimesByIp) {
        const fresh = times.filter((t) => t > cutoff);
        if (fresh.length === 0) submitTimesByIp.delete(ip);
        else submitTimesByIp.set(ip, fresh);
      }
    },
    5 * 60 * 1000,
  ).unref();

  app.get('/health', (req, res) => {
    const stats = store.stats();
    res.json({
      status: 'ok',
      nodeCall,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      spots: stats.activeSpots,
      feeds: feeds.map((f) => f.status()),
      hamqth: hamqth ? hamqth.status() : null,
      pollers: pollers.map((p) => p.status()),
      telnet: telnetServer ? telnetServer.status() : null,
    });
  });

  app.get('/api/stats', (req, res) => {
    res.json({
      store: store.stats(),
      feeds: feeds.map((f) => f.status()),
      hamqth: hamqth ? hamqth.status() : null,
      pollers: pollers.map((p) => p.status()),
      telnet: telnetServer ? telnetServer.status() : null,
    });
  });

  app.get('/api/dxcluster/spots', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const spots = store.query({
      limit,
      band: req.query.band || null,
      mode: req.query.mode ? String(req.query.mode).toUpperCase() : null,
      source: req.query.source || null,
      humanOnly: req.query.humanOnly === '1' || req.query.humanOnly === 'true',
    });
    // Shape matches dxspider-proxy so the main app can consume either
    res.json(
      spots.map((s) => ({
        spotter: s.spotter,
        spotterGrid: s.spotterGrid,
        freq: s.freq,
        freqKhz: s.freqKhz,
        call: s.call,
        dxGrid: s.dxGrid,
        comment: s.comment,
        time: s.time,
        mode: s.mode,
        band: s.band,
        snr: s.snr,
        skimmerCount: s.skimmerCount,
        timestamp: s.timestamp,
        source: s.source,
      })),
    );
  });

  app.post('/api/dxcluster/spot', (req, res) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const times = (submitTimesByIp.get(ip) || []).filter((t) => now - t < SUBMIT_WINDOW_MS);
    if (times.length >= SUBMIT_MAX_PER_WINDOW) {
      return res.status(429).json({ error: 'Rate limit: max 10 spots per minute' });
    }

    const { spotter, call, freqKhz, comment } = req.body || {};
    const freq = parseFloat(freqKhz);

    if (!isValidCallsign(String(spotter || ''))) {
      return res.status(400).json({ error: 'spotter must be a valid amateur callsign' });
    }
    if (!isValidCallsign(String(call || ''))) {
      return res.status(400).json({ error: 'call must be a valid amateur callsign' });
    }
    if (!Number.isFinite(freq) || freq < 100 || freq > 1300000) {
      return res.status(400).json({ error: 'freqKhz must be a frequency in kHz' });
    }

    times.push(now);
    submitTimesByIp.set(ip, times);

    const spot = store.add({
      spotter: baseCallsign(spotter),
      call: String(call).toUpperCase(),
      freqKhz: freq,
      comment: String(comment || '').slice(0, 60),
      timestamp: now,
      source: 'OHC',
      isSkimmer: false,
    });

    if (!spot) return res.status(409).json({ error: 'duplicate spot' });
    log('SPOT', `[HTTP] ${spot.spotter} spotted ${spot.call} on ${spot.freqKhz} kHz`);
    res.status(201).json({ ok: true, spot: { call: spot.call, freq: spot.freq, time: spot.time } });
  });

  return app;
}

module.exports = { buildHttpApi };
