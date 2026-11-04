// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { BeaconSampler, bandForSlot, resolveBands, noiseFloor, median } from './beacon-sampler.js';
import { IBP_BANDS, IBP_BEACONS, SLOT_MS, CYCLE_MS, slotAt, beaconFor } from './ibp-schedule.js';

// 2026-10-14 12:00:00 UTC is a 3-minute boundary (slot 0).
const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);

describe('beacon-sampler helpers', () => {
  it('median / noiseFloor', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    // Quietest 20 % of 10 values = the 2 lowest → median of [-120, -118]
    const s = [-100, -120, -99, -118, -101, -97, -96, -95, -94, -93];
    expect(noiseFloor(s)).toBe(-118); // n=2 → upper median of the quietest pair
    expect(noiseFloor([])).toBeNull();
  });

  it('resolveBands accepts labels, MHz, comma strings and falls back to all five', () => {
    expect(resolveBands(['10m', '20m']).map((b) => b.label)).toEqual(['20m', '10m']);
    expect(resolveBands('15m, 12m').map((b) => b.label)).toEqual(['15m', '12m']);
    expect(resolveBands([14.1, 28.2]).map((b) => b.label)).toEqual(['20m', '10m']);
    expect(resolveBands(['nope'])).toHaveLength(5);
    expect(resolveBands(undefined)).toHaveLength(5);
    // Already-resolved band objects must survive a second pass (the plugin
    // resolves once and the sampler constructor resolves again).
    const once = resolveBands(['20m', '10m']);
    expect(resolveBands(once).map((b) => b.label)).toEqual(['20m', '10m']);
    expect(new BeaconSampler({ bands: once }).bands.map((b) => b.label)).toEqual(['20m', '10m']);
  });

  it('bandForSlot rotates through the bands slot by slot and covers every pair in 5 cycles', () => {
    const seen = new Set();
    for (let i = 0; i < 5 * 18; i++) {
      const slotStart = T0 + i * SLOT_MS;
      const band = bandForSlot(slotStart, IBP_BANDS);
      const beacon = beaconFor(slotAt(slotStart), band);
      seen.add(`${beacon.callsign}|${band.label}`);
    }
    expect(seen.size).toBe(18 * 5);
    expect(bandForSlot(T0, IBP_BANDS)).not.toBe(bandForSlot(T0 + SLOT_MS, IBP_BANDS));
  });
});

describe('BeaconSampler', () => {
  const feed = (sampler, start, dbmAt, { from = 0, to = SLOT_MS, step = 50 } = {}) => {
    for (let rel = from; rel < to; rel += step) sampler.addSample(dbmAt(rel), start + rel);
  };

  it('records a measurement for the right beacon with level, noise and SNR', () => {
    const sampler = new BeaconSampler({ bands: ['20m'] });
    const t = sampler.targetFor(T0);
    expect(t.band.label).toBe('20m');
    expect(t.beacon.callsign).toBe(IBP_BEACONS[0].callsign); // slot 0 on 20 m = 4U1UN

    sampler.beginSlot(T0);
    // Noise −110 dBm, beacon carrier +25 dB during seconds 1.5–6 (callsign + 100 W dash).
    feed(sampler, T0, (rel) => (rel >= 1500 && rel < 6000 ? -85 : -110));
    const m = sampler.beginSlot(T0 + SLOT_MS);
    expect(m).toMatchObject({ beacon: '4U1UN', band: '20m', mhz: 14.1, t: T0 });
    expect(m.levelDbm).toBe(-85);
    expect(m.noiseDbm).toBe(-110);
    expect(m.snrDb).toBe(25);
    expect(m.n).toBeGreaterThan(100);
    expect(sampler.measurements).toHaveLength(1);
  });

  it('ignores second 0 (retune) and samples after 9 s', () => {
    const sampler = new BeaconSampler({ bands: ['20m'] });
    sampler.beginSlot(T0);
    // Huge spike in the first second (AGC not settled) and in the last second — must not count.
    feed(sampler, T0, (rel) => (rel < 1000 || rel >= 9000 ? -20 : -110));
    const m = sampler.finishSlot();
    expect(m.levelDbm).toBe(-110);
    expect(m.snrDb).toBe(0);
  });

  it('drops late / early samples that do not belong to the current slot', () => {
    const sampler = new BeaconSampler({ bands: ['20m'] });
    sampler.beginSlot(T0);
    sampler.addSample(-50, T0 - 10); // before slot
    sampler.addSample(-50, T0 + SLOT_MS + 10); // after slot
    expect(sampler.current.samples).toHaveLength(0);
    expect(sampler.finishSlot()).toBeNull(); // < 5 samples → no measurement
  });

  it('uses the quietest 20 % of the last cycle on that band as the noise floor', () => {
    const sampler = new BeaconSampler({ bands: ['20m'] });
    // Three quiet slots establish a −115 dBm floor on 20 m…
    for (let i = 0; i < 3; i++) {
      sampler.beginSlot(T0 + i * SLOT_MS);
      feed(sampler, T0 + i * SLOT_MS, () => -115);
    }
    // …then a slot where the beacon is on the whole time (median would be wrong without history).
    const t4 = T0 + 3 * SLOT_MS;
    sampler.beginSlot(t4);
    feed(sampler, t4, () => -90);
    const m = sampler.finishSlot();
    expect(m.noiseDbm).toBe(-115);
    expect(m.snrDb).toBe(25);
  });

  it('keeps per-band history bounded to one cycle and the ring buffer to ringMax', () => {
    const sampler = new BeaconSampler({ bands: ['20m'], ringMax: 3 });
    for (let i = 0; i < 25; i++) {
      const start = T0 + i * SLOT_MS;
      sampler.beginSlot(start);
      feed(sampler, start, () => -100, { step: 500 });
    }
    sampler.finishSlot();
    expect(sampler.measurements).toHaveLength(3);
    const hist = sampler.bandHistory.get('20m');
    expect(hist[0].t).toBeGreaterThanOrEqual(hist[hist.length - 1].t - CYCLE_MS);
  });

  it('query filters by time and band, oldest → newest', () => {
    const sampler = new BeaconSampler({ bands: ['20m', '10m'] });
    for (let i = 0; i < 6; i++) {
      const start = T0 + i * SLOT_MS;
      sampler.beginSlot(start);
      feed(sampler, start, () => -100, { step: 500 });
    }
    sampler.finishSlot();
    const all = sampler.query();
    expect(all).toHaveLength(6);
    expect(all[0].t).toBeLessThan(all[5].t);
    const tens = sampler.query({ band: '10m' });
    expect(tens.every((m) => m.band === '10m')).toBe(true);
    expect(tens).toHaveLength(3);
    expect(sampler.query({ sinceMs: T0 + 4 * SLOT_MS })).toHaveLength(2);
  });
});
