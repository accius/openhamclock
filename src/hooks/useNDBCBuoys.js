/**
 * useNDBCBuoys — NDBC marine observations from /api/ndbc/latest.
 *
 * `all` mode (map layer) subscribes to the whole station list via
 * sharedFetcher; nearest mode (Marine panel) asks the server for the N
 * closest stations to DE (the server computes distance from its cached
 * list, so moving DE costs nothing upstream).
 */
import { useEffect, useRef, useState } from 'react';
import { subscribe } from '../utils/sharedFetcher';
import { apiFetch } from '../utils/apiFetch';
import { useVisibilityRefresh } from './useVisibilityRefresh';

export const NDBC_ALL_URL = '/api/ndbc/latest?all=1';
const INTERVAL = 15 * 60 * 1000;

/** Whole station list (for the map layer). */
export const useNDBCAllBuoys = (enabled = true) => {
  const [state, setState] = useState({ data: null, error: null, fetchedAt: 0 });
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribe(NDBC_ALL_URL, INTERVAL, setState);
  }, [enabled]);
  return {
    stations: state.data?.stations || [],
    fetchedAt: state.data?.fetchedAt || null,
    stale: !!state.data?.stale,
    loading: !state.data && !state.error,
    error: state.error,
  };
};

/** Nearest `limit` stations to (lat, lon). */
export const useNDBCBuoys = (lat, lon, limit = 25) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchRef = useRef(null);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lon);

  useEffect(() => {
    if (!hasLoc) {
      setLoading(false);
      return undefined;
    }
    let alive = true;
    const run = async () => {
      try {
        const res = await apiFetch(`/api/ndbc/latest?lat=${lat}&lon=${lon}&limit=${limit}`);
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    setLoading(true);
    run();
    fetchRef.current = run;
    const id = setInterval(run, INTERVAL);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [lat, lon, limit, hasLoc]);

  useVisibilityRefresh(() => fetchRef.current?.(), 60000);

  return {
    stations: data?.stations || [],
    total: data?.total || 0,
    fetchedAt: data?.fetchedAt || null,
    stale: !!data?.stale,
    loading,
    error,
    hasLocation: hasLoc,
  };
};

export default useNDBCBuoys;
