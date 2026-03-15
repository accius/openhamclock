/**
 * Callsign lookup routes — QRZ, HamQTH, prefix estimation.
 * Lines ~4194-6094 of original server.js
 */

const fs = require('fs');
const path = require('path');
const { lookupCall } = require('../../src/server/ctydat.js');

module.exports = function (app, ctx) {
  const {
    fetch,
    CONFIG,
    APP_VERSION,
    ROOT_DIR,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    writeLimiter,
    requireWriteAuth,
  } = ctx;

  // Cache for callsign lookups - callsigns don't change location often
  const callsignLookupCache = new Map(); // key = callsign, value = { data, timestamp }
  const CALLSIGN_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  const CALLSIGN_CACHE_MAX = 5000; // Hard cap — evict oldest when exceeded

  // Periodic cleanup: purge expired entries every 30 minutes
  setInterval(
    () => {
      const now = Date.now();
      let purged = 0;
      for (const [call, entry] of callsignLookupCache) {
        if (now - entry.timestamp > CALLSIGN_CACHE_TTL) {
          callsignLookupCache.delete(call);
          purged++;
        }
      }
      // If still over cap after TTL purge, evict oldest entries
      if (callsignLookupCache.size > CALLSIGN_CACHE_MAX) {
        const sorted = [...callsignLookupCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toRemove = sorted.slice(0, callsignLookupCache.size - CALLSIGN_CACHE_MAX);
        for (const [call] of toRemove) {
          callsignLookupCache.delete(call);
          purged++;
        }
      }
      if (purged > 0)
        logDebug(
          `[Cache] Callsign lookup: purged ${purged} expired/excess entries, ${callsignLookupCache.size} remaining`,
        );
    },
    30 * 60 * 1000,
  );

  // Helper: add to cache with size enforcement — prevents unbounded growth between cleanups
  function cacheCallsignLookup(call, data) {
    if (callsignLookupCache.size >= CALLSIGN_CACHE_MAX && !callsignLookupCache.has(call)) {
      // Evict oldest entry to make room
      const oldest = callsignLookupCache.keys().next().value;
      if (oldest) callsignLookupCache.delete(oldest);
    }
    callsignLookupCache.set(call, data);
  }

  // ── Extract base callsign from decorated/portable calls ──
  // Strips prefixes (5Z4/OZ6ABL → OZ6ABL) and suffixes (UA1TAN/M → UA1TAN)
  // so lookups hit QRZ/HamQTH with the home callsign, not the operating indicator.
  //
  // Rules:
  //   UA1TAN/M, /P, /QRP, /MM, /AM, /R, /T  → UA1TAN  (known modifiers)
  //   W1ABC/6                                 → W1ABC   (US call area override)
  //   5Z4/OZ6ABL, DL/AA7BQ, VE3/W1ABC        → OZ6ABL, AA7BQ, W1ABC  (pick the home call)
  //
  // Heuristic: split on '/', pick the segment that looks most like a full callsign
  // (has digits AND letters, and is the longest non-modifier segment).
  function extractBaseCallsign(raw) {
    if (!raw || typeof raw !== 'string') return raw || '';
    const call = raw.toUpperCase().trim();

    if (!call.includes('/')) return call;

    const parts = call.split('/');

    // Known suffixes that are always modifiers (not callsigns)
    const MODIFIERS = new Set([
      'M',
      'P',
      'QRP',
      'MM',
      'AM',
      'R',
      'T',
      'B',
      'BCN',
      'LH',
      'A',
      'E',
      'J',
      'AG',
      'AE',
      'KT',
    ]);

    // Filter out known modifiers and single digits (call area overrides like /6)
    const candidates = parts.filter((p) => {
      if (!p) return false;
      if (MODIFIERS.has(p)) return false;
      if (/^\d$/.test(p)) return false; // Single digit = call area
      return true;
    });

    if (candidates.length === 0) return parts[0] || call;
    if (candidates.length === 1) return candidates[0];

    // Multiple candidates (e.g. "5Z4/OZ6ABL") — pick the one that looks most like a full callsign
    // A full callsign has: prefix letters, digit(s), suffix letters (e.g. OZ6ABL, AA7BQ, W1ABC)
    const callsignPattern = /^[A-Z]{1,3}\d{1,4}[A-Z]{1,4}$/;

    // Prefer the segment matching a full callsign pattern
    const fullMatches = candidates.filter((c) => callsignPattern.test(c));
    if (fullMatches.length === 1) return fullMatches[0];

    // If multiple match (rare) or none match, pick the longest
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
  }

  /**
   * Extract the operating prefix/entity for location and DXCC determination.
   *
   * This is different from extractBaseCallsign (which finds the home call for
   * QRZ lookups). For compound callsigns the DXCC entity is determined by
   * whichever part is NOT a full callsign — i.e. the portable/operating prefix.
   *
   * Examples:
   *   PJ2/W9WI  → PJ2   (operating from Curaçao, not USA)
   *   DL/W1ABC  → DL    (operating from Germany)
   *   W1ABC/DL  → DL    (same — order doesn't matter)
   *   5Z4/OZ6ABL → 5Z4  (operating from Kenya)
   *   UA1TAN/M  → UA1TAN (mobile, same entity)
   *   W9WI/P    → W9WI  (portable, same entity)
   *   W9WI/6    → W9WI  (district change only)
   */
  function extractOperatingPrefix(raw) {
    if (!raw || typeof raw !== 'string') return raw || '';
    const call = raw.toUpperCase().trim();

    if (!call.includes('/')) return call;

    const parts = call.split('/');
    if (parts.length !== 2) return parts[0] || call;

    const [left, right] = parts;

    // If right is a modifier or single-digit district, operating entity = left
    const MODIFIERS = new Set([
      'M',
      'P',
      'QRP',
      'MM',
      'AM',
      'R',
      'T',
      'B',
      'BCN',
      'LH',
      'A',
      'E',
      'J',
      'AG',
      'AE',
      'KT',
    ]);
    if (MODIFIERS.has(right) || /^\d$/.test(right)) return left;

    // A "full callsign" ends with letters after a digit: W9WI, OZ6ABL, AA7BQ
    // A "DXCC prefix" either ends with a digit (PJ2, 5Z4, 3B9) or is pure letters (DL, VK, G)
    const isFullCall = (s) => /^[A-Z]{1,3}\d{1,4}[A-Z]{1,4}$/.test(s);

    const leftFull = isFullCall(left);
    const rightFull = isFullCall(right);

    if (rightFull && !leftFull) return left; // PJ2/W9WI → PJ2, DL/W1ABC → DL
    if (leftFull && !rightFull) return right; // W1ABC/DL → DL

    // Both look like full calls or neither does — default to left
    return left;
  }

  // ── QRZ XML API Session Manager ──
  // QRZ provides the most accurate lat/lon (user-supplied, geocoded, or grid-derived).
  // Requires a QRZ Logbook Data subscription for full data access.
  // Session keys are cached and reused per the QRZ spec; re-login only on expiry.
  const qrzSession = {
    key: null,
    expiry: 0, // Timestamp when session was last validated
    maxAge: 3600000, // Re-validate session every hour
    username: CONFIG._qrzUsername || '',
    password: CONFIG._qrzPassword || '',
    loginInFlight: null, // Dedup concurrent login attempts
    lookupCount: 0,
    lastError: null,
    authFailedUntil: 0, // Cooldown after credential failures — don't retry until this timestamp
    authFailCooldown: 60 * 60 * 1000, // 1 hour cooldown after bad credentials
  };

  // Persist QRZ credentials to a file so they survive restarts (set via Settings UI)
  const QRZ_CREDS_FILE = path.join(ROOT_DIR, '.qrz-credentials');

  function loadQRZCredentials() {
    // .env takes priority
    if (CONFIG._qrzUsername && CONFIG._qrzPassword) {
      qrzSession.username = CONFIG._qrzUsername;
      qrzSession.password = CONFIG._qrzPassword;
      logDebug('[QRZ] Credentials loaded from .env');
      return;
    }
    // Fall back to persisted file from Settings UI
    try {
      if (fs.existsSync(QRZ_CREDS_FILE)) {
        const creds = JSON.parse(fs.readFileSync(QRZ_CREDS_FILE, 'utf8'));
        if (creds.username && creds.password) {
          qrzSession.username = creds.username;
          qrzSession.password = creds.password;
          logDebug('[QRZ] Credentials loaded from .qrz-credentials');
        }
      }
    } catch (e) {
      logDebug('[QRZ] Could not load saved credentials');
    }
  }
  loadQRZCredentials();

  function isQRZConfigured() {
    return !!(qrzSession.username && qrzSession.password);
  }

  // Login to QRZ XML API and obtain a session key
  async function qrzLogin() {
    if (!isQRZConfigured()) return null;

    // Don't retry if credentials failed recently — avoids hammering QRZ with bad creds
    if (Date.now() < qrzSession.authFailedUntil) {
      return null;
    }

    // Dedup: if a login is already in-flight, piggyback on it
    if (qrzSession.loginInFlight) return qrzSession.loginInFlight;

    qrzSession.loginInFlight = (async () => {
      try {
        const url = `https://xmldata.qrz.com/xml/current/?username=${encodeURIComponent(qrzSession.username)};password=${encodeURIComponent(qrzSession.password)};agent=OpenHamClock/${APP_VERSION}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

        if (!response.ok) {
          qrzSession.lastError = `HTTP ${response.status}`;
          return null;
        }

        const xml = await response.text();

        // Parse session key
        const keyMatch = xml.match(/<Key>([^<]+)<\/Key>/);
        const errorMatch = xml.match(/<Error>([^<]+)<\/Error>/);
        const subExpMatch = xml.match(/<SubExp>([^<]+)<\/SubExp>/);

        if (errorMatch) {
          qrzSession.lastError = errorMatch[1];
          // Credential failures get a long cooldown — no point retrying until creds change
          if (
            errorMatch[1].includes('incorrect') ||
            errorMatch[1].includes('Invalid') ||
            errorMatch[1].includes('denied')
          ) {
            qrzSession.authFailedUntil = Date.now() + qrzSession.authFailCooldown;
            console.error(`[QRZ] Login failed: ${errorMatch[1]} — suppressing retries for 1 hour`);
          } else {
            console.error(`[QRZ] Login failed: ${errorMatch[1]}`);
          }
          return null;
        }

        if (keyMatch) {
          qrzSession.key = keyMatch[1];
          qrzSession.expiry = Date.now() + qrzSession.maxAge;
          qrzSession.lastError = null;
          qrzSession.authFailedUntil = 0; // Clear cooldown on success
          const subInfo = subExpMatch ? subExpMatch[1] : 'unknown';
          console.log(`[QRZ] Session established (subscription: ${subInfo})`);
          return qrzSession.key;
        }

        qrzSession.lastError = 'No session key in response';
        return null;
      } catch (err) {
        if (err.name !== 'AbortError') {
          qrzSession.lastError = err.message;
          logErrorOnce('QRZ', `Login error: ${err.message}`);
        }
        return null;
      } finally {
        qrzSession.loginInFlight = null;
      }
    })();

    return qrzSession.loginInFlight;
  }

  // Get a valid QRZ session key (login if needed)
  async function getQRZSessionKey() {
    if (!isQRZConfigured()) return null;

    // Reuse existing key if still fresh
    if (qrzSession.key && Date.now() < qrzSession.expiry) {
      return qrzSession.key;
    }

    return qrzLogin();
  }

  // Look up a callsign via QRZ XML API — returns rich data including geoloc source
  async function qrzLookup(callsign) {
    const sessionKey = await getQRZSessionKey();
    if (!sessionKey) return null;

    try {
      const url = `https://xmldata.qrz.com/xml/current/?s=${sessionKey};callsign=${encodeURIComponent(callsign)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!response.ok) return null;

      const xml = await response.text();

      // Check for session expiry — if so, re-login and retry once
      const errorMatch = xml.match(/<Error>([^<]+)<\/Error>/);
      if (errorMatch) {
        const err = errorMatch[1];
        if (err.includes('Session') || err.includes('Invalid session')) {
          // Session expired — force re-login and retry
          qrzSession.key = null;
          qrzSession.expiry = 0;
          const newKey = await qrzLogin();
          if (newKey) {
            return qrzLookup(callsign); // Retry with new key (recursive, max 1 deep)
          }
        }
        // "Not found" is not an error we need to log
        if (!err.includes('Not found')) {
          logDebug(`[QRZ] Lookup error for ${callsign}: ${err}`);
        }
        return null;
      }

      // Parse callsign data from XML
      const get = (field) => {
        const m = xml.match(new RegExp(`<${field}>([^<]*)</${field}>`));
        return m ? m[1] : null;
      };

      const lat = get('lat');
      const lon = get('lon');

      if (!lat || !lon) return null;

      qrzSession.lookupCount++;

      const result = {
        callsign: get('call') || callsign,
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        grid: get('grid') || '',
        country: get('country') || get('land') || 'Unknown',
        state: get('state') || '',
        county: get('county') || '',
        cqZone: get('cqzone') || '',
        ituZone: get('ituzone') || '',
        fname: get('fname') || '',
        name: get('name') || '',
        geoloc: get('geoloc') || 'unknown', // user|geocode|grid|zip|state|dxcc|none
        source: 'qrz',
      };

      logDebug(`[QRZ] ${callsign}: ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)} (${result.geoloc})`);
      return result;
    } catch (err) {
      if (err.name !== 'AbortError') {
        logErrorOnce('QRZ', `Lookup error: ${err.message}`);
      }
      return null;
    }
  }

  // Look up via HamQTH DXCC API (no auth, but only DXCC-level accuracy)
  async function hamqthLookup(callsign) {
    try {
      const response = await fetch(`https://www.hamqth.com/dxcc.php?callsign=${encodeURIComponent(callsign)}`, {
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) return null;

      const text = await response.text();
      const latMatch = text.match(/<lat>([^<]+)<\/lat>/);
      const lonMatch = text.match(/<lng>([^<]+)<\/lng>/);
      const countryMatch = text.match(/<n>([^<]+)<\/name>/);
      const cqMatch = text.match(/<cq>([^<]+)<\/cq>/);
      const ituMatch = text.match(/<itu>([^<]+)<\/itu>/);

      if (!latMatch || !lonMatch) return null;

      return {
        callsign,
        lat: parseFloat(latMatch[1]),
        lon: parseFloat(lonMatch[1]),
        country: countryMatch ? countryMatch[1] : 'Unknown',
        cqZone: cqMatch ? cqMatch[1] : '',
        ituZone: ituMatch ? ituMatch[1] : '',
        source: 'hamqth',
      };
    } catch (err) {
      if (err.name !== 'AbortError') {
        logErrorOnce('Callsign Lookup', `HamQTH: ${err.message}`);
      }
      return null;
    }
  }

  // ── QRZ Configuration Endpoints ──

  // GET /api/qrz/status — check if QRZ is configured and working
  app.get('/api/qrz/status', (req, res) => {
    res.json({
      configured: isQRZConfigured(),
      hasSession: !!qrzSession.key,
      lookupCount: qrzSession.lookupCount,
      lastError: qrzSession.lastError,
      authCooldownRemaining:
        qrzSession.authFailedUntil > Date.now() ? Math.round((qrzSession.authFailedUntil - Date.now()) / 60000) : 0,
      source: CONFIG._qrzUsername ? 'env' : qrzSession.username ? 'settings' : 'none',
    });
  });

  // POST /api/qrz/configure — save QRZ credentials (from Settings UI)
  app.post('/api/qrz/configure', writeLimiter, requireWriteAuth, async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Test credentials by attempting login
    const oldUsername = qrzSession.username;
    const oldPassword = qrzSession.password;
    const credsChanged = username.trim() !== oldUsername || password.trim() !== oldPassword;
    qrzSession.username = username.trim();
    qrzSession.password = password.trim();
    qrzSession.key = null;
    qrzSession.expiry = 0;
    // Only clear cooldown if credentials actually changed — prevents users from
    // hammering QRZ by re-testing the same bad creds over and over
    if (credsChanged) {
      qrzSession.authFailedUntil = 0;
    } else if (Date.now() < qrzSession.authFailedUntil) {
      // Same bad creds, still in cooldown — reject immediately
      qrzSession.username = oldUsername;
      qrzSession.password = oldPassword;
      return res.status(429).json({
        success: false,
        error: 'QRZ login recently failed with these credentials. Try again later or use different credentials.',
      });
    }

    const key = await qrzLogin();

    if (key) {
      // Credentials work — persist them
      try {
        fs.writeFileSync(
          QRZ_CREDS_FILE,
          JSON.stringify({
            username: qrzSession.username,
            password: qrzSession.password,
          }),
          'utf8',
        );
        fs.chmodSync(QRZ_CREDS_FILE, 0o600); // Owner-only read/write
      } catch (e) {
        console.error('[QRZ] Could not save credentials file:', e.message);
      }

      res.json({
        success: true,
        message: 'QRZ credentials validated and saved',
        lookupCount: qrzSession.lookupCount,
      });
    } else {
      // Restore old credentials
      qrzSession.username = oldUsername;
      qrzSession.password = oldPassword;
      res.status(401).json({
        success: false,
        error: qrzSession.lastError || 'Login failed',
      });
    }
  });

  // POST /api/qrz/remove — remove saved QRZ credentials
  app.post('/api/qrz/remove', writeLimiter, requireWriteAuth, (req, res) => {
    qrzSession.username = CONFIG._qrzUsername || '';
    qrzSession.password = CONFIG._qrzPassword || '';
    qrzSession.key = null;
    qrzSession.expiry = 0;
    qrzSession.lookupCount = 0;
    qrzSession.lastError = null;
    qrzSession.authFailedUntil = 0;

    try {
      if (fs.existsSync(QRZ_CREDS_FILE)) {
        fs.unlinkSync(QRZ_CREDS_FILE);
      }
    } catch (e) {}

    res.json({
      success: true,
      // Still configured if .env has credentials
      configured: isQRZConfigured(),
      source: CONFIG._qrzUsername ? 'env' : 'none',
    });
  });

  // ── Unified Callsign Lookup: QRZ → HamQTH → Prefix ──

  app.get('/api/callsign/:call', async (req, res) => {
    // Strip angle brackets and other junk that can arrive from DX cluster data
    const rawCallsign = req.params.call.replace(/[<>]/g, '').toUpperCase().trim();
    const now = Date.now();

    // Extract base callsign: 5Z4/OZ6ABL → OZ6ABL, UA1TAN/M → UA1TAN
    const callsign = extractBaseCallsign(rawCallsign);

    // Check cache first (check both raw and base forms)
    const cached = callsignLookupCache.get(callsign) || callsignLookupCache.get(rawCallsign);
    if (cached && now - cached.timestamp < CALLSIGN_CACHE_TTL) {
      logDebug('[Callsign Lookup] Cache hit for:', callsign);
      return res.json(cached.data);
    }

    // SECURITY: Validate callsign format
    if (!/^[A-Z0-9\/\-]{1,20}$/.test(callsign)) {
      return res.status(400).json({ error: 'Invalid callsign format' });
    }

    if (callsign !== rawCallsign) {
      logDebug(`[Callsign Lookup] Stripped: ${rawCallsign} → ${callsign}`);
    }
    logDebug('[Callsign Lookup] Looking up:', callsign);

    try {
      let result = null;

      // 1. Try QRZ XML API (most accurate — user-supplied coords, geocoded, or grid-derived)
      if (isQRZConfigured()) {
        result = await qrzLookup(callsign);
      }

      // 2. Fall back to HamQTH DXCC (no auth, but only country-level accuracy)
      if (!result) {
        result = await hamqthLookup(callsign);
      }

      // 3. Last resort: estimate from callsign prefix
      if (!result) {
        const estimated = estimateLocationFromPrefix(callsign);
        if (estimated) {
          result = { ...estimated, source: 'prefix' };
        }
      }

      if (result) {
        logDebug(
          `[Callsign Lookup] ${callsign}: ${result.source} -> ${result.lat?.toFixed(2)}, ${result.lon?.toFixed(2)}`,
        );
        cacheCallsignLookup(callsign, { data: result, timestamp: now });
        return res.json(result);
      }

      res.status(404).json({ error: 'Callsign not found' });
    } catch (error) {
      if (error.name !== 'AbortError') {
        logErrorOnce('Callsign Lookup', error.message);
      }
      // Still try prefix estimate on error
      const estimated = estimateLocationFromPrefix(callsign);
      if (estimated) {
        cacheCallsignLookup(callsign, {
          data: { ...estimated, source: 'prefix' },
          timestamp: now,
        });
        return res.json({ ...estimated, source: 'prefix' });
      }
      res.status(500).json({ error: 'Lookup failed' });
    }
  });

  // Convert Maidenhead grid locator to lat/lon (center of grid square)
  function maidenheadToLatLon(grid) {
    if (!grid || typeof grid !== 'string') return null;

    grid = grid.toUpperCase().trim();

    // Validate grid format (2, 4, 6, or 8 characters)
    if (!/^[A-R]{2}([0-9]{2}([A-X]{2}([0-9]{2})?)?)?$/.test(grid)) return null;

    let lon = -180;
    let lat = -90;

    // Field (2 chars): 20° lon x 10° lat
    lon += (grid.charCodeAt(0) - 65) * 20;
    lat += (grid.charCodeAt(1) - 65) * 10;

    if (grid.length >= 4) {
      // Square (2 digits): 2° lon x 1° lat
      lon += parseInt(grid[2]) * 2;
      lat += parseInt(grid[3]) * 1;
    }

    if (grid.length >= 6) {
      // Subsquare (2 chars): 5' lon x 2.5' lat
      lon += (grid.charCodeAt(4) - 65) * (5 / 60);
      lat += (grid.charCodeAt(5) - 65) * (2.5 / 60);
    }

    if (grid.length >= 8) {
      // Extended square (2 digits): 0.5' lon x 0.25' lat
      lon += parseInt(grid[6]) * (0.5 / 60);
      lat += parseInt(grid[7]) * (0.25 / 60);
    }

    // Add offset to center of the grid square
    if (grid.length === 2) {
      lon += 10;
      lat += 5;
    } else if (grid.length === 4) {
      lon += 1;
      lat += 0.5;
    } else if (grid.length === 6) {
      lon += 2.5 / 60;
      lat += 1.25 / 60;
    } else if (grid.length === 8) {
      lon += 0.25 / 60;
      lat += 0.125 / 60;
    }

    return { lat, lon, grid };
  }

  // Try to extract grid locators from a comment string
  // Returns { spotterGrid, dxGrid } - may have one, both, or neither
  function extractGridsFromComment(comment) {
    if (!comment || typeof comment !== 'string') return { spotterGrid: null, dxGrid: null };

    // Check for dual grid format: FN20<>EM79 or FN20->EM79 or FN20/EM79
    const dualGridMatch = comment.match(
      /\b([A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2})?)\s*(?:<>|->|\/|<)\s*([A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2})?)\b/,
    );
    if (dualGridMatch) {
      const grid1 = dualGridMatch[1].toUpperCase();
      const grid2 = dualGridMatch[2].toUpperCase();
      // Validate both are real grids
      if (isValidGrid(grid1) && isValidGrid(grid2)) {
        return { spotterGrid: grid1, dxGrid: grid2 };
      }
    }

    // Look for all grids in the comment
    const gridPattern = /\b([A-Ra-r]{2}[0-9]{2}(?:[A-Xa-x]{2})?)\b/g;
    const grids = [];
    let match;
    while ((match = gridPattern.exec(comment)) !== null) {
      const grid = match[1].toUpperCase();
      if (isValidGrid(grid)) {
        grids.push(grid);
      }
    }

    // If we found two grids, assume first is spotter, second is DX
    if (grids.length >= 2) {
      return { spotterGrid: grids[0], dxGrid: grids[1] };
    }

    // If we found one grid, assume it's the DX station
    if (grids.length === 1) {
      return { spotterGrid: null, dxGrid: grids[0] };
    }

    return { spotterGrid: null, dxGrid: null };
  }

  // Validate a grid square is realistic (not "CQ00", "DE12", etc)
  function isValidGrid(grid) {
    if (!grid || grid.length < 4) return false;
    const firstChar = grid.charCodeAt(0);
    const secondChar = grid.charCodeAt(1);
    // First char should be A-R, second char should be A-R
    return firstChar >= 65 && firstChar <= 82 && secondChar >= 65 && secondChar <= 82;
  }

  // Legacy single-grid extraction (kept for compatibility)
  function extractGridFromComment(comment) {
    const grids = extractGridsFromComment(comment);
    return grids.dxGrid;
  }

  // Estimate location from callsign prefix using grid squares
  // This gives much better precision than country centers
  function estimateLocationFromPrefix(callsign) {
    if (!callsign) return null;

    // Comprehensive prefix to grid mapping
    // Uses typical/central grid for each prefix area
    // Comprehensive prefix to grid mapping
    // Based on ITU allocations and DXCC entity list (~340 entities)
    // Grid squares are approximate center of each entity
    const prefixGrids = {
      // ============================================
      // USA - by call district
      // ============================================
      W1: 'FN41',
      K1: 'FN41',
      N1: 'FN41',
      AA1: 'FN41',
      W2: 'FN20',
      K2: 'FN20',
      N2: 'FN20',
      AA2: 'FN20',
      W3: 'FM19',
      K3: 'FM19',
      N3: 'FM19',
      AA3: 'FM19',
      W4: 'EM73',
      K4: 'EM73',
      N4: 'EM73',
      AA4: 'EM73',
      W5: 'EM12',
      K5: 'EM12',
      N5: 'EM12',
      AA5: 'EM12',
      W6: 'CM97',
      K6: 'CM97',
      N6: 'CM97',
      AA6: 'CM97',
      W7: 'DN31',
      K7: 'DN31',
      N7: 'DN31',
      AA7: 'DN31',
      W8: 'EN81',
      K8: 'EN81',
      N8: 'EN81',
      AA8: 'EN81',
      W9: 'EN52',
      K9: 'EN52',
      N9: 'EN52',
      AA9: 'EN52',
      W0: 'EN31',
      K0: 'EN31',
      N0: 'EN31',
      AA0: 'EN31',
      W: 'EM79',
      K: 'EM79',
      N: 'EM79',

      // ============================================
      // US Territories
      // ============================================
      KP4: 'FK68',
      NP4: 'FK68',
      WP4: 'FK68',
      KP3: 'FK68',
      NP3: 'FK68',
      WP3: 'FK68',
      KP2: 'FK77',
      NP2: 'FK77',
      WP2: 'FK77',
      KP1: 'FK28',
      NP1: 'FK28',
      WP1: 'FK28',
      KP5: 'FK68',
      KH0: 'QK25',
      NH0: 'QK25',
      WH0: 'QK25',
      KH1: 'BL01',
      KH2: 'QK24',
      NH2: 'QK24',
      WH2: 'QK24',
      KH3: 'BK29',
      KH4: 'AL07',
      KH5: 'BK29',
      KH5K: 'BL01',
      KH6: 'BL10',
      NH6: 'BL10',
      WH6: 'BL10',
      KH7: 'BL10',
      NH7: 'BL10',
      WH7: 'BL10',
      KH8: 'AH38',
      NH8: 'AH38',
      WH8: 'AH38',
      KH9: 'AK19',
      KL7: 'BP51',
      NL7: 'BP51',
      WL7: 'BP51',
      AL7: 'BP51',
      KG4: 'FK29',

      // ============================================
      // Canada
      // ============================================
      VE1: 'FN74',
      VA1: 'FN74',
      VE2: 'FN35',
      VA2: 'FN35',
      VE3: 'FN03',
      VA3: 'FN03',
      VE4: 'EN19',
      VA4: 'EN19',
      VE5: 'DO51',
      VA5: 'DO51',
      VE6: 'DO33',
      VA6: 'DO33',
      VE7: 'CN89',
      VA7: 'CN89',
      VE8: 'DP31',
      VE9: 'FN65',
      VA9: 'FN65',
      VO1: 'GN37',
      VO2: 'GO17',
      VY0: 'EQ79',
      VY1: 'CP28',
      VY2: 'FN86',
      CY0: 'GN76',
      CY9: 'FN97',
      VE: 'FN03',
      VA: 'FN03',

      // ============================================
      // Mexico & Central America
      // ============================================
      XE: 'EK09',
      XE1: 'EK09',
      XE2: 'DL84',
      XE3: 'EK57',
      XA: 'EK09',
      XB: 'EK09',
      XC: 'EK09',
      XD: 'EK09',
      XF: 'DK48',
      '4A': 'EK09',
      '4B': 'EK09',
      '4C': 'EK09',
      '6D': 'EK09',
      '6E': 'EK09',
      '6F': 'EK09',
      '6G': 'EK09',
      '6H': 'EK09',
      '6I': 'EK09',
      '6J': 'EK09',
      TI: 'EJ79',
      TE: 'EJ79',
      TG: 'EK44',
      TD: 'EK44',
      HR: 'EK55',
      HQ: 'EK55',
      YN: 'EK62',
      HT: 'EK62',
      H6: 'EK62',
      H7: 'EK62',
      HP: 'FJ08',
      HO: 'FJ08',
      H3: 'FJ08',
      H8: 'FJ08',
      H9: 'FJ08',
      '3E': 'FJ08',
      '3F': 'FJ08',
      YS: 'EK53',
      HU: 'EK53',
      V3: 'EK56',

      // ============================================
      // Caribbean
      // ============================================
      HI: 'FK49',
      CO: 'FL10',
      CM: 'FL10',
      CL: 'FL10',
      T4: 'FL10',
      '6Y': 'FK17',
      VP5: 'FL31',
      C6: 'FL06',
      ZF: 'EK99',
      V2: 'FK97',
      J3: 'FK92',
      J6: 'FK93',
      J7: 'FK95',
      J8: 'FK93',
      '8P': 'GK03',
      '9Y': 'FK90',
      PJ2: 'FK52',
      PJ4: 'FK52',
      PJ5: 'FK87',
      PJ6: 'FK87',
      PJ7: 'FK88',
      P4: 'FK52',
      VP2E: 'FK88',
      VP2M: 'FK96',
      VP2V: 'FK77',
      V4: 'FK87',
      FG: 'FK96',
      FM: 'FK94',
      TO: 'FK94',
      FS: 'FK88',
      FJ: 'GK08',
      HH: 'FK38',

      // ============================================
      // South America
      // ============================================
      LU: 'GF05',
      LW: 'GF05',
      LO: 'GF05',
      LR: 'GF05',
      LT: 'GF05',
      AY: 'GF05',
      AZ: 'GF05',
      L1: 'GF05',
      L2: 'GF05',
      L3: 'GF05',
      L4: 'GF05',
      L5: 'GF05',
      L6: 'GF05',
      L7: 'GF05',
      L8: 'GF05',
      L9: 'GF05',
      PY: 'GG87',
      PP: 'GG87',
      PQ: 'GG87',
      PR: 'GG87',
      PS: 'GG87',
      PT: 'GG87',
      PU: 'GG87',
      PV: 'GG87',
      PW: 'GG87',
      PX: 'GG87',
      ZV: 'GG87',
      ZW: 'GG87',
      ZX: 'GG87',
      ZY: 'GG87',
      ZZ: 'GG87',
      CE: 'FF46',
      CA: 'FF46',
      CB: 'FF46',
      CC: 'FF46',
      CD: 'FF46',
      XQ: 'FF46',
      XR: 'FF46',
      '3G': 'FF46',
      CE0Y: 'DG52',
      CE0Z: 'FE49',
      CE0X: 'FG14',
      CX: 'GF15',
      CV: 'GF15',
      HC: 'FI09',
      HD: 'FI09',
      HC8: 'EI49',
      OA: 'FH17',
      OB: 'FH17',
      OC: 'FH17',
      '4T': 'FH17',
      HK: 'FJ35',
      HJ: 'FJ35',
      '5J': 'FJ35',
      '5K': 'FJ35',
      HK0: 'FJ55',
      HK0M: 'EJ96',
      YV: 'FK60',
      YW: 'FK60',
      YX: 'FK60',
      YY: 'FK60',
      '4M': 'FK60',
      YV0: 'FK53',
      CP: 'FH64',
      '8R': 'GJ24',
      PZ: 'GJ25',
      FY: 'GJ34',
      VP8: 'GD18',
      VP8F: 'GD18',
      VP8G: 'IC16',
      VP8H: 'GC17',
      VP8O: 'GC06',
      VP8S: 'GC06',

      // ============================================
      // Europe - UK & Ireland
      // ============================================
      G: 'IO91',
      M: 'IO91',
      '2E': 'IO91',
      GW: 'IO81',
      MW: 'IO81',
      '2W': 'IO81',
      GM: 'IO85',
      MM: 'IO85',
      '2M': 'IO85',
      GI: 'IO64',
      MI: 'IO64',
      '2I': 'IO64',
      GD: 'IO74',
      MD: 'IO74',
      '2D': 'IO74',
      GJ: 'IN89',
      MJ: 'IN89',
      '2J': 'IN89',
      GU: 'IN89',
      MU: 'IN89',
      '2U': 'IN89',
      EI: 'IO63',
      EJ: 'IO63',

      // ============================================
      // Europe - Germany
      // ============================================
      DL: 'JO51',
      DJ: 'JO51',
      DK: 'JO51',
      DA: 'JO51',
      DB: 'JO51',
      DC: 'JO51',
      DD: 'JO51',
      DF: 'JO51',
      DG: 'JO51',
      DH: 'JO51',
      DM: 'JO51',
      DO: 'JO51',
      DP: 'JO51',
      DQ: 'JO51',
      DR: 'JO51',

      // ============================================
      // Europe - France & territories
      // ============================================
      F: 'JN18',
      TM: 'JN18',

      // ============================================
      // Europe - Italy
      // ============================================
      I: 'JN61',
      IK: 'JN45',
      IZ: 'JN61',
      IW: 'JN61',
      IU: 'JN61',

      // ============================================
      // Europe - Spain & Portugal
      // ============================================
      EA: 'IN80',
      EC: 'IN80',
      EB: 'IN80',
      ED: 'IN80',
      EE: 'IN80',
      EF: 'IN80',
      EG: 'IN80',
      EH: 'IN80',
      EA6: 'JM19',
      EC6: 'JM19',
      EA8: 'IL18',
      EC8: 'IL18',
      EA9: 'IM75',
      EC9: 'IM75',
      CT: 'IM58',
      CQ: 'IM58',
      CS: 'IM58',
      CT3: 'IM12',
      CQ3: 'IM12',
      CU: 'HM68',

      // ============================================
      // Europe - Benelux
      // ============================================
      PA: 'JO21',
      PD: 'JO21',
      PE: 'JO21',
      PF: 'JO21',
      PG: 'JO21',
      PH: 'JO21',
      PI: 'JO21',
      ON: 'JO20',
      OO: 'JO20',
      OP: 'JO20',
      OQ: 'JO20',
      OR: 'JO20',
      OS: 'JO20',
      OT: 'JO20',
      LX: 'JN39',

      // ============================================
      // Europe - Alpine
      // ============================================
      HB: 'JN47',
      HB9: 'JN47',
      HE: 'JN47',
      HB0: 'JN47',
      OE: 'JN78',

      // ============================================
      // Europe - Scandinavia
      // ============================================
      OZ: 'JO55',
      OU: 'JO55',
      OV: 'JO55',
      '5P': 'JO55',
      '5Q': 'JO55',
      OX: 'GP47',
      XP: 'GP47',
      SM: 'JO89',
      SA: 'JO89',
      SB: 'JO89',
      SC: 'JO89',
      SD: 'JO89',
      SE: 'JO89',
      SF: 'JO89',
      SG: 'JO89',
      SH: 'JO89',
      SI: 'JO89',
      SJ: 'JO89',
      SK: 'JO89',
      SL: 'JO89',
      '7S': 'JO89',
      '8S': 'JO89',
      LA: 'JO59',
      LB: 'JO59',
      LC: 'JO59',
      LD: 'JO59',
      LE: 'JO59',
      LF: 'JO59',
      LG: 'JO59',
      LH: 'JO59',
      LI: 'JO59',
      LJ: 'JO59',
      LK: 'JO59',
      LL: 'JO59',
      LM: 'JO59',
      LN: 'JO59',
      JW: 'JQ68',
      JX: 'IQ50',
      OH: 'KP20',
      OF: 'KP20',
      OG: 'KP20',
      OI: 'KP20',
      OH0: 'JP90',
      OJ0: 'KP03',
      TF: 'HP94',

      // ============================================
      // Europe - Eastern
      // ============================================
      SP: 'JO91',
      SQ: 'JO91',
      SO: 'JO91',
      SN: 'JO91',
      '3Z': 'JO91',
      HF: 'JO91',
      OK: 'JN79',
      OL: 'JN79',
      OM: 'JN88',
      HA: 'JN97',
      HG: 'JN97',
      YO: 'KN34',
      YP: 'KN34',
      YQ: 'KN34',
      YR: 'KN34',
      LZ: 'KN22',
      SV: 'KM17',
      SX: 'KM17',
      SY: 'KM17',
      SZ: 'KM17',
      J4: 'KM17',
      SV5: 'KM46',
      SV9: 'KM25',
      'SV/A': 'KN10',
      '9H': 'JM75',
      YU: 'KN04',
      YT: 'KN04',
      YZ: 'KN04',
      '9A': 'JN75',
      S5: 'JN76',
      E7: 'JN84',
      Z3: 'KN01',
      '4O': 'JN92',
      ZA: 'JN91',
      T7: 'JN63',
      HV: 'JN61',
      '1A': 'JM64',

      // ============================================
      // Europe - Baltic
      // ============================================
      LY: 'KO24',
      ES: 'KO29',
      YL: 'KO26',

      // ============================================
      // Russia & Ukraine & Belarus
      // ============================================
      UA: 'KO85',
      RA: 'KO85',
      RU: 'KO85',
      RV: 'KO85',
      RW: 'KO85',
      RX: 'KO85',
      RZ: 'KO85',
      R1: 'KO85',
      R2: 'KO85',
      R3: 'KO85',
      R4: 'KO85',
      R5: 'KO85',
      R6: 'KO85',
      U1: 'KO85',
      U2: 'KO85',
      U3: 'KO85',
      U4: 'KO85',
      U5: 'KO85',
      U6: 'KO85',
      UA9: 'MO06',
      RA9: 'MO06',
      R9: 'MO06',
      U9: 'MO06',
      UA0: 'OO33',
      RA0: 'OO33',
      R0: 'OO33',
      U0: 'OO33',
      UA2: 'KO04',
      RA2: 'KO04',
      R2F: 'KO04',
      UR: 'KO50',
      UT: 'KO50',
      UX: 'KO50',
      US: 'KO50',
      UY: 'KO50',
      UW: 'KO50',
      UV: 'KO50',
      UU: 'KO50',
      EU: 'KO33',
      EV: 'KO33',
      EW: 'KO33',
      ER: 'KN47',
      C3: 'JN02',

      // ============================================
      // Asia - Japan
      // ============================================
      JA: 'PM95',
      JH: 'PM95',
      JR: 'PM95',
      JE: 'PM95',
      JF: 'PM95',
      JG: 'PM95',
      JI: 'PM95',
      JJ: 'PM95',
      JK: 'PM95',
      JL: 'PM95',
      JM: 'PM95',
      JN: 'PM95',
      JO: 'PM95',
      JP: 'PM95',
      JQ: 'PM95',
      JS: 'PM95',
      '7J': 'PM95',
      '7K': 'PM95',
      '7L': 'PM95',
      '7M': 'PM95',
      '7N': 'PM95',
      '8J': 'PM95',
      '8K': 'PM95',
      '8L': 'PM95',
      '8M': 'PM95',
      '8N': 'PM95',
      JA1: 'PM95',
      JA2: 'PM84',
      JA3: 'PM74',
      JA4: 'PM64',
      JA5: 'PM63',
      JA6: 'PM53',
      JA7: 'QM07',
      JA8: 'QN02',
      JA9: 'PM86',
      JA0: 'PM97',
      JD1: 'QL07',

      // ============================================
      // Asia - China & Taiwan & Hong Kong
      // ============================================
      BY: 'OM92',
      BT: 'OM92',
      BA: 'OM92',
      BD: 'OM92',
      BG: 'OM92',
      BH: 'OM92',
      BI: 'OM92',
      BJ: 'OM92',
      BL: 'OM92',
      BM: 'OM92',
      BO: 'OM92',
      BP: 'OM92',
      BQ: 'OM92',
      BR: 'OM92',
      BS: 'OM92',
      BU: 'OM92',
      BV: 'PL04',
      BW: 'PL04',
      BX: 'PL04',
      BN: 'PL04',
      XX9: 'OL62',
      VR: 'OL62',

      // ============================================
      // Asia - Korea
      // ============================================
      HL: 'PM37',
      DS: 'PM37',
      '6K': 'PM37',
      '6L': 'PM37',
      '6M': 'PM37',
      '6N': 'PM37',
      D7: 'PM37',
      D8: 'PM37',
      D9: 'PM37',
      P5: 'PM38',

      // ============================================
      // Asia - Southeast
      // ============================================
      HS: 'OK03',
      E2: 'OK03',
      XV: 'OK30',
      '3W': 'OK30',
      XU: 'OK10',
      XW: 'NK97',
      XZ: 'NL99',
      '1Z': 'NL99',
      '9V': 'OJ11',
      '9M': 'OJ05',
      '9W': 'OJ05',
      '9M6': 'OJ69',
      '9M8': 'OJ69',
      '9W6': 'OJ69',
      '9W8': 'OJ69',
      DU: 'PK04',
      DV: 'PK04',
      DW: 'PK04',
      DX: 'PK04',
      DY: 'PK04',
      DZ: 'PK04',
      '4D': 'PK04',
      '4E': 'PK04',
      '4F': 'PK04',
      '4G': 'PK04',
      '4H': 'PK04',
      '4I': 'PK04',
      YB: 'OI33',
      YC: 'OI33',
      YD: 'OI33',
      YE: 'OI33',
      YF: 'OI33',
      YG: 'OI33',
      YH: 'OI33',
      '7A': 'OI33',
      '7B': 'OI33',
      '7C': 'OI33',
      '7D': 'OI33',
      '7E': 'OI33',
      '7F': 'OI33',
      '7G': 'OI33',
      '7H': 'OI33',
      '7I': 'OI33',
      '8A': 'OI33',
      '8B': 'OI33',
      '8C': 'OI33',
      '8D': 'OI33',
      '8E': 'OI33',
      '8F': 'OI33',
      '8G': 'OI33',
      '8H': 'OI33',
      '8I': 'OI33',
      V8: 'OJ84',

      // ============================================
      // Asia - South
      // ============================================
      VU: 'MK82',
      VU2: 'MK82',
      VU3: 'MK82',
      VU4: 'MJ97',
      VU7: 'MJ58',
      '8T': 'MK82',
      '8U': 'MK82',
      '8V': 'MK82',
      '8W': 'MK82',
      '8X': 'MK82',
      '8Y': 'MK82',
      AP: 'MM44',
      '4S': 'MJ96',
      S2: 'NL93',
      '9N': 'NL27',
      A5: 'NL49',
      '8Q': 'MJ63',

      // ============================================
      // Asia - Middle East
      // ============================================
      A4: 'LL93',
      A41: 'LL93',
      A43: 'LL93',
      A45: 'LL93',
      A47: 'LL93',
      A6: 'LL65',
      A61: 'LL65',
      A62: 'LL65',
      A63: 'LL65',
      A65: 'LL65',
      A7: 'LL45',
      A71: 'LL45',
      A72: 'LL45',
      A73: 'LL45',
      A75: 'LL45',
      A9: 'LL56',
      A91: 'LL56',
      A92: 'LL56',
      '9K': 'LL47',
      HZ: 'LL24',
      '7Z': 'LL24',
      '8Z': 'LL24',
      '4X': 'KM72',
      '4Z': 'KM72',
      OD: 'KM73',
      JY: 'KM71',
      YK: 'KM74',
      YI: 'LM30',
      EP: 'LL58',
      EQ: 'LL58',
      EK: 'LN20',
      '4J': 'LN40',
      '4K': 'LN40',
      '4L': 'LN21',
      TA: 'KN41',
      TB: 'KN41',
      TC: 'KN41',
      YM: 'KN41',
      TA1: 'KN41',
      '5B': 'KM64',
      C4: 'KM64',
      H2: 'KM64',
      P3: 'KM64',
      ZC4: 'KM64',

      // ============================================
      // Asia - Central
      // ============================================
      EX: 'MM78',
      EY: 'MM49',
      EZ: 'LN71',
      UK: 'MN41',
      UN: 'MN53',
      UP: 'MN53',
      UQ: 'MN53',
      YA: 'MM24',
      T6: 'MM24',

      // ============================================
      // Oceania - Australia
      // ============================================
      VK: 'QF56',
      VK1: 'QF44',
      VK2: 'QF56',
      VK3: 'QF22',
      VK4: 'QG62',
      VK5: 'PF95',
      VK6: 'OF86',
      VK7: 'QE38',
      VK8: 'PH57',
      VK9: 'QF56',
      VK9C: 'OH29',
      VK9X: 'NH93',
      VK9L: 'QF92',
      VK9W: 'QG14',
      VK9M: 'QG11',
      VK9N: 'RF73',
      VK0H: 'MC55',
      VK0M: 'QE37',

      // ============================================
      // Oceania - New Zealand & Pacific
      // ============================================
      ZL: 'RF70',
      ZL1: 'RF72',
      ZL2: 'RF70',
      ZL3: 'RE66',
      ZL4: 'RE54',
      ZM: 'RF70',
      ZL7: 'AE67',
      ZL8: 'AH36',
      ZL9: 'RE44',
      E5: 'BH83',
      E51: 'BH83',
      E52: 'AI38',
      ZK3: 'AH89',
      FK: 'RG37',
      TX: 'RG37',
      'FK/C': 'RH29',
      FO: 'BH52',
      'FO/A': 'CJ07',
      'FO/C': 'CI06',
      'FO/M': 'DI79',
      FW: 'AH44',
      A3: 'AG28',
      A35: 'AG28',
      '5W': 'AH45',
      YJ: 'RH31',
      YJ0: 'RH31',
      H4: 'RI07',
      H44: 'RI07',
      P2: 'QI24',
      V6: 'QJ66',
      V7: 'RJ48',
      T8: 'PJ77',
      T2: 'RI87',
      T3: 'RI96',
      T31: 'AI58',
      T32: 'BI69',
      T33: 'AJ25',
      C2: 'QI32',
      '3D2': 'RH91',
      '3D2C': 'QH38',
      '3D2R': 'RG26',
      ZK2: 'AI48',
      E6: 'AH28',

      // ============================================
      // Africa - North
      // ============================================
      CN: 'IM63',
      '5C': 'IM63',
      '5D': 'IM63',
      '7X': 'JM16',
      '3V': 'JM54',
      TS: 'JM54',
      '5A': 'JM73',
      SU: 'KL30',
      '6A': 'KL30',

      // ============================================
      // Africa - West
      // ============================================
      '5T': 'IL30',
      '6W': 'IK14',
      C5: 'IK13',
      J5: 'IK52',
      '3X': 'IJ75',
      '9L': 'IJ38',
      EL: 'IJ56',
      TU: 'IJ95',
      '9G': 'IJ95',
      '5V': 'JJ07',
      TY: 'JJ16',
      '5N': 'JJ55',
      '5U': 'JK16',
      TZ: 'IK52',
      XT: 'JJ00',
      TJ: 'JJ55',
      D4: 'HK76',

      // ============================================
      // Africa - Central
      // ============================================
      TT: 'JK73',
      TN: 'JI64',
      '9Q': 'JI76',
      TL: 'JJ91',
      TR: 'JI41',
      S9: 'JJ40',
      '3C': 'JJ41',
      D2: 'JH84',

      // ============================================
      // Africa - East
      // ============================================
      ET: 'KJ49',
      E3: 'KJ76',
      '6O': 'LJ07',
      T5: 'LJ07',
      J2: 'LK03',
      '5Z': 'KI88',
      '5X': 'KI42',
      '5H': 'KI73',
      '9X': 'KI45',
      '9U': 'KI23',
      C9: 'KH53',
      '7Q': 'KH54',
      '9J': 'KH35',
      Z2: 'KH42',
      '7P': 'KG30',
      '3DA': 'KG53',
      A2: 'KG52',
      V5: 'JG87',

      // ============================================
      // Africa - South
      // ============================================
      ZS: 'KG33',
      ZR: 'KG33',
      ZT: 'KG33',
      ZU: 'KG33',
      ZS8: 'KG42',
      '3Y': 'JD45',

      // ============================================
      // Africa - Islands
      // ============================================
      D6: 'LH47',
      '5R': 'LH45',
      '3B8': 'LG89',
      '3B9': 'LH14',
      '3B6': 'LH28',
      S7: 'LI73',
      FT5W: 'KG42',
      FT5X: 'MC55',
      FT5Z: 'ME47',
      FR: 'LG79',
      FH: 'LI15',
      VQ9: 'MJ66',

      // ============================================
      // Antarctica
      // ============================================
      CE9: 'FC56',
      DP0: 'IB59',
      DP1: 'IB59',
      KC4: 'FC56',
      '8J1': 'LC97',
      R1AN: 'KC29',
      ZL5: 'RB32',

      // ============================================
      // Other/Islands
      // ============================================
      ZB: 'IM76',
      ZD7: 'IH74',
      ZD8: 'II22',
      ZD9: 'JE26',
      '9M0': 'NJ07',
      BQ9: 'PJ29',
    };

    const upper = callsign.toUpperCase();

    // Check US territories FIRST (before generic US pattern)
    // These start with K but are NOT mainland USA
    const usTerritoryPrefixes = {
      KP1: 'FN42', // Navassa Island
      KP2: 'FK77', // US Virgin Islands
      KP3: 'FK68', // Puerto Rico (same as KP4)
      KP4: 'FK68', // Puerto Rico
      KP5: 'FK68', // Desecheo Island
      NP2: 'FK77', // US Virgin Islands
      NP3: 'FK68', // Puerto Rico
      NP4: 'FK68', // Puerto Rico
      WP2: 'FK77', // US Virgin Islands
      WP3: 'FK68', // Puerto Rico
      WP4: 'FK68', // Puerto Rico
      KH0: 'QK25', // Mariana Islands
      KH1: 'BL01', // Baker/Howland
      KH2: 'QK24', // Guam
      KH3: 'BL01', // Johnston Island
      KH4: 'AL07', // Midway
      KH5: 'BK29', // Palmyra/Jarvis
      KH6: 'BL01', // Hawaii
      KH7: 'BL01', // Kure Island
      KH8: 'AH38', // American Samoa
      KH9: 'AK19', // Wake Island
      NH6: 'BL01', // Hawaii
      NH7: 'BL01', // Hawaii
      WH6: 'BL01', // Hawaii
      WH7: 'BL01', // Hawaii
      KL7: 'BP51', // Alaska
      NL7: 'BP51', // Alaska
      WL7: 'BP51', // Alaska
      AL7: 'BP51', // Alaska
      KG4: 'FK29', // Guantanamo Bay
    };

    // Check for US territory prefix (3 chars like KP4, KH6, KL7)
    const territoryPrefix3 = upper.substring(0, 3);
    if (usTerritoryPrefixes[territoryPrefix3]) {
      const grid = usTerritoryPrefixes[territoryPrefix3];
      const gridLoc = maidenheadToLatLon(grid);
      if (gridLoc) {
        return {
          callsign,
          lat: gridLoc.lat,
          lon: gridLoc.lon,
          grid: grid,
          country:
            territoryPrefix3.startsWith('KP') || territoryPrefix3.startsWith('NP') || territoryPrefix3.startsWith('WP')
              ? 'Puerto Rico/USVI'
              : territoryPrefix3.startsWith('KH') ||
                  territoryPrefix3.startsWith('NH') ||
                  territoryPrefix3.startsWith('WH')
                ? 'Hawaii/Pacific'
                : territoryPrefix3.includes('L7')
                  ? 'Alaska'
                  : 'US Territory',
          estimated: true,
          source: 'prefix-grid',
        };
      }
    }

    // Smart US callsign detection - US prefixes follow specific patterns
    // K, N, W + anything = USA
    // A[A-L] + digit = USA (e.g., AA0, AE5, AL7)
    const usCallPattern = /^([KNW][0-9]?|A[A-L][0-9])/;
    const usMatch = upper.match(usCallPattern);
    if (usMatch) {
      // Extract call district (the digit) for more precise location
      const districtMatch = upper.match(/^[KNWA][A-L]?([0-9])/);
      const district = districtMatch ? districtMatch[1] : null;

      const usDistrictGrids = {
        0: 'EN31', // Central (CO, IA, KS, MN, MO, NE, ND, SD)
        1: 'FN41', // New England (CT, MA, ME, NH, RI, VT)
        2: 'FN20', // NY, NJ
        3: 'FM19', // PA, MD, DE
        4: 'EM73', // Southeast (AL, FL, GA, KY, NC, SC, TN, VA)
        5: 'EM12', // TX, OK, LA, AR, MS, NM
        6: 'CM97', // California
        7: 'DN31', // Pacific NW/Mountain (AZ, ID, MT, NV, OR, UT, WA, WY)
        8: 'EN81', // MI, OH, WV
        9: 'EN52', // IL, IN, WI
      };

      const grid = district && usDistrictGrids[district] ? usDistrictGrids[district] : 'EM79';
      const gridLoc = maidenheadToLatLon(grid);
      if (gridLoc) {
        return {
          callsign,
          lat: gridLoc.lat,
          lon: gridLoc.lon,
          grid: grid,
          country: 'USA',
          estimated: true,
          source: 'prefix-grid',
        };
      }
    }

    // Try longest prefix match first (up to 4 chars) for non-US calls
    for (let len = 4; len >= 1; len--) {
      const prefix = upper.substring(0, len);
      if (prefixGrids[prefix]) {
        const gridLoc = maidenheadToLatLon(prefixGrids[prefix]);
        if (gridLoc) {
          return {
            callsign,
            lat: gridLoc.lat,
            lon: gridLoc.lon,
            grid: prefixGrids[prefix],
            country: getCountryFromPrefix(prefix),
            estimated: true,
            source: 'prefix-grid',
          };
        }
      }
    }

    // Fallback: try cty.dat database (has lat/lon for every DXCC entity)
    const ctyResult = lookupCall(callsign);
    if (ctyResult && ctyResult.lat != null && ctyResult.lon != null) {
      return {
        callsign,
        lat: ctyResult.lat,
        lon: ctyResult.lon,
        grid: null,
        country: ctyResult.entity || 'Unknown',
        estimated: true,
        source: 'prefix',
      };
    }

    // Fallback to first character (most likely country for each letter)
    const firstCharGrids = {
      A: 'EM79',
      B: 'PL02',
      C: 'FN03',
      D: 'JO51',
      E: 'IO63', // A=USA (AA-AL), B=China, C=Canada, D=Germany, E=Spain/Ireland
      F: 'JN18',
      G: 'IO91',
      H: 'KM72',
      I: 'JN61',
      J: 'PM95', // F=France, G=UK, H=varies, I=Italy, J=Japan
      K: 'EM79',
      L: 'GF05',
      M: 'IO91',
      N: 'EM79',
      O: 'KP20', // K=USA, L=Argentina, M=UK, N=USA, O=Finland
      P: 'GG87',
      R: 'KO85',
      S: 'JO89',
      T: 'KI88',
      U: 'KO85', // P=Brazil, R=Russia, S=Sweden, T=varies, U=Russia
      V: 'QF56',
      W: 'EM79',
      X: 'EK09',
      Y: 'JO91',
      Z: 'KG33', // V=Australia, W=USA, X=Mexico, Y=varies, Z=South Africa
    };

    const firstChar = upper[0];
    if (firstCharGrids[firstChar]) {
      const gridLoc = maidenheadToLatLon(firstCharGrids[firstChar]);
      if (gridLoc) {
        return {
          callsign,
          lat: gridLoc.lat,
          lon: gridLoc.lon,
          grid: firstCharGrids[firstChar],
          country: 'Unknown',
          estimated: true,
          source: 'prefix-grid',
        };
      }
    }

    return null;
  }

  // Helper to get country name from prefix
  function getCountryFromPrefix(prefix) {
    const prefixCountries = {
      W: 'USA',
      K: 'USA',
      N: 'USA',
      AA: 'USA',
      KP4: 'Puerto Rico',
      NP4: 'Puerto Rico',
      WP4: 'Puerto Rico',
      KP2: 'US Virgin Is',
      NP2: 'US Virgin Is',
      WP2: 'US Virgin Is',
      KH6: 'Hawaii',
      NH6: 'Hawaii',
      WH6: 'Hawaii',
      KH2: 'Guam',
      KL7: 'Alaska',
      NL7: 'Alaska',
      WL7: 'Alaska',
      VE: 'Canada',
      VA: 'Canada',
      VY: 'Canada',
      VO: 'Canada',
      G: 'England',
      M: 'England',
      '2E': 'England',
      GM: 'Scotland',
      GW: 'Wales',
      GI: 'N. Ireland',
      EI: 'Ireland',
      F: 'France',
      DL: 'Germany',
      I: 'Italy',
      EA: 'Spain',
      CT: 'Portugal',
      PA: 'Netherlands',
      ON: 'Belgium',
      HB: 'Switzerland',
      OE: 'Austria',
      OZ: 'Denmark',
      SM: 'Sweden',
      LA: 'Norway',
      OH: 'Finland',
      SP: 'Poland',
      OK: 'Czech Rep',
      HA: 'Hungary',
      YO: 'Romania',
      LZ: 'Bulgaria',
      UA: 'Russia',
      UR: 'Ukraine',
      JA: 'Japan',
      HL: 'S. Korea',
      BV: 'Taiwan',
      BY: 'China',
      VU: 'India',
      HS: 'Thailand',
      VK: 'Australia',
      ZL: 'New Zealand',
      LU: 'Argentina',
      PY: 'Brazil',
      ZV: 'Brazil',
      ZW: 'Brazil',
      ZX: 'Brazil',
      ZY: 'Brazil',
      ZZ: 'Brazil',
      CE: 'Chile',
      HK: 'Colombia',
      YV: 'Venezuela',
      HC: 'Ecuador',
      OA: 'Peru',
      CX: 'Uruguay',
      ZS: 'South Africa',
      CN: 'Morocco',
      SU: 'Egypt',
      '5N': 'Nigeria',
      '5Z': 'Kenya',
      ET: 'Ethiopia',
      TY: 'Benin',
      TU: 'Ivory Coast',
      TR: 'Gabon',
      TZ: 'Mali',
      V5: 'Namibia',
      A2: 'Botswana',
      JY: 'Jordan',
      HZ: 'Saudi Arabia',
      A6: 'UAE',
      A7: 'Qatar',
      A9: 'Bahrain',
      A4: 'Oman',
      '4X': 'Israel',
      OD: 'Lebanon',
      YK: 'Syria',
      YI: 'Iraq',
      EP: 'Iran',
      TA: 'Turkey',
      '5B': 'Cyprus',
      EK: 'Armenia',
      '4J': 'Azerbaijan',
    };

    for (let len = 3; len >= 1; len--) {
      const p = prefix.substring(0, len);
      if (prefixCountries[p]) return prefixCountries[p];
    }
    return 'Unknown';
  }

  // QRZ Callsign lookup redirect
  app.get('/api/qrz/lookup/:callsign', async (req, res) => {
    const callsign = req.params.callsign.toUpperCase().trim();
    const cached = callsignLookupCache.get(callsign);
    if (cached && Date.now() - cached.timestamp < CALLSIGN_CACHE_TTL) {
      return res.json(cached.data);
    }
    // Redirect to unified endpoint
    res.redirect(301, `/api/callsign/${callsign}`);
  });

  // Location cache for DX cluster paths
  const callsignLocationCache = new Map();

  // Return shared state that other modules need
  return {
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
    qrzLookup,
    hamqthLookup,
    isQRZConfigured,
    qrzSession,
    QRZ_CREDS_FILE: path.join(ROOT_DIR, '.qrz-credentials'),
  };
};
