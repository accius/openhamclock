/**
 * DX Cluster routes — spots, sources, paths, custom sessions.
 * Lines ~2936-4193 of original server.js
 */

const dgram = require('dgram');
const net = require('net');
const { maidenheadToLatLon } = require('../utils/grid.js');
const { areDXPathsDuplicate, collapseDuplicateDXPaths } = require('../utils/dxClusterPathIdentity');
const { isPrivateIP, validateCustomHost } = require('../utils/ssrf');
const clusterStatus = require('../utils/clusterStatus');

module.exports = function (app, ctx) {
  const {
    fetch,
    CONFIG,
    APP_VERSION,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    extractBaseCallsign,
    extractOperatingPrefix,
    estimateLocationFromPrefix,
    extractGridFromComment,
    extractGridsFromComment,
    getCountryFromPrefix,
    cacheCallsignLookup,
    callsignLookupCache,
    callsignLocationCache,
    hamqthLookup,
  } = ctx;

  // DX Cluster proxy - fetches from selectable sources
  // Query param: ?source=hamqth|dxspider|proxy|auto (default: auto)
  // Note: DX Spider uses telnet - works locally but may be blocked on cloud hosting
  // The 'proxy' source uses our DX Spider Proxy microservice

  const CALLSIGN_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // Cross-reference a callsign against active DXpeditions.
  // Returns { lat, lon, entity } if the call matches a known DXpedition,
  // using the DXpedition's DXCC entity coordinates from cty.dat.
  const { lookupCall } = require('../../src/server/ctydat.js');

  function lookupDXpeditionLocation(call) {
    const cache = ctx.dxpeditionCache;
    if (!cache?.data?.dxpeditions) return null;
    const upper = (call || '').toUpperCase();
    // Check ALL DXpeditions (active + upcoming) — NG3K date parsing isn't
    // always accurate, and a DXpedition being spotted means it IS active
    const dxped = cache.data.dxpeditions.find((d) => d.callsign?.toUpperCase() === upper);
    if (!dxped || !dxped.entity) return null;

    // Look up the DXpedition entity in cty.dat's entity list
    const { getCtyData } = require('../../src/server/ctydat.js');
    const cty = getCtyData();
    if (!cty?.entities) return null;

    const entityName = dxped.entity.toLowerCase().replace(/\s+/g, ' ').trim();
    const match = cty.entities.find((e) => {
      const eName = (e.entity || '').toLowerCase().replace(/\s+/g, ' ').trim();
      return eName === entityName || eName.includes(entityName) || entityName.includes(eName);
    });
    if (match && match.lat != null && match.lon != null) {
      return { lat: match.lat, lon: match.lon, country: match.entity, source: 'dxpedition' };
    }
    return null;
  }

  // Is this callsign a known (active or upcoming) DXpedition? Lighter check
  // than lookupDXpeditionLocation — matches even when the entity's
  // coordinates can't be resolved, which is all the panel filter needs.
  function isDXpeditionCall(call) {
    const cache = ctx.dxpeditionCache;
    if (!cache?.data?.dxpeditions) return false;
    const upper = (call || '').toUpperCase();
    return cache.data.dxpeditions.some((d) => d.callsign?.toUpperCase() === upper);
  }

  // DX Spider Proxy URL (sibling service on Railway or external)
  const DXSPIDER_PROXY_URL = process.env.DXSPIDER_PROXY_URL || 'https://spider-production-1ec7.up.railway.app';

  // OpenHamClock's own cluster node (ohc-cluster/ sibling service).
  // Unset = not deployed yet; the source is hidden and auto mode skips it.
  // A schemeless value (e.g. "ohc-cluster.railway.internal:3002") would make
  // every fetch throw "Only absolute URLs are supported" — normalize it.
  const OHC_CLUSTER_URL = (() => {
    const raw = (process.env.OHC_CLUSTER_URL || '').trim().replace(/\/$/, '');
    if (raw && !/^https?:\/\//i.test(raw)) {
      console.warn(`[DX Cluster] OHC_CLUSTER_URL has no scheme — assuming http://${raw}`);
      return `http://${raw}`;
    }
    return raw;
  })();

  // Hosted-instance lockdown. Set OHC_HOSTED=1 ONLY on our Railway deployments:
  // the hosted site serves many users from one egress IP, so user-directed
  // cluster connections (custom telnet, UDP, direct DXSpider) are forbidden —
  // everything comes from our own cluster node. Self-hosted installs never set
  // this and keep the full source list (with their own callsign enforced).
  const IS_HOSTED = process.env.OHC_HOSTED === '1' || process.env.OHC_HOSTED === 'true';
  if (IS_HOSTED && !OHC_CLUSTER_URL) {
    console.error(
      '[DX Cluster] OHC_HOSTED is set but OHC_CLUSTER_URL is not — the hosted source list offers only the OHC node, and every fetch to it will fail. Set OHC_CLUSTER_URL.',
    );
  }

  // DX Spider nodes - dxspider.co.uk primary per G6NHU
  // SSID -56 for OpenHamClock (HamClock uses -55)
  // dxc.nc7j.com (NG7M/NC7J, ArcConnect) removed at the sysop's request — do
  // not re-add. See dxspider-proxy/server.js for the full rationale.
  const DXSPIDER_NODES = [
    { host: 'dxspider.co.uk', port: 7300 },
    { host: 'dxc.ai9t.com', port: 7373 },
  ];
  const DXSPIDER_SSID = '-56'; // OpenHamClock SSID

  // Validate an amateur callsign (optionally with an SSID like -56).
  // Permissive about real callsign shapes, but rejects junk like
  // 'OPENHAMCLOCK-56' or 'GUEST' — cluster nodes treat invalid logins as
  // abuse, and that falls back on the whole project. Mirrors the validator
  // in dxspider-proxy/server.js and ohc-cluster/lib/callsign.js.
  const isValidCallsign = (call) =>
    typeof call === 'string' && /^[A-Z0-9]{1,3}\d[A-Z]{1,4}(-\d{1,2})?$/i.test(call.trim());

  // Phrases a node sends when it refuses our login. On a match we must stop
  // immediately — never fire follow-up commands (sh/dx, set/dx), which the node
  // reads as further bad logins.
  const LOGIN_REJECTION_RE =
    /(invalid|unknown|not a valid|incorrect|illegal|bad)\s+call|please enter.*call|login incorrect/i;

  // DXSpider "bump": a second login with the same callsign kicks the first instance
  // ("Reconnected as <call> ... this instance is disconnected"). Two OpenHamClock
  // instances sharing one callsign cannibalize each other into a reconnect storm, so
  // a bump is a hard back-off signal.
  const BUMP_RE =
    /reconnected as .*(?:this instance|on another|is disconnect)|already connected|connected from another/i;

  // appendSsid: curated OHC sources tag logins with our -56 SSID. Custom
  // clusters pass false — the user connects to third-party nodes under their
  // own bare callsign (or their own SSID), with nothing linking back to OHC.
  // Returns null when no usable callsign is configured — we never present
  // GUEST (or any shared placeholder) to a cluster node.
  function getDxClusterLoginCallsign(preferredCallsign = null, appendSsid = true) {
    // Strip control characters to prevent telnet command injection via query params
    const candidate = (preferredCallsign || CONFIG.dxClusterCallsign || '').replace(/[\x00-\x1F\x7F]/g, '').trim();
    if (candidate && candidate.toUpperCase() !== 'N0CALL') {
      // Append default SSID if caller didn't include one
      if (appendSsid && !candidate.includes('-')) {
        return `${candidate.toUpperCase()}${DXSPIDER_SSID}`;
      }
      return candidate.toUpperCase();
    }

    if (CONFIG.callsign && CONFIG.callsign.toUpperCase() !== 'N0CALL') {
      return appendSsid ? `${CONFIG.callsign.toUpperCase()}${DXSPIDER_SSID}` : CONFIG.callsign.toUpperCase();
    }

    return null;
  }

  function parseDXSpiderSpotLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const now = new Date();

    // Parse HHMMz (UTC) into epoch ms, using today (or previous day if in the future).
    const hhmmToTimestampMs = (hhmm) => {
      if (!/^\d{4}$/.test(hhmm)) return Date.now();
      const hh = parseInt(hhmm.substring(0, 2), 10);
      const mm = parseInt(hhmm.substring(2, 4), 10);
      const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0, 0));
      // If parsed time is too far in the future, assume spot was yesterday.
      if (dt.getTime() - Date.now() > 5 * 60 * 1000) {
        dt.setUTCDate(dt.getUTCDate() - 1);
      }
      return dt.getTime();
    };

    // Format 1: classic stream line
    // DX de SPOTTER:  14074.0 DXCALL comment 1234Z
    if (line.includes('DX de ')) {
      const match = line.match(/DX de ([A-Z0-9\/\-]+):\s+(\d+\.?\d*)\s+([A-Z0-9\/\-]+)\s+(.+?)\s+(\d{4})Z/i);
      if (match) {
        const freqKhz = parseFloat(match[2]);
        if (isNaN(freqKhz) || freqKhz <= 0) return null;
        return {
          spotter: match[1].replace(':', ''),
          freq: (freqKhz / 1000).toFixed(3),
          call: match[3],
          comment: match[4].trim(),
          time: `${match[5].substring(0, 2)}:${match[5].substring(2, 4)}z`,
          timestampMs: hhmmToTimestampMs(match[5]),
          source: 'DX Spider',
        };
      }
    }

    // Format 2: DXSpider sh/dx table output
    //  14080.0 II0LOVE   13-Feb-2026 1639Z comment... <IK0MIB>
    const tableMatch = line.match(
      /^\s*(\d+\.?\d*)\s+([A-Z0-9\/\-]+)\s+\d{1,2}-[A-Za-z]{3}-\d{4}\s+(\d{4})Z\s+(.*)\s+<([A-Z0-9\/\-]+)>\s*$/i,
    );
    if (tableMatch) {
      const freqKhz = parseFloat(tableMatch[1]);
      if (isNaN(freqKhz) || freqKhz <= 0) return null;
      const fullDateMatch = line.match(/^\s*\d+\.?\d*\s+[A-Z0-9\/\-]+\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{4})Z/i);
      let timestampMs = Date.now();
      if (fullDateMatch) {
        const day = parseInt(fullDateMatch[1], 10);
        const mon = fullDateMatch[2].toLowerCase();
        const year = parseInt(fullDateMatch[3], 10);
        const hhmm = fullDateMatch[4];
        const monthMap = {
          jan: 0,
          feb: 1,
          mar: 2,
          apr: 3,
          may: 4,
          jun: 5,
          jul: 6,
          aug: 7,
          sep: 8,
          oct: 9,
          nov: 10,
          dec: 11,
        };
        if (monthMap[mon] != null && /^\d{4}$/.test(hhmm)) {
          const hh = parseInt(hhmm.substring(0, 2), 10);
          const mm = parseInt(hhmm.substring(2, 4), 10);
          timestampMs = Date.UTC(year, monthMap[mon], day, hh, mm, 0, 0);
        }
      }
      return {
        spotter: tableMatch[5],
        freq: (freqKhz / 1000).toFixed(3),
        call: tableMatch[2],
        comment: (tableMatch[4] || '').trim(),
        time: `${tableMatch[3].substring(0, 2)}:${tableMatch[3].substring(2, 4)}z`,
        timestampMs,
        source: 'DX Spider',
      };
    }

    return null;
  }

  // Persistent custom DX sessions (used by source=custom in /api/dxcluster/paths)
  const CUSTOM_DX_RETENTION_MS = 30 * 60 * 1000;
  const CUSTOM_DX_MAX_SPOTS = 500;
  const CUSTOM_DX_RECONNECT_DELAY_MS = 10000; // base; backs off exponentially on repeated failure
  const CUSTOM_DX_RECONNECT_MIN_MS = 10000; // hard floor between dial attempts — a poll can never dial sooner
  const CUSTOM_DX_MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000; // cap — never hammer a node (mirror proxy)
  const CUSTOM_DX_RAPID_DISCONNECT_MS = 15000; // kicked within 15s ⇒ likely auth reject / SSID bump
  const CUSTOM_DX_MAX_DEAD_ATTEMPTS = 4; // park a node that NEVER once authenticated after this many attempts
  const CUSTOM_DX_KEEPALIVE_MS = 30000;
  const CUSTOM_DX_STALE_MS = 5 * 60 * 1000; // Force reconnect after 5 min with no data
  const CUSTOM_DX_IDLE_TIMEOUT = 15 * 60 * 1000; // Reap sessions idle for 15 minutes
  const customDxSessions = new Map();

  // Reap idle custom DX sessions every 5 minutes to prevent unbounded growth
  setInterval(
    () => {
      const now = Date.now();
      let reaped = 0;
      for (const [key, session] of customDxSessions) {
        if (now - session.lastUsedAt > CUSTOM_DX_IDLE_TIMEOUT) {
          // Tombstone first so the socket's async 'close' → handleCustomSessionDisconnect
          // can't spawn a detached reconnect loop after we delete the session (a
          // single-process self-bump vector).
          session.reaped = true;
          // Tear down timers
          if (session.reconnectTimer) {
            clearTimeout(session.reconnectTimer);
            session.reconnectTimer = null;
          }
          if (session.keepAliveTimer) {
            clearInterval(session.keepAliveTimer);
            session.keepAliveTimer = null;
          }
          if (session.cleanupTimer) {
            clearInterval(session.cleanupTimer);
            session.cleanupTimer = null;
          }
          // Close TCP socket
          try {
            session.client?.destroy();
          } catch {}
          customDxSessions.delete(key);
          reaped++;
        }
      }
      if (reaped > 0) console.log(`[DX Custom] Reaped ${reaped} idle sessions, ${customDxSessions.size} remaining`);
    },
    5 * 60 * 1000,
  );

  function buildCustomSessionKey(node, loginCallsign) {
    return `${node.host}:${node.port}:${loginCallsign}`;
  }

  function addCustomSessionSpot(session, spot) {
    const now = Date.now();
    const spotTs = Number.isFinite(spot.timestampMs) ? spot.timestampMs : now;
    // Deduplicate by call+freq+spotter within 2 minutes.
    const duplicate = session.spots.some(
      (s) =>
        s.call === spot.call &&
        s.freq === spot.freq &&
        s.spotter === spot.spotter &&
        Math.abs(spotTs - s.timestampMs) < 120000,
    );
    if (duplicate) return;

    session.spots.unshift({ ...spot, timestampMs: spotTs });
    session.spots = session.spots
      .filter((s) => now - s.timestampMs < CUSTOM_DX_RETENTION_MS)
      .slice(0, CUSTOM_DX_MAX_SPOTS);
  }

  function scheduleCustomSessionReconnect(session) {
    if (session.reaped || session.parked) return; // never resurrect a dead / given-up session
    if (session.reconnectTimer) return; // single pending timer per session key
    // Exponential backoff: base * 2^(attempts-1), capped, with a hard floor. Replaces
    // the old fixed 10s loop that hammered nodes ~6×/min indefinitely.
    const n = Math.max(0, (session.reconnectAttempts || 0) - 1);
    const base = Math.min(CUSTOM_DX_RECONNECT_DELAY_MS * 2 ** n, CUSTOM_DX_MAX_RECONNECT_DELAY_MS);
    const floored = Math.max(CUSTOM_DX_RECONNECT_MIN_MS, base);
    // Jitter (+0..25%, capped 30s) breaks the synchronized reconnect herd across instances.
    const jitter = Math.floor(Math.random() * Math.min(floored * 0.25, 30000));
    const delay = floored + jitter;
    logDebug(`[DX Cluster] Reconnect ${session.node.host} in ${delay}ms (attempt ${session.reconnectAttempts || 0})`);
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = null;
      connectCustomSession(session);
    }, delay);
  }

  // Tear the socket down (remove listeners first so its async 'close' can't re-enter
  // the disconnect path) and route through the counting/backoff scheduler.
  function teardownAndReconnect(session, client) {
    const sock = client || session.client;
    try {
      sock?.removeAllListeners();
      sock?.destroy();
    } catch (e) {}
    if (session.client === sock) session.client = null;
    handleCustomSessionDisconnect(session);
  }

  function handleCustomSessionDisconnect(session) {
    if (session.reaped) return; // reaper tombstone — do not revive
    if (customDxSessions.get(session.key) !== session) return; // orphaned (post-reap) — do not revive
    // Already down with a reconnect pending — nothing to do (prevents double-counting
    // when both 'error' and 'close' fire for the same drop).
    if (session.connected === false && session.connecting === false && session.reconnectTimer) return;

    const connMs = session.lastConnectedAt ? Date.now() - session.lastConnectedAt : 0;

    session.connected = false;
    session.connecting = false;
    session.loginSent = false;
    session.commandSent = false;
    session.authenticated = false;

    if (session.keepAliveTimer) {
      clearInterval(session.keepAliveTimer);
      session.keepAliveTimer = null;
    }
    try {
      session.client?.destroy();
    } catch (e) {}

    // Rapid disconnect (kicked within ~15s of connecting) is almost always an auth
    // rejection or same-SSID bump — escalate the backoff harder than a normal drop.
    if (session.lastConnectedAt && connMs > 0 && connMs < CUSTOM_DX_RAPID_DISCONNECT_MS) {
      logWarn(
        `[DX Cluster] Rapid disconnect from ${session.node.host} after ${Math.round(connMs / 1000)}s (auth reject / SSID conflict)`,
      );
      session.reconnectAttempts = Math.min((session.reconnectAttempts || 0) + 2, 20);
    } else {
      session.reconnectAttempts = Math.min((session.reconnectAttempts || 0) + 1, 20);
    }

    // Give up on a node that has NEVER authenticated after repeated attempts — it
    // accepts TCP but never sends a banner/prompt/spot (a dead or blackholing node,
    // the dominant source of endless "No data … forcing reconnect" churn in prod).
    // Nodes that authenticated at least once are exempt: a transient drop just backs
    // off. The idle-reaper removes the parked session once the client stops polling.
    if (!session.everAuthenticated && session.reconnectAttempts >= CUSTOM_DX_MAX_DEAD_ATTEMPTS) {
      if (!session.parked) {
        logWarn(
          `[DX Cluster] Parking ${session.node.host} — no data / never authenticated after ${session.reconnectAttempts} attempts (dead node)`,
        );
      }
      session.parked = true;
      return;
    }

    scheduleCustomSessionReconnect(session);
  }

  function connectCustomSession(session) {
    if (session.reaped || session.parked) return;
    if (session.connected || session.connecting) return;

    // Remote kill switch: checked before every dial (not just at startup) so a
    // flag flip reaches long-lived sessions too. Returning here leaves the
    // session idle; the next poll re-checks and dials once re-enabled.
    const gate = clusterStatus.isDialingAllowed(APP_VERSION, 'app');
    if (!gate.allowed) {
      logWarn(`[DX Cluster] Not dialing ${session.node.host} — ${gate.reason}`);
      return;
    }

    // HARD FLOOR: never dial sooner than CUSTOM_DX_RECONNECT_MIN_MS since the last
    // attempt — even when a poll tries to force us. Reschedule for the remainder so a
    // busy polling client can't turn reconnect into a fast loop.
    const sinceLast = Date.now() - (session.lastConnectAttemptAt || 0);
    if (session.lastConnectAttemptAt && sinceLast < CUSTOM_DX_RECONNECT_MIN_MS) {
      if (!session.reconnectTimer) {
        session.reconnectTimer = setTimeout(() => {
          session.reconnectTimer = null;
          connectCustomSession(session);
        }, CUSTOM_DX_RECONNECT_MIN_MS - sinceLast);
      }
      return;
    }

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }

    // Single in-flight: kill any lingering socket before opening a new one so one
    // session key never holds two concurrent connections (mirror the proxy).
    if (session.client) {
      try {
        session.client.removeAllListeners();
        session.client.destroy();
      } catch (e) {}
      session.client = null;
    }

    session.connecting = true;
    session.lastConnectAttemptAt = Date.now();
    session.authenticated = false;
    session.loginRejected = false;
    // NOTE: reconnectAttempts is NOT reset here — only when spots actually flow with
    // >60s uptime. Resetting on connect would defeat backoff against a node that
    // accepts TCP then kicks us right after auth.

    const client = new net.Socket();
    session.client = client;
    session.buffer = '';
    session.loginSent = false;
    session.commandSent = false;
    client.setTimeout(0);
    client.setKeepAlive(true, 60000); // OS-level TCP keepalive probes every 60s

    // SECURITY: session.node.host is either the resolved IP from validateCustomHost()
    // — which rejects private/reserved addresses and prevents DNS rebinding (TOCTOU),
    // see the /api/dxcluster/paths handler where resolvedHost = hostCheck.resolvedIP —
    // or one of the hardcoded DXSPIDER_NODES hostnames (trusted constants, never
    // user input).
    client.connect(session.node.port, session.node.host, () => {
      // CodeQL: validated above
      session.connected = true;
      session.connecting = false;
      session.lastConnectedAt = Date.now();
      session.lastDataAt = Date.now();
      logDebug(
        `[DX Cluster] DX Spider: connected to ${session.node.host}:${session.node.port} as ${session.loginCallsign}`,
      );

      // Fallback: send login even if prompt text differs.
      setTimeout(() => {
        if (session.client && session.connected && !session.loginSent && !session.loginRejected) {
          session.loginSent = true;
          session.client.write(`${session.loginCallsign}\r\n`);
        }
      }, 1200);

      session.keepAliveTimer = setInterval(() => {
        if (session.client && session.connected) {
          // A connection that has stayed up and authenticated is healthy — clear the
          // failover counter so a later transient drop restarts backoff from the base.
          if (
            session.reconnectAttempts > 0 &&
            session.authenticated &&
            session.lastConnectedAt &&
            Date.now() - session.lastConnectedAt > 60000
          ) {
            session.reconnectAttempts = 0;
          }
          // Force reconnect if no data received for CUSTOM_DX_STALE_MS
          const silentMs = Date.now() - (session.lastDataAt || 0);
          if (silentMs > CUSTOM_DX_STALE_MS) {
            logWarn(
              `[DX Cluster] No data from ${session.node.host} in ${Math.round(silentMs / 60000)} min — forcing reconnect`,
            );
            handleCustomSessionDisconnect(session);
            return;
          }
          try {
            session.client.write('\r\n');
          } catch (e) {}
        }
      }, CUSTOM_DX_KEEPALIVE_MS);
    });

    client.on('data', (data) => {
      session.lastDataAt = Date.now();
      session.buffer += data.toString();

      // Login prompt → present our callsign. This is legitimate; only the sh/dx and
      // set/dx follow-ups are the abuse vector, so those are gated separately below.
      if (
        !session.loginSent &&
        !session.loginRejected &&
        (session.buffer.includes('login:') ||
          session.buffer.includes('Please enter your call') ||
          session.buffer.includes('enter your callsign'))
      ) {
        session.loginSent = true;
        client.write(`${session.loginCallsign}\r\n`);
      }

      // BUMP: our callsign was taken over by another login (cannibalization). Can
      // happen even after auth. Transient contention → back off to the cap but keep
      // trying. Checked on the raw buffer since the notice may arrive without a \n.
      if (BUMP_RE.test(session.buffer)) {
        logWarn(`[DX Cluster] Bumped on ${session.node.host} (same-callsign SSID conflict) — backing off`);
        session.reconnectAttempts = Math.max(session.reconnectAttempts || 0, 12); // → 5-min cap
        teardownAndReconnect(session, client);
        return;
      }

      // LOGIN REJECTION (pre-auth): node refused this callsign outright. Retrying
      // won't help and re-presenting it is exactly the abuse sysops flag — PARK the
      // session so it stops dialing. The idle-reaper removes it once polling stops.
      if (!session.authenticated && LOGIN_REJECTION_RE.test(session.buffer)) {
        logWarn(`[DX Cluster] Login refused by ${session.node.host} — parking session (no reconnect)`);
        session.loginRejected = true;
        session.parked = true;
        teardownAndReconnect(session, client);
        return;
      }

      // Enable the spot feed once the node is responding post-login — never if the
      // login was refused. Snapshot (sh/dx) once per session; set/dx per connection.
      if (
        session.loginSent &&
        !session.commandSent &&
        !session.loginRejected &&
        (session.buffer.includes('Hello') ||
          session.buffer.includes(' de ') ||
          session.buffer.includes('dxspider >') ||
          /\sde\s+\S+\s*>/.test(session.buffer) ||
          session.buffer.includes(session.loginCallsign.split('-')[0]))
      ) {
        session.commandSent = true;
        session.authenticated = true; // node is responding to our login
        session.everAuthenticated = true;
        setTimeout(() => {
          if (session.client && session.connected && !session.loginRejected) {
            if (!session.initialSnapshotDone) {
              logInfo(
                `[DX Cluster] Sending command: sh/dx 25 to ${session.node.host}:${session.node.port} as ${session.loginCallsign}`,
              );
              session.client.write('sh/dx 25\r\n');
              session.initialSnapshotDone = true;
            }
            // Enable ongoing stream where supported.
            setTimeout(() => {
              if (session.client && session.connected && !session.loginRejected) {
                session.client.write('set/dx\r\n');
              }
            }, 700);
          }
        }, 500);
      }

      const lines = session.buffer.split('\n');
      session.buffer = lines.pop() || '';
      for (const line of lines) {
        const parsed = parseDXSpiderSpotLine(line);
        if (parsed) {
          addCustomSessionSpot(session, parsed);
          // A flowing spot proves login succeeded; reset backoff once stable >60s.
          if (!session.authenticated) session.authenticated = true;
          session.everAuthenticated = true;
          const uptime = session.lastConnectedAt ? Date.now() - session.lastConnectedAt : 0;
          if (session.reconnectAttempts > 0 && uptime > 60000) session.reconnectAttempts = 0;
        }
      }
    });

    client.on('timeout', () => {
      logWarn(`[DX Cluster] Socket timeout for ${session.node.host} — reconnecting`);
      handleCustomSessionDisconnect(session);
    });

    client.on('error', (err) => {
      if (
        !err.message.includes('ECONNRESET') &&
        !err.message.includes('ETIMEDOUT') &&
        !err.message.includes('ENOTFOUND') &&
        !err.message.includes('ECONNREFUSED')
      ) {
        logErrorOnce('DX Cluster', `Custom DX Spider ${session.node.host}: ${err.message}`);
      }
      handleCustomSessionDisconnect(session);
    });

    client.on('close', () => {
      handleCustomSessionDisconnect(session);
    });
  }

  // appendSsid=true is the curated-source convention (CALL-56 identifies
  // OpenHamClock to sysops); custom clusters keep the user's callsign as-is.
  // Returns null instead of dialing when no valid callsign is available —
  // a cluster node never sees GUEST or a junk login from us.
  function getOrCreateCustomSession(node, userCallsign = null, appendSsid = false) {
    const loginCallsign = getDxClusterLoginCallsign(userCallsign, appendSsid);
    if (!isValidCallsign(loginCallsign)) return null;
    const key = buildCustomSessionKey(node, loginCallsign);
    let session = customDxSessions.get(key);

    if (!session) {
      session = {
        key,
        node,
        loginCallsign,
        client: null,
        connected: false,
        connecting: false,
        loginSent: false,
        commandSent: false,
        initialSnapshotDone: false,
        buffer: '',
        spots: [],
        reconnectTimer: null,
        keepAliveTimer: null,
        lastConnectedAt: 0,
        lastDataAt: 0,
        lastUsedAt: Date.now(),
        cleanupTimer: null,
        // Good-neighbour hardening (mirrors dxspider-proxy/server.js):
        authenticated: false, // positive auth proven this connection
        everAuthenticated: false, // has this session EVER authenticated (gates dead-node park)
        loginRejected: false, // node refused our login on the current socket
        reconnectAttempts: 0, // consecutive failures; resets only when healthy
        lastConnectAttemptAt: 0, // enforces the hard reconnect floor
        parked: false, // gave up (login permanently refused); no more dials
        reaped: false, // idle-reaper tombstone; suppresses zombie reconnect
      };
      session.cleanupTimer = setInterval(() => {
        const now = Date.now();
        session.spots = session.spots
          .filter((s) => now - s.timestampMs < CUSTOM_DX_RETENTION_MS)
          .slice(0, CUSTOM_DX_MAX_SPOTS);
      }, 60000);
      customDxSessions.set(key, session);
      connectCustomSession(session);
    } else {
      session.lastUsedAt = Date.now();
      // Nudge a reconnect only when genuinely idle AND no backoff is pending/parked.
      // NEVER clear a pending reconnect timer from a poll — that force-connect on every
      // poll is what truncated backoff to the poll interval and revived rejected
      // sessions, defeating the hardening below.
      if (
        !session.connected &&
        !session.connecting &&
        !session.parked &&
        !session.reaped &&
        !session.reconnectTimer &&
        Date.now() - (session.lastConnectAttemptAt || 0) >= CUSTOM_DX_RECONNECT_MIN_MS
      ) {
        connectCustomSession(session);
      }
    }

    return session;
  }

  app.get('/api/dxcluster/spots', async (req, res) => {
    // Hosted instances serve OUR cluster only, whatever the client asks for.
    const source = IS_HOSTED ? 'ohc' : (req.query.source || CONFIG.dxClusterSource || 'auto').toLowerCase();
    // Used by DX Spider direct for the telnet login (falls back to config).
    const userCallsign = (req.query.callsign || '').trim();

    // Helper function for HamQTH (HTTP-based, works everywhere)
    async function fetchHamQTH() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch('https://www.hamqth.com/dxc_csv.php?limit=25', {
          headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const text = await response.text();
          // HamQTH CSV format: Spotter^Frequency^DXCall^Comment^TimeDate^^^Continent^Band^Country^DXCC
          // Example: KF0NYM^18070.0^TX5U^Correction, Good Sig MO, 73^2149 2025-05-27^^^EU^17M^France^227
          const lines = text
            .trim()
            .split('\n')
            .filter((line) => line.includes('^'));

          if (lines.length > 0) {
            const spots = lines.slice(0, 25).map((line) => {
              const parts = line.split('^');
              const spotter = parts[0] || '';
              const freqKhz = parseFloat(parts[1]) || 0;
              const dxCall = parts[2] || 'UNKNOWN';
              const comment = parts[3] || '';
              const timeDate = parts[4] || '';

              // Frequency: convert from kHz to MHz
              const freqMhz = freqKhz > 1000 ? (freqKhz / 1000).toFixed(3) : String(freqKhz);

              // Time: extract HHMM from "2149 2025-05-27" format
              let time = '';
              if (timeDate && timeDate.length >= 4) {
                const timeStr = timeDate.substring(0, 4);
                time = timeStr.substring(0, 2) + ':' + timeStr.substring(2, 4) + 'z';
              }

              return {
                freq: freqMhz,
                call: dxCall,
                comment: comment,
                time: time,
                spotter: spotter,
                source: 'HamQTH',
              };
            });
            logDebug('[DX Cluster] HamQTH:', spots.length, 'spots');
            return spots;
          }
        }
      } catch (error) {
        clearTimeout(timeout);
        if (error.name !== 'AbortError') {
          logErrorOnce('DX Cluster', `HamQTH: ${error.message}`);
        }
      }
      return null;
    }

    // Helper function for DX Spider Proxy (our microservice)
    async function fetchDXSpiderProxy() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(`${DXSPIDER_PROXY_URL}/api/dxcluster/spots?limit=50`, {
          headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const spots = await response.json();
          if (Array.isArray(spots) && spots.length > 0) {
            logDebug('[DX Cluster] DX Spider Proxy:', spots.length, 'spots');
            return spots;
          }
        }
      } catch (error) {
        clearTimeout(timeout);
        if (error.name !== 'AbortError') {
          logErrorOnce('DX Cluster', `Proxy: ${error.message}`);
        }
      }
      return null;
    }

    // Helper function for the OpenHamClock Cluster (our own node — RBN
    // skimmers + HamQTH human spots + OHC user submissions)
    async function fetchOHCCluster() {
      if (!OHC_CLUSTER_URL) return null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(`${OHC_CLUSTER_URL}/api/dxcluster/spots?limit=150`, {
          headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const spots = await response.json();
          if (Array.isArray(spots) && spots.length > 0) {
            logDebug('[DX Cluster] OHC Cluster:', spots.length, 'spots');
            return spots;
          }
        }
      } catch (error) {
        clearTimeout(timeout);
        if (error.name !== 'AbortError') {
          logErrorOnce('DX Cluster', `OHC Cluster: ${error.message}`);
        }
      }
      return null;
    }

    // DX Spider direct (telnet, works locally/Pi) — PERSISTENT session only.
    // Clusters are designed for one long-lived login per callsign with a
    // streamed spot feed; the old connect → sh/dx → bye poll here churned
    // third-party nodes (every login/logout is rebroadcast network-wide via
    // the PC protocol) and is exactly what sysops flag as abuse. This reuses
    // the custom-session machinery: login once as CALL-56, one sh/dx 25
    // snapshot, set/dx stream, keepalive, backoff, kill-switch gate. Requires
    // a real callsign — without one we skip telnet and fall back to HTTP.
    function fetchDXSpider(userCallsign) {
      if (!isValidCallsign(getDxClusterLoginCallsign(userCallsign))) {
        logDebug('[DX Cluster] DX Spider direct needs a valid callsign — set one in Settings');
        return null;
      }
      for (const node of DXSPIDER_NODES) {
        const session = getOrCreateCustomSession(node, userCallsign, true);
        if (!session) return null;
        if (session.spots.length > 0) {
          return session.spots.slice(0, 50);
        }
        // Session still warming up or backing off — serve the HTTP fallback
        // this poll rather than dialing a second node alongside it. Only a
        // parked session (login refused / dead node) falls through to the
        // next node in the list.
        if (!session.parked) return null;
      }
      return null;
    }

    // Fetch based on selected source
    let spots = null;

    if (source === 'ohc') {
      spots = await fetchOHCCluster();
      // Fallback chain if our node is down
      if (!spots) {
        logDebug('[DX Cluster] OHC Cluster failed, falling back to Proxy');
        spots = await fetchDXSpiderProxy();
      }
      if (!spots) {
        spots = await fetchHamQTH();
      }
    } else if (source === 'hamqth') {
      spots = await fetchHamQTH();
    } else if (source === 'proxy') {
      spots = await fetchDXSpiderProxy();
      // Fallback to HamQTH if proxy fails
      if (!spots) {
        logDebug('[DX Cluster] Proxy failed, falling back to HamQTH');
        spots = await fetchHamQTH();
      }
    } else if (source === 'dxspider') {
      spots = fetchDXSpider(userCallsign);
      // Fallback to HamQTH while the session warms up or when telnet fails
      if (!spots) {
        logDebug('[DX Cluster] DX Spider has no spots yet, falling back to HamQTH');
        spots = await fetchHamQTH();
      }
    } else {
      // Auto mode - our own cluster first (when deployed), then Proxy, then HamQTH.
      // Auto NEVER dials third-party telnet nodes — direct telnet is an explicit
      // opt-in (source=dxspider), so a fleet of installs can't silently converge
      // on someone else's node.
      spots = await fetchOHCCluster();
      if (!spots) {
        spots = await fetchDXSpiderProxy();
      }
      if (!spots) {
        spots = await fetchHamQTH();
      }
    }

    res.json(spots || []);
  });

  // ============================================
  // SPOT SUBMISSION — relay user spots to our own cluster node
  // ============================================
  // The browser never talks to the cluster directly: on hosted deployments it
  // lives on the private network, and going through the instance keeps one
  // validation + rate-limit path for everyone.
  const { getClientIP } = require('../utils/helpers.js');
  const SPOT_SUBMIT_WINDOW_MS = 60 * 1000;
  const SPOT_SUBMIT_MAX_PER_WINDOW = 3; // per client IP — humans don't spot faster
  const spotSubmitTimesByIp = new Map();

  setInterval(
    () => {
      const cutoff = Date.now() - SPOT_SUBMIT_WINDOW_MS;
      for (const [ip, times] of spotSubmitTimesByIp) {
        const fresh = times.filter((t) => t > cutoff);
        if (fresh.length === 0) spotSubmitTimesByIp.delete(ip);
        else spotSubmitTimesByIp.set(ip, fresh);
      }
    },
    5 * 60 * 1000,
  ).unref();

  app.post('/api/dxcluster/spot', async (req, res) => {
    if (!OHC_CLUSTER_URL) {
      return res.status(503).json({ error: 'OpenHamClock Cluster is not configured on this instance' });
    }

    const ip = getClientIP(req);
    const now = Date.now();
    const times = (spotSubmitTimesByIp.get(ip) || []).filter((t) => now - t < SPOT_SUBMIT_WINDOW_MS);
    if (times.length >= SPOT_SUBMIT_MAX_PER_WINDOW) {
      return res.status(429).json({ error: 'Easy there — max 3 spots per minute' });
    }

    const spotter = String(req.body?.spotter || '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .trim()
      .toUpperCase();
    const call = String(req.body?.call || '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .trim()
      .toUpperCase();
    const freqKhz = parseFloat(req.body?.freqKhz);
    const comment = String(req.body?.comment || '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .trim()
      .slice(0, 60);

    if (!isValidCallsign(spotter) || spotter.startsWith('N0CALL')) {
      return res.status(400).json({ error: 'Set your own valid callsign in Settings before spotting' });
    }
    if (!isValidCallsign(call)) {
      return res.status(400).json({ error: `"${call}" does not look like a valid callsign` });
    }
    if (!Number.isFinite(freqKhz) || freqKhz < 100 || freqKhz > 1300000) {
      return res.status(400).json({ error: 'Frequency out of range (kHz expected)' });
    }

    times.push(now);
    spotSubmitTimesByIp.set(ip, times);

    try {
      const response = await fetch(`${OHC_CLUSTER_URL}/api/dxcluster/spot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        body: JSON.stringify({ spotter, call, freqKhz, comment }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res
          .status(response.status === 429 ? 429 : 502)
          .json({ error: body.error || 'Cluster rejected the spot' });
      }
      logInfo(`[DX Cluster] ${spotter} spotted ${call} on ${freqKhz} kHz via web UI`);
      res.status(201).json({ ok: true, spot: body.spot || { call, freqKhz } });
    } catch (err) {
      logErrorOnce('DX Cluster', `Spot relay failed: ${err.message}`);
      res.status(502).json({ error: 'Could not reach the cluster — try again shortly' });
    }
  });

  // Get available DX cluster sources
  app.get('/api/dxcluster/sources', (req, res) => {
    if (IS_HOSTED) {
      // Hosted site: one source, no choices. Run your own instance for more.
      return res.json([
        {
          id: 'ohc',
          name: 'OpenHamClock Cluster',
          description: 'Our own cluster node — the only source on the hosted site',
        },
      ]);
    }
    res.json([
      {
        id: 'auto',
        name: 'Auto (Best Available)',
        description: OHC_CLUSTER_URL
          ? 'Tries OHC Cluster first, then Proxy, then HamQTH'
          : 'Tries Proxy first, then HamQTH',
      },
      // Our own node — only offered once OHC_CLUSTER_URL is configured
      ...(OHC_CLUSTER_URL
        ? [
            {
              id: 'ohc',
              name: 'OpenHamClock Cluster ⭐',
              description: 'Our own cluster node — RBN skimmers, human spots, and OHC user spots',
            },
          ]
        : []),
      {
        id: 'proxy',
        name: 'DX Spider Proxy ⭐',
        description: 'Our dedicated proxy service - real-time telnet feed via HTTP',
      },
      {
        id: 'hamqth',
        name: 'HamQTH',
        description: 'HamQTH.com CSV feed (HTTP, works everywhere)',
      },
      {
        id: 'dxspider',
        name: 'DX Spider Direct',
        description: 'Persistent telnet session to dxspider.co.uk (G6NHU) - works locally/Pi, requires your callsign',
      },
    ]);
  });

  // ============================================
  // DX SPOT PATHS API - Get spots with locations for map visualization
  // Returns spots from the last 5 minutes with spotter and DX locations
  // ============================================

  // Cache for DX spot paths to avoid excessive lookups (per source/profile)
  const dxSpotPathsCacheByKey = new Map();
  const DXPATHS_CACHE_TTL = 25000; // 25 seconds cache (just under 30s poll interval to maximize cache hits)
  const DXPATHS_RETENTION = 60 * 60 * 1000; // 60 min — deep enough that mode filters (SSB-only) have real history
  // DXpedition-tagged paths get longer retention and are exempt from display
  // caps: under RBN skimmer volume (OHC Cluster source) a newest-N window
  // spans only minutes, which starved the dxpeditionsOnly filter of the
  // handful of spots it exists to surface.
  const DXPEDITION_RETENTION = 2 * 60 * 60 * 1000;
  const isPathLive = (p, now) => now - p.timestamp < (p.isDXpedition ? DXPEDITION_RETENTION : DXPATHS_RETENTION);
  // Mode-balanced cap. A plain newest-N slice is almost pure FT8/FT4 skimmer
  // churn (freshest timestamps always), which starves the window of SSB
  // entirely — SSB only exists as human spots, and RBN can't decode phone.
  // RBN comments always lead with the mode ("FT8 -13 dB", "CW 26 dB 22 WPM"),
  // so a spot without a mode marker is human traffic and gets the reserve.
  const balancePathsByMode = (paths, limit) => {
    if (paths.length <= limit) return paths;
    const voice = [];
    const ft8ft4 = [];
    const other = [];
    for (const p of paths) {
      const c = String(p.comment || '').toUpperCase();
      if (/\bFT[84]\b/.test(c)) ft8ft4.push(p);
      else if (/\b(CW|RTTY|PSK)/.test(c)) other.push(p);
      else voice.push(p); // voice keywords or no mode marker — human spots
    }
    const out = voice.slice(0, Math.ceil(limit * 0.25));
    out.push(...ft8ft4.slice(0, Math.min(Math.ceil(limit * 0.5), limit - out.length)));
    out.push(...other.slice(0, limit - out.length));
    if (out.length < limit) {
      const chosen = new Set(out);
      for (const p of paths) {
        if (out.length >= limit) break;
        if (!chosen.has(p)) out.push(p);
      }
    }
    return out;
  };
  const capWithDXpeditions = (paths, limit) => {
    const dxpeditions = paths.filter((p) => p.isDXpedition);
    const regular = balancePathsByMode(
      paths.filter((p) => !p.isDXpedition),
      limit,
    );
    return [...dxpeditions, ...regular].sort((a, b) => b.timestamp - a.timestamp);
  };
  const DXPATHS_MAX_KEYS = 100; // Hard cap on cache keys

  // Periodic cleanup: purge stale dxSpotPaths entries every 5 minutes
  setInterval(
    () => {
      const now = Date.now();
      let purged = 0;
      for (const [key, cache] of dxSpotPathsCacheByKey) {
        // Remove entries that haven't been refreshed in 10 minutes
        if (cache.timestamp && now - cache.timestamp > 10 * 60 * 1000) {
          dxSpotPathsCacheByKey.delete(key);
          purged++;
        }
      }
      // Hard cap: evict oldest if over limit
      if (dxSpotPathsCacheByKey.size > DXPATHS_MAX_KEYS) {
        const sorted = [...dxSpotPathsCacheByKey.entries()].sort(
          (a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0),
        );
        const toRemove = sorted.slice(0, dxSpotPathsCacheByKey.size - DXPATHS_MAX_KEYS);
        for (const [key] of toRemove) {
          dxSpotPathsCacheByKey.delete(key);
          purged++;
        }
      }
      if (purged > 0)
        console.log(`[Cache] DX Paths: purged ${purged} stale entries, ${dxSpotPathsCacheByKey.size} remaining`);
    },
    5 * 60 * 1000,
  );

  function getDxPathsCache(cacheKey) {
    if (!dxSpotPathsCacheByKey.has(cacheKey)) {
      dxSpotPathsCacheByKey.set(cacheKey, {
        paths: [],
        allPaths: [],
        timestamp: 0,
      });
    }
    return dxSpotPathsCacheByKey.get(cacheKey);
  }

  // Parse spot time "HH:MMz" as UTC timestamp (today, or yesterday if in the future).
  function parseSpotHHMMzToTimestamp(timeStr, fallbackTs = Date.now()) {
    if (!timeStr || typeof timeStr !== 'string') return fallbackTs;
    const m = timeStr.trim().match(/^(\d{2}):(\d{2})z$/i);
    if (!m) return fallbackTs;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return fallbackTs;

    const now = new Date();
    const ts = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0, 0);
    // If parsed time is slightly ahead of now, assume it belongs to previous UTC day.
    if (ts - Date.now() > 5 * 60 * 1000) {
      return ts - 24 * 60 * 60 * 1000;
    }
    return ts;
  }

  const DXUDP_SESSION_MAX_AGE = 15 * 60 * 1000;
  const DXUDP_SPOT_MAX_AGE = 60 * 60 * 1000;
  const DXUDP_MAX_SESSIONS = 20;
  const DXUDP_MAX_SPOTS = 500;
  const dxUdpSessions = new Map();

  function toHHMMz(ts) {
    const d = new Date(Number.isFinite(ts) ? ts : Date.now());
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}z`;
  }

  function parseFreqToMHz(value) {
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v <= 0) return null;
    if (v >= 1000000) return v / 1000000;
    if (v >= 30000) return v / 1000;
    return v;
  }

  function maybeExtractGrid(value) {
    if (!value || typeof value !== 'string') return null;
    const m = value
      .trim()
      .toUpperCase()
      .match(/\b([A-R]{2}\d{2}(?:[A-X]{2})?)\b/);
    return m ? m[1] : null;
  }

  function parseTimestampValue(value, fallbackTs) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    const str = String(value || '').trim();
    if (!str) return fallbackTs;
    if (/^\d{2}:\d{2}z$/i.test(str)) return parseSpotHHMMzToTimestamp(str, fallbackTs);

    const hhmm = str.match(/^(\d{2})(\d{2})z?$/i);
    if (hhmm) return parseSpotHHMMzToTimestamp(`${hhmm[1]}:${hhmm[2]}z`, fallbackTs);

    const hhmmss = str.match(/^(\d{2})(\d{2})(\d{2})z?$/i);
    if (hhmmss) return parseSpotHHMMzToTimestamp(`${hhmmss[1]}:${hhmmss[2]}z`, fallbackTs);

    // Some spot feeds emit ISO timestamps without timezone (e.g. 2026-03-17T11:53:00).
    // Treat these as UTC to avoid local-time offset skew in Zulu display and age math.
    const isoNoZone = str.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (isoNoZone) {
      const year = parseInt(isoNoZone[1], 10);
      const month = parseInt(isoNoZone[2], 10);
      const day = parseInt(isoNoZone[3], 10);
      const hour = parseInt(isoNoZone[4], 10);
      const minute = parseInt(isoNoZone[5], 10);
      const second = parseInt(isoNoZone[6] || '0', 10);
      const ms = parseInt((isoNoZone[7] || '0').padEnd(3, '0'), 10);

      const parsedUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
      return Number.isFinite(parsedUtc) ? parsedUtc : fallbackTs;
    }

    const parsed = Date.parse(str);
    return Number.isFinite(parsed) ? parsed : fallbackTs;
  }

  function normalizeUdpCallsign(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[<>]/g, '')
      .replace(/-?#$/, '');
  }

  function hasExplicitTimezoneHint(value) {
    const str = String(value || '').trim();
    if (!str) return false;
    if (/z$/i.test(str)) return true;
    if (/[+-]\d{2}:?\d{2}$/.test(str)) return true;
    if (/\b(?:utc|gmt)\b/i.test(str)) return true;
    return false;
  }

  function normalizeUdpSpotCandidate(candidate, fallbackTs = Date.now()) {
    if (!candidate || typeof candidate !== 'object') return null;

    const spotter = normalizeUdpCallsign(candidate.spotter || candidate.de || candidate.sourceCall || '');
    const dxCall = normalizeUdpCallsign(candidate.dxCall || candidate.call || candidate.callsign || '');
    const freqMHz = parseFreqToMHz(candidate.freqMHz ?? candidate.freq ?? candidate.frequency);
    if (!spotter || !dxCall || !Number.isFinite(freqMHz)) return null;

    const rawTimestamp = candidate.timestamp ?? candidate.time;
    let timestamp = parseTimestampValue(rawTimestamp, fallbackTs);
    // Many local UDP feeds provide timezone-less times; if the parsed value is far off,
    // use receive time so "minutes ago" and displayed Z time reflect current spots.
    if (!hasExplicitTimezoneHint(rawTimestamp) && Math.abs(timestamp - fallbackTs) > 2 * 60 * 60 * 1000) {
      timestamp = fallbackTs;
    }
    const comment = String(candidate.comment || candidate.info || candidate.text || candidate.remarks || '').trim();
    const dxGrid = maybeExtractGrid(candidate.dxGrid || candidate.grid || comment);
    const spotterGrid = maybeExtractGrid(candidate.spotterGrid);

    return {
      spotter,
      dxCall,
      freq: freqMHz.toFixed(3),
      comment,
      time: toHHMMz(timestamp),
      timestamp,
      dxGrid,
      spotterGrid,
      id: `${dxCall}-${freqMHz.toFixed(3)}-${spotter}-${timestamp}`,
    };
  }

  function extractXmlTag(xml, tagName) {
    const match = String(xml || '').match(new RegExp(`<${tagName}>([^<]*)</${tagName}>`, 'i'));
    return match ? match[1].trim() : '';
  }

  function parseMacLoggerDxXmlSpot(xml, fallbackTs) {
    if (!/<spot>/i.test(xml)) return null;

    const action = extractXmlTag(xml, 'action').toLowerCase();
    if (action && action !== 'add') return null;

    return normalizeUdpSpotCandidate(
      {
        dxCall: extractXmlTag(xml, 'dxcall'),
        frequency: extractXmlTag(xml, 'frequency'),
        spotter: extractXmlTag(xml, 'spottercall'),
        comment: extractXmlTag(xml, 'comment'),
        timestamp: extractXmlTag(xml, 'timestamp'),
      },
      fallbackTs,
    );
  }

  function parseUdpSpotPayload(payload, fallbackTs = Date.now()) {
    const text = String(payload || '').trim();
    if (!text) return [];

    try {
      const parsedJson = JSON.parse(text);
      const arr = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      return arr.map((item) => normalizeUdpSpotCandidate(item, fallbackTs)).filter(Boolean);
    } catch {}

    if (
      text.startsWith('<?xml') ||
      text.startsWith('<spot') ||
      text.startsWith('<RadioInfo') ||
      (text.startsWith('<') && text.includes('>'))
    ) {
      // Try the narrow MacLoggerDX parser first (standard <spottercall>/<dxcall> tags)
      if (text.startsWith('<?xml') || text.startsWith('<spot') || text.startsWith('<RadioInfo')) {
        const xmlSpot = parseMacLoggerDxXmlSpot(text, fallbackTs);
        if (xmlSpot) return [xmlSpot];
        // <RadioInfo> packets are intentionally not spots — skip generic fallback
        if (text.startsWith('<RadioInfo')) return [];
      }

      // Generic XML fallback — handles broader tag name variants (e.g. MLDX <StationName>)
      const readTag = (tagNames) => {
        for (const tagName of tagNames) {
          const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const m = text.match(new RegExp(`<${escaped}[^>]*>\\s*([^<]+?)\\s*<\\/${escaped}>`, 'i'));
          if (m && m[1]) return m[1].trim();
        }
        return '';
      };

      const xmlSpot = normalizeUdpSpotCandidate(
        {
          spotter: readTag([
            'spotter',
            'spottercall',
            'spottercallsign',
            'de',
            'decall',
            'sourcecall',
            'sourcecallsign',
            'stationprefix',
            'mycall',
            'operator',
            'opcall',
            'sender',
            'stationname',
            'station_name',
            'station',
          ]),
          dxCall: readTag(['dxcall', 'call', 'callsign', 'dxcallsign', 'workedcall', 'targetcall']),
          freq: readTag(['freq', 'frequency', 'frequencykhz', 'freqkhz', 'mhz', 'rxfreq', 'txfreq', 'spotfreq']),
          comment: readTag(['comment', 'info', 'text', 'remarks', 'message', 'notes']),
          time: readTag(['time', 'timestamp', 'spottime', 'utc', 'utctime']),
          dxGrid: readTag(['dxgrid', 'grid', 'gridsquare', 'dxgridsquare']),
          spotterGrid: readTag(['spottergrid', 'mygrid', 'degrid', 'mygridsquare']),
        },
        fallbackTs,
      );

      if (xmlSpot) return [xmlSpot];
    }

    // ADIF-style payloads used by some logger integrations
    // Example fragments: <CALL:5>W1AW <FREQ:6>14.074 <STATION_CALLSIGN:5>K1ABC
    if (text.includes('<') && text.includes(':') && !text.includes('</')) {
      const adifFields = {};
      const adifRegex = /<([A-Z0-9_]+)(?::\d+)?>([^<]*)/gi;
      let m;
      while ((m = adifRegex.exec(text)) !== null) {
        const key = String(m[1] || '').toUpperCase();
        const val = String(m[2] || '').trim();
        if (key && val) adifFields[key] = val;
      }

      if (Object.keys(adifFields).length > 0) {
        const adifSpot = normalizeUdpSpotCandidate(
          {
            spotter:
              adifFields.STATION_CALLSIGN ||
              adifFields.OPERATOR ||
              adifFields.MYCALL ||
              adifFields.DE ||
              adifFields.SPOTTER ||
              '',
            dxCall: adifFields.DXCALL || adifFields.CALL || adifFields.CALLSIGN || '',
            freq:
              adifFields.FREQ ||
              adifFields.FREQUENCY ||
              adifFields.RXFREQ ||
              adifFields.TXFREQ ||
              adifFields.BAND_RX ||
              '',
            comment: adifFields.COMMENT || adifFields.NOTES || adifFields.REMARKS || '',
            time: adifFields.TIME_ON || adifFields.TIME || adifFields.TIMESTAMP || '',
            dxGrid: adifFields.GRIDSQUARE || adifFields.MY_GRIDSQUARE || '',
          },
          fallbackTs,
        );

        if (adifSpot) return [adifSpot];
      }
    }

    const dxDe = text.match(/^DX\s+de\s+([A-Z0-9\/-]+)[^:]*:\s*([0-9.]+)\s+([A-Z0-9\/-]+)\s*(.*?)\s*(\d{4}Z?)?\s*$/i);
    if (dxDe) {
      const [, spotter, freq, dxCall, rawComment, hhmm] = dxDe;
      const comment = (rawComment || '')
        .trim()
        .replace(/\s+\d{4}Z?$/i, '')
        .trim();
      return [
        normalizeUdpSpotCandidate({ spotter, dxCall, freq, comment, time: hhmm || undefined }, fallbackTs),
      ].filter(Boolean);
    }

    if (text.includes('^')) {
      const parts = text.split('^');
      if (parts.length >= 3) {
        return [
          normalizeUdpSpotCandidate(
            { spotter: parts[0], freq: parts[1], dxCall: parts[2], comment: parts[3] || '', time: parts[4] || '' },
            fallbackTs,
          ),
        ].filter(Boolean);
      }
    }

    if (/[;,\t]/.test(text)) {
      const delim = text.includes(';') ? ';' : text.includes('\t') ? '\t' : ',';
      const parts = text.split(delim).map((p) => p.trim());
      if (parts.length >= 3) {
        return [
          normalizeUdpSpotCandidate(
            { spotter: parts[0], freq: parts[1], dxCall: parts[2], comment: parts[3] || '', time: parts[4] || '' },
            fallbackTs,
          ),
        ].filter(Boolean);
      }
    }

    return [];
  }

  function isMulticastHost(host) {
    if (!host) return false;
    const ipVersion = net.isIP(host);
    if (ipVersion === 4) {
      const firstOctet = parseInt(host.split('.')[0], 10);
      return firstOctet >= 224 && firstOctet <= 239;
    }
    if (ipVersion === 6) {
      return host.toLowerCase().startsWith('ff');
    }
    return false;
  }

  function isBroadcastHost(host) {
    if (!host || net.isIP(host) !== 4) return false;
    if (host === '255.255.255.255') return true;
    const octets = host.split('.');
    return octets.length === 4 && octets[3] === '255';
  }

  function getOrCreateDxUdpSession(host, port) {
    const normalizedHost = String(host || '').trim();
    // Directed/global broadcast addresses are destination targets, not sender IDs.
    // Use wildcard listener session so we don't split packets across duplicate binds.
    const effectiveHost = isBroadcastHost(normalizedHost) ? '' : normalizedHost;
    const normalizedPort = Number.isFinite(port) ? port : 12060;
    const key = `${effectiveHost || 'any'}:${normalizedPort}`;
    const existing = dxUdpSessions.get(key);
    if (existing) {
      existing.lastAccess = Date.now();
      return existing;
    }

    if (dxUdpSessions.size >= DXUDP_MAX_SESSIONS) {
      const oldest = [...dxUdpSessions.entries()].sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0))[0];
      if (oldest) {
        try {
          oldest[1].socket?.close();
        } catch {}
        dxUdpSessions.delete(oldest[0]);
      }
    }

    const session = {
      key,
      host: effectiveHost,
      port: normalizedPort,
      socket: dgram.createSocket({ type: 'udp4', reuseAddr: true }),
      spots: [],
      started: false,
      lastAccess: Date.now(),
      packetCount: 0,
      parsedCount: 0,
      droppedCount: 0,
      parseMissCount: 0,
      lastPacketAt: 0,
      lastPacketFrom: null,
      lastPacketPreview: '',
      lastParseMissPreview: '',
    };

    session.socket.on('message', (buf, rinfo) => {
      session.packetCount += 1;
      session.lastPacketAt = Date.now();
      session.lastPacketFrom = rinfo?.address ? `${rinfo.address}:${rinfo.port || ''}` : null;
      session.lastPacketPreview = buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 160);

      if (
        session.host &&
        !isMulticastHost(session.host) &&
        !isBroadcastHost(session.host) &&
        rinfo?.address &&
        rinfo.address !== session.host
      ) {
        session.droppedCount += 1;
        return;
      }

      const now = Date.now();
      const parsed = parseUdpSpotPayload(buf.toString('utf8'), now);
      if (!parsed.length) {
        session.parseMissCount += 1;
        session.lastParseMissPreview = session.lastPacketPreview;
        return;
      }

      session.parsedCount += parsed.length;

      session.spots.push(...parsed);
      session.spots = session.spots
        .filter((s) => now - (s.timestamp || now) <= DXUDP_SPOT_MAX_AGE)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, DXUDP_MAX_SPOTS);
    });

    session.socket.on('error', (err) => {
      logErrorOnce('DX UDP', `${session.host || 'any'}:${session.port} ${err.message}`);
    });

    session.socket.on('listening', () => {
      session.started = true;
      try {
        if (isMulticastHost(session.host)) {
          session.socket.addMembership(session.host);
        }
      } catch (err) {
        logErrorOnce('DX UDP', `Multicast ${session.host}:${session.port} ${err.message}`);
      }
    });

    session.socket.bind(session.port, '0.0.0.0');
    dxUdpSessions.set(key, session);
    return session;
  }

  app.get('/api/dxcluster/udp-status', (req, res) => {
    const now = Date.now();
    const sessions = [...dxUdpSessions.values()].map((s) => ({
      key: s.key,
      host: s.host || '',
      port: s.port,
      started: !!s.started,
      activeSpotCount: (s.spots || []).length,
      packetCount: s.packetCount || 0,
      parsedCount: s.parsedCount || 0,
      droppedCount: s.droppedCount || 0,
      parseMissCount: s.parseMissCount || 0,
      lastPacketAt: s.lastPacketAt || 0,
      lastPacketAgeMs: s.lastPacketAt ? now - s.lastPacketAt : null,
      lastPacketFrom: s.lastPacketFrom || null,
      lastPacketPreview: s.lastPacketPreview || '',
      lastParseMissPreview: s.lastParseMissPreview || '',
      lastAccess: s.lastAccess || 0,
      lastAccessAgeMs: s.lastAccess ? now - s.lastAccess : null,
    }));

    res.json({ now, sessionCount: sessions.length, sessions });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [key, session] of dxUdpSessions.entries()) {
      session.spots = (session.spots || []).filter((s) => now - (s.timestamp || now) <= DXUDP_SPOT_MAX_AGE);
      if (now - (session.lastAccess || 0) > DXUDP_SESSION_MAX_AGE) {
        try {
          session.socket?.close();
        } catch {}
        dxUdpSessions.delete(key);
      }
    }
  }, 60 * 1000);

  app.get('/api/dxcluster/paths', async (req, res) => {
    // Parse query parameters for custom cluster settings
    let source = req.query.source || 'auto';

    // Hosted instances never open user-directed connections (custom telnet /
    // UDP) — many users, one egress IP, zero tolerance after the NC7J mess.
    if (IS_HOSTED && (source === 'custom' || source === 'udp')) {
      return res.status(400).json({
        error: 'The hosted site uses the OpenHamClock Cluster only. Run your own OpenHamClock to use a custom cluster.',
      });
    }
    if (IS_HOSTED) source = 'auto'; // auto = our cluster first
    const customHost = (req.query.host || CONFIG.dxClusterHost || '').trim();
    const parsedPort = parseInt(req.query.port, 10);
    const customPort = Number.isFinite(parsedPort) ? parsedPort : CONFIG.dxClusterPort;
    const udpHost = (req.query.udpHost || CONFIG.dxUdpHost || '').trim();
    const parsedUdpPort = parseInt(req.query.udpPort, 10);
    const udpPort = Number.isFinite(parsedUdpPort) ? parsedUdpPort : CONFIG.dxUdpPort;
    const userCallsign = (req.query.callsign || CONFIG.dxClusterCallsign || '').trim();

    // SECURITY: Validate custom host to prevent SSRF (internal network scanning)
    // Resolves DNS and returns the validated IP. We connect to the IP, not the hostname,
    // to prevent DNS rebinding (TOCTOU) where the record changes between validation and connect.
    let resolvedHost = customHost;
    if (source === 'custom' && customHost) {
      const hostCheck = await validateCustomHost(customHost);
      if (!hostCheck.ok) {
        return res.status(400).json({ error: `Custom host rejected: ${hostCheck.reason}` });
      }
      resolvedHost = hostCheck.resolvedIP; // Connect to the validated IP, not the hostname
      // Basic port range sanity check
      if (customPort < 1 || customPort > 65535) {
        return res.status(400).json({ error: 'Port must be between 1 and 65535' });
      }
      // GOOD-NEIGHBOUR POLICY: connecting to someone else's cluster node
      // requires the USER's own valid callsign. No GUEST, no shared default —
      // sysops must see who is actually connecting (the NC7J lesson).
      const loginCallsign = getDxClusterLoginCallsign(userCallsign, false);
      if (!isValidCallsign(loginCallsign)) {
        return res.status(400).json({
          error:
            'Custom DX cluster requires your own valid callsign. Set your callsign in DX Cluster settings before connecting.',
        });
      }
    }

    if (source === 'udp') {
      if (udpHost && !net.isIP(udpHost)) {
        return res.status(400).json({ error: 'UDP host must be a valid IPv4/IPv6 address (or blank)' });
      }
      if (udpPort < 1 || udpPort > 65535) {
        return res.status(400).json({ error: 'UDP port must be between 1 and 65535' });
      }
    }

    // Generate cache key based on source profile so custom/proxy/auto don't mix.
    const cacheKey =
      source === 'custom'
        ? `custom-${resolvedHost}-${customPort}-${getDxClusterLoginCallsign(userCallsign, false)}`
        : source === 'udp'
          ? `udp-${udpHost || 'any'}-${udpPort}`
          : `source-${source}`;
    const pathsCache = getDxPathsCache(cacheKey);

    // Check cache first (but not for custom sources - they might have different data)
    if (
      source !== 'custom' &&
      source !== 'udp' &&
      Date.now() - pathsCache.timestamp < DXPATHS_CACHE_TTL &&
      pathsCache.paths.length > 0
    ) {
      logDebug('[DX Paths] Returning', pathsCache.paths.length, 'cached paths');
      return res.json(pathsCache.paths);
    }

    try {
      const now = Date.now();

      // Try proxy first for better real-time data
      let newSpots = [];
      let usedSource = 'none';

      if (source === 'udp') {
        const udpSession = getOrCreateDxUdpSession(udpHost, udpPort);
        udpSession.lastAccess = now;
        const ownCall = String(CONFIG.callsign || '')
          .toUpperCase()
          .split(/[-/]/)[0];
        newSpots = (udpSession.spots || []).slice(0, 100).map((s) => {
          // Only assume the spot originated here when the UDP payload's spotter is our own call.
          // Otherwise the downstream HamQTH/prefix lookups locate the real spotter — falling back
          // to CONFIG.gridSquare draws every line back to the user's home station (#961).
          const spotterBase = String(s.spotter || '')
            .toUpperCase()
            .split(/[-/]/)[0];
          const isSelfSpot = ownCall && spotterBase && spotterBase === ownCall;
          return {
            spotter: s.spotter,
            spotterGrid: s.spotterGrid || (isSelfSpot ? CONFIG.gridSquare || null : null),
            dxCall: s.dxCall,
            dxGrid: s.dxGrid || null,
            freq: s.freq,
            comment: s.comment || '',
            time: s.time || toHHMMz(s.timestamp),
            timestamp: s.timestamp || now,
            id: s.id || `${s.dxCall}-${s.freq}-${s.spotter}-${s.timestamp || now}`,
          };
        });
        usedSource = 'udp';
        if (newSpots.length > 0) {
          logDebug('[DX Paths] Got', newSpots.length, 'spots from UDP');
        }
      }

      // Handle custom telnet source (persistent connection, no reconnect-per-poll)
      if (source === 'custom' && !resolvedHost) {
        logDebug('[DX Paths] Custom source selected but no host provided — check DX Cluster settings');
      }
      if (newSpots.length === 0 && source === 'custom' && resolvedHost) {
        logDebug(
          `[DX Paths] Using custom telnet session: ${resolvedHost}:${customPort} as ${getDxClusterLoginCallsign(userCallsign, false)}`,
        );
        const customNode = { host: resolvedHost, port: customPort };
        const session = getOrCreateCustomSession(customNode, userCallsign);
        // Take the most recent spots from persistent session buffer. (session is
        // null only if the callsign guard trips — already validated above.)
        const customSpots = (session?.spots || []).slice(0, 100).map((s) => ({
          spotter: s.spotter,
          call: s.call,
          freq: s.freq,
          comment: s.comment || '',
          time: s.time || '',
          timestamp: s.timestampMs || Date.now(),
        }));

        if (customSpots && customSpots.length > 0) {
          usedSource = 'custom';
          newSpots = customSpots.map((s) => ({
            spotter: s.spotter,
            spotterGrid: null,
            dxCall: s.call,
            dxGrid: null,
            freq: s.freq,
            comment: s.comment || '',
            time: s.time || '',
            id: `${s.call}-${s.freq}-${s.spotter}`,
          }));
          logDebug('[DX Paths] Got', newSpots.length, 'spots from custom telnet');
        } else {
          logDebug('[DX Paths] Custom session active but no spots yet');
        }
      }

      // Our own cluster node first (when deployed) — RBN skimmers + human spots
      if (newSpots.length === 0 && source !== 'custom' && source !== 'udp' && OHC_CLUSTER_URL) {
        const ohcController = new AbortController();
        const ohcTimeout = setTimeout(() => ohcController.abort(), 10000);
        try {
          const ohcResponse = await fetch(`${OHC_CLUSTER_URL}/api/dxcluster/spots?limit=150`, {
            headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
            signal: ohcController.signal,
          });
          if (ohcResponse.ok) {
            const ohcSpots = await ohcResponse.json();
            if (Array.isArray(ohcSpots) && ohcSpots.length > 0) {
              usedSource = 'ohc';
              newSpots = ohcSpots.map((s) => ({
                // Strip the RBN skimmer marker (-#) so spotter location lookups
                // resolve the underlying callsign.
                spotter: String(s.spotter || '').replace(/-#$/, ''),
                spotterGrid: s.spotterGrid || null,
                dxCall: s.call,
                dxGrid: s.dxGrid || null,
                freq: s.freq,
                comment: s.comment || '',
                time: s.time || '',
                timestamp: s.timestamp || Date.now(),
                id: `${s.call}-${s.freqKhz || s.freq}-${s.spotter}`,
              }));
              logDebug('[DX Paths] Got', newSpots.length, 'spots from OHC Cluster');
            }
          }
        } catch (ohcErr) {
          logDebug('[DX Paths] OHC Cluster failed, trying proxy');
        } finally {
          clearTimeout(ohcTimeout);
        }
      }

      // Try proxy if not using custom or custom failed
      if (newSpots.length === 0 && source !== 'custom' && source !== 'udp') {
        // Each upstream gets its OWN AbortController. A shared controller meant a
        // proxy timeout left the signal pre-aborted, so the HamQTH fallback below
        // rejected instantly with AbortError and never actually ran.
        const proxyController = new AbortController();
        const proxyTimeout = setTimeout(() => proxyController.abort(), 10000);
        try {
          const proxyResponse = await fetch(`${DXSPIDER_PROXY_URL}/api/spots?limit=100`, {
            headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
            signal: proxyController.signal,
          });

          if (proxyResponse.ok) {
            const proxyData = await proxyResponse.json();
            if (proxyData.spots && proxyData.spots.length > 0) {
              usedSource = 'proxy';
              newSpots = proxyData.spots.map((s) => ({
                spotter: s.spotter,
                spotterGrid: s.spotterGrid || null,
                dxCall: s.call,
                dxGrid: s.dxGrid || null,
                freq: s.freq,
                comment: s.comment || '',
                time: s.time || '',
                timestamp: s.timestamp || Date.now(),
                id: `${s.call}-${s.freqKhz || s.freq}-${s.spotter}`,
              }));
              logDebug('[DX Paths] Got', newSpots.length, 'spots from proxy');
            }
          }
        } catch (proxyErr) {
          logDebug('[DX Paths] Proxy failed, trying HamQTH');
        } finally {
          clearTimeout(proxyTimeout);
        }
      }

      // Fallback to HamQTH if proxy failed (never for explicit custom source)
      if (newSpots.length === 0 && source !== 'custom' && source !== 'udp') {
        const hamqthController = new AbortController();
        const hamqthTimeout = setTimeout(() => hamqthController.abort(), 10000);
        try {
          const response = await fetch('https://www.hamqth.com/dxc_csv.php?limit=50', {
            headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
            signal: hamqthController.signal,
          });

          if (response.ok) {
            const text = await response.text();
            const lines = text
              .trim()
              .split('\n')
              .filter((line) => line.includes('^'));
            usedSource = 'hamqth';

            for (const line of lines) {
              const parts = line.split('^');
              if (parts.length < 5) continue;

              const spotter = parts[0]?.trim().toUpperCase();
              const freqKhz = parseFloat(parts[1]) || 0;
              const dxCall = parts[2]?.trim().toUpperCase();
              const comment = parts[3]?.trim() || '';
              const timeDate = parts[4]?.trim() || '';
              const hhmm = timeDate.substring(0, 4);
              const datePart = (timeDate.split(' ')[1] || '').trim();
              let spotTimestamp = Date.now();
              if (/^\d{4}$/.test(hhmm) && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
                const hh = parseInt(hhmm.substring(0, 2), 10);
                const mm = parseInt(hhmm.substring(2, 4), 10);
                const iso = `${datePart}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`;
                const parsed = Date.parse(iso);
                if (Number.isFinite(parsed)) spotTimestamp = parsed;
              }

              if (!spotter || !dxCall || freqKhz <= 0) continue;

              // Extract grids from comment for HamQTH data too
              const grids = extractGridsFromComment(comment);

              newSpots.push({
                spotter,
                spotterGrid: grids.spotterGrid,
                dxCall,
                dxGrid: grids.dxGrid,
                freq: (freqKhz / 1000).toFixed(3),
                comment,
                time: timeDate.length >= 4 ? timeDate.substring(0, 2) + ':' + timeDate.substring(2, 4) + 'z' : '',
                timestamp: spotTimestamp,
                id: `${dxCall}-${freqKhz}-${spotter}`,
              });
            }
            logDebug('[DX Paths] Got', newSpots.length, 'spots from HamQTH');
          }
        } catch (hamqthErr) {
          logDebug('[DX Paths] HamQTH also failed');
        } finally {
          clearTimeout(hamqthTimeout);
        }
      }

      if (newSpots.length === 0) {
        // Return existing paths if fetch failed
        const validPaths = pathsCache.allPaths.filter((p) => isPathLive(p, now));
        return res.json(capWithDXpeditions(validPaths, 150));
      }

      // Get unique callsigns to look up (sanitize and strip modifiers)
      // For QRZ/HamQTH: use home callsign (W9WI from PJ2/W9WI) to get licensee data
      // For prefix/location: use operating prefix (PJ2 from PJ2/W9WI) to get DXCC entity
      const allCalls = new Set();
      const baseCallMap = {}; // raw → home callsign (for QRZ lookups)
      const prefixCallMap = {}; // raw → operating prefix (for location/DXCC)
      newSpots.forEach((s) => {
        const spotter = (s.spotter || '').replace(/[<>]/g, '').trim();
        const dxCall = (s.dxCall || '').replace(/[<>]/g, '').trim();
        if (spotter) {
          const base = extractBaseCallsign(spotter);
          const opPrefix = extractOperatingPrefix(spotter);
          allCalls.add(opPrefix);
          baseCallMap[spotter] = base;
          prefixCallMap[spotter] = opPrefix;
        }
        if (dxCall) {
          const base = extractBaseCallsign(dxCall);
          const opPrefix = extractOperatingPrefix(dxCall);
          allCalls.add(opPrefix);
          baseCallMap[dxCall] = base;
          prefixCallMap[dxCall] = opPrefix;
        }
      });

      // Look up prefix-based locations for all callsigns (includes grid squares!)
      // estimateLocationFromPrefix is a local CTY-table lookup — cheap enough
      // to run for every call in the batch. A 100-call cap here silently left
      // spots past it uncharted once fetches grew past 50 spots (the map
      // filters out paths with no spotter coordinates). The remote HamQTH
      // batch below has its own 10-per-cycle cap.
      const prefixLocations = {};
      const callsToLookup = [...allCalls].slice(0, 1000);

      for (const call of callsToLookup) {
        const loc = estimateLocationFromPrefix(call);
        if (loc) {
          prefixLocations[call] = {
            lat: loc.lat,
            lon: loc.lon,
            country: loc.country,
            grid: loc.grid || null, // Include grid from prefix mapping!
            source: loc.grid ? 'prefix-grid' : 'prefix',
          };
        }
      }

      // Check HamQTH callsign cache for better accuracy (24h TTL, populated by /api/callsign/:call)
      // This gives DXCC-level lat/lon which is more accurate than prefix country centroids
      const hamqthLocations = {};
      const hamqthMisses = []; // Callsigns to look up in background
      for (const call of callsToLookup) {
        const cached = callsignLookupCache.get(call);
        if (cached && now - cached.timestamp < CALLSIGN_CACHE_TTL && cached.data?.lat != null) {
          hamqthLocations[call] = {
            lat: cached.data.lat,
            lon: cached.data.lon,
            country: cached.data.country || '',
            grid: cached.data.grid || null,
            source: 'hamqth-dxcc',
          };
        } else if (!prefixLocations[call]?.grid) {
          // Only queue lookups for calls that don't already have grid-level accuracy
          hamqthMisses.push(call);
        }
      }

      // Fire background HamQTH lookups for cache misses (non-blocking, improves next poll)
      // Limit to 10 per cycle to avoid hammering HamQTH
      if (hamqthMisses.length > 0) {
        const batch = hamqthMisses.slice(0, 10);
        logDebug('[DX Paths] Background HamQTH lookup for', batch.length, 'callsigns');
        for (const rawCall of batch) {
          // Sanitize and validate before hitting external API
          const call = rawCall.replace(/[<>]/g, '').trim();
          if (!call || !/^[A-Z0-9\/\-]{1,20}$/.test(call)) continue;

          // Fire-and-forget — results land in callsignLookupCache for next poll
          // TODO: Refactor lookup chain into callsign.js. Currently we duplicate the full
          // flow (cache check → HamQTH DXCC → prefix estimation) here instead of using
          // the shared hamqthLookup() + extractBaseCallsign() chain from callsign.js.
          hamqthLookup(call).then((result) => {
            if (result) {
              cacheCallsignLookup(call, { data: result, timestamp: Date.now() });
            }
          });
        }
      }

      // Build new paths with locations - try grid first, fall back to prefix
      const newPaths = newSpots
        .map((spot) => {
          // DX station location - try grid from spot data first, then comment, then prefix
          let dxLoc = null;
          let dxGridSquare = null;

          // Check if this is a known DXpedition FIRST — DXpedition entity
          // coordinates are authoritative. Cluster nodes often send wrong grids
          // (spotter's grid, cached home grid, etc.) which would place the
          // DXpedition in Jersey or Alaska instead of the actual operating location.
          const dxpedLoc = lookupDXpeditionLocation(spot.dxCall);
          if (dxpedLoc) {
            dxLoc = dxpedLoc;
          }

          // For non-DXpedition spots, use grid from proxy (most precise)
          if (!dxLoc && spot.dxGrid) {
            const gridLoc = maidenheadToLatLon(spot.dxGrid);
            if (gridLoc) {
              dxLoc = {
                lat: gridLoc.lat,
                lon: gridLoc.lon,
                country: '',
                source: 'grid',
              };
              dxGridSquare = spot.dxGrid;
            }
          }

          // Try extracting grid from comment
          if (!dxLoc && spot.comment) {
            const extractedGrids = extractGridsFromComment(spot.comment);
            if (extractedGrids.dxGrid) {
              const gridLoc = maidenheadToLatLon(extractedGrids.dxGrid);
              if (gridLoc) {
                dxLoc = {
                  lat: gridLoc.lat,
                  lon: gridLoc.lon,
                  country: '',
                  source: 'grid',
                };
                dxGridSquare = extractedGrids.dxGrid;
              }
            }
          }

          // Prefix/CTY.DAT location — shows where the station IS OPERATING,
          // which is what matters for the map. Must run before HamQTH which
          // returns the operator's HOME location (e.g. XX9W operator lives in
          // Greece but is operating from Macau).
          if (!dxLoc) {
            dxLoc = prefixLocations[prefixCallMap[spot.dxCall] || spot.dxCall];
            if (dxLoc && dxLoc.grid) {
              dxGridSquare = dxLoc.grid;
            }
          }

          // HamQTH cached location — only used as last resort for DX station,
          // since it returns the operator's home QTH, not the operating location.
          // Only use for compound calls where prefix resolution already ran
          // (e.g. PJ2/W9WI where prefix gave PJ2 location).
          if (!dxLoc && hamqthLocations[baseCallMap[spot.dxCall] || spot.dxCall]) {
            const homeCall = baseCallMap[spot.dxCall];
            dxLoc = hamqthLocations[homeCall || spot.dxCall];
          }

          // Spotter location - try grid first, then prefix
          let spotterLoc = null;
          let spotterGridSquare = null;

          // Fixed spotter coordinates override (for local skimmer setups)
          if (CONFIG.dxClusterSpotterLat != null && CONFIG.dxClusterSpotterLon != null) {
            spotterLoc = {
              lat: CONFIG.dxClusterSpotterLat,
              lon: CONFIG.dxClusterSpotterLon,
              country: '',
              source: 'env-fixed',
            };
          }

          // Check if spot already has spotterGrid from proxy
          if (spot.spotterGrid) {
            const gridLoc = maidenheadToLatLon(spot.spotterGrid);
            if (gridLoc) {
              spotterLoc = {
                lat: gridLoc.lat,
                lon: gridLoc.lon,
                country: '',
                source: 'grid',
              };
              spotterGridSquare = spot.spotterGrid;
            }
          }

          // If no grid yet, try extracting from comment (in case of dual grid format)
          if (!spotterLoc && spot.comment) {
            const extractedGrids = extractGridsFromComment(spot.comment);
            if (extractedGrids.spotterGrid) {
              const gridLoc = maidenheadToLatLon(extractedGrids.spotterGrid);
              if (gridLoc) {
                spotterLoc = {
                  lat: gridLoc.lat,
                  lon: gridLoc.lon,
                  country: '',
                  source: 'grid',
                };
                spotterGridSquare = extractedGrids.spotterGrid;
              }
            }
          }

          // Fall back to HamQTH cached location for spotter
          if (!spotterLoc && hamqthLocations[baseCallMap[spot.spotter] || spot.spotter]) {
            const opPrefix = prefixCallMap[spot.spotter];
            const homeCall = baseCallMap[spot.spotter];
            if (!opPrefix || opPrefix === homeCall) {
              spotterLoc = hamqthLocations[homeCall || spot.spotter];
            }
          }

          // Fall back to prefix location for spotter (now includes grid-based coordinates!)
          if (!spotterLoc) {
            spotterLoc = prefixLocations[prefixCallMap[spot.spotter] || spot.spotter];
            if (spotterLoc && spotterLoc.grid) {
              spotterGridSquare = spotterLoc.grid;
            }
          }

          // Keep spots even when coordinates are missing so the list view can still show them.
          // World map rendering already filters to entries with valid coordinates.
          // Sanitize coordinates — NaN must not leak to the frontend
          // (NaN != null is true, so null checks don't catch it)
          const safeLat = (v) => (Number.isFinite(v) ? v : null);

          return {
            spotter: spot.spotter,
            spotterLat: safeLat(spotterLoc?.lat),
            spotterLon: safeLat(spotterLoc?.lon),
            spotterCountry: spotterLoc?.country || '',
            spotterGrid: spotterGridSquare,
            spotterLocSource: spotterLoc?.source || null,
            dxCall: spot.dxCall,
            dxLat: safeLat(dxLoc?.lat),
            dxLon: safeLat(dxLoc?.lon),
            dxCountry: dxLoc?.country || '',
            dxGrid: dxGridSquare,
            dxLocSource: dxLoc?.source || null,
            isDXpedition: isDXpeditionCall(spot.dxCall),
            freq: spot.freq,
            comment: spot.comment,
            time: spot.time,
            id: spot.id,
            // Preserve source timestamps for retention; only fall back to HH:MMz parsing when no timestamp exists.
            timestamp: Number.isFinite(spot.timestamp) ? spot.timestamp : parseSpotHHMMzToTimestamp(spot.time, now),
          };
        })
        .filter(Boolean);

      // Merge with existing paths, removing expired and duplicates
      const existingValidPaths = pathsCache.allPaths.filter((p) => isPathLive(p, now));

      // Add new paths, avoiding duplicates (same dxCall+freq within 2 minutes)
      const mergedPaths = [...existingValidPaths];
      for (const newPath of newPaths) {
        const isDuplicate = mergedPaths.some((existing) => areDXPathsDuplicate(existing, newPath, now));
        if (!isDuplicate) {
          mergedPaths.push(newPath);
        }
      }

      // Sort by timestamp (newest first), collapse re-spots of the same
      // station (same call within ~2 kHz keeps only the newest row — every
      // extra spotter of an activator was another visible duplicate), then
      // cap. 600 holds a full hour of balanced history — the accumulator is
      // what mode filters draw from.
      const sortedPaths = capWithDXpeditions(
        collapseDuplicateDXPaths(mergedPaths.sort((a, b) => b.timestamp - a.timestamp)),
        600,
      );

      logDebug(
        '[DX Paths]',
        sortedPaths.length,
        'total paths (',
        newPaths.length,
        'new from',
        newSpots.length,
        'spots)',
      );

      // Pre-warm P.533-14 propagation cache for new DX spots.
      // Uses the server's configured DE location — covers most hosted users.
      if (ctx.prewarmPropagation && CONFIG.latitude && CONFIG.longitude && newPaths.length > 0) {
        const seen = new Set();
        for (const p of newPaths) {
          if (p.dxLat != null && p.dxLon != null) {
            // Deduplicate by rounded DX coordinates
            const dxKey = `${Math.round(p.dxLat)},${Math.round(p.dxLon)}`;
            if (!seen.has(dxKey)) {
              seen.add(dxKey);
              ctx.prewarmPropagation(CONFIG.latitude, CONFIG.longitude, p.dxLat, p.dxLon);
            }
          }
        }
        if (seen.size > 0) logDebug(`[DX Paths] Queued P.533 pre-warm for ${seen.size} new DX targets`);
      }

      // Update cache
      dxSpotPathsCacheByKey.set(cacheKey, {
        paths: capWithDXpeditions(sortedPaths, 150), // Return 150 for display/filtering
        allPaths: sortedPaths, // Keep all for accumulation
        timestamp: now,
      });

      res.json(capWithDXpeditions(sortedPaths, 150));
    } catch (error) {
      logErrorOnce('DX Paths', error.message);
      // Return cached data on error
      res.json(pathsCache.paths || []);
    }
  });

  // Return shared state
  return { customDxSessions, dxSpotPathsCacheByKey, dxUdpSessions };
};
