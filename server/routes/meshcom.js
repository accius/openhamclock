/**
 * MeshCom integration routes.
 *
 * Receives JSON packets from the rig-bridge meshcom-udp plugin and
 * maintains an in-memory cache of nodes, messages and weather/telemetry.
 *
 * Traffic optimisations built in:
 *   - GET /api/meshcom/nodes and /messages support ?since=<ms> for delta responses
 *   - ETag / 304 Not Modified on nodes endpoint (no body when nothing changed)
 *   - Node max-age pruning (MESHCOM_NODE_MAX_AGE_MINUTES, default 60)
 *   - Messages time-based expiry (MESHCOM_MESSAGE_MAX_AGE_HOURS, default 8)
 *   - Bounded FIFO safety cap on messages (max 200 entries)
 */

module.exports = function (app, ctx) {
  const { logDebug, logInfo, logWarn, CONFIG } = ctx;

  const NODE_MAX_AGE_MS = parseInt(process.env.MESHCOM_NODE_MAX_AGE_MINUTES || '60') * 60_000;
  const MESSAGE_MAX_AGE_MS = parseFloat(process.env.MESHCOM_MESSAGE_MAX_AGE_HOURS || '8') * 3_600_000;
  const MAX_MESSAGES = 200;

  // ── In-memory state ────────────────────────────────────────────────────────
  // nodes: callsign → NodeObject
  const nodes = new Map();
  // messages: bounded FIFO array — entries arrive in chronological order
  const messages = [];
  // weather: callsign → WeatherObject (latest telemetry per node)
  const weather = new Map();
  // Timestamp of the most recent packet received from rig-bridge (any type).
  // Used by /api/meshcom/status to report connectivity without making an
  // outbound HTTP call to rig-bridge (which can block the connection pool).
  let lastIngestTime = 0;

  // ── ETag helpers ───────────────────────────────────────────────────────────
  function computeNodeEtag() {
    let latest = 0;
    for (const n of nodes.values()) {
      if (n.timestamp > latest) latest = n.timestamp;
    }
    return `"${nodes.size}-${latest}"`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  // null-safe parseFloat — preserves 0 as a valid numeric value per CLAUDE.md
  function parseOrNull(v) {
    return v != null ? parseFloat(v) : null;
  }

  // ── Periodic cleanup ────────────────────────────────────────────────────────
  // Reference stored so it can be cleared by tests or graceful shutdown.
  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    // Expire stale nodes (and their weather entries)
    const nodeCutoff = now - NODE_MAX_AGE_MS;
    for (const [call, node] of nodes) {
      if (node.timestamp < nodeCutoff) {
        nodes.delete(call);
        weather.delete(call);
      }
    }

    // Expire old messages — messages are stored in arrival order, so walk
    // from the front until we hit a non-expired entry, then splice once.
    const msgCutoff = now - MESSAGE_MAX_AGE_MS;
    let i = 0;
    while (i < messages.length && messages[i].timestamp < msgCutoff) i++;
    if (i > 0) messages.splice(0, i);
  }, 60_000);

  // Allow callers (e.g. tests) to stop the timer
  cleanupTimer.unref?.(); // non-blocking in Node — won't prevent process exit

  // ── Ingest: position ────────────────────────────────────────────────────────
  // Posted by the rig-bridge meshcom-udp plugin.
  // lat and lon arrive already normalised to signed decimals (plugin handles
  // the lat_dir/long_dir conversion), so we only need null-safe guards here.
  app.post('/api/meshcom/local/pos', (req, res) => {
    const pkt = req.body;
    if (!pkt || !pkt.src) return res.status(400).json({ error: 'Missing src' });

    const call = String(pkt.src).toUpperCase().trim();

    // null-safe coordinate guard — 0 is a valid position (equator / prime meridian)
    const lat = parseOrNull(pkt.lat);
    const lon = parseOrNull(pkt.lon);

    const existing = nodes.get(call);
    const ts = pkt.timestamp ?? Date.now();
    if (existing && ts <= existing.timestamp) {
      return res.json({ ok: true, updated: false });
    }

    const node = {
      call,
      hwId: pkt.hwId ?? null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      alt: parseOrNull(pkt.alt),
      batt: parseOrNull(pkt.batt),
      aprsSymbol: pkt.aprsSymbol ?? null,
      firmware: pkt.firmware ?? null,
      source: 'local-udp',
      timestamp: ts,
    };

    // Carry forward any telemetry already received for this node so the map
    // popup has fresh weather data without waiting for the next telem packet.
    const wx = weather.get(call);
    if (wx) node.weather = wx;

    nodes.set(call, node);
    lastIngestTime = Date.now();
    logDebug(`[MeshCom] Position from ${call}: lat=${lat}, lon=${lon}, batt=${pkt.batt}`);
    res.json({ ok: true, updated: true });
  });

  // ── Ingest: text message ────────────────────────────────────────────────────
  app.post('/api/meshcom/local/msg', (req, res) => {
    const pkt = req.body;
    if (!pkt || !pkt.src || !pkt.msg) return res.status(400).json({ error: 'Missing src or msg' });

    messages.push({
      src: String(pkt.src).toUpperCase(),
      dst: pkt.dst ? String(pkt.dst).toUpperCase() : '*',
      text: pkt.msg,
      msgId: pkt.msgId ?? null,
      srcType: pkt.srcType ?? null,
      timestamp: pkt.timestamp ?? Date.now(),
    });

    if (messages.length > MAX_MESSAGES) messages.shift();
    lastIngestTime = Date.now();
    logDebug(`[MeshCom] Message from ${pkt.src} → ${pkt.dst || '*'}: ${pkt.msg}`);
    res.json({ ok: true });
  });

  // ── Ingest: telemetry / weather ─────────────────────────────────────────────
  app.post('/api/meshcom/local/telem', (req, res) => {
    const pkt = req.body;
    if (!pkt || !pkt.src) return res.status(400).json({ error: 'Missing src' });

    const call = String(pkt.src).toUpperCase().trim();
    const ts = pkt.timestamp ?? Date.now();

    const wx = {
      call,
      tempC: parseOrNull(pkt.tempC),
      humidity: parseOrNull(pkt.humidity),
      pressureHpa: parseOrNull(pkt.pressureHpa),
      co2ppm: parseOrNull(pkt.co2ppm),
      rssi: parseOrNull(pkt.rssi),
      snr: parseOrNull(pkt.snr),
      timestamp: ts,
    };

    weather.set(call, wx);

    // Update weather on existing node too so the map popup has fresh data
    const node = nodes.get(call);
    if (node) {
      node.weather = wx;
      // Touch timestamp so ETag changes and clients know to refresh
      if (ts > node.timestamp) node.timestamp = ts;
    }

    lastIngestTime = Date.now();
    logDebug(`[MeshCom] Telemetry from ${call}: temp=${pkt.tempC}°C hum=${pkt.humidity}%`);
    res.json({ ok: true });
  });

  // ── GET /api/meshcom/nodes ──────────────────────────────────────────────────
  // Supports ?since=<ms> (return only nodes updated after that time).
  // Supports ETag / If-None-Match for 304 responses when nothing changed.
  app.get('/api/meshcom/nodes', (req, res) => {
    const etag = computeNodeEtag();
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const since = req.query.since != null ? parseInt(req.query.since) : 0;
    const cutoff = Date.now() - NODE_MAX_AGE_MS;

    const result = [];
    for (const node of nodes.values()) {
      if (node.timestamp < cutoff) continue;
      if (since > 0 && node.timestamp <= since) continue;
      const ageMin = Math.floor((Date.now() - node.timestamp) / 60_000);
      result.push({ ...node, ageMin });
    }

    res.set('ETag', etag);
    res.json({ count: result.length, nodes: result.sort((a, b) => b.timestamp - a.timestamp) });
  });

  // ── GET /api/meshcom/messages ───────────────────────────────────────────────
  // Supports ?since=<ms>.
  app.get('/api/meshcom/messages', (req, res) => {
    const since = req.query.since != null ? parseInt(req.query.since) : 0;
    const result = since > 0 ? messages.filter((m) => m.timestamp > since) : messages.slice();
    res.json({ count: result.length, messages: result });
  });

  // ── GET /api/meshcom/weather ────────────────────────────────────────────────
  app.get('/api/meshcom/weather', (req, res) => {
    const result = Array.from(weather.values());
    res.json({ count: result.length, weather: result });
  });

  // ── GET /api/meshcom/status ─────────────────────────────────────────────────
  // Purely synchronous — no outbound HTTP calls. Derives rig-bridge
  // connectivity from lastIngestTime so it never holds a browser connection
  // open waiting for rig-bridge to respond (or time out).
  app.get('/api/meshcom/status', (req, res) => {
    // Consider rig-bridge "running" if a packet arrived within the last 5 min.
    const ACTIVE_WINDOW_MS = 5 * 60_000;
    const running = lastIngestTime > 0 && Date.now() - lastIngestTime < ACTIVE_WINDOW_MS;
    res.json({
      nodeCount: nodes.size,
      messageCount: messages.length,
      lastIngestTime,
      rigBridge: { running },
    });
  });

  // ── POST /api/meshcom/send ──────────────────────────────────────────────────
  // Proxies send request to rig-bridge plugin.
  app.post('/api/meshcom/send', async (req, res) => {
    const { to, message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });
    if (message.length > 150) return res.status(400).json({ error: 'Message exceeds 150 char MeshCom limit' });

    try {
      const rigHost = CONFIG.rigControl?.host || 'http://localhost';
      const rigPort = CONFIG.rigControl?.port ?? 5555;
      const r = await ctx.fetch(`${rigHost}:${rigPort}/api/meshcom-udp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to || '*', message }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return res.json({ ok: true, via: 'rig-bridge' });
      const err = await r.text();
      return res.status(r.status).json({ error: `Rig Bridge: ${err}` });
    } catch (e) {
      logWarn(`[MeshCom] Send proxy error: ${e.message}`);
      const isTimeout = e?.name === 'AbortError' || e?.name === 'TimeoutError';
      const isRefused = e?.code === 'ECONNREFUSED';
      if (isTimeout) {
        return res.status(503).json({ error: 'Rig-bridge did not respond in time — it may be busy or restarting' });
      }
      if (isRefused) {
        return res.status(503).json({ error: 'Cannot reach rig-bridge — check that it is running' });
      }
      return res.status(503).json({ error: 'MeshCom UDP plugin not available — enable meshcom in rig-bridge config' });
    }
  });

  logInfo('[MeshCom] Routes registered');
};
