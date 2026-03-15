/**
 * DX Cluster routes — spots, sources, paths, custom sessions.
 * Lines ~2936-4193 of original server.js
 */

const net = require('net');
const { gridToLatLon, getBandFromKHz } = require('../utils/grid');

module.exports = function (app, ctx) {
  const {
    fetch,
    CONFIG,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    extractBaseCallsign,
    extractOperatingPrefix,
    estimateLocationFromPrefix,
    maidenheadToLatLon,
    extractGridFromComment,
    extractGridsFromComment,
    isValidGrid,
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

  // DX Spider Proxy URL (sibling service on Railway or external)
  const DXSPIDER_PROXY_URL = process.env.DXSPIDER_PROXY_URL || 'https://spider-production-1ec7.up.railway.app';

  // Cache for DX Spider telnet spots (to avoid excessive connections)
  let dxSpiderCache = { spots: [], timestamp: 0 };
  const DXSPIDER_CACHE_TTL = 90000; // 90 seconds cache - reduces reconnection frequency

  // DX Spider nodes - dxspider.co.uk primary per G6NHU
  // SSID -56 for OpenHamClock (HamClock uses -55)
  const DXSPIDER_NODES = [
    { host: 'dxspider.co.uk', port: 7300 },
    { host: 'dxc.nc7j.com', port: 7373 },
    { host: 'dxc.ai9t.com', port: 7373 },
    { host: 'dxc.w6cua.org', port: 7300 },
  ];
  const DXSPIDER_SSID = '-56'; // OpenHamClock SSID

  function getDxClusterLoginCallsign(preferredCallsign = null) {
    // Strip control characters to prevent telnet command injection via query params
    const candidate = (preferredCallsign || CONFIG.dxClusterCallsign || '').replace(/[\x00-\x1F\x7F]/g, '').trim();
    if (candidate && candidate.toUpperCase() !== 'N0CALL') {
      // Append default SSID if caller didn't include one
      if (!candidate.includes('-')) {
        return `${candidate.toUpperCase()}${DXSPIDER_SSID}`;
      }
      return candidate.toUpperCase();
    }

    if (CONFIG.callsign && CONFIG.callsign.toUpperCase() !== 'N0CALL') {
      return `${CONFIG.callsign.toUpperCase()}${DXSPIDER_SSID}`;
    }

    return 'GUEST';
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
  const CUSTOM_DX_RECONNECT_DELAY_MS = 10000;
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
    if (session.reconnectTimer) return;
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = null;
      connectCustomSession(session);
    }, CUSTOM_DX_RECONNECT_DELAY_MS);
  }

  function handleCustomSessionDisconnect(session) {
    if (session.connected === false && session.connecting === false) return;
    session.connected = false;
    session.connecting = false;
    session.loginSent = false;
    session.commandSent = false;

    if (session.keepAliveTimer) {
      clearInterval(session.keepAliveTimer);
      session.keepAliveTimer = null;
    }
    try {
      session.client?.destroy();
    } catch (e) {}
    scheduleCustomSessionReconnect(session);
  }

  function connectCustomSession(session) {
    if (session.connected || session.connecting) return;
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }
    session.connecting = true;

    const client = new net.Socket();
    session.client = client;
    session.buffer = '';
    session.loginSent = false;
    session.commandSent = false;
    client.setTimeout(0);
    client.setKeepAlive(true, 60000); // OS-level TCP keepalive probes every 60s

    client.connect(session.node.port, session.node.host, () => {
      session.connected = true;
      session.connecting = false;
      session.lastConnectedAt = Date.now();
      session.lastDataAt = Date.now();
      logDebug(
        `[DX Cluster] DX Spider: connected to ${session.node.host}:${session.node.port} as ${session.loginCallsign}`,
      );

      // Fallback: send login even if prompt text differs.
      setTimeout(() => {
        if (session.client && session.connected && !session.loginSent) {
          session.loginSent = true;
          session.client.write(`${session.loginCallsign}\r\n`);
        }
      }, 1200);

      session.keepAliveTimer = setInterval(() => {
        if (session.client && session.connected) {
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

      // Login prompt detection
      if (
        !session.loginSent &&
        (session.buffer.includes('login:') ||
          session.buffer.includes('Please enter your call') ||
          session.buffer.includes('enter your callsign'))
      ) {
        session.loginSent = true;
        client.write(`${session.loginCallsign}\r\n`);
      }

      // Once logged in, enable stream per connection. Snapshot is only requested
      // once for the whole session lifecycle (first successful login).
      if (
        session.loginSent &&
        !session.commandSent &&
        (session.buffer.includes('Hello') ||
          session.buffer.includes('de ') ||
          session.buffer.includes('dxspider >') ||
          session.buffer.includes('>') ||
          session.buffer.includes(session.loginCallsign.split('-')[0]))
      ) {
        session.commandSent = true;
        setTimeout(() => {
          if (session.client && session.connected) {
            if (!session.initialSnapshotDone) {
              logInfo(
                `[DX Cluster] Sending command: sh/dx 25 to ${session.node.host}:${session.node.port} as ${session.loginCallsign}`,
              );
              session.client.write('sh/dx 25\r\n');
              session.initialSnapshotDone = true;
            }
            // Enable ongoing stream where supported.
            setTimeout(() => {
              if (session.client && session.connected) {
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
        if (parsed) addCustomSessionSpot(session, parsed);
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

  function getOrCreateCustomSession(node, userCallsign = null) {
    const loginCallsign = getDxClusterLoginCallsign(userCallsign);
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
      if (!session.connected && !session.connecting) {
        connectCustomSession(session);
      }
    }

    return session;
  }

  // DX Spider telnet connection helper - used by both /api/dxcluster/spots and /api/dxcluster/paths
  function tryDXSpiderNode(node, userCallsign = null) {
    return new Promise((resolve) => {
      const spots = [];
      let buffer = '';
      let loginSent = false;
      let commandSent = false;
      let finished = false;

      // Prefer explicit callsign (frontend/API), then DX_CLUSTER_CALLSIGN from env, then CALLSIGN-56, then GUEST.
      const loginCallsign = getDxClusterLoginCallsign(userCallsign);

      const client = new net.Socket();
      client.setTimeout(12000);

      const finalize = (result) => {
        if (finished) return;
        finished = true;
        try {
          client.destroy();
        } catch (e) {}
        resolve(result);
      };

      // Try connecting to DX Spider node
      client.connect(node.port, node.host, () => {
        logDebug(`[DX Cluster] DX Spider: connected to ${node.host}:${node.port} as ${loginCallsign}`);
      });

      client.on('data', (data) => {
        buffer += data.toString();

        // Wait for login prompt
        if (
          !loginSent &&
          (buffer.includes('login:') ||
            buffer.includes('Please enter your call') ||
            buffer.includes('enter your callsign'))
        ) {
          loginSent = true;
          client.write(`${loginCallsign}\r\n`);
          return;
        }

        // Wait for prompt after login, then send command
        if (
          loginSent &&
          !commandSent &&
          (buffer.includes('Hello') ||
            buffer.includes('de ') ||
            buffer.includes('>') ||
            buffer.includes('GUEST') ||
            buffer.includes(loginCallsign.split('-')[0]))
        ) {
          commandSent = true;
          setTimeout(() => {
            if (!finished) {
              logInfo(`[DX Cluster] Sending command: sh/dx 25 to ${node.host}:${node.port} as ${loginCallsign}`);
              client.write('sh/dx 25\r\n');
            }
          }, 1000);
          return;
        }

        // Parse DX spots from the output
        const lines = buffer.split('\n');
        for (const line of lines) {
          const parsed = parseDXSpiderSpotLine(line);
          if (!parsed) continue;
          // Avoid duplicates
          if (!spots.find((s) => s.call === parsed.call && s.freq === parsed.freq && s.spotter === parsed.spotter)) {
            spots.push(parsed);
          }
        }

        // If we have enough spots, close connection
        if (spots.length >= 20) {
          client.write('bye\r\n');
          setTimeout(() => finalize(spots), 500);
        }
      });

      client.on('timeout', () => {
        finalize(spots.length > 0 ? spots : null);
      });

      client.on('error', (err) => {
        // Only log unexpected errors, not connection issues (they're common)
        if (
          !err.message.includes('ECONNRESET') &&
          !err.message.includes('ETIMEDOUT') &&
          !err.message.includes('ENOTFOUND') &&
          !err.message.includes('ECONNREFUSED')
        ) {
          logErrorOnce('DX Cluster', `DX Spider ${node.host}: ${err.message}`);
        }
        finalize(spots.length > 0 ? spots : null);
      });

      client.on('close', () => {
        if (!finished && spots.length > 0) {
          logDebug('[DX Cluster] DX Spider:', spots.length, 'spots from', node.host);
          dxSpiderCache = { spots: spots, timestamp: Date.now() };
        }
        finalize(spots.length > 0 ? spots : null);
      });

      // Fallback timeout - close after 15 seconds regardless
      setTimeout(() => {
        if (!finished) {
          if (spots.length > 0) {
            logDebug('[DX Cluster] DX Spider:', spots.length, 'spots from', node.host);
            dxSpiderCache = { spots: spots, timestamp: Date.now() };
          }
          finalize(spots.length > 0 ? spots : null);
        }
      }, 15000);
    });
  }

  app.get('/api/dxcluster/spots', async (req, res) => {
    const source = (req.query.source || CONFIG.dxClusterSource || 'auto').toLowerCase();

    // Helper function for HamQTH (HTTP-based, works everywhere)
    async function fetchHamQTH() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch('https://www.hamqth.com/dxc_csv.php?limit=25', {
          headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
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
          headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
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

    // Helper function for DX Spider (telnet-based, works locally/Pi)
    // Multiple nodes for failover - uses module-level constants and tryDXSpiderNode
    async function fetchDXSpider() {
      // Check cache first (use longer cache to reduce connection attempts)
      if (Date.now() - dxSpiderCache.timestamp < DXSPIDER_CACHE_TTL && dxSpiderCache.spots.length > 0) {
        logDebug('[DX Cluster] DX Spider: returning', dxSpiderCache.spots.length, 'cached spots');
        return dxSpiderCache.spots;
      }

      // Try each node until one succeeds
      for (const node of DXSPIDER_NODES) {
        const result = await tryDXSpiderNode(node);
        if (result && result.length > 0) {
          return result;
        }
      }

      logDebug('[DX Cluster] DX Spider: all nodes failed');
      return null;
    }

    // Fetch based on selected source
    let spots = null;

    if (source === 'hamqth') {
      spots = await fetchHamQTH();
    } else if (source === 'proxy') {
      spots = await fetchDXSpiderProxy();
      // Fallback to HamQTH if proxy fails
      if (!spots) {
        logDebug('[DX Cluster] Proxy failed, falling back to HamQTH');
        spots = await fetchHamQTH();
      }
    } else if (source === 'dxspider') {
      spots = await fetchDXSpider();
      // Fallback to HamQTH if DX Spider fails
      if (!spots) {
        logDebug('[DX Cluster] DX Spider failed, falling back to HamQTH');
        spots = await fetchHamQTH();
      }
    } else {
      // Auto mode - try Proxy first (best for Railway), then HamQTH, then DX Spider
      spots = await fetchDXSpiderProxy();
      if (!spots) {
        spots = await fetchHamQTH();
      }
      if (!spots) {
        spots = await fetchDXSpider();
      }
    }

    res.json(spots || []);
  });

  // Get available DX cluster sources
  app.get('/api/dxcluster/sources', (req, res) => {
    res.json([
      {
        id: 'auto',
        name: 'Auto (Best Available)',
        description: 'Tries Proxy first, then HamQTH, then direct telnet',
      },
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
        description: 'Direct telnet to dxspider.co.uk (G6NHU) - works locally/Pi',
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
  const DXPATHS_RETENTION = 30 * 60 * 1000; // 30 minute spot retention
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

  /**
   * SSRF protection: resolve hostname to IP and reject private/reserved addresses.
   * Returns the resolved IP so callers can connect to the IP directly, preventing
   * DNS rebinding (TOCTOU) attacks where the record changes between validation and connect.
   */
  function isPrivateIP(ip) {
    // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
    const normalized = ip.replace(/^::ffff:/i, '');

    // IPv4 private/reserved ranges
    const parts = normalized.split('.').map(Number);
    if (parts.length === 4 && parts.every((n) => n >= 0 && n <= 255)) {
      if (parts[0] === 127) return true; // loopback
      if (parts[0] === 10) return true; // 10.0.0.0/8
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
      if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
      if (parts[0] === 169 && parts[1] === 254) return true; // link-local
      if (parts[0] === 0) return true; // 0.0.0.0/8
      if (parts[0] >= 224) return true; // multicast + reserved
    }
    // IPv6 private/reserved
    const lower = normalized.toLowerCase();
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc00:') ||
      lower.startsWith('fd00:') ||
      lower.startsWith('ff00:') ||
      lower.startsWith('::ffff:')
    ) {
      // Catch any remaining IPv4-mapped forms that weren't normalized above
      return true;
    }
    return false;
  }

  async function validateCustomHost(host) {
    // Reject obvious localhost strings before DNS
    if (/^localhost$/i.test(host)) return { ok: false, reason: 'localhost not allowed' };

    // Resolve hostname to IPv4 addresses ONLY.
    // We intentionally do not fall back to resolve6 because IPv6 has many equivalent
    // representations for private addresses (e.g. ::ffff:7f00:1 = 127.0.0.1 in hex form)
    // that bypass string-based checks. DX cluster telnet servers are IPv4.
    let addresses;
    try {
      addresses = await dns.promises.resolve4(host);
    } catch {
      return { ok: false, reason: 'Host could not be resolved (IPv4 required for custom DX clusters)' };
    }

    // Check every resolved address — block if any resolve to private/reserved
    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        return { ok: false, reason: 'Host resolves to a private/reserved address' };
      }
    }
    // Return the first resolved IP so callers connect to the validated IP, not the hostname.
    // This prevents DNS rebinding (TOCTOU) where the record changes between validation and connect.
    return { ok: true, resolvedIP: addresses[0] };
  }

  app.get('/api/dxcluster/paths', async (req, res) => {
    // Parse query parameters for custom cluster settings
    const source = req.query.source || 'auto';
    const customHost = (req.query.host || CONFIG.dxClusterHost || '').trim();
    const parsedPort = parseInt(req.query.port, 10);
    const customPort = Number.isFinite(parsedPort) ? parsedPort : CONFIG.dxClusterPort;
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
      // Restrict port range to common DX Spider/telnet ports
      if (customPort < 1024 || customPort > 49151) {
        return res.status(400).json({ error: 'Port must be between 1024 and 49151' });
      }
    }

    // Generate cache key based on source profile so custom/proxy/auto don't mix.
    const cacheKey =
      source === 'custom'
        ? `custom-${resolvedHost}-${customPort}-${getDxClusterLoginCallsign(userCallsign)}`
        : `source-${source}`;
    const pathsCache = getDxPathsCache(cacheKey);

    // Check cache first (but not for custom sources - they might have different data)
    if (source !== 'custom' && Date.now() - pathsCache.timestamp < DXPATHS_CACHE_TTL && pathsCache.paths.length > 0) {
      logDebug('[DX Paths] Returning', pathsCache.paths.length, 'cached paths');
      return res.json(pathsCache.paths);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const now = Date.now();

      // Try proxy first for better real-time data
      let newSpots = [];
      let usedSource = 'none';

      // Handle custom telnet source (persistent connection, no reconnect-per-poll)
      if (source === 'custom' && resolvedHost) {
        logDebug(
          `[DX Paths] Using custom telnet session: ${resolvedHost}:${customPort} as ${getDxClusterLoginCallsign(userCallsign)}`,
        );
        const customNode = { host: resolvedHost, port: customPort };
        const session = getOrCreateCustomSession(customNode, userCallsign);
        // Take the most recent spots from persistent session buffer.
        const customSpots = (session.spots || []).slice(0, 100).map((s) => ({
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

      // Try proxy if not using custom or custom failed
      if (newSpots.length === 0 && source !== 'custom') {
        try {
          const proxyResponse = await fetch(`${DXSPIDER_PROXY_URL}/api/spots?limit=100`, {
            headers: { 'User-Agent': 'OpenHamClock/3.14.11' },
            signal: controller.signal,
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
        }
      }

      // Fallback to HamQTH if proxy failed (never for explicit custom source)
      if (newSpots.length === 0 && source !== 'custom') {
        try {
          const response = await fetch('https://www.hamqth.com/dxc_csv.php?limit=50', {
            headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
            signal: controller.signal,
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
        }
      }

      clearTimeout(timeout);

      if (newSpots.length === 0) {
        // Return existing paths if fetch failed
        const validPaths = pathsCache.allPaths.filter((p) => now - p.timestamp < DXPATHS_RETENTION);
        return res.json(validPaths.slice(0, 50));
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
      const prefixLocations = {};
      const callsToLookup = [...allCalls].slice(0, 100);

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
            source: 'hamqth',
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
          fetch(`https://www.hamqth.com/dxcc.php?callsign=${encodeURIComponent(call)}`, {
            headers: { 'User-Agent': 'OpenHamClock/' + APP_VERSION },
            signal: AbortSignal.timeout(5000),
          })
            .then(async (resp) => {
              if (!resp.ok) return;
              const text = await resp.text();
              const latMatch = text.match(/<lat>([^<]+)<\/lat>/);
              const lonMatch = text.match(/<lng>([^<]+)<\/lng>/);
              const countryMatch = text.match(/<n>([^<]+)<\/name>/);
              if (latMatch && lonMatch) {
                cacheCallsignLookup(call, {
                  data: {
                    callsign: call,
                    lat: parseFloat(latMatch[1]),
                    lon: parseFloat(lonMatch[1]),
                    country: countryMatch ? countryMatch[1] : '',
                  },
                  timestamp: Date.now(),
                });
              }
            })
            .catch(() => {}); // Silent fail for background lookups
        }
      }

      // Build new paths with locations - try grid first, fall back to prefix
      const newPaths = newSpots
        .map((spot) => {
          // DX station location - try grid from spot data first, then comment, then prefix
          let dxLoc = null;
          let dxGridSquare = null;

          // Check if spot already has dxGrid from proxy
          if (spot.dxGrid) {
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

          // If no grid yet, try extracting from comment
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

          // Fall back to HamQTH cached location (more accurate than prefix)
          // HamQTH uses home callsign — but for portable ops, prefix location wins
          if (!dxLoc && hamqthLocations[baseCallMap[spot.dxCall] || spot.dxCall]) {
            // Only use HamQTH location if there's no operating prefix override
            // (i.e. the call is not a compound prefix/callsign like PJ2/W9WI)
            const opPrefix = prefixCallMap[spot.dxCall];
            const homeCall = baseCallMap[spot.dxCall];
            if (!opPrefix || opPrefix === homeCall) {
              dxLoc = hamqthLocations[homeCall || spot.dxCall];
            }
          }

          // Fall back to prefix location (now includes grid-based coordinates!)
          if (!dxLoc) {
            dxLoc = prefixLocations[prefixCallMap[spot.dxCall] || spot.dxCall];
            if (dxLoc && dxLoc.grid) {
              dxGridSquare = dxLoc.grid;
            }
          }

          // Spotter location - try grid first, then prefix
          let spotterLoc = null;
          let spotterGridSquare = null;

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
          return {
            spotter: spot.spotter,
            spotterLat: spotterLoc?.lat ?? null,
            spotterLon: spotterLoc?.lon ?? null,
            spotterCountry: spotterLoc?.country || '',
            spotterGrid: spotterGridSquare,
            spotterLocSource: spotterLoc?.source || null,
            dxCall: spot.dxCall,
            dxLat: dxLoc?.lat ?? null,
            dxLon: dxLoc?.lon ?? null,
            dxCountry: dxLoc?.country || '',
            dxGrid: dxGridSquare,
            dxLocSource: dxLoc?.source || null,
            freq: spot.freq,
            comment: spot.comment,
            time: spot.time,
            id: spot.id,
            // Sorting is driven by spot-provided HHMMz time when available.
            timestamp: parseSpotHHMMzToTimestamp(spot.time, Number.isFinite(spot.timestamp) ? spot.timestamp : now),
          };
        })
        .filter(Boolean);

      // Merge with existing paths, removing expired and duplicates
      const existingValidPaths = pathsCache.allPaths.filter((p) => now - p.timestamp < DXPATHS_RETENTION);

      // Add new paths, avoiding duplicates (same dxCall+freq within 2 minutes)
      const mergedPaths = [...existingValidPaths];
      for (const newPath of newPaths) {
        const isDuplicate = mergedPaths.some(
          (existing) =>
            existing.dxCall === newPath.dxCall && existing.freq === newPath.freq && now - existing.timestamp < 120000, // 2 minute dedup window
        );
        if (!isDuplicate) {
          mergedPaths.push(newPath);
        }
      }

      // Sort by timestamp (newest first) and limit
      const sortedPaths = mergedPaths.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);

      logDebug(
        '[DX Paths]',
        sortedPaths.length,
        'total paths (',
        newPaths.length,
        'new from',
        newSpots.length,
        'spots)',
      );

      // Update cache
      dxSpotPathsCacheByKey.set(cacheKey, {
        paths: sortedPaths.slice(0, 50), // Return 50 for display
        allPaths: sortedPaths, // Keep all for accumulation
        timestamp: now,
      });

      res.json(sortedPaths.slice(0, 50));
    } catch (error) {
      logErrorOnce('DX Paths', error.message);
      // Return cached data on error
      res.json(pathsCache.paths || []);
    }
  });

  // Return shared state
  return { customDxSessions, dxSpotPathsCacheByKey };
};
