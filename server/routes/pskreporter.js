/**
 * PSKReporter routes — MQTT proxy, SSE streams, my spots.
 * Lines ~6096-6842 of original server.js
 */

const mqttLib = require('mqtt');
const { gridToLatLon, getBandFromHz } = require('../utils/grid');

module.exports = function (app, ctx) {
  const {
    fetch,
    CONFIG,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    upstream,
    maidenheadToLatLon,
    extractBaseCallsign,
    estimateLocationFromPrefix,
    cacheCallsignLookup,
    callsignLookupCache,
    hamqthLookup,
  } = ctx;

  // ============================================
  // MY SPOTS API - Get spots involving a specific callsign
  // ============================================

  // Cache for my spots data
  let mySpotsCache = new Map(); // key = callsign, value = { data, timestamp }
  const MYSPOTS_CACHE_TTL = 45000; // 45 seconds (just under 60s frontend poll to maximize cache hits)

  // Clean expired mySpots entries every 2 minutes
  setInterval(
    () => {
      const now = Date.now();
      for (const [call, entry] of mySpotsCache) {
        if (now - entry.timestamp > MYSPOTS_CACHE_TTL * 2) {
          mySpotsCache.delete(call);
        }
      }
    },
    2 * 60 * 1000,
  );

  app.get('/api/myspots/:callsign', async (req, res) => {
    const callsign = req.params.callsign.toUpperCase();
    const now = Date.now();

    // Check cache first
    const cached = mySpotsCache.get(callsign);
    if (cached && now - cached.timestamp < MYSPOTS_CACHE_TTL) {
      logDebug('[My Spots] Returning cached data for:', callsign);
      return res.json(cached.data);
    }

    logDebug('[My Spots] Searching for callsign:', callsign);

    const mySpots = [];

    try {
      // Try HamQTH for spots involving this callsign
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`https://www.hamqth.com/dxc_csv.php?limit=100`, {
        headers: { 'User-Agent': 'OpenHamClock/3.13.1' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const text = await response.text();
        const lines = text.trim().split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.split('^');
          if (parts.length < 3) continue;

          const spotter = parts[0]?.trim().toUpperCase();
          const dxCall = parts[2]?.trim().toUpperCase();
          const freq = parts[1]?.trim();
          const comment = parts[3]?.trim() || '';
          const timeStr = parts[4]?.trim() || '';

          // Check if our callsign is involved (as spotter or spotted)
          if (spotter === callsign || dxCall === callsign || spotter.includes(callsign) || dxCall.includes(callsign)) {
            mySpots.push({
              spotter,
              dxCall,
              freq: freq ? (parseFloat(freq) / 1000).toFixed(3) : '0.000',
              comment,
              time: timeStr ? timeStr.substring(0, 5) + 'z' : '',
              isMySpot: spotter.includes(callsign),
              isSpottedMe: dxCall.includes(callsign),
            });
          }
        }
      }

      logDebug('[My Spots] Found', mySpots.length, 'spots involving', callsign);

      // Now try to get locations for each unique callsign
      const uniqueCalls = [...new Set(mySpots.map((s) => (s.isMySpot ? s.dxCall : s.spotter)))];
      const locations = {};

      for (const rawCall of uniqueCalls.slice(0, 10)) {
        // Limit to 10 lookups
        try {
          const call = extractBaseCallsign(rawCall);
          const loc = estimateLocationFromPrefix(call);
          if (loc) {
            // Store under both raw and base key so spot lookup finds it
            locations[rawCall] = {
              lat: loc.lat,
              lon: loc.lon,
              country: loc.country,
            };
            if (call !== rawCall) locations[call] = locations[rawCall];
          }
        } catch (e) {
          // Ignore lookup errors
        }
      }

      // Add locations to spots
      const spotsWithLocations = mySpots
        .map((spot) => {
          const targetCall = spot.isMySpot ? spot.dxCall : spot.spotter;
          const loc = locations[targetCall];
          return {
            ...spot,
            targetCall,
            lat: loc?.lat,
            lon: loc?.lon,
            country: loc?.country,
          };
        })
        .filter((s) => s.lat && s.lon); // Only return spots with valid locations

      // Cache the result
      mySpotsCache.set(callsign, {
        data: spotsWithLocations,
        timestamp: Date.now(),
      });

      res.json(spotsWithLocations);
    } catch (error) {
      if (error.name !== 'AbortError') {
        logErrorOnce('My Spots', error.message);
      }
      res.json([]);
    }
  });

  // ============================================
  // PSKREPORTER API (MQTT-based for real-time)
  // ============================================

  // PSKReporter MQTT feed at mqtt.pskreporter.info provides real-time spots
  // WebSocket endpoints: 1885 (ws), 1886 (wss)
  // Topic format: pskr/filter/v2/{band}/{mode}/{sendercall}/{receivercall}/{senderlocator}/{receiverlocator}/{sendercountry}/{receivercountry}

  // NOTE: PSKReporter spots are now handled entirely through the MQTT proxy system
  // (pskMqtt.recentSpots and pskMqtt.spotBuffer), not this legacy cache.

  // Convert grid square to lat/lon
  function gridToLatLonSimple(grid) {
    if (!grid || grid.length < 4) return null;

    const g = grid.toUpperCase();
    const lon = (g.charCodeAt(0) - 65) * 20 - 180;
    const lat = (g.charCodeAt(1) - 65) * 10 - 90;
    const lonMin = parseInt(g[2]) * 2;
    const latMin = parseInt(g[3]) * 1;

    let finalLon = lon + lonMin + 1;
    let finalLat = lat + latMin + 0.5;

    // If 6-character grid, add more precision
    if (grid.length >= 6) {
      const lonSec = (g.charCodeAt(4) - 65) * (2 / 24);
      const latSec = (g.charCodeAt(5) - 65) * (1 / 24);
      finalLon = lon + lonMin + lonSec + 1 / 24;
      finalLat = lat + latMin + latSec + 0.5 / 24;
    }

    return { lat: finalLat, lon: finalLon };
  }

  // Get band name from frequency in Hz
  function getBandFromHz(freqHz) {
    const freq = freqHz / 1000000; // Convert to MHz
    if (freq >= 1.8 && freq <= 2) return '160m';
    if (freq >= 3.5 && freq <= 4) return '80m';
    if (freq >= 5.3 && freq <= 5.4) return '60m';
    if (freq >= 7 && freq <= 7.3) return '40m';
    if (freq >= 10.1 && freq <= 10.15) return '30m';
    if (freq >= 14 && freq <= 14.35) return '20m';
    if (freq >= 18.068 && freq <= 18.168) return '17m';
    if (freq >= 21 && freq <= 21.45) return '15m';
    if (freq >= 24.89 && freq <= 24.99) return '12m';
    if (freq >= 28 && freq <= 29.7) return '10m';
    if (freq >= 40 && freq <= 42) return '8m';
    if (freq >= 50 && freq <= 54) return '6m';
    if (freq >= 70 && freq <= 70.5) return '4m';
    if (freq >= 144 && freq <= 148) return '2m';
    if (freq >= 420 && freq <= 450) return '70cm';
    return 'Unknown';
  }

  // PSKReporter endpoint - returns connection info for frontend
  // The server now proxies MQTT and exposes it via SSE
  app.get('/api/pskreporter/config', (req, res) => {
    res.json({
      stream: {
        endpoint: '/api/pskreporter/stream/{callsign}',
        type: 'text/event-stream',
        batchInterval: '15s',
        note: 'Server maintains single MQTT connection to PSKReporter, relays via SSE',
      },
      mqtt: {
        status: pskMqtt.connected ? 'connected' : 'disconnected',
        activeCallsigns: pskMqtt.subscribedCalls.size,
        sseClients: [...pskMqtt.subscribers.values()].reduce((n, s) => n + s.size, 0),
      },
      info: 'Connect to /api/pskreporter/stream/:callsign for real-time spots via Server-Sent Events',
    });
  });

  // Combined endpoint - returns stream info (live spots via SSE, no HTTP backfill)
  app.get('/api/pskreporter/:callsign', async (req, res) => {
    const callsign = req.params.callsign.toUpperCase();

    res.json({
      callsign,
      stream: {
        endpoint: `/api/pskreporter/stream/${callsign}`,
        type: 'text/event-stream',
        hint: 'Connect to SSE stream for real-time spots. Initial spots delivered on connect event.',
      },
      mqtt: {
        status: pskMqtt.connected ? 'connected' : 'disconnected',
        activeCallsigns: pskMqtt.subscribedCalls.size,
        sseClients: Array.from(pskMqtt.subscribers.values()).reduce((s, c) => s + c.size, 0),
      },
    });
  });

  // ============================================
  // PSKREPORTER SERVER-SIDE MQTT PROXY
  // ============================================
  // Single MQTT connection to mqtt.pskreporter.info, shared across all users.
  // Dynamically subscribes per-callsign topics based on active SSE clients.
  // Buffers incoming spots and pushes to clients every 15 seconds.

  const pskMqtt = {
    client: null,
    connected: false,
    // Map<callsign, Set<response>> — active SSE clients per callsign
    subscribers: new Map(),
    // Map<callsign, Array<spot>> — buffered spots waiting for next flush
    spotBuffer: new Map(),
    // Map<callsign, Array<spot>> — recent spots (last 60 min) for late-joiners
    recentSpots: new Map(),
    // Track subscribed topics to avoid double-subscribe
    subscribedCalls: new Set(),
    reconnectAttempts: 0,
    maxReconnectDelay: 120000, // 2 min max
    reconnectTimer: null, // guards against multiple pending reconnects
    flushInterval: null,
    cleanupInterval: null,
    stats: {
      spotsReceived: 0,
      spotsRelayed: 0,
      messagesDropped: 0,
      lastSpotTime: null,
    },
  };

  function pskMqttConnect() {
    // Tear down old client — remove listeners FIRST to prevent its 'close'
    // event from scheduling a duplicate reconnect (fork bomb prevention)
    if (pskMqtt.client) {
      try {
        pskMqtt.client.removeAllListeners();
        // MUST re-attach a no-op error handler — Node.js crashes on
        // unhandled 'error' events, and the old client may still emit
        // errors (e.g. connack timeout) after we've detached
        pskMqtt.client.on('error', () => {});
        pskMqtt.client.end(true);
      } catch {}
      pskMqtt.client = null;
    }

    const clientId = `ohc_svr_${Math.random().toString(16).substr(2, 8)}`;
    console.log(`[PSK-MQTT] Connecting to mqtt.pskreporter.info as ${clientId}...`);

    const client = mqttLib.connect('wss://mqtt.pskreporter.info:1886/mqtt', {
      clientId,
      clean: true,
      connectTimeout: 30000,
      reconnectPeriod: 0, // We handle reconnect ourselves with backoff
      keepalive: 60,
      protocolVersion: 4,
    });

    pskMqtt.client = client;

    client.on('connect', () => {
      pskMqtt.connected = true;
      pskMqtt.reconnectAttempts = 0;

      const count = pskMqtt.subscribedCalls.size;
      if (count > 0) {
        console.log(`[PSK-MQTT] Connected — subscribing ${count} keys`);
        // Batch all topic subscriptions into a single subscribe call
        const topics = [];
        for (const key of pskMqtt.subscribedCalls) {
          if (key.startsWith('grid:')) {
            const grid = key.slice(5);
            topics.push(`pskr/filter/v2/+/+/+/+/${grid}/#`);
            topics.push(`pskr/filter/v2/+/+/+/+/+/${grid}/#`);
          } else {
            const call = key.startsWith('call:') ? key.slice(5) : key;
            topics.push(`pskr/filter/v2/+/+/${call}/#`);
            topics.push(`pskr/filter/v2/+/+/+/${call}/#`);
          }
        }
        pskMqtt.client.subscribe(topics, { qos: 0 }, (err) => {
          if (err) {
            // "Connection closed" errors are expected during unstable reconnects —
            // the next on('connect') will retry the batch subscribe
            if (err.message && err.message.includes('onnection closed')) return;
            console.error(`[PSK-MQTT] Batch subscribe error:`, err.message);
          } else {
            console.log(`[PSK-MQTT] Subscribed ${count} keys (${topics.length} topics)`);
          }
        });
      } else {
        console.log('[PSK-MQTT] Connected (no active subscriptions)');
      }
    });

    client.on('message', (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        const { sc, rc, sl, rl, f, md, rp, t, b } = data;
        if (!sc || !rc) return;

        const freq = parseInt(f) || 0;
        const now = Date.now();
        const spot = {
          sender: sc,
          senderGrid: sl,
          receiver: rc,
          receiverGrid: rl,
          freq,
          freqMHz: freq ? (freq / 1000000).toFixed(3) : '?',
          band: b || getBandFromHz(freq),
          mode: md || 'Unknown',
          snr: rp !== undefined ? parseInt(rp) : null,
          timestamp: t ? t * 1000 : now,
          age: 0,
        };

        // Add lat/lon based on grid for both directions
        const senderLoc = gridToLatLonSimple(sl);
        const receiverLoc = gridToLatLonSimple(rl);

        pskMqtt.stats.spotsReceived++;
        pskMqtt.stats.lastSpotTime = now;

        // Helper: buffer a spot for a subscriber key, with dedup and cap
        const bufferSpot = (subKey, enrichedSpot) => {
          const spotKey = `${sc}|${rc}|${spot.band}|${freq}`;
          // Grid subscriptions are noisier — use a higher cap
          const maxRecent = subKey.startsWith('grid:') ? 500 : 250;
          const maxRecentTrim = subKey.startsWith('grid:') ? 400 : 200;

          if (!pskMqtt.spotBuffer.has(subKey)) pskMqtt.spotBuffer.set(subKey, []);
          const buf = pskMqtt.spotBuffer.get(subKey);
          if (!buf.some((s) => `${s.sender}|${s.receiver}|${s.band}|${s.freq}` === spotKey)) {
            buf.push(enrichedSpot);
          }

          if (!pskMqtt.recentSpots.has(subKey)) pskMqtt.recentSpots.set(subKey, []);
          const recent = pskMqtt.recentSpots.get(subKey);
          const isDup = recent.some(
            (s) =>
              `${s.sender}|${s.receiver}|${s.band}|${s.freq}` === spotKey &&
              Math.abs(s.timestamp - spot.timestamp) < 30000,
          );
          if (!isDup) {
            recent.push(enrichedSpot);
            if (recent.length > maxRecent) pskMqtt.recentSpots.set(subKey, recent.slice(-maxRecentTrim));
          }
        };

        // ── Callsign-based routing ──
        // TX: sender callsign matches a subscriber
        const scUpper = sc.toUpperCase();
        if (pskMqtt.subscribers.has(scUpper)) {
          bufferSpot(scUpper, { ...spot, lat: receiverLoc?.lat, lon: receiverLoc?.lon, direction: 'tx' });
        }

        // RX: receiver callsign matches a subscriber
        const rcUpper = rc.toUpperCase();
        if (pskMqtt.subscribers.has(rcUpper)) {
          bufferSpot(rcUpper, { ...spot, lat: senderLoc?.lat, lon: senderLoc?.lon, direction: 'rx' });
        }

        // ── Grid-based routing ──
        // TX: sender grid matches a grid subscriber (signal sent FROM this grid)
        if (sl) {
          const slUpper = sl.toUpperCase().substring(0, 4);
          const gridTxKey = `grid:${slUpper}`;
          if (pskMqtt.subscribers.has(gridTxKey)) {
            bufferSpot(gridTxKey, { ...spot, lat: receiverLoc?.lat, lon: receiverLoc?.lon, direction: 'tx' });
          }
        }

        // RX: receiver grid matches a grid subscriber (signal received AT this grid)
        if (rl) {
          const rlUpper = rl.toUpperCase().substring(0, 4);
          const gridRxKey = `grid:${rlUpper}`;
          if (pskMqtt.subscribers.has(gridRxKey)) {
            bufferSpot(gridRxKey, { ...spot, lat: senderLoc?.lat, lon: senderLoc?.lon, direction: 'rx' });
          }
        }
      } catch {
        pskMqtt.stats.messagesDropped++;
      }
    });

    client.on('error', (err) => {
      if (client !== pskMqtt.client) return;
      // "Connection closed" is redundant with on('close') handler
      if (err.message && err.message.includes('onnection closed')) return;
      console.error(`[PSK-MQTT] Error: ${err.message}`);
    });

    client.on('close', () => {
      // Only react to close events from the CURRENT client — stale clients
      // (replaced by a reconnect) must not schedule additional reconnects
      if (client !== pskMqtt.client) return;
      pskMqtt.connected = false;
      logErrorOnce('PSK-MQTT', 'Disconnected from mqtt.pskreporter.info');
      scheduleMqttReconnect();
    });

    client.on('offline', () => {
      if (client !== pskMqtt.client) return;
      pskMqtt.connected = false;
    });
  }

  function scheduleMqttReconnect() {
    // Clear any existing reconnect timer — only one pending reconnect at a time
    if (pskMqtt.reconnectTimer) {
      clearTimeout(pskMqtt.reconnectTimer);
      pskMqtt.reconnectTimer = null;
    }

    pskMqtt.reconnectAttempts++;
    const delay = Math.min(
      Math.pow(2, pskMqtt.reconnectAttempts) * 1000 + Math.random() * 5000,
      pskMqtt.maxReconnectDelay,
    );
    // Log first attempt and every 5th to avoid spam during extended outages
    if (pskMqtt.reconnectAttempts === 1 || pskMqtt.reconnectAttempts % 5 === 0) {
      console.log(`[PSK-MQTT] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${pskMqtt.reconnectAttempts})...`);
    }
    pskMqtt.reconnectTimer = setTimeout(() => {
      pskMqtt.reconnectTimer = null;
      if (pskMqtt.subscribers.size > 0) {
        pskMqttConnect();
      } else {
        console.log('[PSK-MQTT] No active subscribers, skipping reconnect');
      }
    }, delay);
  }

  function subscribeCallsign(call) {
    if (!pskMqtt.client || !pskMqtt.connected) return;
    const txTopic = `pskr/filter/v2/+/+/${call}/#`;
    const rxTopic = `pskr/filter/v2/+/+/+/${call}/#`;
    pskMqtt.client.subscribe([txTopic, rxTopic], { qos: 0 }, (err) => {
      if (err) {
        // "Connection closed" errors are expected during reconnects —
        // the on('connect') handler will re-subscribe all active callsigns
        if (err.message && err.message.includes('onnection closed')) return;
        console.error('[PSK-MQTT] Subscribe error for %s:', call, err.message);
      }
    });
  }

  function unsubscribeCallsign(call) {
    if (!pskMqtt.client || !pskMqtt.connected) return;
    const txTopic = `pskr/filter/v2/+/+/${call}/#`;
    const rxTopic = `pskr/filter/v2/+/+/+/${call}/#`;
    pskMqtt.client.unsubscribe([txTopic, rxTopic], (err) => {
      if (err) {
        if (err.message && err.message.includes('onnection closed')) return;
        console.error('[PSK-MQTT] Unsubscribe error for %s:', call, err.message);
      }
    });
  }

  // Grid-based MQTT subscriptions.
  // PSKReporter MQTT v2 topic hierarchy places the sender/receiver grid square
  // two levels after the sender/receiver callsign:
  //   pskr/filter/v2/{band}/{mode}/{senderCall}/{receiverCall}/{senderGrid}/{receiverGrid}
  // Subscribing with the grid in positions 7/8 returns ALL spots sent from or
  // received at that grid, regardless of callsign — ideal for pre-TX band assessment.
  //
  // NOTE: if PSKReporter changes its topic schema these patterns may need updating.
  // Verify against https://pskreporter.info/mqtt.html if spots stop arriving.
  function subscribeGrid(grid) {
    if (!pskMqtt.client || !pskMqtt.connected) return;
    const txTopic = `pskr/filter/v2/+/+/+/+/${grid}/#`; // senderGrid position (7)
    const rxTopic = `pskr/filter/v2/+/+/+/+/+/${grid}/#`; // receiverGrid position (8)
    pskMqtt.client.subscribe([txTopic, rxTopic], { qos: 0 }, (err) => {
      if (err) {
        if (err.message && err.message.includes('onnection closed')) return;
        console.error('[PSK-MQTT] Grid subscribe error for %s:', grid, err.message);
      } else {
        console.log('[PSK-MQTT] Subscribed grid %s', grid);
      }
    });
  }

  function unsubscribeGrid(grid) {
    if (!pskMqtt.client || !pskMqtt.connected) return;
    const txTopic = `pskr/filter/v2/+/+/+/+/${grid}/#`;
    const rxTopic = `pskr/filter/v2/+/+/+/+/+/${grid}/#`;
    pskMqtt.client.unsubscribe([txTopic, rxTopic], (err) => {
      if (err) {
        if (err.message && err.message.includes('onnection closed')) return;
        console.error('[PSK-MQTT] Grid unsubscribe error for %s:', grid, err.message);
      }
    });
  }

  // Subscribe or unsubscribe based on key type (call:XX or grid:XX)
  function subscribeKey(key) {
    if (key.startsWith('grid:')) {
      subscribeGrid(key.slice(5));
    } else {
      subscribeCallsign(key.startsWith('call:') ? key.slice(5) : key);
    }
  }

  function unsubscribeKey(key) {
    if (key.startsWith('grid:')) {
      unsubscribeGrid(key.slice(5));
    } else {
      unsubscribeCallsign(key.startsWith('call:') ? key.slice(5) : key);
    }
  }

  // Flush buffered spots to SSE clients every 15 seconds
  pskMqtt.flushInterval = setInterval(() => {
    for (const [call, clients] of pskMqtt.subscribers) {
      const buffer = pskMqtt.spotBuffer.get(call);
      if (!buffer || buffer.length === 0) continue;

      // Send buffered spots as SSE event
      const payload = JSON.stringify(buffer);
      const message = `data: ${payload}\n\n`;

      for (const res of clients) {
        try {
          res.write(message);
          if (typeof res.flush === 'function') res.flush();
          pskMqtt.stats.spotsRelayed += buffer.length;
        } catch {
          // Client disconnected — will be cleaned up
          clients.delete(res);
        }
      }

      // Clear the buffer after flushing
      pskMqtt.spotBuffer.delete(call);
    }
  }, 15000); // 15-second batch interval

  // Clean old recent spots every 5 minutes
  pskMqtt.cleanupInterval = setInterval(
    () => {
      const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
      for (const [call, spots] of pskMqtt.recentSpots) {
        // Delete entries for unsubscribed callsigns immediately
        if (!pskMqtt.subscribedCalls.has(call)) {
          pskMqtt.recentSpots.delete(call);
          continue;
        }
        const filtered = spots.filter((s) => s.timestamp > cutoff);
        if (filtered.length === 0) {
          pskMqtt.recentSpots.delete(call);
        } else {
          // Keep max 200 per callsign (matches what clients receive on connect)
          pskMqtt.recentSpots.set(call, filtered.slice(-200));
        }
      }

      // Clean spotBuffer entries for unsubscribed callsigns
      for (const call of pskMqtt.spotBuffer.keys()) {
        if (!pskMqtt.subscribedCalls.has(call)) {
          pskMqtt.spotBuffer.delete(call);
        }
      }

      // Also clean subscriber entries with no clients
      for (const [call, clients] of pskMqtt.subscribers) {
        if (clients.size === 0) {
          pskMqtt.subscribers.delete(call);
          pskMqtt.subscribedCalls.delete(call);
          unsubscribeKey(call);
          console.log(`[PSK-MQTT] Cleaned up empty subscriber set for ${call}`);
        }
      }
    },
    5 * 60 * 1000,
  );

  // SSE endpoint — clients connect here for real-time spots
  // ?type=grid subscribes by grid square instead of callsign

  // Per-IP connection limiter for SSE streams to prevent resource exhaustion.
  // Once an SSE connection is established it persists indefinitely, so the normal
  // request-rate limiter doesn't help. This caps concurrent open streams per IP.
  const MAX_SSE_PER_IP = parseInt(process.env.MAX_SSE_PER_IP || '10', 10);
  const sseConnectionsByIP = new Map();

  app.get('/api/pskreporter/stream/:identifier', (req, res) => {
    // Use req.ip which respects the trust proxy setting, consistent with express-rate-limit.
    // Manual x-forwarded-for parsing is trivially spoofable on installs without a reverse proxy.
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const current = sseConnectionsByIP.get(ip) || 0;
    if (current >= MAX_SSE_PER_IP) {
      return res.status(429).json({ error: 'Too many open SSE connections from this IP' });
    }
    sseConnectionsByIP.set(ip, current + 1);
    req.on('close', () => {
      const count = sseConnectionsByIP.get(ip) || 1;
      if (count <= 1) sseConnectionsByIP.delete(ip);
      else sseConnectionsByIP.set(ip, count - 1);
    });

    const identifier = req.params.identifier.toUpperCase();
    const type = (req.query.type || 'call').toLowerCase();

    if (type === 'grid') {
      // Validate grid: 4 or 6 character Maidenhead locator
      if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(identifier)) {
        return res.status(400).json({ error: 'Valid 4 or 6 character grid square required (e.g. FN20 or FN20ab)' });
      }
    } else {
      if (!identifier || identifier === 'N0CALL') {
        return res.status(400).json({ error: 'Valid callsign required' });
      }
    }

    // Subscriber key: "grid:FN20" for grid mode, or plain callsign for backward compat
    const subKey = type === 'grid' ? `grid:${identifier.substring(0, 4)}` : identifier;
    const maxRecentReturn = type === 'grid' ? 400 : 200;

    // Set up SSE — disable any buffering
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
    });
    res.flushHeaders();

    // Send initial connection event with any recent spots we already have
    const recentSpots = pskMqtt.recentSpots.get(subKey) || [];
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        callsign: identifier,
        type,
        subKey,
        mqttConnected: pskMqtt.connected,
        recentSpots: recentSpots.slice(-maxRecentReturn),
        subscriberCount: (pskMqtt.subscribers.get(subKey)?.size || 0) + 1,
      })}\n\n`,
    );
    if (typeof res.flush === 'function') res.flush();

    // Register this client
    if (!pskMqtt.subscribers.has(subKey)) {
      pskMqtt.subscribers.set(subKey, new Set());
    }
    pskMqtt.subscribers.get(subKey).add(res);

    // Subscribe on MQTT if this is a new key
    if (!pskMqtt.subscribedCalls.has(subKey)) {
      pskMqtt.subscribedCalls.add(subKey);
      if (pskMqtt.connected) {
        subscribeKey(subKey);
      }
      // Start MQTT connection if not already connected
      if (!pskMqtt.client || (!pskMqtt.connected && pskMqtt.reconnectAttempts === 0)) {
        pskMqttConnect();
      }
    }

    logInfo(
      `[PSK-MQTT] SSE client connected for ${subKey} (${pskMqtt.subscribers.get(subKey).size} clients, ${pskMqtt.subscribedCalls.size} keys total)`,
    );

    // Keepalive ping every 30 seconds
    const keepalive = setInterval(() => {
      try {
        res.write(`: keepalive ${Date.now()}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      } catch {
        clearInterval(keepalive);
      }
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(keepalive);
      const clients = pskMqtt.subscribers.get(subKey);
      if (clients) {
        clients.delete(res);
        logInfo(`[PSK-MQTT] SSE client disconnected for ${subKey} (${clients.size} remaining)`);

        // If no more clients for this key, unsubscribe after a grace period
        if (clients.size === 0) {
          setTimeout(() => {
            const stillEmpty = pskMqtt.subscribers.get(subKey);
            if (stillEmpty && stillEmpty.size === 0) {
              pskMqtt.subscribers.delete(subKey);
              pskMqtt.subscribedCalls.delete(subKey);
              // Clean up spot data
              pskMqtt.recentSpots.delete(subKey);
              pskMqtt.spotBuffer.delete(subKey);
              unsubscribeKey(subKey);
              console.log(`[PSK-MQTT] Unsubscribed ${subKey} (no more clients after grace period)`);

              // If no subscribers at all, disconnect MQTT entirely
              if (pskMqtt.subscribedCalls.size === 0 && pskMqtt.client) {
                console.log('[PSK-MQTT] No more subscribers, disconnecting from broker');
                // Cancel any pending reconnect
                if (pskMqtt.reconnectTimer) {
                  clearTimeout(pskMqtt.reconnectTimer);
                  pskMqtt.reconnectTimer = null;
                }
                // Strip listeners before end() to prevent close → reconnect
                try {
                  pskMqtt.client.removeAllListeners();
                  pskMqtt.client.on('error', () => {}); // prevent crash on late errors
                  pskMqtt.client.end(true);
                } catch {}
                pskMqtt.client = null;
                pskMqtt.connected = false;
                pskMqtt.reconnectAttempts = 0;
              }
            }
          }, 30000); // 30s grace period before unsubscribing
        }
      }
    });
  });

  // Return shared state
  return { pskMqtt };
};
