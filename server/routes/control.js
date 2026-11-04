'use strict';
/**
 * Remote-control API (HamClock-style `set_*` commands) — see docs/API.md.
 *
 *   Browser display  ──SSE──▶  GET  /api/control/stream?target=<id>
 *   Browser display  ──POST─▶  /api/control/report        (state, every 30 s + on change)
 *   Browser display  ──POST─▶  /api/control/capture       (PNG frame, in reply to a capture command)
 *   Any client       ──POST─▶  /api/control/<command>     (write-auth + rate limit)
 *   Any client       ──GET──▶  /api/control/state?target=<id>
 *   Any client       ──GET──▶  /api/control/capture.png?target=<id>
 *
 * Each display picks a stable `controlId` (localStorage) and subscribes to
 * its own SSE channel. Commands are JSON `{ type, params }` objects produced
 * by server/utils/controlCommands.js. Commands without a `target` fan out to
 * every connected display on this server (fine for a local install); on the
 * hosted site (OHC_HOSTED) a target is mandatory.
 *
 * Authorization (server/utils/controlAuth.js): a targeted command is
 * accepted with the server's API_WRITE_KEY (master key) OR the target
 * display's *pairing secret* — a random string the display generates next
 * to its controlId, registers with its first report/stream (the server keeps
 * a SHA-256 hash) and embeds in the QR code / phone-remote URL. Broadcast
 * commands keep the global rule (API_WRITE_KEY when set, open when unset).
 * Once a display has paired, its stream, reports and frame uploads must
 * present the same secret, so nobody else can listen to or impersonate it.
 *
 * Everything here is in-memory and bounded: at most MAX_DISPLAYS known
 * displays, MAX_QUEUE queued commands per display (dropped after QUEUE_TTL_MS
 * when no display is listening), one PNG frame per display, and the usual
 * per-IP SSE connection cap.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { getClientIP } = require('../utils/helpers');
const {
  COMMAND_TYPES,
  isValidControlId,
  parseControlCommand,
  sanitizeStateReport,
} = require('../utils/controlCommands');
const {
  extractClientToken,
  extractDisplaySecret,
  authorizeControl,
  authorizeDisplay,
} = require('../utils/controlAuth');

module.exports = function (app, ctx) {
  const { logDebug, logInfo, logWarn, writeLimiter, requireWriteAuth, API_WRITE_KEY } = ctx;

  const IS_HOSTED = process.env.OHC_HOSTED === '1' || process.env.OHC_HOSTED === 'true';
  // Hosted: a command must name the display it is for. Overridable for
  // multi-display LAN servers that prefer the fan-out behaviour.
  const REQUIRE_TARGET =
    process.env.CONTROL_REQUIRE_TARGET === undefined ? IS_HOSTED : process.env.CONTROL_REQUIRE_TARGET === 'true';

  const MAX_DISPLAYS = parseInt(process.env.CONTROL_MAX_DISPLAYS || (IS_HOSTED ? '2000' : '50'), 10);
  const MAX_SSE_PER_IP = parseInt(process.env.MAX_SSE_PER_IP || '10', 10);
  const MAX_QUEUE = 20;
  const QUEUE_TTL_MS = 60 * 1000;
  const DISPLAY_TTL_MS = 10 * 60 * 1000; // forget a display 10 min after its last report/stream
  const MAX_FRAME_BYTES = 6 * 1024 * 1024;
  const CAPTURE_WAIT_DEFAULT_MS = 5000;
  const CAPTURE_WAIT_MAX_MS = 15000;

  /**
   * controlId → { secretHash, state, lastReport, lastSeen, clients:Set<res>, queue:[], frame:{buf,ts}|null, frameWaiters:Set<fn> }
   * `secretHash` is the SHA-256 of the display's pairing secret (null until it
   * registers one). The secret itself is never stored or logged.
   */
  const displays = new Map();
  const sseConnectionsByIP = new Map();

  const nowMs = () => Date.now();

  function getDisplay(id, create = false) {
    let d = displays.get(id);
    if (!d && create) {
      if (displays.size >= MAX_DISPLAYS) {
        pruneDisplays(true);
        if (displays.size >= MAX_DISPLAYS) return null;
      }
      d = {
        secretHash: null,
        state: null,
        lastReport: 0,
        lastSeen: nowMs(),
        clients: new Set(),
        queue: [],
        frame: null,
        frameWaiters: new Set(),
      };
      displays.set(id, d);
    }
    if (d) d.lastSeen = nowMs();
    return d;
  }

  function pruneDisplays(aggressive = false) {
    const now = nowMs();
    for (const [id, d] of displays) {
      if (d.clients.size > 0) continue;
      if (aggressive || now - d.lastSeen > DISPLAY_TTL_MS) displays.delete(id);
    }
  }
  const pruneTimer = setInterval(() => pruneDisplays(false), 60 * 1000);
  pruneTimer.unref?.();

  function writeEvent(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === 'function') res.flush();
      return true;
    } catch {
      return false;
    }
  }

  /** Deliver a command to one display (live clients, else queue). → number of live deliveries */
  function deliver(id, d, command) {
    const envelope = {
      id: `${nowMs().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: nowMs(),
      ...command,
    };
    let sent = 0;
    for (const res of d.clients) {
      if (writeEvent(res, 'command', envelope)) sent += 1;
    }
    if (sent === 0) {
      d.queue.push(envelope);
      if (d.queue.length > MAX_QUEUE) d.queue.splice(0, d.queue.length - MAX_QUEUE);
    }
    logDebug?.(`[Control] ${command.type} → ${id} (${sent} live, ${d.queue.length} queued)`);
    return sent;
  }

  function dispatch(target, command) {
    if (target) {
      const d = getDisplay(target, true);
      if (!d) return { ok: false, status: 503, error: 'Too many displays registered' };
      const live = deliver(target, d, command);
      return { ok: true, targets: 1, live, queued: live ? 0 : 1 };
    }
    let live = 0;
    let targets = 0;
    for (const [id, d] of displays) {
      if (d.clients.size === 0) continue;
      targets += 1;
      live += deliver(id, d, command);
    }
    return { ok: true, targets, live, queued: 0 };
  }

  function resolveTarget(req) {
    const raw = req.query.target ?? req.body?.target;
    if (raw === undefined || raw === null || raw === '' || raw === 'all') {
      if (REQUIRE_TARGET) return { error: 'target is required on this server (pass ?target=<controlId>)' };
      return { target: null };
    }
    if (!isValidControlId(String(raw))) return { error: 'target must be an 8–64 char display id' };
    return { target: String(raw) };
  }

  /**
   * Client-side auth (phone, curl): master key OR the target display's
   * pairing secret. Resolves the target first and leaves it on
   * `req.controlTarget` (null = broadcast) with `req.controlAuth` = how it
   * was authorized ('open' | 'master' | 'pairing').
   */
  function requireControlAuth(req, res, next) {
    const t = resolveTarget(req);
    if (t.error) return res.status(400).json({ error: t.error });
    const d = t.target ? displays.get(t.target) : null; // plain get: don't touch lastSeen for an unauthenticated probe
    const verdict = authorizeControl({
      token: extractClientToken(req),
      apiWriteKey: API_WRITE_KEY,
      target: t.target,
      secretHash: d?.secretHash || null,
    });
    if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });
    req.controlTarget = t.target;
    req.controlAuth = verdict.via;
    next();
  }

  /**
   * Display-side auth (stream / report / capture upload): the display's own
   * secret. The first valid secret claims the id; from then on it is required.
   * → the display record, or null after an error response was sent.
   */
  function authenticateDisplay(req, res, target) {
    const d = getDisplay(target, true);
    if (!d) {
      res.status(503).json({ error: 'Too many displays registered' });
      return null;
    }
    const verdict = authorizeDisplay({ secret: extractDisplaySecret(req), secretHash: d.secretHash });
    if (!verdict.ok) {
      res.status(verdict.status).json({ error: verdict.error, paired: !!d.secretHash });
      return null;
    }
    if (verdict.claim) {
      d.secretHash = verdict.claim;
      logDebug?.(`[Control] display ${target} paired`);
    }
    return d;
  }

  // Reports arrive from every open display every 30 s and on each change —
  // a looser limiter than writeLimiter (20/min) but still bounded.
  const reportLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many reports' },
    keyGenerator: getClientIP,
  });

  const noCache = (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  // ── Discovery ─────────────────────────────────────────────────────────
  app.get('/api/control', (req, res) => {
    noCache(res);
    res.json({
      commands: COMMAND_TYPES,
      requireTarget: REQUIRE_TARGET,
      writeKeyRequired: !!API_WRITE_KEY,
      pairing: true, // targeted commands also accept the display's pairing key (QR / Settings → Station)
      displays: displays.size,
      docs: 'https://github.com/accius/openhamclock/blob/main/docs/API.md#remote-control-api',
    });
  });

  // Known displays — local installs only (on the hosted site this would
  // enumerate other people's screens).
  app.get('/api/control/displays', requireWriteAuth, (req, res) => {
    noCache(res);
    if (REQUIRE_TARGET) return res.status(403).json({ error: 'Display listing is disabled on this server' });
    const list = [];
    for (const [id, d] of displays) {
      list.push({
        id,
        connected: d.clients.size > 0,
        lastReport: d.lastReport || null,
        callsign: d.state?.callsign || null,
        layout: d.state?.layout || null,
      });
    }
    res.json({ displays: list });
  });

  // ── Display → server: SSE command stream ──────────────────────────────
  app.get('/api/control/stream', (req, res) => {
    const target = String(req.query.target || '');
    if (!isValidControlId(target)) return res.status(400).json({ error: 'target must be an 8–64 char display id' });

    const ip = getClientIP(req);
    const current = sseConnectionsByIP.get(ip) || 0;
    if (current >= MAX_SSE_PER_IP) {
      return res.status(429).json({ error: 'Too many open SSE connections from this IP' });
    }
    // Once a display has paired, only the holder of its secret may listen.
    const d = authenticateDisplay(req, res, target);
    if (!d) return;
    sseConnectionsByIP.set(ip, current + 1);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
    });
    res.flushHeaders();
    d.clients.add(res);

    // Flush anything queued while nobody was listening (drop stale items).
    const cutoff = nowMs() - QUEUE_TTL_MS;
    const pending = d.queue.filter((c) => c.ts >= cutoff);
    d.queue = [];
    writeEvent(res, 'connected', {
      target,
      pending: pending.length,
      requireTarget: REQUIRE_TARGET,
      paired: !!d.secretHash,
    });
    for (const c of pending) writeEvent(res, 'command', c);

    const keepalive = setInterval(() => {
      try {
        res.write(`: keepalive ${nowMs()}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      } catch {
        clearInterval(keepalive);
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(keepalive);
      d.clients.delete(res);
      d.lastSeen = nowMs();
      const count = sseConnectionsByIP.get(ip) || 1;
      if (count <= 1) sseConnectionsByIP.delete(ip);
      else sseConnectionsByIP.set(ip, count - 1);
    });
  });

  // ── Display → server: state report ────────────────────────────────────
  app.post('/api/control/report', reportLimiter, (req, res) => {
    noCache(res);
    const target = String(req.body?.target || '');
    if (!isValidControlId(target)) return res.status(400).json({ error: 'target must be an 8–64 char display id' });
    const state = sanitizeStateReport(req.body?.state);
    if (!state) return res.status(400).json({ error: 'state must be an object' });
    // `secret` travels beside `state`, never inside it: sanitizeStateReport
    // copies only known fields, so the readback can never leak it.
    const d = authenticateDisplay(req, res, target);
    if (!d) return;
    d.state = state;
    d.lastReport = nowMs();
    res.json({ ok: true, connected: d.clients.size > 0, paired: !!d.secretHash });
  });

  // ── Display → server: screenshot upload ───────────────────────────────
  app.post(
    '/api/control/capture',
    express.raw({ type: ['image/png', 'application/octet-stream'], limit: MAX_FRAME_BYTES }),
    (req, res) => {
      noCache(res);
      const target = String(req.query.target || '');
      if (!isValidControlId(target)) return res.status(400).json({ error: 'target must be an 8–64 char display id' });
      const buf = Buffer.isBuffer(req.body) ? req.body : null;
      // PNG signature check — we hand this back as image/png to anyone with the key.
      if (!buf || buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
        return res.status(400).json({ error: 'body must be a PNG image' });
      }
      const d = authenticateDisplay(req, res, target);
      if (!d) return;
      d.frame = { buf, ts: nowMs() };
      for (const resolve of d.frameWaiters) resolve(d.frame);
      d.frameWaiters.clear();
      res.json({ ok: true, bytes: buf.length });
    },
  );

  // ── Client → server: read state ───────────────────────────────────────
  app.get('/api/control/state', requireControlAuth, (req, res) => {
    noCache(res);
    const target = req.controlTarget;
    if (target) {
      const d = displays.get(target);
      if (!d) return res.status(404).json({ error: 'Unknown display (it has not reported yet)' });
      return res.json({
        target,
        connected: d.clients.size > 0,
        paired: !!d.secretHash,
        auth: req.controlAuth,
        lastReport: d.lastReport || null,
        state: d.state,
      });
    }
    const all = {};
    for (const [id, d] of displays) {
      all[id] = { connected: d.clients.size > 0, lastReport: d.lastReport || null, state: d.state };
    }
    res.json({ displays: all });
  });

  // ── Client → server: screenshot ───────────────────────────────────────
  app.get('/api/control/capture.png', writeLimiter, requireControlAuth, async (req, res) => {
    noCache(res);
    let target = req.controlTarget;
    if (!target) {
      // Local fan-out: pick the first connected display.
      for (const [id, d] of displays) {
        if (d.clients.size > 0) {
          target = id;
          break;
        }
      }
      if (!target) return res.status(404).json({ error: 'No display connected' });
    }
    const d = getDisplay(target, true);
    if (!d) return res.status(503).json({ error: 'Too many displays registered' });

    const wait = Math.min(CAPTURE_WAIT_MAX_MS, Math.max(0, parseInt(req.query.wait, 10) || CAPTURE_WAIT_DEFAULT_MS));
    const requestedAt = nowMs();
    if (d.clients.size > 0 && wait > 0) {
      deliver(target, d, { type: 'capture', params: {} });
      const fresh = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          d.frameWaiters.delete(resolve);
          resolve(null);
        }, wait);
        d.frameWaiters.add((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      });
      if (fresh) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('X-Frame-Timestamp', String(fresh.ts));
        return res.send(fresh.buf);
      }
    }
    if (d.frame) {
      // Stale but better than nothing — say so in a header.
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Frame-Timestamp', String(d.frame.ts));
      res.setHeader('X-Frame-Stale', d.frame.ts < requestedAt ? 'true' : 'false');
      return res.send(d.frame.buf);
    }
    res.status(d.clients.size > 0 ? 504 : 404).json({
      error: d.clients.size > 0 ? 'Display did not deliver a frame in time' : 'Display is not connected',
    });
  });

  // ── Client → server: commands ─────────────────────────────────────────
  app.post('/api/control/:command', writeLimiter, requireControlAuth, async (req, res) => {
    noCache(res);
    const name = String(req.params.command || '').toLowerCase();
    if (['report', 'capture', 'stream', 'state', 'displays'].includes(name)) {
      return res.status(405).json({ error: `Use the dedicated ${name} endpoint` });
    }
    const parsed = parseControlCommand(name, req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const t = { target: req.controlTarget };

    // Rotator commands drive hardware on this server, not a display — a
    // display's pairing key is not enough for that; it takes the master key.
    if (parsed.command.type === 'rotator') {
      if (API_WRITE_KEY && req.controlAuth !== 'master') {
        return res.status(403).json({ error: 'Rotator commands need the server’s API_WRITE_KEY' });
      }
      const rc = ctx.rotatorControl;
      if (!rc) return res.status(503).json({ error: 'Rotator is not configured on this server' });
      try {
        const { az, stop } = parsed.command.params;
        const result = stop ? await rc.stop() : az !== null ? await rc.setAzimuth(az) : { ok: false, reason: 'no az' };
        return res
          .status(result.ok ? 200 : 503)
          .json({ ok: result.ok, ...result, error: result.ok ? null : result.reason });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }

    const out = dispatch(t.target, parsed.command);
    if (!out.ok) return res.status(out.status || 500).json({ error: out.error });
    if (!t.target && out.targets === 0) {
      return res.status(404).json({ ok: false, error: 'No display connected', command: parsed.command });
    }
    res.json({ ok: true, command: parsed.command, targets: out.targets, live: out.live, queued: out.queued });
  });

  logInfo?.(`[Control] Remote-control API ready (requireTarget=${REQUIRE_TARGET}, maxDisplays=${MAX_DISPLAYS})`);
  void logWarn;
};
