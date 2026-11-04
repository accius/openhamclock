/**
 * useWatchlists — React bindings for the HamClock-style watch lists.
 *
 *   useWatchlist(key)         → [list, setList]   one list ({ mode, text })
 *   useWatchlistLogIndex()    → log index the NA* keywords test against,
 *                               rebuilt on every native-logbook change and
 *                               once cty.dat arrives (entity resolution)
 *   useCompiledWatchlist(key) → { mode, matcher, errors } ready to apply
 *
 * The log index is one module-level store shared by every consumer, so the
 * DX panel, four activation panels and the logbook cost one rebuild per log
 * change between them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getWatchlist, setWatchlist, subscribeWatchlists } from '../utils/watchlistStore.js';
import { buildWatchlistLogIndex, compileWatchlist } from '../utils/watchlistSpec.js';
import { ctyLookup } from '../utils/ctyLookup.js';
import { getAll as getLogbookQsos, subscribe as subscribeLogbook } from '../services/logbookStore.js';

export const useWatchlist = (key) => {
  const [list, setList] = useState(() => getWatchlist(key));
  useEffect(() => {
    setList(getWatchlist(key));
    return subscribeWatchlists(() => setList(getWatchlist(key)));
  }, [key]);
  const set = useCallback((next) => setWatchlist(key, next), [key]);
  return [list, set];
};

const logStore = {
  index: buildWatchlistLogIndex([]),
  subscribers: new Set(),
  unsubscribeLogbook: null,
  ctyListener: null,
};

const rebuildLogIndex = () => {
  logStore.index = buildWatchlistLogIndex(getLogbookQsos(), { resolve: ctyLookup });
  logStore.subscribers.forEach((cb) => cb(logStore.index));
};

const subscribeLogIndex = (cb) => {
  logStore.subscribers.add(cb);
  if (!logStore.unsubscribeLogbook) {
    logStore.unsubscribeLogbook = subscribeLogbook(() => rebuildLogIndex());
    logStore.ctyListener = () => rebuildLogIndex();
    window.addEventListener('openhamclock-cty-loaded', logStore.ctyListener);
    rebuildLogIndex();
  } else {
    cb(logStore.index);
  }
  return () => {
    logStore.subscribers.delete(cb);
    if (logStore.subscribers.size === 0 && logStore.unsubscribeLogbook) {
      logStore.unsubscribeLogbook();
      logStore.unsubscribeLogbook = null;
      window.removeEventListener('openhamclock-cty-loaded', logStore.ctyListener);
      logStore.ctyListener = null;
    }
  };
};

export const useWatchlistLogIndex = () => {
  const [index, setIndex] = useState(logStore.index);
  useEffect(() => subscribeLogIndex(setIndex), []);
  return index;
};

export const useCompiledWatchlist = (key) => {
  const [list] = useWatchlist(key);
  const logIndex = useWatchlistLogIndex();
  return useMemo(() => compileWatchlist(list, { logIndex, resolve: ctyLookup }), [list, logIndex]);
};

export default useWatchlist;
