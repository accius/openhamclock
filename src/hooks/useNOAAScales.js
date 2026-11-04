/**
 * useNOAAScales Hook
 * NOAA R/S/G space weather scales (current + 3-day forecast) from
 * /api/swpc/scales. Refreshes every 5 minutes (server cache TTL).
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';
import { normalizeNoaaScales } from '../utils/noaaScales.js';

export const useNOAAScales = () => {
  const [data, setData] = useState(null); // { now, yesterday, days, fetchedAt, stale }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchScales = async () => {
      try {
        const response = await apiFetch('/api/swpc/scales');
        if (response?.ok) {
          const json = await response.json();
          if (json?.scales) {
            setData({ ...normalizeNoaaScales(json.scales), fetchedAt: json.fetchedAt, stale: !!json.stale });
            setError(null);
          }
        } else if (response) {
          setError(`HTTP ${response.status}`);
        }
      } catch (err) {
        console.error('NOAA scales error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchScales();
    fetchRef.current = fetchScales;
    const interval = setInterval(fetchScales, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 30000);

  return { data, loading, error };
};

export default useNOAAScales;
