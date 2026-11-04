/**
 * Hardware plugins (GPS / environment sensors / GPIO / brightness) exercised
 * with their mock backends — no serial port, I2C bus, or Pi header involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';
import gps from './gps.js';
import env from './env-sensors.js';
import gpio from './gpio.js';
import brightness from './brightness.js';

const services = () => {
  const bus = new EventEmitter();
  const state = { ptt: false, onAir: false };
  const listeners = [];
  return {
    pluginBus: bus,
    state,
    updateState: vi.fn((k, v) => {
      state[k] = v;
    }),
    onStateChange: (fn) => listeners.push(fn),
    removeStateChangeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
    fireState: (k, v) => listeners.forEach((fn) => fn(k, v)),
    // The headless lightning guard must not open a real Blitzortung socket in tests
    lightningWebSocket: class {
      send() {}
      close() {}
    },
  };
};

describe('gps plugin', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mock source publishes fixes with a grid and clock offset', () => {
    const svc = services();
    const seen = [];
    svc.pluginBus.on('gps', (f) => seen.push(f));
    const inst = gps.create({ gps: { enabled: true, source: 'mock' } }, svc);
    inst.connect();
    vi.advanceTimersByTime(3000);
    expect(seen.length).toBe(3);
    const f = seen[2];
    expect(f.fix).toBe(true);
    expect(f.grid6).toMatch(/^[A-R]{2}\d{2}[a-x]{2}$/);
    expect(f.speed).toBeGreaterThan(80);
    expect(Math.abs(f.timeOffsetMs)).toBeLessThan(1000);
    expect(inst.getStatus().connected).toBe(true);
    expect(inst.getSseSnapshot()[0].event).toBe('gps');
    inst.disconnect();
    expect(gps.create({ gps: {} }, svc).getStatus().running).toBe(false);
  });

  it('throttles publishes to publishInterval', () => {
    const svc = services();
    const seen = [];
    svc.pluginBus.on('gps', (f) => seen.push(f));
    const inst = gps.create({ gps: { enabled: true, source: 'mock', publishInterval: 5000 } }, svc);
    inst.connect();
    const fix = { fix: true, lat: 1, lon: 2, grid6: 'JJ00aa', time: new Date().toISOString() };
    inst._publish(fix);
    inst._publish(fix);
    expect(seen.length).toBe(1);
    vi.advanceTimersByTime(5000);
    inst._publish(fix);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    inst.disconnect();
  });
});

describe('env-sensors plugin', () => {
  it('mock sources produce readings, corrections and dew point, and fill history', async () => {
    const svc = services();
    const seen = [];
    svc.pluginBus.on('env', (d) => seen.push(d));
    const inst = env.create({ envSensors: { enabled: true, mock: true, pollInterval: 10 } }, svc);
    inst.connect();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.length).toBeGreaterThan(0);
    const d = seen[seen.length - 1];
    expect(d.sources.map((s) => s.id)).toEqual(['A', 'B']);
    const a = d.sources[0];
    expect(a.temperature).toBeGreaterThan(15);
    expect(a.humidity).toBeGreaterThan(20);
    expect(a.pressure).toBeGreaterThan(1000);
    expect(a.dewPoint).toBeLessThan(a.temperature);
    const hist = inst.getHistory();
    expect(hist.sources.A.samples.length).toBe(1);
    expect(hist.sources.A.samples[0]).toHaveProperty('temp');
    expect(inst.getSseSnapshot()[0].event).toBe('env');
    inst.disconnect();
  });

  it('applies dTemp/dPres corrections and reports errors per source', () => {
    const svc = services();
    const inst = env.create({ envSensors: { enabled: true } }, svc);
    const src = { id: 'A', name: 'X', type: 'BME280', corrections: { dTemp: -1.5, dPres: 2, dHum: 0 } };
    const r = inst._toReading(src, { temperature: 21.5, humidity: 50, pressure: 1000 }, null, 1);
    expect(r.temperature).toBe(20);
    expect(r.pressure).toBe(1002);
    expect(r.dewPoint).toBeCloseTo(9.3, 0);
    const e = inst._toReading(src, null, new Error('boom'), 1);
    expect(e.error).toBe('boom');
    expect(e.temperature).toBeNull();
    inst.disconnect();
  });

  it('without i2c-bus the I2C source reports a helpful error instead of crashing', async () => {
    const svc = services();
    const seen = [];
    svc.pluginBus.on('env', (d) => seen.push(d));
    const inst = env.create({ envSensors: { enabled: true, sensorA: { enabled: true, address: '0x76' } } }, svc);
    inst.connect();
    await new Promise((r) => setTimeout(r, 30));
    const a = seen[seen.length - 1].sources[0];
    expect(a.error).toMatch(/i2c-bus|i2c/i);
    inst.disconnect();
  });
});

describe('gpio plugin (mock backend)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const flush = async (ms) => {
    for (let t = 0; t < ms; t += 125) {
      vi.advanceTimersByTime(125);
      await Promise.resolve();
      await Promise.resolve();
    }
  };

  it('PTT input (active low) sets onAir; buttons emit events; outputs follow indicators', async () => {
    const svc = services();
    const buttons = [];
    svc.pluginBus.on('gpio-button', (b) => buttons.push(b.button));
    const inst = gpio.create({ gpio: { enabled: true, backend: 'mock', debounceMs: 50 } }, svc);
    inst.connect();
    await flush(250);
    const st = inst.getStatus();
    expect(st.backend).toBe('mock');
    expect(st.inputs.pttIn).toBe(false);
    expect(st.outputs.onAirOut).toBe(false);

    // Press PTT (logical press → raw low)
    expect(inst.setMockInput({ name: 'pttIn', level: 1 }).success).toBe(true);
    await flush(500);
    expect(svc.updateState).toHaveBeenCalledWith('onAir', true);
    expect(inst.getStatus().outputs.onAirOut).toBe(true);
    inst.setMockInput({ name: 'pttIn', level: 0 });
    await flush(500);
    expect(svc.state.onAir).toBe(false);

    // Rig PTT also lights ON-AIR
    svc.fireState('ptt', true);
    await flush(250);
    expect(inst.getStatus().outputs.onAirOut).toBe(true);
    svc.fireState('ptt', false);

    // Countdown button
    inst.setMockInput({ name: 'countdownResetIn', level: 1 });
    await flush(500);
    inst.setMockInput({ name: 'countdownResetIn', level: 0 });
    await flush(500);
    expect(buttons).toContain('countdown-restart');
    expect(inst.getStatus().outputs.countdownGreenOut).toBe(true); // optimistic running

    // Indicators from the browser
    svc.pluginBus.emit('indicators', { countdown: 'expired', alarm: true, satVisible: true, satLosInSec: 300 });
    await flush(250);
    let o = inst.getStatus().outputs;
    expect(o.countdownRedOut).toBe(true);
    expect(o.countdownGreenOut).toBe(false);
    expect(o.alarmOut).toBe(true);
    expect(o.satOut).toBe(true);

    // Alarm silence button
    inst.setMockInput({ name: 'alarmSilenceIn', level: 1 });
    await flush(500);
    expect(buttons).toContain('alarm-silence');
    expect(inst.getStatus().outputs.alarmOut).toBe(false);
    inst.setMockInput({ name: 'alarmSilenceIn', level: 0 });

    // Alarm cleared then re-raised → rings again
    svc.pluginBus.emit('indicators', { alarm: false });
    svc.pluginBus.emit('indicators', { alarm: true });
    await flush(500);
    expect(inst.getStatus().outputs.alarmOut).toBe(true);

    // Mock input validation
    expect(inst.setMockInput({ name: 'nope' }).error).toBeTruthy();
    inst.disconnect();
    expect(svc.state.onAir).toBe(false);
  });

  it('respects a custom pin map and disabled lines', async () => {
    const svc = services();
    const inst = gpio.create(
      { gpio: { enabled: true, backend: 'mock', pins: { pttIn: 'P40', onAirOut: -1, satOut: 12 } } },
      svc,
    );
    inst.connect();
    await flush(250);
    const st = inst.getStatus();
    expect(st.pins.inputs.pttIn).toBe(21);
    expect(st.pins.outputs.onAirOut).toBeUndefined();
    expect(st.pins.outputs.satOut).toBe(12);
    inst.disconnect();
  });

  it('lightningOut: unassigned by default, so lightning reports drive nothing', async () => {
    const svc = services();
    const inst = gpio.create({ gpio: { enabled: true, backend: 'mock' } }, svc);
    inst.connect();
    await flush(1000);
    svc.pluginBus.emit('indicators', { lightning: 'alarm', lightningRelay: true });
    await flush(1000);
    const st = inst.getStatus();
    expect(st.pins.outputs.lightningOut).toBeUndefined();
    expect(st.lightning.pin).toBeNull();
    expect(st.lightning.engaged).toBe(true); // decided, but no line to drive
    expect(st.mockLevels[25]).toBeUndefined();
    inst.disconnect();
  });

  it('lightningOut is engaged while any display wants it and released when none do', async () => {
    const svc = services();
    const inst = gpio.create({ gpio: { enabled: true, backend: 'mock', pins: { lightningOut: 25 } } }, svc);
    inst.connect();
    await flush(1000);
    expect(inst.getStatus().outputs.lightningOut).toBe(false);
    expect(inst.getStatus().mockLevels[25]).toBe(0);

    svc.pluginBus.emit('indicators', { displayId: 'shack', lightning: 'alarm', lightningRelay: true });
    await flush(1000);
    let st = inst.getStatus();
    expect(st.outputs.lightningOut).toBe(true);
    expect(st.mockLevels[25]).toBe(1);
    expect(st.lightning).toMatchObject({ pin: 25, relay: true, engaged: true, reason: 'requested', failSafe: false });

    // A display without the guard posts its satellite/countdown state: no effect on the relay
    svc.pluginBus.emit('indicators', { countdown: 'running' });
    await flush(1000);
    expect(inst.getStatus().outputs.lightningOut).toBe(true);
    expect(inst.getStatus().outputs.countdownGreenOut).toBe(true);
    // A second guard display says all clear: the first still wants protection
    svc.pluginBus.emit('indicators', { displayId: 'kitchen', lightning: 'clear', lightningRelay: false });
    await flush(1000);
    expect(inst.getStatus().outputs.lightningOut).toBe(true);
    expect(
      inst
        .getStatus()
        .lightning.reporters.map((r) => r.id)
        .sort(),
    ).toEqual(['display:kitchen', 'display:shack']);

    // The first display reaches all-clear too → released
    svc.pluginBus.emit('indicators', { displayId: 'shack', lightning: 'clear', lightningRelay: false });
    await flush(1000);
    expect(inst.getStatus().outputs.lightningOut).toBe(false);
    expect(inst.getStatus().mockLevels[25]).toBe(0);
    inst.disconnect();
  });

  it('lightningOut: a quiet display keeps its claim for its all-clear time; hold off releases sooner', async () => {
    const svc = services();
    const inst = gpio.create({ gpio: { enabled: true, backend: 'mock', pins: { lightningOut: 25 } } }, svc);
    inst.connect();
    await flush(1000);
    svc.pluginBus.emit('indicators', {
      displayId: 'shack',
      lightning: 'alarm',
      lightningRelay: true,
      lightningAllClearMin: 5,
      countdown: 'running',
    });
    await flush(1000);
    expect(inst.getStatus().outputs.lightningOut).toBe(true);
    vi.advanceTimersByTime(3 * 60000); // tab closed: 3 min of silence
    await flush(1000);
    let st = inst.getStatus();
    expect(st.outputs.countdownGreenOut).toBe(false); // ordinary indicators go dark
    expect(st.outputs.lightningOut).toBe(true); // the relay holds…
    expect(st.lightning.reason).toBe('hold');
    vi.advanceTimersByTime(2 * 60000 + 1000); // …until 5 min after the last engage report
    await flush(1000);
    expect(inst.getStatus().outputs.lightningOut).toBe(false);
    inst.disconnect();

    const svc2 = services();
    const inst2 = gpio.create(
      { gpio: { enabled: true, backend: 'mock', pins: { lightningOut: 25 }, lightningHoldWhenStale: false } },
      svc2,
    );
    inst2.connect();
    await flush(1000);
    svc2.pluginBus.emit('indicators', { lightning: 'alarm', lightningRelay: true, lightningAllClearMin: 30 });
    await flush(1000);
    expect(inst2.getStatus().outputs.lightningOut).toBe(true);
    vi.advanceTimersByTime(95000);
    await flush(1000);
    expect(inst2.getStatus().outputs.lightningOut).toBe(false);
    inst2.disconnect();
  });

  it('lightningOut: "hold connected" from a live display overrides other claims', async () => {
    const svc = services();
    const inst = gpio.create({ gpio: { enabled: true, backend: 'mock', pins: { lightningOut: 25 } } }, svc);
    inst.connect();
    await flush(1000);
    svc.pluginBus.emit('indicators', { displayId: 'a', lightning: 'alarm', lightningRelay: true });
    svc.pluginBus.emit('indicators', {
      displayId: 'b',
      lightning: 'alarm',
      lightningRelay: false,
      lightningOverride: 'off',
    });
    await flush(1000);
    expect(inst.getStatus().outputs.lightningOut).toBe(false);
    expect(inst.getStatus().lightning.reason).toBe('override-off');
    inst.disconnect();
  });

  it('headless guard engages the relay with no browser, via the test route', async () => {
    const svc = services();
    const inst = gpio.create(
      {
        gpio: {
          enabled: true,
          backend: 'mock',
          pins: { lightningOut: 25 },
          lightningHeadless: { enabled: true, lat: '45.0', lon: '7.0', allClearMin: 2 },
        },
      },
      svc,
    );
    inst.connect();
    await flush(1000);
    let st = inst.getStatus();
    expect(st.lightning.headless).toMatchObject({ running: true, watching: true, level: 'clear' });
    expect(inst.injectLightning({ distanceKm: 8, bearingDeg: 90 }).success).toBe(true);
    await flush(1000);
    st = inst.getStatus();
    expect(st.lightning.headless.level).toBe('alarm');
    expect(st.lightning.headless.nearest).toMatch(/^8\.0 km E$/);
    expect(st.outputs.lightningOut).toBe(true);
    expect(st.lightning.reporters.find((r) => r.id === 'bridge')).toMatchObject({ live: true, claim: true });
    // All-clear after 2 quiet minutes (re-evaluated every 15 s)
    vi.advanceTimersByTime(2 * 60000 + 16000);
    await flush(1000);
    st = inst.getStatus();
    expect(st.lightning.headless.level).toBe('clear');
    expect(st.outputs.lightningOut).toBe(false);
    inst.disconnect();

    const off = gpio.create({ gpio: { enabled: true, backend: 'mock' } }, services());
    off.connect();
    await flush(250);
    expect(off.injectLightning({ distanceKm: 5 }).error).toMatch(/not enabled/);
    off.disconnect();
  });

  it('headless guard follows the settings a display sends, saves them, starts once a location arrives', async () => {
    const svc = { ...services(), saveConfig: vi.fn() };
    const cfg = {
      gpio: { enabled: true, backend: 'mock', pins: { lightningOut: 25 }, lightningHeadless: { enabled: true } },
    };
    const inst = gpio.create(cfg, svc);
    inst.connect();
    await flush(1000);
    let st = inst.getStatus();
    expect(st.features).toContain('lightning-arbiter');
    expect(st.lightning.headless).toMatchObject({ running: true, watching: false });

    const guard = { lat: 45, lon: 7, warnKm: 40, alarmKm: 15, allClearMin: 5, hysteresisPct: 10, repeatCloser: false };
    // A display that does not drive the relay is ignored
    svc.pluginBus.emit('indicators', { lightningGuard: guard });
    expect(svc.saveConfig).not.toHaveBeenCalled();
    svc.pluginBus.emit('indicators', {
      displayId: 'shack',
      lightning: 'clear',
      lightningRelay: false,
      lightningGuard: guard,
    });
    await flush(500);
    st = inst.getStatus();
    expect(st.lightning.headless).toMatchObject({
      watching: true,
      warnKm: 40,
      alarmKm: 15,
      allClearMin: 5,
      hysteresisPct: 10,
      repeatCloser: false,
    });
    expect(cfg.gpio.lightningHeadless).toMatchObject({ enabled: true, lat: 45, lon: 7, alarmKm: 15 });
    expect(svc.saveConfig).toHaveBeenCalledTimes(1);

    // Same settings again → nothing saved
    svc.pluginBus.emit('indicators', {
      displayId: 'shack',
      lightning: 'clear',
      lightningRelay: false,
      lightningGuard: guard,
    });
    expect(svc.saveConfig).toHaveBeenCalledTimes(1);

    // The new alarm radius is what the headless guard uses: a 12 km strike is an alarm
    expect(inst.injectLightning({ distanceKm: 12, bearingDeg: 0 }).status.level).toBe('alarm');
    inst.disconnect();
  });

  it('lightningFailSafe energises the line while the antenna may stay connected', async () => {
    const svc = services();
    const inst = gpio.create(
      { gpio: { enabled: true, backend: 'mock', pins: { lightningOut: 'P22' }, lightningFailSafe: true } },
      svc,
    );
    inst.connect();
    await flush(1000);
    let st = inst.getStatus();
    expect(st.pins.outputs.lightningOut).toBe(25);
    expect(st.outputs.lightningOut).toBe(false); // logical: not protecting
    expect(st.mockLevels[25]).toBe(1); // physical: relay energised = antenna connected
    svc.pluginBus.emit('indicators', { lightning: 'alarm', lightningRelay: true });
    await flush(1000);
    st = inst.getStatus();
    expect(st.outputs.lightningOut).toBe(true);
    expect(st.mockLevels[25]).toBe(0); // released = antenna disconnected
    expect(st.mockLevels[21]).toBe(0); // other lines are not inverted
    inst.disconnect();
  });
});

describe('brightness plugin', () => {
  it('mock lux maps through the calibration and manual/auto apply', async () => {
    const svc = services();
    const seen = [];
    svc.pluginBus.on('brightness', (d) => seen.push(d));
    const config = {
      brightness: {
        enabled: true,
        source: 'mock',
        interval: 60,
        auto: true,
        calDimLux: 0,
        calDimPct: 10,
        calBrightLux: 500,
        calBrightPct: 100,
      },
    };
    const inst = brightness.create(config, svc);
    inst.connect();
    await new Promise((r) => setTimeout(r, 10));
    let st = inst.getStatus();
    expect(st.auto).toBe(true);
    expect(st.lux).toBeGreaterThanOrEqual(0);
    expect(st.brightness).toBeGreaterThanOrEqual(5);
    expect(st.brightness).toBeLessThanOrEqual(100);
    expect(seen.length).toBeGreaterThan(0);

    const r = await inst.apply({ brightness: 42 });
    expect(r.auto).toBe(false);
    expect(config.brightness.manual).toBe(42);
    expect(inst.getStatus().target).toBe(42);
    await inst.apply({ auto: true });
    expect(inst.getStatus().auto).toBe(true);
    await expect(inst.apply({ brightness: 150 })).rejects.toThrow(/0\.\.100/);
    expect(inst.getSseSnapshot()[0].event).toBe('brightness');
    inst.disconnect();
  });

  it('source none → manual brightness only', async () => {
    const svc = services();
    const inst = brightness.create({ brightness: { enabled: true, source: 'none', auto: false, manual: 70 } }, svc);
    inst.connect();
    await new Promise((r) => setTimeout(r, 10));
    expect(inst.getStatus().brightness).toBe(70);
    expect(inst.getStatus().lux).toBeNull();
    inst.disconnect();
  });
});
