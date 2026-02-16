/**
 * useDXpeditions Hook
 * Fetches active and upcoming DXpeditions
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

export const useDXpeditions = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchDXpeditions = async () => {
      try {
        const response = await apiFetch('/api/dxpeditions');
        if (response?.ok) {
          const dxpeditions = await response.json();
          setData(dxpeditions);
        }
      } catch (err) {
        console.error('DXpeditions error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDXpeditions();
    fetchRef.current = fetchDXpeditions;
    const interval = setInterval(fetchDXpeditions, 60 * 60 * 1000); // 1 hour
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 30000);

  return { data, loading };
};

export default useDXpeditions;
