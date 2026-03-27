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
 *   - Messages ring buffer (max 200 entries)
 */

module.exports = function (app, ctx) {
  const { logDebug, logInfo, CONFIG } = ctx;

  const NODE_MAX_AGE_MS = parseInt(process.env.MESHCOM_NODE_MAX_AGE_MINUTES || '60') * 60_000;
  const MAX_MESSAGES = 200;

  // ── In-memory state ────────────────────────────────────────────────────────
  // nodes: callsign → NodeObject
  const nodes = new Map();
  // messages: ring buffer array
  const messages = [];
  // weather: callsign → WeatherObject (latest telemetry per node)
  const weather = new Map();

  // ── ETag helpers ───────────────────────────────────────────────────────────
  function computeNodeEtag() {
    let latest = 0;
    for (const n of nodes.values()) {
      if (n.timestamp > latest) latest = n.timestamp;
    }
    return `"${nodes.size}-${latest}"`;
  }

  // ── Periodic cleanup ────────────────────────────────────────────────────────
  setInterval(() => {
    const cutoff = Date.now() - NODE_MAX_AGE_MS;
    for (const [call, node] of nodes) {
      if (node.timestamp < cutoff) {
        nodes.delete(call);
        weather.delete(call);
      }
    }
  }, 60_000);

  // ── Ingest: position ────────────────────────────────────────────────────────
  // Posted by the rig-bridge meshcom-udp plugin.
  // lat and lon arrive already normalised to signed decimals (plugin handles
  // the lat_dir/long_dir conversion), so we only need null-safe guards here.
  app.post('/api/meshcom/local/pos', (req, res) => {
    const pkt = req.body;
    if (!pkt || !pkt.src) return res.status(400).json({ error: 'Missing src' });

    const call = String(pkt.src).toUpperCase().trim();

    // null-safe coordinate guard — 0 is a valid position (equator / prime meridian)
    const lat = pkt.lat != null ? parseFloat(pkt.lat) : null;
    const lon = pkt.lon != null ? parseFloat(pkt.lon) : null;

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
      alt: pkt.alt != null ? parseFloat(pkt.alt) : null,
      batt: pkt.batt != null ? parseFloat(pkt.batt) : null,
      aprsSymbol: pkt.aprsSymbol ?? null,
      firmware: pkt.firmware ?? null,
      source: 'local-udp',
      timestamp: ts,
    };

    // Merge weather if we already have telemetry for this node
    const wx = weather.get(call);
    if (wx) node.weather = wx;

    nodes.set(call, node);
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
      tempC: pkt.tempC != null ? parseFloat(pkt.tempC) : null,
      humidity: pkt.humidity != null ? parseFloat(pkt.humidity) : null,
      pressureHpa: pkt.pressureHpa != null ? parseFloat(pkt.pressureHpa) : null,
      co2ppm: pkt.co2ppm != null ? parseFloat(pkt.co2ppm) : null,
      rssi: pkt.rssi != null ? parseFloat(pkt.rssi) : null,
      snr: pkt.snr != null ? parseFloat(pkt.snr) : null,
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
    const result = [];
    for (const wx of weather.values()) result.push(wx);
    res.json({ count: result.length, weather: result });
  });

  // ── GET /api/meshcom/status ─────────────────────────────────────────────────
  // Proxies to rig-bridge plugin status.
  app.get('/api/meshcom/status', async (req, res) => {
    const state = {
      nodeCount: nodes.size,
      messageCount: messages.length,
      rigBridge: null,
    };

    try {
      const rigHost = CONFIG.rigControl?.host || 'http://localhost';
      const rigPort = CONFIG.rigControl?.port || 5555;
      const r = await ctx.fetch(`${rigHost}:${rigPort}/api/meshcom-udp/status`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) state.rigBridge = await r.json();
    } catch {
      // rig-bridge not available — that's OK
    }

    res.json(state);
  });

  // ── POST /api/meshcom/send ──────────────────────────────────────────────────
  // Proxies send request to rig-bridge plugin.
  app.post('/api/meshcom/send', async (req, res) => {
    const { to, message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });
    if (message.length > 150) return res.status(400).json({ error: 'Message exceeds 150 char MeshCom limit' });

    try {
      const rigHost = CONFIG.rigControl?.host || 'http://localhost';
      const rigPort = CONFIG.rigControl?.port || 5555;
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
      return res.status(503).json({ error: 'MeshCom UDP plugin not available — enable meshcom in rig-bridge config' });
    }
  });

  logInfo('[MeshCom] Routes registered');
};
