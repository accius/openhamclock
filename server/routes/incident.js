'use strict';
/**
 * Shared incident API — one EmComm operating picture for several operators
 * and sites. See docs/API.md#shared-incident-api.
 *
 *   Any browser ──POST─▶ /api/incident                 create → { id, joinKey, adminKey }
 *   Any browser ──POST─▶ /api/incident/:id/join        (key) → full state + role
 *   Any browser ──POST─▶ /api/incident/:id/leave       (key)
 *   Any browser ──GET──▶ /api/incident/:id?since=N     (key) → changes after seq N
 *   Any browser ──POST─▶ /api/incident/:id/sync        (key) roster / events / reports / docs / board
 *   Admin       ──POST─▶ /api/incident/:id/admin       (admin key) edit / delete records
 *   Admin       ──POST─▶ /api/incident/:id/rotate      (admin key) new join key
 *   Any browser ──POST─▶ /api/incident/:id/ticket      (key) → one-time stream ticket
 *   Any browser ──SSE──▶ /api/incident/:id/stream      (?ticket=) snapshot, then live changes
 *   Local only  ──GET──▶ /api/incident/list            enumerate (disabled when OHC_HOSTED)
 *
 * Authorization: two keys handed out once at creation — the join key
 * (operators: append, check out, edit shared documents) and the admin key
 * (also edit/delete records, edit the board, rotate the join key). The
 * server keeps only salted hashes and compares in constant time
 * (server/utils/incidentAuth.js). A key travels only as `X-Incident-Key` or a
 * JSON body `key`, never in a URL: the SSE stream, which cannot send headers,
 * takes a single-use ticket (60 s, bound to incident + client id + key
 * generation) from POST /ticket instead.
 *
 * State lives in server/utils/incidentStore.js (pure, bounded, idempotent
 * merge by stable ids). This module owns transport and persistence: a JSON
 * file under the data dir (same writable-path waterfall as group-logs.json),
 * written debounced and atomically, so a restart does not lose an activation.
 * Idle incidents expire after 7 days.
 *
 * Hosted (OHC_HOSTED): ids are random and unguessable as everywhere, listing
 * is disabled, a wrong id and a wrong key get the same 403, the caps are
 * tighter (incidents, records, streams, creates per IP and per hour), the
 * creator must give a valid callsign (capped incidents per callsign), and
 * unattended incidents are recycled sooner as the pool fills.
 */

const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { getClientIP } = require('../utils/helpers');
const { createIncidentStore, IncidentError } = require('../utils/incidentStore');
const { normaliseToken, isValidIncidentId, makeTicket } = require('../utils/incidentAuth');

module.exports = function (app, ctx) {
  const { ROOT_DIR, logInfo, logWarn, logDebug, writeLimiter, requireWriteAuth } = ctx;

  const IS_HOSTED = process.env.OHC_HOSTED === '1' || process.env.OHC_HOSTED === 'true';
  const store = createIncidentStore({ hosted: IS_HOSTED });

  const MAX_STREAMS_PER_INCIDENT = IS_HOSTED ? 25 : 50;
  const MAX_STREAMS_TOTAL = IS_HOSTED ? 300 : 200;
  const MAX_SSE_PER_IP = parseInt(process.env.INCIDENT_MAX_SSE_PER_IP || '20', 10); // an EOC may sit behind one NAT
  const MAX_CREATES_PER_IP_HOUR = IS_HOSTED ? 3 : 20;
  const MAX_CREATE_IPS = 5000;
  const KEEPALIVE_MS = 25 * 1000;
  const PRESENCE_SWEEP_MS = 30 * 1000;
  const TICKET_TTL_MS = 60 * 1000;
  const MAX_TICKETS = 5000;

  // Tolerate a mounted ctx without the shared limiters (tests, embedding).
  const passthrough = (req, res, next) => next();
  const createLimiter = writeLimiter || passthrough;
  const listAuth = requireWriteAuth || passthrough;

  // Every open EmComm browser syncs on change (debounced client-side), and
  // several browsers at one site share a public IP — looser than writeLimiter.
  const syncLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many incident updates' },
    keyGenerator: getClientIP,
  });

  // ─── Persistence ─────────────────────────────────────────────────────────
  const INCIDENT_FILE = (() => {
    const candidates = [
      process.env.INCIDENT_FILE,
      '/data/incidents.json',
      path.join(ROOT_DIR || process.cwd(), 'data', 'incidents.json'),
      '/tmp/openhamclock-incidents.json',
    ];
    for (const p of candidates) {
      if (!p) continue;
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.accessSync(path.dirname(p), fs.constants.W_OK);
        return p;
      } catch {
        continue;
      }
    }
    return '/tmp/openhamclock-incidents.json';
  })();

  try {
    const loaded = store.hydrate(JSON.parse(fs.readFileSync(INCIDENT_FILE, 'utf8')));
    const expired = store.expire();
    if (loaded) logInfo?.(`[Incident] Loaded ${loaded - expired} incident(s) from ${INCIDENT_FILE}`);
  } catch {
    /* file absent on first run — normal */
  }

  let saveTimer = null;
  function saveNow() {
    try {
      const tmp = `${INCIDENT_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store.serialise()), 'utf8');
      fs.renameSync(tmp, INCIDENT_FILE);
    } catch (err) {
      logWarn?.(`[Incident] Could not persist incidents: ${err.message}`);
    }
  }
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, 2000);
    saveTimer.unref?.();
  }

  // ─── SSE fan-out ─────────────────────────────────────────────────────────
  const streams = new Map(); // incident id → Set<{ res, clientId, ip }>
  const sseByIp = new Map();
  const lastPresence = new Map(); // incident id → participant count last broadcast
  let streamTotal = 0;

  function writeEvent(res, event, data, id) {
    try {
      res.write(`${id != null ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === 'function') res.flush();
      return true;
    } catch {
      return false;
    }
  }

  function broadcast(id, event, data, seq) {
    const set = streams.get(id);
    if (!set) return 0;
    let sent = 0;
    for (const s of set) if (writeEvent(s.res, event, data, seq)) sent++;
    return sent;
  }

  function broadcastPresence(id, force = false) {
    if (!store.has(id)) return;
    const n = store.meta(id).participants;
    if (!force && lastPresence.get(id) === n) return;
    lastPresence.set(id, n);
    broadcast(id, 'presence', { participants: n });
  }

  const sweepTimer = setInterval(() => {
    for (const id of streams.keys()) broadcastPresence(id);
    for (const id of lastPresence.keys()) if (!streams.has(id)) lastPresence.delete(id);
  }, PRESENCE_SWEEP_MS);
  sweepTimer.unref?.();

  const cleanupTimer = setInterval(
    () => {
      const before = new Set(streams.keys());
      const dropped = store.expire();
      for (const id of before) {
        if (store.has(id)) continue;
        broadcast(id, 'expired', { id });
        for (const s of streams.get(id) || []) {
          try {
            s.res.end();
          } catch {
            /* already closed */
          }
        }
      }
      for (const [ip, entry] of createsByIp)
        if (Date.now() - entry.windowStart > 60 * 60 * 1000) createsByIp.delete(ip);
      if (dropped) logInfo?.(`[Incident] Expired ${dropped} idle incident(s)`);
      scheduleSave(); // also persists participant-driven lastActivity
    },
    10 * 60 * 1000, // often enough for pool-pressure eviction to matter
  );
  cleanupTimer.unref?.();

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const noCache = (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  /** The key from `X-Incident-Key` or a JSON body `key` — never from the URL. */
  function extractKey(req) {
    const h = req.headers?.['x-incident-key'];
    if (typeof h === 'string' && h.trim()) return h.trim();
    const b = req.body?.key;
    if (typeof b === 'string' && b.trim()) return b.trim();
    return '';
  }

  const clientIdOf = (req) => String(req.body?.clientId ?? req.query?.clientId ?? '').substring(0, 40);

  function denyIncident(res, id) {
    if (!IS_HOSTED && isValidIncidentId(id) && !store.has(id)) {
      res.status(404).json({ error: 'Unknown or expired incident' });
    } else {
      // Hosted: one answer for "no such id" and "wrong key" — ids cannot be probed.
      res.status(403).json({ error: 'Incident id or join key is wrong' });
    }
    return null;
  }

  /**
   * → { id, role, keyGen } when the key opens the incident (role 'admin' or
   * 'operator'); otherwise sends the error and returns null.
   */
  function authIncident(req, res, { admin = false } = {}) {
    const id = normaliseToken(req.params.id);
    const v = isValidIncidentId(id) ? store.verify(id, extractKey(req)) : null;
    if (!v) return denyIncident(res, id);
    if (admin && v.role !== 'admin') {
      res.status(403).json({ error: 'This needs the incident’s admin key' });
      return null;
    }
    return { id, role: v.role, keyGen: v.keyGen, joinKey: v.joinKey ?? null };
  }

  function sendError(res, err) {
    if (err instanceof IncidentError) return res.status(err.status).json({ error: err.message });
    logWarn?.(`[Incident] ${err?.message || err}`);
    return res.status(500).json({ error: 'Incident request failed' });
  }

  const createsByIp = new Map(); // ip → { count, windowStart }
  function allowCreate(ip) {
    const now = Date.now();
    const entry = createsByIp.get(ip);
    if (!entry || now - entry.windowStart > 60 * 60 * 1000) {
      if (createsByIp.size >= MAX_CREATE_IPS) createsByIp.delete(createsByIp.keys().next().value);
      createsByIp.set(ip, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    return entry.count <= MAX_CREATES_PER_IP_HOUR;
  }

  // ─── Stream tickets ──────────────────────────────────────────────────────
  // EventSource cannot send headers, so instead of putting the join key in
  // the stream URL (where proxies log it) a client POSTs the key in a header
  // and gets a one-time ticket, valid for TICKET_TTL_MS, bound to this
  // incident, this client id and the current join-key generation.
  const tickets = new Map(); // ticket → { id, clientId, role, keyGen, exp }
  function issueTicket(auth, clientId) {
    const now = Date.now();
    if (tickets.size >= MAX_TICKETS) {
      for (const [t, v] of tickets) if (v.exp <= now) tickets.delete(t);
      if (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value);
    }
    const ticket = makeTicket();
    tickets.set(ticket, {
      id: auth.id,
      clientId,
      role: auth.role,
      keyGen: auth.keyGen,
      joinKey: auth.role === 'admin' ? auth.joinKey : null, // memory only, for the admin's snapshot
      exp: now + TICKET_TTL_MS,
    });
    return ticket;
  }
  /** Consume a ticket. → its grant, or null when unknown, used, expired, or for another incident/client/key. */
  function redeemTicket(ticket, id, clientId) {
    const grant = typeof ticket === 'string' ? tickets.get(ticket) : null;
    if (!grant) return null;
    tickets.delete(ticket); // single use, whatever the outcome
    if (grant.exp <= Date.now() || grant.id !== id || grant.clientId !== clientId) return null;
    if (grant.role !== 'admin' && grant.keyGen !== store.keyGenOf(id)) return null;
    return grant;
  }

  // ─── Routes ──────────────────────────────────────────────────────────────

  // Discovery: what this server allows.
  app.get('/api/incident', (req, res) => {
    noCache(res);
    res.json({
      hosted: IS_HOSTED,
      listing: !IS_HOSTED,
      incidents: IS_HOSTED ? undefined : store.size,
      requireCallsign: store.limits.requireCallsign,
      limits: {
        roster: store.limits.maxRoster,
        events: store.limits.maxEvents,
        reports: store.limits.maxReports,
        docBytes: store.limits.maxDocBytes,
        perCallsign: store.limits.maxPerCallsign,
        idleDays: 7,
      },
    });
  });

  // Local installs only: list incidents (never keys) so an operator can find
  // the one they meant to rejoin. Disabled on the hosted site.
  app.get('/api/incident/list', listAuth, (req, res) => {
    noCache(res);
    if (IS_HOSTED) return res.status(403).json({ error: 'Incident listing is disabled on this server' });
    res.json({
      incidents: store.list().map((m) => ({
        id: m.id,
        name: m.board?.name || '',
        createdAt: m.createdAt,
        lastActivity: m.lastActivity,
        participants: m.participants,
        counts: m.counts,
      })),
    });
  });

  app.post('/api/incident', createLimiter, (req, res) => {
    noCache(res);
    if (!allowCreate(getClientIP(req))) {
      return res.status(429).json({ error: 'Too many incidents created from this address' });
    }
    try {
      const body = req.body || {};
      const { incident, joinKey, adminKey } = store.create(
        { name: body.name, ic: body.ic, netFreq: body.netFreq, notes: body.notes },
        { call: body.call },
      );
      store.touchParticipant(incident.id, clientIdOf(req), body.call);
      scheduleSave();
      logInfo?.(`[Incident] ${incident.id} created${incident.board.name ? ` ("${incident.board.name}")` : ''}`);
      res.json({
        ok: true,
        id: incident.id,
        joinKey,
        adminKey,
        role: 'admin',
        incident: store.snapshot(incident.id, 0),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // writeLimiter here as well: join is where a key would be guessed.
  app.post('/api/incident/:id/join', createLimiter, (req, res) => {
    noCache(res);
    const auth = authIncident(req, res);
    if (!auth) return;
    try {
      store.touchParticipant(auth.id, clientIdOf(req), req.body?.call);
      broadcastPresence(auth.id);
      res.json({
        ok: true,
        id: auth.id,
        role: auth.role,
        // Admins get the current join key back (unsealed with their key) so Invite works on any device.
        ...(auth.role === 'admin' ? { joinKey: auth.joinKey } : {}),
        incident: store.snapshot(auth.id, 0),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/incident/:id/leave', syncLimiter, (req, res) => {
    noCache(res);
    const auth = authIncident(req, res);
    if (!auth) return;
    const participants = store.removeParticipant(auth.id, clientIdOf(req));
    broadcastPresence(auth.id);
    res.json({ ok: true, participants });
  });

  app.get('/api/incident/:id', (req, res) => {
    noCache(res);
    const auth = authIncident(req, res);
    if (!auth) return;
    try {
      const cid = clientIdOf(req);
      if (cid) store.touchParticipant(auth.id, cid, req.query?.call);
      const since = Math.max(0, parseInt(req.query.since, 10) || 0);
      res.json({
        ...store.snapshot(auth.id, since),
        role: auth.role,
        ...(auth.role === 'admin' ? { joinKey: auth.joinKey } : {}),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/incident/:id/sync', syncLimiter, (req, res) => {
    noCache(res);
    const auth = authIncident(req, res);
    if (!auth) return;
    try {
      const body = req.body || {};
      const cid = clientIdOf(req);
      if (cid) store.touchParticipant(auth.id, cid, body.call);
      const result = store.apply(
        auth.id,
        { roster: body.roster, events: body.events, reports: body.reports, docs: body.docs, board: body.board },
        { site: body.site, role: auth.role },
      );
      if (result.changed) {
        broadcast(auth.id, 'change', { seq: result.seq, ...result.changes }, result.seq);
        scheduleSave();
      }
      broadcastPresence(auth.id);
      const out = {
        ok: !result.docConflicts.length,
        seq: result.seq,
        accepted: {
          roster: result.changes.roster.length,
          events: result.changes.events.length,
          reports: result.changes.reports.length,
          docs: result.changes.docs.length,
          board: !!result.changes.board,
        },
        // The revision each accepted document now has (the writer bases its next write on it).
        docRevs: Object.fromEntries(result.changes.docs.map((d) => [d.id, d.docRev])),
        denied: result.denied,
      };
      // A document written on top of an older revision was refused; the rest
      // of the batch was applied. 409 with the current copy of each refused one.
      if (result.docConflicts.length) {
        return res.status(409).json({
          ...out,
          error: 'A shared document was changed by someone else since this copy was made',
          conflicts: result.docConflicts.map((c) => ({ id: c.id, baseRev: c.baseRev, current: c.current })),
        });
      }
      res.json(out);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Admin: edit or delete events / reports, clear the board.
  app.post('/api/incident/:id/admin', syncLimiter, (req, res) => {
    noCache(res);
    const auth = authIncident(req, res, { admin: true });
    if (!auth) return;
    try {
      const result = store.adminChange(auth.id, { edit: req.body?.edit, delete: req.body?.delete });
      if (result.changed) {
        broadcast(auth.id, 'change', { seq: result.seq, ...result.changes }, result.seq);
        scheduleSave();
      }
      res.json({
        ok: true,
        seq: result.seq,
        edited: { events: result.changes.events.length, reports: result.changes.reports.length },
        deleted: result.changes.deleted.length,
        board: !!result.changes.board,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Admin: replace the join key. Operator streams are closed and their old
  // key stops working; admin streams are told the new key.
  app.post('/api/incident/:id/rotate', createLimiter, (req, res) => {
    noCache(res);
    const auth = authIncident(req, res, { admin: true });
    if (!auth) return;
    try {
      const { joinKey, keyGen } = store.rotateJoinKey(auth.id, extractKey(req));
      for (const [t, grant] of tickets) if (grant.id === auth.id && grant.role !== 'admin') tickets.delete(t);
      let disconnected = 0;
      for (const s of [...(streams.get(auth.id) || [])]) {
        if (s.role === 'admin') {
          writeEvent(s.res, 'rekeyed', { keyGen, joinKey });
          continue;
        }
        writeEvent(s.res, 'rekeyed', { keyGen });
        try {
          s.res.end();
        } catch {
          /* already closed */
        }
        disconnected++;
      }
      scheduleSave();
      logInfo?.(`[Incident] ${auth.id} join key rotated (${disconnected} operator stream(s) closed)`);
      res.json({ ok: true, joinKey, keyGen, disconnected });
    } catch (err) {
      sendError(res, err);
    }
  });

  // One-time stream ticket: key in a header, ticket in the stream URL.
  app.post('/api/incident/:id/ticket', syncLimiter, (req, res) => {
    noCache(res);
    const auth = authIncident(req, res);
    if (!auth) return;
    const clientId = clientIdOf(req);
    res.json({ ok: true, ticket: issueTicket(auth, clientId), expiresIn: TICKET_TTL_MS / 1000, role: auth.role });
  });

  app.get('/api/incident/:id/stream', (req, res) => {
    const id = normaliseToken(req.params.id);
    const clientId = clientIdOf(req);
    const grant = isValidIncidentId(id) ? redeemTicket(String(req.query.ticket || ''), id, clientId) : null;
    if (!grant || !store.has(id)) {
      return res.status(403).json({ error: 'Stream ticket is missing, used, expired or for another incident' });
    }

    const ip = getClientIP(req);
    const perIp = sseByIp.get(ip) || 0;
    const set = streams.get(id) || new Set();
    if (perIp >= MAX_SSE_PER_IP) return res.status(429).json({ error: 'Too many open streams from this address' });
    if (set.size >= MAX_STREAMS_PER_INCIDENT || streamTotal >= MAX_STREAMS_TOTAL) {
      return res.status(503).json({ error: 'Too many listeners on this incident — fall back to polling' });
    }

    // Resume point: EventSource sends Last-Event-ID on its own reconnects.
    const lastId = parseInt(req.headers?.['last-event-id'], 10);
    const since = Number.isFinite(lastId) ? lastId : Math.max(0, parseInt(req.query.since, 10) || 0);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const entry = { res, clientId, ip, role: grant.role };
    set.add(entry);
    streams.set(id, set);
    streamTotal++;
    sseByIp.set(ip, perIp + 1);

    if (clientId) store.touchParticipant(id, clientId, req.query?.call);
    const snap = store.snapshot(id, since);
    writeEvent(
      res,
      'snapshot',
      { ...snap, role: grant.role, ...(grant.role === 'admin' ? { joinKey: grant.joinKey } : {}) },
      snap.seq,
    );
    broadcastPresence(id, true);

    const keepalive = setInterval(() => {
      try {
        res.write(`: keepalive ${Date.now()}\n\n`);
        if (typeof res.flush === 'function') res.flush();
        if (clientId && store.has(id)) store.touchParticipant(id, clientId);
      } catch {
        clearInterval(keepalive);
      }
    }, KEEPALIVE_MS);
    keepalive.unref?.();

    req.on('close', () => {
      clearInterval(keepalive);
      const s = streams.get(id);
      if (s) {
        s.delete(entry);
        if (s.size === 0) streams.delete(id);
      }
      streamTotal = Math.max(0, streamTotal - 1);
      const n = sseByIp.get(ip) || 1;
      if (n <= 1) sseByIp.delete(ip);
      else sseByIp.set(ip, n - 1);
      logDebug?.(`[Incident] stream closed for ${id}`);
    });
  });

  logInfo?.(`[Incident] Shared incident API ready (hosted=${IS_HOSTED}, file=${INCIDENT_FILE})`);

  return { incidentStore: store, flushIncidents: saveNow };
};
