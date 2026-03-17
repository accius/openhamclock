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

      return {
        call: callsign,
        ssid,
        lat,
        lon,
        symbol: `${symbolTable}${symbolCode}`,
        comment: comment || '',
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
};
