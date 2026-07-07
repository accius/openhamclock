/**
 * QRZ Logbook routes — fetches the user's QSOs from the QRZ Logbook API
 * (logbook.qrz.com) and serves per-grid aggregates for the worked-grids
 * heatmap map layer.
 *
 * NOTE: the Logbook API key is NOT the QRZ XML lookup username/password.
 * Each QRZ logbook has its own key (qrz.com → My Logbook → Settings).
 */

const fs = require('fs');
const path = require('path');

const QRZ_LOGBOOK_API = 'https://logbook.qrz.com/api';

module.exports = function (app, ctx) {
  const { fetch, CONFIG, APP_VERSION, ROOT_DIR, logDebug, logErrorOnce, writeLimiter, requireWriteAuth } = ctx;

  const CACHE_TTL = 30 * 60 * 1000; // Logbooks change slowly — 30 min is plenty
  const PAGE_MAX = 500; // QSOs per FETCH request
  const MAX_PAGES = 200; // Hard safety cap (100k QSOs)
  const MAX_QSOS_PER_GRID = 500; // Memory cap on stored QSO details (newest kept)

  const state = {
    key: CONFIG._qrzLogbookApiKey || '',
    grids: null, // Array of per-grid aggregates (see aggregateRecords)
    qsosByGrid: null, // Map: grid → QSO detail list for popups (newest first)
    summary: null, // { totalQsos, qsosWithGrid, gridCount, confirmedGrids }
    lastFetch: 0,
    fetchInFlight: null, // Dedup concurrent refreshes
    lastError: null,
  };

  // Persist the key to a file so it survives restarts (set via Settings UI)
  const KEY_FILE = path.join(ROOT_DIR, '.qrz-logbook-key');

  function loadKey() {
    // .env takes priority
    if (CONFIG._qrzLogbookApiKey) {
      state.key = CONFIG._qrzLogbookApiKey;
      logDebug('[QRZ Logbook] API key loaded from .env');
      return;
    }
    try {
      if (fs.existsSync(KEY_FILE)) {
        const saved = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
        if (saved.key) {
          state.key = saved.key;
          logDebug('[QRZ Logbook] API key loaded from .qrz-logbook-key');
        }
      }
    } catch (e) {
      logDebug('[QRZ Logbook] Could not load saved API key');
    }
  }
  loadKey();

  function isConfigured() {
    return !!state.key;
  }

  // ── QRZ Logbook API response parsing ──
  // Responses are &-separated KEY=VALUE pairs, but the ADIF value is
  // HTML-entity encoded (&lt;call:4&gt;…) so a naive split on '&' shreds it.
  // Pieces without '=' are continuations of the previous value.
  function parseQrzResponse(text) {
    const fields = {};
    let currentKey = null;
    for (const piece of text.split('&')) {
      const eq = piece.indexOf('=');
      // "lt;call:4" (no '=') or "gt;W1AW" — continuation of the previous value
      if (eq === -1 || /^(lt|gt|amp|quot|#\d+);/.test(piece)) {
        if (currentKey) fields[currentKey] += '&' + piece;
        continue;
      }
      currentKey = piece.slice(0, eq).trim().toUpperCase();
      fields[currentKey] = piece.slice(eq + 1);
    }
    for (const key of Object.keys(fields)) {
      fields[key] = decodeQrzValue(fields[key]);
    }
    return fields;
  }

  function decodeQrzValue(value) {
    let v = value;
    // Percent-decoding (some deployments URL-encode instead of entity-encode)
    try {
      v = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      // Not valid percent-encoding — keep as-is
    }
    return v
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&')
      .trim();
  }

  // ── Minimal ADIF parser ──
  // Returns an array of records, each a map of UPPERCASE field name → value.
  function parseAdifRecords(adif) {
    if (!adif) return [];
    const eoh = adif.search(/<eoh>/i);
    const body = eoh >= 0 ? adif.slice(eoh + 5) : adif;

    const records = [];
    const tagRe = /<(eor)>|<([A-Za-z0-9_]+):(\d+)(?::[^>]*)?>/gi;
    let record = {};
    let match;
    while ((match = tagRe.exec(body)) !== null) {
      if (match[1]) {
        // <eor>
        if (Object.keys(record).length > 0) records.push(record);
        record = {};
        continue;
      }
      const name = match[2].toUpperCase();
      const len = parseInt(match[3], 10);
      record[name] = body.substr(tagRe.lastIndex, len).trim();
      tagRe.lastIndex += len;
    }
    if (Object.keys(record).length > 0) records.push(record);
    return records;
  }

  function isConfirmed(record) {
    return (
      record.QSL_RCVD === 'Y' ||
      record.LOTW_QSL_RCVD === 'Y' ||
      record.EQSL_QSL_RCVD === 'Y' ||
      record.APP_QRZLOG_STATUS === 'C'
    );
  }

  // ADIF QSO_DATE (YYYYMMDD) → YYYY-MM-DD
  function formatAdifDate(date) {
    return /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : '';
  }

  // ADIF TIME_ON (HHMM or HHMMSS) → HH:MM
  function formatAdifTime(time) {
    return /^\d{4,6}$/.test(time) ? `${time.slice(0, 2)}:${time.slice(2, 4)}` : '';
  }

  // ── Per-grid aggregation ──
  // Grids are truncated to 4 characters (the classic "worked grids" unit).
  function aggregateRecords(records) {
    const grids = new Map();
    let qsosWithGrid = 0;

    for (const r of records) {
      const rawGrid = (r.GRIDSQUARE || '').trim().toUpperCase();
      if (!/^[A-R]{2}[0-9]{2}/.test(rawGrid)) continue;
      const grid = rawGrid.slice(0, 4);
      qsosWithGrid++;

      let g = grids.get(grid);
      if (!g) {
        g = {
          grid,
          qsoCount: 0,
          confirmedCount: 0,
          bands: {},
          lastWorked: null,
          _states: {},
          _countries: {},
          _qsos: [],
        };
        grids.set(grid, g);
      }
      g.qsoCount++;
      if (isConfirmed(r)) g.confirmedCount++;

      const band = (r.BAND || '').toLowerCase();
      if (band) g.bands[band] = (g.bands[band] || 0) + 1;

      const date = r.QSO_DATE || ''; // ADIF format: YYYYMMDD
      if (/^\d{8}$/.test(date) && (!g.lastWorked || date > g.lastWorked)) {
        g.lastWorked = date;
      }

      // Location tallies — STATE covers US states and Canadian provinces in
      // modern ADIF; VE_PROV is the legacy province field some loggers still use
      const state = (r.STATE || r.VE_PROV || '').trim().toUpperCase();
      if (state) g._states[state] = (g._states[state] || 0) + 1;
      const country = (r.COUNTRY || '').trim();
      if (country) g._countries[country] = (g._countries[country] || 0) + 1;

      // QSO detail for the popup list (served per-grid on demand)
      g._qsos.push({
        call: r.CALL || '',
        date: formatAdifDate(date),
        time: formatAdifTime(r.TIME_ON || ''),
        city: r.QTH || '',
        name: r.NAME || '',
        rstSent: r.RST_SENT || '',
        rstRcvd: r.RST_RCVD || '',
        freq: r.FREQ || '',
        mode: r.MODE || '',
        confirmed: isConfirmed(r),
        _sort: `${date}${(r.TIME_ON || '').padEnd(6, '0')}`,
      });
    }

    // Sort each grid's QSOs newest-first and cap stored details to bound memory
    const qsosByGrid = new Map();
    for (const g of grids.values()) {
      g._qsos.sort((a, b) => (a._sort < b._sort ? 1 : a._sort > b._sort ? -1 : 0));
      qsosByGrid.set(
        g.grid,
        g._qsos.slice(0, MAX_QSOS_PER_GRID).map(({ _sort, ...q }) => q),
      );
    }

    const mostCommon = (tallies) => {
      let best = null;
      let bestCount = 0;
      for (const [value, count] of Object.entries(tallies)) {
        if (count > bestCount) {
          best = value;
          bestCount = count;
        }
      }
      return best;
    };

    const gridList = [...grids.values()].map(({ _states, _countries, _qsos, ...g }) => ({
      ...g,
      lastWorked: g.lastWorked ? formatAdifDate(g.lastWorked) : null,
      // Most common state/province and country among this grid's QSOs
      state: mostCommon(_states),
      country: mostCommon(_countries),
    }));

    return {
      grids: gridList,
      qsosByGrid,
      summary: {
        totalQsos: records.length,
        qsosWithGrid,
        gridCount: gridList.length,
        confirmedGrids: gridList.filter((g) => g.confirmedCount > 0).length,
      },
    };
  }

  async function qrzLogbookRequest(key, action, option) {
    const params = new URLSearchParams({ KEY: key, ACTION: action });
    if (option) params.set('OPTION', option);
    const response = await fetch(QRZ_LOGBOOK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': `OpenHamClock/${APP_VERSION}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseQrzResponse(await response.text());
  }

  // An empty logbook (or paging past the last record) comes back as
  // RESULT=FAIL with a "no records/results" reason — that's not an error.
  function isEmptyResult(fields) {
    return fields.RESULT === 'FAIL' && /no\s+(record|result)/i.test(fields.REASON || '');
  }

  // Fetch the entire logbook, paging with AFTERLOGID.
  async function fetchAllRecords(key) {
    const records = [];
    let afterLogId = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const option = `MAX:${PAGE_MAX}` + (afterLogId ? `,AFTERLOGID:${afterLogId}` : '');
      const fields = await qrzLogbookRequest(key, 'FETCH', option);

      if (isEmptyResult(fields)) break;
      if (fields.RESULT !== 'OK' && fields.RESULT !== 'PARTIAL') {
        throw new Error(fields.REASON || `Unexpected result: ${fields.RESULT || 'no RESULT field'}`);
      }

      const pageRecords = parseAdifRecords(fields.ADIF);
      if (pageRecords.length === 0) break;
      records.push(...pageRecords);

      // Advance the cursor to the highest logid seen this page
      let maxId = afterLogId;
      const logids = (fields.LOGIDS || '').split(',');
      for (const id of logids) {
        const n = Number(id);
        if (Number.isFinite(n) && n > maxId) maxId = n;
      }
      for (const r of pageRecords) {
        const n = Number(r.APP_QRZLOG_LOGID);
        if (Number.isFinite(n) && n > maxId) maxId = n;
      }

      if (pageRecords.length < PAGE_MAX) break; // Last page
      if (maxId === afterLogId) break; // Cursor stuck — bail rather than loop forever
      afterLogId = maxId;
    }

    return records;
  }

  // Refresh the aggregate cache if stale (dedups concurrent callers).
  function ensureData(force = false) {
    if (!isConfigured()) return Promise.reject(new Error('not configured'));
    if (!force && state.grids && Date.now() - state.lastFetch < CACHE_TTL) {
      return Promise.resolve();
    }
    if (state.fetchInFlight) return state.fetchInFlight;

    state.fetchInFlight = (async () => {
      try {
        const records = await fetchAllRecords(state.key);
        const { grids, qsosByGrid, summary } = aggregateRecords(records);
        state.grids = grids;
        state.qsosByGrid = qsosByGrid;
        state.summary = summary;
        state.lastFetch = Date.now();
        state.lastError = null;
        logDebug(`[QRZ Logbook] Fetched ${summary.totalQsos} QSOs → ${summary.gridCount} grids`);
      } catch (err) {
        state.lastError = err.message;
        logErrorOnce('QRZ Logbook', `Fetch failed: ${err.message}`);
        throw err;
      } finally {
        state.fetchInFlight = null;
      }
    })();

    return state.fetchInFlight;
  }

  // ── Routes ──

  // GET /api/qrz-logbook/grids — per-grid aggregates for the heatmap layer
  app.get('/api/qrz-logbook/grids', async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'QRZ Logbook API key not configured', configured: false });
    }
    try {
      await ensureData();
    } catch (err) {
      // Serve stale data if we have any — better a dated map than none
      if (!state.grids) {
        return res.status(502).json({ error: state.lastError || 'Logbook fetch failed', configured: true });
      }
    }
    res.json({
      fetchedAt: new Date(state.lastFetch).toISOString(),
      stale: Date.now() - state.lastFetch > CACHE_TTL,
      ...state.summary,
      grids: state.grids,
    });
  });

  // GET /api/qrz-logbook/grid/:grid/qsos — QSO details for one grid's popup
  app.get('/api/qrz-logbook/grid/:grid/qsos', async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'QRZ Logbook API key not configured', configured: false });
    }
    const grid = String(req.params.grid || '')
      .trim()
      .toUpperCase();
    if (!/^[A-R]{2}[0-9]{2}$/.test(grid)) {
      return res.status(400).json({ error: 'Invalid grid square' });
    }
    try {
      await ensureData();
    } catch (err) {
      if (!state.qsosByGrid) {
        return res.status(502).json({ error: state.lastError || 'Logbook fetch failed' });
      }
    }
    const qsos = state.qsosByGrid.get(grid) || [];
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), MAX_QSOS_PER_GRID);
    res.json({ grid, total: qsos.length, qsos: qsos.slice(0, limit) });
  });

  // GET /api/qrz-logbook/status — configuration/health check for the Settings UI
  app.get('/api/qrz-logbook/status', (req, res) => {
    res.json({
      configured: isConfigured(),
      source: CONFIG._qrzLogbookApiKey ? 'env' : state.key ? 'settings' : 'none',
      lastFetch: state.lastFetch ? new Date(state.lastFetch).toISOString() : null,
      lastError: state.lastError,
      ...(state.summary || {}),
    });
  });

  // POST /api/qrz-logbook/configure — validate and save the API key
  app.post('/api/qrz-logbook/configure', writeLimiter, requireWriteAuth, async (req, res) => {
    const key = (req.body?.key || '').trim();
    if (!key) {
      return res.status(400).json({ success: false, error: 'API key required' });
    }

    // Validate with a cheap STATUS call before accepting
    let status;
    try {
      status = await qrzLogbookRequest(key, 'STATUS');
    } catch (err) {
      return res.status(502).json({ success: false, error: `QRZ unreachable: ${err.message}` });
    }
    if (status.RESULT !== 'OK') {
      return res.status(401).json({ success: false, error: status.REASON || 'Invalid API key' });
    }

    state.key = key;
    state.grids = null; // Invalidate — the new key may point at a different logbook
    state.qsosByGrid = null;
    state.summary = null;
    state.lastFetch = 0;
    state.lastError = null;

    try {
      fs.writeFileSync(KEY_FILE, JSON.stringify({ key }), 'utf8');
      fs.chmodSync(KEY_FILE, 0o600); // Owner-only read/write
    } catch (e) {
      console.error('[QRZ Logbook] Could not save key file:', e.message);
    }

    res.json({
      success: true,
      message: 'QRZ Logbook API key validated and saved',
      logbookQsos: Number(status.COUNT) || null,
    });
  });

  // POST /api/qrz-logbook/remove — remove the saved key
  app.post('/api/qrz-logbook/remove', writeLimiter, requireWriteAuth, (req, res) => {
    state.key = CONFIG._qrzLogbookApiKey || '';
    state.grids = null;
    state.qsosByGrid = null;
    state.summary = null;
    state.lastFetch = 0;
    state.lastError = null;

    try {
      if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE);
    } catch (e) {}

    res.json({
      success: true,
      configured: isConfigured(),
      source: CONFIG._qrzLogbookApiKey ? 'env' : 'none',
    });
  });

  // POST /api/qrz-logbook/refresh — force a refetch ahead of the cache TTL
  app.post('/api/qrz-logbook/refresh', writeLimiter, requireWriteAuth, async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, error: 'QRZ Logbook API key not configured' });
    }
    try {
      await ensureData(true);
      res.json({ success: true, ...state.summary });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message });
    }
  });

  // Exported for unit tests
  return {
    _qrzLogbook: { parseQrzResponse, parseAdifRecords, aggregateRecords, isConfirmed },
  };
};
