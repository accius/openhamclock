'use strict';
/**
 * ltr329.js — Lite-On LTR-329ALS-01 ambient light sensor (I2C 0x29).
 * Register map and the lux formula from the datasheet appendix A; the I2C
 * reads live in plugins/brightness.js so this stays testable.
 */

const ADDRESS = 0x29;

const REG = {
  ALS_CONTR: 0x80, // bit0 active mode, bits 4:2 gain
  ALS_MEAS_RATE: 0x85, // bits 5:3 integration time, bits 2:0 measurement rate
  PART_ID: 0x86, // 0xA0 (part 0xA, revision 0)
  MANUFAC_ID: 0x87, // 0x05
  ALS_DATA_CH1_0: 0x88, // CH1 (IR) low byte — CH1 comes first!
  ALS_DATA_CH1_1: 0x89,
  ALS_DATA_CH0_0: 0x8a, // CH0 (visible + IR) low byte
  ALS_DATA_CH0_1: 0x8b,
  ALS_STATUS: 0x8c, // bit2 new data, bit7 invalid
};

const PART_ID_VALUE = 0xa0;
const MANUFAC_ID_VALUE = 0x05;

/** Gain code (ALS_CONTR bits 4:2) → multiplier. */
const GAIN_BY_CODE = { 0: 1, 1: 2, 2: 4, 3: 8, 6: 48, 7: 96 };
/** Integration-time code (ALS_MEAS_RATE bits 5:3) → ms. */
const INT_MS_BY_CODE = { 0: 100, 1: 50, 2: 200, 3: 400, 4: 150, 5: 250, 6: 300, 7: 350 };

/** Active mode, gain 1× (ALS_CONTR = 0b00000001). */
const CONTR_ACTIVE_GAIN1 = 0x01;
/** 100 ms integration, 500 ms repeat (ALS_MEAS_RATE = 0b00000011). */
const MEAS_100MS_500MS = 0x03;

/** Parse the 4 data bytes (0x88..0x8B) into channel counts. */
function parseChannels(buf) {
  const b = Buffer.from(buf);
  if (b.length < 4) throw new Error('need 4 data bytes');
  return { ch1: b[0] | (b[1] << 8), ch0: b[2] | (b[3] << 8) };
}

/**
 * Lux from channel counts — datasheet appendix A.
 * @param {number} ch0 visible + IR
 * @param {number} ch1 IR
 * @param {number} [gain=1]
 * @param {number} [intMs=100] integration time in ms
 */
function computeLux(ch0, ch1, gain = 1, intMs = 100) {
  if (!Number.isFinite(ch0) || !Number.isFinite(ch1)) return null;
  const sum = ch0 + ch1;
  if (sum <= 0) return 0;
  const ratio = ch1 / sum;
  const intFactor = intMs / 100;
  let lux;
  if (ratio < 0.45) lux = (1.7743 * ch0 + 1.1059 * ch1) / gain / intFactor;
  else if (ratio < 0.64) lux = (4.2785 * ch0 - 1.9548 * ch1) / gain / intFactor;
  else if (ratio < 0.85) lux = (0.5926 * ch0 + 0.1185 * ch1) / gain / intFactor;
  else lux = 0;
  return Math.max(0, lux);
}

/** Status register: data valid and fresh? */
function statusOk(status) {
  return (status & 0x80) === 0 && (status & 0x04) !== 0;
}

module.exports = {
  ADDRESS,
  REG,
  PART_ID_VALUE,
  MANUFAC_ID_VALUE,
  GAIN_BY_CODE,
  INT_MS_BY_CODE,
  CONTR_ACTIVE_GAIN1,
  MEAS_100MS_500MS,
  parseChannels,
  computeLux,
  statusOk,
};
