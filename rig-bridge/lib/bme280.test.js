import { describe, it, expect } from 'vitest';
import {
  parseCalibration,
  parseRawData,
  compensate,
  compensateTemperature,
  compensatePressure,
  compensateHumidity,
  dewPointC,
  seaLevelPressure,
  parseI2cAddress,
  chipName,
} from './bme280.js';

// Example calibration values from the Bosch BMP280 datasheet (§3.12) — the
// T and P formulas are identical on the BME280.
const DATASHEET_CAL = {
  dig_T1: 27504,
  dig_T2: 26435,
  dig_T3: -1000,
  dig_P1: 36477,
  dig_P2: -10685,
  dig_P3: 3024,
  dig_P4: 2855,
  dig_P5: 140,
  dig_P6: -7,
  dig_P7: 15500,
  dig_P8: -14600,
  dig_P9: 6000,
};
const DATASHEET_RAW = { adc_T: 519888, adc_P: 415148, adc_H: null };

/** Build the 26-byte 0x88 block (and 7-byte 0xE1 block) from a cal object. */
function encodeCal(cal, hum) {
  const b = Buffer.alloc(26);
  b.writeUInt16LE(cal.dig_T1, 0);
  b.writeInt16LE(cal.dig_T2, 2);
  b.writeInt16LE(cal.dig_T3, 4);
  b.writeUInt16LE(cal.dig_P1, 6);
  ['dig_P2', 'dig_P3', 'dig_P4', 'dig_P5', 'dig_P6', 'dig_P7', 'dig_P8', 'dig_P9'].forEach((k, i) =>
    b.writeInt16LE(cal[k], 8 + i * 2),
  );
  let h = null;
  if (hum) {
    b[25] = hum.dig_H1;
    h = Buffer.alloc(7);
    h.writeInt16LE(hum.dig_H2, 0);
    h[2] = hum.dig_H3;
    const h4 = hum.dig_H4 & 0xfff;
    const h5 = hum.dig_H5 & 0xfff;
    h[3] = h4 >> 4;
    h[4] = (h4 & 0x0f) | ((h5 & 0x0f) << 4);
    h[5] = h5 >> 4;
    h.writeInt8(hum.dig_H6, 6);
  }
  return { b, h };
}

describe('BME280 compensation — datasheet example', () => {
  it('reproduces 25.08 °C and 1006.53 hPa', () => {
    const { temperature, t_fine } = compensateTemperature(DATASHEET_RAW.adc_T, DATASHEET_CAL);
    expect(temperature).toBeCloseTo(25.08, 2);
    const p = compensatePressure(DATASHEET_RAW.adc_P, DATASHEET_CAL, t_fine);
    expect(p).toBeCloseTo(100653.27, 0);
    const out = compensate(DATASHEET_RAW, DATASHEET_CAL);
    expect(out.temperature).toBeCloseTo(25.08, 2);
    expect(out.pressure).toBeCloseTo(1006.53, 1);
    expect(out.humidity).toBeNull();
  });

  it('round-trips the calibration registers', () => {
    const { b } = encodeCal(DATASHEET_CAL);
    expect(parseCalibration(b)).toEqual(DATASHEET_CAL);
  });

  it('parses humidity calibration including the split 12-bit H4/H5', () => {
    const hum = { dig_H1: 75, dig_H2: 362, dig_H3: 0, dig_H4: 328, dig_H5: 50, dig_H6: 30 };
    const { b, h } = encodeCal(DATASHEET_CAL, hum);
    const cal = parseCalibration(b, h);
    expect(cal.dig_H1).toBe(75);
    expect(cal.dig_H2).toBe(362);
    expect(cal.dig_H4).toBe(328);
    expect(cal.dig_H5).toBe(50);
    expect(cal.dig_H6).toBe(30);
    // negative 12-bit value sign-extends
    const neg = encodeCal(DATASHEET_CAL, { ...hum, dig_H4: -5, dig_H5: -100 });
    const cn = parseCalibration(neg.b, neg.h);
    expect(cn.dig_H4).toBe(-5);
    expect(cn.dig_H5).toBe(-100);
  });

  it('parses the 8-byte burst read (20-bit P/T, 16-bit H)', () => {
    // adc_P = 415148 = 0x65 5AC → bytes 0x65 0x5A 0xC0 ; adc_T = 519888 = 0x7EED0 → 0x7E 0xED 0x00
    const raw = parseRawData(Buffer.from([0x65, 0x5a, 0xc0, 0x7e, 0xed, 0x00, 0x12, 0x34]));
    expect(raw.adc_P).toBe(415148);
    expect(raw.adc_T).toBe(519888);
    expect(raw.adc_H).toBe(0x1234);
    expect(parseRawData(Buffer.from([0x65, 0x5a, 0xc0, 0x7e, 0xed, 0x00])).adc_H).toBeNull();
  });

  it('humidity is clamped to 0..100 and sane for typical register values', () => {
    const hum = { dig_H1: 75, dig_H2: 362, dig_H3: 0, dig_H4: 328, dig_H5: 50, dig_H6: 30 };
    const { b, h } = encodeCal(DATASHEET_CAL, hum);
    const cal = parseCalibration(b, h);
    const { t_fine } = compensateTemperature(DATASHEET_RAW.adc_T, cal);
    const mid = compensateHumidity(30000, cal, t_fine);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    expect(compensateHumidity(0, cal, t_fine)).toBe(0);
    expect(compensateHumidity(65535, cal, t_fine)).toBe(100);
    expect(compensateHumidity(40000, cal, t_fine)).toBeGreaterThan(mid);
    expect(compensateHumidity(null, cal, t_fine)).toBeNull();
    expect(compensateHumidity(30000, DATASHEET_CAL, t_fine)).toBeNull(); // BMP280 cal → no humidity
  });

  it('treats the reset value 0x80000 as a skipped measurement', () => {
    expect(compensate({ adc_T: 0x80000, adc_P: 415148, adc_H: null }, DATASHEET_CAL).temperature).toBeNull();
  });

  it('names the chips', () => {
    expect(chipName(0x60)).toBe('BME280');
    expect(chipName(0x58)).toBe('BMP280');
    expect(chipName(0x61)).toBeNull();
  });
});

describe('derived values', () => {
  it('Magnus dew point', () => {
    expect(dewPointC(20, 50)).toBeCloseTo(9.3, 1);
    expect(dewPointC(30, 100)).toBeCloseTo(30, 1);
    expect(dewPointC(20, 0)).toBeNull();
  });
  it('sea-level reduction', () => {
    expect(seaLevelPressure(1013.25, 0)).toBeCloseTo(1013.25, 2);
    // ~1630 m (Boulder) at 835 hPa reduces to roughly 1010–1020 hPa
    const qnh = seaLevelPressure(835, 1630, 15);
    expect(qnh).toBeGreaterThan(1005);
    expect(qnh).toBeLessThan(1025);
  });
  it('parses I2C addresses', () => {
    expect(parseI2cAddress('0x77')).toBe(0x77);
    expect(parseI2cAddress('0X76')).toBe(0x76);
    expect(parseI2cAddress('118')).toBe(118);
    expect(parseI2cAddress(0x29)).toBe(0x29);
    expect(parseI2cAddress('', 0x76)).toBe(0x76);
    expect(parseI2cAddress('zzz', 0x76)).toBe(0x76);
  });
});
