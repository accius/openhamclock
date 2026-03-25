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

module.exports = function (app, ctx) {
  const { ROOT_DIR, logInfo, logWarn, requireWriteAuth, RIG_BRIDGE_RELAY_KEY } = ctx;

  let rigBridgeProcess = null;

  const RIG_BRIDGE_DIR = path.join(ROOT_DIR, 'rig-bridge');
  const RIG_BRIDGE_ENTRY = path.join(RIG_BRIDGE_DIR, 'rig-bridge.js');

  // ─── Cloud Relay State Store ──────────────────────────────────────────
  // Per-session relay state and command queues.
  // Session = unique browser tab / user connection.
  const relaySessions = new Map(); // sessionId → { state, commands[], lastPush, lastPoll }
  const MAX_RELAY_SESSIONS = 50;
  const RELAY_SESSION_TTL = 3600000; // 1 hour

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
        lastPush: Date.now(),
        lastPoll: 0,
      });
    }
    return relaySessions.get(sessionId);
  }

  // Cleanup expired sessions periodically
  setInterval(() => {
    const cutoff = Date.now() - RELAY_SESSION_TTL;
    for (const [k, v] of relaySessions) {
      if (v.lastPush < cutoff && v.lastPoll < cutoff) {
        relaySessions.delete(k);
      }
    }
  }, 300000); // Every 5 minutes

  // ─── Relay Auth ───────────────────────────────────────────────────────
  function requireRelayAuth(req, res, next) {
    if (!RIG_BRIDGE_RELAY_KEY) {
      return res.status(503).json({ error: 'Cloud relay not configured — set RIG_BRIDGE_RELAY_KEY in .env' });
    }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token !== RIG_BRIDGE_RELAY_KEY) {
      return res.status(401).json({ error: 'Invalid relay key' });
    }
    next();
  }

  // ─── Cloud Relay: Credentials (browser fetches to configure rig-bridge) ─
  app.get('/api/rig-bridge/relay/credentials', (req, res) => {
    if (!RIG_BRIDGE_RELAY_KEY) {
      return res.status(503).json({ error: 'Cloud relay not configured — set RIG_BRIDGE_RELAY_KEY in .env' });
    }
    // Generate a session ID for this browser tab
    const sessionId = req.query.session || crypto.randomBytes(8).toString('hex');
    res.json({
      relayKey: RIG_BRIDGE_RELAY_KEY,
      session: sessionId,
      serverUrl: `${req.protocol}://${req.get('host')}`,
    });
  });

  // ─── Cloud Relay: State Push (rig-bridge → server) ────────────────────
  app.post('/api/rig-bridge/relay/state', requireRelayAuth, (req, res) => {
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

    res.json({ ok: true });
  });

  // ─── Cloud Relay: State Poll (browser → server) ───────────────────────
  app.get('/api/rig-bridge/relay/state', (req, res) => {
    const sessionId = req.query.session;
    if (!sessionId || !relaySessions.has(sessionId)) {
      return res.json({ connected: false, freq: 0, mode: '', ptt: false, relayActive: false });
    }
    const session = relaySessions.get(sessionId);
    const relayActive = Date.now() - session.lastPush < 15000; // Consider active if pushed in last 15s
    res.json({ ...session.state, relayActive });
  });

  // ─── Cloud Relay: Command Push (browser → server, for rig-bridge to pick up) ─
  app.post('/api/rig-bridge/relay/command', (req, res) => {
    const sessionId = req.query.session || req.body.session;
    if (!sessionId || !relaySessions.has(sessionId)) {
      return res.status(404).json({ error: 'No active relay session' });
    }
    const { type, payload } = req.body;
    if (!type) return res.status(400).json({ error: 'Missing command type' });

    const session = relaySessions.get(sessionId);
    session.commands.push({ type, payload, timestamp: Date.now() });

    // Cap command queue
    if (session.commands.length > 50) {
      session.commands = session.commands.slice(-50);
    }

    res.json({ ok: true, queued: session.commands.length });
  });

  // ─── Cloud Relay: Command Poll (rig-bridge → server) ──────────────────
  app.get('/api/rig-bridge/relay/commands', requireRelayAuth, (req, res) => {
    const sessionId = req.query.session;
    if (!sessionId || !relaySessions.has(sessionId)) {
      return res.json({ commands: [] });
    }
    const session = relaySessions.get(sessionId);
    const commands = [...session.commands];
    session.commands = []; // Drain the queue
    session.lastPoll = Date.now();
    res.json({ commands });
  });

  // ─── Cloud Relay: Configure ─────────────────────────────────────────
  // Returns credentials for the browser to push directly to the user's
  // local rig-bridge. The server can't reach localhost:5555 when cloud-hosted,
  // but the browser CAN because it's on the user's machine.
  app.post('/api/rig-bridge/relay/configure', (req, res) => {
    if (!RIG_BRIDGE_RELAY_KEY) {
      return res.status(503).json({ error: 'Cloud relay not configured — set RIG_BRIDGE_RELAY_KEY in .env' });
    }

    const sessionId = crypto.randomBytes(8).toString('hex');
    const serverUrl = `${req.protocol}://${req.get('host')}`;

    // Return the config payload — the browser will push it to the local rig-bridge
    res.json({
      ok: true,
      session: sessionId,
      serverUrl,
      relayKey: RIG_BRIDGE_RELAY_KEY,
      // The browser should POST this to rigBridgeUrl/api/config:
      configPayload: {
        cloudRelay: {
          enabled: true,
          url: serverUrl,
          apiKey: RIG_BRIDGE_RELAY_KEY,
          session: sessionId,
        },
      },
    });
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
        'echo   Cloning rig-bridge...',
        'if not exist "%RIG_DIR%\\rig-bridge.js" (',
        '    git clone --depth 1 --filter=blob:none --sparse https://github.com/accius/openhamclock.git "%RIG_DIR%\\repo" 2>nul',
        '    if exist "%RIG_DIR%\\repo" (',
        '        cd /d "%RIG_DIR%\\repo"',
        '        git sparse-checkout set rig-bridge',
        '        xcopy /E /Y /I "%RIG_DIR%\\repo\\rig-bridge" "%RIG_DIR%"',
        '        cd /d "%RIG_DIR%"',
        '        rmdir /S /Q repo',
        '    ) else (',
        '        echo   Git clone failed. Make sure git is installed.',
        '        pause',
        '        exit /b 1',
        '    )',
        ')',
        '',
        'cd /d "%RIG_DIR%"',
        'echo   Installing dependencies...',
        'call npm install --omit=dev',
        '',
        'echo.',
        'echo   Starting Rig Bridge...',
        'echo   Setup UI: http://localhost:5555',
        'echo.',
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
      '#!/bin/bash',
      '# OpenHamClock Rig Bridge — Installer',
      'set -e',
      '',
      'RIG_DIR="$HOME/openhamclock-rig-bridge"',
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
      'echo "Downloading rig-bridge..."',
      'if [ ! -f "$RIG_DIR/rig-bridge.js" ]; then',
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
      'echo "Starting Rig Bridge..."',
      'echo "Setup UI: http://localhost:5555"',
      'echo ""',
      'node rig-bridge.js',
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

  app.get('/api/rig-bridge/status', async (req, res) => {
    const host = req.query.host || 'http://localhost';
    const port = req.query.port || '5555';
    const url = `${host}:${port}/health`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await ctx.fetch(url, { signal: controller.signal });
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
