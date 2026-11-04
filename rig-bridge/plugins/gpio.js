'use strict';
/**
 * gpio.js — Raspberry Pi GPIO plugin: the hardware lines HamClock offers on
 * the 40-pin header, without any native Node module.
 *
 * Inputs (active low — switch to ground, pull-up enabled):
 *   pttIn             PTT / ON-AIR sense  → bridge state `onAir` (browser shows ON AIR)
 *   countdownResetIn  restarts the ID / countdown timer in the browser
 *   alarmSilenceIn    silences the alarm output (and tells the browser)
 * Outputs:
 *   onAirOut          rig PTT or pttIn active
 *   alarmOut          alarm ringing (from the browser's indicator state)
 *   countdownGreenOut / countdownRedOut   countdown running / expired
 *   satOut            1 Hz the minute before AOS, steady during the pass,
 *                     2 Hz for the last minute (browser posts /api/indicators)
 *   lightningOut      lightning antenna-protection relay — engaged while ANY
 *                     display's lightning guard (or the optional headless guard
 *                     in this bridge, `lightningHeadless`) asks for it; see
 *                     LightningRelayArbiter in lib/gpio-logic.js. A display
 *                     that goes quiet keeps its claim for its all-clear time
 *                     (lightningHoldWhenStale). Off unless a pin is assigned.
 *                     `lightningFailSafe` inverts the line so the relay is
 *                     energised to keep the antenna CONNECTED.
 *
 * Backends (config.gpio.backend):
 *   auto   — sysfs if /sys/class/gpio exists, else libgpiod CLI tools
 *   gpiod  — gpioget / gpioset / gpiomon via child_process (libgpiod v1 or v2)
 *   sysfs  — /sys/class/gpio (deprecated but still present on Raspberry Pi OS)
 *   mock   — in-memory lines; POST /api/gpio/mock/input toggles inputs
 *
 * Pin numbers are BCM GPIO numbers; "P37" style header references are also
 * accepted. Defaults match HamClock (see lib/gpio-logic.js DEFAULT_PINS).
 *
 * API:
 *   GET  /api/gpio/status
 *   POST /api/gpio/mock/input  { name: 'pttIn' | pin: 16, level: 0|1 }  (mock backend only)
 *   POST /api/gpio/lightning/test  { distanceKm, bearingDeg } | { lat, lon }
 *        synthetic strike for the headless lightning guard (token-protected)
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const logic = require('../lib/gpio-logic');
const { HeadlessLightningGuard } = require('../lib/lightning-headless');

let _currentInstance = null;

const INDICATORS_STALE_MS = 90000; // browser posts every ~15 s; 90 s without = gone
const TICK_MS = 125; // fast enough for the 2 Hz satellite pulse

// ─── Backends ────────────────────────────────────────────────────────────

function createMockBackend() {
  const levels = new Map(); // bcm → 0|1 (inputs idle high = pulled up)
  const outputs = new Map();
  return {
    name: 'mock',
    async init({ inputs, outputs: outs }) {
      inputs.forEach((bcm) => levels.set(bcm, 1));
      outs.forEach((bcm) => outputs.set(bcm, 0));
    },
    async readInputs() {
      return Object.fromEntries(levels);
    },
    onEdge() {
      return false;
    },
    async write(bcm, level) {
      outputs.set(bcm, level);
    },
    setInput(bcm, level) {
      if (!levels.has(bcm)) return false;
      levels.set(bcm, level ? 1 : 0);
      return true;
    },
    getOutputs() {
      return Object.fromEntries(outputs);
    },
    async close() {},
  };
}

function createSysfsBackend(log) {
  const ROOT = '/sys/class/gpio';
  let base = 0;
  const exported = new Set();

  function detectBase() {
    // Kernel ≥ 6.6 numbers the BCM controller from 512; older kernels from 0.
    try {
      for (const d of fs.readdirSync(ROOT)) {
        if (!d.startsWith('gpiochip')) continue;
        let label = '';
        try {
          label = fs.readFileSync(path.join(ROOT, d, 'label'), 'utf8').trim();
        } catch (e) {}
        if (/pinctrl-(bcm|rp1)|brcm|raspberrypi/i.test(label)) {
          base = parseInt(fs.readFileSync(path.join(ROOT, d, 'base'), 'utf8'), 10) || 0;
          return;
        }
      }
    } catch (e) {}
  }

  const lineDir = (bcm) => path.join(ROOT, `gpio${base + bcm}`);

  async function exportLine(bcm, direction) {
    const dir = lineDir(bcm);
    if (!fs.existsSync(dir)) {
      try {
        fs.writeFileSync(path.join(ROOT, 'export'), String(base + bcm));
      } catch (e) {
        if (e.code !== 'EBUSY') throw e;
      }
      // udev needs a moment to fix permissions on the new directory
      for (let i = 0; i < 20 && !fs.existsSync(path.join(dir, 'direction')); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    exported.add(bcm);
    fs.writeFileSync(path.join(dir, 'direction'), direction);
  }

  return {
    name: 'sysfs',
    async init({ inputs, outputs }) {
      detectBase();
      log(`sysfs GPIO base ${base}`);
      for (const bcm of inputs) await exportLine(bcm, 'in');
      for (const bcm of outputs) await exportLine(bcm, 'out');
    },
    async readInputs() {
      const out = {};
      for (const bcm of exported) {
        try {
          const v = fs.readFileSync(path.join(lineDir(bcm), 'value'), 'utf8').trim();
          if (v === '0' || v === '1') out[bcm] = parseInt(v, 10);
        } catch (e) {}
      }
      return out;
    },
    onEdge() {
      return false; // polled
    },
    async write(bcm, level) {
      fs.writeFileSync(path.join(lineDir(bcm), 'value'), level ? '1' : '0');
    },
    async close() {
      for (const bcm of exported) {
        try {
          fs.writeFileSync(path.join(ROOT, 'unexport'), String(base + bcm));
        } catch (e) {}
      }
      exported.clear();
    },
  };
}

function createGpiodBackend(chip, log) {
  let version = 2;
  let monitor = null; // gpiomon child
  let setter = null; // v2 interactive gpioset child
  const v1Setters = new Map(); // v1: bcm → gpioset --mode=signal child
  let edgeCb = null;
  let inputLines = [];
  let outputLines = [];
  const outputLevels = new Map();

  const run = (cmd, args) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr ? stderr.trim() : err.message));
        resolve(stdout);
      });
    });

  async function detectVersion() {
    const out = await run('gpioset', ['--version']).catch((e) => {
      throw new Error(`libgpiod tools not found (sudo apt install gpiod): ${e.message}`);
    });
    version = logic.parseGpiodVersion(out) || 2;
    log(`libgpiod v${version} CLI`);
  }

  const chipArgs = () => (version >= 2 ? ['--chip', chip] : [chip]);

  async function readInputs() {
    if (!inputLines.length) return {};
    const args =
      version >= 2
        ? ['--bias=pull-up', '--numeric', ...chipArgs(), ...inputLines.map(String)]
        : ['--bias=pull-up', ...chipArgs(), ...inputLines.map(String)];
    const out = await run('gpioget', args);
    const vals = logic.parseGpiogetOutput(out);
    const res = {};
    inputLines.forEach((bcm, i) => {
      if (vals[i] != null) res[bcm] = vals[i];
    });
    return res;
  }

  function startMonitor() {
    if (!inputLines.length || !edgeCb) return;
    const fmt = version >= 2 ? '%E %o' : '%e %o';
    const args = ['--bias=pull-up', `--format=${fmt}`, ...chipArgs(), ...inputLines.map(String)];
    monitor = spawn('gpiomon', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    monitor.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ev = logic.parseGpiomonLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (ev) edgeCb(ev);
      }
    });
    monitor.stderr.on('data', (d) => log(`gpiomon: ${d.toString().trim()}`));
    monitor.on('error', (e) => {
      log(`gpiomon unavailable (${e.message}) — polling with gpioget instead`);
      monitor = null;
    });
    monitor.on('exit', (code) => {
      monitor = null;
      if (code !== 0 && code !== null) log(`gpiomon exited (${code}) — falling back to polling`);
    });
  }

  function startSetterV2() {
    if (!outputLines.length) return;
    const args = ['--interactive', ...chipArgs(), ...outputLines.map((bcm) => `${bcm}=${outputLevels.get(bcm) || 0}`)];
    setter = spawn('gpioset', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    setter.stderr.on('data', (d) => log(`gpioset: ${d.toString().trim()}`));
    setter.on('error', (e) => {
      log(`gpioset failed: ${e.message}`);
      setter = null;
    });
    setter.on('exit', () => {
      setter = null;
    });
  }

  function setV1(bcm, level) {
    const old = v1Setters.get(bcm);
    if (old) {
      try {
        old.kill();
      } catch (e) {}
    }
    const child = spawn('gpioset', ['--mode=signal', chip, `${bcm}=${level}`], { stdio: 'ignore' });
    child.on('error', (e) => log(`gpioset failed: ${e.message}`));
    v1Setters.set(bcm, child);
  }

  return {
    name: 'gpiod',
    get version() {
      return version;
    },
    async init({ inputs, outputs }) {
      await detectVersion();
      inputLines = inputs.slice();
      outputLines = outputs.slice();
      outputs.forEach((bcm) => outputLevels.set(bcm, 0));
      if (version >= 2) startSetterV2();
      else outputs.forEach((bcm) => setV1(bcm, 0));
    },
    readInputs,
    onEdge(cb) {
      edgeCb = cb;
      startMonitor();
      return !!monitor;
    },
    monitorAlive() {
      return !!monitor;
    },
    async write(bcm, level) {
      outputLevels.set(bcm, level);
      if (version >= 2) {
        if (!setter) startSetterV2();
        if (setter && setter.stdin.writable) setter.stdin.write(`set ${bcm}=${level}\n`);
      } else {
        setV1(bcm, level);
      }
    },
    async close() {
      if (monitor) monitor.kill();
      monitor = null;
      if (setter) {
        try {
          setter.stdin.write('exit\n');
        } catch (e) {}
        setter.kill();
      }
      setter = null;
      for (const c of v1Setters.values()) {
        try {
          c.kill();
        } catch (e) {}
      }
      v1Setters.clear();
    },
  };
}

function pickBackend(kind, chip, log) {
  if (kind === 'mock') return createMockBackend();
  if (kind === 'sysfs') return createSysfsBackend(log);
  if (kind === 'gpiod') return createGpiodBackend(chip, log);
  // auto
  if (process.platform === 'linux' && fs.existsSync('/sys/class/gpio/export')) return createSysfsBackend(log);
  if (process.platform === 'linux') return createGpiodBackend(chip, log);
  log('Not Linux — using the mock backend');
  return createMockBackend();
}

// ─── Plugin ──────────────────────────────────────────────────────────────

const descriptor = {
  id: 'gpio',
  name: 'Raspberry Pi GPIO',
  category: 'integration',
  configKey: 'gpio',

  registerRoutes(app) {
    app.get('/api/gpio/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false, features: logic.GPIO_FEATURES });
      res.json(_currentInstance.getStatus());
    });
    app.post('/api/gpio/mock/input', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'GPIO plugin not running' });
      const r = _currentInstance.setMockInput(req.body || {});
      if (r.error) return res.status(400).json(r);
      res.json(r);
    });
  },

  registerAuthRoutes(app, requireAuth) {
    // Synthetic strike for the headless lightning guard: { distanceKm, bearingDeg } or { lat, lon }
    app.post('/api/gpio/lightning/test', requireAuth, (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'GPIO plugin not running' });
      const b = req.body || {};
      const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
      const r = _currentInstance.injectLightning({
        distanceKm: num(b.distanceKm),
        bearingDeg: num(b.bearingDeg),
        lat: num(b.lat),
        lon: num(b.lon),
      });
      if (r.error) return res.status(400).json(r);
      res.json(r);
    });
  },

  create(config, services = {}) {
    const { updateState, state, pluginBus, onStateChange, removeStateChangeListener, saveConfig } = services;
    const cfg = () => config.gpio || {};
    const log = (...a) => console.log('[GPIO]', ...a);
    const vlog = (...a) => cfg().verbose && console.log('[GPIO]', ...a);

    let running = false;
    let backend = null;
    let backendError = null;
    let pinMap = logic.resolvePinMap(cfg().pins);
    let tickTimer = null;
    let lastPollAt = 0;
    let edgeDriven = false;

    const rawLevels = {}; // bcm → 0|1 latest raw sample
    const debouncers = {}; // input name → InputDebouncer
    const inputActive = {}; // input name → bool (debounced)
    const outputLevels = {}; // output name → bool (logical)
    let indicators = logic.sanitizeIndicators(null);
    let indicatorsAt = 0;
    let arbiter = new logic.LightningRelayArbiter({
      staleMs: INDICATORS_STALE_MS,
      holdWhenStale: cfg().lightningHoldWhenStale !== false,
    });
    let lastDecision = { engaged: false, reason: 'clear', holdUntil: null, reporters: [] };
    let headless = null;
    let alarmSilenced = false;
    let rigPtt = !!(state && state.ptt);

    const bcmToInput = () => Object.fromEntries(Object.entries(pinMap.inputs).map(([n, b]) => [b, n]));

    function emitGpioEvent(extra = {}) {
      if (!pluginBus) return;
      pluginBus.emit('gpio', {
        t: Date.now(),
        backend: backend ? backend.name : null,
        inputs: { ...inputActive },
        outputs: { ...outputLevels },
        indicators,
        ...extra,
      });
    }

    // ── Input handling ─────────────────────────────────────────────────
    function handleInputChange(name, pressed) {
      inputActive[name] = pressed;
      vlog(`${name} ${pressed ? 'active' : 'released'}`);
      if (name === 'pttIn') {
        if (updateState) updateState('onAir', pressed);
      } else if (pressed && name === 'countdownResetIn') {
        indicators = { ...indicators, countdown: 'running' }; // optimistic until the browser confirms
        indicatorsAt = Date.now();
        if (pluginBus) pluginBus.emit('gpio-button', { button: 'countdown-restart' });
      } else if (pressed && name === 'alarmSilenceIn') {
        alarmSilenced = true;
        if (pluginBus) pluginBus.emit('gpio-button', { button: 'alarm-silence' });
      }
      emitGpioEvent({ button: pressed ? name : null });
    }

    function sampleInputs(now) {
      const map = bcmToInput();
      for (const [bcmStr, level] of Object.entries(rawLevels)) {
        const name = map[bcmStr];
        if (!name || level == null) continue;
        const edge = debouncers[name].sample(level, now);
        if (edge) handleInputChange(name, edge === 'press');
      }
    }

    // ── Output handling ────────────────────────────────────────────────
    async function applyOutputs(now) {
      const desired = logic.computeOutputs(
        {
          ptt: rigPtt,
          pttIn: !!inputActive.pttIn,
          indicators,
          indicatorsStale: now - indicatorsAt > INDICATORS_STALE_MS,
          lightningEngaged: (lastDecision = arbiter.decide(now)).engaged,
          alarmSilenced,
        },
        now,
      );
      const polarity = { outputActiveLow: !!cfg().outputActiveLow, lightningFailSafe: !!cfg().lightningFailSafe };
      for (const [name, bcm] of Object.entries(pinMap.outputs)) {
        const want = !!desired[name];
        if (outputLevels[name] === want) continue;
        const wasOn = outputLevels[name];
        outputLevels[name] = want;
        if (name === 'lightningOut' && wasOn !== undefined) {
          log(`Lightning relay ${want ? 'ENGAGED (antenna protect)' : 'released'}`);
          emitGpioEvent();
        }
        try {
          await backend.write(bcm, logic.physicalLevel(name, want, polarity));
        } catch (e) {
          if (!backendError) console.error(`[GPIO] write ${name} (BCM ${bcm}) failed: ${e.message}`);
          backendError = e.message;
        }
      }
    }

    async function tick() {
      if (!running || !backend) return;
      const now = Date.now();
      const pollMs = Math.max(50, parseInt(cfg().pollInterval, 10) || 250);
      const monitorAlive = edgeDriven && (!backend.monitorAlive || backend.monitorAlive());
      if (!monitorAlive && now - lastPollAt >= pollMs && Object.keys(pinMap.inputs).length) {
        lastPollAt = now;
        try {
          Object.assign(rawLevels, await backend.readInputs());
          backendError = null;
        } catch (e) {
          if (backendError !== e.message) console.error(`[GPIO] read inputs failed: ${e.message}`);
          backendError = e.message;
        }
      }
      sampleInputs(now);
      await applyOutputs(now);
    }

    // ── Lifecycle ──────────────────────────────────────────────────────
    const onRigState = (prop, value) => {
      if (prop === 'ptt') rigPtt = !!value;
    };
    const onIndicators = (body) => {
      const next = logic.sanitizeIndicators(body);
      if (!next.alarm) alarmSilenced = false;
      const now = Date.now();
      if (next.lightningRelay !== null && next.lightningGuard) applyReportedGuardSettings(next.lightningGuard);
      if (next.lightningRelay !== null) {
        arbiter.report(
          next.displayId ? `display:${next.displayId}` : 'display',
          {
            relay: next.lightningRelay,
            level: next.lightning,
            allClearMin: next.lightningAllClearMin,
            override: next.lightningOverride,
          },
          now,
        );
      }
      indicators = next;
      indicatorsAt = now;
    };

    /**
     * A display that drives the relay sends its guard settings and location;
     * the headless guard follows them (the most recent report wins) and they
     * are saved, so a restart without any browser keeps them. `enabled` stays
     * a bridge-side choice.
     */
    function applyReportedGuardSettings(reported) {
      const g = config.gpio || (config.gpio = {});
      const next = logic.applyGuardSettings(g.lightningHeadless, reported);
      if (!next) return;
      g.lightningHeadless = next;
      vlog(`Lightning guard settings from a display: ${JSON.stringify(reported)}`);
      if (headless) headless.setSettings(next);
      if (typeof saveConfig === 'function') {
        try {
          saveConfig();
        } catch (e) {}
      }
    }

    // ── Headless lightning guard (optional; no browser needed) ─────────
    function startHeadless() {
      if (!(cfg().lightningHeadless || {}).enabled) return;
      headless = new HeadlessLightningGuard({
        settings: cfg().lightningHeadless,
        log,
        WebSocketImpl: services.lightningWebSocket, // tests inject a fake; default: the ws package
        onStatus: (st) => {
          arbiter.report(
            'bridge',
            { relay: st.relay, level: st.level, allClearMin: st.settings.allClearMin },
            Date.now(),
          );
          emitGpioEvent();
        },
      });
      headless.start();
    }

    async function start() {
      arbiter = new logic.LightningRelayArbiter({
        staleMs: INDICATORS_STALE_MS,
        holdWhenStale: cfg().lightningHoldWhenStale !== false,
      });
      pinMap = logic.resolvePinMap(cfg().pins);
      if (pinMap.conflicts.length) log(`Pin conflicts ignored: ${pinMap.conflicts.join(', ')}`);
      const activeLow = cfg().activeLow !== false;
      const debounceMs = parseInt(cfg().debounceMs, 10) || 50;
      for (const name of Object.keys(pinMap.inputs)) {
        debouncers[name] = new logic.InputDebouncer({ activeLow, debounceMs });
        inputActive[name] = false;
      }
      backend = pickBackend(cfg().backend || 'auto', cfg().chip || 'gpiochip0', log);
      try {
        await backend.init({ inputs: Object.values(pinMap.inputs), outputs: Object.values(pinMap.outputs) });
        backendError = null;
        log(
          `Backend ${backend.name}; inputs ${JSON.stringify(pinMap.inputs)}; outputs ${JSON.stringify(pinMap.outputs)}`,
        );
      } catch (e) {
        backendError = e.message;
        console.error(`[GPIO] Backend init failed: ${e.message}`);
      }
      if (!running) return;
      edgeDriven = backend.onEdge((ev) => {
        rawLevels[ev.offset] = ev.rising ? 1 : 0;
      });
      // Seed raw levels so idle-high inputs don't register a phantom press
      try {
        Object.assign(rawLevels, await backend.readInputs());
      } catch (e) {}
      for (const [name, bcm] of Object.entries(pinMap.inputs)) {
        if (rawLevels[bcm] != null) {
          debouncers[name].active = debouncers[name]._logical(rawLevels[bcm]);
          inputActive[name] = debouncers[name].active;
          if (name === 'pttIn' && updateState) updateState('onAir', inputActive[name]);
        }
      }
      startHeadless();
      tickTimer = setInterval(() => tick().catch(() => {}), TICK_MS);
      emitGpioEvent();
    }

    function connect() {
      running = true;
      if (onStateChange) onStateChange(onRigState);
      if (pluginBus) pluginBus.on('indicators', onIndicators);
      start().catch((e) => console.error('[GPIO] start failed:', e.message));
    }

    function disconnect() {
      running = false;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      if (removeStateChangeListener) removeStateChangeListener(onRigState);
      if (pluginBus) pluginBus.off('indicators', onIndicators);
      if (headless) headless.stop();
      headless = null;
      if (updateState) updateState('onAir', false);
      if (backend) {
        const b = backend;
        backend = null;
        // Best effort: outputs off, release lines
        Promise.all(
          Object.values(pinMap.outputs).map((bcm) => b.write(bcm, cfg().outputActiveLow ? 1 : 0).catch(() => {})),
        )
          .then(() => b.close())
          .catch(() => {});
      }
      _currentInstance = null;
      log('Stopped');
    }

    function getStatus() {
      return {
        features: logic.GPIO_FEATURES,
        enabled: !!cfg().enabled,
        running,
        backend: backend ? backend.name : null,
        backendError,
        mock: !!backend && backend.name === 'mock',
        pins: pinMap,
        inputs: { ...inputActive },
        outputs: { ...outputLevels },
        indicators,
        indicatorsAgeMs: indicatorsAt ? Date.now() - indicatorsAt : null,
        alarmSilenced,
        rigPtt,
        lightning: {
          pin: pinMap.outputs.lightningOut ?? null,
          relay: !!outputLevels.lightningOut,
          engaged: lastDecision.engaged,
          reason: lastDecision.reason,
          holdUntil: lastDecision.holdUntil,
          reporters: lastDecision.reporters,
          failSafe: !!cfg().lightningFailSafe,
          holdWhenStale: cfg().lightningHoldWhenStale !== false,
          headless: headless ? headless.getStatus() : null,
        },
        // Mock backend only: raw line levels by BCM number (after inversion)
        ...(backend && backend.name === 'mock' && backend.getOutputs ? { mockLevels: backend.getOutputs() } : {}),
      };
    }

    /** Mock backend only — drive an input from a test or the setup UI. */
    function setMockInput({ name, pin, level }) {
      if (!backend || backend.name !== 'mock') return { error: 'Not in mock mode' };
      const bcm = name ? pinMap.inputs[name] : logic.parsePin(pin);
      if (bcm == null) return { error: 'Unknown input' };
      // level is the *logical* state: true/1 = pressed. Convert to the raw level.
      const pressed = level === true || level === 1 || level === '1' || level === 'true';
      const raw = cfg().activeLow !== false ? (pressed ? 0 : 1) : pressed ? 1 : 0;
      if (!backend.setInput(bcm, raw)) return { error: 'Pin is not an input' };
      return { success: true, bcm, raw };
    }

    function getSseSnapshot() {
      return backend
        ? [
            {
              type: 'plugin',
              event: 'gpio',
              source: 'gpio',
              data: {
                t: Date.now(),
                backend: backend.name,
                inputs: { ...inputActive },
                outputs: { ...outputLevels },
                indicators,
              },
            },
          ]
        : [];
    }

    /** Synthetic strike for the headless guard (POST /api/gpio/lightning/test). */
    function injectLightning({ distanceKm, bearingDeg, lat, lon } = {}) {
      if (!headless) return { error: 'Headless lightning guard is not enabled' };
      const s = headless.injectStrike({ distanceKm, bearingDeg, lat, lon });
      return s ? { success: true, strike: s, status: headless.getStatus() } : { error: 'No location configured' };
    }

    const instance = {
      connect,
      disconnect,
      getStatus,
      setMockInput,
      injectLightning,
      getSseSnapshot,
      _tick: tick,
      _arbiter: () => arbiter,
    };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
