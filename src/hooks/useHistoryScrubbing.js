/**
 * useHistoryScrubbing — true while the History Playback layer is enabled and
 * scrubbed away from the live edge. The flat map, azimuthal map and globe use
 * it to hide the live DX cluster paths so only the replayed spots show.
 */
import { useEffect, useState } from 'react';
import { getSnapshot, subscribe } from '../services/historyPlaybackStore.js';

export function useHistoryScrubbing() {
  const [scrubbing, setScrubbing] = useState(() => !!getSnapshot().scrubbing);
  useEffect(() => subscribe((snap) => setScrubbing(!!snap.scrubbing)), []);
  return scrubbing;
}

export default useHistoryScrubbing;
