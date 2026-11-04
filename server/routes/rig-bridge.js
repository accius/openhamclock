'use strict';
/**
 * Rig Bridge routes — health proxy, auto-launch, cloud relay endpoints.
 *
 * Cloud Relay Architecture:
 *   Local rig-bridge (at user's home) pushes rig state to this server.
 *   The browser polls for state and pushes commands (tune, PTT, etc.).
 *   This server queues commands for the local rig-bridge to pick up.
 *
 *   Browser ←→ OHC Server ←→ Cloud Relay Plugin (in rig-bridge) ←→ Radio
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getClientIP } = require('../utils/helpers');
const crypto = require('crypto');
const { validateCustomHost } = require('../utils/ssrf');
const { registerRelayAudio } = require('./relayAudio');

const { sanitizeRelayIndicators, queueRelayCommand } = require('../utils/relay-indicators');

module.exports = function (app, ctx) {
  const { ROOT_DIR, logInfo, logWarn, requireWriteAuth, RIG_BRIDGE_RELAY_KEY } = ctx;

  let rigBridgeProcess = null;

  const RIG_BRIDGE_DIR = path.join(ROOT_DIR, 'rig-bridge');
  const RIG_BRIDGE_ENTRY = path.join(RIG_BRIDGE_DIR, 'rig-bridge.js');

  // ─── Relay Token Persistence ──────────────────────────────────────────
  // Resolve a writable path for relay-tokens.json using the same waterfall
  // as data/settings.json so tokens survive server restarts.
  const RELAY_TOKENS_FILE = (() => {
    const candidates = [
      process.env.RELAY_TOKENS_FILE,
      '/data/relay-tokens.json',
      path.join(ROOT_DIR, 'data', 'relay-tokens.json'),
      '/tmp/openhamclock-relay-tokens.json',
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
    return '/tmp/openhamclock-relay-tokens.json';
  })();

  // ─── Cloud Relay State Store ──────────────────────────────────────────
  // Per-session relay state and command queues.
  // Session = unique browser tab / user connection.
  const relaySessions = new Map(); // sessionId → { state, commands[], lastPush, lastPoll }
  const MAX_RELAY_SESSIONS = 50;
  const RELAY_SESSION_TTL = 3600000; // 1 hour

  // SSE clients waiting for live state pushes — keyed by sessionId
  const relayStreamClients = new Map(); // sessionId → Set<res>

  // Long-poll waiters for command delivery — keyed by sessionId.
  // When a browser POSTs a command, any waiting rig-bridge poll is resolved
  // immediately instead of waiting up to 250 ms for the next poll tick.
  const relayCommandWaiters = new Map(); // sessionId → Set<{ resolve, timer }>

  // Per-IP long-poll connection counter — caps concurrent waiters to bound resource use.
  const MAX_LONG_POLL_PER_IP = 10;
  // Rate-limit MeshCom ingest warnings to avoid spam when the ingest endpoint is down.
  const MESHCOM_WARN_INTERVAL = 60 * 1000; // 1 minute per subtype
  const meshcomWarnLastLogged = new Map(); // subtype → timestamp
  const relayPollCountByIP = new Map(); // ip → count

  // Issued relay tokens — sessionId → { token, lastUsed }.
  // Simple server-side lookup avoids any dependency on RIG_BRIDGE_RELAY_KEY being stable across
  // restarts or deployments (the HMAC approach broke when the key changed between issue and verify).
  // Tokens are persisted to RELAY_TOKENS_FILE so they survive server restarts.
  // Entries not used for RELAY_TOKEN_MAX_AGE are pruned on startup (background, non-blocking).
  const RELAY_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
  const relayIssuedTokens = new Map(); // sessionId → { token, lastUsed }
  try {
    const raw = fs.readFileSync(RELAY_TOKENS_FILE, 'utf8');
    const obj = JSON.parse(raw);
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      // Migrate old plain-string format — treat as freshly used so it isn't immediately pruned
      if (typeof v === 'string') relayIssuedTokens.set(k, { token: v, lastUsed: now });
      else if (v?.token) {
        relayIssuedTokens.set(k, {
          token: v.token,
          lastUsed: v.lastUsed ?? now,
          ...(typeof v.readTokenHash === 'string' && /^[0-9a-f]{64}$/.test(v.readTokenHash)
            ? { readTokenHash: v.readTokenHash }
            : {}),
        });
      }
    }
    logInfo(`[RigBridge] Loaded ${relayIssuedTokens.size} relay token(s) from ${RELAY_TOKENS_FILE}`);
  } catch {
    /* file absent on first run — normal */
  }

  function saveRelayTokens() {
    try {
      fs.writeFileSync(RELAY_TOKENS_FILE, JSON.stringify(Object.fromEntries(relayIssuedTokens), null, 2), 'utf8');
    } catch (err) {
      logWarn(`[RigBridge] Could not persist relay tokens: ${err.message}`);
    }
  }

  // Flush updated lastUsed timestamps to disk once per hour so they survive restarts
  setInterval(saveRelayTokens, 3600000);

  // Background startup cleanup — runs 15 s after boot so it never delays request handling.
  // Removes tokens unused for RELAY_TOKEN_MAX_AGE and persists the trimmed file.
  setTimeout(() => {
    const cutoff = Date.now() - RELAY_TOKEN_MAX_AGE;
    let removed = 0;
    for (const [k, v] of relayIssuedTokens) {
      if ((v.lastUsed ?? 0) < cutoff) {
        relayIssuedTokens.delete(k);
        removed++;
      }
    }
    if (removed > 0) {
      saveRelayTokens();
      logInfo(`[RigBridge] Pruned ${removed} stale relay token(s) (unused > 30 days)`);
    }
  }, 15000);

  function notifyCommandWaiters(sessionId) {
    const waiters = relayCommandWaiters.get(sessionId);
    if (!waiters || waiters.size === 0) return;
    const session = relaySessions.get(sessionId);
    if (!session) return;
    const commands = [...session.commands];
    session.commands = [];
    session.lastPoll = Date.now();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(commands);
    }
    relayCommandWaiters.delete(sessionId);
  }

  // ─── Relayed plugin events (fldigi / NBEMS) ───────────────────────────
  // rig-bridge's cloud relay pushes these as `pluginEvents` with the same
  // { event, source, data } shape as its local /stream. Only known events are
  // fanned out, each capped in size; the latest fldigi status and receive-text
  // tail are kept so a browser that opens the stream later starts populated.
  const RELAYED_PLUGIN_EVENTS = new Set([
    'fldigi',
    'fldigi-rx',
    'nbems-form',
    'fldigi-cmd-result',
    'relay-cmd-refused',
    'relay-cmd-result',
  ]);
  const PLUGIN_EVENT_MAX_BYTES = 20000;
  const FLDIGI_RX_TAIL = 4000;

  function relayPluginEvents(session, events, sseClients) {
    for (const ev of events.slice(0, 50)) {
      if (!ev || typeof ev !== 'object' || !RELAYED_PLUGIN_EVENTS.has(ev.event)) continue;
      if (!ev.data || typeof ev.data !== 'object') continue;
      let json;
      try {
        const source = ev.event === 'relay-cmd-refused' || ev.event === 'relay-cmd-result' ? 'cloud-relay' : 'fldigi';
        json = JSON.stringify({ type: 'plugin', event: ev.event, source, data: ev.data });
      } catch {
        continue;
      }
      if (json.length > PLUGIN_EVENT_MAX_BYTES) continue;
      if (ev.event === 'fldigi') session.fldigiStatus = ev.data;
      if (ev.event === 'fldigi-rx') {
        const text = typeof ev.data.text === 'string' ? ev.data.text : '';
        session.fldigiRx = (ev.data.reset ? text : (session.fldigiRx || '') + text).slice(-FLDIGI_RX_TAIL);
      }
      if (!sseClients) continue;
      for (const client of sseClients) {
        try {
          client.write(`data: ${json}\n\n`);
        } catch (e) {
          sseClients.delete(client);
        }
      }
    }
  }

  function getRelaySession(sessionId) {
    if (!relaySessions.has(sessionId)) {
      if (relaySessions.size >= MAX_RELAY_SESSIONS) {
        // Evict oldest session
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [k, v] of relaySessions) {
          if (v.lastPush < oldestTime) {
            oldestTime = v.lastPush;
            oldestKey = k;
          }
        }
        if (oldestKey) relaySessions.delete(oldestKey);
      }
      relaySessions.set(sessionId, {
        state: { connected: false, freq: 0, mode: '', ptt: false },
        commands: [],
        decodes: [],
        aprsPackets: [],
        lastPush: Date.now(),
        lastPoll: 0,
      });
    }
    return relaySessions.get(sessionId);
  }

  // Cleanup expired sessions and their waiters periodically
  setInterval(() => {
    const cutoff = Date.now() - RELAY_SESSION_TTL;
    for (const [k, v] of relaySessions) {
      if (v.lastPush < cutoff && v.lastPoll < cutoff) {
        relaySessions.delete(k);
        // Resolve any lingering command waiters so they don't hold open connections
        const waiters = relayCommandWaiters.get(k);
        if (waiters) {
          for (const w of waiters) {
            clearTimeout(w.timer);
            w.resolve([]);
          }
          relayCommandWaiters.delete(k);
        }
        // Close any orphaned SSE stream clients for this session
        const sseClients = relayStreamClients.get(k);
        if (sseClients) {
          for (const client of sseClients) {
            try {
              client.end();
            } catch (e) {
              // Client already gone — ignore
            }
          }
          relayStreamClients.delete(k);
        }
        // Tokens are NOT deleted here — they survive session expiry so rig-bridge
        // can reconnect after a server restart without re-authenticating.
      }
    }
    // Prune auth-warn rate-limit entries older than two intervals so the map
    // doesn't grow unboundedly when clients cycle through many bad sessionIds.
    const authWarnCutoff = Date.now() - AUTH_WARN_INTERVAL * 2;
    for (const [k, ts] of authWarnLastLogged) {
      if (ts < authWarnCutoff) authWarnLastLogged.delete(k);
    }
  }, 300000); // Every 5 minutes

  // ─── Relay Auth ───────────────────────────────────────────────────────
  // Rate-limit auth failure warnings: log once immediately, then at most once
  // per 5 minutes per sessionId. Prevents log spam when rig-bridge retries
  // with stale credentials (e.g. after a server restart invalidates tokens).
  const AUTH_WARN_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const authWarnLastLogged = new Map(); // sessionId (or '(none)') → timestamp

  function requireRelayAuth(req, res, next) {
    if (!RIG_BRIDGE_RELAY_KEY) {
      return res.status(503).json({ error: 'Cloud relay not configured — set RIG_BRIDGE_RELAY_KEY in .env' });
    }
    // Coerce to string: Express returns arrays for repeated query/body params
    // (e.g. ?session[]=a&session[]=b), which would type-confuse sessionId.slice()
    // and the rate-limit key derivation below.
    const rawSessionId = req.headers['x-relay-session'] || req.query.session || req.body?.session;
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId : undefined;
    // Routes act on req.relaySessionId only. A request that names a different
    // session anywhere else (header vs ?session= vs body) is refused, so a
    // bridge's own credentials can't be used to read another session's queue.
    const named = [req.headers['x-relay-session'], req.query.session, req.body?.session].filter(
      (v) => v !== undefined && v !== '',
    );
    if (named.some((v) => v !== sessionId)) {
      return res.status(400).json({ error: 'Conflicting relay session IDs in the request' });
    }
    const rawAuth = req.headers.authorization;
    const token = (typeof rawAuth === 'string' ? rawAuth : '').replace(/^Bearer\s+/i, '');
    const entry = sessionId ? relayIssuedTokens.get(sessionId) : undefined;
    if (!sessionId || !token || !entry || token !== entry.token) {
      const warnKey = sessionId ? sessionId.slice(0, 8) : '(none)';
      const now = Date.now();
      const lastLogged = authWarnLastLogged.get(warnKey) ?? 0;
      if (now - lastLogged >= AUTH_WARN_INTERVAL) {
        authWarnLastLogged.set(warnKey, now);
        logWarn(
          `[RigBridge] relay auth failed — sessionId: ${sessionId ? sessionId.slice(0, 8) + '…' : '(none)'}, ` +
            `token ${token ? 'present' : 'missing'}, issued token ${entry ? 'found' : 'not found in store'}`,
        );
      }
      return res.status(401).json({
        error:
          'Invalid relay credentials — re-run Connect Cloud Relay in OHC Settings → Rig Bridge to generate fresh credentials',
      });
    }
    entry.lastUsed = Date.now();
    req.relaySessionId = sessionId;
    // A paired bridge registers the hash of its relay read token on every
    // authenticated request (header) or state push (body); keep it, persisted,
    // so this session's reads stay protected across server restarts.
    const h = req.headers['x-relay-read-hash'] || req.body?.readTokenHash;
    if (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) && entry.readTokenHash !== h) {
      entry.readTokenHash = h;
      saveRelayTokens();
    }
    next();
  }

  // ─── Relay reads (state, decodes, APRS, live stream) ──────────────────
  // Once the bridge has registered a read-token hash, reading a session needs
  // the read token (X-Relay-Read header; the stream takes a one-time ticket
  // bought with it) — the session id alone is no longer enough. Sessions
  // whose bridge has no command key keep the old open reads until the grace
  // date, with an hourly warning, then are refused.
  const READ_GRACE_UNTIL = (() => {
    const t = Date.parse(process.env.RELAY_UNSIGNED_GRACE_UNTIL || '2027-01-31');
    return Number.isFinite(t) ? t : Date.parse('2027-01-31');
  })();
  const readWarnLastLogged = new Map(); // sessionId → timestamp

  function sha256Hex(hex) {
    return crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
  }

  /** → 'ok' | 'legacy' | 'denied' | 'unpaired-expired' */
  function checkRelayRead(sessionId, token) {
    const entry = typeof sessionId === 'string' ? relayIssuedTokens.get(sessionId) : null;
    if (!entry) return 'ok'; // unknown session: nothing to read
    if (entry.readTokenHash) {
      if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return 'denied';
      const a = Buffer.from(sha256Hex(token), 'hex');
      const b = Buffer.from(entry.readTokenHash, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'denied';
    }
    if (Date.now() >= READ_GRACE_UNTIL) return 'unpaired-expired';
    const now = Date.now();
    const key = sessionId.slice(0, 8);
    if (now - (readWarnLastLogged.get(key) ?? 0) >= 3600000) {
      readWarnLastLogged.set(key, now);
      logWarn(
        `[RigBridge] relay session ${key}… is read without a read token (bridge has no command key) — ` +
          `allowed until ${new Date(READ_GRACE_UNTIL).toISOString().slice(0, 10)}; re-run Connect Cloud Relay`,
      );
    }
    return 'legacy';
  }

  function refuseRead(res, verdict) {
    return res.status(401).json({
      error:
        verdict === 'unpaired-expired'
          ? 'This relay session has no command key — re-run Connect Cloud Relay in Settings → Rig Bridge'
          : 'Relay read token missing or wrong — re-run Connect Cloud Relay in Settings → Rig Bridge on this browser',
      relayActive: false,
    });
  }

  function requireRelayRead(req, res, next) {
    const sessionId = req.query.session || req.body?.session;
    const verdict = checkRelayRead(sessionId, req.headers['x-relay-read']);
    if (verdict === 'ok' || verdict === 'legacy') return next();
    return refuseRead(res, verdict);
  }

  // Other routes that serve a relay session's data (MeshCom, WSJT-X relay)
  // apply the same rule through ctx.relayRead (they load before this module,
  // so they look it up per request).
  ctx.relayRead = { check: checkRelayRead, require: requireRelayRead };

  // One-time stream tickets: the read token goes in a header to POST
  // /relay/stream-ticket, only the short-lived ticket goes in the stream URL.
  const STREAM_TICKET_TTL_MS = 60000;
  const streamTickets = new Map(); // ticket → { sessionId, exp }
  function issueStreamTicket(sessionId) {
    const now = Date.now();
    if (streamTickets.size > 2000) {
      for (const [t, v] of streamTickets) if (v.exp <= now) streamTickets.delete(t);
      if (streamTickets.size > 2000) streamTickets.delete(streamTickets.keys().next().value);
    }
    const ticket = crypto.randomBytes(16).toString('hex');
    streamTickets.set(ticket, { sessionId, exp: now + STREAM_TICKET_TTL_MS });
    return ticket;
  }
  function redeemStreamTicket(ticket, sessionId) {
    const grant = typeof ticket === 'string' ? streamTickets.get(ticket) : null;
    if (!grant) return false;
    streamTickets.delete(ticket); // single use, whatever the outcome
    return grant.sessionId === sessionId && grant.exp > Date.now();
  }

  // ─── Cloud Relay: Credentials (browser fetches to configure rig-bridge) ─
  app.get('/api/rig-bridge/relay/credentials', (req, res) => {
    try {
      if (!RIG_BRIDGE_RELAY_KEY) {
        return res.json({ error: 'Cloud relay not configured', configured: false });
      }
      const requested = typeof req.query.session === 'string' ? req.query.session : '';
      if (requested && !/^[a-z0-9]{8,32}$/.test(requested)) {
        return res.status(400).json({ error: 'Invalid session id', configured: false });
      }
      // Never re-issue credentials for an existing session: whoever knew the
      // session id could otherwise take it over (replace the bridge's token,
      // drop its read protection).
      if (requested && relayIssuedTokens.has(requested)) {
        return res.status(409).json({ error: 'Session already exists', configured: false });
      }
      const sessionId = requested || crypto.randomBytes(8).toString('hex');
      const token = crypto.randomBytes(32).toString('hex');
      relayIssuedTokens.set(sessionId, { token, lastUsed: Date.now() });
      saveRelayTokens();
      res.json({
        relayKey: token,
        session: sessionId,
        serverUrl: `${req.protocol}://${req.get('host')}`,
      });
    } catch (err) {
      logWarn(`[RigBridge] relay/credentials error: ${err.message}`);
      if (!res.headersSent) res.json({ error: 'Internal error', configured: false });
    }
  });

  // ─── Cloud Relay: State Push (rig-bridge → server) ────────────────────
  app.post('/api/rig-bridge/relay/state', requireRelayAuth, (req, res) => {
    try {
      const sessionId = req.relaySessionId;
      if (!sessionId) return res.status(400).json({ error: 'Missing session ID' });

      const session = getRelaySession(sessionId);
      // A bridge holding a command key says so; from then on this server
      // refuses unsigned commands for the session (the bridge would refuse
      // them anyway — this just tells the browser straight away).
      if (req.body.commandAuth === 'hmac-sha256' || req.body.commandAuth === 'none') {
        session.commandAuth = req.body.commandAuth;
      }
      session.state = {
        connected: req.body.connected ?? session.state.connected,
        freq: req.body.freq ?? session.state.freq,
        mode: req.body.mode ?? session.state.mode,
        ptt: req.body.ptt ?? session.state.ptt,
        width: req.body.width ?? session.state.width,
        timestamp: Date.now(),
      };
      session.lastPush = Date.now();

      // Fan out live state to any SSE clients watching this session
      const sseClients = relayStreamClients.get(sessionId);
      if (sseClients && sseClients.size > 0) {
        const msg = `data: ${JSON.stringify({ type: 'state', ...session.state, relayActive: true })}\n\n`;
        for (const client of sseClients) {
          try {
            client.write(msg);
          } catch (e) {
            logWarn(`[RigBridge] SSE client evicted during state fan-out (session=${sessionId}): ${e.message}`);
            sseClients.delete(client);
          }
        }
      }

      // Store any batched decodes
      if (Array.isArray(req.body.decodes) && req.body.decodes.length > 0) {
        if (!session.decodes) session.decodes = [];
        session.decodes.push(...req.body.decodes);
        if (session.decodes.length > 500) session.decodes = session.decodes.slice(-500);
      }

      // Store and forward APRS packets to the APRS station cache
      if (Array.isArray(req.body.aprsPackets) && req.body.aprsPackets.length > 0) {
        if (!session.aprsPackets) session.aprsPackets = [];
        session.aprsPackets.push(...req.body.aprsPackets);
        if (session.aprsPackets.length > 500) session.aprsPackets = session.aprsPackets.slice(-500);

        try {
          ctx
            .fetch(`http://localhost:${ctx.PORT}/api/aprs/local`, {
              method: 'POST',
              // Internal: exempt from the per-IP limits on the ingest routes
              headers: { 'Content-Type': 'application/json', 'X-OHC-Internal': ctx.INTERNAL_TOKEN || '' },
              body: JSON.stringify({ packets: req.body.aprsPackets }),
            })
            .catch(() => {});
        } catch (e) {}
      }

      // Forward MeshCom packets received from the rig-bridge cloud relay.
      // sessionId is injected so the meshcom route can store data in the
      // correct per-user session rather than a shared global pool.
      // Packets are also fanned out to any open SSE stream clients so the
      // browser panel updates in real-time (same path as WSJTX decodes).
      if (Array.isArray(req.body.meshcomPackets) && req.body.meshcomPackets.length > 0) {
        logInfo(`[RigBridge] Relaying ${req.body.meshcomPackets.length} MeshCom packet(s) for session=${sessionId}`);
        for (const pkt of req.body.meshcomPackets) {
          const subtype = pkt.subtype;
          if (subtype !== 'pos' && subtype !== 'msg' && subtype !== 'telem') continue;

          // 1. Persist in server-side session store (history, reconnect recovery)
          ctx
            .fetch(`http://localhost:${ctx.PORT}/api/meshcom/local/${subtype}`, {
              method: 'POST',
              // Internal: exempt from the per-IP limits on the ingest routes
              headers: { 'Content-Type': 'application/json', 'X-OHC-Internal': ctx.INTERNAL_TOKEN || '' },
              body: JSON.stringify({ ...pkt, sessionId }),
            })
            .then((r) => {
              if (!r.ok) {
                const now = Date.now();
                if (now - (meshcomWarnLastLogged.get(subtype) ?? 0) >= MESHCOM_WARN_INTERVAL) {
                  meshcomWarnLastLogged.set(subtype, now);
                  logWarn(`[RigBridge] MeshCom ingest rejected subtype=${subtype} status=${r.status}`);
                }
              }
            })
            .catch((e) => {
              const now = Date.now();
              if (now - (meshcomWarnLastLogged.get(subtype) ?? 0) >= MESHCOM_WARN_INTERVAL) {
                meshcomWarnLastLogged.set(subtype, now);
                logWarn(`[RigBridge] MeshCom ingest forward failed subtype=${subtype}: ${e.message}`);
              }
            });

          // 2. Fan out to SSE stream clients — same { type:'plugin' } envelope
          //    used by WSJTX decodes; RigContext forwards it as a rig-plugin-data
          //    window event that useMeshCom listens for.
          if (sseClients && sseClients.size > 0) {
            const sseMsg = `data: ${JSON.stringify({ type: 'plugin', event: 'meshcom', data: pkt })}\n\n`;
            for (const client of sseClients) {
              try {
                client.write(sseMsg);
              } catch (e) {
                logWarn(`[RigBridge] SSE client evicted during MeshCom fan-out (session=${sessionId}): ${e.message}`);
                sseClients.delete(client);
              }
            }
          }
        }
      }

      // HamAlert spots from the rig-bridge hamalert plugin — fan out to this
      // session's SSE clients with the same envelope the local /stream uses,
      // so useHamAlert handles both paths identically. Bounded per push.
      if (Array.isArray(req.body.hamAlerts) && req.body.hamAlerts.length > 0 && sseClients && sseClients.size > 0) {
        for (const alert of req.body.hamAlerts.slice(0, 50)) {
          if (!alert || typeof alert !== 'object' || typeof alert.call !== 'string') continue;
          const sseMsg = `data: ${JSON.stringify({ type: 'plugin', event: 'hamalert', source: 'hamalert', data: alert })}\n\n`;
          for (const client of sseClients) {
            try {
              client.write(sseMsg);
            } catch (e) {
              sseClients.delete(client);
            }
          }
        }
      }

      if (Array.isArray(req.body.pluginEvents) && req.body.pluginEvents.length > 0) {
        relayPluginEvents(session, req.body.pluginEvents, sseClients && sseClients.size > 0 ? sseClients : null);
      }

      res.json({ ok: true });
    } catch (err) {
      logWarn(`[RigBridge] relay/state push error: ${err.message}`);
      if (!res.headersSent) res.json({ ok: false, error: 'Internal error' });
    }
  });

  // ─── Cloud Relay: State Poll (browser → server) ───────────────────────
  app.get('/api/rig-bridge/relay/state', requireRelayRead, (req, res) => {
    try {
      const sessionId = req.query.session;
      if (!sessionId || !relaySessions.has(sessionId)) {
        return res.json({ connected: false, freq: 0, mode: '', ptt: false, relayActive: false });
      }
      const session = relaySessions.get(sessionId);
      const relayActive = Date.now() - session.lastPush < 30000;
      res.json({ ...session.state, relayActive });
    } catch (err) {
      logWarn(`[RigBridge] relay/state poll error: ${err.message}`);
      if (!res.headersSent) res.json({ connected: false, freq: 0, mode: '', ptt: false, relayActive: false });
    }
  });

  // ─── Cloud Relay: SSE Stream (browser → server, live state push) ──────
  // Browser connects here instead of polling. State updates are pushed as
  // soon as rig-bridge delivers them via POST /relay/state.
  app.post('/api/rig-bridge/relay/stream-ticket', requireRelayRead, (req, res) => {
    const sessionId = req.query.session || req.body?.session;
    if (typeof sessionId !== 'string' || !sessionId) return res.status(400).json({ error: 'Missing session ID' });
    res.json({ ticket: issueStreamTicket(sessionId), ttlMs: STREAM_TICKET_TTL_MS });
  });

  app.get('/api/rig-bridge/relay/stream', (req, res) => {
    try {
      const sessionId = req.query.session;
      if (!sessionId || typeof sessionId !== 'string') {
        return res.json({ error: 'Missing session ID', relayActive: false });
      }
      // A protected session's stream needs a one-time ticket (POST
      // /relay/stream-ticket with the read token); the URL carries no secret.
      const verdict = checkRelayRead(sessionId, null);
      if (verdict === 'unpaired-expired') return refuseRead(res, verdict);
      if (verdict === 'denied' && !redeemStreamTicket(req.query.ticket, sessionId)) {
        return refuseRead(res, verdict);
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      res.flushHeaders();

      // Send current known state immediately so the browser doesn't wait for
      // the first push from rig-bridge
      const initState = relaySessions.has(sessionId)
        ? (() => {
            const s = relaySessions.get(sessionId);
            return { type: 'state', ...s.state, relayActive: Date.now() - s.lastPush < 30000 };
          })()
        : { type: 'state', connected: false, freq: 0, mode: '', ptt: false, relayActive: false };
      try {
        res.write(`data: ${JSON.stringify(initState)}\n\n`);
        // Replay the latest fldigi status and receive tail (NBEMS panel)
        const s = relaySessions.get(sessionId);
        if (s?.fldigiStatus) {
          res.write(
            `data: ${JSON.stringify({ type: 'plugin', event: 'fldigi', source: 'fldigi', data: s.fldigiStatus })}\n\n`,
          );
        }
        if (s?.fldigiRx) {
          res.write(
            `data: ${JSON.stringify({ type: 'plugin', event: 'fldigi-rx', source: 'fldigi', data: { text: s.fldigiRx, reset: true } })}\n\n`,
          );
        }
      } catch (e) {
        return; // Client already disconnected
      }

      // Register this client
      if (!relayStreamClients.has(sessionId)) {
        relayStreamClients.set(sessionId, new Set());
      }
      relayStreamClients.get(sessionId).add(res);

      // Heartbeat every 25s to prevent proxy/load-balancer timeouts
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch (e) {
          clearInterval(heartbeat);
        }
      }, 25000);

      req.on('close', () => {
        clearInterval(heartbeat);
        const clients = relayStreamClients.get(sessionId);
        if (clients) {
          clients.delete(res);
          if (clients.size === 0) relayStreamClients.delete(sessionId);
        }
      });
    } catch (err) {
      logWarn(`[RigBridge] relay/stream error: ${err.message}`);
      if (!res.headersSent) res.json({ error: 'Internal error', relayActive: false });
    }
  });

  // ─── Cloud Relay: Decodes Poll (browser → server) ─────────────────────
  app.get('/api/rig-bridge/relay/decodes', requireRelayRead, (req, res) => {
    try {
      const sessionId = req.query.session;
      const since = parseInt(req.query.since) || 0;
      if (!sessionId || !relaySessions.has(sessionId)) {
        return res.json({ decodes: [] });
      }
      const session = relaySessions.get(sessionId);
      const decodes = (session.decodes || []).filter((d) => (d.timestamp || 0) > since);
      res.json({ count: decodes.length, decodes });
    } catch (err) {
      logWarn(`[RigBridge] relay/decodes error: ${err.message}`);
      if (!res.headersSent) res.json({ decodes: [] });
    }
  });

  // ─── Cloud Relay: APRS Packets Poll (browser → server) ─────────────────
  app.get('/api/rig-bridge/relay/aprs', requireRelayRead, (req, res) => {
    try {
      const sessionId = req.query.session;
      const since = parseInt(req.query.since) || 0;
      if (!sessionId || !relaySessions.has(sessionId)) {
        return res.json({ packets: [] });
      }
      const session = relaySessions.get(sessionId);
      const packets = (session.aprsPackets || []).filter((p) => (p.timestamp || 0) > since);
      res.json({ count: packets.length, packets });
    } catch (err) {
      logWarn(`[RigBridge] relay/aprs error: ${err.message}`);
      if (!res.headersSent) res.json({ packets: [] });
    }
  });

  // ─── Cloud Relay: Command Push (browser → server, for rig-bridge to pick up) ─
  app.post('/api/rig-bridge/relay/command', (req, res) => {
    try {
      const sessionId = req.query.session || req.body.session;
      if (!sessionId || !relaySessions.has(sessionId)) {
        return res.status(404).json({ error: 'No active relay session' });
      }
      const { type, payload, auth } = req.body;
      if (!type || typeof type !== 'string' || type.length > 40) {
        return res.status(400).json({ error: 'Missing command type' });
      }
      let payloadJson = '';
      try {
        payloadJson = JSON.stringify(payload ?? {});
      } catch {
        return res.status(400).json({ error: 'Invalid payload' });
      }
      if (payloadJson.length > 16384) return res.status(413).json({ error: 'Command too large' });

      // End-to-end command signature (rig-bridge/lib/relay-sign.js). This
      // server cannot check it — only the browser and the bridge hold the key
      // — so it only checks the shape and passes it on.
      let cleanAuth = null;
      if (auth != null) {
        const ok =
          typeof auth === 'object' &&
          auth.v === 1 &&
          Number.isFinite(auth.ts) &&
          typeof auth.nonce === 'string' &&
          /^[0-9a-f]{16,64}$/.test(auth.nonce) &&
          typeof auth.sig === 'string' &&
          /^[0-9a-f]{64}$/.test(auth.sig);
        if (!ok) return res.status(400).json({ error: 'Malformed command signature' });
        cleanAuth = { v: 1, ts: auth.ts, nonce: auth.nonce, sig: auth.sig };
      }

      const session = relaySessions.get(sessionId);
      if (type === 'indicators' && !sanitizeRelayIndicators(payload)) {
        return res.status(400).json({ error: 'Invalid indicators payload' });
      }
      if (session.commandAuth === 'hmac-sha256' && !cleanAuth) {
        return res.status(401).json({
          error:
            'Rig Bridge requires signed commands — re-run Connect Cloud Relay in Settings → Rig Bridge on this browser',
        });
      }
      // Display indicators (incl. the lightning relay request) are state, not
      // actions: only the newest is kept queued, whitelisted (see utils). The
      // end-to-end signature travels with the command, untouched.
      session.commands = queueRelayCommand(session.commands, type, payload, Date.now(), cleanAuth);

      // Wake any long-polling rig-bridge connection — delivers command immediately
      // instead of waiting for the next poll tick (up to pollInterval ms).
      notifyCommandWaiters(sessionId);

      res.json({ ok: true, queued: session.commands.length });
    } catch (err) {
      logWarn(`[RigBridge] relay/command error: ${err.message}`);
      if (!res.headersSent) res.json({ ok: false, error: 'Internal error' });
    }
  });

  // ─── Cloud Relay: Command Poll (rig-bridge → server) ──────────────────
  // Supports long-polling: pass ?wait=<ms> (max 30000) to hold the connection
  // open until a command is queued or the timeout expires. rig-bridge uses
  // this to receive commands within ~network RTT instead of up to pollInterval.
  app.get('/api/rig-bridge/relay/commands', requireRelayAuth, (req, res) => {
    try {
      const sessionId = req.relaySessionId;
      if (!sessionId) {
        return res.json({ commands: [] });
      }

      // Long-poll: hold until a command arrives or timeout fires.
      // Cap at 30 s to stay within typical proxy/load-balancer idle timeouts.
      const waitMs = Math.min(parseInt(req.query.wait) || 0, 30000);

      // Sessions live in memory but relay tokens are persisted, so an
      // authenticated bridge can poll for a session this process has never
      // seen (server restart) or has expired. Answering that long-poll at once
      // makes the bridge re-poll in a tight loop; register the session and hold
      // instead. Its state arrives with the bridge's next push.
      if (!relaySessions.has(sessionId) && !waitMs) {
        return res.json({ commands: [] });
      }
      const session = getRelaySession(sessionId);
      // A long-poll is activity: without this, a bridge whose rig sits idle
      // (no state changes, so no pushes) loses its session after the TTL.
      session.lastPoll = Date.now();

      // Commands already queued — return immediately (no hold needed)
      if (session.commands.length > 0) {
        const commands = [...session.commands];
        session.commands = [];
        return res.json({ commands });
      }

      if (!waitMs) {
        return res.json({ commands: [] });
      }

      const clientIP = getClientIP(req);
      const ipCount = relayPollCountByIP.get(clientIP) ?? 0;
      if (ipCount >= MAX_LONG_POLL_PER_IP) {
        return res.status(429).json({ error: 'Too many concurrent long-polls from this IP' });
      }
      relayPollCountByIP.set(clientIP, ipCount + 1);

      if (!relayCommandWaiters.has(sessionId)) {
        relayCommandWaiters.set(sessionId, new Set());
      }
      const waiterSet = relayCommandWaiters.get(sessionId);
      let resolved = false;

      function releaseIPSlot() {
        const n = relayPollCountByIP.get(clientIP);
        if (n != null) {
          if (n <= 1) relayPollCountByIP.delete(clientIP);
          else relayPollCountByIP.set(clientIP, n - 1);
        }
      }

      const waiter = {
        resolve(commands) {
          if (resolved) return;
          resolved = true;
          releaseIPSlot();
          try {
            res.json({ commands });
          } catch (e) {
            // Client disconnected before we could respond — harmless
          }
        },
      };

      waiter.timer = setTimeout(() => {
        waiterSet.delete(waiter);
        if (waiterSet.size === 0) relayCommandWaiters.delete(sessionId);
        waiter.resolve([]);
      }, waitMs);

      waiterSet.add(waiter);

      req.on('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(waiter.timer);
          waiterSet.delete(waiter);
          if (waiterSet.size === 0) relayCommandWaiters.delete(sessionId);
          releaseIPSlot();
        }
      });
    } catch (err) {
      logWarn(`[RigBridge] relay/commands error: ${err.message}`);
      if (!res.headersSent) res.json({ commands: [] });
    }
  });

  // ─── Cloud Relay: KiwiSDR audio for the Decoder panel (opt-in) ────────
  // See relayAudio.js. The browser sends its signed kiwiAudioStart/Tune through
  // /relay/command like any other command; this route only carries audio.
  registerRelayAudio(app, {
    requireRelayAuth,
    // Same read rule as /relay/stream: header token, or a one-time ticket
    canRead: (req, sessionId) => {
      const verdict = checkRelayRead(sessionId, req.headers['x-relay-read']);
      if (verdict === 'ok' || verdict === 'legacy') return 'ok';
      if (verdict === 'denied' && redeemStreamTicket(req.query.ticket, sessionId)) return 'ok';
      return verdict;
    },
    hasSession: (sessionId) => relaySessions.has(sessionId),
    logInfo,
    logWarn,
  });

  // ─── Cloud Relay: Configure ─────────────────────────────────────────
  app.post('/api/rig-bridge/relay/configure', (req, res) => {
    try {
      if (!RIG_BRIDGE_RELAY_KEY) {
        return res.json({ ok: false, error: 'Cloud relay not configured — set RIG_BRIDGE_RELAY_KEY in .env' });
      }
      const sessionId = crypto.randomBytes(8).toString('hex');
      const serverUrl = `${req.protocol}://${req.get('host')}`;
      const token = crypto.randomBytes(32).toString('hex');
      relayIssuedTokens.set(sessionId, { token, lastUsed: Date.now() });
      saveRelayTokens();
      res.json({
        ok: true,
        session: sessionId,
        serverUrl,
        relayKey: token,
        configPayload: {
          cloudRelay: {
            enabled: true,
            url: serverUrl,
            apiKey: token,
            session: sessionId,
          },
        },
      });
    } catch (err) {
      logWarn(`[RigBridge] relay/configure error: ${err.message}`);
      if (!res.headersSent) res.json({ ok: false, error: 'Internal error' });
    }
  });

  // ─── Cloud Relay: Revoke credentials ──────────────────────────────────
  // Invalidates a relay token immediately. Requires OHC write auth.
  // After revocation the rig-bridge must run Connect Cloud Relay again to get new credentials.
  app.delete('/api/rig-bridge/relay/revoke/:sessionId', requireWriteAuth, (req, res) => {
    const { sessionId } = req.params;
    if (!relayIssuedTokens.has(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    relayIssuedTokens.delete(sessionId);
    relaySessions.delete(sessionId);
    saveRelayTokens();
    logInfo(`[RigBridge] Relay token revoked for session ${sessionId.slice(0, 8)}…`);
    res.json({ ok: true });
  });

  // ─── Downloads: Platform-specific installer scripts ────────────────────
  app.get('/api/rig-bridge/download/:platform', (req, res) => {
    const platform = req.params.platform;
    if (!['windows', 'mac', 'linux'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform. Use: windows, mac, or linux' });
    }

    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const serverURL = (proto + '://' + host).replace(/[^a-zA-Z0-9._\-:\/\@]/g, '');
    try {
      new URL(serverURL);
    } catch {
      return res.status(400).json({ error: 'Invalid server URL derived from request headers' });
    }

    if (platform === 'windows') {
      const script = [
        '@echo off',
        'setlocal',
        'title OpenHamClock Rig Bridge Installer',
        'echo.',
        'echo  =============================================',
        'echo   OpenHamClock Rig Bridge — Windows Installer',
        'echo  =============================================',
        'echo.',
        '',
        'set "RIG_DIR=%USERPROFILE%\\openhamclock-rig-bridge"',
        '',
        'set "RB_PORT=5555"',
        'set "RB_PROTO=http"',
        'set "RB_HOST=localhost"',
        'set "RB_CFG=%APPDATA%\\openhamclock\\rig-bridge-config.json"',
        'if not exist "%RB_CFG%" set "RB_CFG=%USERPROFILE%\\openhamclock-rig-bridge\\rig-bridge-config.json"',
        'if exist "%RB_CFG%" (',
        '    for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try{(Get-Content \'%RB_CFG%\'|ConvertFrom-Json).port}catch{5555}"`) do set "RB_PORT=%%P"',
        "    for /f \"usebackq delims=\" %%T in (`powershell -NoProfile -Command \"try{if((Get-Content '%RB_CFG%'|ConvertFrom-Json).tls.enabled){'https'}else{'http'}}catch{'http'}\"`) do set \"RB_PROTO=%%T\"",
        "    for /f \"usebackq delims=\" %%H in (`powershell -NoProfile -Command \"try{$b=(Get-Content '%RB_CFG%'|ConvertFrom-Json).bindAddress;if([string]::IsNullOrEmpty($b)-or $b -eq '0.0.0.0'){$b='localhost'};$b}catch{'localhost'}\"`) do set \"RB_HOST=%%H\"",
        ')',
        '',
        'set "UPDATE_MODE=0"',
        'for %%A in (%*) do (',
        '    if /I "%%A"=="--update" set "UPDATE_MODE=1"',
        ')',
        '',
        'if "%UPDATE_MODE%"=="1" (',
        '    if not exist "%RIG_DIR%\\rig-bridge.js" (',
        '        echo   Error: rig-bridge is not installed at %RIG_DIR%',
        '        echo   Run this script without --update to install first.',
        '        pause',
        '        exit /b 1',
        '    )',
        ')',
        '',
        'if not exist "%RIG_DIR%" mkdir "%RIG_DIR%"',
        '',
        'where node >nul 2>nul',
        'if errorlevel 1 (',
        '    echo   Node.js not found. Please install from https://nodejs.org',
        '    echo   Then run this script again.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'where git >nul 2>nul',
        'if errorlevel 1 (',
        '    echo   Git not found. Please install from https://git-scm.com',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'if "%UPDATE_MODE%"=="1" (',
        '    echo   Checking for running rig-bridge...',
        '    netstat -ano 2>nul | findstr ":%RB_PORT% " | findstr "LISTENING" >nul 2>nul',
        '    if not errorlevel 1 (',
        '        echo   Stopping running rig-bridge on port %RB_PORT%...',
        '        for /f "tokens=5" %%P in (\'netstat -ano ^| findstr ":%RB_PORT% " ^| findstr "LISTENING"\') do (',
        '            taskkill /PID %%P /F >nul 2>nul',
        '        )',
        '        timeout /t 2 /nobreak >nul',
        '    )',
        ')',
        '',
        'if "%UPDATE_MODE%"=="1" (',
        '    echo   Downloading latest rig-bridge files...',
        '    if exist "%RIG_DIR%\\.update-staging" rmdir /S /Q "%RIG_DIR%\\.update-staging"',
        '    git clone --depth 1 --filter=blob:none --sparse https://github.com/accius/openhamclock.git "%RIG_DIR%\\.update-staging" 2>nul',
        '    if exist "%RIG_DIR%\\.update-staging" (',
        '        cd /d "%RIG_DIR%\\.update-staging"',
        '        git sparse-checkout set rig-bridge',
        '        if exist "%RIG_DIR%\\rig-bridge-config.json" copy /Y "%RIG_DIR%\\rig-bridge-config.json" "%TEMP%\\rig-bridge-config.bak" >nul',
        '        for /f "delims=" %%F in (\'dir /b /a-d "%RIG_DIR%"\') do (',
        '            if /I not "%%F"==".update-staging" if /I not "%%F"=="node_modules" del /F /Q "%RIG_DIR%\\%%F" >nul 2>nul',
        '        )',
        '        for /d %%D in ("%RIG_DIR%\\*") do (',
        '            if /I not "%%~nxD"==".update-staging" if /I not "%%~nxD"=="node_modules" rmdir /S /Q "%%D" >nul 2>nul',
        '        )',
        '        xcopy /E /Y /I "%RIG_DIR%\\.update-staging\\rig-bridge" "%RIG_DIR%"',
        '        cd /d "%RIG_DIR%"',
        '        rmdir /S /Q .update-staging',
        '        if exist "%TEMP%\\rig-bridge-config.bak" copy /Y "%TEMP%\\rig-bridge-config.bak" "%RIG_DIR%\\rig-bridge-config.json" >nul',
        '    ) else (',
        '        echo   Update failed: git clone error. Existing installation unchanged.',
        '        pause',
        '        exit /b 1',
        '    )',
        ') else (',
        '    echo   Cloning rig-bridge...',
        '    if not exist "%RIG_DIR%\\rig-bridge.js" (',
        '        git clone --depth 1 --filter=blob:none --sparse https://github.com/accius/openhamclock.git "%RIG_DIR%\\repo" 2>nul',
        '        if exist "%RIG_DIR%\\repo" (',
        '            cd /d "%RIG_DIR%\\repo"',
        '            git sparse-checkout set rig-bridge',
        '            xcopy /E /Y /I "%RIG_DIR%\\repo\\rig-bridge" "%RIG_DIR%"',
        '            cd /d "%RIG_DIR%"',
        '            rmdir /S /Q repo',
        '        ) else (',
        '            echo   Git clone failed. Make sure git is installed.',
        '            pause',
        '            exit /b 1',
        '        )',
        '    )',
        ')',
        '',
        'cd /d "%RIG_DIR%"',
        'echo   Installing dependencies...',
        'call npm install --omit=dev',
        '',
        'echo.',
        'if "%UPDATE_MODE%"=="1" (',
        '    echo   Rig Bridge updated - restarting...',
        ') else (',
        '    echo   Starting Rig Bridge...',
        ')',
        'echo.',
        'echo   Before continuing, read rig-bridge/README.md for radio-specific setup requirements.',
        'echo.',
        'echo   Setup UI: %RB_PROTO%://%RB_HOST%:%RB_PORT%',
        'echo   Opening in your browser now. Press Ctrl+C in this window to stop Rig Bridge.',
        'echo.',
        'start "" %RB_PROTO%://%RB_HOST%:%RB_PORT%',
        'node rig-bridge.js',
        'pause',
      ].join('\r\n');

      res.setHeader('Content-Type', 'application/x-bat');
      res.setHeader('Content-Disposition', 'attachment; filename="install-rig-bridge.bat"');
      return res.send(script);
    }

    // Mac / Linux
    const isMac = platform === 'mac';
    const script = [
      '#!/usr/bin/env bash',
      '# OpenHamClock Rig Bridge — Installer',
      'set -e',
      '',
      'RIG_DIR="$HOME/openhamclock-rig-bridge"',
      '',
      'RB_CFG="$HOME/.config/openhamclock/rig-bridge-config.json"',
      '[ ! -f "$RB_CFG" ] && RB_CFG="$HOME/Library/Application Support/openhamclock/rig-bridge-config.json"',
      '[ ! -f "$RB_CFG" ] && RB_CFG="$HOME/openhamclock-rig-bridge/rig-bridge-config.json"',
      'read -r RB_PORT SETUP_URL < <(RB_CFG="$RB_CFG" node -e \'try{const c=require(process.env.RB_CFG);const p=c.port||5555;const s=c.tls&&c.tls.enabled;const b=c.bindAddress&&c.bindAddress!=="0.0.0.0"?c.bindAddress:"localhost";const u=(s?"https":"http")+"://"+b+":"+p;process.stdout.write(p+" "+u+"\\n")}catch(e){process.stdout.write("5555 http://localhost:5555\\n")}\' 2>/dev/null || echo "5555 http://localhost:5555")',
      '',
      'UPDATE_MODE=0',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    --update) UPDATE_MODE=1 ;;',
      '    *) echo "Unknown argument: $1"; exit 1 ;;',
      '  esac',
      '  shift',
      'done',
      '',
      'if [ "$UPDATE_MODE" -eq 1 ] && [ ! -f "$RIG_DIR/rig-bridge.js" ]; then',
      '    echo "Error: rig-bridge is not installed at $RIG_DIR"',
      '    echo "Run this script without --update to install first."',
      '    exit 1',
      'fi',
      '',
      'mkdir -p "$RIG_DIR"',
      '',
      'if ! command -v node &> /dev/null; then',
      '    echo "Node.js not found. Install from https://nodejs.org or:"',
      isMac
        ? '    echo "  brew install node"'
        : '    echo "  sudo apt install nodejs npm  # or: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"',
      '    exit 1',
      'fi',
      '',
      'if ! command -v git &> /dev/null; then',
      '    echo "git not found. Install git and re-run."',
      '    exit 1',
      'fi',
      '',
      'if [ "$UPDATE_MODE" -eq 1 ]; then',
      '    echo "Checking for running rig-bridge..."',
      '    RB_PID=$(lsof -ti tcp:$RB_PORT 2>/dev/null || fuser $RB_PORT/tcp 2>/dev/null | tr -d " " || true)',
      '    if [ -n "$RB_PID" ]; then',
      '        echo "Stopping running rig-bridge (PID $RB_PID)..."',
      '        kill "$RB_PID" 2>/dev/null || true',
      '        sleep 2',
      '    fi',
      'fi',
      '',
      'echo "Downloading rig-bridge..."',
      'if [ "$UPDATE_MODE" -eq 1 ]; then',
      '    STAGING="$RIG_DIR/.update-staging"',
      '    rm -rf "$STAGING"',
      '    git clone --depth 1 --filter=blob:none --sparse https://github.com/accius/openhamclock.git "$STAGING"',
      '    if [ -d "$STAGING" ]; then',
      '        cd "$STAGING" && git sparse-checkout set rig-bridge',
      '        [ -f "$RIG_DIR/rig-bridge-config.json" ] && cp "$RIG_DIR/rig-bridge-config.json" /tmp/rig-bridge-config.bak',
      '        find "$RIG_DIR" -mindepth 1 -maxdepth 1 ! -name ".update-staging" ! -name "node_modules" -exec rm -rf {} +',
      '        cp -r "$STAGING/rig-bridge/"* "$RIG_DIR/"',
      '        rm -rf "$STAGING"',
      '        [ -f /tmp/rig-bridge-config.bak ] && cp /tmp/rig-bridge-config.bak "$RIG_DIR/rig-bridge-config.json"',
      '    else',
      '        echo "Update failed: git clone error. Existing installation is unchanged."',
      '        exit 1',
      '    fi',
      'elif [ ! -f "$RIG_DIR/rig-bridge.js" ]; then',
      '    cd "$RIG_DIR"',
      '    git clone --depth 1 --filter=blob:none --sparse https://github.com/accius/openhamclock.git repo 2>/dev/null',
      '    if [ -d repo ]; then',
      '        cd repo && git sparse-checkout set rig-bridge',
      '        cp -r rig-bridge/* "$RIG_DIR/"',
      '        cd "$RIG_DIR" && rm -rf repo',
      '    else',
      '        echo "Git clone failed. Make sure git is installed."',
      '        exit 1',
      '    fi',
      'fi',
      '',
      'cd "$RIG_DIR"',
      'echo "Installing dependencies..."',
      'npm install --omit=dev',
      '',
      'echo ""',
      'if [ "$UPDATE_MODE" -eq 1 ]; then',
      '    echo "Restarting Rig Bridge (updated)..."',
      'else',
      '    echo "Starting Rig Bridge..."',
      'fi',
      'node rig-bridge.js &',
      'NODE_PID=$!',
      '',
      'echo "Waiting for Rig Bridge to start..."',
      'RB_WAIT=0',
      'while ! lsof -ti "tcp:$RB_PORT" > /dev/null 2>&1 && ! fuser "$RB_PORT/tcp" > /dev/null 2>&1; do',
      '    if ! kill -0 "$NODE_PID" 2>/dev/null; then',
      '        echo "ERROR: Rig Bridge exited unexpectedly. Check the output above."',
      '        exit 1',
      '    fi',
      '    sleep 1',
      '    RB_WAIT=$((RB_WAIT + 1))',
      '    if [ "$RB_WAIT" -ge 30 ]; then',
      '        echo "ERROR: Rig Bridge did not start within 30 seconds."',
      '        kill "$NODE_PID" 2>/dev/null || true',
      '        exit 1',
      '    fi',
      'done',
      '',
      'echo ""',
      'echo "Before continuing, read rig-bridge/README.md for radio-specific setup requirements."',
      'echo ""',
      'if [ -t 0 ] && [ "${NONINTERACTIVE:-0}" != "1" ]; then',
      '    read -rp "Press Enter to open the Setup UI in your browser... " dummy',
      'fi',
      '',
      'if command -v xdg-open &> /dev/null; then',
      '    xdg-open "$SETUP_URL" 2>/dev/null &',
      'elif [[ "$(uname)" == "Darwin" ]]; then',
      '    open "$SETUP_URL" &',
      'fi',
      '',
      'wait $NODE_PID',
    ].join('\n');

    res.setHeader('Content-Type', 'application/x-shellscript');
    res.setHeader('Content-Disposition', `attachment; filename="install-rig-bridge.sh"`);
    res.send(script);
  });

  // ─── Local Management: Start/Stop/Status ──────────────────────────────

  app.post('/api/rig-bridge/start', requireWriteAuth, (req, res) => {
    if (rigBridgeProcess && !rigBridgeProcess.killed) {
      return res.status(409).json({ error: 'Rig Bridge is already running', pid: rigBridgeProcess.pid });
    }
    if (!fs.existsSync(RIG_BRIDGE_ENTRY)) {
      return res.status(404).json({ error: 'rig-bridge.js not found — only available for local installs' });
    }
    try {
      const child = spawn('node', [RIG_BRIDGE_ENTRY], {
        cwd: RIG_BRIDGE_DIR,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      rigBridgeProcess = child;
      child.on('exit', (code) => {
        logInfo(`[Rig Bridge] Process exited with code ${code}`);
        rigBridgeProcess = null;
      });
      logInfo(`[Rig Bridge] Launched (PID ${child.pid})`);
      res.json({ ok: true, pid: child.pid });
    } catch (err) {
      logWarn(`[Rig Bridge] Failed to launch: ${err.message}`);
      res.status(500).json({ error: `Failed to launch: ${err.message}` });
    }
  });

  app.post('/api/rig-bridge/stop', requireWriteAuth, (req, res) => {
    if (!rigBridgeProcess || rigBridgeProcess.killed) {
      return res.status(404).json({ error: 'No managed rig-bridge process running' });
    }
    try {
      rigBridgeProcess.kill('SIGTERM');
      logInfo('[Rig Bridge] Sent SIGTERM');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/rig-bridge/status', requireWriteAuth, async (req, res) => {
    const rawHost = (req.query.host || 'localhost').replace(/^https?:\/\//i, '');
    const proto = (req.query.host || '').startsWith('https') ? 'https' : 'http';
    const port = req.query.port || '5555';

    const validation = await validateCustomHost(rawHost);
    if (!validation.ok) {
      return res.status(400).json({ reachable: false, error: `Invalid host: ${validation.reason}` });
    }

    const url = `${proto}://${validation.resolvedIP}:${port}/health`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await ctx.fetch(url, {
        signal: controller.signal,
        headers: { Host: rawHost },
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return res.json({ reachable: false, error: `HTTP ${response.status}` });
      }
      const health = await response.json();
      res.json({
        reachable: true,
        managed: !!(rigBridgeProcess && !rigBridgeProcess.killed),
        ...health,
      });
    } catch (err) {
      res.json({
        reachable: false,
        managed: !!(rigBridgeProcess && !rigBridgeProcess.killed),
        error: err.name === 'AbortError' ? 'timeout' : err.message,
      });
    }
  });
};
