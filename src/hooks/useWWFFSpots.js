/**
 * useWWFFSpots Hook
 * Fetches Parks on the Air activations via server proxy (for caching)
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

export const useWWFFSpots = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchWWFF = async () => {
      try {
        // Use server proxy for caching - reduces external API calls
        const res = await apiFetch('/api/wwff/spots');
        if (res.ok) {
          const spots = await res.json();
          
          // Filter out QRT spots and nearly-expired spots, then sort by most recent
          const validSpots = spots
            .filter(s => {
              // Filter out QRT (operator signed off)
              const comments = (s.remarks || '').toUpperCase().trim();
              if (comments === 'QRT' || comments.startsWith('QRT ') || comments.startsWith('QRT,')) return false;

              // We should also time it out if it's more than 60 minutes old
              if (Math.floor(Date.now() / 1000) - s.spot_time > 3600) return false;
              
              return true;
            })
            .sort((a, b) => {
              // Sort by spot_time descending (newest first)
              const timeA = a.spot_time ? a.spot_time : 0;
              const timeB = b.spot_time ? b.spot_time : 0;
              return timeB - timeA;
            });
          
          setData(validSpots.map(s => {
            // Use API coordinates
            let lat = s.latitude ? parseFloat(s.latitude) : null;
            let lon = s.longitude ? parseFloat(s.longitude) : null;
            
            return {
              call: s.activator, 
              ref: s.reference, 
              freq: s.frequency_khz, 
              mode: s.mode,
              name: s.reference_name,
              remarks: s.remarks,
              lat,
              lon,
              time: s.spot_time ? s.spot_time_formatted.substr(11,5)+'z' : '',
              expire: 0
            };
          }));
        }
      } catch (err) { 
        console.error('WWFF error:', err); 
      } finally { 
        setLoading(false); 
      }
    };
    
    fetchWWFF();
    fetchRef.current = fetchWWFF;
    const interval = setInterval(fetchWWFF, 120 * 1000); // 2 minutes - reduced from 1 to save bandwidth
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 10000);

  return { data, loading };
};

export default useWWFFSpots;
