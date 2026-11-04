'use strict';
/**
 * env-sensors.js — Environment sensors plugin (temperature / humidity /
 * pressure), the Rig Bridge counterpart of HamClock's BME280 panes.
 *
 * Sources (all optional, any combination):
 *   sensorA / sensorB — Bosch BME280 or BMP280 on the Pi's I2C bus at
 *                       0x76 / 0x77 (i2c-bus is an optionalDependency,
 *                       loaded lazily — the plugin still runs without it)
 *   http              — any JSON URL (ESPHome, Tasmota, Home Assistant, a
 *                       weather-station firmware…) with dotted field paths
 *   mock              — simulated readings for UI work without hardware
 *
 * Per-sensor corrections dTemp / dPres / dHum are added to the raw reading
 * (HamClock's dTemp/dPres: compensate for self-heating or a sensor mounted
 * above/below station level).
 *
 * Publishes { type:'plugin', event:'env', source:'env-sensors', data:
 *   { t, sources: [ { id, name, type, temperature(°C), humidity(%), pressure(hPa),
 *                      dewPoint(°C), t, error } ] } }
 * on every poll and keeps a 24 h / 1-sample-per-minute history per source.
 *
 * API:
 *   GET /api/env/status   current readings + source state
 *   GET /api/env/history  { sources: { A: { name, type, samples:[{t,temp,hum,pres}] } } }
 */

const bme = require('../lib/bme280');
const { MinuteRing } = require('../lib/sample-ring');
const { pickNumber, toCelsius, toHpa, fetchJson } = require('../lib/http-json');

let _currentInstance = null;

const HISTORY_MINUTES = 24 * 60;

const descriptor = {
  id: 'env-sensors',
  name: 'Environment Sensors (BME280 / HTTP)',
  category: 'integration',
  configKey: 'envSensors',

  registerRoutes(app) {
    app.get('/api/env/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false, sources: [] });
      res.json(_currentInstance.getStatus());
    });
    app.get('/api/env/history', (req, res) => {
      if (!_currentInstance) return res.json({ sources: {} });
      res.json(_currentInstance.getHistory());
    });
  },

  create(config, services = {}) {
    const { pluginBus } = services;
    const cfg = () => config.envSensors || {};

    let running = false;
    let pollTimer = null;
    let bus = null; // i2c-bus promisified handle
    let i2cError = null;
    const sources = new Map(); // id → { id, name, type, read(), ring, last, nextAt }

    const log = (...a) => console.log('[Env]', ...a);
    const vlog = (...a) => cfg().verbose && console.log('[Env]', ...a);

    const num = (v, d = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);

    // ── I2C / BME280 ────────────────────────────────────────────────────
    async function openBus() {
      if (bus) return bus;
      let i2c;
      try {
        i2c = require('i2c-bus');
      } catch (e) {
        i2cError = 'i2c-bus module not installed (cd rig-bridge && npm install i2c-bus)';
        throw new Error(i2cError);
      }
      const busNum = parseInt(cfg().i2cBus, 10) || 1;
      try {
        bus = await i2c.openPromisified(busNum);
        i2cError = null;
      } catch (e) {
        i2cError = `Cannot open /dev/i2c-${busNum}: ${e.message} (enable I2C with raspi-config)`;
        throw new Error(i2cError);
      }
      return bus;
    }

    function makeBmeSource(id, scfg) {
      const address = bme.parseI2cAddress(scfg.address, id === 'A' ? 0x76 : 0x77);
      let cal = null;
      let chip = null;
      const src = {
        id,
        name: scfg.name || (id === 'A' ? 'Sensor A' : 'Sensor B'),
        type: 'bme280',
        address,
        corrections: { dTemp: num(scfg.dTemp), dPres: num(scfg.dPres), dHum: num(scfg.dHum) },
        ring: new MinuteRing(HISTORY_MINUTES),
        last: null,
        nextAt: 0,
        async read() {
          const b = await openBus();
          if (!cal) {
            const idBuf = Buffer.alloc(1);
            await b.readI2cBlock(address, bme.REG.CHIP_ID, 1, idBuf);
            chip = bme.chipName(idBuf[0]);
            if (!chip) throw new Error(`Unknown chip id 0x${idBuf[0].toString(16)} at 0x${address.toString(16)}`);
            const c0 = Buffer.alloc(26);
            await b.readI2cBlock(address, bme.REG.CALIB_00, 26, c0);
            let c1 = null;
            if (chip === 'BME280') {
              c1 = Buffer.alloc(7);
              await b.readI2cBlock(address, bme.REG.CALIB_26, 7, c1);
              await b.writeByte(address, bme.REG.CTRL_HUM, bme.CTRL_HUM_1X);
            }
            await b.writeByte(address, bme.REG.CONFIG, bme.CONFIG_FILTER_OFF);
            cal = bme.parseCalibration(c0, c1);
            src.type = chip;
            log(`${chip} found at 0x${address.toString(16)} (${src.name})`);
          }
          // Forced mode: one measurement, then the sensor sleeps (no self-heating)
          await b.writeByte(address, bme.REG.CTRL_MEAS, bme.CTRL_MEAS_FORCED_1X);
          await new Promise((r) => setTimeout(r, 15));
          const data = Buffer.alloc(8);
          await b.readI2cBlock(address, bme.REG.DATA, 8, data);
          const raw = bme.parseRawData(data);
          const out = bme.compensate(raw, cal);
          if (chip === 'BMP280') out.humidity = null;
          return out;
        },
      };
      return src;
    }

    // ── HTTP JSON ───────────────────────────────────────────────────────
    function makeHttpSource(h) {
      return {
        id: 'http',
        name: h.name || 'Remote',
        type: 'http',
        url: h.url,
        corrections: { dTemp: num(h.dTemp), dPres: num(h.dPres), dHum: num(h.dHum) },
        intervalMs: Math.max(5, parseInt(h.interval, 10) || 60) * 1000,
        ring: new MinuteRing(HISTORY_MINUTES),
        last: null,
        nextAt: 0,
        async read() {
          const json = await fetchJson(h.url, 5000);
          const temperature = toCelsius(pickNumber(json, h.tempPath || 'temperature'), h.tempUnit);
          const humidity = h.humPath === '' ? null : pickNumber(json, h.humPath || 'humidity');
          const pressure = toHpa(pickNumber(json, h.presPath || 'pressure'), h.presUnit);
          if (temperature == null && humidity == null && pressure == null) {
            throw new Error('No matching fields in JSON — check the field paths');
          }
          return { temperature, humidity, pressure };
        },
      };
    }

    // ── Mock ────────────────────────────────────────────────────────────
    function makeMockSource(id, name, base) {
      return {
        id,
        name,
        type: 'mock',
        corrections: { dTemp: 0, dPres: 0, dHum: 0 },
        ring: new MinuteRing(HISTORY_MINUTES),
        last: null,
        nextAt: 0,
        async read() {
          const phase = Date.now() / 3600000; // slow diurnal-ish drift
          return {
            temperature: base.t + Math.sin(phase * 2 * Math.PI) * 3 + (Math.random() - 0.5) * 0.2,
            humidity: base.h - Math.sin(phase * 2 * Math.PI) * 8 + (Math.random() - 0.5),
            pressure: base.p + Math.sin(phase * Math.PI) * 2 + (Math.random() - 0.5) * 0.1,
          };
        },
      };
    }

    function buildSources() {
      sources.clear();
      const c = cfg();
      if (c.mock) {
        sources.set(
          'A',
          makeMockSource('A', (c.sensorA && c.sensorA.name) || 'Indoor (mock)', { t: 22, h: 40, p: 1012 }),
        );
        sources.set(
          'B',
          makeMockSource('B', (c.sensorB && c.sensorB.name) || 'Outdoor (mock)', { t: 12, h: 65, p: 1011.5 }),
        );
      } else {
        if (c.sensorA && c.sensorA.enabled) sources.set('A', makeBmeSource('A', c.sensorA));
        if (c.sensorB && c.sensorB.enabled) sources.set('B', makeBmeSource('B', c.sensorB));
      }
      if (c.http && c.http.enabled && c.http.url) sources.set('http', makeHttpSource(c.http));
    }

    function toReading(src, raw, err, t) {
      const r = {
        id: src.id,
        name: src.name,
        type: src.type,
        temperature: null,
        humidity: null,
        pressure: null,
        dewPoint: null,
        t,
        error: err ? String(err.message || err) : null,
      };
      if (raw) {
        const { dTemp, dPres, dHum } = src.corrections;
        if (Number.isFinite(raw.temperature)) r.temperature = +(raw.temperature + dTemp).toFixed(2);
        if (Number.isFinite(raw.pressure)) r.pressure = +(raw.pressure + dPres).toFixed(2);
        if (Number.isFinite(raw.humidity)) r.humidity = +Math.min(100, Math.max(0, raw.humidity + dHum)).toFixed(1);
        if (r.temperature != null && r.humidity != null) {
          const dp = bme.dewPointC(r.temperature, r.humidity);
          r.dewPoint = dp == null ? null : +dp.toFixed(1);
        }
      }
      return r;
    }

    async function poll() {
      const now = Date.now();
      const readings = [];
      for (const src of sources.values()) {
        if (src.intervalMs && now < src.nextAt) {
          if (src.last) readings.push(src.last);
          continue;
        }
        if (src.intervalMs) src.nextAt = now + src.intervalMs;
        let reading;
        try {
          const raw = await src.read();
          reading = toReading(src, raw, null, now);
          vlog(`${src.name}: ${reading.temperature}°C ${reading.humidity ?? '–'}% ${reading.pressure} hPa`);
        } catch (e) {
          reading = toReading(src, null, e, now);
          if (!src.last || src.last.error !== reading.error) console.error(`[Env] ${src.name}: ${reading.error}`);
        }
        src.last = reading;
        if (!reading.error) {
          src.ring.push({ t: now, temp: reading.temperature, hum: reading.humidity, pres: reading.pressure });
        }
        readings.push(reading);
      }
      if (pluginBus) pluginBus.emit('env', { t: now, sources: readings });
    }

    function connect() {
      running = true;
      buildSources();
      if (sources.size === 0) log('No sources enabled — enable sensorA/sensorB/http or mock in the config');
      else
        log(
          `Sources: ${Array.from(sources.values())
            .map((s) => `${s.id}=${s.name}`)
            .join(', ')}`,
        );
      const interval = Math.max(2, parseInt(cfg().pollInterval, 10) || 10) * 1000;
      poll().catch(() => {});
      pollTimer = setInterval(() => poll().catch(() => {}), interval);
    }

    function disconnect() {
      running = false;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (bus) {
        try {
          bus.close();
        } catch (e) {}
        bus = null;
      }
      _currentInstance = null;
      log('Stopped');
    }

    function currentReadings() {
      return Array.from(sources.values())
        .map((s) => s.last)
        .filter(Boolean);
    }

    function getStatus() {
      return {
        enabled: !!cfg().enabled,
        running,
        i2cError,
        mock: !!cfg().mock,
        sources: currentReadings(),
      };
    }

    function getHistory() {
      const out = {};
      for (const s of sources.values()) {
        out[s.id] = { name: s.name, type: s.type, samples: s.ring.toArray() };
      }
      return { minutes: HISTORY_MINUTES, sources: out };
    }

    function getSseSnapshot() {
      const readings = currentReadings();
      return readings.length
        ? [{ type: 'plugin', event: 'env', source: 'env-sensors', data: { t: Date.now(), sources: readings } }]
        : [];
    }

    const instance = { connect, disconnect, getStatus, getHistory, getSseSnapshot, _poll: poll, _toReading: toReading };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
