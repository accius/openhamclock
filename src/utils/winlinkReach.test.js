import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RANGE_KM,
  DEFAULT_THRESHOLDS,
  MAX_PREDICTIONS_PER_REFRESH,
  PACKET_RANGE_KM,
  PACTOR4_FLOOR_DB,
  STATUS_COLORS,
  WINLINK_MODE_SNR,
  aggregateGateways,
  bestChannel,
  buildPredictionParams,
  buildReachSnapshot,
  cacheKey,
  cachePut,
  classifyStatus,
  describeHours,
  dialFrequencyHz,
  freqHzToBand,
  hourKeyFor,
  isHfChannel,
  isOnAirAt,
  isVhfChannel,
  losHint,
  modeSnrInfo,
  nearestServerBand,
  normalizeThresholds,
  parseOperatingHours,
  passesReachFilter,
  patConnectUrl,
  rankGateways,
  reachColorKey,
  reachMarkerStyle,
  restFallbackMode,
  restResultForJob,
  rigModeForChannel,
  runBatched,
  scoreChannels,
  selectCandidates,
  summarizeGateway,
  winlinkRequiredSNR,
} from './winlinkReach.js';
import { P533_REF_SNR_DB } from './propagationAdjust.js';
import { WINLINK_MODE_LABELS } from './winlinkModes.js';

// Mode codes (winlinkModes.js): 0 Packet 1200, 13 Pactor 1,2,3, 16 Pactor 3,
// 17 Pactor 1,2,3,4, 22 WINMOR, 30 Robust Packet, 41 ARDOP 500, 42 ARDOP 1000,
// 43 ARDOP 2000, 50 VARA, 51 VARA FM, 53 VARA 500, 54 VARA 2750.
const DE = { lat: 39.75, lon: -104.99 }; // Denver, DM79

const row = (over = {}) => ({
  callsign: 'W1AW-10',
  gridsquare: 'FN31',
  frequency: 7101200,
  mode: 50,
  serviceCode: 'PUBLIC',
  hours: '00-23',
  ...over,
});

const mask = (text) => {
  const m = parseOperatingHours(text);
  return m ? m.map((on, h) => (on ? h : null)).filter((h) => h != null) : null;
};

describe('classifyStatus + thresholds', () => {
  it('maps reliability to Good / Marginal / Closed with the default cut-offs', () => {
    expect(classifyStatus(80)).toBe('good');
    expect(classifyStatus(50)).toBe('good');
    expect(classifyStatus(49)).toBe('marginal');
    expect(classifyStatus(20)).toBe('marginal');
    expect(classifyStatus(19)).toBe('closed');
  });

  it('lets a near-miss SNR margin rescue a low-reliability path to Marginal', () => {
    expect(classifyStatus(5, -6)).toBe('marginal');
    expect(classifyStatus(5, -6.1)).toBe('closed');
    expect(classifyStatus(5, null)).toBe('closed');
  });

  it('is unknown without a prediction', () => {
    expect(classifyStatus(null)).toBe('unknown');
    expect(classifyStatus(NaN)).toBe('unknown');
  });

  it('honours operator cut-offs', () => {
    const strict = { goodReliability: 80, marginalReliability: 40, marginalSnrMargin: 0 };
    expect(classifyStatus(70, 5, strict)).toBe('marginal');
    expect(classifyStatus(30, -1, strict)).toBe('closed');
    expect(classifyStatus(30, 0, strict)).toBe('marginal');
    expect(classifyStatus(85, null, strict)).toBe('good');
  });

  it('normalizes thresholds without cross-clamping mid-edit values', () => {
    expect(normalizeThresholds({})).toEqual(DEFAULT_THRESHOLDS);
    expect(normalizeThresholds({ goodReliability: '', marginalReliability: 'x' })).toEqual(DEFAULT_THRESHOLDS);
    expect(normalizeThresholds({ goodReliability: 500, marginalSnrMargin: -99 })).toMatchObject({
      goodReliability: 99,
      marginalSnrMargin: -30,
    });
    // typing "5" on the way to "50" must not rewrite marginal
    expect(normalizeThresholds({ goodReliability: 5, marginalReliability: 20 })).toMatchObject({
      goodReliability: 5,
      marginalReliability: 20,
    });
    expect(DEFAULT_THRESHOLDS).toEqual({ goodReliability: 50, marginalReliability: 20, marginalSnrMargin: -6 });
  });
});

describe('mode SNR table', () => {
  it('has one row per HF-capable mode code with a source', () => {
    for (const code of [12, 13, 14, 15, 16, 17, 18, 19, 22, 30, 41, 42, 43, 50, 53, 54]) {
      const r = WINLINK_MODE_SNR[code];
      expect(r, `code ${code}`).toBeTruthy();
      expect(Number.isFinite(r.floorDb)).toBe(true);
      expect(r.source.length).toBeGreaterThan(5);
      expect(WINLINK_MODE_LABELS[code]).toBeTruthy();
    }
  });

  it('uses measured floors for the modes the Winlink IONOS comparison tested', () => {
    for (const code of [12, 13, 14, 15, 16, 22, 41, 42, 43, 50, 53]) {
      expect(modeSnrInfo(code), `code ${code}`).toMatchObject({ floorDb: -5, basis: 'measured', estimated: false });
    }
    expect(modeSnrInfo(50).source).toMatch(/IONOS/);
    expect(modeSnrInfo(41).source).toMatch(/DCC 2015/);
  });

  it('keeps untested modes flagged as estimates', () => {
    for (const code of [54, 0]) expect(modeSnrInfo(code)).toMatchObject({ basis: 'estimate', estimated: true });
  });

  it('uses the documented Robust Packet figure (Wavecom RPR sheet, +7 dB in 3 kHz)', () => {
    expect(modeSnrInfo(30)).toMatchObject({ floorDb: 7, basis: 'vendor', estimated: false });
    expect(modeSnrInfo(30).source).toMatch(/Wavecom/);
  });

  it('applies the SCS PACTOR-4 floor only when the operator has a P4 modem', () => {
    expect(PACTOR4_FLOOR_DB).toBe(-19);
    for (const code of [17, 18, 19]) {
      expect(winlinkRequiredSNR(code)).toBe(-5); // scored as PACTOR 3
      expect(winlinkRequiredSNR(code, { pactor4: true })).toBe(-19);
      expect(modeSnrInfo(code, { pactor4: true })).toMatchObject({ basis: 'vendor', estimated: false });
    }
    // P3-only and P2 gateways are unaffected by the setting
    expect(winlinkRequiredSNR(16, { pactor4: true })).toBe(-5);
    expect(winlinkRequiredSNR(50, { pactor4: true })).toBe(-5);
  });

  it('scores unknown codes like SSB voice', () => {
    expect(winlinkRequiredSNR(999)).toBe(P533_REF_SNR_DB);
    expect(modeSnrInfo(1200).estimated).toBe(true);
  });

  it('maps a required SNR onto the nearest server mode for the REST fallback', () => {
    expect(restFallbackMode(-5)).toBe('OLIVIA'); // needs 20 dB over SSB
    expect(restFallbackMode(5)).toMatch(/^(CW|PSK31)$/); // 10 dB
    expect(restFallbackMode(15)).toBe('SSB');
    expect(restFallbackMode(undefined)).toBe('SSB');
  });
});

describe('describeHours', () => {
  it('reads "N/7" as N hours a day: 24/7 is all day, anything else says how many hours but not which', () => {
    expect(describeHours('24/7')).toEqual({ kind: 'all', hoursPerDay: 24 });
    expect(describeHours('12/7')).toEqual({ kind: 'unknown', hoursPerDay: 12, text: '12/7' });
    expect(describeHours('23/7')).toMatchObject({ kind: 'unknown', hoursPerDay: 23 });
    expect(describeHours('1/7')).toMatchObject({ kind: 'unknown', hoursPerDay: 1 });
  });

  it('separates schedules, all-day, free text and nothing', () => {
    expect(describeHours('00-23')).toEqual({ kind: 'all', hoursPerDay: 24 });
    expect(describeHours('13-19')).toEqual({ kind: 'partial', hoursPerDay: 7 });
    expect(describeHours('Other')).toEqual({ kind: 'unknown', text: 'Other' });
    expect(describeHours('')).toEqual({ kind: 'none' });
    expect(describeHours(null)).toEqual({ kind: 'none' });
  });

  it('never makes an unknown schedule Off the air', () => {
    expect(isOnAirAt('12/7', 3)).toBe(true);
    expect(isOnAirAt('Other', 3)).toBe(true);
  });
});

describe('parseOperatingHours / isOnAirAt', () => {
  it('reads the 24-hour default and full-day spellings', () => {
    expect(mask('00-23')).toHaveLength(24);
    expect(mask('0-24')).toHaveLength(24);
    expect(mask('24/7')).toHaveLength(24);
    expect(mask('23-22')).toHaveLength(24); // wraps all the way round
  });

  it('handles inclusive whole-hour ranges and UTC wrap-around', () => {
    expect(mask('13-19')).toEqual([13, 14, 15, 16, 17, 18, 19]);
    expect(mask('6-19')).toHaveLength(14);
    expect(mask('22-02')).toEqual([0, 1, 2, 22, 23]);
    expect(mask('10-00')).toEqual([0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(mask('06-04')).toHaveLength(23); // dark only 05z
    expect(mask('13-13')).toEqual([13]);
  });

  it('handles lists and minute-precision ranges (end exclusive)', () => {
    expect(mask('00-02,13-23')).toEqual([0, 1, 2, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(mask('22-23,00-04')).toEqual([0, 1, 2, 3, 4, 22, 23]);
    expect(mask('08:00-22:00')).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    expect(mask('0800/2000')).toHaveLength(12);
    expect(mask('22:30-01:15')).toEqual([0, 1, 22, 23]);
  });

  it('returns null for free text so the gateway is treated as always on', () => {
    for (const s of ['Other', '1/7', '12/7', '', null, undefined, '25-03']) expect(mask(s)).toBe(null);
    expect(isOnAirAt('Other', 3)).toBe(true);
    expect(isOnAirAt(null, 3)).toBe(true);
  });

  it('answers on-air at a UTC hour, across midnight', () => {
    expect(isOnAirAt('22-02', 23)).toBe(true);
    expect(isOnAirAt('22-02', 0)).toBe(true);
    expect(isOnAirAt('22-02', 2)).toBe(true);
    expect(isOnAirAt('22-02', 3)).toBe(false);
    expect(isOnAirAt('22-02', 21)).toBe(false);
    expect(isOnAirAt('13-19', null)).toBe(true); // no hour → no judgement
  });
});

describe('channel classification and bands', () => {
  it('splits HF (engine) from VHF/UHF (distance only) and drops typo frequencies', () => {
    expect(isHfChannel({ frequency: 7101200, mode: 50 })).toBe(true);
    expect(isHfChannel({ frequency: 1842800, mode: 41 })).toBe(true); // 160 m
    expect(isHfChannel({ frequency: 10146, mode: 18 })).toBe(false); // live-list typo
    expect(isHfChannel({ frequency: 145050000, mode: 0 })).toBe(false);
    expect(isVhfChannel({ frequency: 145050000, mode: 0 })).toBe(true);
  });

  it('labels amateur bands and maps 60 m / MARS to the nearest server band, flagged approximate', () => {
    expect(freqHzToBand(7101200)).toBe('40m');
    expect(freqHzToBand(4500000)).toBe(null);
    expect(nearestServerBand(7101200)).toEqual({ band: '40m', approx: false });
    expect(nearestServerBand(5356000)).toEqual({ band: '40m', approx: true }); // 60 m: log-nearer 7.15 than 3.75
    expect(nearestServerBand(4500000)).toEqual({ band: '80m', approx: true }); // MARS
    expect(nearestServerBand(27000000)).toEqual({ band: '10m', approx: true });
    expect(nearestServerBand(145050000)).toBe(null);
  });
});

describe('dial frequency, rig mode and Pat URLs (per Pat app/freq.go + app/rmslist.go)', () => {
  it('subtracts 1500 Hz for Pactor / ARDOP / VARA HF only', () => {
    expect(dialFrequencyHz({ frequency: 7101200, mode: 50 })).toBe(7099700);
    expect(dialFrequencyHz({ frequency: 3585000, mode: 16 })).toBe(3583500);
    expect(dialFrequencyHz({ frequency: 14108500, mode: 43 })).toBe(14107000);
  });

  it('leaves FM and packet (AX.25, Robust Packet, HF packet) at the published frequency', () => {
    expect(dialFrequencyHz({ frequency: 145050000, mode: 0 })).toBe(145050000);
    expect(dialFrequencyHz({ frequency: 145070000, mode: 51 })).toBe(145070000);
    expect(dialFrequencyHz({ frequency: 10145000, mode: 30 })).toBe(10145000);
    expect(dialFrequencyHz({ frequency: 7101200, mode: 999 })).toBe(7101200);
    expect(dialFrequencyHz({ frequency: NaN })).toBe(null);
  });

  it('asks the rig for upper-sideband data on every HF band (even 40 m)', () => {
    expect(rigModeForChannel({ frequency: 7101200, mode: 43 })).toBe('DATA-USB');
    expect(rigModeForChannel({ frequency: 145050000, mode: 0 })).toBe('FM');
  });

  it('builds Pat URLs: shortest kHz, ARDOP bw=<w>MAX, VARA HF bw (2300 default), sorted query', () => {
    expect(patConnectUrl('w1aw-10', { frequency: 7101200, mode: 43 })).toBe('ardop:///W1AW-10?bw=2000MAX&freq=7099.7');
    expect(patConnectUrl('W1AW-10', { frequency: 7101200, mode: 41 })).toBe('ardop:///W1AW-10?bw=500MAX&freq=7099.7');
    expect(patConnectUrl('W1AW-10', { frequency: 14108500, mode: 50 })).toBe('varahf:///W1AW-10?bw=2300&freq=14107');
    expect(patConnectUrl('W1AW-10', { frequency: 14108500, mode: 53 })).toBe('varahf:///W1AW-10?bw=500&freq=14107');
    expect(patConnectUrl('W1AW-10', { frequency: 14108500, mode: 54 })).toBe('varahf:///W1AW-10?bw=2750&freq=14107');
    expect(patConnectUrl('W1AW-10', { frequency: 3585000, mode: 16 })).toBe('pactor:///W1AW-10?freq=3583.5');
    expect(patConnectUrl('W1AW-10', { frequency: 145050000, mode: 0 })).toBe('ax25:///W1AW-10?freq=145050');
    expect(patConnectUrl('W1AW-10', { frequency: 145070000, mode: 51 })).toBe('varafm:///W1AW-10?freq=145070');
  });

  it('returns null where Pat has no working transport', () => {
    expect(patConnectUrl('W1AW-10', { frequency: 7101200, mode: 22 })).toBe(null); // WINMOR
    expect(patConnectUrl('W1AW-10', { frequency: 10145000, mode: 30 })).toBe(null); // Robust Packet
    expect(patConnectUrl('W1AW-10', { frequency: 7101200, mode: 999 })).toBe(null);
    expect(patConnectUrl('', { frequency: 7101200, mode: 50 })).toBe(null);
  });
});

describe('losHint', () => {
  it('grades distance for VHF/UHF', () => {
    expect(losHint(20)).toBe('los');
    expect(losHint(80)).toBe('extended');
    expect(losHint(250)).toBe('beyond');
    expect(losHint(NaN)).toBe('unknown');
  });
});

describe('aggregateGateways', () => {
  it('groups channels per callsign from either field casing and keeps hours', () => {
    const gws = aggregateGateways([
      row(),
      row({ frequency: 3585000, mode: 16, hours: '22-02' }),
      { Callsign: 'K0ABC', Gridsquare: 'DM79', Frequency: 14108500, Mode: 43, Hours: '13-19' },
      row({ callsign: 'BAD', gridsquare: 'ZZ99' }),
      null,
    ]);
    expect(gws.map((g) => g.callsign).sort()).toEqual(['K0ABC', 'W1AW-10']);
    expect(gws.find((g) => g.callsign === 'K0ABC').channels[0]).toMatchObject({ mode: 43, hours: '13-19' });
  });
});

describe('selectCandidates', () => {
  const gateways = aggregateGateways([
    row({ callsign: 'K0NEAR', gridsquare: 'DM79', frequency: 7101200, mode: 50 }),
    row({ callsign: 'K0NEAR', gridsquare: 'DM79', frequency: 14108500, mode: 50 }),
    row({ callsign: 'K0NEAR', gridsquare: 'DM79', frequency: 3585000, mode: 0 }), // HF packet, +5 dB floor
    row({ callsign: 'K0NEAR', gridsquare: 'DM79', frequency: 145050000, mode: 0 }),
    row({ callsign: 'W1AW-10', gridsquare: 'FN31', frequency: 7101200, mode: 43 }),
    row({ callsign: 'K0NIGHT', gridsquare: 'DM78', frequency: 3590000, mode: 16, hours: '00-11' }),
    row({ callsign: 'K0VHF', gridsquare: 'DM79', frequency: 145010000, mode: 0, hours: '13-19' }),
    row({ callsign: 'JA1XYZ', gridsquare: 'PM95', frequency: 7101200, mode: 50 }),
  ]);

  it('keeps HF gateways in range, nearest first, and VHF ones within packet range', () => {
    const sel = selectCandidates(gateways, DE, { hour: 15 });
    expect(sel.hf.map((c) => c.callsign)).toEqual(['K0NEAR', 'K0NIGHT', 'W1AW-10']);
    expect(sel.packet.map((c) => c.callsign).sort()).toEqual(['K0NEAR', 'K0VHF']);
    expect(sel.hf.at(-1).bearing).toBeGreaterThan(45);
  });

  it('groups on-air channels into one job per required SNR', () => {
    const near = selectCandidates(gateways, DE, { hour: 15 }).hf[0];
    expect(near.jobs.map((j) => j.requiredSNR).sort((a, b) => a - b)).toEqual([-5, 5]);
    expect(near.jobs.find((j) => j.requiredSNR === -5).freqsMHz).toEqual([7.101, 14.109]);
  });

  it('regroups P4-capable channels under the −19 dB floor when the operator has PACTOR 4', () => {
    const p4 = aggregateGateways([row({ callsign: 'K0P4', gridsquare: 'DM79', frequency: 7102000, mode: 17 })]);
    expect(selectCandidates(p4, DE, { hour: 15 }).hf[0].jobs[0].requiredSNR).toBe(-5);
    expect(selectCandidates(p4, DE, { hour: 15, pactor4: true }).hf[0].jobs[0].requiredSNR).toBe(-19);
  });

  it('gives off-air gateways no job and flags off-air VHF', () => {
    const sel = selectCandidates(gateways, DE, { hour: 15 });
    const night = sel.hf.find((c) => c.callsign === 'K0NIGHT');
    expect(night.jobs).toEqual([]);
    expect(night.offAirChannels).toHaveLength(1);
    expect(sel.packet.find((p) => p.callsign === 'K0VHF').onAir).toBe(true);
    const at3 = selectCandidates(gateways, DE, { hour: 3 });
    expect(at3.hf.find((c) => c.callsign === 'K0NIGHT').jobs).toHaveLength(1);
    expect(at3.packet.find((p) => p.callsign === 'K0VHF').onAir).toBe(false);
  });

  it('honours the range and the per-refresh job cap (off-air gateways are free)', () => {
    expect(selectCandidates(gateways, DE, { rangeKm: 500, hour: 15 }).hf.map((c) => c.callsign)).toEqual([
      'K0NEAR',
      'K0NIGHT',
    ]);
    const capped = selectCandidates(gateways, DE, { maxPredictions: 2, hour: 15 });
    expect(capped.hf.map((c) => c.callsign)).toEqual(['K0NEAR', 'K0NIGHT']);
    expect(capped.totalJobs).toBe(2);
    expect(capped.truncated).toBe(1);
  });

  it('shares the cap across distance rings so a dense local area cannot use it all', () => {
    const many = [];
    for (let i = 0; i < 30; i++) {
      many.push(row({ callsign: `LOCAL${i}`, gridsquare: 'DM79', frequency: 7101200 + i * 100, mode: 50 }));
    }
    many.push(row({ callsign: 'MID-1', gridsquare: 'EN34', frequency: 7101200, mode: 50 })); // ~1200 km
    many.push(row({ callsign: 'FAR-1', gridsquare: 'FN31', frequency: 7101200, mode: 50 })); // ~2700 km
    const sel = selectCandidates(aggregateGateways(many), DE, { maxPredictions: 6, hour: 15 });
    const calls = sel.hf.map((c) => c.callsign);
    expect(calls).toContain('MID-1');
    expect(calls).toContain('FAR-1');
    expect(sel.totalJobs).toBe(6);
    expect(sel.truncated).toBe(26);
    // still nearest first in the output
    const d = sel.hf.map((c) => c.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it('returns nothing without a station location; sane defaults', () => {
    expect(selectCandidates(gateways, null).hf).toEqual([]);
    expect(DEFAULT_RANGE_KM).toBe(3000);
    expect(MAX_PREDICTIONS_PER_REFRESH).toBeGreaterThan(0);
    expect(PACKET_RANGE_KM).toBeLessThan(DEFAULT_RANGE_KM);
  });
});

describe('cacheKey / hourKeyFor / buildPredictionParams', () => {
  const base = {
    callsign: 'W1AW-10',
    freqsMHz: [7.101, 14.109],
    requiredSNR: -5,
    deLat: 39.75,
    deLon: -104.99,
    hour: 14,
    month: 10,
    year: 2026,
    ssn: 123,
    power: 100,
    antenna: 'dipole',
  };

  it('is stable under tiny DE / SSN jitter and changes with what matters', () => {
    const k = cacheKey(base);
    expect(cacheKey({ ...base, deLat: 39.7501, ssn: 121 })).toBe(k);
    for (const over of [
      { hour: 15 },
      { power: 500 },
      { antenna: 'yagi3' },
      { freqsMHz: [7.101] },
      { requiredSNR: 5 },
    ]) {
      expect(cacheKey({ ...base, ...over })).not.toBe(k);
    }
  });

  it('rolls over once per UTC hour', () => {
    const a = hourKeyFor(new Date('2026-10-15T14:05:00Z'));
    expect(hourKeyFor(new Date('2026-10-15T14:59:59Z'))).toBe(a);
    expect(hourKeyFor(new Date('2026-10-15T15:00:00Z'))).not.toBe(a);
  });

  it('passes the gateway frequencies and the job threshold to the engine', () => {
    const p = buildPredictionParams(
      { gateway: { lat: 41.5, lon: -72.5 } },
      { requiredSNR: -5, freqsMHz: [7.101] },
      DE,
      { hour: 14, month: 10, year: 2026, ssn: 120, power: '50', txGain: 2.15 },
    );
    expect(p).toMatchObject({ rxLat: 41.5, txPower: 50, txGain: 2.15, requiredSNR: -5, frequencies: [7.101] });
  });
});

describe('restResultForJob (server fallback)', () => {
  const series = (rel) => Array.from({ length: 24 }, (_, h) => ({ hour: h, reliability: rel(h) }));
  const data = {
    currentBands: [{ band: '40m', reliability: 11 }],
    hourlyPredictions: { '40m': series((h) => h * 2), '80m': series((h) => 50 + h) },
  };
  const job = {
    requiredSNR: -5,
    channels: [
      { frequency: 7101200, mode: 50 },
      { frequency: 5356000, mode: 53 }, // 60 m → nearest 40m, approx
      { frequency: 4500000, mode: 16 }, // MARS → 80m, approx
    ],
  };

  it('reads the display hour from the 24-hour series and flags off-band channels approximate', () => {
    const out = restResultForJob(job, data, 10);
    expect(out).toEqual([
      { freq: 7.101, reliability: 20, approx: false },
      { freq: 5.356, reliability: 20, approx: true },
      { freq: 4.5, reliability: 60, approx: true },
    ]);
    const scored = scoreChannels(job.channels, out, -5);
    // the label stays the real band; the reliability is the nearest band's, flagged approx
    expect(scored[1]).toMatchObject({ band: '60m', bandApprox: false, approx: true, reliability: 20, snrMargin: null });
    expect(scored[2]).toMatchObject({ band: '80m', bandApprox: true, approx: true, reliability: 60 });
  });

  it('falls back to currentBands without a series', () => {
    const out = restResultForJob(job, { currentBands: data.currentBands }, 10);
    expect(out[0]).toMatchObject({ reliability: 11 });
  });
});

describe('scoring, off-air and ranking', () => {
  const cand = (callsign, distanceKm) => ({
    callsign,
    distanceKm,
    bearing: 90,
    gateway: { lat: 0, lon: 0, gridsquare: 'JJ00' },
  });

  it('attaches reliability and SNR margin per channel (status comes later)', () => {
    const scored = scoreChannels(
      [
        { frequency: 7101200, mode: 50, modeLabel: 'VARA' },
        { frequency: 21100000, mode: 50, modeLabel: 'VARA' },
      ],
      [{ freq: 7.101, snr: 9.5, reliability: 100 }],
      -5,
    );
    expect(scored[0]).toMatchObject({ band: '40m', reliability: 99, snr: 9.5, snrMargin: 14.5, dialHz: 7099700 });
    expect(scored[1]).toMatchObject({ reliability: null });
    expect(scored[0].status).toBeUndefined();
  });

  it('flags a gateway whose published hours do not say when it is on', () => {
    const r = summarizeGateway(cand('PART', 10), [
      { frequency: 7101200, hours: '12/7', reliability: 80, snrMargin: 3 },
    ]);
    expect(r).toMatchObject({ status: 'good', hoursUnknown: true, hoursNote: { hoursPerDay: 12, text: '12/7' } });
    expect(buildReachSnapshot([r], []).PART).toMatchObject({ hoursUnknown: true, hoursText: '12/7' });
    const known = summarizeGateway(cand('ALL', 10), [{ frequency: 7101200, hours: '00-23', reliability: 80 }]);
    expect(known.hoursUnknown).toBe(false);
  });

  it('never rates a channel above the predicted MUF Good, and prefers a Good channel below it', () => {
    const scored = scoreChannels(
      [
        { frequency: 14108500, mode: 50, modeLabel: 'VARA' },
        { frequency: 7101200, mode: 50, modeLabel: 'VARA' },
      ],
      [
        { freq: 14.109, snr: 24, reliability: 100 },
        { freq: 7.101, snr: 40, reliability: 95 },
      ],
      -5,
      { muf: 9.53 },
    );
    expect(scored[0]).toMatchObject({ aboveMuf: true, muf: 9.5 });
    expect(scored[1].aboveMuf).toBe(false);
    const r = summarizeGateway(cand('NVIS', 10), scored);
    expect(r.status).toBe('good');
    expect(r.best.frequency).toBe(7101200);
    expect(r.channels.find((c) => c.frequency === 14108500).status).toBe('marginal');
    const only20 = summarizeGateway(cand('NVIS20', 10), [scored[0]]);
    expect(only20.status).toBe('marginal');
    // no MUF from the engine (server fallback) → no cap
    expect(
      scoreChannels([{ frequency: 14108500, mode: 50 }], [{ freq: 14.109, reliability: 100 }], -5)[0].aboveMuf,
    ).toBe(false);
  });

  it('marks a gateway with nothing on the air Off the air — never Good', () => {
    const off = summarizeGateway(cand('NIGHT', 10), [], {
      offAirChannels: [{ frequency: 3590000, mode: 16, modeLabel: 'Pactor 3', hours: '00-11' }],
    });
    expect(off.status).toBe('offair');
    expect(off.channels[0]).toMatchObject({ status: 'offair', band: '80m' });
  });

  it('takes status from the best on-air channel when some channels are off', () => {
    const mixed = summarizeGateway(cand('MIX', 10), [{ frequency: 7101200, reliability: 80, snrMargin: 5 }], {
      offAirChannels: [{ frequency: 3590000, mode: 16 }],
    });
    expect(mixed.status).toBe('good');
    expect(mixed.channels.map((c) => c.status)).toEqual(['good', 'offair']);
  });

  it('reclassifies with the operator thresholds', () => {
    const scored = [{ frequency: 7101200, reliability: 60, snrMargin: 2 }];
    expect(summarizeGateway(cand('A', 1), scored).status).toBe('good');
    expect(
      summarizeGateway(cand('A', 1), scored, {
        thresholds: { goodReliability: 70, marginalReliability: 50, marginalSnrMargin: -6 },
      }).status,
    ).toBe('marginal');
  });

  it('picks the best channel and ranks Good → Marginal → Closed → Off the air → Unknown', () => {
    expect(
      bestChannel([
        { reliability: 60, snrMargin: -2 },
        { reliability: 60, snrMargin: 4 },
      ]),
    ).toMatchObject({
      snrMargin: 4,
    });
    const mk = (callsign, distanceKm, rel, margin) =>
      summarizeGateway(cand(callsign, distanceKm), [{ reliability: rel, snrMargin: margin }]);
    const rows = rankGateways([
      summarizeGateway(cand('OFF', 5), [], { offAirChannels: [{ frequency: 7e6, mode: 50 }] }),
      mk('CLOSED', 100, 2, -20),
      mk('MARG', 900, 30, -2),
      mk('GOOD-NEAR', 300, 70, 5),
      mk('GOOD-BEST', 2500, 90, 9),
      summarizeGateway(cand('UNKNOWN', 50), []),
    ]);
    expect(rows.map((r) => r.callsign)).toEqual(['GOOD-BEST', 'GOOD-NEAR', 'MARG', 'CLOSED', 'OFF', 'UNKNOWN']);
  });
});

describe('snapshot, filter and map colouring', () => {
  const rows = [
    { callsign: 'A', status: 'good', reliability: 80, snrMargin: 5, best: { band: '40m', frequency: 7101200 } },
    { callsign: 'B', status: 'marginal', reliability: 30, snrMargin: -1, best: null },
    { callsign: 'C', status: 'closed', reliability: 1, snrMargin: -20, best: null },
    { callsign: 'D', status: 'offair', reliability: null, snrMargin: null, best: null },
  ];
  const packet = [
    { callsign: 'P1', los: 'los', distanceKm: 10, onAir: true },
    { callsign: 'P2', los: 'extended', distanceKm: 90, onAir: true },
    { callsign: 'P3', los: 'beyond', distanceKm: 250, onAir: true },
    { callsign: 'P4', los: 'los', distanceKm: 5, onAir: false },
    { callsign: 'A', los: 'los', distanceKm: 5, onAir: true }, // HF prediction wins
  ];
  const snap = buildReachSnapshot(rows, packet);

  it('indexes HF predictions and VHF line-of-sight / on-air by callsign', () => {
    expect(snap.A).toMatchObject({ kind: 'hf', status: 'good', band: '40m' });
    expect(snap.P1).toMatchObject({ kind: 'packet', los: 'los', status: 'unknown' });
    expect(snap.P4).toMatchObject({ kind: 'packet', status: 'offair' });
  });

  it('filters reachable / good-only, never passing off-air gateways', () => {
    const pass = (f) =>
      Object.keys(snap)
        .filter((k) => passesReachFilter(snap[k], f))
        .sort();
    expect(pass('all')).toEqual(['A', 'B', 'C', 'D', 'P1', 'P2', 'P3', 'P4']);
    expect(pass('reachable')).toEqual(['A', 'B', 'P1', 'P2']);
    expect(pass('good')).toEqual(['A', 'P1']);
    expect(passesReachFilter(undefined, 'reachable')).toBe(false);
  });

  it('colours HF by status and VHF by line of sight', () => {
    expect(reachColorKey(snap.A)).toBe('good');
    expect(reachColorKey(snap.C)).toBe('closed');
    expect(reachColorKey(snap.D)).toBe('offair');
    expect(reachColorKey(snap.P2)).toBe('marginal');
    expect(reachColorKey(snap.P3)).toBe('closed');
    expect(reachColorKey(snap.P4)).toBe('offair');
    expect(reachColorKey(null)).toBe('unknown');
    for (const s of ['good', 'marginal', 'closed', 'offair', 'unknown']) expect(STATUS_COLORS[s]).toMatch(/^#/);
  });

  it('styles markers: mode colour when off, status colour when predicted, faded grey when not predicted', () => {
    expect(reachMarkerStyle(null, 'A', { opacity: 1, modeColor: '#123456' })).toMatchObject({
      fillColor: '#123456',
      radius: 4,
      dim: false,
    });
    expect(reachMarkerStyle(snap, 'A', { opacity: 1 })).toMatchObject({ fillColor: STATUS_COLORS.good, radius: 5 });
    expect(reachMarkerStyle(snap, 'D', { opacity: 1 }).fillColor).toBe(STATUS_COLORS.offair);
    const dim = reachMarkerStyle(snap, 'NOPE', { opacity: 1 });
    expect(dim).toMatchObject({ fillColor: STATUS_COLORS.unknown, radius: 3, dim: true });
    expect(dim.fillOpacity).toBeLessThan(0.5);
  });
});

describe('runBatched', () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  it('never exceeds the concurrency limit and keeps result order', async () => {
    let inFlight = 0;
    let peak = 0;
    const progress = [];
    const results = await runBatched(
      [30, 5, 20, 1, 10],
      async (ms, i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(ms);
        inFlight--;
        return i * 10;
      },
      { concurrency: 2, onProgress: (d, t) => progress.push([d, t]) },
    );
    expect(peak).toBe(2);
    expect(results.map((r) => r.value)).toEqual([0, 10, 20, 30, 40]);
    expect(progress.at(-1)).toEqual([5, 5]);
  });

  it('captures failures per item and stops scheduling when cancelled', async () => {
    const results = await runBatched([1, 2], async (x) => {
      if (x === 2) throw new Error('boom');
      return x;
    });
    expect(results[1].ok).toBe(false);
    let calls = 0;
    let cancelled = false;
    await runBatched(
      [1, 2, 3, 4],
      async () => {
        calls++;
        if (calls === 2) cancelled = true;
      },
      { concurrency: 1, isCancelled: () => cancelled },
    );
    expect(calls).toBe(2);
    expect(await runBatched([], async () => 1)).toEqual([]);
  });
});

describe('cachePut', () => {
  it('evicts the oldest insertion past the bound and refreshes re-inserted keys', () => {
    const m = new Map();
    cachePut(m, 'a', 1, 2);
    cachePut(m, 'b', 2, 2);
    cachePut(m, 'a', 3, 2);
    cachePut(m, 'c', 4, 2);
    expect([...m.keys()]).toEqual(['a', 'c']);
  });
});
