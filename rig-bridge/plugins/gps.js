'use strict';
/**
 * gps.js — GPS receiver plugin.
 *
 * Reads a position fix from one of three sources and publishes it to every
 * connected browser over the /stream SSE channel as
 *   { type: 'plugin', event: 'gps', source: 'gps', data: fix }
 * where fix = { fix, lat, lon, alt, speed (km/h), course, time (ISO UTC from
 * the receiver), sats, hdop, grid6, timeOffsetMs, source, updatedAt }.
 *
 * Sources (config.gps.source):
 *   serial — NMEA 0183 over a USB/UART GPS puck (serialport, 9600 8N1 default)
 *   gpsd   — gpsd's JSON protocol on TCP 2947 (?WATCH={"enable":true,"json":true})
 *   file   — a UNIX fifo or regular file that something else pipes NMEA into
 *            (e.g. `socat` from a Bluetooth GPS, or `cat /dev/ttyACM0 > fifo`)
 *   mock   — a simulated receiver driving around Boulder, for testing the
 *            rover UI without hardware
 *
 * Config section: config.gps
 *   enabled, source, serialPort, baudRate, gpsdHost, gpsdPort, filePath,
 *   publishInterval (ms, default 1000), verbose
 *
 * API: GET /api/gps/status
 */

const net = require('net');
const fs = require('fs');
const { NmeaFix, LineSplitter } = require('../lib/nmea');
const { applyTpv, applySky, parseGpsdLine, WATCH_COMMAND } = require('../lib/gpsd');
const { latLonToGrid } = require('../lib/maidenhead');

let _currentInstance = null;

const RECONNECT_MS = 10000;
const FIX_STALE_MS = 15000;

const descriptor = {
  id: 'gps',
  name: 'GPS Receiver',
  category: 'integration',
  configKey: 'gps',

  registerRoutes(app) {
    app.get('/api/gps/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
  },

  create(config, services = {}) {
    const { pluginBus } = services;
    const cfg = () => config.gps || {};

    let running = false;
    let connected = false;
    let lastError = null;
    let lastFix = null; // last published fix
    let lastPublishAt = 0;
    let sentences = 0;

    // Source handles
    let serialPort = null;
    let socket = null;
    let fileStream = null;
    let fileTimer = null;
    let reconnectTimer = null;
    let mockTimer = null;
    let staleTimer = null;

    const nmea = new NmeaFix();
    const gpsdFix = {
      fix: false,
      lat: null,
      lon: null,
      alt: null,
      speed: null,
      course: null,
      time: null,
      sats: null,
      hdop: null,
      grid6: null,
      updatedAt: 0,
    };

    const log = (...a) => console.log('[GPS]', ...a);
    const vlog = (...a) => cfg().verbose && console.log('[GPS]', ...a);

    function publish(fix, force = false) {
      const now = Date.now();
      const interval = Math.max(200, parseInt(cfg().publishInterval, 10) || 1000);
      if (!force && now - lastPublishAt < interval) return;
      lastPublishAt = now;
      const gpsTimeMs = fix.time ? Date.parse(fix.time) : NaN;
      lastFix = {
        ...fix,
        source: cfg().source || 'serial',
        // Positive = GPS clock is ahead of this computer's clock
        timeOffsetMs: Number.isFinite(gpsTimeMs) ? Math.round(gpsTimeMs - now) : null,
        receivedAt: now,
      };
      if (pluginBus) pluginBus.emit('gps', lastFix);
      vlog(
        lastFix.fix
          ? `fix ${lastFix.lat.toFixed(5)},${lastFix.lon.toFixed(5)} ${lastFix.grid6} ${Math.round(lastFix.speed || 0)} km/h`
          : 'no fix',
      );
    }

    function onNmeaLine(line) {
      const f = nmea.update(line);
      if (f) {
        sentences++;
        if (!connected) connected = true;
        publish(f);
      }
    }

    // ── Source: serial ──────────────────────────────────────────────────
    function openSerial() {
      let SerialPort;
      try {
        SerialPort = require('../core/serial-utils').getSerialPort();
      } catch (e) {
        SerialPort = null;
      }
      if (!SerialPort) {
        lastError = 'serialport module not available';
        console.error('[GPS]', lastError);
        return;
      }
      const path = cfg().serialPort;
      if (!path) {
        lastError = 'No serial port configured';
        console.error('[GPS]', lastError);
        return;
      }
      const baudRate = parseInt(cfg().baudRate, 10) || 9600;
      log(`Opening ${path} @ ${baudRate} (NMEA)`);
      const splitter = new LineSplitter();
      try {
        serialPort = new SerialPort({ path, baudRate, dataBits: 8, stopBits: 1, parity: 'none', autoOpen: false });
      } catch (e) {
        lastError = e.message;
        scheduleReconnect();
        return;
      }
      serialPort.on('data', (buf) => splitter.push(buf).forEach(onNmeaLine));
      serialPort.on('error', (err) => {
        lastError = err.message;
        console.error('[GPS] Serial error:', err.message);
      });
      serialPort.on('close', () => {
        connected = false;
        serialPort = null;
        if (running) scheduleReconnect();
      });
      serialPort.open((err) => {
        if (err) {
          lastError = err.message;
          console.error('[GPS] Cannot open serial port:', err.message);
          serialPort = null;
          scheduleReconnect();
        } else {
          lastError = null;
          log('Serial port open');
        }
      });
    }

    // ── Source: gpsd ────────────────────────────────────────────────────
    function openGpsd() {
      const host = cfg().gpsdHost || '127.0.0.1';
      const port = parseInt(cfg().gpsdPort, 10) || 2947;
      log(`Connecting to gpsd at ${host}:${port}`);
      const splitter = new LineSplitter(65536);
      socket = net.createConnection({ host, port }, () => {
        lastError = null;
        log('Connected to gpsd');
        socket.write(WATCH_COMMAND);
      });
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        for (const line of splitter.push(chunk)) {
          const msg = parseGpsdLine(line);
          if (!msg) continue;
          if (msg.class === 'TPV') {
            applyTpv(gpsdFix, msg);
            sentences++;
            connected = true;
            publish(gpsdFix);
          } else if (msg.class === 'SKY') {
            applySky(gpsdFix, msg);
          } else if (msg.class === 'VERSION') {
            vlog(`gpsd ${msg.release || ''}`);
          }
        }
      });
      socket.on('error', (err) => {
        lastError = err.message;
        if (connected) console.error('[GPS] gpsd error:', err.message);
      });
      socket.on('close', () => {
        connected = false;
        socket = null;
        if (running) scheduleReconnect();
      });
    }

    // ── Source: fifo / file ─────────────────────────────────────────────
    function openFile() {
      const path = cfg().filePath;
      if (!path) {
        lastError = 'No file path configured';
        console.error('[GPS]', lastError);
        return;
      }
      let st;
      try {
        st = fs.statSync(path);
      } catch (e) {
        lastError = `Cannot stat ${path}: ${e.message}`;
        scheduleReconnect();
        return;
      }
      if (st.isFIFO() || st.isCharacterDevice()) {
        log(`Reading NMEA from ${st.isFIFO() ? 'fifo' : 'device'} ${path}`);
        const splitter = new LineSplitter();
        fileStream = fs.createReadStream(path, { encoding: 'ascii' });
        fileStream.on('data', (chunk) => splitter.push(chunk).forEach(onNmeaLine));
        fileStream.on('error', (err) => {
          lastError = err.message;
          console.error('[GPS] File error:', err.message);
        });
        fileStream.on('close', () => {
          fileStream = null;
          connected = false;
          if (running) scheduleReconnect(1000); // writer closed the fifo — reopen
        });
        return;
      }
      // Regular file: something appends NMEA to it; tail the last 4 KB once a second.
      log(`Tailing NMEA file ${path}`);
      let lastSize = -1;
      const tail = () => {
        try {
          const s = fs.statSync(path);
          if (s.size === lastSize) return;
          lastSize = s.size;
          const len = Math.min(s.size, 4096);
          const fd = fs.openSync(path, 'r');
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, s.size - len);
          fs.closeSync(fd);
          const lines = buf.toString('ascii').split(/\r?\n/);
          if (len === 4096) lines.shift(); // first line may be partial
          lines.forEach(onNmeaLine);
          lastError = null;
        } catch (e) {
          lastError = e.message;
        }
      };
      tail();
      fileTimer = setInterval(tail, 1000);
    }

    // ── Source: mock ────────────────────────────────────────────────────
    function openMock() {
      log('Simulated GPS — driving north-east from Boulder at ~90 km/h');
      let lat = 40.015;
      let lon = -105.2705;
      let course = 45;
      const speedKmh = 90;
      connected = true;
      mockTimer = setInterval(() => {
        const dKm = speedKmh / 3600; // 1 s step
        const dLat = (dKm / 111.32) * Math.cos((course * Math.PI) / 180);
        const dLon = (dKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin((course * Math.PI) / 180);
        lat += dLat;
        lon += dLon;
        course = (course + (Math.random() - 0.5) * 4 + 360) % 360;
        sentences++;
        publish(
          {
            fix: true,
            lat,
            lon,
            alt: 1630 + Math.sin(Date.now() / 60000) * 20,
            speed: speedKmh + (Math.random() - 0.5) * 6,
            course,
            time: new Date().toISOString(),
            sats: 9,
            hdop: 0.9,
            quality: 1,
            mode: 3,
            grid6: latLonToGrid(lat, lon, 6),
            updatedAt: Date.now(),
          },
          true,
        );
      }, 1000);
    }

    function scheduleReconnect(ms = RECONNECT_MS) {
      if (!running || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (running) openSource();
      }, ms);
    }

    function openSource() {
      const source = cfg().source || 'serial';
      if (source === 'gpsd') openGpsd();
      else if (source === 'file') openFile();
      else if (source === 'mock') openMock();
      else openSerial();
    }

    function connect() {
      running = true;
      openSource();
      // Flag a lost fix (receiver unplugged, no sentences) so the browser can grey out
      staleTimer = setInterval(() => {
        if (lastFix && lastFix.fix && Date.now() - lastFix.receivedAt > FIX_STALE_MS) {
          publish({ ...lastFix, fix: false, grid6: null }, true);
        }
      }, 5000);
    }

    function disconnect() {
      running = false;
      connected = false;
      for (const t of [reconnectTimer, fileTimer, mockTimer, staleTimer]) if (t) (clearTimeout(t), clearInterval(t));
      reconnectTimer = fileTimer = mockTimer = staleTimer = null;
      if (serialPort) {
        try {
          serialPort.close();
        } catch (e) {}
        serialPort = null;
      }
      if (socket) {
        try {
          socket.destroy();
        } catch (e) {}
        socket = null;
      }
      if (fileStream) {
        try {
          fileStream.destroy();
        } catch (e) {}
        fileStream = null;
      }
      _currentInstance = null;
      log('Stopped');
    }

    function getStatus() {
      return {
        enabled: !!cfg().enabled,
        running,
        connected,
        source: cfg().source || 'serial',
        lastError,
        sentences,
        fix: lastFix,
        fixAgeMs: lastFix ? Date.now() - lastFix.receivedAt : null,
      };
    }

    /** Events replayed to a browser that connects to /stream later. */
    function getSseSnapshot() {
      return lastFix ? [{ type: 'plugin', event: 'gps', source: 'gps', data: lastFix }] : [];
    }

    const instance = { connect, disconnect, getStatus, getSseSnapshot, _publish: publish };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
