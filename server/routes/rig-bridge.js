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
const crypto = require('crypto');
const { validateCustomHost } = require('../utils/ssrf');

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
  const relayPollCountByIP = new Map(); // ip → count

  // Issued relay tokens — sessionId → random token returned by relay/configure or relay/credentials.
  // Simple server-side lookup avoids any dependency on RIG_BRIDGE_RELAY_KEY being stable across
  // restarts or deployments (the HMAC approach broke when the key changed between issue and verify).
  // Tokens are persisted to RELAY_TOKENS_FILE so they survive server restarts.
  const relayIssuedTokens = new Map(); // sessionId → token
  try {
    const raw = fs.readFileSync(RELAY_TOKENS_FILE, 'utf8');
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj)) relayIssuedTokens.set(k, v);
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
  }, 300000); // Every 5 minutes

  // ─── Relay Auth ───────────────────────────────────────────────────────
  function requireRelayAuth(req, res, next) {
    if (!RIG_BRIDGE_RELAY_KEY) {
      return res.status(503).json({ error: 'Cloud relay not configured — set RIG_BRIDGE_RELAY_KEY in .env' });
    }
    const sessionId = req.headers['x-relay-session'] || req.query.session || req.body?.session;
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const issuedToken = sessionId ? relayIssuedTokens.get(sessionId) : undefined;
    if (!sessionId || !token || !issuedToken || token !== issuedToken) {
      logWarn(
        `[RigBridge] relay auth failed — sessionId: ${sessionId ? sessionId.slice(0, 8) + '…' : '(none)'}, ` +
          `token ${token ? 'present' : 'missing'}, issued token ${issuedToken ? 'found' : 'not found in store'}`,
      );
      return res.status(401).json({
        error:
          'Invalid relay credentials — re-run Connect Cloud Relay in OHC Settings → Rig Bridge to generate fresh credentials',
      });
    }
    next();
  }

  // ─── Cloud Relay: Credentials (browser fetches to configure rig-bridge) ─
  app.get('/api/rig-bridge/relay/credentials', (req, res) => {
    try {
      if (!RIG_BRIDGE_RELAY_KEY) {
        return res.json({ error: 'Cloud relay not configured', configured: false });
      }
      const sessionId = req.query.session || crypto.randomBytes(8).toString('hex');
      const token = crypto.randomBytes(32).toString('hex');
      relayIssuedTokens.set(sessionId, token);
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
      const sessionId = req.headers['x-relay-session'] || req.body.session;
      if (!sessionId) return res.status(400).json({ error: 'Missing session ID' });

      const session = getRelaySession(sessionId);
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
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ packets: req.body.aprsPackets }),
            })
            .catch(() => {});
        } catch (e) {}
      }

      res.json({ ok: true });
    } catch (err) {
      logWarn(`[RigBridge] relay/state push error: ${err.message}`);
      if (!res.headersSent) res.json({ ok: false, error: 'Internal error' });
    }
  });

  // ─── Cloud Relay: State Poll (browser → server) ───────────────────────
  app.get('/api/rig-bridge/relay/state', (req, res) => {
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
  app.get('/api/rig-bridge/relay/stream', (req, res) => {
    try {
      const sessionId = req.query.session;
      if (!sessionId) {
        return res.json({ error: 'Missing session ID', relayActive: false });
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
  app.get('/api/rig-bridge/relay/decodes', (req, res) => {
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
  app.get('/api/rig-bridge/relay/aprs', (req, res) => {
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
      const { type, payload } = req.body;
      if (!type) return res.status(400).json({ error: 'Missing command type' });

      const session = relaySessions.get(sessionId);
      session.commands.push({ type, payload, timestamp: Date.now() });

      if (session.commands.length > 50) {
        session.commands = session.commands.slice(-50);
      }

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
      const sessionId = req.query.session;
      if (!sessionId || !relaySessions.has(sessionId)) {
        return res.json({ commands: [] });
      }
      const session = relaySessions.get(sessionId);

      // Commands already queued — return immediately (no hold needed)
      if (session.commands.length > 0) {
        const commands = [...session.commands];
        session.commands = [];
        session.lastPoll = Date.now();
        return res.json({ commands });
      }

      // Long-poll: hold until a command arrives or timeout fires.
      // Cap at 30 s to stay within typical proxy/load-balancer idle timeouts.
      const waitMs = Math.min(parseInt(req.query.wait) || 0, 30000);
      if (!waitMs) {
        return res.json({ commands: [] });
      }

      const clientIP = req.ip || req.socket?.remoteAddress || 'unknown';
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

  // ─── Cloud Relay: Configure ─────────────────────────────────────────
  app.post('/api/rig-bridge/relay/configure', (req, res) => {
    try {
      if (!RIG_BRIDGE_RELAY_KEY) {
        return res.json({ ok: false, error: 'Cloud relay not configured — set RIG_BRIDGE_RELAY_KEY in .env' });
      }
      const sessionId = crypto.randomBytes(8).toString('hex');
      const serverUrl = `${req.protocol}://${req.get('host')}`;
      const token = crypto.randomBytes(32).toString('hex');
      relayIssuedTokens.set(sessionId, token);
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
