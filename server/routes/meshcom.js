/**
 * MeshCom integration routes.
 *
 * Receives JSON packets from the rig-bridge meshcom-udp plugin and
 * maintains a per-session in-memory cache of nodes, messages and
 * weather/telemetry. Each browser tab gets a unique session ID (generated
 * by useMeshCom and stored in localStorage) so data from different users'
 * rig-bridge instances is never mixed.
 *
 * Session lifecycle:
 *   - Created on first ingest POST (rig-bridge relay push).
 *   - Touched (lastAccessTime updated) on every read or write.
 *   - Expired and deleted after MESHCOM_SESSION_TTL_MS of inactivity
 *     (default 90 min) — longer than the relay session TTL so a session
 *     is never evicted while rig-bridge is actively pushing data.
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

  // Validate env-var integer fields — parseInt('xyz') returns NaN, which makes
  // all expiry comparisons false → nodes/sessions never expire → memory leak.
  function parseEnvMinutes(envName, defaultMinutes) {
    const raw = parseInt(process.env[envName], 10);
    if (!Number.isFinite(raw) || raw <= 0) {
      if (process.env[envName] != null) {
        logWarn(
          `[MeshCom] ${envName}="${process.env[envName]}" is not a valid positive integer — using default ${defaultMinutes}`,
        );
      }
      return defaultMinutes;
    }
    return raw;
  }

  const NODE_MAX_AGE_MS = parseEnvMinutes('MESHCOM_NODE_MAX_AGE_MINUTES', 60) * 60_000;
  const msgAgeHoursRaw = parseFloat(process.env.MESHCOM_MESSAGE_MAX_AGE_HOURS);
  const MESSAGE_MAX_AGE_MS = (Number.isFinite(msgAgeHoursRaw) && msgAgeHoursRaw > 0 ? msgAgeHoursRaw : 8) * 3_600_000;
  const MAX_MESSAGES = 200;
  // Sessions expire after 90 min of no reads or writes — 30 min longer than
  // the relay session TTL so active sessions are never evicted mid-use.
  const SESSION_TTL_MS = parseEnvMinutes('MESHCOM_SESSION_TTL_MINUTES', 90) * 60_000;

  // ── Per-session state ────────────────────────────────────────────────────────
  // sessions: sessionId → SessionState
  // Each browser tab creates its own session via getRelaySessionId() (src/utils/relaySession.js).
  const sessions = new Map();

  /**
   * Return the SessionState for the given ID, creating it if this is the
   * first ingest for that session. Updates lastAccessTime on every call.
   * Only call from write paths — reads use getSessionIfExists().
   */
  function getOrCreateSession(sessionId) {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        nodes: new Map(), // callsign → NodeObject
        messages: [], // bounded FIFO, arrival order
        weather: new Map(), // callsign → WeatherObject (latest per node)
        lastIngestTime: 0,
        lastAccessTime: Date.now(),
      });
    }
    const s = sessions.get(sessionId);
    s.lastAccessTime = Date.now();
    return s;
  }

  /**
   * Return the SessionState if it exists, or null. Updates lastAccessTime.
   * Use on all read paths so we never silently create an empty session on a
   * GET (which would prevent it from ever being expired by the cleanup timer).
   */
  function getSessionIfExists(sessionId) {
    if (!sessionId || !sessions.has(sessionId)) return null;
    const s = sessions.get(sessionId);
    s.lastAccessTime = Date.now();
    return s;
  }

  // ── ETag helpers ───────────────────────────────────────────────────────────
  function computeNodeEtag(nodes) {
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
  // Two levels:
  //   1. Session-level — evict entire sessions idle for SESSION_TTL_MS.
  //   2. Data-level    — expire old nodes and messages within each live session.
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    const sessionCutoff = now - SESSION_TTL_MS;

    for (const [sessionId, s] of sessions) {
      // ── Session-level expiry ──────────────────────────────────────────────
      if (s.lastAccessTime < sessionCutoff) {
        sessions.delete(sessionId);
        logDebug(`[MeshCom] Session ${sessionId} expired (idle > ${SESSION_TTL_MS / 60_000} min)`);
        continue;
      }

      // ── Data-level expiry (within active session) ─────────────────────────
      const nodeCutoff = now - NODE_MAX_AGE_MS;
      for (const [call, node] of s.nodes) {
        if (node.timestamp < nodeCutoff) {
          s.nodes.delete(call);
          s.weather.delete(call);
        }
      }

      const msgCutoff = now - MESSAGE_MAX_AGE_MS;
      let i = 0;
      while (i < s.messages.length && s.messages[i].timestamp < msgCutoff) i++;
      if (i > 0) s.messages.splice(0, i);
    }
  }, 60_000);

  cleanupTimer.unref?.();

  // ── Ingest: position ────────────────────────────────────────────────────────
  // Posted by the rig-bridge relay (server/routes/rig-bridge.js).
  // sessionId is included in the body by the relay forwarder.
  app.post('/api/meshcom/local/pos', (req, res) => {
    const pkt = req.body;
    if (!pkt || !pkt.src) return res.status(400).json({ error: 'Missing src' });
    if (!pkt.sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const s = getOrCreateSession(pkt.sessionId);
    const call = String(pkt.src).toUpperCase().trim();

    // null-safe coordinate guard — 0 is a valid position (equator / prime meridian)
    const lat = parseOrNull(pkt.lat);
    const lon = parseOrNull(pkt.lon);

    const existing = s.nodes.get(call);
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
    const wx = s.weather.get(call);
    if (wx) node.weather = wx;

    s.nodes.set(call, node);
    s.lastIngestTime = Date.now();
    logInfo(`[MeshCom] [${pkt.sessionId}] Position from ${call}: lat=${lat}, lon=${lon}, batt=${pkt.batt}`);
    res.json({ ok: true, updated: true });
  });

  // ── Ingest: text message ────────────────────────────────────────────────────
  app.post('/api/meshcom/local/msg', (req, res) => {
    const pkt = req.body;
    if (!pkt || !pkt.src || !pkt.msg) return res.status(400).json({ error: 'Missing src or msg' });
    if (!pkt.sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const s = getOrCreateSession(pkt.sessionId);

    s.messages.push({
      src: String(pkt.src).toUpperCase(),
      dst: pkt.dst ? String(pkt.dst).toUpperCase() : '*',
      text: pkt.msg,
      msgId: pkt.msgId ?? null,
      srcType: pkt.srcType ?? null,
      timestamp: pkt.timestamp ?? Date.now(),
    });

    if (s.messages.length > MAX_MESSAGES) s.messages.shift();
    s.lastIngestTime = Date.now();
    logDebug(
      `[MeshCom] [${pkt.sessionId}] Message from ${pkt.src} → ${pkt.dst || '*'} (${(pkt.msg || '').length} chars)`,
    );
    res.json({ ok: true });
  });

  // ── Ingest: telemetry / weather ─────────────────────────────────────────────
  app.post('/api/meshcom/local/telem', (req, res) => {
    const pkt = req.body;
    if (!pkt || !pkt.src) return res.status(400).json({ error: 'Missing src' });
    if (!pkt.sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const s = getOrCreateSession(pkt.sessionId);
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

    s.weather.set(call, wx);

    // Update weather on existing node too so the map popup has fresh data
    const node = s.nodes.get(call);
    if (node) {
      node.weather = wx;
      if (ts > node.timestamp) node.timestamp = ts;
    }

    s.lastIngestTime = Date.now();
    logInfo(`[MeshCom] [${pkt.sessionId}] Telemetry from ${call}: temp=${pkt.tempC}°C hum=${pkt.humidity}%`);
    res.json({ ok: true });
  });

  // ── GET /api/meshcom/nodes ──────────────────────────────────────────────────
  // Requires ?session=<id>. Supports ?since=<ms> and ETag / If-None-Match.
  app.get('/api/meshcom/nodes', (req, res) => {
    const s = getSessionIfExists(req.query.session);
    if (!s) return res.json({ count: 0, nodes: [] });

    const etag = computeNodeEtag(s.nodes);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const sinceRaw = parseInt(req.query.since, 10);
    const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
    const cutoff = Date.now() - NODE_MAX_AGE_MS;

    const result = [];
    for (const node of s.nodes.values()) {
      if (node.timestamp < cutoff) continue;
      if (since > 0 && node.timestamp <= since) continue;
      const ageMin = Math.floor((Date.now() - node.timestamp) / 60_000);
      result.push({ ...node, ageMin });
    }

    res.set('ETag', etag);
    res.json({ count: result.length, nodes: result.sort((a, b) => b.timestamp - a.timestamp) });
  });

  // ── GET /api/meshcom/messages ───────────────────────────────────────────────
  // Requires ?session=<id>. Supports ?since=<ms>.
  app.get('/api/meshcom/messages', (req, res) => {
    const s = getSessionIfExists(req.query.session);
    if (!s) return res.json({ count: 0, messages: [] });

    const sinceRaw = parseInt(req.query.since, 10);
    const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
    const result = since > 0 ? s.messages.filter((m) => m.timestamp > since) : s.messages.slice();
    res.json({ count: result.length, messages: result });
  });

  // ── GET /api/meshcom/weather ────────────────────────────────────────────────
  // Requires ?session=<id>.
  app.get('/api/meshcom/weather', (req, res) => {
    const s = getSessionIfExists(req.query.session);
    if (!s) return res.json({ count: 0, weather: [] });

    const result = Array.from(s.weather.values());
    res.json({ count: result.length, weather: result });
  });

  // ── GET /api/meshcom/status ─────────────────────────────────────────────────
  // Purely synchronous — no outbound HTTP calls. Derives rig-bridge
  // connectivity from this session's lastIngestTime.
  app.get('/api/meshcom/status', (req, res) => {
    const s = getSessionIfExists(req.query.session);
    if (!s) {
      return res.json({
        nodeCount: 0,
        messageCount: 0,
        lastIngestTime: 0,
        rigBridge: { running: false },
      });
    }

    const ACTIVE_WINDOW_MS = 30 * 60_000; // 30 min — LoRa beacons can be 15+ min apart
    const running = s.lastIngestTime > 0 && Date.now() - s.lastIngestTime < ACTIVE_WINDOW_MS;
    res.json({
      nodeCount: s.nodes.size,
      messageCount: s.messages.length,
      lastIngestTime: s.lastIngestTime,
      rigBridge: { running },
    });
  });

  // ── POST /api/meshcom/send ──────────────────────────────────────────────────
  // Proxies send request to rig-bridge plugin. Session is validated but not
  // used for routing — UDP send goes to the local mesh regardless.
  app.post('/api/meshcom/send', async (req, res) => {
    const { to, message, session } = req.body;
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
      logWarn(`[MeshCom] Send proxy error (session=${session}): ${e.message}`);
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
