import { describe, it, expect } from 'vitest';
import {
  canonicalSatName,
  normalizeHamsAtAlerts,
  alertKey,
  alertMatchesSatellite,
  overlapMs,
  findCoVisibility,
  annotateCoVisibility,
  upcomingAlertFeedItems,
} from './hamsAtAlerts.js';

const RAW = {
  data: [
    {
      id: '6c75bce6',
      mode: 'SSB',
      comment: 'CQ North America. Gridline BL01/BL11.',
      url: 'https://hams.at/alerts/6c75bce6',
      callsign: 'wh6wr',
      mhz_direction: 'down',
      aos_at: '2026-10-25T02:54:10Z',
      los_at: '2026-10-25T03:11:05Z',
      grids: ['BL11', 'bl01'],
      max_elevation: 42.5,
      mhz: 145.938,
      workable_end_at: null,
      workable_start_at: null,
      is_workable: false,
      likes: 7,
      satellite: { name: 'AO-07', number: 7530 },
    },
    {
      id: '28363269',
      mode: 'SSB',
      comment: 'South of Los Banos, CA',
      callsign: 'KB5FHK',
      aos_at: '2026-10-17T01:04:40Z',
      los_at: '2026-10-17T01:26:40Z',
      grids: ['CM96'],
      max_elevation: null,
      satellite: { name: 'RS-44', number: 44909 },
    },
    { id: 'junk', satellite: { name: 'X' } }, // no AOS → dropped
    null,
  ],
};

describe('normalizeHamsAtAlerts', () => {
  it('parses, upper-cases and sorts by AOS', () => {
    const list = normalizeHamsAtAlerts(RAW);
    expect(list).toHaveLength(2);
    expect(list[0].satName).toBe('RS-44');
    expect(list[1]).toMatchObject({
      id: '6c75bce6',
      satName: 'AO-07',
      norad: 7530,
      callsign: 'WH6WR',
      grids: ['BL11', 'BL01'],
      maxElevation: 42.5,
      mhz: 145.938,
      likes: 7,
      isWorkable: false,
    });
    expect(list[1].aosMs).toBe(Date.parse('2026-10-25T02:54:10Z'));
    expect(list[1].losMs).toBe(Date.parse('2026-10-25T03:11:05Z'));
  });
  it('accepts a bare array and tolerates garbage', () => {
    expect(normalizeHamsAtAlerts(RAW.data)).toHaveLength(2);
    expect(normalizeHamsAtAlerts(null)).toEqual([]);
    expect(normalizeHamsAtAlerts({ data: 'nope' })).toEqual([]);
  });
  it('builds stable keys', () => {
    const list = normalizeHamsAtAlerts(RAW);
    expect(alertKey(list[0])).toBe('28363269');
    expect(alertKey(null)).toBe('');
  });
});

describe('satellite matching', () => {
  it('canonicalises names', () => {
    expect(canonicalSatName('AO-07')).toBe('AO7');
    expect(canonicalSatName('AO-7')).toBe('AO7');
    expect(canonicalSatName('ISS (ZARYA)')).toBe('ISSZARYA');
    expect(canonicalSatName('')).toBe('');
  });
  it('matches by NORAD first, then by name', () => {
    const alert = normalizeHamsAtAlerts(RAW)[1];
    expect(alertMatchesSatellite(alert, { name: 'Oscar 7', norad: 7530 })).toBe(true);
    expect(alertMatchesSatellite(alert, { name: 'AO-7', norad: 1 })).toBe(true);
    expect(alertMatchesSatellite(alert, { name: 'AO-7' })).toBe(true);
    expect(alertMatchesSatellite(alert, { name: 'AO-73', norad: 2 })).toBe(false);
    expect(alertMatchesSatellite(null, { name: 'AO-7' })).toBe(false);
  });
});

describe('co-visibility', () => {
  const alert = normalizeHamsAtAlerts(RAW)[1]; // AO-07 02:54–03:11
  const t = (s) => Date.parse(`2026-10-25T${s}Z`);

  it('computes overlaps', () => {
    expect(overlapMs(0, 10, 5, 20)).toBe(5);
    expect(overlapMs(0, 10, 10, 20)).toBe(0);
    expect(overlapMs(0, 10, NaN, 20)).toBe(0);
  });
  it('finds the local pass that overlaps the alerted window', () => {
    const cv = findCoVisibility(alert, [
      { start: t('01:00:00'), end: t('01:15:00'), maxElevation: 10 },
      { start: t('03:00:00'), end: t('03:20:00'), maxElevation: 33 },
    ]);
    expect(cv).toMatchObject({ start: t('03:00:00'), maxElevation: 33 });
    expect(cv.overlapMs).toBe(t('03:11:05') - t('03:00:00'));
    expect(findCoVisibility(alert, [{ start: t('05:00:00'), end: t('05:10:00') }])).toBeNull();
    expect(findCoVisibility(alert, null)).toBeNull();
  });
  it('annotates alerts from the tracked satellite list', () => {
    const sats = [
      {
        name: 'AO-7',
        norad: 7530,
        nextPassStartTimes: [t('03:00:00')],
        nextPassEndTimes: [t('03:20:00')],
        nextPassMaxElevations: [33],
      },
    ];
    const out = annotateCoVisibility(normalizeHamsAtAlerts(RAW), sats);
    expect(out[0].tracked).toBe(false); // RS-44 not tracked
    expect(out[0].coVisible).toBeNull();
    expect(out[1].tracked).toBe(true);
    expect(out[1].coVisible.maxElevation).toBe(33);
  });
});

describe('upcomingAlertFeedItems', () => {
  it('returns alerts inside the lead window as feed items', () => {
    const list = normalizeHamsAtAlerts(RAW);
    const now = Date.parse('2026-10-17T00:55:00Z'); // 9m40s before RS-44 AOS
    const items = upcomingAlertFeedItems(list, now, 15 * 60 * 1000);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: '28363269', name: 'RS-44', callsign: 'KB5FHK', grids: ['CM96'] });
    expect(upcomingAlertFeedItems(list, now - 3600_000)).toEqual([]);
    // Over → gone
    expect(upcomingAlertFeedItems(list, Date.parse('2026-10-17T01:30:00Z'))).toEqual([]);
  });
});
