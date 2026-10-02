/**
 * Log-sync server proxies — Wavelog/Cloudlog push, QRZ Logbook push, LoTW
 * confirmations pull.
 *
 * The browser can't talk to these services directly (CORS), and per-user
 * credentials must never live server-side: every request carries the user's
 * own key/login (body fields or headers), the proxy forwards it upstream and
 * forgets it. Nothing is cached or persisted here, and credentials are never
 * logged (the LoTW URL contains the password — it must not reach any logger).
 *
 * Upstream contracts implemented:
 *   Wavelog/Cloudlog  POST <base>/index.php/api/qso
 *                       {key, station_profile_id, type:'adif', string:'<record><eor>'}
 *                     POST <base>/index.php/api/station_info  {key}  → [{station_id,…}]  (Test)
 *   QRZ Logbook       POST https://logbook.qrz.com/api  (form-encoded)
 *                       KEY=…&ACTION=INSERT&ADIF=<record><eor>   → RESULT=OK&LOGID=…&COUNT=…
 *                       KEY=…&ACTION=STATUS                      → RESULT=OK&COUNT=…&…    (Test)
 *                     Requires an identifiable User-Agent per QRZ API docs.
 *   LoTW              GET https://lotw.arrl.org/lotwuser/lotwreport.adi
 *                       ?login=…&password=…&qso_query=1&qso_qsl=yes[&qso_qslsince=YYYY-MM-DD]
 *                     Failure = HTML page with no <eoh> tag (per ARRL developer docs).
 *
 * Endpoints:
 *   POST /api/logsync/wavelog  {url, key, stationProfileId?, adif} | {url, key, test:true}
 *   POST /api/logsync/qrz      {key, adif} | {key, test:true}
 *   GET  /api/logsync/lotw     headers: X-LoTW-Auth: base64(login:password)
 *                              query: since=YYYY-MM-DD | test=1
 */

const { validateCustomHost } = require('../utils/ssrf');

const QRZ_API_URL = 'https://logbook.qrz.com/api';
const LOTW_REPORT_URL = 'https://lotw.arrl.org/lotwuser/lotwreport.adi';

const PUSH_TIMEOUT_MS = 20000;
const LOTW_TIMEOUT_MS = 90000; // LoTW is notoriously slow — give it room

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, writeLimiter, logWarn, logErrorOnce } = ctx;
  const userAgent = `OpenHamClock/${APP_VERSION} (+https://github.com/accius/openhamclock)`;

  const fetchWithTimeout = async (url, options = {}, timeoutMs = PUSH_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const noCache = (res) => res.setHeader('Cache-Control', 'no-store');

  // ── Wavelog / Cloudlog ───────────────────────────────────────────────────

  /**
   * Normalize + SSRF-check a user-supplied Wavelog base URL.
   * Returns { ok, base, host } or { ok:false, reason }.
   *
   * For https:// targets we validate DNS resolution but connect by hostname:
   * TLS certificate verification pins the connection to the named host, which
   * closes the DNS-rebinding window the resolved-IP trick exists for. Plain
   * http:// targets (typical for LAN Wavelog installs) connect to the
   * validated IP with a Host header, same as rig-bridge status checks.
   */
  const resolveWavelogBase = async (rawUrl) => {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || '').trim());
    } catch {
      return { ok: false, reason: 'Invalid Wavelog URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'Wavelog URL must be http(s)' };
    }
    const validation = await validateCustomHost(parsed.hostname);
    if (!validation.ok) return { ok: false, reason: `Wavelog host rejected: ${validation.reason}` };

    // Strip trailing slash and a trailing /index.php — re-appended uniformly.
    let path = parsed.pathname.replace(/\/+$/, '').replace(/\/index\.php$/i, '');
    const host = parsed.host; // original host[:port] for Host header / TLS
    const connectHost = parsed.protocol === 'https:' ? parsed.hostname : validation.resolvedIP;
    const portPart = parsed.port ? `:${parsed.port}` : '';
    const base = `${parsed.protocol}//${connectHost}${portPart}${path}/index.php`;
    return { ok: true, base, host };
  };

  app.post('/api/logsync/wavelog', writeLimiter, async (req, res) => {
    noCache(res);
    const { url, key, stationProfileId, adif, test } = req.body || {};
    if (typeof url !== 'string' || typeof key !== 'string' || !url.trim() || !key.trim()) {
      return res.status(400).json({ error: 'url and key are required' });
    }
    if (!test && (typeof adif !== 'string' || !adif.trim())) {
      return res.status(400).json({ error: 'adif record is required' });
    }
    if (typeof adif === 'string' && adif.length > 100000) {
      return res.status(400).json({ error: 'adif payload too large' });
    }

    const target = await resolveWavelogBase(url);
    if (!target.ok) return res.status(400).json({ error: target.reason });

    try {
      const endpoint = test
        ? `${target.base}/api/station_info/${encodeURIComponent(key.trim())}`
        : `${target.base}/api/qso`;
      const body = {
        key: key.trim(),
        station_profile_id: String(stationProfileId || '').trim() || '1',
        type: 'adif',
        string: adif,
      };
      const upstream = await fetchWithTimeout(endpoint, {
        method: test ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          'User-Agent': userAgent,
          Host: target.host,
          ...(!test ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(!test ? { body: JSON.stringify(body) } : {}),
      });
      const text = await upstream.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {}

      if (!upstream.ok) {
        const reason = data?.reason || data?.message || `HTTP ${upstream.status}`;
        return res.status(502).json({ error: `Wavelog: ${reason}` });
      }
      if (test) {
        const stations = Array.isArray(data) ? data : [];
        return res.json({
          ok: true,
          stations: stations.map((s) => ({
            station_id: s.station_id,
            station_profile_name: s.station_profile_name,
            station_callsign: s.station_callsign,
          })),
        });
      }
      // Wavelog/Cloudlog versions differ: modern Wavelog returns JSON with a
      // status field; older Cloudlog returns "OK"/"created" strings. Treat
      // 2xx without an explicit failure marker as success.
      const status = String(data?.status || '').toLowerCase();
      if (status === 'failed' || status === 'error') {
        return res.status(502).json({ error: `Wavelog: ${data?.reason || data?.message || 'rejected the QSO'}` });
      }
      return res.json({ ok: true, status: data?.status || 'ok' });
    } catch (err) {
      logErrorOnce('logsync-wavelog', err.name === 'AbortError' ? 'timeout' : err.message);
      return res
        .status(502)
        .json({ error: err.name === 'AbortError' ? 'Wavelog server timed out' : 'Could not reach the Wavelog server' });
    }
  });

  /**
   * Pull new QSOs from Wavelog after a QSO ID cursor.
   * The browser owns the cursor and credentials; this proxy stores neither.
   */
  app.post('/api/logsync/wavelog/pull', writeLimiter, async (req, res) => {
    noCache(res);
    const { url, key, stationIds, fetchFromId = 0, limit = 5000 } = req.body || {};

    if (typeof url !== 'string' || typeof key !== 'string' || !url.trim() || !key.trim()) {
      return res.status(400).json({ error: 'url and key are required' });
    }

    const ids = Array.isArray(stationIds) ? stationIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];

    if (ids.length === 0) {
      return res.status(400).json({ error: 'at least one station ID is required' });
    }

    const cursor = Number(fetchFromId);
    if (!Number.isInteger(cursor) || cursor < 0) {
      return res.status(400).json({ error: 'fetchFromId must be a non-negative integer' });
    }

    const requestedLimit = Number(limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 20000) {
      return res.status(400).json({ error: 'limit must be between 1 and 20000' });
    }

    const target = await resolveWavelogBase(url);
    if (!target.ok) return res.status(400).json({ error: target.reason });

    try {
      const upstream = await fetchWithTimeout(`${target.base}/api/get_contacts_adif`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': userAgent,
          Host: target.host,
        },
        body: JSON.stringify({
          key: key.trim(),
          station_id: ids,
          fetchfromid: cursor,
          limit: requestedLimit,
          output_format: 'adif',
        }),
      });

      const text = await upstream.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {}

      if (!upstream.ok) {
        const reason = data?.reason || data?.message || `HTTP ${upstream.status}`;
        return res.status(502).json({ error: `Wavelog: ${reason}` });
      }

      const status = String(data?.status || '').toLowerCase();
      if (status === 'failed' || status === 'error') {
        return res.status(502).json({
          error: `Wavelog: ${data?.reason || data?.message || 'pull failed'}`,
        });
      }

      return res.json({
        ok: true,
        message: data?.message || '',
        lastFetchedId: Number(data?.lastfetchedid ?? cursor),
        exportedQsos: Number(data?.exported_qsos || 0),
        adif: typeof data?.adif === 'string' ? data.adif : null,
      });
    } catch (err) {
      logErrorOnce('logsync-wavelog-pull', err.name === 'AbortError' ? 'timeout' : err.message);
      return res.status(502).json({
        error: err.name === 'AbortError' ? 'Wavelog server timed out' : 'Could not reach the Wavelog server',
      });
    }
  });

  // ── Wavelog MQTT event bridge ──────────────────────────────────────────
  //
  // MQTT is only a doorbell. The browser still performs the authoritative
  // incremental Wavelog pull using its existing credentials and QSO cursor.
  //
  // Disabled unless all required server-side MQTT settings are present.

  const wavelogMqttUrl = String(process.env.WAVELOG_MQTT_URL || '').trim();
  const wavelogMqttUsername = String(process.env.WAVELOG_MQTT_USERNAME || '').trim();
  const wavelogMqttPassword = String(process.env.WAVELOG_MQTT_PASSWORD || '');
  const wavelogMqttTopic = String(process.env.WAVELOG_MQTT_TOPIC || '').trim();

  const wavelogEventClients = new Set();
  let wavelogMqttClient = null;

  const wavelogMqttConfigured = wavelogMqttUrl && wavelogMqttUsername && wavelogMqttPassword && wavelogMqttTopic;

  const broadcastWavelogEvent = () => {
    const message = `event: qso\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`;

    for (const client of wavelogEventClients) {
      try {
        client.write(message);
        if (typeof client.flush === 'function') client.flush();
      } catch {
        wavelogEventClients.delete(client);
      }
    }
  };

  const connectWavelogMqtt = () => {
    if (!wavelogMqttConfigured || wavelogMqttClient) return;

    const mqttLib = require('mqtt');

    const client = mqttLib.connect(wavelogMqttUrl, {
      username: wavelogMqttUsername,
      password: wavelogMqttPassword,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
      keepalive: 60,
    });

    wavelogMqttClient = client;

    client.on('connect', () => {
      console.log(`[LogSync] Wavelog MQTT connected; subscribing to ${wavelogMqttTopic}`);

      client.subscribe(wavelogMqttTopic, { qos: 0 }, (err) => {
        if (err) {
          logWarn(`[LogSync] Wavelog MQTT subscribe failed: ${err.message}`);
        }
      });
    });

    client.on('message', (topic) => {
      if (topic !== wavelogMqttTopic) return;
      broadcastWavelogEvent();
    });

    client.on('error', (err) => {
      logWarn(`[LogSync] Wavelog MQTT error: ${err.message}`);
    });

    client.on('close', () => {
      console.log('[LogSync] Wavelog MQTT disconnected');
    });
  };

  app.get('/api/logsync/wavelog/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
    });

    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    if (wavelogMqttConfigured) {
      wavelogEventClients.add(res);
    }

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        mqttConfigured: Boolean(wavelogMqttConfigured),
        subscriberCount: wavelogEventClients.size,
      })}\n\n`,
    );

    if (typeof res.flush === 'function') res.flush();

    if (!wavelogMqttConfigured) {
      return res.end();
    }

    connectWavelogMqtt();

    const keepalive = setInterval(() => {
      try {
        res.write(`: keepalive ${Date.now()}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      } catch {
        clearInterval(keepalive);
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(keepalive);
      wavelogEventClients.delete(res);
    });
  });

  // ── QRZ Logbook ──────────────────────────────────────────────────────────

  /** Parse QRZ's name=value&name=value response body into an object. */
  const parseQrzResponse = (text) => {
    const out = {};
    for (const pair of String(text || '').split('&')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim().toUpperCase();
      let value = pair.slice(eq + 1).trim();
      try {
        value = decodeURIComponent(value.replace(/\+/g, ' '));
      } catch {}
      if (name) out[name] = value;
    }
    return out;
  };

  app.post('/api/logsync/qrz', writeLimiter, async (req, res) => {
    noCache(res);
    const { key, adif, test } = req.body || {};
    if (typeof key !== 'string' || !key.trim()) {
      return res.status(400).json({ error: 'key is required' });
    }
    if (!test && (typeof adif !== 'string' || !adif.trim())) {
      return res.status(400).json({ error: 'adif record is required' });
    }
    if (typeof adif === 'string' && adif.length > 100000) {
      return res.status(400).json({ error: 'adif payload too large' });
    }

    try {
      const params = new URLSearchParams();
      params.set('KEY', key.trim());
      params.set('ACTION', test ? 'STATUS' : 'INSERT');
      if (!test) params.set('ADIF', adif);
      const upstream = await fetchWithTimeout(QRZ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent },
        body: params.toString(),
      });
      const text = await upstream.text();
      if (!upstream.ok) return res.status(502).json({ error: `QRZ HTTP ${upstream.status}` });
      const parsed = parseQrzResponse(text);
      const result = String(parsed.RESULT || '').toUpperCase();

      if (result === 'AUTH') {
        return res.status(401).json({ error: 'QRZ rejected the API key (check it is a Logbook key, not XML login)' });
      }
      if (result === 'OK' || result === 'REPLACE') {
        return res.json({
          ok: true,
          result,
          logid: parsed.LOGID || null,
          count: parsed.COUNT ? Number(parsed.COUNT) : null,
          ...(test ? { data: parsed } : {}),
        });
      }
      // A duplicate INSERT means the QSO is already in the remote log — the
      // client treats that as synced rather than an error worth retrying.
      const reason = parsed.REASON || 'QRZ returned an error';
      if (!test && /duplicate/i.test(reason)) {
        return res.json({ ok: true, result: 'DUPLICATE', reason });
      }
      return res.status(502).json({ error: `QRZ: ${reason}` });
    } catch (err) {
      logErrorOnce('logsync-qrz', err.name === 'AbortError' ? 'timeout' : err.message);
      return res
        .status(502)
        .json({ error: err.name === 'AbortError' ? 'QRZ timed out' : 'Could not reach logbook.qrz.com' });
    }
  });

  // ── LoTW confirmations pull ──────────────────────────────────────────────

  app.get('/api/logsync/lotw', async (req, res) => {
    noCache(res);
    // Credentials arrive in a header (never the query string, so they can't
    // land in access logs) as base64(login:password).
    const raw = req.headers['x-lotw-auth'];
    let login = '';
    let password = '';
    try {
      const decoded = Buffer.from(String(raw || ''), 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon > 0) {
        login = decoded.slice(0, colon).trim();
        password = decoded.slice(colon + 1);
      }
    } catch {}
    if (!login || !password || login.length > 64 || password.length > 128) {
      return res.status(400).json({ error: 'X-LoTW-Auth header (base64 login:password) is required' });
    }

    const isTest = req.query.test === '1' || req.query.test === 'true';
    const since = String(req.query.since || '').trim();
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return res.status(400).json({ error: 'since must be YYYY-MM-DD' });
    }

    const params = new URLSearchParams();
    params.set('login', login);
    params.set('password', password);
    params.set('qso_query', '1');
    params.set('qso_qsl', 'yes');
    // Test = cheap zero-row query: no QSL can have arrived after 2099.
    params.set('qso_qslsince', isTest ? '2099-12-31' : since || '1900-01-01');

    // SECURITY: this URL contains the user's LoTW password — it must never be
    // passed to any logger or error message.
    const url = `${LOTW_REPORT_URL}?${params.toString()}`;

    try {
      const upstream = await fetchWithTimeout(url, { headers: { 'User-Agent': userAgent } }, LOTW_TIMEOUT_MS);
      const text = await upstream.text();

      // Per ARRL developer docs: a failed query returns an HTML explanation
      // page; the absence of <eoh> is the documented failure signal.
      if (!upstream.ok || !/<eoh>/i.test(text)) {
        if (/password|username|invalid|not.*(found|valid)/i.test(text)) {
          return res.status(401).json({ error: 'LoTW rejected the username or password' });
        }
        logWarn('[LogSync] LoTW query failed (no <eoh> in response)');
        return res.status(502).json({ error: 'LoTW did not return a valid ADIF report' });
      }
      if (isTest) return res.json({ ok: true });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(text);
    } catch (err) {
      logErrorOnce('logsync-lotw', err.name === 'AbortError' ? 'timeout' : 'fetch failed');
      return res.status(502).json({
        error:
          err.name === 'AbortError'
            ? 'LoTW timed out (it is often slow — try again later)'
            : 'Could not reach lotw.arrl.org',
      });
    }
  });
};
