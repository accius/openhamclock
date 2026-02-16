/**
 * useSOTASpots Hook
 * Fetches Summits on the Air activations via server proxy (for caching)
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

export const useSOTASpots = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchSOTA = async () => {
      try {
        const res = await apiFetch('/api/sota/spots');
        if (res?.ok) {
          const spots = await res.json();

          // Map SOTA API response to our standard spot format
          const mapped = (Array.isArray(spots) ? spots : [])
            .filter(s => s.activatorCallsign)
            .map(s => {
              // summitDetails often contains lat/lng from the SOTA DB
              const details = s.summitDetails || {};
              const lat = details.latitude != null ? parseFloat(details.latitude) : null;
              const lon = details.longitude != null ? parseFloat(details.longitude) : null;

              // Parse frequency — SOTA API may return it as a string like "14.062"
              const freq = s.frequency ? String(s.frequency) : '';

              return {
                call: s.activatorCallsign,
                ref: s.associationCode && s.summitCode
                  ? `${s.associationCode}/${s.summitCode}`
                  : (s.summitCode || ''),
                summit: details.name || '',
                altM: details.altM || details.altitude || null,
                points: details.points || s.points || null,
                freq,
                mode: s.mode || '',
                comments: s.comments || '',
                lat,
                lon,
                time: s.timeStamp
                  ? new Date(s.timeStamp).toISOString().substr(11, 5) + 'z'
                  : ''
              };
            });

          setData(mapped);
        }
      } catch (err) {
        console.error('SOTA error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSOTA();
    fetchRef.current = fetchSOTA;
    const interval = setInterval(fetchSOTA, 120 * 1000); // 2 minutes
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 10000);

  return { data, loading };
};

export default useSOTASpots;
