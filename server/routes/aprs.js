/**
 * APRS-IS integration routes.
 * Lines ~10922-11161 of original server.js
 */

const net = require('net');

module.exports = function (app, ctx) {
  const { CONFIG, APP_VERSION, logDebug, logInfo, logWarn, logErrorOnce } = ctx;

  // Connects to APRS-IS network for real-time position tracking.
  // Read-only connection (passcode -1). Positions cached in memory.
  // Enable via APRS_ENABLED=true in .env

  const APRS_ENABLED = process.env.APRS_ENABLED === 'true';
  const APRS_HOST = process.env.APRS_HOST || 'rotate.aprs2.net';
  const APRS_PORT = parseInt(process.env.APRS_PORT || '14580');
  const APRS_FILTER = process.env.APRS_FILTER || ''; // e.g. 'r/40/-75/500' for 500km around lat/lon
  const APRS_MAX_AGE_MINUTES = parseInt(process.env.APRS_MAX_AGE_MINUTES || '60');
  const APRS_MAX_STATIONS = 500;

  // In-memory station cache: callsign → { call, lat, lon, symbol, comment, speed, course, altitude, timestamp, raw }
  const aprsStations = new Map();
  // APRS message store for EmComm (messages, bulletins, shelter reports)
  const aprsMessages = [];
  const APRS_MAX_MESSAGES = 200;
  // Net operations: operator roster keyed by callsign
  const netRoster = new Map(); // callsign → { call, status, netName, checkinTime, lastHeard, location, resources }
  let aprsSocket = null;
  let aprsReconnectTimer = null;
  let aprsConnected = false;
  let aprsBuffer = '';

  // Parse APRS uncompressed latitude: DDMM.MMN
  function parseAprsLat(s) {
    if (!s || s.length < 8) return NaN;
    const deg = parseInt(s.substring(0, 2));
    const min = parseFloat(s.substring(2, 7));
    const hemi = s.charAt(7);
    const lat = deg + min / 60;
    return hemi === 'S' ? -lat : lat;
  }

  // Parse APRS uncompressed longitude: DDDMM.MMW
  function parseAprsLon(s) {
    if (!s || s.length < 9) return NaN;
    const deg = parseInt(s.substring(0, 3));
    const min = parseFloat(s.substring(3, 8));
    const hemi = s.charAt(8);
    const lon = deg + min / 60;
    return hemi === 'W' ? -lon : lon;
  }

  // Parse resource tokens from APRS comment field (bracket notation)
  function parseResourceTokens(comment) {
    if (!comment) return { tokens: [], cleanComment: '' };
    const tokens = [];
    const regex = /\[([A-Za-z]+)\s+([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(comment)) !== null) {
      const key = match[1];
      const val = match[2].trim();
      const capacityMatch = val.match(/^(\d+)\/(\d+)$/);
      if (capacityMatch) {
        tokens.push({ key, current: parseInt(capacityMatch[1]), max: parseInt(capacityMatch[2]), type: 'capacity' });
      } else if (val === '!') {
        tokens.push({ key, value: '!', type: 'critical' });
      } else if (val.toUpperCase() === 'OK') {
        tokens.push({ key, value: 'OK', type: 'status' });
      } else if (/^-\d+$/.test(val)) {
        tokens.push({ key, value: parseInt(val), type: 'need' });
      } else if (/^\d+$/.test(val)) {
        tokens.push({ key, value: parseInt(val), type: 'quantity' });
      } else {
        tokens.push({ key, value: val, type: 'text' });
      }
    }
    const cleanComment = comment.replace(regex, '').trim();
    return { tokens, cleanComment };
  }

  // Parse APRS telemetry frames
  // T#seq,val1,val2,val3,val4,val5,bits — analog values + digital status
  // PARM/UNIT/EQNS messages define parameter names, units, and equations
  const telemetryDefs = new Map(); // callsign → { params, units, eqns }
  const telemetryData = new Map(); // callsign → { values[], bits, seq, timestamp }

  function parseAprsTelemetry(line) {
    try {
      const headerEnd = line.indexOf(':');
      if (headerEnd < 0) return null;

      const header = line.substring(0, headerEnd);
      const payload = line.substring(headerEnd + 1);
      const callsign = header.split('>')[0].split('-')[0].trim();

      // T# telemetry data frame
      if (payload.startsWith('T#')) {
        const parts = payload.substring(2).split(',');
        if (parts.length < 6) return null;
        const seq = parts[0];
        const values = parts.slice(1, 6).map((v) => parseFloat(v) || 0);
        const bits = parts[5] ? parts[5].replace(/[^01]/g, '') : '';

        const def = telemetryDefs.get(callsign) || {};
        const entry = {
          call: callsign,
          seq,
          values,
          bits,
          timestamp: Date.now(),
          params: def.params || ['A1', 'A2', 'A3', 'A4', 'A5'],
          units: def.units || ['', '', '', '', ''],
        };

        // Apply equations if defined: val = a*x^2 + b*x + c
        if (def.eqns) {
          entry.computed = values.map((v, i) => {
            const e = def.eqns[i];
            if (!e) return v;
            return e[0] * v * v + e[1] * v + e[2];
          });
        }

        telemetryData.set(callsign, entry);
        return { type: 'data', ...entry };
      }

      // PARM — parameter names
      if (payload.startsWith(':') && payload.includes(':PARM.')) {
        const parms = payload.split(':PARM.')[1];
        if (parms) {
          const def = telemetryDefs.get(callsign) || {};
          def.params = parms.split(',').map((s) => s.trim());
          telemetryDefs.set(callsign, def);
          return { type: 'parm', call: callsign, params: def.params };
        }
      }

      // UNIT — parameter units
      if (payload.startsWith(':') && payload.includes(':UNIT.')) {
        const units = payload.split(':UNIT.')[1];
        if (units) {
          const def = telemetryDefs.get(callsign) || {};
          def.units = units.split(',').map((s) => s.trim());
          telemetryDefs.set(callsign, def);
          return { type: 'unit', call: callsign, units: def.units };
        }
      }

      // EQNS — coefficient equations (a,b,c for each of 5 channels)
      if (payload.startsWith(':') && payload.includes(':EQNS.')) {
        const eqns = payload.split(':EQNS.')[1];
        if (eqns) {
          const coeffs = eqns.split(',').map((s) => parseFloat(s) || 0);
          const def = telemetryDefs.get(callsign) || {};
          def.eqns = [];
          for (let i = 0; i < 5; i++) {
            def.eqns.push([coeffs[i * 3] || 0, coeffs[i * 3 + 1] || 1, coeffs[i * 3 + 2] || 0]);
          }
          telemetryDefs.set(callsign, def);
          return { type: 'eqns', call: callsign, eqns: def.eqns };
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  // Parse APRS message packets (addressed messages + bulletins)
  // Format: :ADDRESSEE:message text{msgid
  // Bulletins: :BLN1     :bulletin text
  function parseAprsMessage(line) {
    try {
      const headerEnd = line.indexOf(':');
      if (headerEnd < 0) return null;

      const header = line.substring(0, headerEnd);
      const payload = line.substring(headerEnd + 1);
      const from = header.split('>')[0].trim();

      // APRS message format: :ADDRESSEE:message{id
      if (payload.charAt(0) !== ':') return null;
      const addrEnd = payload.indexOf(':', 1);
      if (addrEnd < 0) return null;

      const to = payload.substring(1, addrEnd).trim();
      const body = payload.substring(addrEnd + 1);

      // Extract message ID if present
      const idMatch = body.match(/\{(\w+)$/);
      const msgId = idMatch ? idMatch[1] : null;
      const text = idMatch ? body.substring(0, body.lastIndexOf('{')).trim() : body.trim();

      // Skip acks/rejs
      if (text.startsWith('ack') || text.startsWith('rej')) return null;

      const isBulletin = to.startsWith('BLN');
      const { tokens, cleanComment } = parseResourceTokens(text);

      // Detect shelter-related content
      const isShelterReport =
        /shelter|evacuate|refuge|beds|capacity|open|closed|accepting/i.test(text) ||
        tokens.some((t) => ['Beds', 'Capacity', 'Shelter', 'Evacuees'].includes(t.key));

      // Detect net check-in/check-out commands (messages to EMCOMM)
      let netCommand = null;
      if (to.toUpperCase() === 'EMCOMM' || to.toUpperCase().startsWith('EMCOMM')) {
        const upper = text.toUpperCase().trim();
        const cqMatch = upper.match(/^CQ\s+(\S+)\s*(.*)/);
        const uMatch = upper.match(/^U\s+(\S+)/);
        if (cqMatch) {
          netCommand = { action: 'checkin', netName: cqMatch[1], status: cqMatch[2] || '' };
        } else if (uMatch) {
          netCommand = { action: 'checkout', netName: uMatch[1] };
        }
      }

      return {
        type: isBulletin ? 'bulletin' : 'message',
        from,
        to,
        text,
        cleanText: cleanComment,
        tokens,
        msgId,
        isShelterReport,
        netCommand,
        timestamp: Date.now(),
        raw: line,
      };
    } catch (e) {
      return null;
    }
  }

  // Parse a raw APRS packet into a position object (or null if not a position packet)
  function parseAprsPacket(line) {
    try {
      // Format: CALLSIGN>PATH:payload
      const headerEnd = line.indexOf(':');
      if (headerEnd < 0) return null;

      const header = line.substring(0, headerEnd);
      const payload = line.substring(headerEnd + 1);
      const callsign = header.split('>')[0].split('-')[0].trim(); // Strip SSID for grouping
      const ssid = header.split('>')[0].trim(); // Keep full SSID for display

      if (!callsign || callsign.length < 3) return null;

      // Position data type identifiers
      const dataType = payload.charAt(0);
      let lat, lon, symbolTable, symbolCode, comment, rest;

      if (dataType === '!' || dataType === '=') {
        // Position without timestamp: !DDMM.MMN/DDDMM.MMW$...
        lat = parseAprsLat(payload.substring(1, 9));
        symbolTable = payload.charAt(9);
        lon = parseAprsLon(payload.substring(10, 19));
        symbolCode = payload.charAt(19);
        comment = payload.substring(20).trim();
      } else if (dataType === '/' || dataType === '@') {
        // Position with timestamp: /HHMMSSh DDMM.MMN/DDDMM.MMW$...
        lat = parseAprsLat(payload.substring(8, 16));
        symbolTable = payload.charAt(16);
        lon = parseAprsLon(payload.substring(17, 26));
        symbolCode = payload.charAt(26);
        comment = payload.substring(27).trim();
      } else if (dataType === ';') {
        // Object: ;NAME_____*HHMMSSh DDMM.MMN/DDDMM.MMW$...
        const objPayload = payload.substring(11);
        const ts = objPayload.charAt(0) === '*' ? 8 : 0;
        rest = objPayload.substring(ts);
        if (rest.length >= 19) {
          lat = parseAprsLat(rest.substring(0, 8));
          symbolTable = rest.charAt(8);
          lon = parseAprsLon(rest.substring(9, 18));
          symbolCode = rest.charAt(18);
          comment = rest.substring(19).trim();
        }
      } else {
        return null; // Not a position packet
      }

      if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

      // Parse optional speed/course/altitude from comment
      let speed = null,
        course = null,
        altitude = null;
      const csMatch = comment?.match(/^(\d{3})\/(\d{3})/);
      if (csMatch) {
        course = parseInt(csMatch[1]);
        speed = parseInt(csMatch[2]); // knots
      }
      const altMatch = comment?.match(/\/A=(\d{6})/);
      if (altMatch) {
        altitude = parseInt(altMatch[1]); // feet
      }

      const { tokens, cleanComment } = parseResourceTokens(comment);

      return {
        call: callsign,
        ssid,
        lat,
        lon,
        symbol: `${symbolTable}${symbolCode}`,
        comment: comment || '',
        tokens,
        cleanComment,
        speed,
        course,
        altitude,
        timestamp: Date.now(),
        raw: line,
      };
    } catch (e) {
      return null;
    }
  }

  function connectAprsIS() {
    if (!APRS_ENABLED || aprsSocket) return;

    const loginCallsign = CONFIG.callsign || 'N0CALL';
    logInfo(`[APRS-IS] Connecting to ${APRS_HOST}:${APRS_PORT} as ${loginCallsign} (read-only)...`);

    aprsSocket = new net.Socket();
    aprsSocket.setTimeout(120000); // 2 min timeout

    aprsSocket.connect(APRS_PORT, APRS_HOST, () => {
      aprsConnected = true;
      aprsBuffer = '';
      logInfo('[APRS-IS] Connected, sending login...');

      // Read-only login (passcode -1)
      aprsSocket.write(`user ${loginCallsign} pass -1 vers OpenHamClock ${APP_VERSION}`);
      if (APRS_FILTER) {
        aprsSocket.write(` filter ${APRS_FILTER}`);
      }
      aprsSocket.write('\r\n');
    });

    aprsSocket.on('data', (data) => {
      aprsBuffer += data.toString();
      const lines = aprsBuffer.split('\n');
      aprsBuffer = lines.pop(); // Keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue; // Server comment

        const station = parseAprsPacket(trimmed);
        if (station) {
          aprsStations.set(station.ssid, station);

          // Prune if over limit
          if (aprsStations.size > APRS_MAX_STATIONS * 1.2) {
            const cutoff = Date.now() - APRS_MAX_AGE_MINUTES * 60000;
            for (const [key, val] of aprsStations) {
              if (val.timestamp < cutoff) aprsStations.delete(key);
            }
            // Hard cap if still too many
            if (aprsStations.size > APRS_MAX_STATIONS) {
              const sorted = [...aprsStations.entries()].sort((a, b) => b[1].timestamp - a[1].timestamp);
              aprsStations.clear();
              for (const [k, v] of sorted.slice(0, APRS_MAX_STATIONS)) {
                aprsStations.set(k, v);
              }
            }
          }
        } else {
          // Try parsing as telemetry
          const telem = parseAprsTelemetry(trimmed);
          if (telem && telem.type === 'data') {
            logDebug(
              `[APRS] Telemetry from ${telem.call}: ${telem.params.map((p, i) => `${p}=${telem.computed?.[i] ?? telem.values[i]}`).join(', ')}`,
            );
          }

          // Try parsing as a message (addressed message or bulletin)
          const msg = parseAprsMessage(trimmed);
          if (msg) {
            aprsMessages.push(msg);
            if (aprsMessages.length > APRS_MAX_MESSAGES) aprsMessages.shift();
            if (msg.isShelterReport) {
              logDebug(`[APRS] Shelter report from ${msg.from}: ${msg.text}`);
            }
            // Handle net check-in/check-out
            if (msg.netCommand) {
              const { action, netName, status } = msg.netCommand;
              if (action === 'checkin') {
                const station = aprsStations.get(msg.from.split('-')[0]) || {};
                netRoster.set(msg.from, {
                  call: msg.from,
                  netName,
                  status: status || 'Checked in',
                  checkinTime: Date.now(),
                  lastHeard: Date.now(),
                  lat: station.lat ?? null,
                  lon: station.lon ?? null,
                  tokens: station.tokens || [],
                  source: station.source || null,
                });
                logInfo(`[APRS Net] ${msg.from} checked into ${netName}: ${status || '(no status)'}`);
              } else if (action === 'checkout') {
                netRoster.delete(msg.from);
                logInfo(`[APRS Net] ${msg.from} checked out of ${netName}`);
              }
            }
          }
        }
      }
    });

    aprsSocket.on('error', (err) => {
      logErrorOnce('APRS-IS', err.message);
    });

    aprsSocket.on('close', () => {
      aprsConnected = false;
      aprsSocket = null;
      logInfo('[APRS-IS] Disconnected, reconnecting in 30s...');
      clearTimeout(aprsReconnectTimer);
      aprsReconnectTimer = setTimeout(connectAprsIS, 30000);
    });

    aprsSocket.on('timeout', () => {
      logWarn('[APRS-IS] Socket timeout, reconnecting...');
      try {
        aprsSocket.destroy();
      } catch (e) {}
    });
  }

  // Periodic cleanup of old stations
  setInterval(() => {
    if (!APRS_ENABLED) return;
    const cutoff = Date.now() - APRS_MAX_AGE_MINUTES * 60000;
    for (const [key, val] of aprsStations) {
      if (val.timestamp < cutoff) aprsStations.delete(key);
    }
  }, 60000);

  // Start APRS-IS connection if enabled
  if (APRS_ENABLED) {
    connectAprsIS();
  }

  // REST endpoint: GET /api/aprs/stations
  app.get('/api/aprs/stations', (req, res) => {
    const cutoff = Date.now() - APRS_MAX_AGE_MINUTES * 60000;
    const stations = [];
    for (const [, station] of aprsStations) {
      if (station.timestamp >= cutoff) {
        stations.push({
          call: station.call,
          ssid: station.ssid,
          lat: station.lat,
          lon: station.lon,
          symbol: station.symbol,
          comment: station.comment,
          tokens: station.tokens || [],
          cleanComment: station.cleanComment || station.comment,
          speed: station.speed,
          course: station.course,
          altitude: station.altitude,
          age: Math.floor((Date.now() - station.timestamp) / 60000),
          timestamp: station.timestamp,
        });
      }
    }
    res.json({
      connected: aprsConnected,
      enabled: APRS_ENABLED,
      count: stations.length,
      stations: stations.sort((a, b) => b.timestamp - a.timestamp),
    });
  });

  // REST endpoint: GET /api/aprs/messages — APRS messages and bulletins
  app.get('/api/aprs/messages', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const shelterOnly = req.query.shelter === 'true';
    let msgs = aprsMessages.filter((m) => m.timestamp > since);
    if (shelterOnly) msgs = msgs.filter((m) => m.isShelterReport);
    res.json({
      count: msgs.length,
      messages: msgs,
    });
  });

  // REST endpoint: GET /api/aprs/shelters — shelter reports extracted from APRS
  app.get('/api/aprs/shelters', (req, res) => {
    const shelterReports = aprsMessages
      .filter((m) => m.isShelterReport)
      .map((m) => ({
        from: m.from,
        text: m.cleanText || m.text,
        tokens: m.tokens,
        timestamp: m.timestamp,
        type: m.type,
      }));
    res.json({
      count: shelterReports.length,
      shelters: shelterReports,
    });
  });

  // REST endpoint: GET /api/aprs/net — net operations roster
  app.get('/api/aprs/net', (req, res) => {
    // Update lastHeard from station cache for each roster entry
    const roster = [];
    for (const [call, entry] of netRoster) {
      const station = aprsStations.get(call.split('-')[0]);
      if (station) {
        entry.lastHeard = station.timestamp;
        entry.lat = station.lat;
        entry.lon = station.lon;
        entry.tokens = station.tokens || [];
      }
      const age = Math.floor((Date.now() - entry.lastHeard) / 60000);
      roster.push({
        ...entry,
        age,
        stale: age > 10,
      });
    }
    roster.sort((a, b) => a.age - b.age);
    res.json({ count: roster.length, roster });
  });

  // REST endpoint: POST /api/aprs/net/checkin — manual check-in (for operators without APRS TX)
  app.post('/api/aprs/net/checkin', (req, res) => {
    const { callsign, netName, status } = req.body;
    if (!callsign || !netName) return res.status(400).json({ error: 'Missing callsign or netName' });

    const station = aprsStations.get(callsign.split('-')[0].toUpperCase());
    netRoster.set(callsign.toUpperCase(), {
      call: callsign.toUpperCase(),
      netName,
      status: status || 'Checked in',
      checkinTime: Date.now(),
      lastHeard: Date.now(),
      lat: station?.lat ?? null,
      lon: station?.lon ?? null,
      tokens: station?.tokens || [],
      source: 'manual',
    });
    res.json({ ok: true });
  });

  // REST endpoint: POST /api/aprs/net/checkout — manual check-out
  app.post('/api/aprs/net/checkout', (req, res) => {
    const { callsign } = req.body;
    if (!callsign) return res.status(400).json({ error: 'Missing callsign' });
    netRoster.delete(callsign.toUpperCase());
    res.json({ ok: true });
  });

  // REST endpoint: GET /api/aprs/telemetry — telemetry data from all stations
  app.get('/api/aprs/telemetry', (req, res) => {
    const callsign = req.query.callsign;
    if (callsign) {
      const data = telemetryData.get(callsign.toUpperCase());
      return res.json(data || { error: 'No telemetry for this callsign' });
    }
    const all = [];
    for (const [, entry] of telemetryData) {
      all.push(entry);
    }
    res.json({ count: all.length, telemetry: all });
  });

  // REST endpoint: POST /api/aprs/message — send APRS message via rig-bridge
  app.post('/api/aprs/message', async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });
    if (message.length > 67) return res.status(400).json({ error: 'Message exceeds 67 char APRS limit' });

    // Try to send via rig-bridge APRS TNC plugin
    try {
      const rigHost = CONFIG.rigControl?.host || 'http://localhost';
      const rigPort = CONFIG.rigControl?.port || 5555;
      const response = await ctx.fetch(`${rigHost}:${rigPort}/aprs/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message }),
      });
      if (response.ok) {
        return res.json({ ok: true, via: 'rig-bridge' });
      }
      const err = await response.text();
      return res.status(response.status).json({ error: `Rig Bridge: ${err}` });
    } catch (e) {
      return res.status(503).json({ error: 'APRS TNC not available — enable APRS TNC plugin in rig-bridge' });
    }
  });

  // REST endpoint: POST /api/aprs/local — inject local TNC packets (from cloud relay)
  // Accepts raw APRS info strings and parses them into station objects.
  app.post('/api/aprs/local', (req, res) => {
    const packets = req.body.packets;
    if (!Array.isArray(packets)) {
      return res.status(400).json({ error: 'Missing packets array' });
    }

    let added = 0;
    for (const pkt of packets) {
      if (!pkt.source || !pkt.info) continue;

      // Reconstruct a raw APRS line so parseAprsPacket can handle it
      const rawLine = `${pkt.source}>${pkt.destination || 'APRS'}:${pkt.info}`;
      const station = parseAprsPacket(rawLine);
      if (!station) {
        // Try as message
        const msg = parseAprsMessage(rawLine);
        if (msg) {
          msg.source = 'local-tnc';
          aprsMessages.push(msg);
          if (aprsMessages.length > APRS_MAX_MESSAGES) aprsMessages.shift();
        }
        continue;
      }

      station.source = 'local-tnc'; // Tag so UI can distinguish RF from internet
      station.timestamp = pkt.timestamp || Date.now();

      const key = station.call;
      const existing = aprsStations.get(key);
      if (!existing || station.timestamp > existing.timestamp) {
        if (!existing && aprsStations.size >= APRS_MAX_STATIONS) {
          // Evict oldest
          let oldestKey = null;
          let oldestTime = Infinity;
          for (const [k, v] of aprsStations) {
            if (v.timestamp < oldestTime) {
              oldestTime = v.timestamp;
              oldestKey = k;
            }
          }
          if (oldestKey) aprsStations.delete(oldestKey);
        }
        aprsStations.set(key, station);
        added++;
      }
    }

    logDebug(`[APRS] Ingested ${added} local TNC packets (${packets.length} received)`);
    res.json({ ok: true, added });
  });
};
