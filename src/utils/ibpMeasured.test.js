import { describe, it, expect } from 'vitest';
import {
  snrColor,
  snrToScore,
  latestByPair,
  heatStrip,
  heatStripGradient,
  measuredBandSummary,
  beaconOpenings,
  ibpBandForFreq,
  agreement,
  agreementByBeacon,
  ageLabel,
  NOT_HEARD_COLOR,
  HEARD_SNR_DB,
} from './ibpMeasured.js';

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const MIN = 60_000;
const m = (beacon, band, minutesAgo, snrDb) => ({ beacon, band, t: NOW - minutesAgo * MIN, snrDb });

describe('snr scale', () => {
  it('grey below the heard threshold, red→green above it', () => {
    expect(snrColor(null)).toBe(NOT_HEARD_COLOR);
    expect(snrColor(HEARD_SNR_DB - 1)).toBe(NOT_HEARD_COLOR);
    expect(snrColor(HEARD_SNR_DB)).toBe('hsl(0, 80%, 48%)');
    expect(snrColor(30)).toBe('hsl(120, 80%, 48%)');
    expect(snrColor(99)).toBe('hsl(120, 80%, 48%)');
  });

  it('maps −10…+30 dB onto 0…99', () => {
    expect(snrToScore(-10)).toBe(0);
    expect(snrToScore(10)).toBe(50);
    expect(snrToScore(30)).toBe(99);
    expect(snrToScore(45)).toBe(99);
    expect(snrToScore(undefined)).toBeNull();
  });
});

describe('latestByPair / heatStrip', () => {
  it('keeps the newest measurement per beacon+band', () => {
    const latest = latestByPair([m('4U1UN', '20m', 30, 3), m('4U1UN', '20m', 5, 12), m('4U1UN', '10m', 7, -2)]);
    expect(latest.get('4U1UN|20m').snrDb).toBe(12);
    expect(latest.get('4U1UN|10m').snrDb).toBe(-2);
    expect(latest.size).toBe(2);
  });

  it('bins 24 h into 48 buckets with the max SNR per bin', () => {
    const strip = heatStrip(
      [m('OH2B', '20m', 10, 5), m('OH2B', '15m', 12, 15), m('OH2B', '20m', 23 * 60, 20)],
      'OH2B',
      {
        now: NOW,
      },
    );
    expect(strip).toHaveLength(48);
    expect(strip[47].maxSnr).toBe(15);
    expect(strip[47].n).toBe(2);
    expect(strip[2].maxSnr).toBe(20); // 23 h ago → third half-hour bucket
    expect(strip[20].n).toBe(0);
    const css = heatStripGradient(strip);
    expect(css.startsWith('linear-gradient(to right,')).toBe(true);
    expect(css).toContain('hsl(70, 80%, 48%) 4.17% 6.25%');
    expect(css).toContain('transparent 6.25% 8.33%');
  });
});

describe('measuredBandSummary', () => {
  it('summarizes the last 20 minutes per band', () => {
    const s = measuredBandSummary(
      [m('W6WX', '20m', 3, 18), m('ZL6B', '20m', 9, 2), m('JA2IGY', '15m', 16, 9), m('4S7B', '10m', 40, 25)],
      { now: NOW },
    );
    expect(s['20m']).toMatchObject({ maxSnr: 18, n: 2, heard: 1, score: 69 });
    expect(s['15m']).toMatchObject({ maxSnr: 9, n: 1, heard: 1 });
    expect(s['10m']).toBeUndefined(); // outside the window
  });
});

describe('beaconOpenings', () => {
  it('reports pairs that are open now, dated from the start of the contiguous heard run', () => {
    const list = [
      m('VK6RBP', '15m', 60, -3),
      m('VK6RBP', '15m', 45, 7), // run starts here (≥ heard)
      m('VK6RBP', '15m', 30, 9),
      m('VK6RBP', '15m', 15, 14), // ≥ opening
      m('CS3B', '20m', 15, 25), // open but the run began before: fine, single point
      m('5Z4B', '10m', 45, 20),
      m('5Z4B', '10m', 15, 1), // faded — not open
    ];
    const open = beaconOpenings(list, { now: NOW });
    expect(open.map((o) => `${o.beacon}/${o.band}`)).toEqual(['CS3B/20m', 'VK6RBP/15m']);
    expect(open[1].openedAt).toBe(NOW - 45 * MIN);
    expect(open[1].snrDb).toBe(14);
  });

  it('a run interrupted by a not-heard measurement restarts the opening clock', () => {
    const list = [m('OA4B', '12m', 50, 12), m('OA4B', '12m', 35, 0), m('OA4B', '12m', 20, 11)];
    expect(beaconOpenings(list, { now: NOW })[0].openedAt).toBe(NOW - 20 * MIN);
  });
});

describe('agreement with P.533', () => {
  it('maps P.533 output frequencies onto IBP bands', () => {
    expect(ibpBandForFreq(14)).toBe('20m');
    expect(ibpBandForFreq(18)).toBe('17m');
    expect(ibpBandForFreq(21)).toBe('15m');
    expect(ibpBandForFreq(24)).toBe('12m');
    expect(ibpBandForFreq(28)).toBe('10m');
    expect(ibpBandForFreq(7)).toBeNull();
  });

  it('verdicts', () => {
    expect(agreement(80, 15)).toBe('agrees');
    expect(agreement(80, 0)).toBe('worse');
    expect(agreement(5, 15)).toBe('better');
    expect(agreement(5, -4)).toBe('agrees');
    expect(agreement(35, -4)).toBe('agrees');
    expect(agreement(null, 10)).toBe('nodata');
    expect(agreement(50, undefined)).toBe('nodata');
  });

  it('tallies per beacon and ignores stale measurements', () => {
    const latest = latestByPair([m('4X6TU', '20m', 5, 20), m('4X6TU', '10m', 5, -5), m('4X6TU', '15m', 300, 20)]);
    const pred = { '4X6TU': { '20m': 90, '10m': 70, '15m': 90, '17m': 60 }, LU4AA: { '20m': 10 } };
    const out = agreementByBeacon(latest, pred, { now: NOW });
    expect(out['4X6TU']).toMatchObject({ agrees: 1, worse: 1, better: 0, total: 2 });
    expect(out['4X6TU'].verdicts).toEqual({ '20m': 'agrees', '10m': 'worse' });
    expect(out.LU4AA.total).toBe(0);
  });

  it('ageLabel', () => {
    expect(ageLabel(NOW - 20_000, NOW)).toBe('20s');
    expect(ageLabel(NOW - 7 * MIN, NOW)).toBe('7m');
    expect(ageLabel(NOW - 3 * 60 * MIN, NOW)).toBe('3h');
    expect(ageLabel(null, NOW)).toBe('');
  });
});
