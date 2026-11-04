'use strict';
/**
 * bme280.js — Bosch BME280 / BMP280 register layout and compensation math.
 *
 * Pure functions only (no I2C here) so the datasheet formulas can be unit
 * tested with the example calibration set Bosch publishes. The I2C driver in
 * plugins/env-sensors.js reads the raw registers and calls into this module.
 *
 * References: BME280 datasheet BST-BME280-DS002 §4.2.3 + Appendix A (8.1,
 * double-precision formulas); BMP280 datasheet BST-BMP280-DS001 §3.11.3 /
 * §3.12 (example calibration values and expected results).
 */

const REG = {
  CHIP_ID: 0xd0, // 0x58 = BMP280, 0x60 = BME280
  RESET: 0xe0,
  CALIB_00: 0x88, // 26 bytes: T1..T3, P1..P9, (0xA0 reserved), H1 at 0xA1
  CALIB_26: 0xe1, // 7 bytes: H2..H6 (BME280 only)
  CTRL_HUM: 0xf2,
  STATUS: 0xf3,
  CTRL_MEAS: 0xf4,
  CONFIG: 0xf5,
  DATA: 0xf7, // 8 bytes: press(3) temp(3) hum(2)
};

const CHIP_ID_BMP280 = 0x58;
const CHIP_ID_BME280 = 0x60;

/** Forced mode, 1× oversampling on T, P (and H via CTRL_HUM). */
const CTRL_HUM_1X = 0x01;
const CTRL_MEAS_FORCED_1X = 0x25; // osrs_t=001 osrs_p=001 mode=01
const CONFIG_FILTER_OFF = 0x00;

function chipName(id) {
  if (id === CHIP_ID_BME280) return 'BME280';
  if (id === CHIP_ID_BMP280) return 'BMP280';
  return null;
}

/**
 * Parse the calibration registers.
 * @param {Buffer|Uint8Array} c0 26 bytes read from 0x88
 * @param {Buffer|Uint8Array} [c1] 7 bytes read from 0xE1 (BME280 only)
 */
function parseCalibration(c0, c1) {
  const b = Buffer.from(c0);
  if (b.length < 26) throw new Error('calibration block 0x88 must be 26 bytes');
  const cal = {
    dig_T1: b.readUInt16LE(0),
    dig_T2: b.readInt16LE(2),
    dig_T3: b.readInt16LE(4),
    dig_P1: b.readUInt16LE(6),
    dig_P2: b.readInt16LE(8),
    dig_P3: b.readInt16LE(10),
    dig_P4: b.readInt16LE(12),
    dig_P5: b.readInt16LE(14),
    dig_P6: b.readInt16LE(16),
    dig_P7: b.readInt16LE(18),
    dig_P8: b.readInt16LE(20),
    dig_P9: b.readInt16LE(22),
  };
  if (c1) {
    const h = Buffer.from(c1);
    if (h.length < 7) throw new Error('calibration block 0xE1 must be 7 bytes');
    cal.dig_H1 = b[25];
    cal.dig_H2 = h.readInt16LE(0);
    cal.dig_H3 = h[2];
    // H4 and H5 are 12-bit values sharing byte 0xE5
    let h4 = (h[3] << 4) | (h[4] & 0x0f);
    let h5 = (h[5] << 4) | (h[4] >> 4);
    if (h4 & 0x800) h4 -= 0x1000;
    if (h5 & 0x800) h5 -= 0x1000;
    cal.dig_H4 = h4;
    cal.dig_H5 = h5;
    cal.dig_H6 = h.readInt8(6);
  }
  return cal;
}

/**
 * Parse the 8-byte burst read from 0xF7.
 * @returns {{ adc_P: number, adc_T: number, adc_H: number|null }}
 */
function parseRawData(buf) {
  const d = Buffer.from(buf);
  if (d.length < 6) throw new Error('data block must be at least 6 bytes');
  const adc_P = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4);
  const adc_T = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4);
  const adc_H = d.length >= 8 ? (d[6] << 8) | d[7] : null;
  return { adc_P, adc_T, adc_H };
}

/** Temperature in °C plus t_fine (needed by the P and H formulas). */
function compensateTemperature(adc_T, cal) {
  const var1 = (adc_T / 16384.0 - cal.dig_T1 / 1024.0) * cal.dig_T2;
  const d = adc_T / 131072.0 - cal.dig_T1 / 8192.0;
  const var2 = d * d * cal.dig_T3;
  const t_fine = var1 + var2;
  return { temperature: t_fine / 5120.0, t_fine };
}

/** Pressure in Pa (double-precision datasheet formula). */
function compensatePressure(adc_P, cal, t_fine) {
  let var1 = t_fine / 2.0 - 64000.0;
  let var2 = (var1 * var1 * cal.dig_P6) / 32768.0;
  var2 = var2 + var1 * cal.dig_P5 * 2.0;
  var2 = var2 / 4.0 + cal.dig_P4 * 65536.0;
  var1 = ((cal.dig_P3 * var1 * var1) / 524288.0 + cal.dig_P2 * var1) / 524288.0;
  var1 = (1.0 + var1 / 32768.0) * cal.dig_P1;
  if (var1 === 0) return 0; // avoid division by zero
  let p = 1048576.0 - adc_P;
  p = ((p - var2 / 4096.0) * 6250.0) / var1;
  var1 = (cal.dig_P9 * p * p) / 2147483648.0;
  var2 = (p * cal.dig_P8) / 32768.0;
  p = p + (var1 + var2 + cal.dig_P7) / 16.0;
  return p;
}

/** Relative humidity in %RH, clamped 0..100 (BME280 only). */
function compensateHumidity(adc_H, cal, t_fine) {
  if (adc_H == null || cal.dig_H1 === undefined) return null;
  let var_H = t_fine - 76800.0;
  var_H =
    (adc_H - (cal.dig_H4 * 64.0 + (cal.dig_H5 / 16384.0) * var_H)) *
    ((cal.dig_H2 / 65536.0) * (1.0 + (cal.dig_H6 / 67108864.0) * var_H * (1.0 + (cal.dig_H3 / 67108864.0) * var_H)));
  var_H = var_H * (1.0 - (cal.dig_H1 * var_H) / 524288.0);
  if (var_H > 100) var_H = 100;
  else if (var_H < 0) var_H = 0;
  return var_H;
}

/**
 * Full compensation of one raw sample.
 * @returns {{ temperature: number (°C), pressure: number (hPa), humidity: number|null (%RH) }}
 */
function compensate(raw, cal) {
  if (raw.adc_T === 0x80000 || raw.adc_P === 0x80000) {
    // 0x80000 is the reset value — sensor skipped the measurement
    return { temperature: null, pressure: null, humidity: null };
  }
  const { temperature, t_fine } = compensateTemperature(raw.adc_T, cal);
  const pressurePa = compensatePressure(raw.adc_P, cal, t_fine);
  const humidity = raw.adc_H === 0x8000 ? null : compensateHumidity(raw.adc_H, cal, t_fine);
  return { temperature, pressure: pressurePa / 100, humidity };
}

/** Magnus dew point (°C) from temperature (°C) and relative humidity (%). */
function dewPointC(tC, rh) {
  if (!Number.isFinite(tC) || !Number.isFinite(rh) || rh <= 0) return null;
  const a = 17.62;
  const b = 243.12;
  const gamma = Math.log(Math.min(rh, 100) / 100) + (a * tC) / (b + tC);
  return (b * gamma) / (a - gamma);
}

/**
 * Reduce station pressure to sea level (hPa) — the barometric formula with
 * a standard lapse rate, same approach HamClock uses for its QNH display.
 */
function seaLevelPressure(stationHpa, altitudeM, tC = 15) {
  if (!Number.isFinite(stationHpa) || !Number.isFinite(altitudeM)) return null;
  const h = altitudeM;
  const T = tC + 273.15;
  return stationHpa * Math.pow(1 - (0.0065 * h) / (T + 0.0065 * h), -5.257);
}

/** Parse an I2C address given as '0x76', '76' (hex when 0x) or 118. */
function parseI2cAddress(v, fallback = 0x76) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  const s = String(v || '').trim();
  if (!s) return fallback;
  const n = /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10);
  return Number.isFinite(n) && n > 0 && n < 128 ? n : fallback;
}

module.exports = {
  REG,
  CHIP_ID_BMP280,
  CHIP_ID_BME280,
  CTRL_HUM_1X,
  CTRL_MEAS_FORCED_1X,
  CONFIG_FILTER_OFF,
  chipName,
  parseCalibration,
  parseRawData,
  compensateTemperature,
  compensatePressure,
  compensateHumidity,
  compensate,
  dewPointC,
  seaLevelPressure,
  parseI2cAddress,
};
