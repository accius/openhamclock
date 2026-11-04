/**
 * useTropicalStorms — active tropical cyclones from /api/tropical/storms
 * (NHC + JTWC, server-cached 10 min). Shared with the tropical-cyclones map
 * layer through sharedFetcher, so the panel and the layer cost one poll.
 */
import { useEffect, useState } from 'react';
import { subscribe } from '../utils/sharedFetcher';

export const TROPICAL_URL = '/api/tropical/storms';
const INTERVAL = 10 * 60 * 1000;

export const useTropicalStorms = (enabled = true) => {
  const [state, setState] = useState({ data: null, error: null, fetchedAt: 0 });

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribe(TROPICAL_URL, INTERVAL, setState);
  }, [enabled]);

  return {
    storms: state.data?.storms || [],
    sources: state.data?.sources || null,
    stale: !!state.data?.stale,
    fetchedAt: state.data?.fetchedAt || null,
    loading: !state.data && !state.error,
    error: state.error,
  };
};

export default useTropicalStorms;
