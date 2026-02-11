/**
 * usePropagation Hook
 * Fetches propagation predictions between DE and DX locations
 * Supports mode and power parameters for VOACAP-style calculations
 */
import { useState, useEffect } from 'react';

export const usePropagation = (deLocation, dxLocation, propagationConfig = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const mode = propagationConfig.mode || 'SSB';
  const power = propagationConfig.power || 100;

  useEffect(() => {
    if (!deLocation || !dxLocation) return;

    const fetchPropagation = async () => {
      try {
        const params = new URLSearchParams({
          deLat: deLocation.lat,
          deLon: deLocation.lon,
          dxLat: dxLocation.lat,
          dxLon: dxLocation.lon,
          mode,
          power
        });
        
        const response = await fetch(`/api/propagation?${params}`);
        if (response.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (err) {
        console.error('Propagation error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPropagation();
    const interval = setInterval(fetchPropagation, 10 * 60 * 1000); // 10 minutes
    return () => clearInterval(interval);
  }, [deLocation?.lat, deLocation?.lon, dxLocation?.lat, dxLocation?.lon, mode, power]);

  return { data, loading };
};

export default usePropagation;
