import { describe, it, expect } from 'vitest';
import { luxToBrightness, stepToward, scaleToHardware, DEFAULT_CAL } from './brightness-map.js';
import { getPath, pickNumber, toCelsius, toHpa } from './http-json.js';
import { parseChannels, computeLux, statusOk } from './ltr329.js';

describe('luxToBrightness', () => {
  const cal = { dimLux: 10, dimPct: 20, brightLux: 110, brightPct: 100 };
  it('interpolates between the two calibration points', () => {
    expect(luxToBrightness(10, cal)).toBe(20);
    expect(luxToBrightness(110, cal)).toBe(100);
    expect(luxToBrightness(60, cal)).toBe(60);
    expect(luxToBrightness(35, cal)).toBe(40);
  });
  it('clamps outside the calibration range', () => {
    expect(luxToBrightness(0, cal)).toBe(20);
    expect(luxToBrightness(5000, cal)).toBe(100);
  });
  it('honours a minimum floor and rejects bad input', () => {
    expect(luxToBrightness(0, { ...cal, dimPct: 0 }, 5)).toBe(5);
    expect(luxToBrightness(-1, cal)).toBeNull();
    expect(luxToBrightness(NaN, cal)).toBeNull();
  });
  it('works with swapped points and identical lux', () => {
    expect(luxToBrightness(60, { dimLux: 110, dimPct: 20, brightLux: 10, brightPct: 100 })).toBe(60);
    expect(luxToBrightness(50, { dimLux: 50, dimPct: 30, brightLux: 50, brightPct: 90 })).toBe(90);
    expect(luxToBrightness(200)).toBe(luxToBrightness(200, DEFAULT_CAL));
  });
});

describe('stepToward / scaleToHardware', () => {
  it('limits the per-tick change', () => {
    expect(stepToward(10, 50, 5)).toBe(15);
    expect(stepToward(50, 10, 5)).toBe(45);
    expect(stepToward(48, 50, 5)).toBe(50);
    expect(stepToward(NaN, 50, 5)).toBe(50);
    expect(stepToward(20, null, 5)).toBe(20);
  });
  it('scales percent to the backlight range', () => {
    expect(scaleToHardware(100, 255)).toBe(255);
    expect(scaleToHardware(50, 255)).toBe(128);
    expect(scaleToHardware(0, 255)).toBe(0);
    expect(scaleToHardware(150, 255)).toBe(255);
    expect(scaleToHardware(50, 0)).toBe(0);
  });
});

describe('http-json picking', () => {
  const tasmota = {
    StatusSNS: { Time: '2026-10-14T10:00:00', BME280: { Temperature: 21.3, Humidity: '44.1', Pressure: 1009.8 } },
  };
  const esphome = { sensor: { outdoor: { state: '18.5 °C', value: 18.5 } }, list: [{ v: 7 }, { v: 8 }] };
  it('resolves dotted and indexed paths', () => {
    expect(getPath(tasmota, 'StatusSNS.BME280.Temperature')).toBe(21.3);
    expect(getPath(esphome, 'list[1].v')).toBe(8);
    expect(getPath(esphome, 'list.0.v')).toBe(7);
    expect(getPath(esphome, 'nope.deeper')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
    expect(getPath(esphome, '')).toBeUndefined();
  });
  it('pickNumber parses strings, objects with value/state, booleans', () => {
    expect(pickNumber(tasmota, 'StatusSNS.BME280.Humidity')).toBe(44.1);
    expect(pickNumber(esphome, 'sensor.outdoor')).toBe(18.5);
    expect(pickNumber({ s: { state: '18.5 °C' } }, 's')).toBe(18.5);
    expect(pickNumber({ b: true }, 'b')).toBe(1);
    expect(pickNumber(tasmota, 'StatusSNS.Time')).toBeNull();
    expect(pickNumber(tasmota, 'missing')).toBeNull();
  });
  it('unit conversions', () => {
    expect(toCelsius(212, 'F')).toBeCloseTo(100);
    expect(toCelsius(20, 'C')).toBe(20);
    expect(toCelsius(null, 'F')).toBeNull();
    expect(toHpa(101325, 'Pa')).toBeCloseTo(1013.25);
    expect(toHpa(29.92, 'inHg')).toBeCloseTo(1013.2, 0);
    expect(toHpa(101.3, 'kPa')).toBeCloseTo(1013);
    expect(toHpa(1000, 'hPa')).toBe(1000);
  });
});

describe('LTR-329 lux', () => {
  it('parses channel bytes (CH1 first)', () => {
    expect(parseChannels(Buffer.from([0x10, 0x00, 0x40, 0x01]))).toEqual({ ch1: 16, ch0: 320 });
  });
  it('applies the datasheet piecewise formula', () => {
    // ratio < 0.45
    expect(computeLux(1000, 100)).toBeCloseTo(1.7743 * 1000 + 1.1059 * 100, 3);
    // 0.45 <= ratio < 0.64
    expect(computeLux(1000, 1000)).toBeCloseTo(4.2785 * 1000 - 1.9548 * 1000, 3);
    // 0.64 <= ratio < 0.85
    expect(computeLux(1000, 2500)).toBeCloseTo(0.5926 * 1000 + 0.1185 * 2500, 3);
    // ratio >= 0.85 → 0
    expect(computeLux(100, 2000)).toBe(0);
    // gain and integration time scale the result down
    expect(computeLux(1000, 100, 8, 400)).toBeCloseTo((1.7743 * 1000 + 1.1059 * 100) / 8 / 4, 3);
    expect(computeLux(0, 0)).toBe(0);
    expect(computeLux(NaN, 0)).toBeNull();
  });
  it('status register decode', () => {
    expect(statusOk(0x04)).toBe(true);
    expect(statusOk(0x00)).toBe(false);
    expect(statusOk(0x84)).toBe(false);
  });
});
