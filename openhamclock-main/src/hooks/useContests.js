/**
 * useContests Hook
 * Fetches upcoming amateur radio contests
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

export const useContests = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchContests = async () => {
      try {
        const response = await apiFetch('/api/contests');
        if (response?.ok) {
          const contests = await response.json();
          setData(contests);
        }
      } catch (err) {
        console.error('Contests error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchContests();
    fetchRef.current = fetchContests;
    const interval = setInterval(fetchContests, 30 * 60 * 1000); // 30 minutes
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 30000);

  return { data, loading };
};

export default useContests;
