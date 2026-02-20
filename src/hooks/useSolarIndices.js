/**
 * useSolarIndices Hook
 * Fetches solar indices with history and Kp forecast
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/apiFetch';

export const useSolarIndices = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await apiFetch('/api/solar-indices');
        if (response?.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (err) {
        console.error('Solar indices error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every 15 minutes
    const interval = setInterval(fetchData, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading };
};

export default useSolarIndices;
