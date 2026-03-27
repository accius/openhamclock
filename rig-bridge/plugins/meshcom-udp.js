'use strict';
/**
 * meshcom-udp.js — MeshCom UDP JSON receiver plugin
 *
 * Binds a UDP socket on port 1799 (MeshCom default) and receives JSON
 * packets broadcast by MeshCom nodes. Packets are deduplicated (same
 * hw_id+msg_id arriving via multiple mesh paths) then emitted on the
 * plugin bus. The cloud-relay plugin picks them up and forwards them to
 * the OHC server — the same pattern used by the APRS-TNC plugin.
 *
 * Config section: config.meshcom
 *   enabled:        boolean  (default: false)
 *   bindPort:       number   UDP port to bind (default: 1799)
 *   bindHost:       string   Bind address (default: '0.0.0.0')
 *   sendHost:       string   IP to send outgoing UDP messages to (default: '255.255.255.255')
 *   sendPort:       number   Port for outgoing UDP messages (default: 1799)
 *   verbose:        boolean  Log all received packets (default: false)
 *
 * MeshCom UDP JSON packet types handled:
 *   type: "pos"   — position (lat, long, lat_dir, long_dir, alt, batt, hw_id)
 *   type: "msg"   — text message (src, dst, msg, msg_id)
 *   type: "telem" — weather/sensor (tempC, humidity, pressureHpa, co2ppm, rssi, snr)
 */

const dgram = require('dgram');

let _currentInstance = null;

// ── Firmware version normalisation ───────────────────────────────────────────
// MeshCom encodes firmware version differently depending on whether the packet
// originates from the local gateway node or arrived via a LoRa relay hop:
//
//   src_type "node": firmware = "4.35" (string), fw_sub = "p"  → want "4.35p"
//   src_type "lora": firmware = 35     (integer, major "4." stripped by
//                    shortVERSION()), fw_sub = "p"              → want "4.35p"
//
// In both cases fw_sub carries the suffix letter and must always be appended.
function normalizeFirmware(firmware, fwSub) {
  if (firmware == null) return null;
  const sub = fwSub ? String(fwSub).trim() : '';
  // Integer → relayed packet: major version is always "4.", minor is the integer
  if (typeof firmware === 'number' || (typeof firmware === 'string' && /^\d+$/.test(firmware.trim()))) {
    return `4.${String(firmware).trim()}${sub}`;
  }
  // String like "4.35" — just append the suffix
  return `${String(firmware).trim()}${sub}`;
}

// ── Coordinate normalisation ─────────────────────────────────────────────────
// MeshCom sends positive decimals + direction indicators.
// Always check for null/undefined before applying sign — 0 is a valid coordinate.
function normalizeLat(lat, latDir) {
  if (lat == null) return null;
  const val = parseFloat(lat);
  if (!Number.isFinite(val)) return null;
  return latDir === 'S' ? -Math.abs(val) : Math.abs(val);
}

function normalizeLon(lon, lonDir) {
  if (lon == null) return null;
  const val = parseFloat(lon);
  if (!Number.isFinite(val)) return null;
  return lonDir === 'W' ? -Math.abs(val) : Math.abs(val);
}

const descriptor = {
  id: 'meshcom-udp',
  name: 'MeshCom UDP Receiver',
  category: 'integration',
  configKey: 'meshcom',

  registerRoutes(app) {
    app.get('/api/meshcom-udp/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });

    // Send a text message out to the mesh via UDP broadcast
    app.post('/api/meshcom-udp/send', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'MeshCom UDP plugin not running' });
      const { to, message } = req.body;
      if (!message) return res.status(400).json({ error: 'Missing message' });
      if (message.length > 150) return res.status(400).json({ error: 'Message exceeds 150 char MeshCom limit' });
      const ok = _currentInstance.sendMessage(to || '*', message);
      if (!ok) return res.status(503).json({ error: 'UDP socket not ready' });
      res.json({ success: true });
    });
  },

  create(config, services) {
    const cfg = config.meshcom || {};
    const bindPort = cfg.bindPort ?? 1799;
    const bindHost = cfg.bindHost || '0.0.0.0';
    const sendHost = cfg.sendHost || '255.255.255.255';
    const sendPort = cfg.sendPort ?? 1799;
    const verbose = !!cfg.verbose;
    const bus = services?.pluginBus;

    let socket = null;
    let running = false;
    let packetsRx = 0;
    let packetsTx = 0;
    let lastPacketTime = null;

    // Deduplication cache: `${hw_id}:${msg_id}` → timestamp (ms)
    // MeshCom mesh rebroadcasts the same packet via multiple paths.
    const dedupCache = new Map();
    const DEDUP_TTL_MS = 60_000;

    function cleanDedup() {
      const cutoff = Date.now() - DEDUP_TTL_MS;
      for (const [key, ts] of dedupCache) {
        if (ts < cutoff) dedupCache.delete(key);
      }
    }

    function isDuplicate(hwId, msgId) {
      if (!hwId && !msgId) return false; // can't deduplicate without an id
      const key = `${hwId ?? ''}:${msgId ?? ''}`;
      if (dedupCache.has(key)) return true;
      dedupCache.set(key, Date.now());
      return false;
    }

    // ── Packet handler ───────────────────────────────────────────────────────
    // Emits normalised packets on the plugin bus. The cloud-relay plugin picks
    // them up and forwards them to the OHC server, exactly as APRS-TNC does.
    function handlePacket(json) {
      const type = json.type;

      if (type === 'pos') {
        if (isDuplicate(json.hw_id, json.msg_id)) return;

        const lat = normalizeLat(json.lat, json.lat_dir);
        const lon = normalizeLon(json.long ?? json.lon, json.long_dir ?? json.lon_dir);

        if (bus)
          bus.emit('meshcom', {
            subtype: 'pos',
            src: json.src,
            hwId: json.hw_id,
            lat,
            lon,
            alt: json.alt != null ? Math.round(parseFloat(json.alt) * 0.3048) : null,
            batt: json.batt != null ? parseFloat(json.batt) : null,
            aprsSymbol: json.aprs_symbol || null,
            firmware: normalizeFirmware(json.firmware, json.fw_sub),
            msgId: json.msg_id || null,
            timestamp: Date.now(),
          });
      } else if (type === 'msg') {
        if (isDuplicate(json.hw_id, json.msg_id)) return;

        if (bus)
          bus.emit('meshcom', {
            subtype: 'msg',
            src: json.src,
            dst: json.dst || '*',
            msg: json.msg,
            msgId: json.msg_id || null,
            timestamp: Date.now(),
          });
      } else if (type === 'telem') {
        if (isDuplicate(json.hw_id, json.msg_id)) return;

        if (bus)
          bus.emit('meshcom', {
            subtype: 'telem',
            src: json.src,
            hwId: json.hw_id,
            tempC: json.temp != null ? parseFloat(json.temp) : null,
            humidity: json.humidity != null ? parseFloat(json.humidity) : null,
            pressureHpa: json.pressure != null ? parseFloat(json.pressure) : null,
            co2ppm: json.co2 != null ? parseFloat(json.co2) : null,
            rssi: json.rssi != null ? parseFloat(json.rssi) : null,
            snr: json.snr != null ? parseFloat(json.snr) : null,
            timestamp: Date.now(),
          });
      }
      // Other types (I, SE, SW, SN, etc.) are informational — ignore.
    }

    function sendMessage(to, message) {
      if (!socket || !running) return false;
      const payload = JSON.stringify({ type: 'msg', dst: to, msg: message });
      const buf = Buffer.from(payload);
      try {
        socket.send(buf, 0, buf.length, sendPort, sendHost, (err) => {
          if (err) console.error(`[MeshCom-UDP] TX error: ${err.message}`);
          else packetsTx++;
        });
        return true;
      } catch (e) {
        console.error(`[MeshCom-UDP] TX error: ${e.message}`);
        return false;
      }
    }

    function getStatus() {
      return {
        enabled: !!cfg.enabled,
        running,
        bindPort,
        bindHost,
        packetsRx,
        packetsTx,
        lastPacketTime,
        dedupCacheSize: dedupCache.size,
      };
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    let dedupTimer = null;

    function connect() {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', (err) => {
        console.error(`[MeshCom-UDP] Socket error: ${err.message}`);
        running = false;
      });

      socket.on('message', (msg) => {
        packetsRx++;
        lastPacketTime = Date.now();
        let json;
        try {
          json = JSON.parse(msg.toString());
        } catch {
          return; // Not valid JSON — ignore
        }
        if (verbose) {
          console.log(`[MeshCom-UDP] RX: ${msg.toString().substring(0, 120)}`);
        }
        handlePacket(json);
      });

      socket.bind(bindPort, bindHost, () => {
        socket.setBroadcast(true);
        running = true;
        console.log(`[MeshCom-UDP] Listening on ${bindHost}:${bindPort}`);
      });

      // Periodic dedup cache cleanup
      dedupTimer = setInterval(cleanDedup, 30_000);
    }

    function disconnect() {
      if (dedupTimer) {
        clearInterval(dedupTimer);
        dedupTimer = null;
      }
      if (socket) {
        try {
          socket.close();
        } catch {}
        socket = null;
      }
      running = false;
      _currentInstance = null;
      console.log(`[MeshCom-UDP] Stopped (RX: ${packetsRx}, TX: ${packetsTx})`);
    }

    const instance = { connect, disconnect, getStatus, sendMessage };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
