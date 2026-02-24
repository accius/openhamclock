/**
 * useSpaceWeather Hook
 * Fetches solar flux, K-index, and sunspot number from NOAA
 */
import { useState, useEffect } from 'react';
import { DEFAULT_CONFIG } from '../utils/config.js';

export const useSpaceWeather = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [fluxRes, kIndexRes, sunspotRes] = await Promise.allSettled([
          fetch('https://services.swpc.noaa.gov/json/f107_cm_flux.json'),
          fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
          fetch('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json'),
        ]);

        let solarFlux = '--',
          kIndex = '--',
          sunspotNumber = '--';

        if (fluxRes.status === 'fulfilled' && fluxRes.value.ok) {
          const d = await fluxRes.value.json();
          if (d?.length) solarFlux = Math.round(d[d.length - 1].flux || d[d.length - 1].value || 0);
        }
        if (kIndexRes.status === 'fulfilled' && kIndexRes.value.ok) {
          const d = await kIndexRes.value.json();
          if (d?.length > 1) kIndex = d[d.length - 1][1] || '--';
        }
        if (sunspotRes.status === 'fulfilled' && sunspotRes.value.ok) {
          const d = await sunspotRes.value.json();
          if (d?.length) {
            // Walk backward to find the most recent entry with a valid SSN.
            // The SIDC 'ssn' field is often null for the last few months
            // because the monthly mean hasn't been finalized yet.
            // Fall back to 'observed_swpc_ssn' (SWPC daily) if available.
            for (let i = d.length - 1; i >= Math.max(0, d.length - 12); i--) {
              const val = d[i].ssn ?? d[i].observed_swpc_ssn ?? null;
              if (val != null && val > 0) {
                sunspotNumber = Math.round(val);
                break;
              }
            }
          }
        }

        let conditions = 'UNKNOWN';
        const sfi = parseInt(solarFlux),
          ki = parseInt(kIndex);
        if (!isNaN(sfi) && !isNaN(ki)) {
          if (sfi >= 150 && ki <= 2) conditions = 'EXCELLENT';
          else if (sfi >= 100 && ki <= 3) conditions = 'GOOD';
          else if (sfi >= 70 && ki <= 5) conditions = 'FAIR';
          else conditions = 'POOR';
        }

        setData({
          solarFlux: String(solarFlux),
          sunspotNumber: String(sunspotNumber),
          kIndex: String(kIndex),
          aIndex: '--',
          conditions,
          lastUpdate: new Date(),
        });
      } catch (err) {
        console.error('Space weather error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, DEFAULT_CONFIG.refreshIntervals.spaceWeather);
    return () => clearInterval(interval);
  }, []);

  return { data, loading };
};

export default useSpaceWeather;
