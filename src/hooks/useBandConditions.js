/**
 * useBandConditions Hook
 * Fetches real band conditions from N0NBH (hamqsl.com) via server proxy
 * Data sourced from NOAA, calculated by N0NBH, updated every 3 hours
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/apiFetch';

// Map N0NBH grouped band ranges to individual bands
// N0NBH provides: 80m-40m, 30m-20m, 17m-15m, 12m-10m (each with day/night)
const BAND_RANGE_MAP = {
  '80m-40m': ['80m', '60m', '40m'],
  '30m-20m': ['30m', '20m'],
  '17m-15m': ['17m', '15m'],
  '12m-10m': ['12m', '10m'],
};

// Normalize condition strings from N0NBH (they use title case)
const normalizeCondition = (cond) => {
  if (!cond) return 'FAIR';
  const upper = cond.toUpperCase().trim();
  if (upper === 'GOOD') return 'GOOD';
  if (upper === 'POOR') return 'POOR';
  return 'FAIR';
};

export const useBandConditions = () => {
  const [data, setData] = useState([]);
  const [vhfConditions, setVhfConditions] = useState([]);
  const [extras, setExtras] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await apiFetch('/api/n0nbh');
        if (!response) return; // backed off
        if (!response.ok) throw new Error(`N0NBH API error: ${response.status}`);
        const n0nbh = await response.json();

        // Build lookup: { 'day': { '80m-40m': 'Good', ... }, 'night': { ... } }
        const conditionMap = { day: {}, night: {} };
        for (const bc of n0nbh.bandConditions || []) {
          conditionMap[bc.time] = conditionMap[bc.time] || {};
          conditionMap[bc.time][bc.name] = normalizeCondition(bc.condition);
        }

        // Determine if it's currently day or night (UTC-based, simplified)
        const hour = new Date().getUTCHours();
        const isDaytime = hour >= 6 && hour <= 18;
        const currentTime = isDaytime ? 'day' : 'night';

        // Expand grouped ranges into individual bands with day and night conditions
        const bands = [];
        for (const [range, individualBands] of Object.entries(BAND_RANGE_MAP)) {
          const dayCondition = conditionMap.day?.[range] || 'FAIR';
          const nightCondition = conditionMap.night?.[range] || 'FAIR';

          for (const band of individualBands) {
            bands.push({
              band,
              condition: currentTime === 'day' ? dayCondition : nightCondition,
              day: dayCondition,
              night: nightCondition,
            });
          }
        }

        setData(bands);

        // VHF conditions
        setVhfConditions(
          (n0nbh.vhfConditions || []).map((v) => ({
            name: v.name,
            location: v.location,
            condition: v.condition,
          })),
        );

        // Extra solar/geomag data from N0NBH
        setExtras({
          aIndex: n0nbh.solarData?.aIndex,
          xray: n0nbh.solarData?.xray,
          solarWind: n0nbh.solarData?.solarWind,
          magneticField: n0nbh.solarData?.magneticField,
          protonFlux: n0nbh.solarData?.protonFlux,
          electronFlux: n0nbh.solarData?.electronFlux,
          heliumLine: n0nbh.solarData?.heliumLine,
          aurora: n0nbh.solarData?.aurora,
          normalization: n0nbh.solarData?.normalization,
          latDegree: n0nbh.solarData?.latDegree,
          geomagField: n0nbh.geomagField,
          signalNoise: n0nbh.signalNoise,
          muf: n0nbh.solarData?.muf,
          updated: n0nbh.updated,
          source: 'N0NBH',
        });
      } catch (err) {
        console.error('[BandConditions] N0NBH fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every hour (N0NBH updates every 3 hours, server caches for 1 hour)
    const interval = setInterval(fetchData, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { data, vhfConditions, extras, loading };
};

export default useBandConditions;
