import { describe, it, expect } from 'vitest';
import { STATIONS, isKnownChart, chartUrl, usbDialKHz, getCatalog } from './wefaxCatalog.js';

describe('wefaxCatalog', () => {
  it('ships the five US radiofax stations with frequencies and charts', () => {
    expect(STATIONS.map((s) => s.id)).toEqual(['NMF', 'NMG', 'NMC', 'KVM70', 'NOJ']);
    for (const s of STATIONS) {
      expect(s.frequenciesKHz.length).toBeGreaterThan(2);
      expect(s.charts.length).toBeGreaterThan(5);
      for (const c of s.charts) expect(c.id).toMatch(/^[A-Z]{4}\d{2}$/);
    }
  });

  it('allowlists only catalogue chart ids', () => {
    expect(isKnownChart('PYAA12')).toBe(true);
    expect(isKnownChart('PYBA90')).toBe(true);
    expect(isKnownChart('ZZZZ00')).toBe(false);
    expect(isKnownChart('../etc')).toBe(false);
    expect(isKnownChart('pyaa12')).toBe(false);
    expect(isKnownChart(null)).toBe(false);
  });

  it('builds the tgftp URL and USB dial frequency', () => {
    expect(chartUrl('PYAA12')).toBe('https://tgftp.nws.noaa.gov/fax/PYAA12.gif');
    expect(usbDialKHz(4235)).toBe(4233.1);
    expect(usbDialKHz(12410.6)).toBe(12408.7);
  });

  it('getCatalog adds dial frequencies per station', () => {
    const cat = getCatalog();
    const nmf = cat.stations.find((s) => s.id === 'NMF');
    expect(nmf.dialKHz).toEqual([4233.1, 6338.6, 9108.1, 12748.1]);
  });
});
