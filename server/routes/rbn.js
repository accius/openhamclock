/**
 * RBN + WSPR routes — Reverse Beacon Network spots, WSPR heatmap.
 * Lines ~6843-7623 of original server.js
 */

const net = require('net');
const { gridToLatLon, latLonToGrid, getBandFromHz, getBandFromKHz, haversineDistance } = require('../utils/grid');

module.exports = function (app, ctx) {
  const {
    fetch,
    CONFIG,
    PORT,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    upstream,
    maidenheadToLatLon,
    extractBaseCallsign,
    hamqthLookup,
    callsignLookupCache,
    cacheCallsignLookup,
    estimateLocationFromPrefix,
  } = ctx;

  // ============================================
  // REVERSE BEACON NETWORK (RBN) API
  // ============================================

  // Convert lat/lon to Maidenhead grid (6-character)
  function latLonToGrid(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon)) return null;

    // Adjust longitude to 0-360 range
    let adjLon = lon + 180;
    let adjLat = lat + 90;

    // Field (2 chars): 20° lon x 10° lat
    const field1 = String.fromCharCode(65 + Math.floor(adjLon / 20));
    const field2 = String.fromCharCode(65 + Math.floor(adjLat / 10));

    // Square (2 digits): 2° lon x 1° lat
    const square1 = Math.floor((adjLon % 20) / 2);
    const square2 = Math.floor((adjLat % 10) / 1);

    // Subsquare (2 chars): 5' lon x 2.5' lat
    const subsq1 = String.fromCharCode(65 + Math.floor(((adjLon % 2) * 60) / 5));
    const subsq2 = String.fromCharCode(65 + Math.floor(((adjLat % 1) * 60) / 2.5));

    return `${field1}${field2}${square1}${square2}${subsq1}${subsq2}`.toUpperCase();
  }

  // Persistent RBN connection and spot storage
  let rbnConnection = null;
  // Index spots by DX callsign (the station being heard) so each station's spots
  // are preserved even when the stream produces thousands of spots per second.
  // Old approach used a flat 2000-spot buffer — user's 3 spots drowned in the firehose.
  const rbnSpotsByDX = new Map(); // Map<dxCallsign, spot[]>
  const rbnSpotsBySpotter = new Map(); // Map<spotterCallsign, spot[]>
  const MAX_SPOTS_PER_DX = 50; // Keep up to 50 spots per DX station
  const MAX_SPOTS_PER_SPOTTER = 100; // Skimmers hear many stations; allow more
  const MAX_DX_CALLSIGNS = 5000; // Track up to 5000 unique DX stations
  const MAX_SPOTTER_CALLSIGNS = 2000; // ~1000 active RBN skimmers worldwide
  const RBN_SPOT_TTL = 30 * 60 * 1000; // 30 minutes
  const callsignLocationCache = new Map(); // Cache for skimmer/station locations
  const LOCATION_CACHE_MAX = 2000; // ~1000 active RBN skimmers worldwide, 2x headroom

  function cacheCallsignLocation(call, data) {
    if (callsignLocationCache.size >= LOCATION_CACHE_MAX && !callsignLocationCache.has(call)) {
      const oldest = callsignLocationCache.keys().next().value;
      if (oldest) callsignLocationCache.delete(oldest);
    }
    callsignLocationCache.set(call, data);
  }
  let rbnSpotCount = 0; // Total spots received (for stats)

  // Helper function to convert frequency to band
  function freqToBandKHz(freqKHz) {
    if (freqKHz >= 1800 && freqKHz < 2000) return '160m';
    if (freqKHz >= 3500 && freqKHz < 4000) return '80m';
    if (freqKHz >= 7000 && freqKHz < 7300) return '40m';
    if (freqKHz >= 10100 && freqKHz < 10150) return '30m';
    if (freqKHz >= 14000 && freqKHz < 14350) return '20m';
    if (freqKHz >= 18068 && freqKHz < 18168) return '17m';
    if (freqKHz >= 21000 && freqKHz < 21450) return '15m';
    if (freqKHz >= 24890 && freqKHz < 24990) return '12m';
    if (freqKHz >= 28000 && freqKHz < 29700) return '10m';
    if (freqKHz >= 40000 && freqKHz < 42000) return '8m';
    if (freqKHz >= 50000 && freqKHz < 54000) return '6m';
    if (freqKHz >= 70000 && freqKHz < 70500) return '4m';
    return 'Other';
  }

  /**
   * Maintain persistent connection to RBN Telnet
   */
  function maintainRBNConnection(port = 7000) {
    if (rbnConnection && !rbnConnection.destroyed) {
      return; // Already connected
    }

    console.log(`[RBN] Creating persistent connection to telnet.reversebeacon.net:${port}...`);

    let dataBuffer = '';
    let authenticated = false;
    const userCallsign = 'OPENHAMCLOCK'; // Generic callsign for the app

    const client = net.createConnection(
      {
        host: 'telnet.reversebeacon.net',
        port: port,
      },
      () => {
        console.log(`[RBN] Persistent connection established`);
      },
    );

    client.setEncoding('utf8');
    client.setKeepAlive(true, 60000); // Keep alive every 60s

    client.on('data', (data) => {
      dataBuffer += data;

      // Check for authentication prompt
      if (!authenticated && dataBuffer.includes('Please enter your call:')) {
        console.log(`[RBN] Authenticating as ${userCallsign}`);
        client.write(`${userCallsign}\r\n`);
        authenticated = true;
        dataBuffer = '';
        return;
      }

      const lines = dataBuffer.split('\n');
      dataBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        // Start collecting after authentication
        if (authenticated && line.includes('Connected')) {
          console.log(`[RBN] Authenticated, now streaming spots...`);
          continue;
        }

        // Parse RBN spot line format:
        // CW:   DX de W3LPL-#:     7003.0  K3LR           CW    30 dB  23 WPM  CQ      0123Z
        // FT8:  DX de KM3T-#:     14074.0  K3LR           FT8   -12 dB              CQ      0123Z
        // RTTY: DX de W3LPL-#:    14080.0  K3LR           RTTY  15 dB  45 BPS  CQ      0123Z
        const spotMatch = line.match(/DX de\s+(\S+)\s*:\s*([\d.]+)\s+(\S+)\s+(\S+)\s+([-\d]+)\s+dB/);

        if (spotMatch) {
          const [, skimmer, freq, dx, mode, snr] = spotMatch;
          // Optionally extract WPM or BPS after dB
          const speedMatch = line.match(/(\d+)\s+(WPM|BPS)/i);
          const wpm = speedMatch ? parseInt(speedMatch[1]) : null;
          const speedUnit = speedMatch ? speedMatch[2].toUpperCase() : null;
          const timestamp = Date.now();
          const freqNum = parseFloat(freq) * 1000;
          const band = freqToBandKHz(freqNum / 1000);

          const spot = {
            callsign: skimmer.replace(/-#.*$/, ''),
            skimmerFull: skimmer,
            dx: dx,
            frequency: freqNum,
            freqMHz: parseFloat(freq),
            band: band,
            mode: mode,
            snr: parseInt(snr),
            wpm: wpm,
            speedUnit: speedUnit,
            timestamp: new Date().toISOString(),
            timestampMs: timestamp,
            age: 0,
            source: 'rbn-telnet',
            grid: null, // Will be filled by location lookup
          };

          // Store indexed by DX callsign (the station being heard)
          const dxUpper = dx.toUpperCase();
          if (!rbnSpotsByDX.has(dxUpper)) {
            // Evict oldest DX callsign if at capacity
            if (rbnSpotsByDX.size >= MAX_DX_CALLSIGNS) {
              const oldestKey = rbnSpotsByDX.keys().next().value;
              rbnSpotsByDX.delete(oldestKey);
            }
            rbnSpotsByDX.set(dxUpper, []);
          }

          const dxSpots = rbnSpotsByDX.get(dxUpper);
          dxSpots.push(spot);

          // Cap per-DX buffer
          if (dxSpots.length > MAX_SPOTS_PER_DX) {
            dxSpots.shift();
          }

          // Also index by spotter/skimmer callsign (for "what does this skimmer hear?" queries)
          const spotterUpper = spot.callsign.toUpperCase();
          if (!rbnSpotsBySpotter.has(spotterUpper)) {
            if (rbnSpotsBySpotter.size >= MAX_SPOTTER_CALLSIGNS) {
              const oldestKey = rbnSpotsBySpotter.keys().next().value;
              rbnSpotsBySpotter.delete(oldestKey);
            }
            rbnSpotsBySpotter.set(spotterUpper, []);
          }
          const spotterSpots = rbnSpotsBySpotter.get(spotterUpper);
          spotterSpots.push(spot);
          if (spotterSpots.length > MAX_SPOTS_PER_SPOTTER) {
            spotterSpots.shift();
          }

          rbnSpotCount++;
        }
      }
    });

    client.on('error', (err) => {
      console.error(`[RBN] Connection error: ${err.message}`);
      rbnConnection = null;
      // Reconnect after 5 seconds
      setTimeout(() => maintainRBNConnection(port), 5000);
    });

    client.on('close', () => {
      console.log(`[RBN] Connection closed, reconnecting in 5s...`);
      rbnConnection = null;
      setTimeout(() => maintainRBNConnection(port), 5000);
    });

    rbnConnection = client;
  }

  // Start persistent connection on server startup
  maintainRBNConnection(7000);

  // Periodic cleanup of expired spots from the DX-indexed map
  setInterval(() => {
    const cutoff = Date.now() - RBN_SPOT_TTL;
    let cleaned = 0;
    for (const [dxCall, spots] of rbnSpotsByDX) {
      const before = spots.length;
      const filtered = spots.filter((s) => s.timestampMs > cutoff);
      if (filtered.length === 0) {
        rbnSpotsByDX.delete(dxCall);
        cleaned += before;
      } else if (filtered.length < before) {
        rbnSpotsByDX.set(dxCall, filtered);
        cleaned += before - filtered.length;
      }
    }
    for (const [spotterCall, spots] of rbnSpotsBySpotter) {
      const before = spots.length;
      const filtered = spots.filter((s) => s.timestampMs > cutoff);
      if (filtered.length === 0) {
        rbnSpotsBySpotter.delete(spotterCall);
        cleaned += before;
      } else if (filtered.length < before) {
        rbnSpotsBySpotter.set(spotterCall, filtered);
        cleaned += before - filtered.length;
      }
    }
    if (cleaned > 0) {
      console.log(
        `[RBN] Cleanup: removed ${cleaned} expired spots, tracking ${rbnSpotsByDX.size} DX stations, ${rbnSpotsBySpotter.size} spotters`,
      );
    }
    // Also purge expired rbnApiCaches entries (10s TTL, but entries never removed otherwise)
    const apiCutoff = Date.now() - 60000; // Keep entries under 1 minute (6x the 10s TTL)
    for (const [call, entry] of rbnApiCaches) {
      if (entry.timestamp < apiCutoff) rbnApiCaches.delete(call);
    }
  }, 60000); // Run every 60 seconds

  // Helper: enrich a spot with skimmer location data
  // Uses sequential processing to avoid any concurrent lookup issues
  async function enrichSpotWithLocation(spot) {
    const skimmerCall = spot.callsign;

    // Check cache first (includes negative cache entries)
    if (callsignLocationCache.has(skimmerCall)) {
      const location = callsignLocationCache.get(skimmerCall);
      // Negative cache entry — skip lookup unless expired
      if (location._failed) {
        if (location._expires && Date.now() > location._expires) {
          callsignLocationCache.delete(skimmerCall); // Expired, allow retry
        } else {
          return spot;
        }
      } else {
        return {
          ...spot,
          grid: location.grid,
          skimmerLat: location.lat,
          skimmerLon: location.lon,
          skimmerCountry: location.country,
        };
      }
    }

    // Lookup location (don't block on failures)
    try {
      const response = await fetch(`http://localhost:${PORT}/api/callsign/${encodeURIComponent(skimmerCall)}`);
      if (response.ok) {
        const locationData = await response.json();

        // Verify the API returned data for the callsign we asked for
        // (guards against any response mix-up or redirect)
        const returnedCall = (locationData.callsign || '').toUpperCase();
        const requestedBase = extractBaseCallsign(skimmerCall);
        if (returnedCall && returnedCall !== requestedBase && returnedCall !== skimmerCall.toUpperCase()) {
          logDebug(`[RBN] Callsign mismatch! Requested: ${skimmerCall}, Got: ${returnedCall} — discarding`);
          return spot;
        }

        // Validate coordinates are reasonable
        if (
          typeof locationData.lat === 'number' &&
          typeof locationData.lon === 'number' &&
          Math.abs(locationData.lat) <= 90 &&
          Math.abs(locationData.lon) <= 180
        ) {
          // Cross-validate: compare returned location against prefix estimate
          // If they're wildly different, the lookup data may be wrong
          const prefixLoc = estimateLocationFromPrefix(requestedBase);
          if (prefixLoc) {
            const prefixCoords = maidenheadToLatLon(prefixLoc.grid);
            if (prefixCoords) {
              const dist = haversineDistance(locationData.lat, locationData.lon, prefixCoords.lat, prefixCoords.lon);
              if (dist > 5000) {
                // Location is > 5000 km from where the callsign prefix says it should be
                // This is almost certainly wrong data — use prefix estimate instead
                logDebug(
                  `[RBN] Location sanity check FAILED for ${skimmerCall}: lookup=${locationData.lat.toFixed(1)},${locationData.lon.toFixed(1)} vs prefix=${prefixCoords.lat.toFixed(1)},${prefixCoords.lon.toFixed(1)} (${Math.round(dist)} km apart) — using prefix`,
                );
                const grid = latLonToGrid(prefixCoords.lat, prefixCoords.lon);
                const location = {
                  callsign: skimmerCall,
                  grid: grid,
                  lat: prefixCoords.lat,
                  lon: prefixCoords.lon,
                  country: prefixLoc.country || locationData.country,
                };
                cacheCallsignLocation(skimmerCall, location);
                return {
                  ...spot,
                  grid: grid,
                  skimmerLat: prefixCoords.lat,
                  skimmerLon: prefixCoords.lon,
                  skimmerCountry: location.country,
                };
              }
            }
          }

          const grid = latLonToGrid(locationData.lat, locationData.lon);

          const location = {
            callsign: skimmerCall,
            grid: grid,
            lat: locationData.lat,
            lon: locationData.lon,
            country: locationData.country,
          };

          // Cache permanently
          cacheCallsignLocation(skimmerCall, location);

          return {
            ...spot,
            grid: grid,
            skimmerLat: locationData.lat,
            skimmerLon: locationData.lon,
            skimmerCountry: locationData.country,
          };
        }
      }
    } catch (err) {
      // Cache the failure for 10 min to prevent retry storm when QRZ/HamQTH is down
      cacheCallsignLocation(skimmerCall, { _failed: true, _expires: Date.now() + 10 * 60 * 1000 });
    }

    return spot;
  }

  // Helper: enrich a spot with DX station location data (for spotter mode)
  async function enrichSpotWithDXLocation(spot) {
    const dxCall = (spot.dx || '').toUpperCase();
    if (!dxCall) return spot;

    if (callsignLocationCache.has(dxCall)) {
      const location = callsignLocationCache.get(dxCall);
      if (location._failed) {
        if (location._expires && Date.now() > location._expires) {
          callsignLocationCache.delete(dxCall);
        } else {
          return spot;
        }
      } else {
        return {
          ...spot,
          dxLat: location.lat,
          dxLon: location.lon,
          dxGrid: location.grid,
          dxCountry: location.country,
        };
      }
    }

    try {
      const response = await fetch(`http://localhost:${PORT}/api/callsign/${encodeURIComponent(dxCall)}`);
      if (response.ok) {
        const locationData = await response.json();
        if (
          typeof locationData.lat === 'number' &&
          typeof locationData.lon === 'number' &&
          Math.abs(locationData.lat) <= 90 &&
          Math.abs(locationData.lon) <= 180
        ) {
          const grid = latLonToGrid(locationData.lat, locationData.lon);
          const location = {
            callsign: dxCall,
            grid: grid,
            lat: locationData.lat,
            lon: locationData.lon,
            country: locationData.country,
          };
          cacheCallsignLocation(dxCall, location);
          return {
            ...spot,
            dxLat: locationData.lat,
            dxLon: locationData.lon,
            dxGrid: grid,
            dxCountry: locationData.country,
          };
        }
      }
    } catch (err) {
      cacheCallsignLocation(dxCall, { _failed: true, _expires: Date.now() + 10 * 60 * 1000 });
    }

    return spot;
  }

  // Cache for RBN API responses (per-callsign)
  const rbnApiCaches = new Map(); // Map<callsign, {data, timestamp}>
  const RBN_API_CACHE_TTL = 10000; // 10 seconds — short so new spots appear quickly

  // Primary endpoint: get RBN spots
  // GET /api/rbn/spots?callsign=WB3IZU&minutes=5            — who is hearing WB3IZU? (mode=dx, default)
  // GET /api/rbn/spots?callsign=W3LPL&minutes=5&mode=spotter — what is skimmer W3LPL hearing?
  // GET /api/rbn/spots?callsigns=4U1UN,VE8AT,...&minutes=5  — bulk dx lookup (IBP cross-reference)
  app.get('/api/rbn/spots', async (req, res) => {
    const minutes = Math.min(parseInt(req.query.minutes) || 15, 30);

    // ── Multi-callsign bulk path (IBP beacon cross-reference) ──────────────
    if (req.query.callsigns) {
      const callsigns = req.query.callsigns
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0 && s !== 'N0CALL')
        .slice(0, 30); // cap to prevent abuse

      const now = Date.now();
      const cutoff = now - minutes * 60 * 1000;
      const results = {};

      // Process callsigns sequentially to avoid concurrent location-lookup races
      for (const cs of callsigns) {
        const cacheKey = `dx:${cs}`;
        const cached = rbnApiCaches.get(cacheKey);
        if (cached && now - cached.timestamp < RBN_API_CACHE_TTL) {
          results[cs] = { count: cached.data.count, spots: cached.data.spots };
          continue;
        }

        const rawSpots = rbnSpotsByDX.get(cs) || [];
        const recentSpots = rawSpots.filter((spot) => spot.timestampMs > cutoff);
        const enrichedSpots = [];
        for (const spot of recentSpots) {
          enrichedSpots.push(await enrichSpotWithLocation(spot));
        }

        const entry = {
          count: enrichedSpots.length,
          spots: enrichedSpots,
          mode: 'dx',
          minutes,
          timestamp: new Date().toISOString(),
          source: 'rbn-telnet-stream',
        };
        rbnApiCaches.set(cacheKey, { data: entry, timestamp: now });
        results[cs] = { count: entry.count, spots: entry.spots };
      }

      logDebug(`[RBN] Bulk: returning spots for ${callsigns.length} callsigns`);
      return res.json({ minutes, timestamp: new Date().toISOString(), results });
    }

    // ── Single-callsign path (existing behaviour) ──────────────────────────
    const callsign = (req.query.callsign || '').toUpperCase().trim();
    const mode = (req.query.mode || 'dx').toLowerCase() === 'spotter' ? 'spotter' : 'dx';

    if (!callsign || callsign === 'N0CALL') {
      return res.json({
        count: 0,
        spots: [],
        mode,
        minutes,
        timestamp: new Date().toISOString(),
        source: 'rbn-telnet-stream',
      });
    }

    const now = Date.now();

    // Check per-callsign+mode cache
    const cacheKey = `${mode}:${callsign}`;
    const cached = rbnApiCaches.get(cacheKey);
    if (cached && now - cached.timestamp < RBN_API_CACHE_TTL) {
      return res.json(cached.data);
    }

    const cutoff = now - minutes * 60 * 1000;

    // Direct O(1) lookup — by DX callsign or by spotter callsign
    const rawSpots = mode === 'spotter' ? rbnSpotsBySpotter.get(callsign) || [] : rbnSpotsByDX.get(callsign) || [];
    const recentSpots = rawSpots.filter((spot) => spot.timestampMs > cutoff);

    // Enrich with locations — process sequentially to avoid
    // concurrent lookup race conditions that can mix up locations
    const enrichedSpots = [];
    for (const spot of recentSpots) {
      let enriched = await enrichSpotWithLocation(spot);
      if (mode === 'spotter') {
        enriched = await enrichSpotWithDXLocation(enriched);
      }
      enrichedSpots.push(enriched);
    }

    logDebug(
      `[RBN] Returning ${enrichedSpots.length} ${mode} spots for ${callsign} (last ${minutes} min, ${rbnSpotsByDX.size} DX stations, ${rbnSpotsBySpotter.size} spotters tracked)`,
    );

    const response = {
      count: enrichedSpots.length,
      spots: enrichedSpots,
      mode: mode,
      minutes: minutes,
      timestamp: new Date().toISOString(),
      source: 'rbn-telnet-stream',
    };

    // Cache the response per callsign+mode
    rbnApiCaches.set(cacheKey, { data: response, timestamp: Date.now() });

    res.json(response);
  });

  // Endpoint to lookup skimmer location (cached permanently)
  app.get('/api/rbn/location/:callsign', async (req, res) => {
    const callsign = req.params.callsign.toUpperCase().replace(/[^\w\-\/]/g, '');
    if (!callsign || callsign.length > 15) {
      return res.status(400).json({ error: 'Invalid callsign' });
    }

    // Check cache first
    if (callsignLocationCache.has(callsign)) {
      return res.json(callsignLocationCache.get(callsign));
    }

    try {
      // Look up via HamQTH
      const response = await fetch(`http://localhost:${PORT}/api/callsign/${encodeURIComponent(callsign)}`);
      if (response.ok) {
        const locationData = await response.json();
        const grid = latLonToGrid(locationData.lat, locationData.lon);

        const result = {
          callsign: callsign,
          grid: grid,
          lat: locationData.lat,
          lon: locationData.lon,
          country: locationData.country,
        };

        // Cache permanently (skimmers don't move!)
        cacheCallsignLocation(callsign, result);

        return res.json(result);
      }
    } catch (err) {
      logErrorOnce('RBN', `Failed to lookup ${callsign}: ${err.message}`);
    }

    res.status(404).json({ error: 'Location not found' });
  });

  // Legacy endpoint for compatibility (deprecated)
  app.get('/api/rbn', async (req, res) => {
    logWarn('[RBN] Warning: Using deprecated /api/rbn endpoint, use /api/rbn/spots instead');

    const callsign = (req.query.callsign || '').toUpperCase().trim();
    const minutes = parseInt(req.query.minutes) || 30;
    const limit = parseInt(req.query.limit) || 100;

    if (!callsign || callsign === 'N0CALL') {
      return res.json([]);
    }

    const now = Date.now();
    const cutoff = now - minutes * 60 * 1000;

    // Filter spots for this callsign
    const userSpots = rbnSpots
      .filter((spot) => spot.timestampMs > cutoff && spot.dx.toUpperCase() === callsign)
      .slice(-limit);

    res.json(userSpots);
  });
  // ============================================
  // WSPR PROPAGATION HEATMAP API
  // ============================================

  // WSPR heatmap endpoint - gets global propagation data
  // Uses PSK Reporter to fetch WSPR mode spots from the last N minutes
  let wsprCache = { data: null, timestamp: 0 };
  const WSPR_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache - be kind to PSKReporter
  const WSPR_STALE_TTL = 60 * 60 * 1000; // Serve stale data up to 1 hour

  // Aggregate WSPR spots by 4-character grid square for bandwidth efficiency
  // Reduces payload from ~2MB to ~50KB while preserving heatmap visualization
  function aggregateWSPRByGrid(spots) {
    const grids = new Map();
    const paths = new Map();

    for (const spot of spots) {
      // Get 4-char grids (field + square, e.g., "EM48")
      const senderGrid4 = spot.senderGrid?.substring(0, 4)?.toUpperCase();
      const receiverGrid4 = spot.receiverGrid?.substring(0, 4)?.toUpperCase();

      // Aggregate sender grid stats
      if (senderGrid4 && spot.senderLat && spot.senderLon) {
        if (!grids.has(senderGrid4)) {
          grids.set(senderGrid4, {
            grid: senderGrid4,
            lat: spot.senderLat,
            lon: spot.senderLon,
            txCount: 0,
            rxCount: 0,
            snrSum: 0,
            snrCount: 0,
            bands: {},
            maxDistance: 0,
            stations: new Set(),
          });
        }
        const g = grids.get(senderGrid4);
        g.txCount++;
        if (spot.snr !== null && spot.snr !== undefined) {
          g.snrSum += spot.snr;
          g.snrCount++;
        }
        g.bands[spot.band] = (g.bands[spot.band] || 0) + 1;
        if (spot.distance > g.maxDistance) g.maxDistance = spot.distance;
        if (spot.sender) g.stations.add(spot.sender);
      }

      // Aggregate receiver grid stats
      if (receiverGrid4 && spot.receiverLat && spot.receiverLon) {
        if (!grids.has(receiverGrid4)) {
          grids.set(receiverGrid4, {
            grid: receiverGrid4,
            lat: spot.receiverLat,
            lon: spot.receiverLon,
            txCount: 0,
            rxCount: 0,
            snrSum: 0,
            snrCount: 0,
            bands: {},
            maxDistance: 0,
            stations: new Set(),
          });
        }
        const g = grids.get(receiverGrid4);
        g.rxCount++;
        if (spot.receiver) g.stations.add(spot.receiver);
      }

      // Track paths between grid squares
      if (senderGrid4 && receiverGrid4 && senderGrid4 !== receiverGrid4) {
        const pathKey = `${senderGrid4}-${receiverGrid4}`;
        if (!paths.has(pathKey)) {
          paths.set(pathKey, {
            from: senderGrid4,
            to: receiverGrid4,
            fromLat: spot.senderLat,
            fromLon: spot.senderLon,
            toLat: spot.receiverLat,
            toLon: spot.receiverLon,
            count: 0,
            snrSum: 0,
            snrCount: 0,
            bands: {},
          });
        }
        const p = paths.get(pathKey);
        p.count++;
        if (spot.snr !== null && spot.snr !== undefined) {
          p.snrSum += spot.snr;
          p.snrCount++;
        }
        p.bands[spot.band] = (p.bands[spot.band] || 0) + 1;
      }
    }

    // Convert to arrays and compute averages
    const gridArray = Array.from(grids.values())
      .map((g) => ({
        grid: g.grid,
        lat: g.lat,
        lon: g.lon,
        txCount: g.txCount,
        rxCount: g.rxCount,
        totalActivity: g.txCount + g.rxCount,
        avgSnr: g.snrCount > 0 ? Math.round(g.snrSum / g.snrCount) : null,
        bands: g.bands,
        maxDistance: g.maxDistance,
        stationCount: g.stations.size,
      }))
      .sort((a, b) => b.totalActivity - a.totalActivity);

    // Top 200 paths by activity (limit for bandwidth)
    const pathArray = Array.from(paths.values())
      .map((p) => ({
        from: p.from,
        to: p.to,
        fromLat: p.fromLat,
        fromLon: p.fromLon,
        toLat: p.toLat,
        toLon: p.toLon,
        count: p.count,
        avgSnr: p.snrCount > 0 ? Math.round(p.snrSum / p.snrCount) : null,
        bands: p.bands,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 200);

    // Band activity summary
    const bandActivity = {};
    for (const spot of spots) {
      if (spot.band) {
        bandActivity[spot.band] = (bandActivity[spot.band] || 0) + 1;
      }
    }

    return {
      grids: gridArray,
      paths: pathArray,
      bandActivity,
      totalSpots: spots.length,
      uniqueGrids: gridArray.length,
      uniquePaths: paths.size,
    };
  }

  app.get('/api/wspr/heatmap', async (req, res) => {
    const minutes = parseInt(req.query.minutes) || 30;
    const band = req.query.band || 'all';
    const raw = req.query.raw === 'true';
    const now = Date.now();

    // Cache key for this exact query
    const cacheKey = `wspr:${minutes}:${band}:${raw ? 'raw' : 'agg'}`;

    // 1. Fresh cache hit — serve immediately
    if (wsprCache.data && wsprCache.data.cacheKey === cacheKey && now - wsprCache.timestamp < WSPR_CACHE_TTL) {
      return res.json({ ...wsprCache.data.result, cached: true });
    }

    // 2. Backoff active (WSPR HTTP endpoint has its own backoff, separate from MQTT PSKReporter)
    if (upstream.isBackedOff('wspr')) {
      if (wsprCache.data && wsprCache.data.cacheKey === cacheKey) {
        return res.json({ ...wsprCache.data.result, cached: true, stale: true });
      }
      return res.json({
        grids: [],
        paths: [],
        totalSpots: 0,
        minutes,
        band,
        format: 'aggregated',
        backoff: true,
      });
    }

    // 3. Stale-while-revalidate: if stale data exists, serve it and refresh in background
    const hasStale =
      wsprCache.data && wsprCache.data.cacheKey === cacheKey && now - wsprCache.timestamp < WSPR_STALE_TTL;

    // 4. Deduplicated upstream fetch — WSPR is global data, so all users share ONE in-flight request
    const doFetch = () =>
      upstream.fetch(cacheKey, async () => {
        const flowStartSeconds = -Math.abs(minutes * 60);
        const url = `https://retrieve.pskreporter.info/query?mode=WSPR&flowStartSeconds=${flowStartSeconds}&rronly=1&nolocator=0&appcontact=openhamclock&rptlimit=2000`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'OpenHamClock/15.2.12 (Amateur Radio Dashboard)',
            Accept: '*/*',
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const backoffSecs = upstream.recordFailure('wspr', response.status);
          throw new Error(`HTTP ${response.status} — backing off for ${backoffSecs}s`);
        }

        const xml = await response.text();
        const spots = [];

        const reportRegex = /<receptionReport[^>]*>/g;
        let match;
        while ((match = reportRegex.exec(xml)) !== null) {
          const report = match[0];
          const getAttr = (name) => {
            const m = report.match(new RegExp(`${name}="([^"]*)"`));
            return m ? m[1] : null;
          };

          const receiverCallsign = getAttr('receiverCallsign');
          const receiverLocator = getAttr('receiverLocator');
          const senderCallsign = getAttr('senderCallsign');
          const senderLocator = getAttr('senderLocator');
          const frequency = getAttr('frequency');
          const mode = getAttr('mode');
          const flowStartSecs = getAttr('flowStartSeconds');
          const sNR = getAttr('sNR');
          const power = getAttr('senderPower');
          const distance = getAttr('senderDistance');
          const senderAz = getAttr('senderAzimuth');
          const receiverAz = getAttr('receiverAzimuth');
          const drift = getAttr('drift');

          if (receiverCallsign && senderCallsign && senderLocator && receiverLocator) {
            const freq = frequency ? parseInt(frequency) : null;
            const spotBand = freq ? getBandFromHz(freq) : 'Unknown';

            if (band !== 'all' && spotBand !== band) continue;

            const senderLoc = gridToLatLon(senderLocator);
            const receiverLoc = gridToLatLon(receiverLocator);

            if (senderLoc && receiverLoc) {
              const powerWatts = power ? parseFloat(power) : null;
              const powerDbm = powerWatts ? (10 * Math.log10(powerWatts * 1000)).toFixed(0) : null;
              const dist = distance ? parseInt(distance) : null;
              const kPerW = dist && powerWatts && powerWatts > 0 ? Math.round(dist / powerWatts) : null;

              spots.push({
                sender: senderCallsign,
                senderGrid: senderLocator,
                senderLat: senderLoc.lat,
                senderLon: senderLoc.lon,
                receiver: receiverCallsign,
                receiverGrid: receiverLocator,
                receiverLat: receiverLoc.lat,
                receiverLon: receiverLoc.lon,
                freq: freq,
                freqMHz: freq ? (freq / 1000000).toFixed(6) : null,
                band: spotBand,
                snr: sNR ? parseInt(sNR) : null,
                power: powerWatts,
                powerDbm: powerDbm,
                distance: dist,
                senderAz: senderAz ? parseInt(senderAz) : null,
                receiverAz: receiverAz ? parseInt(receiverAz) : null,
                drift: drift ? parseInt(drift) : null,
                kPerW: kPerW,
                timestamp: flowStartSecs ? parseInt(flowStartSecs) * 1000 : Date.now(),
                age: flowStartSecs ? Math.floor((Date.now() / 1000 - parseInt(flowStartSecs)) / 60) : 0,
              });
            }
          }
        }

        spots.sort((a, b) => b.timestamp - a.timestamp);
        upstream.recordSuccess('wspr');

        let result;
        if (raw) {
          result = {
            count: spots.length,
            spots,
            minutes,
            band,
            timestamp: new Date().toISOString(),
            source: 'pskreporter',
            format: 'raw',
          };
          logDebug(`[WSPR Heatmap] Returning ${spots.length} raw spots (${minutes}min, band: ${band})`);
        } else {
          const aggregated = aggregateWSPRByGrid(spots);
          result = {
            ...aggregated,
            minutes,
            band,
            timestamp: new Date().toISOString(),
            source: 'pskreporter',
            format: 'aggregated',
          };
          logDebug(
            `[WSPR Heatmap] Aggregated ${spots.length} spots → ${aggregated.uniqueGrids} grids, ${aggregated.paths.length} paths (${minutes}min, band: ${band})`,
          );
        }

        wsprCache = { data: { result, cacheKey }, timestamp: Date.now() };
        return result;
      });

    if (hasStale) {
      // Stale-while-revalidate: respond with stale data now, refresh in background
      doFetch().catch(() => {});
      return res.json({ ...wsprCache.data.result, cached: true, stale: true });
    }

    // No stale data — must wait for upstream
    try {
      const result = await doFetch();
      res.json(result);
    } catch (error) {
      // Use stable key for dedup (backoff seconds change every time)
      logErrorOnce('WSPR Heatmap', error.message.replace(/\d+s$/, 'Xs'));
      if (wsprCache.data && wsprCache.data.cacheKey === cacheKey) {
        return res.json({ ...wsprCache.data.result, cached: true, stale: true });
      }
      res.json({
        grids: [],
        paths: [],
        totalSpots: 0,
        minutes,
        band,
        format: 'aggregated',
        error: error.message,
      });
    }
  });

  // Return shared state
  return { rbnSpotsByDX, rbnApiCaches };
};
