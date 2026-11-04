/**
 * useDisplayTime — React view of the global display-time offset
 * (utils/displayTime.js). Any component can call it to learn whether the
 * dashboard is time-shifted and to nudge/reset the offset; no prop plumbing.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getDisplayOffsetMs,
  subscribeDisplayTime,
  setDisplayOffsetMs,
  shiftDisplayTime,
  setDisplayTime,
  resetDisplayTime,
} from '../../utils/displayTime.js';

export default function useDisplayTime() {
  const [offsetMs, setOffset] = useState(getDisplayOffsetMs);

  useEffect(() => subscribeDisplayTime(setOffset), []);

  const shift = useCallback((deltaMs) => shiftDisplayTime(deltaMs), []);
  const setOffsetMs = useCallback((ms) => setDisplayOffsetMs(ms), []);
  const setTime = useCallback((instant) => setDisplayTime(instant), []);
  const reset = useCallback(() => resetDisplayTime(), []);

  return { offsetMs, shifted: offsetMs !== 0, shift, setOffsetMs, setTime, reset };
}
