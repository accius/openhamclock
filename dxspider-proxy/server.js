/**
 * DX Spider Telnet Proxy Service
 *
 * A microservice that maintains a persistent telnet connection to DX Spider,
 * accumulates spots, and serves them via HTTP API.
 *
 * Designed to run on Railway as a standalone service.
 */

const net = require('net');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
  // DX Spider nodes to try (in order).
  // NOTE: dxc.nc7j.com (and the NG7M cluster) were removed at the sysop's
  // request — those run ArcConnect, which rejects SSID logins and treats the
  // proxy's reconnects as abuse. Do NOT re-add them. See dxClusterLoginCallsign
  // notes below and the good-neighbour policy.
  nodes: [
    { host: 'dxspider.co.uk', port: 7300, name: 'DX Spider UK (G6NHU)' },
    { host: 'dxc.ai9t.com', port: 7373, name: 'AI9T' },
  ],
  // Login callsign for the shared proxy. MUST be a real, valid amateur
  // callsign — DX cluster nodes reject anything else (the old default,
  // 'OPENHAMCLOCK-56', is not a valid callsign and was getting us flagged).
  // Override per-environment with the CALLSIGN env var.
  callsign: process.env.CALLSIGN?.trim() || 'K0CJH',
  spotRetentionMs: 30 * 60 * 1000, // 30 minutes
  reconnectDelayMs: 10000, // 10 seconds base; backs off exponentially on repeated failure
  maxReconnectDelayMs: 5 * 60 * 1000, // 5 minutes — cap so we never hammer a node
  maxReconnectAttempts: 3,
  cleanupIntervalMs: 60000, // 1 minute
  keepAliveIntervalMs: 60000, // 1 minute - send keepalive (must stay < socketTimeoutMs)
  activityTimeoutMs: 180000, // 3 minutes - if no spots, assume dead and failover
  authTimeoutMs: 30000, // 30 seconds - if no prompt after login, try next node
  // Last-resort TCP backstop. Must be LONGER than activityTimeoutMs so the
  // graceful node-failover watchdog acts first. A 60s value here used to
  // preempt it and tear down healthy connections during quiet-band gaps.
  socketTimeoutMs: 300000, // 5 minutes
};

// Validate an amateur callsign (optionally with an SSID like -56).
// Deliberately permissive about real callsign shapes, but rejects junk such as
// 'OPENHAMCLOCK-56' so we never present an invalid login to a cluster node.
const isValidCallsign = (call) =>
  typeof call === 'string' && /^[A-Z0-9]{1,3}\d[A-Z]{1,4}(-\d{1,2})?$/i.test(call.trim());

// ============================================
// REMOTE KILL SWITCH
// ============================================
// Old deployments of this proxy hammered NC7J for months with no way to reach
// them. Every deployment from now on consults cluster-status.json in the repo
// before/while dialing: flipping `enabled` to false, or raising
// `minProxyVersion` above a misbehaving release, stops the fleet from dialing
// within one refresh interval. FAIL OPEN — an unreachable flag never disables
// anything; only an explicitly fetched "no" does.
const PROXY_VERSION = require('./package.json').version;
const CLUSTER_STATUS_URL =
  process.env.CLUSTER_STATUS_URL || 'https://raw.githubusercontent.com/accius/openhamclock/Staging/cluster-status.json';
const CLUSTER_STATUS_REFRESH_MS = 15 * 60 * 1000;

let remoteDialingBlocked = false;
let remoteBlockReason = '';

const compareVersions = (a, b) => {
  const pa = String(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
};

async function refreshClusterStatus() {
  if (typeof fetch !== 'function') return; // Node <18 — kill switch inert, fail open
  let data;
  try {
    const res = await fetch(CLUSTER_STATUS_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return; // fail open: keep last known state
  }
  if (!data || typeof data !== 'object') return;

  let blocked = false;
  let reason = '';
  if (data.enabled === false) {
    blocked = true;
    reason = data.message || 'cluster connections disabled remotely (cluster-status.json)';
  } else if (typeof data.minProxyVersion === 'string' && compareVersions(PROXY_VERSION, data.minProxyVersion) < 0) {
    blocked = true;
    reason = `proxy version ${PROXY_VERSION} is below the remote minimum ${data.minProxyVersion} — please update${data.message ? ` (${data.message})` : ''}`;
  }

  if (blocked && !remoteDialingBlocked) {
    remoteDialingBlocked = true;
    remoteBlockReason = reason;
    log('KILLSWITCH', `Remote kill switch ACTIVE — ${reason}. Disconnecting and holding.`);
    // Tear down without scheduling a reconnect; the refresh loop re-dials on re-enable.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    if (activityWatchdog) {
      clearTimeout(activityWatchdog);
      activityWatchdog = null;
    }
    if (client) {
      try {
        client.removeAllListeners();
        client.destroy();
      } catch (e) {}
      client = null;
    }
    connected = false;
    connecting = false;
    authenticated = false;
  } else if (!blocked && remoteDialingBlocked) {
    remoteDialingBlocked = false;
    remoteBlockReason = '';
    log('KILLSWITCH', 'Remote kill switch cleared — resuming cluster connection');
    connect();
  }
}

// ============================================
// CLIENT TRACKING & STALE-VERSION NUDGE
// ============================================
// Every HTTP client is identified by IP + User-Agent. OpenHamClock installs
// report OpenHamClock/<version> — releases before the good-neighbour fixes
// hardcoded 3.13.1/3.14.11, so any parseable version below the threshold is a
// stale install. Stale clients get their spot responses prefixed with a
// synthetic "please update" spot that renders right in their DX panel, and
// /api/clients lists everyone we've seen so stale installs can be counted and
// cross-referenced against sysop abuse reports.
const OHC_UA_RE = /^OpenHamClock\/(\d+(?:\.\d+)*)/i;
const NUDGE_MIN_APP_VERSION = '26.5.1';
const CLIENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLIENTS_MAX = 2000;
const clientsSeen = new Map(); // "ip ua" -> { ip, ua, version, stale, firstSeen, lastSeen, requests }

const getClientIP = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

app.use((req, res, next) => {
  const ip = getClientIP(req);
  const ua = String(req.headers['user-agent'] || '').substring(0, 120);
  const m = ua.match(OHC_UA_RE);
  const version = m ? m[1] : null;
  const stale = Boolean(version && compareVersions(version, NUDGE_MIN_APP_VERSION) < 0);

  const key = `${ip} ${ua}`;
  let entry = clientsSeen.get(key);
  if (!entry) {
    entry = { ip, ua, version, stale, firstSeen: Date.now(), lastSeen: Date.now(), requests: 0 };
    clientsSeen.set(key, entry);
    log('CLIENT', `New client ${ip} "${ua || '(no UA)'}"${stale ? ' — STALE OpenHamClock, will nudge' : ''}`);
    // Cap: drop the oldest entries rather than growing unbounded
    if (clientsSeen.size > CLIENTS_MAX) {
      const oldest = [...clientsSeen.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest) clientsSeen.delete(oldest[0]);
    }
  }
  entry.lastSeen = Date.now();
  entry.requests++;
  req.ohcClient = entry;
  next();
});

setInterval(
  () => {
    const cutoff = Date.now() - CLIENT_RETENTION_MS;
    for (const [key, entry] of clientsSeen) {
      if (entry.lastSeen < cutoff) clientsSeen.delete(key);
    }
  },
  60 * 60 * 1000,
).unref();

// Synthetic spot shown only to stale OpenHamClock installs — renders in their
// DX cluster panel, which is the one channel that reaches exactly those users.
function makeNudgeSpot() {
  const now = new Date();
  const time = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}z`;
  return {
    spotter: 'OHC',
    spotterGrid: null,
    freq: '14.313',
    freqKhz: 14313,
    call: 'UPDATE-OHC',
    dxGrid: null,
    comment: 'This OpenHamClock version misbehaves on cluster nodes - PLEASE UPDATE: openhamclock.com',
    time,
    mode: null,
    timestamp: Date.now(),
    source: 'DX Spider Proxy',
  };
}

// Phrases a node sends when it refuses our login. If we see any of these we
// must stop talking to that node immediately — never blindly fire follow-up
// commands (sh/dx, set/dx), which the node would read as more bad logins.
const LOGIN_REJECTION_RE =
  /(invalid|unknown|not a valid|incorrect|illegal|bad)\s+call|please enter.*call|login incorrect/i;

// State
let spots = [];
let client = null;
let connected = false;
let connecting = false; // Prevent concurrent connection attempts
let authenticated = false; // Track whether login completed
let loginRejected = false; // Node refused our callsign — stop sending commands
let currentNode = null;
let currentNodeIndex = 0;
let reconnectAttempts = 0;
let lastSpotTime = null;
let lastDataTime = null; // Track ANY data received from node
let totalSpotsReceived = 0;
let connectionStartTime = null;
let buffer = '';
let reconnectTimer = null;
let keepAliveTimer = null;
let activityWatchdog = null; // Fires if no spots arrive within threshold

// Logging helper with log levels
// LOG_LEVEL: 'debug' = verbose, 'info' = normal, 'warn' = warnings+errors only
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info;

// Map log categories to levels
const CATEGORY_LEVELS = {
  SPOT: 'debug', // Per-spot logging is debug-only
  CLEANUP: 'debug', // Periodic cleanup is debug-only
  KEEPALIVE: 'debug', // Keepalive pings are debug-only
  DATA: 'debug', // Non-spot telnet data is debug-only
  CMD: 'debug', // Command logging is debug-only
  AUTH: 'info', // Auth events are informational
  CONNECT: 'info', // Connection events are informational
  CLOSE: 'info',
  RECONNECT: 'info',
  FAILOVER: 'info',
  ACTIVITY: 'info',
  API: 'info',
  START: 'info',
  CONFIG: 'info',
  SHUTDOWN: 'info',
  ERROR: 'warn',
  TIMEOUT: 'warn',
};

const log = (level, message, data = null) => {
  const categoryLevel = LOG_LEVELS[CATEGORY_LEVELS[level] || 'info'] ?? LOG_LEVELS.info;
  if (categoryLevel < currentLogLevel) return;

  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}`;
  if (data) {
    console.log(logLine, typeof data === 'object' ? JSON.stringify(data) : data);
  } else {
    console.log(logLine);
  }
};

// Parse a DX spot line from telnet
// Format: DX de SPOTTER: FREQ DXCALL comment time
const parseSpotLine = (line) => {
  try {
    // Match: DX de W3ABC:     14025.0  JA1XYZ       CW 599           1234Z
    const match = line.match(/^DX de\s+([A-Z0-9/]+):\s+(\d+\.?\d*)\s+([A-Z0-9/]+)\s+(.*)$/i);

    if (!match) return null;

    const spotter = match[1].toUpperCase();
    const freqKhz = parseFloat(match[2]);
    const dxCall = match[3].toUpperCase();
    let comment = match[4].trim();

    // Extract time from end of comment (format: 1234Z or 1234z)
    let time = '';
    const timeMatch = comment.match(/(\d{4})[Zz]\s*$/);
    if (timeMatch) {
      time = timeMatch[1].substring(0, 2) + ':' + timeMatch[1].substring(2, 4) + 'z';
      comment = comment.replace(/\d{4}[Zz]\s*$/, '').trim();
    } else {
      // Use current UTC time
      const now = new Date();
      time = String(now.getUTCHours()).padStart(2, '0') + ':' + String(now.getUTCMinutes()).padStart(2, '0') + 'z';
    }

    // Detect mode from comment
    let mode = null;
    const upperComment = comment.toUpperCase();
    if (upperComment.includes('FT8')) mode = 'FT8';
    else if (upperComment.includes('FT4')) mode = 'FT4';
    else if (upperComment.includes('CW')) mode = 'CW';
    else if (upperComment.includes('SSB') || upperComment.includes('USB') || upperComment.includes('LSB')) mode = 'SSB';
    else if (upperComment.includes('RTTY')) mode = 'RTTY';
    else if (upperComment.includes('PSK')) mode = 'PSK';
    else if (upperComment.includes('FM')) mode = 'FM';
    else if (upperComment.includes('AM')) mode = 'AM';

    // Extract grid squares from comment
    // Pattern: Look for 4 or 6 char grids, possibly in format "GRID1<>GRID2" or "GRID1->GRID2"
    let spotterGrid = null;
    let dxGrid = null;

    // Check for dual grid format: FN20<>EM79 or FN20->EM79 or FN20/EM79
    const dualGridMatch = comment.match(
      /\b([A-R]{2}[0-9]{2}(?:[A-X]{2})?)\s*(?:<>|->|\/|<)\s*([A-R]{2}[0-9]{2}(?:[A-X]{2})?)\b/i,
    );
    if (dualGridMatch) {
      spotterGrid = dualGridMatch[1].toUpperCase();
      dxGrid = dualGridMatch[2].toUpperCase();
    } else {
      // Look for single grid - assume it's the DX station
      const singleGridMatch = comment.match(/\b([A-R]{2}[0-9]{2}(?:[A-X]{2})?)\b/i);
      if (singleGridMatch) {
        const grid = singleGridMatch[1].toUpperCase();
        // Validate it's a real grid (not something like "CQ00")
        const firstChar = grid.charCodeAt(0);
        const secondChar = grid.charCodeAt(1);
        if (firstChar >= 65 && firstChar <= 82 && secondChar >= 65 && secondChar <= 82) {
          dxGrid = grid;
        }
      }
    }

    return {
      spotter,
      spotterGrid,
      freq: (freqKhz / 1000).toFixed(3), // Convert kHz to MHz string
      freqKhz,
      call: dxCall,
      dxGrid,
      comment,
      time,
      mode,
      timestamp: Date.now(),
      source: 'DX Spider',
    };
  } catch (err) {
    log('ERROR', 'Failed to parse spot line', { line, error: err.message });
    return null;
  }
};

// Add a spot to the accumulator
const addSpot = (spot) => {
  if (!spot) return;

  // Check for duplicate (same call + freq within 2 minutes)
  const isDuplicate = spots.some(
    (existing) =>
      existing.call === spot.call && existing.freq === spot.freq && spot.timestamp - existing.timestamp < 120000,
  );

  if (!isDuplicate) {
    spots.unshift(spot); // Add to beginning (newest first)
    totalSpotsReceived++;
    lastSpotTime = new Date();
    log('SPOT', `${spot.call} on ${spot.freq} MHz by ${spot.spotter}`);
  }
};

// Clean up old spots
const cleanupSpots = () => {
  const cutoff = Date.now() - CONFIG.spotRetentionMs;
  const before = spots.length;
  spots = spots.filter((s) => s.timestamp > cutoff);
  const removed = before - spots.length;
  if (removed > 0) {
    log('CLEANUP', `Removed ${removed} expired spots, ${spots.length} remaining`);
  }
};

// Connect to DX Spider
const connect = () => {
  // Remote kill switch: no dialing while blocked. The status refresh loop
  // calls connect() again when the flag clears.
  if (remoteDialingBlocked) {
    log('KILLSWITCH', `Not dialing — ${remoteBlockReason}`);
    return;
  }

  // Prevent concurrent connection attempts
  if (connecting) {
    log('CONNECT', 'Connection attempt already in progress, skipping');
    return;
  }

  connecting = true;

  // Clear any pending reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Clean up existing client without triggering reconnect
  if (client) {
    try {
      client.removeAllListeners(); // Remove listeners BEFORE destroy to prevent close->reconnect loop
      client.destroy();
    } catch (e) {}
    client = null;
  }

  // Clear any stale watchdog from previous connection
  if (activityWatchdog) {
    clearTimeout(activityWatchdog);
    activityWatchdog = null;
  }

  const node = CONFIG.nodes[currentNodeIndex];
  currentNode = node;

  log('CONNECT', `Attempting connection to ${node.name} (${node.host}:${node.port})`);

  client = new net.Socket();
  client.setTimeout(CONFIG.socketTimeoutMs);

  client.connect(node.port, node.host, () => {
    connected = true;
    connecting = false;
    authenticated = false;
    loginRejected = false;
    connectionStartTime = new Date();
    lastDataTime = Date.now();
    buffer = '';
    // NOTE: reconnectAttempts is NOT reset here — only when spots actually arrive.
    // This prevents infinite loops on nodes that accept TCP but kick after auth.
    log('CONNECT', `Connected to ${node.name}`);

    // Send login after short delay
    setTimeout(() => {
      if (client && connected) {
        client.write(CONFIG.callsign + '\r\n');
        log('AUTH', `Sent callsign: ${CONFIG.callsign}`);

        // After login, enable DX spot announcements.
        // Guard every follow-up command on !loginRejected: if the node already
        // refused our callsign, sending sh/dx here is exactly what the sysop
        // complained about (the node reads it as another bad login attempt).
        setTimeout(() => {
          if (client && connected && !loginRejected) {
            // Request recent spots first
            client.write('sh/dx 30\r\n');
            log('CMD', 'Sent: sh/dx 30');

            // Then enable the spot stream (some nodes need this)
            setTimeout(() => {
              if (client && connected && !loginRejected) {
                client.write('set/dx\r\n');
                log('CMD', 'Sent: set/dx (enable spot stream)');

                // Start the activity watchdog now that commands are sent
                // If no spots arrive within activityTimeoutMs, we'll failover
                resetActivityWatchdog();
              }
            }, 2000);
          }
        }, 2000);

        // Auth timeout: if node doesn't respond with a prompt, log a warning
        setTimeout(() => {
          if (connected && !authenticated) {
            log('AUTH', `No auth confirmation within ${CONFIG.authTimeoutMs / 1000}s — node may be unresponsive`);
          }
        }, CONFIG.authTimeoutMs);
      }
    }, 1000);

    // Start keepalive
    startKeepAlive();
  });

  client.on('data', (data) => {
    buffer += data.toString();
    lastDataTime = Date.now();

    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check if it's a DX spot
      if (trimmed.startsWith('DX de ')) {
        const spot = parseSpotLine(trimmed);
        if (spot) {
          addSpot(spot);
          resetActivityWatchdog(); // Got a spot, connection is healthy
          // A flowing spot is definitive proof login succeeded. The DXSpider
          // prompt has no trailing newline so it never arrives as a complete
          // line — prompt-based detection alone is unreliable.
          if (!authenticated) {
            authenticated = true;
            log('AUTH', 'Login confirmed (spot stream active)');
          }
          // Only reset failover counter if connection has been stable for 60s+
          // A few spots before a timeout isn't truly healthy — it traps us
          // on a flaky node that connects briefly then drops
          const uptime = connectionStartTime ? Date.now() - connectionStartTime.getTime() : 0;
          if (reconnectAttempts > 0 && uptime > 60000) {
            log(
              'CONNECT',
              `Connection stable (${Math.round(uptime / 1000)}s uptime, spots flowing), resetting failover counter`,
            );
            reconnectAttempts = 0;
          }
        }
        continue;
      }

      // Detect the node refusing our login. Stop immediately: don't send any
      // further commands, tear the socket down, and let handleDisconnect apply
      // its backoff. Re-hammering a node that rejects us is what got the proxy
      // flagged by cluster sysops.
      if (!authenticated && !loginRejected && LOGIN_REJECTION_RE.test(trimmed)) {
        loginRejected = true;
        log('ERROR', `Login rejected by ${currentNode?.name}: ${trimmed.substring(0, 120)}`);
        if (client) {
          try {
            client.removeAllListeners();
            client.destroy();
          } catch (e) {}
          client = null;
        }
        handleDisconnect();
        return;
      }

      // Detect auth completion - DX Spider sends "callsign de NODE >" prompt.
      // Exclude lines containing '<' — sh/dx output (e.g. "...de Helmut<DF4IY>")
      // otherwise false-matches this pattern.
      if (!authenticated && !trimmed.includes('<') && /\sde\s+\S+\s*>/.test(trimmed)) {
        authenticated = true;
        log('AUTH', `Login confirmed: ${trimmed.substring(0, 80)}`);
        resetActivityWatchdog(); // Auth done, start watching for spots
        continue;
      }

      // Log non-spot data so we can diagnose issues (debug level)
      log('DATA', trimmed.substring(0, 120));
    }
  });

  client.on('timeout', () => {
    log('TIMEOUT', 'Connection timed out');
    connecting = false;
    // Node does NOT auto-close a socket on timeout. Without this teardown the
    // old socket keeps emitting 'data' until the next connect(), spuriously
    // logging "Connection stable" and resetting the failover counter.
    if (client) {
      try {
        client.removeAllListeners();
        client.destroy();
      } catch (e) {}
      client = null;
    }
    handleDisconnect();
  });

  client.on('error', (err) => {
    log('ERROR', `Connection error: ${err.message}`);
    connecting = false;
    handleDisconnect();
  });

  client.on('close', () => {
    if (connected) {
      log('CLOSE', 'Connection closed');
    }
    connecting = false;
    handleDisconnect();
  });
};

// Reset the activity watchdog - called when spots arrive
const resetActivityWatchdog = () => {
  if (activityWatchdog) {
    clearTimeout(activityWatchdog);
  }

  activityWatchdog = setTimeout(() => {
    if (connected) {
      log('ACTIVITY', `No spots received in ${CONFIG.activityTimeoutMs / 1000}s — forcing failover`);
      // Skip straight to next node instead of retrying the same one
      currentNodeIndex = (currentNodeIndex + 1) % CONFIG.nodes.length;
      reconnectAttempts = 0;
      log('FAILOVER', `Switching to node: ${CONFIG.nodes[currentNodeIndex].name}`);

      // Force disconnect and reconnect
      if (client) {
        try {
          client.removeAllListeners();
          client.destroy();
        } catch (e) {}
        client = null;
      }
      connected = false;
      connecting = false;
      authenticated = false;

      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }

      // Clear any pending reconnect and connect immediately
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      connect();
    }
  }, CONFIG.activityTimeoutMs);
};

// Start keepalive timer
const startKeepAlive = () => {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }

  keepAliveTimer = setInterval(() => {
    if (client && connected) {
      try {
        // Send a harmless command to keep connection alive
        client.write('\r\n');
        log('KEEPALIVE', 'Sent keepalive');
      } catch (e) {
        log('ERROR', 'Keepalive failed', e.message);
      }
    }
  }, CONFIG.keepAliveIntervalMs);
};

// Handle disconnection and reconnection
const handleDisconnect = () => {
  // Prevent re-entrant calls
  if (!connected && !connecting && reconnectTimer) {
    return; // Already disconnected and reconnect scheduled
  }

  connected = false;
  connecting = false;
  authenticated = false;

  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  if (activityWatchdog) {
    clearTimeout(activityWatchdog);
    activityWatchdog = null;
  }

  // Don't schedule another reconnect if one is already pending
  if (reconnectTimer) {
    return;
  }

  // Detect rapid disconnect (kicked within seconds of connecting)
  const connectionDuration = connectionStartTime ? Date.now() - connectionStartTime.getTime() : 0;
  if (connectionDuration > 0 && connectionDuration < 15000) {
    log(
      'RECONNECT',
      `Rapid disconnect from ${currentNode?.name} after ${Math.round(connectionDuration / 1000)}s (likely auth rejection or SSID conflict)`,
    );
  }

  reconnectAttempts++;

  if (reconnectAttempts >= CONFIG.maxReconnectAttempts) {
    // Try next node
    currentNodeIndex = (currentNodeIndex + 1) % CONFIG.nodes.length;
    reconnectAttempts = 0;
    log(
      'FAILOVER',
      `${CONFIG.maxReconnectAttempts} consecutive failures — switching to node: ${CONFIG.nodes[currentNodeIndex].name}`,
    );
  }

  // Exponential backoff: base * 2^(attempts-1), capped. Prevents the old
  // fixed-10s loop from hammering a node that keeps refusing or dropping us.
  const backoffDelay = Math.min(
    CONFIG.reconnectDelayMs * 2 ** Math.max(0, reconnectAttempts - 1),
    CONFIG.maxReconnectDelayMs,
  );

  log('RECONNECT', `Attempting reconnect in ${backoffDelay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoffDelay);
};

// ============================================
// HTTP API ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: PROXY_VERSION,
    killSwitch: remoteDialingBlocked ? remoteBlockReason : 'inactive',
    connected,
    authenticated,
    currentNode: currentNode?.name || 'none',
    spotsInMemory: spots.length,
    totalSpotsReceived,
    lastSpotTime: lastSpotTime?.toISOString() || null,
    lastDataTime: lastDataTime ? new Date(lastDataTime).toISOString() : null,
    connectionUptime: connectionStartTime
      ? Math.floor((Date.now() - connectionStartTime.getTime()) / 1000) + 's'
      : null,
    uptime: process.uptime() + 's',
  });
});

// Get spots
app.get('/api/spots', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const since = parseInt(req.query.since) || 0; // Timestamp filter

  let filteredSpots = spots;

  // Filter by timestamp if provided
  if (since > 0) {
    filteredSpots = spots.filter((s) => s.timestamp > since);
  }

  const out = filteredSpots.slice(0, limit);
  if (req.ohcClient?.stale) out.unshift(makeNudgeSpot());

  res.json({
    spots: out,
    total: filteredSpots.length,
    connected,
    source: currentNode?.name || 'disconnected',
    timestamp: Date.now(),
  });
});

// Get spots in simple format (for compatibility with existing DX cluster endpoint)
app.get('/api/dxcluster/spots', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);

  const formattedSpots = spots.slice(0, limit).map((s) => ({
    spotter: s.spotter,
    freq: s.freq,
    call: s.call,
    comment: s.comment,
    time: s.time,
    mode: s.mode,
    source: 'DX Spider Proxy',
  }));

  if (req.ohcClient?.stale) {
    const n = makeNudgeSpot();
    formattedSpots.unshift({
      spotter: n.spotter,
      freq: n.freq,
      call: n.call,
      comment: n.comment,
      time: n.time,
      mode: n.mode,
      source: 'DX Spider Proxy',
    });
  }

  res.json(formattedSpots);
});

// Who has been polling this proxy? Surfaces stale OpenHamClock installs so we
// can count them and cross-reference IPs against cluster-sysop abuse reports.
app.get('/api/clients', (req, res) => {
  const list = [...clientsSeen.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  res.json({
    total: list.length,
    staleCount: list.filter((c) => c.stale).length,
    nudgeMinAppVersion: NUDGE_MIN_APP_VERSION,
    clients: list.slice(0, 500).map((c) => ({
      ...c,
      firstSeen: new Date(c.firstSeen).toISOString(),
      lastSeen: new Date(c.lastSeen).toISOString(),
    })),
  });
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  // Calculate spots per band
  const bandCounts = {};
  let spotsWithDxGrid = 0;
  let spotsWithSpotterGrid = 0;

  spots.forEach((s) => {
    if (s.dxGrid) spotsWithDxGrid++;
    if (s.spotterGrid) spotsWithSpotterGrid++;

    const freq = s.freqKhz;
    let band = 'other';
    if (freq >= 1800 && freq <= 2000) band = '160m';
    else if (freq >= 3500 && freq <= 4000) band = '80m';
    else if (freq >= 7000 && freq <= 7300) band = '40m';
    else if (freq >= 10100 && freq <= 10150) band = '30m';
    else if (freq >= 14000 && freq <= 14350) band = '20m';
    else if (freq >= 18068 && freq <= 18168) band = '17m';
    else if (freq >= 21000 && freq <= 21450) band = '15m';
    else if (freq >= 24890 && freq <= 24990) band = '12m';
    else if (freq >= 26500 && freq <= 27500)
      band = '11m'; // CB band
    else if (freq >= 28000 && freq <= 29700) band = '10m';
    else if (freq >= 50000 && freq <= 54000) band = '6m';

    bandCounts[band] = (bandCounts[band] || 0) + 1;
  });

  // Calculate spots per mode
  const modeCounts = {};
  spots.forEach((s) => {
    const mode = s.mode || 'unknown';
    modeCounts[mode] = (modeCounts[mode] || 0) + 1;
  });

  res.json({
    connected,
    currentNode: currentNode?.name || 'none',
    totalSpots: spots.length,
    totalReceived: totalSpotsReceived,
    spotsWithDxGrid,
    spotsWithSpotterGrid,
    lastSpotTime: lastSpotTime?.toISOString() || null,
    retentionMinutes: CONFIG.spotRetentionMs / 60000,
    bandCounts,
    modeCounts,
  });
});

// Debug endpoint - show spots with grids
app.get('/api/debug/grids', (req, res) => {
  const spotsWithGrids = spots.filter((s) => s.dxGrid || s.spotterGrid).slice(0, 20);
  const allGrids = spots.slice(0, 50).map((s) => ({
    call: s.call,
    spotter: s.spotter,
    dxGrid: s.dxGrid || null,
    spotterGrid: s.spotterGrid || null,
    comment: s.comment,
  }));

  res.json({
    totalSpots: spots.length,
    spotsWithDxGrid: spots.filter((s) => s.dxGrid).length,
    spotsWithSpotterGrid: spots.filter((s) => s.spotterGrid).length,
    spotsWithAnyGrid: spots.filter((s) => s.dxGrid || s.spotterGrid).length,
    sampleSpotsWithGrids: spotsWithGrids,
    recentSpots: allGrids,
  });
});

// Force reconnect
app.post('/api/reconnect', (req, res) => {
  log('API', 'Force reconnect requested');
  handleDisconnect();
  res.json({ status: 'reconnecting' });
});

// Switch node
app.post('/api/switch-node', (req, res) => {
  const { index } = req.body;
  if (typeof index === 'number' && index >= 0 && index < CONFIG.nodes.length) {
    currentNodeIndex = index;
    reconnectAttempts = 0;
    log('API', `Switching to node index ${index}: ${CONFIG.nodes[index].name}`);
    handleDisconnect();
    res.json({ status: 'switching', node: CONFIG.nodes[index].name });
  } else {
    res.status(400).json({ error: 'Invalid node index', availableNodes: CONFIG.nodes.map((n) => n.name) });
  }
});

// List available nodes
app.get('/api/nodes', (req, res) => {
  res.json({
    nodes: CONFIG.nodes.map((n, i) => ({
      index: i,
      name: n.name,
      host: n.host,
      port: n.port,
      active: i === currentNodeIndex,
    })),
    currentIndex: currentNodeIndex,
  });
});

// ============================================
// STARTUP
// ============================================

const PORT = process.env.PORT || 3001;

// Start cleanup interval
setInterval(cleanupSpots, CONFIG.cleanupIntervalMs);

// Start server
app.listen(PORT, () => {
  log('START', `DX Spider Proxy v${PROXY_VERSION} listening on port ${PORT}`);
  log('CONFIG', `Callsign: ${CONFIG.callsign}`);
  log('CONFIG', `CALLSIGN env var: ${process.env.CALLSIGN === undefined ? '(not set)' : `"${process.env.CALLSIGN}"`}`);
  log('CONFIG', `Spot retention: ${CONFIG.spotRetentionMs / 60000} minutes`);
  log('CONFIG', `Available nodes: ${CONFIG.nodes.map((n) => n.name).join(', ')}`);

  // Fail closed on a bad callsign rather than spamming nodes with junk logins.
  if (!isValidCallsign(CONFIG.callsign)) {
    log(
      'ERROR',
      `Configured callsign "${CONFIG.callsign}" is not a valid amateur callsign — refusing to connect. Set a valid CALLSIGN env var.`,
    );
    return;
  }

  // Check the remote kill switch BEFORE the first dial, then keep watching it.
  // Fail open: if the check errors/times out we connect anyway.
  refreshClusterStatus().finally(() => connect());
  setInterval(refreshClusterStatus, CLUSTER_STATUS_REFRESH_MS).unref();
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  log('SHUTDOWN', 'Received SIGTERM, shutting down...');
  if (client) {
    client.destroy();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  log('SHUTDOWN', 'Received SIGINT, shutting down...');
  if (client) {
    client.destroy();
  }
  process.exit(0);
});
