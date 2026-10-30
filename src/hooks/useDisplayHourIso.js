/**
 * useDisplayHourIso — the Time Shift display time floored to the whole UTC
 * hour (utils/voacapHeatmap.js displayHourIso), as state that only changes
 * when that hour does: on a Time Shift change (subscribeDisplayTime) and, for
 * the unshifted "now", when the real clock crosses an hour (checked every
 * minute). Hourly consumers (the VOACAP heatmap) refetch on it — once per
 * display hour, also while Time Shift is playing.
 */
import { useEffect, useState } from 'react';
import { subscribeDisplayTime } from '../utils/displayTime.js';
import { displayHourIso } from '../utils/voacapHeatmap.js';

export default function useDisplayHourIso(enabled = true) {
  const [hourIso, setHourIso] = useState(() => displayHourIso());

  useEffect(() => {
    if (!enabled) return undefined;
    const update = () => {
      const next = displayHourIso();
      setHourIso((prev) => (prev === next ? prev : next));
    };
    update();
    const unsub = subscribeDisplayTime(update);
    const id = setInterval(update, 60_000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [enabled]);

  return hourIso;
}
