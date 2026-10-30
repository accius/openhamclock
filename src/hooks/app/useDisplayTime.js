/**
 * useDisplayTime — React view of the global display-time offset
 * (utils/displayTime.js). Any component can call it to learn whether the
 * dashboard is time-shifted and to nudge/reset the offset; no prop plumbing.
 * Also exposes playback (run the display time forward at a preset speed).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getDisplayOffsetMs,
  subscribeDisplayTime,
  setDisplayOffsetMs,
  shiftDisplayTime,
  setDisplayTime,
  resetDisplayTime,
  isPlaying,
  getPlaybackSpeed,
  subscribePlayback,
  startPlayback,
  stopPlayback,
  setPlaybackSpeed,
} from '../../utils/displayTime.js';

export default function useDisplayTime() {
  const [offsetMs, setOffset] = useState(getDisplayOffsetMs);

  useEffect(() => subscribeDisplayTime(setOffset), []);

  const [playback, setPlayback] = useState(() => ({ playing: isPlaying(), speed: getPlaybackSpeed() }));
  useEffect(() => subscribePlayback(setPlayback), []);

  const shift = useCallback((deltaMs) => shiftDisplayTime(deltaMs), []);
  const setOffsetMs = useCallback((ms) => setDisplayOffsetMs(ms), []);
  const setTime = useCallback((instant) => setDisplayTime(instant), []);
  const reset = useCallback(() => resetDisplayTime(), []);
  const play = useCallback((speed) => startPlayback(speed), []);
  const pause = useCallback(() => stopPlayback(), []);
  const setSpeed = useCallback((speed) => setPlaybackSpeed(speed), []);

  return {
    offsetMs,
    shifted: offsetMs !== 0,
    shift,
    setOffsetMs,
    setTime,
    reset,
    playing: playback.playing,
    speed: playback.speed,
    play,
    pause,
    setSpeed,
  };
}
