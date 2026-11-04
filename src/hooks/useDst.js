/**
 * useDst Hook
 * Kyoto Dst index (current + 72 h hourly series) from /api/swpc/dst.
 * Refreshes every 10 minutes (server cache TTL); Dst itself is hourly.
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

export const useDst = () => {
  const [data, setData] = useState(null); // { current, series, source, updatedAt, fetchedAt, stale }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchDst = async () => {
      try {
        const response = await apiFetch('/api/swpc/dst');
        if (response?.ok) {
          const json = await response.json();
          if (Array.isArray(json?.series)) {
            setData(json);
            setError(null);
          }
        } else if (response) {
          setError(`HTTP ${response.status}`);
        }
      } catch (err) {
        console.error('Dst error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDst();
    fetchRef.current = fetchDst;
    const interval = setInterval(fetchDst, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 60000);

  return { data, loading, error };
};

export default useDst;
