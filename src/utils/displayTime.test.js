import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HOUR_MS,
  DAY_MS,
  MAX_OFFSET_MS,
  DISPLAY_TIME_EVENT,
  SET_TIME_EVENT,
  clampOffset,
  getDisplayOffsetMs,
  isTimeShifted,
  displayNowMs,
  displayNow,
  setDisplayOffsetMs,
  shiftDisplayTime,
  setDisplayTime,
  resetDisplayTime,
  subscribeDisplayTime,
  resolveSetTimeDetail,
  formatOffset,
  installSetTimeListener,
  PLAYBACK_SPEEDS,
  DEFAULT_PLAYBACK_SPEED,
  PLAYBACK_TICK_MS,
  startPlayback,
  stopPlayback,
  isPlaying,
  getPlaybackSpeed,
  setPlaybackSpeed,
  subscribePlayback,
  subscribeDisplayTimeSettled,
} from './displayTime.js';

describe('displayTime store', () => {
  beforeEach(() => resetDisplayTime());

  it('defaults to no offset', () => {
    expect(getDisplayOffsetMs()).toBe(0);
    expect(isTimeShifted()).toBe(false);
    expect(displayNowMs(1000)).toBe(1000);
  });

  it('clamps to ±30 days and rejects garbage', () => {
    expect(clampOffset(MAX_OFFSET_MS * 2)).toBe(MAX_OFFSET_MS);
    expect(clampOffset(-MAX_OFFSET_MS * 2)).toBe(-MAX_OFFSET_MS);
    expect(clampOffset('abc')).toBe(0);
    expect(clampOffset(NaN)).toBe(0);
    expect(clampOffset(1234.6)).toBe(1235);
  });

  it('shifts displayNow by the offset', () => {
    setDisplayOffsetMs(HOUR_MS);
    expect(isTimeShifted()).toBe(true);
    expect(displayNowMs(0)).toBe(HOUR_MS);
    const real = Date.now();
    expect(Math.abs(displayNow().getTime() - (real + HOUR_MS))).toBeLessThan(50);
  });

  it('shiftDisplayTime accumulates and setDisplayTime targets an instant', () => {
    shiftDisplayTime(HOUR_MS);
    shiftDisplayTime(DAY_MS);
    expect(getDisplayOffsetMs()).toBe(HOUR_MS + DAY_MS);
    setDisplayTime(new Date(5 * DAY_MS), 2 * DAY_MS);
    expect(getDisplayOffsetMs()).toBe(3 * DAY_MS);
    setDisplayTime('not a date');
    expect(getDisplayOffsetMs()).toBe(3 * DAY_MS);
  });

  it('notifies subscribers and fires the window event only on change', () => {
    const fn = vi.fn();
    const evt = vi.fn();
    window.addEventListener(DISPLAY_TIME_EVENT, evt);
    const unsub = subscribeDisplayTime(fn);
    setDisplayOffsetMs(HOUR_MS);
    setDisplayOffsetMs(HOUR_MS); // no-op
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(HOUR_MS);
    expect(evt).toHaveBeenCalledTimes(1);
    expect(evt.mock.calls[0][0].detail).toEqual({ offsetMs: HOUR_MS });
    unsub();
    resetDisplayTime();
    expect(fn).toHaveBeenCalledTimes(1);
    window.removeEventListener(DISPLAY_TIME_EVENT, evt);
  });
});

describe('resolveSetTimeDetail', () => {
  const now = Date.UTC(2026, 9, 14, 12, 0, 0);
  it('understands now / offsetMs / iso forms', () => {
    expect(resolveSetTimeDetail('now', now)).toBe(0);
    expect(resolveSetTimeDetail({ now: true }, now)).toBe(0);
    expect(resolveSetTimeDetail({ offsetMs: 90_000 }, now)).toBe(90_000);
    expect(resolveSetTimeDetail({ offsetMs: '3600000' }, now)).toBe(HOUR_MS);
    expect(resolveSetTimeDetail({ iso: '2026-10-15T12:00:00Z' }, now)).toBe(DAY_MS);
    expect(resolveSetTimeDetail({ time: new Date(now - HOUR_MS) }, now)).toBe(-HOUR_MS);
    expect(resolveSetTimeDetail('2026-10-14T13:00:00Z', now)).toBe(HOUR_MS);
    expect(resolveSetTimeDetail(42, now)).toBe(42);
  });
  it('clamps and rejects nonsense', () => {
    expect(resolveSetTimeDetail({ iso: '2030-01-01T00:00:00Z' }, now)).toBe(MAX_OFFSET_MS);
    expect(resolveSetTimeDetail({ iso: 'garbage' }, now)).toBeNull();
    expect(resolveSetTimeDetail({ offsetMs: 'x' }, now)).toBeNull();
    expect(resolveSetTimeDetail(null, now)).toBeNull();
    expect(resolveSetTimeDetail({}, now)).toBeNull();
    expect(resolveSetTimeDetail(true, now)).toBeNull();
  });
});

describe('formatOffset', () => {
  it('formats to the minute with sign', () => {
    expect(formatOffset(0)).toBe('now');
    expect(formatOffset(20_000)).toBe('now'); // < 30 s rounds to zero
    expect(formatOffset(HOUR_MS)).toBe('+1h');
    expect(formatOffset(-45 * 60_000)).toBe('−45m');
    expect(formatOffset(DAY_MS + 2 * HOUR_MS + 30 * 60_000)).toBe('+1d 2h 30m');
    expect(formatOffset(DAY_MS + 30 * 60_000)).toBe('+1d 0h 30m');
    expect(formatOffset(-3 * DAY_MS)).toBe('−3d');
  });
});

describe('installSetTimeListener', () => {
  beforeEach(() => resetDisplayTime());
  it('drives the store from ohc:set-time events and can be removed', () => {
    const dispose = installSetTimeListener(window);
    window.dispatchEvent(new CustomEvent(SET_TIME_EVENT, { detail: { offsetMs: HOUR_MS } }));
    expect(getDisplayOffsetMs()).toBe(HOUR_MS);
    window.dispatchEvent(new CustomEvent(SET_TIME_EVENT, { detail: { iso: 'nope' } }));
    expect(getDisplayOffsetMs()).toBe(HOUR_MS); // ignored
    window.dispatchEvent(new CustomEvent(SET_TIME_EVENT, { detail: 'now' }));
    expect(getDisplayOffsetMs()).toBe(0);
    dispose();
    window.dispatchEvent(new CustomEvent(SET_TIME_EVENT, { detail: { offsetMs: HOUR_MS } }));
    expect(getDisplayOffsetMs()).toBe(0);
  });
  it('tolerates a missing target', () => {
    expect(typeof installSetTimeListener(null)).toBe('function');
  });
});

describe('playback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDisplayTime();
    setPlaybackSpeed(DEFAULT_PLAYBACK_SPEED);
  });
  afterEach(() => {
    stopPlayback({ silent: true });
    resetDisplayTime();
    vi.useRealTimers();
  });

  it('offers 6 s/s, 1 min/s, 10 min/s and 1 h/s, defaulting to 1 min/s', () => {
    expect(PLAYBACK_SPEEDS).toEqual([6, 60, 600, 3600]);
    expect(getPlaybackSpeed()).toBe(60);
  });

  it('advances the offset by real elapsed time × speed', () => {
    startPlayback(60); // 1 min of display time per real second
    expect(isPlaying()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(getDisplayOffsetMs()).toBe(60_000);
    setPlaybackSpeed(3600);
    vi.advanceTimersByTime(1000);
    expect(getDisplayOffsetMs()).toBe(60_000 + 3_600_000);
  });

  it('stops by itself at the end of the range', () => {
    setDisplayOffsetMs(MAX_OFFSET_MS - HOUR_MS);
    startPlayback(3600);
    vi.advanceTimersByTime(5 * PLAYBACK_TICK_MS + 1000);
    expect(getDisplayOffsetMs()).toBe(MAX_OFFSET_MS);
    expect(isPlaying()).toBe(false);
    startPlayback(); // nothing left to play
    expect(isPlaying()).toBe(false);
  });

  it('stops on any explicit set: nudge, absolute time, Now, set-time event', () => {
    for (const set of [
      () => shiftDisplayTime(HOUR_MS),
      () => setDisplayTime(new Date(Date.now() + DAY_MS)),
      () => resetDisplayTime(),
      () => setDisplayOffsetMs(2 * HOUR_MS),
    ]) {
      startPlayback();
      vi.advanceTimersByTime(PLAYBACK_TICK_MS);
      set();
      expect(isPlaying()).toBe(false);
    }
  });

  it('tells playback subscribers about play, speed and pause', () => {
    const fn = vi.fn();
    const unsub = subscribePlayback(fn);
    startPlayback(60);
    setPlaybackSpeed(600);
    stopPlayback();
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      { playing: true, speed: 60 },
      { playing: true, speed: 600 },
      { playing: false, speed: 600 },
    ]);
    unsub();
  });

  it('settled subscribers stay quiet while playing and catch up once on pause', () => {
    const live = vi.fn();
    const settled = vi.fn();
    const unsubLive = subscribeDisplayTime(live);
    const unsubSettled = subscribeDisplayTimeSettled(settled);

    setDisplayOffsetMs(HOUR_MS); // paused change → both
    expect(settled).toHaveBeenCalledTimes(1);

    startPlayback(600);
    vi.advanceTimersByTime(10 * PLAYBACK_TICK_MS);
    expect(live.mock.calls.length).toBeGreaterThan(5);
    expect(settled).toHaveBeenCalledTimes(1); // nothing while playing

    stopPlayback();
    expect(settled).toHaveBeenCalledTimes(2);
    expect(settled).toHaveBeenLastCalledWith(getDisplayOffsetMs());

    startPlayback();
    vi.advanceTimersByTime(PLAYBACK_TICK_MS);
    setDisplayOffsetMs(3 * HOUR_MS); // explicit set while playing → exactly one catch-up
    expect(settled).toHaveBeenCalledTimes(3);
    expect(settled).toHaveBeenLastCalledWith(3 * HOUR_MS);

    unsubLive();
    unsubSettled();
  });
});
