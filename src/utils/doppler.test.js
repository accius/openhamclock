import { describe, it, expect } from 'vitest';
import {
  C_KM_S,
  correctedDownlinkHz,
  correctedUplinkHz,
  dopplerShiftHz,
  clampDopplerStep,
  shouldRetune,
  isLinearTransponder,
  nominalPair,
  rigModeForTransmitter,
  transmitterKey,
  transmitterLabel,
  pickTransmitter,
  computeDopplerState,
  formatHz,
} from './doppler.js';

const FM_TX = {
  uuid: 'fm1',
  mode: 'FM',
  description: 'V/U FM repeater',
  uplinkLowHz: 145.85e6,
  uplinkHighHz: 145.85e6,
  downlinkLowHz: 436.795e6,
  downlinkHighHz: 436.795e6,
  invert: false,
};
const LINEAR_INV = {
  uuid: 'lin1',
  mode: 'Linear',
  description: 'Mode U/V inverting',
  uplinkLowHz: 435.61e6,
  uplinkHighHz: 435.67e6,
  downlinkLowHz: 145.935e6,
  downlinkHighHz: 145.995e6,
  invert: true,
};
const BEACON = { uuid: 'bcn', mode: 'CW', description: 'Beacon', downlinkLowHz: 145.86e6, downlinkHighHz: 145.86e6 };

describe('corrected frequencies', () => {
  it('raises the downlink when approaching (negative range rate)', () => {
    const f = correctedDownlinkHz(436.795e6, -7); // 7 km/s toward us
    expect(f).toBeGreaterThan(436.795e6);
    // v/c * f ≈ 10.2 kHz at 70 cm
    expect(f - 436.795e6).toBeCloseTo((7 / C_KM_S) * 436.795e6, 0);
  });
  it('lowers the uplink when approaching so it arrives on frequency', () => {
    const up = correctedUplinkHz(145.85e6, -7);
    expect(up).toBeLessThan(145.85e6);
    // round trip: what the satellite hears after its own Doppler is nominal
    expect(correctedDownlinkHz(up, -7)).toBeCloseTo(145.85e6, 3);
  });
  it('is identity at zero range rate and null for bad input', () => {
    expect(correctedDownlinkHz(1e6, 0)).toBe(1e6);
    expect(correctedUplinkHz(1e6, 0)).toBe(1e6);
    expect(correctedDownlinkHz(0, 1)).toBeNull();
    expect(correctedDownlinkHz('x', 1)).toBeNull();
    expect(dopplerShiftHz(145e6, 0)).toBe(0);
    expect(dopplerShiftHz(145e6, 3)).toBeLessThan(0);
  });
});

describe('retune threshold', () => {
  it('clamps the step', () => {
    expect(clampDopplerStep(undefined)).toBe(20);
    expect(clampDopplerStep(-5)).toBe(20);
    expect(clampDopplerStep(0.1)).toBe(1);
    expect(clampDopplerStep(5000)).toBe(1000);
    expect(clampDopplerStep(50)).toBe(50);
  });
  it('sends the first time and only above the step after that', () => {
    expect(shouldRetune(null, 145e6)).toBe(true);
    expect(shouldRetune(145e6, 145e6 + 19, 20)).toBe(false);
    expect(shouldRetune(145e6, 145e6 + 20, 20)).toBe(true);
    expect(shouldRetune(145e6, 145e6 - 25, 20)).toBe(true);
    expect(shouldRetune(145e6, NaN)).toBe(false);
  });
});

describe('transmitter pairing', () => {
  it('detects linear transponders', () => {
    expect(isLinearTransponder(LINEAR_INV)).toBe(true);
    expect(isLinearTransponder(FM_TX)).toBe(false);
    expect(isLinearTransponder(BEACON)).toBe(false);
    expect(isLinearTransponder(null)).toBe(false);
  });
  it('returns single frequencies for FM and beacons', () => {
    expect(nominalPair(FM_TX)).toEqual({ downlinkHz: 436.795e6, uplinkHz: 145.85e6 });
    expect(nominalPair(BEACON)).toEqual({ downlinkHz: 145.86e6, uplinkHz: null });
    expect(nominalPair(null)).toEqual({ downlinkHz: null, uplinkHz: null });
  });
  it('defaults a linear passband to its centre and inverts the uplink', () => {
    const p = nominalPair(LINEAR_INV);
    expect(p.downlinkHz).toBe(145.965e6);
    expect(p.uplinkHz).toBe(435.64e6); // centre maps to centre either way
    const low = nominalPair(LINEAR_INV, 145.935e6); // bottom of downlink
    expect(low.uplinkHz).toBe(435.67e6); // top of uplink (inverting)
    const nonInv = nominalPair({ ...LINEAR_INV, invert: false }, 145.935e6);
    expect(nonInv.uplinkHz).toBe(435.61e6);
  });
  it('clamps an out-of-band downlink request back to the centre', () => {
    expect(nominalPair(LINEAR_INV, 146.5e6).downlinkHz).toBe(145.965e6);
  });
});

describe('rig mode mapping', () => {
  it('maps SatNOGS modes to rig modes', () => {
    expect(rigModeForTransmitter({ mode: 'FM' })).toBe('FM');
    expect(rigModeForTransmitter({ mode: 'Linear' })).toBe('USB');
    expect(rigModeForTransmitter({ mode: 'USB' })).toBe('USB');
    expect(rigModeForTransmitter({ mode: 'LSB' })).toBe('LSB');
    expect(rigModeForTransmitter({ mode: 'CW' })).toBe('CW');
    expect(rigModeForTransmitter({ mode: 'AFSK 1200 baud' })).toBe('FM');
    expect(rigModeForTransmitter({ mode: 'BPSK 1200 baud' })).toBeNull();
    expect(rigModeForTransmitter({})).toBeNull();
  });
});

describe('transmitter selection', () => {
  it('keys, labels and remembers a pick', () => {
    expect(transmitterKey(FM_TX)).toBe('fm1');
    expect(transmitterKey({ mode: 'FM', downlinkLowHz: 1, uplinkLowHz: 2 })).toBe('FM|1|2');
    expect(transmitterLabel(FM_TX)).toBe('V/U FM repeater 436.795↓ 145.850↑');
    expect(transmitterLabel(BEACON)).toBe('Beacon 145.860↓');
    const list = [FM_TX, LINEAR_INV, BEACON];
    expect(pickTransmitter(list)).toBe(FM_TX);
    expect(pickTransmitter(list, 'lin1')).toBe(LINEAR_INV);
    expect(pickTransmitter(list, 'nope')).toBe(FM_TX);
    expect(pickTransmitter([], 'x')).toBeNull();
  });
});

describe('computeDopplerState', () => {
  it('bundles corrected frequencies, shifts and mode', () => {
    const s = computeDopplerState(FM_TX, -5);
    expect(s.downlinkNominalHz).toBe(436.795e6);
    expect(s.downlinkCorrectedHz).toBeGreaterThan(436.795e6);
    expect(s.downlinkShiftHz).toBeGreaterThan(7000);
    expect(s.uplinkCorrectedHz).toBeLessThan(145.85e6);
    expect(s.uplinkShiftHz).toBeLessThan(0);
    expect(s.mode).toBe('FM');
    expect(s.rangeRateKmS).toBe(-5);
  });
  it('leaves the uplink null for a beacon', () => {
    const s = computeDopplerState(BEACON, 2);
    expect(s.uplinkNominalHz).toBeNull();
    expect(s.uplinkCorrectedHz).toBeNull();
    expect(s.downlinkCorrectedHz).toBeLessThan(145.86e6);
  });
});

describe('formatHz', () => {
  it('formats as MHz.kHz.Hz', () => {
    expect(formatHz(145960000)).toBe('145.960.000');
    expect(formatHz(7074123.4)).toBe('007.074.123');
    expect(formatHz(0)).toBe('---.---.---');
  });
});
