import { describe, expect, it } from 'vitest';
import {
  eclipseForLunation,
  computeEclipses,
  eclipseCatalog,
  tableEntryFor,
  obscuration,
  solarEclipseLocal,
  lunarEclipseLocal,
  upcomingEclipses,
  ECLIPSE_TABLE_SOURCE,
} from './eclipses.js';
import table from './eclipses-2026-2040.json';

const utc = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const minutesOff = (a, b) => Math.abs(a.getTime() - b.getTime()) / 60000;

describe('eclipse canon (Meeus ch. 54)', () => {
  it('finds the 2024-04-08 total solar eclipse: 18:18 UT, gamma 0.343', () => {
    const [e] = computeEclipses(utc(2024, 4, 1), utc(2024, 4, 30));
    expect(e.kind).toBe('solar');
    expect(e.type).toBe('total');
    expect(minutesOff(e.time, utc(2024, 4, 8, 18, 18))).toBeLessThan(5);
    expect(e.gamma).toBeCloseTo(0.3431, 2);
  });

  it('finds the 2026-03-03 total lunar eclipse: 11:34 UT, umbral magnitude 1.151', () => {
    const [e] = computeEclipses(utc(2026, 3, 1), utc(2026, 3, 31));
    expect(e.kind).toBe('lunar');
    expect(e.type).toBe('total');
    expect(minutesOff(e.time, utc(2026, 3, 3, 11, 34))).toBeLessThan(5);
    expect(e.magnitude).toBeCloseTo(1.151, 1);
    expect(e.semiTotal).toBeGreaterThan(25); // ~58 min of totality
    expect(e.semiPartial).toBeGreaterThan(90);
  });

  it('classifies 2029-01-14 as partial (mag 0.87) and 2031-11-14 as hybrid', () => {
    const p = computeEclipses(utc(2029, 1, 1), utc(2029, 1, 31)).find((e) => e.kind === 'solar');
    expect(p.type).toBe('partial');
    expect(p.magnitude).toBeCloseTo(0.871, 1);
    const h = computeEclipses(utc(2031, 11, 1), utc(2031, 11, 30)).find((e) => e.kind === 'solar');
    expect(h.type).toBe('hybrid');
  });

  it('returns null for lunations with no eclipse', () => {
    // 2024-05-08 new moon: |sin F| well above 0.36
    expect(eclipseForLunation(301)).toBeNull();
  });

  it('computes exactly the eclipses in the bundled 2026–2040 table (dates, kinds, types)', () => {
    const computed = computeEclipses(utc(2026, 1, 1), utc(2040, 12, 31, 23, 59));
    expect(computed).toHaveLength(table.eclipses.length);
    for (const e of computed) {
      const row = tableEntryFor(e);
      expect(row, `no table row for ${e.kind} ${e.time.toISOString()}`).not.toBeNull();
      expect(row.type, `type mismatch on ${row.date}`).toBe(e.type);
      if (row.gamma != null) expect(Math.abs(row.gamma - e.gamma), `gamma on ${row.date}`).toBeLessThan(0.02);
    }
    expect(ECLIPSE_TABLE_SOURCE).toMatch(/NASA/);
  });

  it('eclipseCatalog merges visibility text from the table', () => {
    const cat = eclipseCatalog(utc(2026, 8, 1), utc(2026, 8, 31));
    const total = cat.find((e) => e.kind === 'solar');
    expect(total.date).toBe('2026-08-12');
    expect(total.visibility).toMatch(/Iceland/);
    expect(total.magnitude).toBeCloseTo(1.039, 2);
    expect(total.inTable).toBe(true);
  });
});

describe('obscuration', () => {
  it('is 0 when disks are apart, 1 at central totality, ~0.5 at half overlap', () => {
    expect(obscuration(0.266, 0.27, 1)).toBe(0);
    expect(obscuration(0.266, 0.27, 0)).toBe(1);
    expect(obscuration(0.266, 0.26, 0)).toBeCloseTo((0.26 / 0.266) ** 2, 4); // annular
    const half = obscuration(0.266, 0.266, 0.266);
    expect(half).toBeGreaterThan(0.35);
    expect(half).toBeLessThan(0.45);
  });
});

describe('local circumstances', () => {
  const e2024 = computeEclipses(utc(2024, 4, 1), utc(2024, 4, 30))[0];
  const e2026 = computeEclipses(utc(2026, 8, 1), utc(2026, 8, 31)).find((e) => e.kind === 'solar');
  const l2026 = computeEclipses(utc(2026, 3, 1), utc(2026, 3, 31))[0];

  it('2024-04-08 from Dallas: near-total at ~18:42 UT; nothing from Sydney', () => {
    const dallas = solarEclipseLocal(e2024.time, 32.78, -96.8);
    expect(dallas.visible).toBe(true);
    expect(dallas.obscuration).toBeGreaterThan(0.95);
    expect(minutesOff(dallas.maxTime, utc(2024, 4, 8, 18, 42))).toBeLessThan(6);
    expect(dallas.start).not.toBeNull();
    expect(dallas.end).not.toBeNull();
    expect(solarEclipseLocal(e2024.time, -33.87, 151.2).visible).toBe(false);
  });

  it('2026-08-12 from Reykjavik: total; from Boulder: not visible', () => {
    const rvk = solarEclipseLocal(e2026.time, 64.13, -21.9);
    expect(rvk.localType).toBe('total');
    expect(rvk.obscuration).toBe(1);
    expect(solarEclipseLocal(e2026.time, 40.015, -105.27).visible).toBe(false);
  });

  it('2026-03-03 lunar eclipse: Moon up from Boulder, below the horizon from Berlin', () => {
    expect(lunarEclipseLocal(l2026, 40.015, -105.27)).toMatchObject({ visible: true, coverage: 'all' });
    expect(lunarEclipseLocal(l2026, 52.5, 13.4).visible).toBe(false);
  });

  it('upcomingEclipses lists the next events with local data attached', () => {
    const list = upcomingEclipses(utc(2026, 1, 1), { lat: 40.42, lon: -3.7, limit: 4 });
    expect(list).toHaveLength(4);
    expect(list[0].date).toBe('2026-02-17');
    expect(list[0].local).toBeTruthy();
    const noLoc = upcomingEclipses(utc(2026, 1, 1), { limit: 1 });
    expect(noLoc[0].local).toBeNull();
  });
});
