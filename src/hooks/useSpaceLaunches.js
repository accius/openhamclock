/**
 * useSpaceLaunches Hook
 * Upcoming launches (Launch Library 2 via /api/space-launches). The server
 * caches for 30 minutes because LL2 is rate limited — never poll faster.
 * Shared by the Space Launches panel and the launch-sites map layer.
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

const POLL_MS = 30 * 60 * 1000;

export const useSpaceLaunches = (enabled = true) => {
  const [data, setData] = useState(null); // { launches, count, fetchedAt, stale }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const fetchLaunches = async () => {
      try {
        const response = await apiFetch('/api/space-launches');
        if (response?.ok) {
          const json = await response.json();
          if (Array.isArray(json?.launches)) {
            setData(json);
            setError(null);
          }
        } else if (response) {
          setError(`HTTP ${response.status}`);
        }
      } catch (err) {
        console.error('Space launches error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLaunches();
    fetchRef.current = fetchLaunches;
    const interval = setInterval(fetchLaunches, POLL_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  useVisibilityRefresh(() => fetchRef.current?.(), 5 * 60 * 1000);

  return { data, launches: data?.launches || [], loading, error };
};

export default useSpaceLaunches;
