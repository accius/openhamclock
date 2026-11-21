import { describe, expect, it } from 'vitest';
import { gScale, rateA, rateKp, rateSfi, rateSsn, rateXrayLetter, xrayFromFlux, parseXrayText } from './status.js';

describe('solar badge status scales', () => {
  it('rates SFI on the ham thresholds', () => {
    expect(rateSfi(69).label).toBe('Poor');
    expect(rateSfi(70).label).toBe('Fair');
    expect(rateSfi(90).label).toBe('Good');
    expect(rateSfi(120).label).toBe('Good');
    expect(rateSfi(121).label).toBe('Excellent');
    expect(rateSfi(121).color).toBe(rateSfi(200).color);
  });

  it('rates SSN, A, and Kp/K with a NOAA G-scale on storms', () => {
    expect(rateSsn(49).tone).toBe('poor');
    expect(rateSsn(100).label).toBe('Good');
    expect(rateSsn(150).label).toBe('Excellent');
    expect(rateA(7).label).toBe('Quiet');
    expect(rateA(15).label).toBe('Unsettled');
    expect(rateA(29).label).toBe('Active');
    expect(rateA(30).label).toBe('Storm');
    expect(rateKp(2.9).label).toBe('Quiet');
    expect(rateKp(4).label).toBe('Unsettled');
    expect(rateKp(5).label).toBe('Storm G1');
    expect(rateKp(6.2).label).toBe('Storm G2');
    expect(gScale(9)).toBe('G5');
    expect(gScale(4.9)).toBeNull();
  });

  it('maps X-ray flux and class letters', () => {
    expect(xrayFromFlux(2.4e-6).text).toBe('C2.4');
    expect(xrayFromFlux(1.4e-5).letter).toBe('M');
    expect(rateXrayLetter('B').label).toBe('Quiet');
    expect(rateXrayLetter('C').tone).toBe('unsettled');
    expect(rateXrayLetter('M').label).toBe('Minor');
    expect(rateXrayLetter('X').tone).toBe('storm');
    expect(parseXrayText('b7.3').text).toBe('B7.3');
    expect(parseXrayText('nope')).toBeNull();
  });
});
