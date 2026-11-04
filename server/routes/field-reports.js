/**
 * EmComm Field Reports routes.
 *
 * Ingest endpoint for EmComm forms forwarded by rig-bridge: Winlink Express
 * form exports from the winlink-express-csv plugin (backlog 999.1), and
 * NBEMS flmsg forms (ICS-213, radiograms, ...) from the fldigi plugin's
 * folder watcher. Each plugin POSTs new forms here; the EmComm layout lists
 * them and plots those with positions.
 *
 * Auth: mirrors POST /api/aprs/local — an open local-ingest endpoint intended
 * for the rig-bridge process on the same host (fire-and-forget POSTs with no
 * credentials), protected by a per-IP ingest limit (30/min) and strict input
 * sanitization/caps rather than a key.
 *
 * Storage: in-memory, newest last, capped at 500 reports, with optional file
 * persistence using the same writable-path waterfall as relay-tokens.json so
 * reports survive a server restart during an operation.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (app, ctx) {
  const { ROOT_DIR, logInfo, logWarn, logDebug } = ctx;
  const ingest = ctx.ingestLimiter || (() => (req, res, next) => next());

  const MAX_REPORTS = 500;
  const MAX_BATCH = 100; // per-POST cap
  const STR_MAX = 200; // generic string field cap
  const TEXT_MAX = 2000; // free-text cap
  const MAX_EXTRA_KEYS = 30; // preserved unknown-column cap per report

  // ─── Persistence (relay-tokens.json waterfall pattern) ───────────────────
  const FIELD_REPORTS_FILE = (() => {
    const candidates = [
      process.env.FIELD_REPORTS_FILE,
      '/data/field-reports.json',
      path.join(ROOT_DIR, 'data', 'field-reports.json'),
      '/tmp/openhamclock-field-reports.json',
    ];
    for (const p of candidates) {
      if (!p) continue;
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        return p;
      } catch {
        continue;
      }
    }
    return '/tmp/openhamclock-field-reports.json';
  })();

  // reports: newest last; ids: dedupe index (row content hash from the plugin)
  let reports = [];
  const ids = new Set();

  try {
    const raw = fs.readFileSync(FIELD_REPORTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      reports = parsed.slice(-MAX_REPORTS);
      for (const r of reports) if (r.id) ids.add(r.id);
      logInfo(`[FieldReports] Loaded ${reports.length} report(s) from ${FIELD_REPORTS_FILE}`);
    }
  } catch {
    /* file absent on first run — normal */
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.writeFileSync(FIELD_REPORTS_FILE, JSON.stringify(reports), 'utf8');
      } catch (err) {
        logWarn(`[FieldReports] Could not persist reports: ${err.message}`);
      }
    }, 2000);
    saveTimer.unref?.();
  }

  // ─── Sanitization ────────────────────────────────────────────────────────
  function cleanStr(v, max) {
    if (v == null) return '';
    return String(v).substring(0, max);
  }

  function cleanCoord(v, limit) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
  }

  function sanitizeReport(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = cleanStr(raw.id, 64);
    if (!id) return null;
    const callsign = cleanStr(raw.callsign, 20).toUpperCase();
    const formType = cleanStr(raw.formType, STR_MAX);
    const text = cleanStr(raw.text, TEXT_MAX);
    if (!callsign && !formType && !text) return null;

    const extra = {};
    if (raw.extra && typeof raw.extra === 'object' && !Array.isArray(raw.extra)) {
      let count = 0;
      for (const [k, v] of Object.entries(raw.extra)) {
        if (count >= MAX_EXTRA_KEYS) break;
        const key = cleanStr(k, 64);
        if (!key) continue;
        extra[key] = cleanStr(v, STR_MAX);
        count++;
      }
    }

    const ts = typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) ? raw.timestamp : null;
    // Which ingest path delivered it ('winlink-express-csv', 'nbems-flmsg', …)
    // so the panel and map can label Winlink and NBEMS traffic apart.
    const source = cleanStr(raw.receivedVia ?? raw.source, 40).replace(/[^a-z0-9-]/gi, '');
    return {
      id,
      source,
      callsign,
      formType,
      lat: cleanCoord(raw.lat, 90),
      lon: cleanCoord(raw.lon, 180),
      // Report's own timestamp (from the form) when parseable; ingest time otherwise.
      timestamp: ts ?? Date.now(),
      receivedAt: Date.now(),
      text,
      extra,
    };
  }

  // ─── POST /api/emcomm/field-reports — ingest from rig-bridge ─────────────
  app.post('/api/emcomm/field-reports', ingest(30), (req, res) => {
    const batch = req.body?.reports;
    if (!Array.isArray(batch)) {
      return res.status(400).json({ error: 'Missing reports array' });
    }

    let added = 0;
    let duplicates = 0;
    let invalid = 0;
    for (const raw of batch.slice(0, MAX_BATCH)) {
      const report = sanitizeReport(raw);
      if (!report) {
        invalid++;
        continue;
      }
      if (ids.has(report.id)) {
        duplicates++;
        continue;
      }
      ids.add(report.id);
      reports.push(report);
      added++;
    }

    // Cap: drop oldest, keep the dedupe index in sync
    if (reports.length > MAX_REPORTS) {
      const dropped = reports.splice(0, reports.length - MAX_REPORTS);
      for (const r of dropped) ids.delete(r.id);
    }

    if (added > 0) {
      scheduleSave();
      logInfo(
        `[FieldReports] Ingested ${added} report(s) (${duplicates} dup, ${invalid} invalid) — ${reports.length} stored`,
      );
    } else {
      logDebug(`[FieldReports] Ingest batch: 0 new (${duplicates} dup, ${invalid} invalid)`);
    }
    res.json({ ok: true, added, duplicates, invalid, total: reports.length });
  });

  // ─── GET /api/emcomm/field-reports — newest first, optional ?since=<ms> ──
  app.get('/api/emcomm/field-reports', (req, res) => {
    const sinceRaw = parseInt(req.query.since, 10);
    const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
    const now = Date.now();
    const out = [];
    for (let i = reports.length - 1; i >= 0; i--) {
      const r = reports[i];
      if (since > 0 && r.receivedAt <= since) continue;
      out.push({ ...r, age: Math.max(0, Math.floor((now - r.timestamp) / 60000)) });
    }
    res.json({ count: out.length, reports: out });
  });

  logInfo('[FieldReports] Routes registered');
};
