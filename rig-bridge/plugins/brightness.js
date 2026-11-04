'use strict';
/**
 * brightness.js — Light sensor / display brightness plugin.
 *
 * Reads ambient light from an LTR-329 (I2C 0x29, the sensor HamClock
 * supports), from any HTTP JSON source (ESPHome/Tasmota lux field), or from
 * a simulated day/night curve, maps it to 0–100 % through a two-point
 * calibration (HamClock "bright" / "dim"), and applies it:
 *   • hardware:  /sys/class/backlight/<dev>/brightness (official Pi touch
 *                display, most DSI/eDP panels) — when present and writable
 *   • power:     bl_power, `vcgencmd display_power`, or `xset dpms` for the
 *                display-schedule sleep/wake
 *   • browser:   the current brightness is published over SSE as
 *                { type:'plugin', event:'brightness', data:{ brightness, lux,
 *                  auto, hardware, power, source } } so OpenHamClock can dim
 *                with an overlay when there is no controllable backlight.
 *
 * API:
 *   GET  /api/brightness/status
 *   POST /api/brightness   { brightness?: 0..100, auto?: bool, power?: bool }
 *        (auth-protected by the core — mounted via registerAuthRoutes)
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { luxToBrightness, stepToward, scaleToHardware } = require('../lib/brightness-map');
const ltr = require('../lib/ltr329');
const { pickNumber, fetchJson } = require('../lib/http-json');
const { parseI2cAddress } = require('../lib/bme280');

let _currentInstance = null;

const descriptor = {
  id: 'brightness',
  name: 'Light Sensor / Brightness',
  category: 'integration',
  configKey: 'brightness',

  registerRoutes(app) {
    app.get('/api/brightness/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
  },

  /** Write routes need the core's requireAuth — the core calls this with it. */
  registerAuthRoutes(app, requireAuth) {
    app.post('/api/brightness', requireAuth, async (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Brightness plugin not running' });
      try {
        const r = await _currentInstance.apply(req.body || {});
        res.json({ success: true, ...r });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });
  },

  create(config, services = {}) {
    const { pluginBus } = services;
    const cfg = () => config.brightness || {};
    const log = (...a) => console.log('[Brightness]', ...a);
    const vlog = (...a) => cfg().verbose && console.log('[Brightness]', ...a);

    let running = false;
    let timer = null;
    let bus = null;
    let sensorReady = false;
    let lastError = null;
    let lux = null;
    let luxAt = 0;
    let brightness = null; // currently applied 0..100
    let target = null;
    let power = true;
    let backlight = null; // { dir, max, writable }
    let lastPublished = null;

    const cal = () => ({
      dimLux: parseFloat(cfg().calDimLux) || 5,
      dimPct: parseFloat(cfg().calDimPct) || 15,
      brightLux: parseFloat(cfg().calBrightLux) || 400,
      brightPct: Number.isFinite(parseFloat(cfg().calBrightPct)) ? parseFloat(cfg().calBrightPct) : 100,
    });

    // ── Backlight discovery ─────────────────────────────────────────────
    function findBacklight() {
      const explicit = cfg().backlightPath;
      const candidates = [];
      if (explicit) candidates.push(explicit);
      try {
        for (const d of fs.readdirSync('/sys/class/backlight')) candidates.push(path.join('/sys/class/backlight', d));
      } catch (e) {}
      for (const dir of candidates) {
        try {
          const max = parseInt(fs.readFileSync(path.join(dir, 'max_brightness'), 'utf8'), 10);
          if (!Number.isFinite(max) || max <= 0) continue;
          let writable = true;
          try {
            fs.accessSync(path.join(dir, 'brightness'), fs.constants.W_OK);
          } catch (e) {
            writable = false;
          }
          return { dir, max, writable };
        } catch (e) {}
      }
      return null;
    }

    function writeBacklight(pct) {
      if (!backlight || !backlight.writable) return false;
      try {
        fs.writeFileSync(path.join(backlight.dir, 'brightness'), String(scaleToHardware(pct, backlight.max)));
        return true;
      } catch (e) {
        lastError = `backlight write failed: ${e.message} (add a udev rule or run as root)`;
        backlight.writable = false;
        return false;
      }
    }

    const exec = (cmd, args, env) =>
      new Promise((resolve) =>
        execFile(cmd, args, { timeout: 5000, env: { ...process.env, ...env } }, (err) => resolve(!err)),
      );

    async function setPower(on) {
      power = !!on;
      const method = cfg().powerMethod || 'auto';
      let done = false;
      if ((method === 'auto' || method === 'backlight') && backlight) {
        try {
          fs.writeFileSync(path.join(backlight.dir, 'bl_power'), on ? '0' : '4');
          done = true;
        } catch (e) {}
      }
      if (!done && (method === 'auto' || method === 'vcgencmd')) {
        done = await exec('vcgencmd', ['display_power', on ? '1' : '0']);
      }
      if (!done && (method === 'auto' || method === 'xset')) {
        done = await exec('xset', ['dpms', 'force', on ? 'on' : 'off'], { DISPLAY: process.env.DISPLAY || ':0' });
      }
      if (!done && method !== 'none')
        vlog(`display power ${on ? 'on' : 'off'}: no working method (browser overlay only)`);
      publish(true);
      return done;
    }

    // ── Lux sources ─────────────────────────────────────────────────────
    async function readLtr329() {
      if (!bus) {
        let i2c;
        try {
          i2c = require('i2c-bus');
        } catch (e) {
          throw new Error('i2c-bus module not installed (cd rig-bridge && npm install i2c-bus)');
        }
        bus = await i2c.openPromisified(parseInt(cfg().i2cBus, 10) || 1);
      }
      const addr = parseI2cAddress(cfg().address, ltr.ADDRESS);
      if (!sensorReady) {
        const part = await bus.readByte(addr, ltr.REG.PART_ID);
        if ((part & 0xf0) !== (ltr.PART_ID_VALUE & 0xf0))
          throw new Error(`No LTR-329 at 0x${addr.toString(16)} (part id 0x${part.toString(16)})`);
        await bus.writeByte(addr, ltr.REG.ALS_MEAS_RATE, ltr.MEAS_100MS_500MS);
        await bus.writeByte(addr, ltr.REG.ALS_CONTR, ltr.CONTR_ACTIVE_GAIN1);
        await new Promise((r) => setTimeout(r, 120)); // first measurement after wake-up
        sensorReady = true;
        log(`LTR-329 found at 0x${addr.toString(16)}`);
      }
      const buf = Buffer.alloc(4);
      await bus.readI2cBlock(addr, ltr.REG.ALS_DATA_CH1_0, 4, buf);
      const { ch0, ch1 } = ltr.parseChannels(buf);
      return ltr.computeLux(ch0, ch1, 1, 100);
    }

    async function readHttp() {
      const h = cfg().http || {};
      if (!h.url) throw new Error('No HTTP URL configured');
      const json = await fetchJson(h.url, 5000);
      const v = pickNumber(json, h.luxPath || 'lux');
      if (v == null) throw new Error('lux field not found in JSON');
      return v;
    }

    function readMock() {
      // 2-minute "day": bright at noon, dark at midnight
      const phase = (Date.now() % 120000) / 120000;
      return Math.max(0, Math.round(500 * Math.max(0, Math.sin(phase * 2 * Math.PI))));
    }

    async function readLux() {
      const source = cfg().source || 'none';
      if (source === 'ltr329') return readLtr329();
      if (source === 'http') return readHttp();
      if (source === 'mock') return readMock();
      return null;
    }

    // ── Control loop ────────────────────────────────────────────────────
    function publish(force = false) {
      if (!pluginBus) return;
      const data = getStatus();
      const key = `${data.brightness}|${data.auto}|${data.power}|${data.hardware}|${Math.round(data.lux || 0)}`;
      if (!force && key === lastPublished) return;
      lastPublished = key;
      pluginBus.emit('brightness', data);
    }

    async function tick() {
      const c = cfg();
      try {
        const v = await readLux();
        if (v != null) {
          lux = v;
          luxAt = Date.now();
          lastError = null;
        }
      } catch (e) {
        if (lastError !== e.message) console.error('[Brightness]', e.message);
        lastError = e.message;
      }
      const minPct = Number.isFinite(parseFloat(c.min)) ? parseFloat(c.min) : 5;
      if (c.auto !== false && lux != null) {
        target = luxToBrightness(lux, cal(), minPct);
      } else {
        const m = parseFloat(c.manual);
        target = Number.isFinite(m) ? Math.max(0, Math.min(100, m)) : 100;
      }
      const next = stepToward(brightness, target, c.auto !== false ? 5 : 100);
      if (next !== brightness) {
        brightness = next;
        writeBacklight(brightness);
        vlog(`lux ${lux == null ? '–' : lux.toFixed(0)} → ${brightness}%`);
      }
      publish();
    }

    /** Apply a browser/API request: manual brightness, auto toggle, power. */
    async function apply({ brightness: b, auto, power: p }) {
      const c = config.brightness || (config.brightness = {});
      let changed = false;
      if (typeof auto === 'boolean') {
        c.auto = auto;
        changed = true;
      }
      if (b !== undefined) {
        const v = parseFloat(b);
        if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('brightness must be 0..100');
        c.manual = Math.round(v);
        if (auto === undefined) c.auto = false; // a manual set switches auto off, like a dimmer knob
        changed = true;
      }
      if (typeof p === 'boolean') await setPower(p);
      if (changed) {
        try {
          require('../core/config').saveConfig();
        } catch (e) {}
        await tick();
        publish(true);
      }
      return getStatus();
    }

    function connect() {
      running = true;
      backlight = findBacklight();
      if (backlight)
        log(`Backlight ${backlight.dir} (max ${backlight.max}${backlight.writable ? '' : ', NOT writable'})`);
      else log('No /sys/class/backlight device — brightness will be applied by the browser overlay only');
      const interval = Math.max(1, parseInt(cfg().interval, 10) || 5) * 1000;
      tick().catch(() => {});
      timer = setInterval(() => tick().catch(() => {}), interval);
    }

    function disconnect() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      if (bus) {
        try {
          bus.close();
        } catch (e) {}
        bus = null;
      }
      sensorReady = false;
      _currentInstance = null;
      log('Stopped');
    }

    function getStatus() {
      const c = cfg();
      return {
        enabled: !!c.enabled,
        running,
        source: c.source || 'none',
        auto: c.auto !== false,
        manual: Number.isFinite(parseFloat(c.manual)) ? parseFloat(c.manual) : 100,
        brightness,
        target,
        lux,
        luxAgeMs: luxAt ? Date.now() - luxAt : null,
        hardware: !!(backlight && backlight.writable),
        backlight: backlight ? backlight.dir : null,
        power,
        calibration: cal(),
        lastError,
      };
    }

    function getSseSnapshot() {
      return running ? [{ type: 'plugin', event: 'brightness', source: 'brightness', data: getStatus() }] : [];
    }

    const instance = { connect, disconnect, getStatus, apply, setPower, getSseSnapshot, _tick: tick };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
