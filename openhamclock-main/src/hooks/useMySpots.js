/**
 * useMySpots Hook
 * Fetches spots where user's callsign appears (spotted or was spotted)
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/apiFetch';

export const useMySpots = (callsign) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!callsign || callsign === 'N0CALL') {
      setData([]);
      setLoading(false);
      return;
    }

    const fetchMySpots = async () => {
      try {
        const response = await apiFetch(`/api/myspots/${encodeURIComponent(callsign)}`);
        if (response?.ok) {
          const spots = await response.json();
          setData(spots);
        }
      } catch (err) {
        console.error('My spots error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMySpots();
    const interval = setInterval(fetchMySpots, 60000); // 60 seconds (was 30s)
    return () => clearInterval(interval);
  }, [callsign]);

  return { data, loading };
};

export default useMySpots;
