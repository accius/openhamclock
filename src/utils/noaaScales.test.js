import { describe, expect, it } from 'vitest';
import {
  normalizeNoaaScales,
  scaleLevel,
  scaleColor,
  scaleWord,
  scalesSummary,
  maxScaleLevel,
  forecastCell,
  scaleImpact,
} from './noaaScales.js';

// Shape captured from services.swpc.noaa.gov/products/noaa-scales.json
const RAW = {
  0: {
    DateStamp: '2026-10-14',
    TimeStamp: '23:26:00',
    R: { Scale: '0', Text: 'none', MinorProb: null, MajorProb: null },
    S: { Scale: '0', Text: 'none', Prob: null },
    G: { Scale: '2', Text: 'moderate' },
  },
  1: {
    DateStamp: '2026-10-14',
    TimeStamp: '23:26:00',
    R: { Scale: null, Text: null, MinorProb: '20', MajorProb: '5' },
    S: { Scale: null, Text: null, Prob: '5' },
    G: { Scale: '1', Text: 'minor' },
  },
  2: {
    DateStamp: '2026-10-15',
    TimeStamp: '00:00:00',
    R: { Scale: null, Text: null, MinorProb: '60', MajorProb: '30' },
    S: { Scale: null, Text: null, Prob: '55' },
    G: { Scale: '0', Text: 'none' },
  },
  3: {
    DateStamp: '2026-10-16',
    TimeStamp: '00:00:00',
    R: { Scale: null, Text: null, MinorProb: '20', MajorProb: '5' },
    S: { Scale: null, Text: null, Prob: '1' },
    G: { Scale: '0', Text: 'none' },
  },
  '-1': {
    DateStamp: '2026-10-13',
    TimeStamp: '23:26:00',
    R: { Scale: '1', Text: 'minor', MinorProb: null, MajorProb: null },
    S: { Scale: '0', Text: 'none', Prob: null },
    G: { Scale: '0', Text: 'none' },
  },
};

describe('scaleLevel / colours', () => {
  it('clamps strings and numbers to 0..5 and passes null through', () => {
    expect(scaleLevel('3')).toBe(3);
    expect(scaleLevel(9)).toBe(5);
    expect(scaleLevel(null)).toBeNull();
    expect(scaleLevel('x')).toBeNull();
  });

  it('maps levels to the SWPC ramp', () => {
    expect(scaleColor(0)).toBe('#7f8c8d');
    expect(scaleColor(5)).toBe('#b91c1c');
    expect(scaleWord(2)).toBe('moderate');
    expect(scaleImpact('G', 0)).toBe('no effect');
    expect(scaleImpact('R', 3)).toMatch(/blackout/);
  });
});

describe('normalizeNoaaScales', () => {
  it('splits now / yesterday / three forecast days', () => {
    const out = normalizeNoaaScales(RAW);
    expect(out.now.G.level).toBe(2);
    expect(out.now.R.level).toBe(0);
    expect(out.yesterday.R.level).toBe(1);
    expect(out.days).toHaveLength(3);
    expect(out.days[0].R).toEqual({ level: null, text: null, minorProb: 20, majorProb: 5 });
    expect(out.days[1].S.prob).toBe(55);
    expect(out.days[2].date).toBe('2026-10-16');
  });

  it('tolerates garbage', () => {
    expect(normalizeNoaaScales(null)).toEqual({ now: null, yesterday: null, days: [] });
    expect(normalizeNoaaScales({ 0: 'nope' }).now).toBeNull();
  });
});

describe('summary helpers', () => {
  const { now, days } = normalizeNoaaScales(RAW);

  it('builds the R/S/G summary and max level', () => {
    expect(scalesSummary(now)).toBe('R0 S0 G2');
    expect(maxScaleLevel(now)).toBe(2);
    expect(scalesSummary(null)).toBe('');
  });

  it('renders forecast cells: G as a level, R/S as probabilities', () => {
    expect(forecastCell('G', days[0])).toEqual({ level: 1, label: 'G1' });
    expect(forecastCell('R', days[0])).toEqual({ level: 0, label: '20% / 5%' });
    expect(forecastCell('R', days[1]).level).toBe(3); // 30% major
    expect(forecastCell('S', days[1])).toEqual({ level: 1, label: '55%' });
    expect(forecastCell('S', null)).toEqual({ level: null, label: '—' });
  });
});
