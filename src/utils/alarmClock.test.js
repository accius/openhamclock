import { describe, it, expect } from 'vitest';
import {
  parseHHMM,
  formatHHMM,
  wallClock,
  zonedToMs,
  nextOccurrence,
  normalizeAlarmState,
  nextAlarmTimes,
  dueAlarms,
  applySetAlarmDetail,
  onceAlarmAt,
  formatCountdown,
  DEFAULT_ALARM,
} from './alarmClock.js';

const T = (iso) => Date.parse(iso);

describe('parseHHMM / formatHHMM', () => {
  it('parses valid 24 h times', () => {
    expect(parseHHMM('07:30')).toEqual({ h: 7, m: 30 });
    expect(parseHHMM('7:05')).toEqual({ h: 7, m: 5 });
    expect(parseHHMM('2359')).toEqual({ h: 23, m: 59 });
    expect(parseHHMM(' 00:00 ')).toEqual({ h: 0, m: 0 });
  });
  it('rejects garbage', () => {
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('12:60')).toBeNull();
    expect(parseHHMM('noon')).toBeNull();
    expect(parseHHMM('')).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });
  it('formats with zero padding', () => {
    expect(formatHHMM(7, 5)).toBe('07:05');
  });
});

describe('zone helpers', () => {
  it('wallClock reads the zone wall time', () => {
    const w = wallClock(T('2026-07-04T16:30:00Z'), 'America/New_York');
    expect(w).toMatchObject({ y: 2026, mo: 7, d: 4, h: 12, mi: 30 }); // EDT = UTC-4
    const u = wallClock(T('2026-01-01T00:05:00Z'), 'UTC');
    expect(u).toMatchObject({ y: 2026, mo: 1, d: 1, h: 0, mi: 5 });
  });
  it('zonedToMs inverts wallClock across DST', () => {
    const summer = zonedToMs({ y: 2026, mo: 7, d: 4, h: 12, mi: 30 }, 'America/New_York');
    expect(summer).toBe(T('2026-07-04T16:30:00Z'));
    const winter = zonedToMs({ y: 2026, mo: 1, d: 15, h: 12, mi: 30 }, 'America/New_York');
    expect(winter).toBe(T('2026-01-15T17:30:00Z')); // EST = UTC-5
  });
});

describe('nextOccurrence', () => {
  it('UTC: later today, else tomorrow', () => {
    const now = T('2026-10-14T10:00:00Z');
    expect(nextOccurrence('11:00', { utc: true, nowMs: now })).toBe(T('2026-10-14T11:00:00Z'));
    expect(nextOccurrence('09:00', { utc: true, nowMs: now })).toBe(T('2026-10-15T09:00:00Z'));
    expect(nextOccurrence('10:00', { utc: true, nowMs: now })).toBe(T('2026-10-15T10:00:00Z')); // strictly after
  });
  it('zone: honours the station zone', () => {
    const now = T('2026-10-14T10:00:00Z'); // 06:00 EDT
    expect(nextOccurrence('07:00', { tz: 'America/New_York', nowMs: now })).toBe(T('2026-10-14T11:00:00Z'));
    expect(nextOccurrence('05:00', { tz: 'America/New_York', nowMs: now })).toBe(T('2026-10-15T09:00:00Z'));
  });
  it('zone: tomorrow lands on the wall-clock minute across a DST change', () => {
    // US DST ends 2026-11-01 02:00 EDT → 01:00 EST. 07:00 local on Nov 1 is 12:00Z.
    const now = T('2026-10-31T20:00:00Z'); // 16:00 EDT Oct 31
    expect(nextOccurrence('07:00', { tz: 'America/New_York', nowMs: now })).toBe(T('2026-11-01T12:00:00Z'));
  });
  it('returns null for bad times', () => {
    expect(nextOccurrence('25:00', { utc: true })).toBeNull();
  });
});

describe('normalizeAlarmState', () => {
  it('fills defaults and disarms unusable alarms', () => {
    expect(normalizeAlarmState(null)).toEqual({ daily: { ...DEFAULT_ALARM.daily }, once: { ...DEFAULT_ALARM.once } });
    const s = normalizeAlarmState({ daily: { time: 'bad', armed: true }, once: { armed: true, at: 'nope' } });
    expect(s.daily.armed).toBe(false);
    expect(s.once.armed).toBe(false);
    expect(s.once.at).toBeNull();
  });
  it('keeps a valid absolute once-instant (normalised to ISO)', () => {
    const s = normalizeAlarmState({ once: { armed: true, at: '2026-10-20T12:00:00.000+02:00' } });
    expect(s.once.at).toBe('2026-10-20T10:00:00.000Z');
    expect(s.once.armed).toBe(true);
  });
});

describe('nextAlarmTimes', () => {
  const now = T('2026-10-14T10:00:00Z');
  it('reports nothing when disarmed', () => {
    expect(nextAlarmTimes(null, { nowMs: now })).toEqual({ daily: null, once: null, next: null });
  });
  it('picks the soonest armed alarm', () => {
    const state = {
      daily: { time: '12:00', utc: true, armed: true },
      once: { armed: true, at: '2026-10-14T11:30:00Z' },
    };
    const r = nextAlarmTimes(state, { nowMs: now });
    expect(r.daily).toBe(T('2026-10-14T12:00:00Z'));
    expect(r.once).toBe(T('2026-10-14T11:30:00Z'));
    expect(r.next).toEqual({ kind: 'once', at: T('2026-10-14T11:30:00Z') });
  });
});

describe('dueAlarms', () => {
  const state = {
    daily: { time: '12:00', utc: true, armed: true },
    once: { time: '12:30', utc: true, armed: true, at: null },
  };
  it('fires exactly once when the tick crosses the minute', () => {
    const before = T('2026-10-14T11:59:59Z');
    const at = T('2026-10-14T12:00:00Z');
    expect(dueAlarms(state, before, at)).toEqual(['daily']);
    expect(dueAlarms(state, at, at + 1000)).toEqual([]);
    expect(dueAlarms(state, T('2026-10-14T12:29:59Z'), T('2026-10-14T12:30:00Z'))).toEqual(['once']);
  });
  it('catches an alarm missed during a short sleep but not a long one', () => {
    expect(dueAlarms(state, T('2026-10-14T11:58:00Z'), T('2026-10-14T12:03:00Z'))).toEqual(['daily']);
    expect(dueAlarms(state, T('2026-10-14T11:58:00Z'), T('2026-10-14T12:30:00Z'))).toEqual(['once']); // daily > 10 min late → missed
  });
  it('uses the absolute once-instant when set', () => {
    const s = { once: { armed: true, at: '2026-10-14T15:00:00Z' } };
    expect(dueAlarms(s, T('2026-10-14T14:59:59Z'), T('2026-10-14T15:00:00Z'))).toEqual(['once']);
  });
  it('ignores disarmed alarms and non-advancing ticks', () => {
    expect(dueAlarms(null, 0, 1000)).toEqual([]);
    expect(dueAlarms(state, 1000, 1000)).toEqual([]);
  });
});

describe('applySetAlarmDetail / onceAlarmAt', () => {
  it('sets and arms a daily alarm from a remote event', () => {
    const s = applySetAlarmDetail(null, { kind: 'daily', time: '6:30', utc: true });
    expect(s.daily).toEqual({ time: '06:30', utc: true, armed: true });
  });
  it('disarms without touching the time', () => {
    const s0 = applySetAlarmDetail(null, { kind: 'daily', time: '06:30' });
    const s1 = applySetAlarmDetail(s0, { kind: 'daily', armed: false });
    expect(s1.daily).toMatchObject({ time: '06:30', armed: false });
  });
  it('ignores unknown kinds and bad times', () => {
    const base = normalizeAlarmState(null);
    expect(applySetAlarmDetail(base, { kind: 'weekly', time: '06:30' })).toEqual(base);
    expect(applySetAlarmDetail(base, { kind: 'daily', time: '99:99' })).toEqual(base);
    expect(applySetAlarmDetail(base, 'nope')).toEqual(base);
  });
  it('once: an absolute instant wins and is stored as UTC', () => {
    const s = onceAlarmAt(null, '2026-10-17T12:00:00Z', 'CQ WW SSB');
    expect(s.once.at).toBe('2026-10-17T12:00:00.000Z');
    expect(s.once.time).toBe('12:00');
    expect(s.once.utc).toBe(true);
    expect(s.once.armed).toBe(true);
    expect(s.once.label).toBe('CQ WW SSB');
    // A wall-clock time afterwards clears the absolute instant
    const s2 = applySetAlarmDetail(s, { kind: 'once', time: '18:00', utc: false });
    expect(s2.once.at).toBeNull();
    expect(s2.once.time).toBe('18:00');
  });
});

describe('formatCountdown', () => {
  it('rounds up to whole minutes', () => {
    expect(formatCountdown(30_000)).toBe('1m');
    expect(formatCountdown(65 * 60_000)).toBe('1h 05m');
    expect(formatCountdown(26 * 3_600_000)).toBe('1d 02h');
    expect(formatCountdown(-5)).toBe('0m');
  });
});
