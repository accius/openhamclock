/**
 * usePOTASpots Hook
 * Fetches Parks on the Air activations via server proxy (for caching)
 */
import { useState, useEffect } from 'react';

// Convert grid square to lat/lon
function gridToLatLon(grid) {
  if (!grid || grid.length < 4) return null;
  
  const g = grid.toUpperCase();
  const lon = (g.charCodeAt(0) - 65) * 20 - 180;
  const lat = (g.charCodeAt(1) - 65) * 10 - 90;
  const lonMin = parseInt(g[2]) * 2;
  const latMin = parseInt(g[3]) * 1;
  
  let finalLon = lon + lonMin + 1;
  let finalLat = lat + latMin + 0.5;
  
  if (grid.length >= 6) {
    const lonSec = (g.charCodeAt(4) - 65) * (2/24);
    const latSec = (g.charCodeAt(5) - 65) * (1/24);
    finalLon = lon + lonMin + lonSec + (1/24);
    finalLat = lat + latMin + latSec + (0.5/24);
  }
  
  return { lat: finalLat, lon: finalLon };
}

export const usePOTASpots = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPOTA = async () => {
      try {
        // Use server proxy for caching - reduces external API calls
        const res = await fetch('/api/pota/spots');
        if (res.ok) {
          const spots = await res.json();
          
          // Filter out QRT spots and nearly-expired spots, then sort by most recent
          const validSpots = spots
            .filter(s => {
              // Filter out QRT (operator signed off)
              const comments = (s.comments || '').toUpperCase().trim();
              if (comments === 'QRT' || comments.startsWith('QRT ') || comments.startsWith('QRT,')) return false;
              
              // Filter out spots expiring within 60 seconds
              if (typeof s.expire === 'number' && s.expire < 60) return false;
              
              return true;
            })
            .sort((a, b) => {
              // Sort by spotTime descending (newest first)
              const timeA = a.spotTime ? new Date(a.spotTime).getTime() : 0;
              const timeB = b.spotTime ? new Date(b.spotTime).getTime() : 0;
              return timeB - timeA;
            });
          
          setData(validSpots.map(s => {
            // Use API coordinates, fall back to grid square
            let lat = s.latitude ? parseFloat(s.latitude) : null;
            let lon = s.longitude ? parseFloat(s.longitude) : null;
            
            if ((!lat || !lon) && s.grid6) {
              const loc = gridToLatLon(s.grid6);
              if (loc) { lat = loc.lat; lon = loc.lon; }
            }
            if ((!lat || !lon) && s.grid4) {
              const loc = gridToLatLon(s.grid4);
              if (loc) { lat = loc.lat; lon = loc.lon; }
            }
            
            return {
              call: s.activator, 
              ref: s.reference, 
              freq: s.frequency, 
              mode: s.mode,
              name: s.name || s.locationDesc,
              locationDesc: s.locationDesc,
              lat,
              lon,
              time: s.spotTime ? new Date(s.spotTime).toISOString().substr(11,5)+'z' : '',
              expire: s.expire || 0
            };
          }));
        }
      } catch (err) { 
        console.error('POTA error:', err); 
      } finally { 
        setLoading(false); 
      }
    };
    
    fetchPOTA();
    const interval = setInterval(fetchPOTA, 120 * 1000); // 2 minutes - reduced from 1 to save bandwidth
    return () => clearInterval(interval);
  }, []);

  return { data, loading };
};

export default usePOTASpots;
