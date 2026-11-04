import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseKyotoDst, parseSwpcDst, parseRow, trimSeries } from './kyotoDst.js';

const fixture = fs.readFileSync(
  path.join(__dirname, '__fixtures__', 'space-weather', 'kyoto-dst-202610.html'),
  'latin1',
);

describe('parseRow', () => {
  it('reads 24 fixed-width values and treats 9999 as missing', () => {
    const row = parseRow(
      '14  -10 -11 -13 -19 -15 -12  -9  -8  -10 -16 -18 -14 -10  -9 -10 -10   -7  -9  -4  -2  -6  -8  -19999',
    );
    expect(row.day).toBe(14);
    expect(row.values).toHaveLength(24);
    expect(row.values[0]).toBe(-10);
    expect(row.values[22]).toBe(-1); // "-19999" = -1 then a missing hour
    expect(row.values[23]).toBeNull();
  });

  it('parses an all-missing future day as nulls', () => {
    const row = parseRow(
      '15 99999999999999999999999999999999 99999999999999999999999999999999 99999999999999999999999999999999',
    );
    expect(row.values.every((v) => v === null)).toBe(true);
  });

  it('ignores header and blank lines', () => {
    expect(parseRow('DAY')).toBeNull();
    expect(parseRow('')).toBeNull();
    expect(parseRow('      1   2   3')).toBeNull();
  });
});

describe('parseKyotoDst', () => {
  it('parses the live page fixture into a UTC-stamped hourly series', () => {
    const out = parseKyotoDst(fixture);
    expect(out.year).toBe(2026);
    expect(out.month).toBe(10);
    expect(out.updatedAt).toBe('2026-10-14T23:00:00Z');
    // 13 full days + 23 hours of day 14
    expect(out.series).toHaveLength(13 * 24 + 23);
    expect(out.series[0]).toEqual({ t: Date.UTC(2026, 9, 1, 0), dst: 7 });
    const last = out.series[out.series.length - 1];
    expect(last).toEqual({ t: Date.UTC(2026, 9, 14, 22), dst: -1 });
    // The Oct 10 storm minimum
    const storm = out.series.find((p) => p.t === Date.UTC(2026, 9, 10, 21));
    expect(storm.dst).toBe(-95);
  });

  it('throws on documents without a month header or data', () => {
    expect(() => parseKyotoDst('<html></html>')).toThrow();
    expect(() => parseKyotoDst('OCTOBER 2026\nDAY\n')).toThrow();
  });
});

describe('parseSwpcDst', () => {
  it('normalises SWPC kyoto-dst.json rows', () => {
    const out = parseSwpcDst([
      { time_tag: '2026-10-08T01:00:00', dst: -5 },
      { time_tag: '2026-10-08T00:00:00', dst: -6 },
      { time_tag: 'bad', dst: 1 },
    ]);
    expect(out.series).toEqual([
      { t: Date.UTC(2026, 9, 8, 0), dst: -6 },
      { t: Date.UTC(2026, 9, 8, 1), dst: -5 },
    ]);
  });
});

describe('trimSeries', () => {
  it('keeps the trailing window relative to the newest point', () => {
    const base = Date.UTC(2026, 0, 1);
    const series = Array.from({ length: 100 }, (_, i) => ({ t: base + i * 3600e3, dst: i }));
    expect(trimSeries(series, 24)).toHaveLength(25);
    expect(trimSeries([], 24)).toEqual([]);
  });
});
