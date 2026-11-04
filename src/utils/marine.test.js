import { describe, it, expect } from 'vitest';
import {
  msToKt,
  formatWave,
  formatTemp,
  formatWindObs,
  formatPressure,
  formatWaves,
  formatObsAge,
  hasMarineData,
  waveColor,
  buoyPopupRows,
} from './marine.js';

const buoy = {
  id: '44013',
  time: '2026-10-14T22:50:00.000Z',
  wdir: 280,
  wspd: 4,
  gst: 6.2,
  wvht: 0.7,
  dpd: 8,
  apd: 5.3,
  mwd: 82,
  pres: 1009.4,
  ptdy: -1.2,
  atmp: 16.8,
  wtmp: 14.8,
  dewp: 14.8,
  vis: null,
};

describe('marine formatting', () => {
  it('converts wind to knots with direction and gusts', () => {
    expect(msToKt(10)).toBe(19);
    expect(formatWindObs(buoy)).toBe('280° 8 kt G12');
    expect(formatWindObs({ wspd: null })).toBe('—');
  });
  it('formats waves, pressure and temperatures in both unit systems', () => {
    expect(formatWaves(buoy)).toBe('0.7 m @ 8 s from 082°');
    expect(formatWaves(buoy, 'imperial')).toBe('2.3 ft @ 8 s from 082°');
    expect(formatWave(null)).toBe('—');
    expect(formatPressure(buoy)).toBe('1009.4 hPa (-1.2/3h)');
    expect(formatTemp(16.8)).toBe('16.8°C');
    expect(formatTemp(16.8, 'imperial')).toBe('62°F');
  });
  it('formats observation age', () => {
    const now = new Date('2026-10-14T23:15:00Z').getTime();
    expect(formatObsAge(buoy.time, now)).toBe('25 min');
    expect(formatObsAge('2026-10-14T10:00:00Z', now)).toBe('13 h');
    expect(formatObsAge(null, now)).toBe('');
  });
  it('detects stations with usable data and colours by sea state', () => {
    expect(hasMarineData(buoy)).toBe(true);
    expect(hasMarineData({ id: 'X', lat: 0, lon: 0 })).toBe(false);
    expect(waveColor(0.5)).toBe('#4ade80');
    expect(waveColor(5)).toBe('#ef4444');
    expect(waveColor(null)).toBe('#7fa7c9');
  });
  it('builds popup rows in a stable order', () => {
    const rows = buoyPopupRows(buoy, 'metric', new Date('2026-10-14T23:15:00Z').getTime());
    expect(rows.map((r) => r[0])).toEqual([
      'Observed',
      'Wind',
      'Waves',
      'Avg period',
      'Pressure',
      'Air temp',
      'Water temp',
      'Dew point',
    ]);
  });
});
